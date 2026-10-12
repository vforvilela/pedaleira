// Fuzz redondo inspirado no Dunlop Fuzz Face: dois transistores, clipagem forte e assimétrica.
// Limpa quando você baixa o volume da guitarra, como o pedal (ver audio/fuzz.js).
import { Bypass, biquad, curve, dbToGain, monoWorklet, smooth } from './common.js';
import { fuzzShape } from '../audio/fuzz.js';

const fuzzCurve = curve(fuzzShape);

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
    // Ganho antes da clipagem, que cai com o nível que chega da guitarra.
    const gain = monoWorklet(ctx, 'fuzzbias');
    const shaper = ctx.createWaveShaper();
    shaper.curve = fuzzCurve;
    shaper.oversample = '4x';
    const dcBlock = biquad(ctx, 'highpass', 20, 0.7);
    const lp = biquad(ctx, 'lowpass', 4500, 0.6);
    const vol = ctx.createGain();
    bp.input.connect(hp).connect(gain).connect(shaper).connect(dcBlock).connect(lp).connect(vol).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      gain.port.postMessage({ drive: dbToGain(8 + p.fuzz * 3.4) });
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
