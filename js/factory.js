// Presets de fábrica: quem abre o app pela primeira vez já tem sons prontos para tocar, todos com o amp
// interno (nada para baixar). Quem já usava ganha os que ainda não tem, uma vez por versão desta lista.
import { SCENES, newBlock } from './chain.js';
import { DICTS, t } from './i18n.js';

export const FACTORY_VERSION = 2;

// [tipo, parâmetros, ligado? (null: como o pedal vem), cenas] — cenas: { A: on/off, B: on/off, ... } (letras ausentes: fora da cena).
const P = (type, params = {}, on = null, scenes = null) => ({ type, params, on, scenes });
const LETTERS = ['A', 'B', 'C', 'D'];

const SPEC = [
  { key: 'presets.factoryClean', chain: [
    P('afinador'),
    P('aperto', { level: 5, sustain: 4, attack: 6 }),
    P('amp', { gain: 2.5, bass: 5, mid: 4.5, treble: 6.5, volume: 6 }),
    P('coro', { rate: 3, depth: 5 }),
    P('salao', { room: 1, decay: 5, level: 3.5 }),
  ] },
  // Cena A: base com o drive; B: solo com boost e delay.
  { key: 'presets.factoryCrunch', chain: [
    P('afinador'),
    P('turbo', { boost: 4, bright: 0 }, false, { A: false, B: true }),
    P('sol-drive', { drive: 4, tone: 6, level: 6 }),
    P('amp', { gain: 5, bass: 5, mid: 6, treble: 6, volume: 5 }),
    P('eco-8', { level: 3.5, feedback: 3, time: 6.4, mode: 1 }, false, { A: false, B: true }),
    P('salao', { room: 0, decay: 4, level: 3 }),
  ] },
  { key: 'presets.factoryLead', chain: [
    P('afinador'),
    P('sol-drive', { drive: 6, tone: 6, level: 6.5 }),
    P('amp', { gain: 7, bass: 5, mid: 7, treble: 6, volume: 4.5 }),
    P('silencio', { thres: 4, decay: 4 }),
    P('eco-8', { level: 4, feedback: 4, time: 6.8, mode: 2 }),
    P('salao', { room: 1, decay: 5, level: 3 }),
  ] },
  { key: 'presets.factoryFuzz60s', chain: [
    P('afinador'),
    P('ua', { mode: 1, q: 6 }, false),
    P('marimbondo', { fuzz: 8, volume: 5 }),
    P('amp', { gain: 3.5, bass: 5, mid: 5, treble: 6, volume: 5 }),
    P('ondas', { wave: 3, rate: 5, depth: 5 }, false),
    P('salao', { room: 3, decay: 5, level: 4 }),
  ] },
  { key: 'presets.factoryDist80s', chain: [
    P('afinador'),
    P('ratazana', { dist: 6, filter: 4, volume: 5 }),
    P('silencio', { thres: 4, decay: 3 }),
    P('amp', { gain: 4, bass: 5.5, mid: 6, treble: 5.5, volume: 5 }),
    P('eco-8', { level: 3, feedback: 3, time: 6.6, mode: 1 }, false),
    P('salao', { room: 0, decay: 4, level: 3 }),
  ] },
  { key: 'presets.factoryFuzzWall', chain: [
    P('afinador'),
    P('abafa', { sustain: 7, tone: 4.5, volume: 5 }),
    P('amp', { gain: 3.5, bass: 5.5, mid: 5, treble: 5.5, volume: 5 }),
    P('eco-8', { level: 3.5, feedback: 4, time: 6.9, mode: 1 }),
    P('salao', { room: 1, decay: 6, level: 4 }),
  ] },
  { key: 'presets.factoryAmbient', chain: [
    P('afinador'),
    P('aperto', { level: 5, sustain: 6 }),
    P('amp', { gain: 3, bass: 5, mid: 4, treble: 6.5, volume: 5.5 }),
    P('volume', { level: 10, min: 0 }),
    P('eco-8', { level: 5, feedback: 6, time: 6.8, mode: 3 }),
    P('salao', { room: 4, decay: 8, level: 6, tone: 5 }),
  ] },
];

// O nome sai no idioma de quem abre o app (fica gravado assim nos presets dele). aliases: o mesmo nome em
// todos os idiomas, para reconhecer um preset de fábrica criado quando o app estava em outro idioma.
export const factoryPresets = () => SPEC.map(({ key, chain }) => ({
  name: t(key),
  aliases: [...new Set(Object.values(DICTS).map(d => d[key]).filter(Boolean))],
  chain: chain.map(({ type, params, on, scenes }) => {
    const b = newBlock(type);
    Object.assign(b.params, params);
    if (on !== null) b.on = on;
    if (scenes) b.scenes = Array.from({ length: SCENES }, (_, i) => (LETTERS[i] in scenes ? { on: scenes[LETTERS[i]], params: null } : null));
    return b;
  }),
}));

