// AudioWorklet que roda uma captura NAM.
// Mensagens: { type: 'wasm', bytes } uma vez, depois { type: 'load', enc } (captura já achatada na thread
// principal, com os buffers transferidos), { type: 'load', nam } (JSON, para LSTM ou sem WebAssembly) ou
// { type: 'clear' }. O modelo novo aquece em pedaços dentro de process(), enquanto o antigo continua tocando;
// só depois de pronto ele entra e o 'loaded' é enviado. Assim a troca não trava a thread de áudio.
import { createEngine } from './nam-engine.js';

let wasmModule = null; // compilado uma vez por contexto de áudio

// Blocos de 128 amostras de pré-aquecimento por quantum: 2x o tempo real com um modelo tocando, 4x sem;
// o motor JS (reserva, mais lento) vai de um em um.
const WARM_BLOCKS = 2, WARM_BLOCKS_IDLE = 4;

class NamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.model = null;
    this.pending = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'wasm') {
        try { wasmModule ??= new WebAssembly.Module(data.bytes); } catch { /* fica no motor JS */ }
        return;
      }
      if (data.type === 'clear') { this.model = this.pending = null; return; }
      try {
        this.pending = createEngine(data.enc ?? data.nam, wasmModule, { deferWarm: true });
        this.pendingId = data.id;
      } catch (err) {
        this.pending = null;
        this.port.postMessage({ type: 'error', id: data.id, message: err.message, code: err.code, detail: err.detail });
      }
    };
  }

  warmPending(frames) {
    const per = this.pending.engine === 'js' ? 1 : this.model ? WARM_BLOCKS : WARM_BLOCKS_IDLE;
    const left = this.pending.warm(Math.max(1, Math.round(per * frames / 128)));
    if (left > 0) return;
    this.model = this.pending;
    this.pending = null;
    this.port.postMessage({ type: 'loaded', id: this.pendingId, engine: this.model.engine, sampleRate: this.model.sampleRate });
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0], out = outputs[0]?.[0];
    if (!out) return true;
    if (this.pending) this.warmPending(out.length);
    if (!inp) out.fill(0);
    else if (!this.model) out.set(inp);
    else this.model.process(inp, out);
    return true;
  }
}

registerProcessor('nam', NamProcessor);
