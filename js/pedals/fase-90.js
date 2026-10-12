// Phaser laranja inspirado no MXR Phase 90: quatro estágios passa-tudo varridos por um LFO, um botão só.
import { Bypass, biquad, logMap, smooth } from './common.js';

export default {
  type: 'fase-90',
  name: 'Fase 90',
  inspiredBy: 'MXR Phase 90',
  category: 'mod',
  look: { style: 'stomp', body: '#f07a1a', ink: '#1b1006', accent: '#1b1006', subtitle: 'Phaser', led: '#ff3b30' },
  controls: [{ id: 'speed', label: 'SPEED', default: 3 }],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const stages = [0, 1, 2, 3].map(() => biquad(ctx, 'allpass', 700, 0.6));
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = wet.gain.value = 0.7;
    bp.input.connect(dry).connect(bp.wet);
    stages.reduce((a, b) => a.connect(b), bp.input).connect(wet).connect(bp.wet);
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    const sweep = ctx.createGain();
    sweep.gain.value = 550; // 150 Hz a 1,25 kHz
    lfo.connect(sweep);
    for (const s of stages) sweep.connect(s.frequency);
    lfo.start();
    const p = { ...env.params };
    const apply = () => smooth(ctx, lfo.frequency, logMap(p.speed, 0.08, 7), 0.05);
    apply();
    return {
      input: bp.input, output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { lfo.stop(); bp.output.disconnect(); },
    };
  },
};
