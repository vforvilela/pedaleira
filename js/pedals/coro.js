// Chorus azul-claro inspirado no Boss CE-2: um eco curtíssimo que oscila e se soma ao som limpo.
// Em estéreo, como o CE-2 com duas saídas: o lado direito oscila ao contrário do esquerdo.
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
    const dry = ctx.createGain();
    dry.gain.value = 0.75;
    const merge = ctx.createChannelMerger(2);
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    const depth = ctx.createGain(), inverted = ctx.createGain();
    lfo.connect(depth);
    depth.connect(inverted);
    inverted.gain.value = -1;
    [depth, inverted].forEach((mod, side) => {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = 0.008;
      const dark = biquad(ctx, 'lowpass', 5500, 0.6); // o BBD do CE-2 é escuro
      const wet = ctx.createGain();
      wet.gain.value = 0.7;
      mod.connect(delay.delayTime);
      bp.input.connect(delay).connect(dark).connect(wet);
      wet.connect(merge, 0, side);
      bp.input.connect(dry);
      dry.connect(merge, 0, side);
    });
    merge.connect(bp.wet);
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
