// Escolhe o motor da captura: WebAssembly SIMD para WaveNet A1/A2 (rápido), JS para LSTM e como reserva.
import { createModel, encodeForWasm, NamError } from './nam-core.js';

class WasmWaveNet {
  constructor(wasmModule, enc, deferWarm = false) {
    const inst = new WebAssembly.Instance(wasmModule, {});
    const e = inst.exports;
    const cfgPtr = e.alloc(enc.cfg.byteLength);
    new Int32Array(e.memory.buffer, cfgPtr, enc.cfg.length).set(enc.cfg);
    const wPtr = e.alloc(enc.weights.byteLength);
    new Float32Array(e.memory.buffer, wPtr, enc.weights.length).set(enc.weights);
    if (e.init(cfgPtr, enc.cfg.length, wPtr, enc.weights.length) !== 0)
      throw new NamError('Arquivo .nam inconsistente (pesos ou configuração).');
    this.e = e;
    if (!deferWarm) e.prewarm();
    // A memória não cresce depois do init, então as vistas continuam válidas.
    this.inBuf = new Float32Array(e.memory.buffer, e.input_ptr(), 128);
    this.outBuf = new Float32Array(e.memory.buffer, e.output_ptr(), 128);
    this.engine = 'wasm';
  }

  // Pré-aquece até `maxBlocks` blocos; devolve quantas amostras ainda faltam.
  warm(maxBlocks) { return this.e.warm(maxBlocks); }

  process(input, output) {
    for (let s = 0; s < input.length; s += 128) {
      const n = Math.min(128, input.length - s);
      this.inBuf.set(input.subarray(s, s + n));
      this.e.process(n);
      output.set(this.outBuf.subarray(0, n), s);
    }
  }
}

// `nam` é o JSON do .nam ou, já achatado por encodeForWasm (na thread principal), { cfg, weights, ... }.
// Com deferWarm, o modelo volta sem pré-aquecer: chame model.warm(blocos) até devolver 0.
export function createEngine(nam, wasmModule, { deferWarm = false } = {}) {
  const pre = nam?.cfg instanceof Int32Array;
  const enc = pre ? nam : wasmModule ? encodeForWasm(nam) : null;
  if (enc && wasmModule) {
    try {
      const m = new WasmWaveNet(wasmModule, enc, deferWarm);
      m.sampleRate = enc.sampleRate;
      m.loudness = enc.loudness;
      return m;
    } catch (err) {
      if (pre) throw err; // sem o JSON não há como cair para o motor JS
      /* cai para o motor JS, que dá o erro certo se o arquivo for inválido */
    }
  }
  if (pre) throw new NamError('Motor WebAssembly indisponível para a captura já codificada.');
  const m = createModel(nam, { deferWarm });
  m.engine = 'js';
  return m;
}
