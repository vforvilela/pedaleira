// AudioWorklet do gate, do compressor e do limitador (ver dynamics.js).
// Parâmetros chegam pela porta: { ...valores } para o gate e o compressor.
import { Gate, Compressor, Limiter } from './dynamics.js';
import { Looper } from './looper.js';

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

// Looper: { cmd: 'press' | 'stop' | 'clear' } ou { level }. Avisa a cada troca de estado.
registerProcessor('looper', class extends DspProcessor {
  constructor() { super(() => new Looper(sampleRate)); this.last = ''; }
  configure({ cmd, level }) {
    if (cmd) this.dsp.command(cmd);
    if (level !== undefined) this.dsp.level = level;
  }
  process(inputs, outputs) {
    super.process(inputs, outputs);
    if (this.dsp.state !== this.last) {
      this.last = this.dsp.state;
      this.port.postMessage({ state: this.last, seconds: this.dsp.len / sampleRate });
    }
    return true;
  }
});

registerProcessor('limiter', class extends DspProcessor {
  constructor() { super(() => new Limiter(sampleRate)); }
});
