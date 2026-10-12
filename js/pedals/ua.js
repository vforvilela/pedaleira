// Wah inspirado no Dunlop Cry Baby: um filtro ressonante que varre de ~400 Hz a ~2,2 kHz conforme o pedal.
// Arraste o pedal para cima e para baixo, ou ligue um pedal de expressão MIDI (botão MIDI → toque no pedal).
import { Bypass, biquad, dbToGain, logMap, smooth } from './common.js';

export default {
  type: 'ua',
  name: 'Uá',
  inspiredBy: 'Dunlop Cry Baby',
  category: 'filter',
  defaultOn: false,
  look: { style: 'treadle', body: '#2a2a2a', ink: '#d9d9d9', accent: '#e23b3b', plate: 'Uá', subtitle: 'WAH', led: '#ff3b30' },
  controls: [
    { id: 'pedal', label: 'PEDAL', default: 5 },
    { id: 'q', label: 'Q', default: 5 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const band = biquad(ctx, 'bandpass', 800, 5);
    const body = biquad(ctx, 'lowpass', 800, 1); // um pouco do grave que o Cry Baby deixa passar
    const wet = ctx.createGain(), low = ctx.createGain();
    low.gain.value = 0.2;
    bp.input.connect(band).connect(wet).connect(bp.wet);
    bp.input.connect(body).connect(low).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      const f = logMap(p.pedal, 400, 2200);
      smooth(ctx, band.frequency, f, 0.01);
      smooth(ctx, body.frequency, f * 0.6, 0.01);
      const q = 2.5 + p.q * 0.6;
      smooth(ctx, band.Q, q);
      smooth(ctx, wet.gain, dbToGain(4 + q));
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
