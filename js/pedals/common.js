// Peças comuns aos pedais.
import { dbToGain, monoWorklet } from '../audio/engine.js';
import { t } from '../i18n.js';
import { encodeForWasm } from '../nam/nam-core.js';

export { dbToGain, monoWorklet };

export function smooth(ctx, param, value, tc = 0.015) {
  param.setTargetAtTime(value, ctx.currentTime, tc);
}

export function biquad(ctx, type, frequency, Q = 0.707, gain = 0) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = frequency; b.Q.value = Q; b.gain.value = gain;
  return b;
}

export function chain(...nodes) {
  nodes.reduce((a, b) => (a.connect(b), b));
  return nodes;
}

// Curva de WaveShaper a partir de uma função em [-1, 1].
export function curve(fn, n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
  return c;
}

// Mapeia um botão 0..10 para uma escala logarítmica entre lo e hi.
export const logMap = (v, lo, hi) => lo * Math.pow(hi / lo, v / 10);

// Caixa 1×12 aproximada com filtros, para quando não há IR carregado.
export function cabFilters(ctx) {
  return [
    ['highpass', 80, 0.7, 0],
    ['peaking', 120, 1.0, 3],
    ['peaking', 400, 1.2, -3],
    ['peaking', 2500, 1.0, 4],
    ['lowpass', 5000, 0.7, 0],
    ['lowpass', 6500, 0.7, 0],
  ].map(([t, f, q, g]) => biquad(ctx, t, f, q, g));
}

// Nó que roda uma captura .nam no AudioWorklet.
// A parte pesada de abrir a captura (achatar pesos e configuração) acontece aqui, na thread principal;
// o worklet só instancia e aquece em pedaços, com o modelo anterior ainda tocando.
export class NamSlot {
  constructor(ctx, wasmBytes) {
    this.node = monoWorklet(ctx, 'nam');
    // O worklet só roda process() ligado à saída. O pedal novo carrega a captura antes de entrar na cadeia
    // (presets.js), e o aquecimento acontece em process(): um ramo mudo até a saída mantém o nó rodando.
    // dispose() do pedal desliga o nó inteiro, ramo incluído.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.node.connect(this.sink).connect(ctx.destination);
    this.wasm = !!wasmBytes;
    if (wasmBytes) this.node.port.postMessage({ type: 'wasm', bytes: wasmBytes });
    this.loaded = false;
  }

  // Cada load tem um id: o 'loaded' (ou o timeout) de um load anterior, que ficou para trás porque outra
  // captura entrou no meio do aquecimento, não resolve nem rejeita o atual (rejeitar apagaria a captura certa).
  load(nam) {
    const id = (this.loadId = (this.loadId || 0) + 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (id === this.loadId) reject(new Error(t('pedals.engineTimeout'))); }, 15000);
      const done = fn => arg => { clearTimeout(timer); fn(arg); };
      this.node.port.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.type === 'loaded') { this.loaded = true; done(resolve)(data); }
        else { this.loaded = false; done(reject)(Object.assign(new Error(data.message), { code: data.code, detail: data.detail })); }
      };
      this.node.port.onmessageerror = done(reject);
      let enc = null;
      try { enc = this.wasm ? encodeForWasm(nam) : null; } catch (err) { done(reject)(err); return; }
      if (enc) this.node.port.postMessage({ type: 'load', id, enc }, [enc.cfg.buffer, enc.weights.buffer]);
      else this.node.port.postMessage({ type: 'load', id, nam });
    });
  }

  clear() {
    this.loaded = false;
    this.node.port.postMessage({ type: 'clear' });
  }
}

// Ganho de normalização da captura: leva a sonoridade declarada no .nam para -18 dB.
export const namMakeupDb = nam => (typeof nam?.metadata?.loudness === 'number' ? -18 - nam.metadata.loudness : 0);

// Bypass com crossfade curto entre o sinal seco e o processado.
export class Bypass {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }

  set(on) {
    smooth(this.ctx, this.dry.gain, on ? 0 : 1, 0.004);
    smooth(this.ctx, this.wet.gain, on ? 1 : 0, 0.004);
  }
}
