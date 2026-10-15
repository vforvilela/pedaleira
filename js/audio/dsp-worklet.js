// AudioWorklet do gate, do compressor e do limitador (ver dynamics.js).
// Parâmetros chegam pela porta: { ...valores } para o gate e o compressor.
import { Gate, Compressor, Limiter } from './dynamics.js';
import { Looper } from './looper.js';
import { LatencyProbe } from './latency.js';
import { OctaveDown, Flanger, Envelope, PitchShifter } from './modulation.js';
import { FuzzBias } from './fuzz.js';
import { Metronome } from './metro.js';

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

// Looper: { cmd: 'press' | 'stop' | 'clear' | 'undo' } ou { level }. Avisa a cada troca de estado.
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

// Medição de latência: devolve { ms, hits } quando termina.
registerProcessor('latency', class extends DspProcessor {
  constructor() { super(() => new LatencyProbe(sampleRate)); this.sentResult = false; }
  process(inputs, outputs) {
    const out = outputs[0]?.[0];
    if (out) this.dsp.process(inputs[0]?.[0], out);
    if (this.dsp.done && !this.sentResult) {
      this.sentResult = true;
      this.port.postMessage({ ms: this.dsp.resultMs(), hits: this.dsp.delays.length, clicks: this.dsp.clicks });
    }
    return !this.sentResult;
  }
});

registerProcessor('octave', class extends DspProcessor {
  constructor() { super(() => new OctaveDown(sampleRate)); }
  configure(p) { this.dsp.set(p); }
});

registerProcessor('flanger', class extends DspProcessor {
  constructor() { super(() => new Flanger(sampleRate)); }
  configure(p) { this.dsp.set(p); }
});

registerProcessor('envelope', class extends DspProcessor {
  constructor() { super(() => new Envelope(sampleRate)); }
  configure({ sens }) { this.dsp.sens = sens; }
});

registerProcessor('pitch', class extends DspProcessor {
  constructor() { super(() => new PitchShifter(sampleRate)); }
  configure(p) { this.dsp.set(p); }
});

// Ganho de entrada do fuzz, que cai com o nível (volume da guitarra): { drive }.
registerProcessor('fuzzbias', class extends DspProcessor {
  constructor() { super(() => new FuzzBias(sampleRate)); }
  configure({ drive }) { this.dsp.drive = drive; }
});

registerProcessor('metro', class extends DspProcessor {
  constructor() { super(() => new Metronome(sampleRate)); }
  configure(p) { this.dsp.set(p); }
  // Gera o clique sem depender de entrada.
  process(inputs, outputs) {
    const out = outputs[0]?.[0];
    if (out) this.dsp.process(null, out);
    return true;
  }
});

registerProcessor('limiter', class extends DspProcessor {
  constructor() { super(() => new Limiter(sampleRate)); }
  process(inputs, outputs) {
    const ins = inputs[0], outs = outputs[0];
    if (!outs?.length) return true;
    if (!ins?.length) { for (const o of outs) o.fill(0); return true; }
    this.dsp.processChannels(ins.slice(0, outs.length), outs.slice(0, ins.length));
    return true;
  }
});
