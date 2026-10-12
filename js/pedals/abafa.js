// Fuzz inspirado no Electro-Harmonix Big Muff Pi: dois estágios de clipagem por diodo em série
// (sustentação longa, parede de fuzz) e um tom que mistura um passa-baixa e um passa-alta,
// com o famoso buraco nos médios no meio do giro.
import { Bypass, biquad, curve, dbToGain, smooth } from './common.js';

const soft = curve(x => Math.tanh(4 * x) / Math.tanh(4));

export default {
  type: 'abafa',
  name: 'Abafa',
  inspiredBy: 'Electro-Harmonix Big Muff Pi',
  category: 'drive',
  look: { style: 'stomp', body: '#d8d6cf', ink: '#b3261e', accent: '#1c1c1c', subtitle: 'Sustain Fuzz', led: '#ff3b30' },
  controls: [
    { id: 'volume', label: 'VOLUME', default: 5 },
    { id: 'tone', label: 'TONE', default: 5 },
    { id: 'sustain', label: 'SUSTAIN', default: 6 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const pre = biquad(ctx, 'highpass', 100, 0.7);
    const g1 = ctx.createGain();
    const clip1 = ctx.createWaveShaper();
    clip1.curve = soft; clip1.oversample = '4x';
    // Entre os estágios, capacitores tiram agudo e grave: o fuzz fica grosso, sem chiar.
    const mid1 = biquad(ctx, 'lowpass', 3500, 0.7);
    const mid2 = biquad(ctx, 'highpass', 120, 0.7);
    const g2 = ctx.createGain();
    g2.gain.value = dbToGain(18);
    const clip2 = ctx.createWaveShaper();
    clip2.curve = soft; clip2.oversample = '4x';
    // Tom: passa-baixa (~600 Hz) e passa-alta (~1,5 kHz) misturados pelo potenciômetro.
    const lp = biquad(ctx, 'lowpass', 600, 0.7);
    const hp = biquad(ctx, 'highpass', 1500, 0.7);
    const lpG = ctx.createGain(), hpG = ctx.createGain();
    const vol = ctx.createGain();
    bp.input.connect(pre).connect(g1).connect(clip1).connect(mid1).connect(mid2).connect(g2).connect(clip2);
    clip2.connect(lp).connect(lpG).connect(vol);
    clip2.connect(hp).connect(hpG).connect(vol);
    vol.connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      smooth(ctx, g1.gain, dbToGain(6 + p.sustain * 3.6));
      const t = p.tone / 10;
      // O passa-alta perde mais nível no circuito real: compensado para o giro não mudar o volume.
      smooth(ctx, lpG.gain, 1 - t);
      smooth(ctx, hpG.gain, t * 1.8);
      smooth(ctx, vol.gain, dbToGain(-38 + p.volume * 3.8));
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
