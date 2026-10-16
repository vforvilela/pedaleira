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

  get running() { return !!this.ctx && this.ready; }

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
    this.ready = true;

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
    // Leitura do afinador geral: a entrada crua, com janela longa (graves da guitarra).
    this.tunerAnalyser = ctx.createAnalyser();
    this.tunerAnalyser.fftSize = 4096;
    this.input.connect(this.tunerAnalyser);

    // Nível do preset: um ganho entre a cadeia e o Volume, para igualar presets entre si.
    this.trim = ctx.createGain();
    this.master = ctx.createGain();
    // Afinador geral: cala a saída (depois da cadeia, antes do Volume) sem depender de pedal na cadeia.
    this.tunerMute = ctx.createGain();
    this.trim.connect(this.tunerMute).connect(this.master);

    // Limitador de segurança antes do fone (sem o atraso de ~6 ms do DynamicsCompressorNode).
    this.limiter = new AudioWorkletNode(ctx, 'limiter', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
    });
    // EQ geral: três faixas largas entre o Volume e o limitador, para a sala ou o fone, fora dos presets.
    const eqNode = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.eq = { low: eqNode('lowshelf', 120, 0.7), mid: eqNode('peaking', 800, 0.8), high: eqNode('highshelf', 3200, 0.7) };
    this.master.connect(this.eq.low).connect(this.eq.mid).connect(this.eq.high).connect(this.limiter).connect(ctx.destination);
    // Guitarra em mono no canal esquerdo (quando o clique vai só para o direito): o PA recebe os efeitos estéreo
    // somados, sem perder metade das repetições do ping-pong. Ligado por setGuitarLeft.
    this.monoL = ctx.createGain();
    Object.assign(this.monoL, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    this.monoMerge = ctx.createChannelMerger(2);
    this.monoL.connect(this.monoMerge, 0, 0);
    // Monitor: o que vai só para o fone (clique do metrônomo), fora da cadeia, do limitador e da gravação.
    // Segue o Volume, para o clique não ficar alto demais quando a guitarra está baixa.
    this.monitor = ctx.createGain();
    this.monitor.connect(ctx.destination);
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
    this.ready = false;
    this.swap = null;
    this.wired = [];
    this.guitarLeft = false;
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
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.01);
    // O monitor não passa pelo limitador: acima de 0 dB o clique estouraria o fone.
    this.monitor.gain.setTargetAtTime(dbToGain(Math.min(db, 0)), this.ctx.currentTime, 0.01);
  }

  // blocks: [{ audio: { input, output } }] na ordem do sinal. Devolve uma promessa que resolve depois da troca:
  // quem tira pedais da cadeia só os descarta (dispose) ou manda para o spill depois dela, senão o corte estala.
  // A troca de ligações é seca: o nível do preset mergulha a zero em 5 ms, a troca acontece no vale (marcado pelo
  // relógio do áudio, não por setTimeout, que o navegador estrangula com a tela apagada) e sobe em 8 ms já no
  // nível do preset novo. Uma segunda chamada durante o mergulho só troca o destino: uma troca, a última cadeia.
  connectChain(blocks) {
    if (!this.ctx) return Promise.resolve();
    this.blocks = blocks;
    if (this.swap) return this.swap.promise;
    const ctx = this.ctx, g = this.trim.gain;
    let resolve;
    const swap = this.swap = { promise: new Promise(r => { resolve = r; }) };
    const run = () => {
      if (this.swap !== swap) return;
      this.swap = null;
      swap.clock?.disconnect();
      clearTimeout(swap.timer);
      this.input.disconnect();
      this.input.connect(this.analyser);
      this.input.connect(this.tunerAnalyser);
      // Desliga o que está ligado de fato (não o que alguém pediu), menos as caudas em spill.
      for (const a of this.wired || []) if (!a.spilled) { try { a.output.disconnect(); } catch { /* já desligado */ } }
      let prev = this.input;
      const wired = [];
      for (const b of this.blocks) { prev.connect(b.audio.input); prev = b.audio.output; wired.push(b.audio); }
      prev.connect(this.trim);
      this.wired = wired;
      const t2 = ctx.currentTime;
      g.cancelScheduledValues(t2);
      g.setValueAtTime(0, t2);
      g.linearRampToValueAtTime(dbToGain(this.trimDb ?? 0), t2 + 0.008);
      resolve();
    };
    if (ctx.state !== 'running') { run(); return swap.promise; } // sem som andando, sem estalo: troca já
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.005);
    // Relógio: uma fonte que termina no vale; o onended chega na thread principal mesmo com timers estrangulados.
    const clock = ctx.createConstantSource(), mute = ctx.createGain();
    mute.gain.value = 0;
    clock.connect(mute).connect(ctx.destination);
    clock.onended = run;
    clock.start(t);
    clock.stop(t + 0.006);
    swap.clock = mute;
    swap.timer = setTimeout(run, 250); // reserva, se o onended não vier
    return swap.promise;
  }

  setGuitarLeft(on) {
    if (!this.ctx || !!on === !!this.guitarLeft) return;
    this.guitarLeft = !!on;
    // (Só a ligação para a saída muda: o limitador também alimenta o medidor e a gravação.)
    if (on) {
      this.limiter.disconnect(this.ctx.destination);
      this.limiter.connect(this.monoL);
      this.monoMerge.connect(this.ctx.destination);
    } else {
      this.limiter.disconnect(this.monoL);
      this.monoMerge.disconnect();
      this.limiter.connect(this.ctx.destination);
    }
  }

  setTunerMute(on) {
    if (this.ctx) this.tunerMute.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.008);
  }

  setEq({ low, mid, high }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.eq.low.gain.setTargetAtTime(low, t, 0.02);
    this.eq.mid.gain.setTargetAtTime(mid, t, 0.02);
    this.eq.high.gain.setTargetAtTime(high, t, 0.02);
  }

  setTrim(db) {
    this.trimDb = db;
    if (!this.ctx || this.swap) return; // durante o mergulho da troca: o fim da troca aplica
    this.trim.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.01);
  }

  // Spillover: um delay ou reverb que sai da pedaleira (troca de preset) não recebe mais sinal, mas a cauda
  // continua soando por `seconds` e some aos poucos no último 1,5 s, como numa pedaleira digital boa.
  // Chamar depois que a promessa do connectChain resolver (a cadeia nova já está ligada).
  // (A cauda sai pelo nível do preset novo: o spill liga no trim, como a cadeia.)
  spill(audio, seconds) {
    const ctx = this.ctx, fade = ctx.createGain(), t = ctx.currentTime;
    audio.spilled = true; // connectChain não desliga mais esta saída
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
