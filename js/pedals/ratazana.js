// Distorção inspirada no ProCo RAT: um amp-op com ganho de até ~60 dB, diodos que cortam o sinal
// para o terra (clipagem dura e simétrica) e um filtro passa-baixa que escurece girando para a direita.
import { Bypass, biquad, curve, dbToGain, smooth } from './common.js';

// Diodos de silício para o terra: quase reto até o joelho, depois corta firme.
const diodes = curve(x => {
  const y = 3 * x;
  return y / Math.pow(1 + Math.pow(Math.abs(y), 2.5), 1 / 2.5);
});

export default {
  type: 'ratazana',
  name: 'Ratazana',
  inspiredBy: 'ProCo RAT',
  category: 'drive',
  look: { style: 'stomp', body: '#1c1c1c', ink: '#f2f2f2', accent: '#f2f2f2', subtitle: 'Distortion', led: '#ff3b30' },
  controls: [
    { id: 'dist', label: 'DIST', default: 5 },
    { id: 'filter', label: 'FILTER', default: 4 },
    { id: 'volume', label: 'VOLUME', default: 5 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    // O ganho do amp-op cai no grave (capacitores no laço de realimentação): o grave chega menos saturado.
    const lowCut = biquad(ctx, 'highshelf', 600, 0.7, 12);
    const pre = biquad(ctx, 'highpass', 60, 0.7);
    const gain = ctx.createGain();
    // Amp-op lento (LM308): quanto mais ganho, menos agudo ele consegue passar.
    const gbw = biquad(ctx, 'lowpass', 8000, 0.6);
    const shaper = ctx.createWaveShaper();
    shaper.curve = diodes;
    shaper.oversample = '4x';
    const filter = biquad(ctx, 'lowpass', 5000, 0.6);
    const dcBlock = biquad(ctx, 'highpass', 20, 0.7);
    const vol = ctx.createGain();
    bp.input.connect(pre).connect(lowCut).connect(gain).connect(gbw).connect(shaper)
      .connect(filter).connect(dcBlock).connect(vol).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      const g = 4 + p.dist * 5.2; // 4 a 56 dB, mais os 12 do agudo
      smooth(ctx, gain.gain, dbToGain(g - 12));
      smooth(ctx, gbw.frequency, Math.max(1800, 1e6 / dbToGain(g) * 4));
      // FILTER: 0 = aberto (~16 kHz), 10 = escuro (~500 Hz), na escala logarítmica do potenciômetro.
      smooth(ctx, filter.frequency, 16000 * Math.pow(500 / 16000, p.filter / 10));
      smooth(ctx, vol.gain, dbToGain(-37 + p.volume * 3.6));
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
