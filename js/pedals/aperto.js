// Compressor azul inspirado no Boss CS-3: segura o volume, dá sustain ao solo e ataque à base.
import { Bypass, biquad, logMap, monoWorklet, smooth } from './common.js';

export default {
  type: 'aperto',
  name: 'Aperto',
  inspiredBy: 'Boss CS-3',
  category: 'comp',
  look: {
    style: 'compact', body: '#4a9fd8', ink: '#0d2235', strip: '#151515', stripInk: '#8cc8f0',
    subtitle: 'Compressor', led: '#ff3b30',
  },
  controls: [
    { id: 'level', label: 'LEVEL', default: 5 },
    { id: 'tone', label: 'TONE', default: 5 },
    { id: 'attack', label: 'ATTACK', default: 5 },
    { id: 'sustain', label: 'SUSTAIN', default: 5 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const comp = monoWorklet(ctx, 'comp');
    const tone = biquad(ctx, 'highshelf', 2500, 0.7, 0);
    bp.input.connect(comp).connect(tone).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      const threshold = -12 - p.sustain * 3.6; // -12 a -48 dB
      const ratio = 3 + p.sustain * 1.2;       // 3:1 a 15:1
      comp.port.postMessage({
        threshold, ratio,
        // ATTACK para a direita deixa passar mais da palhetada antes de comprimir.
        attack: logMap(p.attack, 0.0005, 0.04),
        release: 0.25,
        // Repõe metade do que a compressão tira, mais o LEVEL.
        makeup: -threshold * (1 - 1 / ratio) * 0.5 - 12 + p.level * 2.4,
      });
      smooth(ctx, tone.gain, (p.tone - 5) * 2.4);
    };
    apply();
    return {
      input: bp.input,
      output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      dispose() { bp.output.disconnect(); comp.disconnect(); },
    };
  },
};
