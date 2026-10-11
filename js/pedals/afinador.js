// Afinador inspirado no Boss TU-3. Ligado, corta o som (modo MUTE) ou deixa passar (THRU).
import { smooth } from './common.js';
import { detectPitch } from '../audio/pitch.js';

const REFS = ['438', '439', '440', '441', '442', '443', '444', '445'];

export default {
  type: 'afinador',
  name: 'Afinador',
  inspiredBy: 'Boss TU-3',
  category: 'tuner',
  defaultOn: false,
  look: {
    style: 'compact', display: 'tuner', body: '#2f4f7f', ink: '#e8eef7', strip: '#151515', stripInk: '#cfe0f5',
    subtitle: 'Chromatic Tuner', led: '#ff3b30',
  },
  controls: [
    { id: 'mode', label: 'MODE', type: 'select', options: ['MUTE', 'THRU'], default: 0 },
    { id: 'ref', label: 'REF', type: 'select', options: REFS, default: 2 },
  ],

  create(ctx, env) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    input.connect(analyser);
    input.connect(output);
    const buf = new Float32Array(analyser.fftSize);
    const p = { ...env.params };
    let on = false;
    const apply = () => smooth(ctx, output.gain, on && p.mode === 0 ? 0 : 1, 0.005);
    apply();

    return {
      input, output,
      ref: () => +REFS[p.ref],
      // Leitura atual em Hz (ou null). O app chama algumas vezes por segundo enquanto o afinador está ligado.
      read() {
        analyser.getFloatTimeDomainData(buf);
        return detectPitch(buf, ctx.sampleRate);
      },
      set(id, v) { p[id] = v; apply(); },
      setOn(v) { on = v; apply(); },
      dispose() { output.disconnect(); },
    };
  },
};
