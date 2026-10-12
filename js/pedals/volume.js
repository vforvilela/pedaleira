// Pedal de volume inspirado no Ernie Ball VP Jr: curva de áudio (log) e volume mínimo ajustável.
// Arraste o pedal, ou ligue um pedal de expressão MIDI. Desligado, passa o som inteiro.
import { Bypass, smooth } from './common.js';

export default {
  type: 'volume',
  name: 'Volume',
  inspiredBy: 'Ernie Ball VP Jr',
  category: 'volume',
  look: { style: 'treadle', body: '#1f1f1f', ink: '#d9d9d9', accent: '#d9d9d9', plate: 'Volume', subtitle: 'VOLUME', led: '#ff3b30' },
  controls: [
    { id: 'level', label: 'PEDAL', default: 10 },
    { id: 'min', label: 'MIN', default: 0 },
  ],

  create(ctx, env) {
    const bp = new Bypass(ctx);
    const vol = ctx.createGain();
    bp.input.connect(vol).connect(bp.wet);
    const p = { ...env.params };
    const apply = () => {
      const pos = p.min / 10 + (1 - p.min / 10) * (p.level / 10);
      smooth(ctx, vol.gain, pos ** 2.5, 0.01);
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
