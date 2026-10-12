// Flanger roxo inspirado no Boss BF-2: o "avião a jato", com MANUAL, DEPTH, RATE e RES.
import { Bypass, logMap, monoWorklet } from './common.js';

export default {
  type: 'flange',
  name: 'Flange',
  inspiredBy: 'Boss BF-2',
  category: 'mod',
  look: { style: 'compact', body: '#7b4fa0', ink: '#f0e6fa', strip: '#151515', stripInk: '#cfb2ea', subtitle: 'Flanger', led: '#ff3b30' },
  controls: [
    { id: 'manual', label: 'MANUAL', default: 5 },
    { id: 'depth', label: 'DEPTH', default: 6 },
    { id: 'rate', label: 'RATE', default: 3 },
    { id: 'res', label: 'RES', default: 5 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const fl = monoWorklet(ctx, 'flanger');
    bp.input.connect(fl).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => fl.port.postMessage({ manual: p.manual / 10, depth: p.depth / 10, rate: logMap(p.rate, 0.05, 6), res: p.res / 10 });
    apply();
    return {
      input: bp.input, output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { bp.output.disconnect(); fl.disconnect(); },
    };
  },
};
