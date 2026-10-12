// Wah inspirado no Dunlop Cry Baby: um filtro ressonante que varre de ~400 Hz a ~2,2 kHz conforme o pedal.
// Arraste o pedal para cima e para baixo, ou ligue um pedal de expressão MIDI (botão MIDI → toque no pedal).
// No modo AUTO (auto-wah, como um envelope filter), a força da palhetada abre o filtro e o pedal vira a sensibilidade.
import { Bypass, biquad, dbToGain, logMap, monoWorklet, smooth } from './common.js';

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
    { id: 'mode', label: 'MODE', type: 'select', options: ['PEDAL', 'AUTO'], default: 0 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const band = biquad(ctx, 'bandpass', 800, 5);
    const body = biquad(ctx, 'lowpass', 800, 1); // um pouco do grave que o Cry Baby deixa passar
    const wet = ctx.createGain(), low = ctx.createGain();
    low.gain.value = 0.2;
    bp.input.connect(band).connect(wet).connect(bp.wet);
    bp.input.connect(body).connect(low).connect(bp.wet);
    // Auto-wah: o envelope (0..1) soma até ~1,8 kHz à frequência dos filtros.
    const follow = monoWorklet(ctx, 'envelope');
    const range = ctx.createGain(), rangeLow = ctx.createGain();
    range.gain.value = 1800; rangeLow.gain.value = 1100;
    bp.input.connect(follow);
    follow.connect(range).connect(band.frequency);
    follow.connect(rangeLow).connect(body.frequency);
    const p = { ...env.params };
    const apply = () => {
      const auto = p.mode === 1;
      const f = auto ? 380 : logMap(p.pedal, 400, 2200);
      smooth(ctx, band.frequency, f, 0.01);
      smooth(ctx, body.frequency, f * 0.6, 0.01);
      smooth(ctx, range.gain, auto ? 1800 : 0);
      smooth(ctx, rangeLow.gain, auto ? 1100 : 0);
      follow.port.postMessage({ sens: logMap(p.pedal, 1, 40) });
      const q = 2.5 + p.q * 0.6;
      smooth(ctx, band.Q, q);
      smooth(ctx, wet.gain, dbToGain(4 + q));
    };
    apply();
    return {
      input: bp.input, output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { bp.output.disconnect(); follow.disconnect(); },
    };
  },
};
