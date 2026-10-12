// Booster inspirado no Xotic EP Booster: até +20 dB com o brilho e a leve compressão de um pré de fita.
import { Bypass, biquad, curve, dbToGain, smooth } from './common.js';

const BRIGHT = ['OFF', 'ON'];
// Quase linear até perto do topo, depois arredonda (o pré satura de leve quando empurrado).
const soft = curve(x => Math.tanh(1.5 * x) / Math.tanh(1.5));

export default {
  type: 'turbo',
  name: 'Turbo',
  inspiredBy: 'Xotic EP Booster',
  category: 'drive',
  look: { style: 'stomp', body: '#c8ccd2', ink: '#1b1b1b', accent: '#1b1b1b', subtitle: 'Booster', led: '#3aa0ff' },
  controls: [
    { id: 'boost', label: 'BOOST', default: 5 },
    { id: 'bright', label: 'BRIGHT', type: 'select', options: BRIGHT, default: 0 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const gain = ctx.createGain();
    const shelf = biquad(ctx, 'highshelf', 3000, 0.7, 0);
    const shaper = ctx.createWaveShaper();
    shaper.curve = soft;
    shaper.oversample = '2x';
    const out = ctx.createGain();
    out.gain.value = 0.9;
    bp.input.connect(gain).connect(shelf).connect(shaper).connect(out).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      smooth(ctx, gain.gain, dbToGain(p.boost * 2));
      smooth(ctx, shelf.gain, p.bright ? 4 : 1);
    };
    apply();
    return {
      input: bp.input, output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { bp.output.disconnect(); },
    };
  },
};
