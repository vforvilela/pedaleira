// Delay digital branco inspirado no Boss DD-8.
// Modos: STD (repetições limpas), ANLG (repetições escuras e levemente saturadas), MOD (repetições com chorus),
// P.PONG (repetições alternando entre esquerda e direita, em estéreo).
// Desligar o pedal corta só a entrada do delay: as repetições terminam naturalmente (trails).
import { biquad, curve, logMap, smooth } from './common.js';

const MODES = {
  STD: { lp: 12000, hp: 40, depth: 0 },
  ANLG: { lp: 2600, hp: 160, depth: 0.0004 },
  MOD: { lp: 7000, hp: 80, depth: 0.0025 },
  'P.PONG': { lp: 10000, hp: 60, depth: 0, pingPong: true },
};

// SYNC: D.TIME segue o andamento global (TAP em qualquer lugar, ou o BPM do Pulso) na subdivisão escolhida.
export const SYNC = ['OFF', '1/4', '1/8.', '1/8', '1/8T', '1/16'];
const SYNC_BEATS = [0, 1, 0.75, 0.5, 1 / 3, 0.25];
// Tempo do delay em segundos: pela subdivisão e BPM (SYNC ligado) ou pelo botão D.TIME (20 ms a 2 s, log).
export const delaySeconds = (p, bpm) => (p.sync ? Math.min(2, Math.max(0.02, (60 / bpm) * SYNC_BEATS[p.sync])) : logMap(p.time, 0.02, 2.0));

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
  syncsTempo: true, // recebe setTempo(bpm) quando o andamento global muda
  controls: [
    { id: 'level', label: 'E.LEVEL', default: 4 },
    { id: 'feedback', label: 'F.BACK', default: 4 },
    { id: 'time', label: 'D.TIME', default: 5 },
    { id: 'mode', label: 'MODE', type: 'select', options: Object.keys(MODES), default: 0 },
    { id: 'sync', label: 'SYNC', type: 'select', options: SYNC, default: 0 },
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

    // Ping-pong: a 1ª repetição sai na esquerda, passa por um segundo atraso igual e sai na direita,
    // e só então volta para o começo. Tudo fica ligado; o modo só muda os ganhos.
    const delay2 = ctx.createDelay(2.1), into2 = ctx.createGain(), fbPP = ctx.createGain();
    const merge = ctx.createChannelMerger(2), wetL = ctx.createGain(), wetR = ctx.createGain();
    clip.connect(into2).connect(delay2).connect(fbPP).connect(sum);
    clip.connect(wetL).connect(merge, 0, 0);
    delay2.connect(wetR).connect(merge, 0, 1);
    merge.connect(output);

    // LFO para o modo MOD (e um leve wow no ANLG).
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.7;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();

    const p = { ...env.params };
    let bpm = env.bpm || 120;
    const apply = () => {
      const m = MODES[Object.keys(MODES)[p.mode]] || MODES.STD;
      const t = delaySeconds(p, bpm), f = Math.min(1.05, (p.feedback / 10) * 1.05), w = (p.level / 10) * 1.2;
      smooth(ctx, delay.delayTime, t, 0.06);
      smooth(ctx, delay2.delayTime, t, 0.06);
      const pp = !!m.pingPong;
      smooth(ctx, fb.gain, pp ? 0 : f);
      smooth(ctx, wet.gain, pp ? 0 : w);
      smooth(ctx, into2.gain, pp ? Math.max(f, 0.05) : 0);
      smooth(ctx, fbPP.gain, pp ? f : 0);
      smooth(ctx, wetL.gain, pp ? w : 0);
      smooth(ctx, wetR.gain, pp ? w : 0);
      smooth(ctx, lp.frequency, m.lp);
      smooth(ctx, hp.frequency, m.hp);
      smooth(ctx, depth.gain, m.depth);
    };
    apply();

    return {
      input, output,
      set(id, v) { p[id] = v; apply(); },
      setTempo(b) { bpm = b; apply(); },
      setOn: on => smooth(ctx, send.gain, on ? 1 : 0, 0.004),
      dispose() { lfo.stop(); output.disconnect(); },
    };
  },
};
