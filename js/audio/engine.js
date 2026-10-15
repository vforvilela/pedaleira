// Contexto de áudio, entrada da guitarra e ligação da cadeia de pedais.
import { prepareAudio } from '../platform.js';

const dbToGain = db => Math.pow(10, db / 20);

let wasmBytesPromise = null;
// Baixa o nam.wasm uma vez. Os bytes vão para cada worklet, que compila lá dentro
// (o Chrome não entrega um WebAssembly.Module pela porta do AudioWorklet).
export function loadWasmBytes() {
  wasmBytesPromise ??= fetch(new URL('../nam/nam.wasm', import.meta.url))
    .then(r => (r.ok ? r.arrayBuffer() : null))
    .then(b => (b && WebAssembly.validate(b) ? b : null))
    .catch(() => null);
  return wasmBytesPromise;
}

// Nó mono de um dos processadores do AudioWorklet.
export const monoWorklet = (ctx, name) => new AudioWorkletNode(ctx, name, {
  numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
  channelCount: 1, channelCountMode: 'explicit',
});

export class Engine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.blocks = [];
  }

  get running() { return !!this.ctx; }

  async start(deviceId, bufferMs = 5) {
    const ask = id => navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: id ? { exact: id } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        latency: 0, channelCount: { ideal: 2 },
      },
    });
    this.session = await prepareAudio(bufferMs); // iPhone como app: sessão de gravação com buffer curto, antes de pedir a entrada
    try {
      this.stream = await ask(deviceId);
    } catch (e) {
      // A entrada salva pode ter sumido (interface desconectada): tenta a padrão.
      if (!deviceId || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e;
      this.stream = await ask(null);
    }
    // 48 kHz: a taxa das capturas NAM. Interface só de 44,1 kHz (Cube Baby, muitos celulares): alguns navegadores
    // recusam a taxa pedida em vez de reamostrar; aí vale a taxa do aparelho, e a captura soa um pouco mais
    // brilhante do que foi gravada.
    let ctx;
    try { ctx = new AudioContext({ latencyHint: 0, sampleRate: 48000 }); } catch { ctx = new AudioContext({ latencyHint: 0 }); }
    this.ctx = ctx;
    await Promise.all(['../nam/nam-worklet.js', './dsp-worklet.js']
      .map(f => ctx.audioWorklet.addModule(new URL(f, import.meta.url))));
    this.wasmBytes = await loadWasmBytes();

    this.source = ctx.createMediaStreamSource(this.stream);
    // A guitarra é um sinal só. Sem canal escolhido, a mistura do navegador: mono passa inteiro, estéreo vira
    // a média dos dois. Com canal escolhido, só ele, inteiro.
    const mono = node => Object.assign(node, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    this.input = mono(ctx.createGain());
    this.mix = mono(ctx.createGain());
    this.source.connect(this.mix).connect(this.input);
    const split = ctx.createChannelSplitter(2);
    this.source.connect(split);
    this.chGain = [0, 1].map(i => {
      const g = ctx.createGain();
      g.gain.value = 0;
      split.connect(g, i).connect(this.input);
      return g;
    });
    this.chAnalyser = [0, 1].map(i => {
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      split.connect(a, i);
      return a;
    });
    this.channels = this.stream.getAudioTracks()[0].getSettings().channelCount ?? 0; // 0: o navegador não diz
    this.useChannel(null);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.input.connect(this.analyser);

    // Nível do preset: um ganho entre a cadeia e o Volume, para igualar presets entre si.
    this.trim = ctx.createGain();
    this.master = ctx.createGain();
    this.trim.connect(this.master);
    // Limitador de segurança antes do fone (sem o atraso de ~6 ms do DynamicsCompressorNode).
    this.limiter = new AudioWorkletNode(ctx, 'limiter', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
    });
    // EQ geral: três faixas largas entre o Volume e o limitador, para a sala ou o fone, fora dos presets.
    const eqNode = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.eq = { low: eqNode('lowshelf', 120, 0.7), mid: eqNode('peaking', 800, 0.8), high: eqNode('highshelf', 3200, 0.7) };
    this.master.connect(this.eq.low).connect(this.eq.mid).connect(this.eq.high).connect(this.limiter).connect(ctx.destination);
    this.outAnalyser = ctx.createAnalyser();
    this.outAnalyser.fftSize = 1024;
    this.limiter.connect(this.outAnalyser);

    return this.stream.getAudioTracks()[0];
  }

  async stop() {
    for (const b of this.blocks) b.audio?.dispose();
    this.blocks = [];
    this.stream?.getTracks().forEach(t => t.stop());
    await this.ctx?.close();
    this.ctx = this.stream = null;
  }

  // Canal da interface onde está a guitarra (0 ou 1); null mistura os dois.
  useChannel(i) {
    const t = this.ctx.currentTime;
    this.mix.gain.setTargetAtTime(+(i === null), t, 0.005);
    this.chGain.forEach((g, n) => g.gain.setTargetAtTime(+(n === i), t, 0.005));
  }

  setInputGain(db) {
    if (this.ctx) this.input.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.01);
  }

  setMaster(db) {
    if (this.ctx) this.master.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.01);
  }

  // blocks: [{ audio: { input, output } }] na ordem do sinal.
  connectChain(blocks) {
    if (!this.ctx) return;
    this.input.disconnect();
    this.input.connect(this.analyser);
    for (const b of this.blocks) b.audio?.output.disconnect();
    this.blocks = blocks;
    let prev = this.input;
    for (const b of blocks) {
      prev.connect(b.audio.input);
      prev = b.audio.output;
    }
    prev.connect(this.trim);
  }

  setEq({ low, mid, high }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.eq.low.gain.setTargetAtTime(low, t, 0.02);
    this.eq.mid.gain.setTargetAtTime(mid, t, 0.02);
    this.eq.high.gain.setTargetAtTime(high, t, 0.02);
  }

  setTrim(db) {
    if (this.ctx) this.trim.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.01);
  }

  // Spillover: um delay ou reverb que sai da pedaleira (troca de preset) não recebe mais sinal, mas a cauda
  // continua soando por `seconds` e some aos poucos no último 1,5 s, como numa pedaleira digital boa.
  // Chamar depois de connectChain, que desliga as saídas da cadeia antiga.
  // (A cauda sai pelo nível do preset novo: o spill liga no trim, como a cadeia.)
  spill(audio, seconds) {
    const ctx = this.ctx, fade = ctx.createGain(), t = ctx.currentTime;
    audio.output.disconnect();
    audio.output.connect(fade).connect(this.trim);
    fade.gain.setValueAtTime(1, t + seconds - 1.5);
    fade.gain.linearRampToValueAtTime(0, t + seconds);
    setTimeout(() => { fade.disconnect(); audio.dispose(); }, seconds * 1000 + 100);
  }

  peak(buf, analyser = this.analyser) {
    analyser.getFloatTimeDomainData(buf);
    let p = 0;
    for (const s of buf) p = Math.max(p, Math.abs(s));
    return p;
  }

  // Latência real de ida e volta (precisa de cabo da saída para a entrada). A pedaleira fica muda enquanto mede.
  async measureRoundTrip() {
    const ctx = this.ctx;
    const probe = new AudioWorkletNode(ctx, 'latency', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
    });
    this.master.disconnect();
    this.input.connect(probe);
    probe.connect(ctx.destination);
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('a medição não terminou')), 8000);
        probe.port.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
      });
    } finally {
      this.input.disconnect(probe);
      probe.disconnect();
      this.master.connect(this.eq.low);
    }
  }

  // Grava o que sai para o fone (depois do limitador), comprimido pelo navegador: Opus no Chrome/Firefox,
  // AAC no Safari. Devolve uma função que para e entrega o arquivo.
  record() {
    const dest = this.ctx.createMediaStreamDestination();
    this.limiter.connect(dest);
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(dest.stream, { mimeType: type, audioBitsPerSecond: 192000 });
    const parts = [];
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    rec.start(1000);
    return () => new Promise(resolve => {
      rec.onstop = () => {
        try { this.limiter.disconnect(dest); } catch { /* o áudio já foi desligado */ }
        resolve(new Blob(parts, { type: rec.mimeType }));
      };
      rec.stop();
    });
  }

  latencyMs() {
    const c = this.ctx;
    return ((c.baseLatency || 0) + (c.outputLatency || 0)) * 1000;
  }
}

export { dbToGain };
