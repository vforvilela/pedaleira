// Tremolo verde inspirado no Boss TR-2: o volume sobe e desce no ritmo. WAVE vai de triângulo a quadrada.
import { Bypass, biquad, logMap, smooth } from './common.js';

export default {
  type: 'ondas',
  name: 'Ondas',
  inspiredBy: 'Boss TR-2',
  category: 'mod',
  look: { style: 'compact', body: '#2e8b57', ink: '#0b2416', strip: '#151515', stripInk: '#7fd3a2', subtitle: 'Tremolo', led: '#ff3b30' },
  controls: [
    { id: 'wave', label: 'WAVE', default: 3 },
    { id: 'rate', label: 'RATE', default: 5 },
    { id: 'depth', label: 'DEPTH', default: 6 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const amp = ctx.createGain();
    bp.input.connect(amp).connect(bp.wet);
    const tri = ctx.createOscillator(), sq = ctx.createOscillator();
    tri.type = 'triangle'; sq.type = 'square';
    const triG = ctx.createGain(), sqG = ctx.createGain();
    // Filtra o LFO para a quadrada não estalar.
    const soft = biquad(ctx, 'lowpass', 60, 0.7);
    const depth = ctx.createGain();
    tri.connect(triG).connect(soft);
    sq.connect(sqG).connect(soft);
    soft.connect(depth).connect(amp.gain);
    tri.start(); sq.start();
    const p = { ...env.params };
    const apply = () => {
      const hz = logMap(p.rate, 0.8, 14);
      smooth(ctx, tri.frequency, hz, 0.05);
      smooth(ctx, sq.frequency, hz, 0.05);
      smooth(ctx, triG.gain, 1 - p.wave / 10);
      smooth(ctx, sqG.gain, p.wave / 10);
      const d = p.depth / 10;
      smooth(ctx, amp.gain, 1 - d / 2);
      smooth(ctx, depth.gain, d / 2);
    };
    apply();
    return {
      input: bp.input, output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { tri.stop(); sq.stop(); bp.output.disconnect(); },
    };
  },
};
