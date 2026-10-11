// Escolhe o motor da captura: WebAssembly SIMD para WaveNet (rápido), JS para LSTM e como reserva.
import { createModel, encodeForWasm, NamError } from './nam-core.js';

class WasmWaveNet {
  constructor(wasmModule, nam) {
    const enc = encodeForWasm(nam);
    const inst = new WebAssembly.Instance(wasmModule, {});
    const e = inst.exports;
    const cfgPtr = e.alloc(enc.cfg.byteLength);
    new Int32Array(e.memory.buffer, cfgPtr, enc.cfg.length).set(enc.cfg);
    const wPtr = e.alloc(enc.weights.byteLength);
    new Float32Array(e.memory.buffer, wPtr, enc.weights.length).set(enc.weights);
    if (e.init(cfgPtr, enc.cfg.length, wPtr, enc.weights.length) !== 0)
      throw new NamError('Arquivo .nam com número de pesos diferente do esperado.');
    this.e = e;
    // A memória não cresce depois do init, então as vistas continuam válidas.
    this.inBuf = new Float32Array(e.memory.buffer, e.input_ptr(), 128);
    this.outBuf = new Float32Array(e.memory.buffer, e.output_ptr(), 128);
    this.engine = 'wasm';
  }

  process(input, output) {
    for (let s = 0; s < input.length; s += 128) {
      const n = Math.min(128, input.length - s);
      this.inBuf.set(input.subarray(s, s + n));
      this.e.process(n);
      output.set(this.outBuf.subarray(0, n), s);
    }
  }
}

export function createEngine(nam, wasmModule) {
  if (wasmModule && nam?.architecture === 'WaveNet') {
    const m = new WasmWaveNet(wasmModule, nam);
    m.sampleRate = nam.sample_rate || 48000;
    m.loudness = nam.metadata?.loudness ?? null;
    return m;
  }
  const m = createModel(nam);
  m.engine = 'js';
  return m;
}
