// Chorus azul-claro inspirado no Boss CE-2: um eco curtíssimo que oscila e se soma ao som limpo.
import { Bypass, biquad, logMap, smooth } from './common.js';

export default {
  type: 'coro',
  name: 'Coro',
  inspiredBy: 'Boss CE-2',
  category: 'mod',
  look: { style: 'compact', body: '#7fb9d9', ink: '#10283a', strip: '#151515', stripInk: '#9fd0ec', subtitle: 'Chorus', led: '#ff3b30' },
  controls: [
    { id: 'rate', label: 'RATE', default: 3 },
    { id: 'depth', label: 'DEPTH', default: 5 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.008;
    const dark = biquad(ctx, 'lowpass', 5500, 0.6); // o BBD do CE-2 é escuro
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    const dry = ctx.createGain();
    dry.gain.value = 0.75;
    bp.input.connect(dry).connect(bp.wet);
    bp.input.connect(delay).connect(dark).connect(wet).connect(bp.wet);
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    const depth = ctx.createGain();
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();
    const p = { ...env.params };
    const apply = () => {
      smooth(ctx, lfo.frequency, logMap(p.rate, 0.1, 8), 0.05);
      smooth(ctx, depth.gain, 0.0005 + p.depth * 0.0005, 0.05);
    };
    apply();
    return {
      input: bp.input, output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { lfo.stop(); bp.output.disconnect(); },
    };
  },
};
