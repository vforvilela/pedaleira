// Contexto de áudio, entrada da guitarra e ligação da cadeia de pedais.

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

  async start(deviceId) {
    const ask = id => navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: id ? { exact: id } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        latency: 0, channelCount: { ideal: 1 },
      },
    });
    try {
      this.stream = await ask(deviceId);
    } catch (e) {
      // A entrada salva pode ter sumido (interface desconectada): tenta a padrão.
      if (!deviceId || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e;
      this.stream = await ask(null);
    }
    const ctx = this.ctx = new AudioContext({ latencyHint: 0, sampleRate: 48000 });
    await Promise.all(['../nam/nam-worklet.js', './dsp-worklet.js']
      .map(f => ctx.audioWorklet.addModule(new URL(f, import.meta.url))));
    this.wasmBytes = await loadWasmBytes();

    this.source = ctx.createMediaStreamSource(this.stream);
    // Força mono: a guitarra é um sinal só.
    this.input = ctx.createGain();
    this.input.channelCount = 1;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';
    this.source.connect(this.input);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.input.connect(this.analyser);

    this.master = ctx.createGain();
    // Limitador de segurança antes do fone (sem o atraso de ~6 ms do DynamicsCompressorNode).
    this.limiter = monoWorklet(ctx, 'limiter');
    this.master.connect(this.limiter).connect(ctx.destination);
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
    prev.connect(this.master);
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
      this.master.connect(this.limiter);
    }
  }

  latencyMs() {
    const c = this.ctx;
    return ((c.baseLatency || 0) + (c.outputLatency || 0)) * 1000;
  }
}

export { dbToGain };
