// AudioWorklet do gate, do compressor e do limitador (ver dynamics.js).
// Parâmetros chegam pela porta: { ...valores } para o gate e o compressor.
import { Gate, Compressor, Limiter } from './dynamics.js';

class DspProcessor extends AudioWorkletProcessor {
  constructor(make) {
    super();
    this.dsp = make();
    this.port.onmessage = ({ data }) => this.configure(data);
  }

  configure() {}

  process(inputs, outputs) {
    const inp = inputs[0]?.[0], out = outputs[0]?.[0];
    if (!out) return true;
    if (!inp) out.fill(0);
    else this.dsp.process(inp, out);
    return true;
  }
}

registerProcessor('gate', class extends DspProcessor {
  constructor() { super(() => new Gate(sampleRate)); }
  configure({ threshold, decay }) { this.dsp.set(threshold, decay); }
});

registerProcessor('comp', class extends DspProcessor {
  constructor() { super(() => new Compressor(sampleRate)); }
  configure(p) { this.dsp.set(p); }
});

registerProcessor('limiter', class extends DspProcessor {
  constructor() { super(() => new Limiter(sampleRate)); }
});
