// Pitch shifter inspirado no DigiTech Whammy: o pedal leva a nota até o intervalo escolhido.
// Pedal no fim = intervalo inteiro; no começo = nota original. DETUNE mistura o som com uma cópia
// levemente desafinada (efeito de dobra), na quantidade do pedal.
import { Bypass, monoWorklet } from './common.js';

const SHIFTS = [
  ['+1 OIT', 12], ['+2 OIT', 24], ['-1 OIT', -12], ['-2 OIT', -24], ['+5ª', 7], ['-4ª', -5], ['DETUNE', 0.2],
];

export default {
  type: 'baleia',
  name: 'Baleia',
  inspiredBy: 'DigiTech Whammy',
  category: 'filter',
  defaultOn: false,
  look: { style: 'treadle', body: '#b3202a', ink: '#f2f2f2', accent: '#f2f2f2', plate: 'Baleia', subtitle: 'PITCH', led: '#ff3b30' },
  controls: [
    { id: 'pedal', label: 'PEDAL', default: 0 },
    { id: 'shift', label: 'SHIFT', type: 'select', options: SHIFTS.map(s => s[0]), default: 0 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const ps = monoWorklet(ctx, 'pitch');
    bp.input.connect(ps).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      const [name, semis] = SHIFTS[p.shift] || SHIFTS[0];
      const amt = p.pedal / 10;
      if (name === 'DETUNE') ps.port.postMessage({ ratio: 2 ** (semis / 12), dry: 1, wet: amt * 0.8 });
      else ps.port.postMessage({ ratio: 2 ** ((semis * amt) / 12), dry: 0, wet: 1 });
    };
    apply();
    return {
      input: bp.input, output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { bp.output.disconnect(); ps.disconnect(); },
    };
  },
};
