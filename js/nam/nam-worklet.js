// AudioWorklet que roda uma captura NAM.
// Mensagens: { type: 'wasm', bytes } uma vez, depois { type: 'load', nam } ou { type: 'clear' }.
import { createEngine } from './nam-engine.js';

let wasmModule = null; // compilado uma vez por contexto de áudio

class NamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.model = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'wasm') {
        try { wasmModule ??= new WebAssembly.Module(data.bytes); } catch { /* fica no motor JS */ }
        return;
      }
      if (data.type === 'clear') { this.model = null; return; }
      try {
        this.model = createEngine(data.nam, wasmModule);
        this.port.postMessage({ type: 'loaded', engine: this.model.engine, sampleRate: this.model.sampleRate });
      } catch (err) {
        this.model = null;
        this.port.postMessage({ type: 'error', message: err.message });
      }
    };
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0], out = outputs[0]?.[0];
    if (!out) return true;
    if (!inp) out.fill(0);
    else if (!this.model) out.set(inp);
    else this.model.process(inp, out);
    return true;
  }
}

registerProcessor('nam', NamProcessor);
