// Metrônomo inspirado no Boss DB-90 (Dr. Beat): clique no fone junto com a guitarra, sem passar pelos
// efeitos nem pela gravação (vai pelo monitor do motor). TAP acerta o andamento; o primeiro tempo do compasso
// é mais agudo. OUT em R manda o clique só para o canal direito: guitarra em L para o PA, clique no fone.
import { monoWorklet } from './common.js';

const BEATS = ['—', '2', '3', '4', '6'];
const OUTS = ['MIX', 'R'];
export const bpmOf = v => Math.round(40 + v * 20);
// Sem arredondar a 0,1: o botão tem passo de 2 BPM, e 97 BPM precisa continuar 97.
export const knobOfBpm = bpm => Math.max(0, Math.min(10, (bpm - 40) / 20));

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
    { id: 'out', label: 'OUT', type: 'select', options: OUTS, default: 0 },
  ],

  create(ctx, env) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    input.connect(output); // a guitarra passa direto
    const node = monoWorklet(ctx, 'metro');
    // O clique sai pelo monitor (fone, fora da gravação) quando o motor oferece um; senão pela saída do pedal.
    const sink = env.monitor || output;
    const mix = ctx.createGain(), right = ctx.createGain(), merger = ctx.createChannelMerger(2);
    node.connect(mix).connect(sink);
    node.connect(right).connect(merger, 0, 1);
    merger.connect(sink);
    const p = { ...env.params };
    let first = true, on = false;
    const apply = () => {
      node.port.postMessage({ bpm: bpmOf(p.bpm), beats: +BEATS[p.beats] || 0, level: (p.level / 10) ** 2 * 0.8 });
      const r = p.out === 1;
      env.guitarLeft?.(r && on); // clique no direito: a guitarra vai somada em mono para o esquerdo
      // Na criação, o valor direto (sem rampa: senão o primeiro clique sai pelos dois caminhos); depois, suave.
      if (first) { mix.gain.value = r ? 0 : 1; right.gain.value = r ? 1 : 0; first = false; }
      else { mix.gain.setTargetAtTime(r ? 0 : 1, ctx.currentTime, 0.01); right.gain.setTargetAtTime(r ? 1 : 0, ctx.currentTime, 0.01); }
    };
    apply();
    return {
      input, output,
      set(id, v) { p[id] = v; apply(); },
      setOn(v) { on = v; node.port.postMessage({ on: v }); apply(); },
      dispose() { env.guitarLeft?.(false); output.disconnect(); node.disconnect(); mix.disconnect(); merger.disconnect(); },
    };
  },
};
