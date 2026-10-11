// Delay digital branco inspirado no Boss DD-8.
// Modos: STD (repetições limpas), ANLG (repetições escuras e levemente saturadas), MOD (repetições com chorus).
// Desligar o pedal corta só a entrada do delay: as repetições terminam naturalmente (trails).
import { biquad, curve, logMap, smooth } from './common.js';

const MODES = {
  STD: { lp: 12000, hp: 40, depth: 0 },
  ANLG: { lp: 2600, hp: 160, depth: 0.0004 },
  MOD: { lp: 7000, hp: 80, depth: 0.0025 },
};

// Saturação suave na realimentação: quase linear em volume baixo, segura a auto-oscilação.
const loopClip = curve(x => Math.tanh(1.2 * x) / 1.2);

export default {
  type: 'eco-8',
  name: 'Eco 8',
  inspiredBy: 'Boss DD-8',
  category: 'time',
  look: {
    style: 'compact', body: '#f3f2ec', ink: '#2b2b2b', strip: '#151515', stripInk: '#f3f2ec',
    subtitle: 'Digital Delay', led: '#ff3b30',
  },
  // Tap tempo: segundos entre toques → posição do D.TIME (20 ms a 2 s, escala log).
  tap: { param: 'time', fromSeconds: s => (10 * Math.log(s / 0.02)) / Math.log(100) },
  controls: [
    { id: 'level', label: 'E.LEVEL', default: 4 },
    { id: 'feedback', label: 'F.BACK', default: 4 },
    { id: 'time', label: 'D.TIME', default: 5 },
    { id: 'mode', label: 'MODE', type: 'select', options: Object.keys(MODES), default: 0 },
  ],

  create(ctx, env) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    input.connect(output); // seco sempre passa

    const send = ctx.createGain();
    const sum = ctx.createGain();
    const delay = ctx.createDelay(2.1);
    const hp = biquad(ctx, 'highpass', 40, 0.7);
    const lp = biquad(ctx, 'lowpass', 12000, 0.7);
    const clip = ctx.createWaveShaper();
    clip.curve = loopClip;
    const fb = ctx.createGain();
    const wet = ctx.createGain();

    input.connect(send).connect(sum).connect(delay).connect(hp).connect(lp).connect(clip);
    clip.connect(fb).connect(sum);
    clip.connect(wet).connect(output);

    // LFO para o modo MOD (e um leve wow no ANLG).
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.7;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();

    const p = { ...env.params };
    const apply = () => {
      const m = MODES[Object.keys(MODES)[p.mode]] || MODES.STD;
      smooth(ctx, delay.delayTime, logMap(p.time, 0.02, 2.0), 0.06);
      smooth(ctx, fb.gain, Math.min(1.05, (p.feedback / 10) * 1.05));
      smooth(ctx, wet.gain, (p.level / 10) * 1.2);
      smooth(ctx, lp.frequency, m.lp);
      smooth(ctx, hp.frequency, m.hp);
      smooth(ctx, depth.gain, m.depth);
    };
    apply();

    return {
      input, output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => smooth(ctx, send.gain, on ? 1 : 0, 0.004),
      dispose() { lfo.stop(); output.disconnect(); },
    };
  },
};
