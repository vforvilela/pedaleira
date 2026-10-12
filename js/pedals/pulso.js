// Metrônomo inspirado no Boss DB-90 (Dr. Beat): clique no fone junto com a guitarra, sem passar pelos
// efeitos (fica no fim da pedaleira). TAP acerta o andamento; o primeiro tempo do compasso é mais agudo.
import { monoWorklet } from './common.js';

const BEATS = ['—', '2', '3', '4', '6'];
const bpmOf = v => Math.round(40 + v * 20);

export default {
  type: 'pulso',
  name: 'Pulso',
  inspiredBy: 'Boss DB-90',
  category: 'looper',
  defaultOn: false,
  look: { style: 'stomp', body: '#2b2f36', ink: '#e8e8e8', accent: '#f2a93b', subtitle: 'Metronome', led: '#ff3b30' },
  // Tap tempo: segundos entre toques → BPM (40 a 240).
  tap: { param: 'bpm', fromSeconds: s => (60 / s - 40) / 20 },
  controls: [
    { id: 'bpm', label: 'BPM', default: 4, show: v => `${bpmOf(v)} BPM` },
    { id: 'beats', label: 'BEAT', type: 'select', options: BEATS, default: 3 },
    { id: 'level', label: 'LEVEL', default: 5 },
  ],

  create(ctx, env) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    input.connect(output); // a guitarra passa direto
    const node = monoWorklet(ctx, 'metro');
    node.connect(output);
    const p = { ...env.params };
    const apply = () => node.port.postMessage({
      bpm: bpmOf(p.bpm), beats: +BEATS[p.beats] || 0, level: (p.level / 10) ** 2 * 0.8,
    });
    apply();
    return {
      input, output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => node.port.postMessage({ on }),
      dispose() { output.disconnect(); node.disconnect(); },
    };
  },
};
