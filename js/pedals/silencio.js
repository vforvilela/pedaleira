// Noise gate branco inspirado no Boss NS-2. Corta o chiado entre as frases sem cortar a nota.
import { Bypass, logMap, monoWorklet } from './common.js';

export default {
  type: 'silencio',
  name: 'Silêncio',
  inspiredBy: 'Boss NS-2',
  category: 'gate',
  look: {
    style: 'compact', body: '#e9e9e4', ink: '#222', strip: '#151515', stripInk: '#e9e9e4',
    subtitle: 'Noise Suppressor', led: '#ff3b30',
  },
  controls: [
    { id: 'thres', label: 'THRES', default: 4 },
    { id: 'decay', label: 'DECAY', default: 4 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const gate = monoWorklet(ctx, 'gate');
    bp.input.connect(gate).connect(bp.wet);
    const p = { ...env.params };
    // THRES 0 → -85 dB (quase nunca fecha), 10 → -30 dB. DECAY de 20 ms a 2 s.
    const apply = () => gate.port.postMessage({ threshold: -85 + p.thres * 5.5, decay: logMap(p.decay, 0.02, 2) });
    apply();
    return {
      input: bp.input,
      output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { bp.output.disconnect(); gate.disconnect(); },
    };
  },
};
