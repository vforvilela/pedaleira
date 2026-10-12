// Fuzz redondo inspirado no Dunlop Fuzz Face: dois transistores, clipagem forte e assimétrica.
import { Bypass, biquad, curve, dbToGain, smooth } from './common.js';

// O lado positivo bate no teto logo; o negativo arredonda. A assimetria gera os harmônicos pares do fuzz.
const fuzzCurve = curve(x => (x >= 0 ? Math.tanh(6 * x) : 0.85 * Math.tanh(2.2 * x)));

export default {
  type: 'marimbondo',
  name: 'Marimbondo',
  inspiredBy: 'Dunlop Fuzz Face',
  category: 'drive',
  look: { style: 'stomp', body: '#c62828', ink: '#f3e9d2', accent: '#f3e9d2', subtitle: 'Fuzz', led: '#3aa0ff' },
  controls: [
    { id: 'volume', label: 'VOLUME', default: 5 },
    { id: 'fuzz', label: 'FUZZ', default: 7 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    // A entrada de baixa impedância do Fuzz Face tira um pouco do grave antes de saturar.
    const hp = biquad(ctx, 'highpass', 90, 0.7);
    const gain = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = fuzzCurve;
    shaper.oversample = '4x';
    const dcBlock = biquad(ctx, 'highpass', 20, 0.7);
    const lp = biquad(ctx, 'lowpass', 4500, 0.6);
    const vol = ctx.createGain();
    bp.input.connect(hp).connect(gain).connect(shaper).connect(dcBlock).connect(lp).connect(vol).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      smooth(ctx, gain.gain, dbToGain(8 + p.fuzz * 3.4));
      smooth(ctx, vol.gain, dbToGain(-32 + p.volume * 3.4));
    };
    apply();
    return {
      input: bp.input,
      output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { bp.output.disconnect(); },
    };
  },
};
