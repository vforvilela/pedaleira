// Reverb prateado inspirado no TC Electronic Hall of Fame 2.
// Convolução com resposta ao impulso gerada na hora. Desligar corta só a entrada (trails).
import { ROOMS, makeIR } from '../audio/reverb-ir.js';
import { biquad, logMap, smooth } from './common.js';

const ROOM_NAMES = Object.keys(ROOMS);

export default {
  type: 'salao',
  name: 'Salão',
  inspiredBy: 'TC Electronic Hall of Fame 2',
  category: 'time',
  look: {
    style: 'stomp', body: '#c9ccd1', ink: '#202225', accent: '#c8102e', subtitle: 'Reverb', led: '#3aa0ff',
  },
  controls: [
    { id: 'decay', label: 'DECAY', default: 5 },
    { id: 'room', label: 'TYPE', type: 'select', options: ROOM_NAMES, default: 1 },
    { id: 'tone', label: 'TONE', default: 6 },
    { id: 'level', label: 'LEVEL', default: 4 },
  ],

  create(ctx, env) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    input.connect(output);

    const send = ctx.createGain();
    const hp = biquad(ctx, 'highpass', 120, 0.7);
    const tone = biquad(ctx, 'lowpass', 6000, 0.5);
    const wet = ctx.createGain();
    input.connect(send).connect(hp);
    tone.connect(wet).connect(output);

    // Dois convolvers: a IR nova entra no que está mudo e os dois trocam com crossfade,
    // senão a troca de buffer estala ao girar DECAY ou TYPE.
    const slots = [0, 1].map(() => {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      hp.connect(conv).connect(gain).connect(tone);
      return { conv, gain };
    });
    let active = 1;

    const p = { ...env.params };
    let irKey = '', irTimer = 0;
    const buildIR = () => {
      const key = `${p.room}:${p.decay}`;
      if (key === irKey) return;
      irKey = key;
      const ir = makeIR(ctx.sampleRate, ROOM_NAMES[p.room], p.decay);
      const buf = ctx.createBuffer(2, ir.length, ctx.sampleRate);
      ir.channels.forEach((c, i) => buf.copyToChannel(c, i));
      const next = slots[1 - active], prev = slots[active];
      next.conv.buffer = buf;
      smooth(ctx, next.gain.gain, 1, 0.08);
      smooth(ctx, prev.gain.gain, 0, 0.08);
      active = 1 - active;
    };
    const apply = () => {
      smooth(ctx, tone.frequency, logMap(p.tone, 1500, 14000));
      smooth(ctx, wet.gain, Math.pow(p.level / 10, 1.5) * 1.6);
      // Gerar a IR custa alguns ms: espera o botão parar de girar.
      clearTimeout(irTimer);
      irTimer = setTimeout(buildIR, 120);
    };
    buildIR();
    apply();

    return {
      input, output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => smooth(ctx, send.gain, on ? 1 : 0, 0.004),
      dispose() { clearTimeout(irTimer); output.disconnect(); },
    };
  },
};
