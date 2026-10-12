// Equalizador gráfico prateado inspirado no Boss GE-7: 7 faixas de ±15 dB e volume.
import { Bypass, biquad, dbToGain, smooth } from './common.js';

const BANDS = [100, 200, 400, 800, 1600, 3200, 6400];
const label = f => (f >= 1000 ? `${f / 1000}k` : String(f));

export default {
  type: 'equalizador',
  name: 'Equalizador',
  inspiredBy: 'Boss GE-7',
  category: 'eq',
  look: { style: 'compact', body: '#d9dbde', ink: '#222', strip: '#151515', stripInk: '#d9dbde', subtitle: 'Equalizer', led: '#ff3b30' },
  controls: [
    ...BANDS.map(f => ({ id: `b${f}`, label: label(f), type: 'slider', bipolar: true, default: 5 })),
    { id: 'level', label: 'LVL', type: 'slider', bipolar: true, default: 5 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const filters = BANDS.map(f => biquad(ctx, 'peaking', f, 1.4, 0));
    const level = ctx.createGain();
    filters.reduce((a, b) => a.connect(b), bp.input).connect(level).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      BANDS.forEach((f, i) => smooth(ctx, filters[i].gain, (p[`b${f}`] - 5) * 3));
      smooth(ctx, level.gain, dbToGain((p.level - 5) * 3));
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
