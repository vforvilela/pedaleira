// Oitavador inspirado no Boss OC-2: uma e duas oitavas abaixo, para notas soltas (monofônico, como o original).
import { Bypass, monoWorklet } from './common.js';

export default {
  type: 'oitava',
  name: 'Oitava',
  inspiredBy: 'Boss OC-2',
  category: 'filter',
  look: { style: 'compact', body: '#c9c3a8', ink: '#2b2716', strip: '#151515', stripInk: '#e4dcb8', subtitle: 'Octave', led: '#ff3b30' },
  controls: [
    { id: 'oct2', label: 'OCT 2', default: 0 },
    { id: 'oct1', label: 'OCT 1', default: 7 },
    { id: 'direct', label: 'DIRECT', default: 7 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const oct = monoWorklet(ctx, 'octave');
    bp.input.connect(oct).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => oct.port.postMessage({ oct1: (p.oct1 / 10) * 1.6, oct2: (p.oct2 / 10) * 1.6, direct: (p.direct / 10) ** 1.5 });
    apply();
    return {
      input: bp.input, output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { bp.output.disconnect(); oct.disconnect(); },
    };
  },
};
