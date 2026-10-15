// A cadeia de pedais como dado puro: blocos, cenas, comparação e a leitura do estado salvo.
// Sem DOM nem áudio, para os testes no Node cobrirem o que decide rascunho, cena e migração.
import { DEFAULT_CHAIN, byType, defaultParams, validParams } from './pedals/index.js';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const SCENES = 4, SCENE_NAMES = ['A', 'B', 'C', 'D'];
// Versão do estado salvo. Sobe quando a forma muda; migrateState lê qualquer versão anterior.
export const SCHEMA_VERSION = 2;

export function newBlock(type) {
  const def = byType[type];
  return { uid: uid(), type, on: def.defaultOn !== false, params: defaultParams(def), files: {}, scenes: Array(SCENES).fill(null) };
}

// Completa um bloco salvo com os padrões do pedal (o pedal pode ter ganhado controles novos) e só deixa
// passar o que faz sentido: isto é a porta de entrada do localStorage, dos links e dos arquivos importados.
const UID_RE = /^[\w-]{1,24}$/;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
// Endereços de onde um arquivo pode ser baixado: https, ou http só no próprio computador (desenvolvimento).
export const safeUrl = url => /^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

export function normalizeBlock(b) {
  const def = byType[b.type];
  const id = UID_RE.test(b.uid) ? b.uid : uid();
  const files = {};
  for (const [k, f] of Object.entries(b.files || {})) {
    if (!def.files?.[k] || !f || typeof f !== 'object') continue;
    const url = str(f.url, 2048);
    files[k] = { name: str(f.name, 60), key: str(f.key, 80) || `${id}:${k}`, ...(safeUrl(url) ? { url } : {}) };
  }
  return {
    uid: id, type: b.type, on: b.on !== false,
    params: validParams(def, b.params),
    files,
    scenes: Array.from({ length: SCENES }, (_, i) => normalizeScene(b.scenes?.[i], def)),
  };
}

// scenes[i] de um pedal: null (fora da cena i) ou { on, params } (ligado/desligado e posição dos botões).
// Versões antigas guardavam só true/false.
function normalizeScene(s, def) {
  if (typeof s === 'boolean') return { on: s, params: null };
  if (!s || typeof s !== 'object') return null;
  return { on: !!s.on, params: s.params ? validParams(def, s.params) : null };
}

export const normalizeChain = chain => (Array.isArray(chain) ? chain : []).filter(b => b && byType[b.type]).map(normalizeBlock);

// O pedal está como a cena i manda? (true também quando ele está fora da cena)
export function sceneMatches(b, i) {
  const s = b.scenes[i];
  if (!s) return true;
  return s.on === b.on && (!s.params || Object.keys(s.params).every(k => s.params[k] === b.params[k]));
}

export const sameScene = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Compara duas cadeias pelo que importa para o som (ignora a ordem das chaves).
export function sameChain(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    if (x.uid !== y.uid || x.type !== y.type || x.on !== y.on) return false;
    if (x.scenes.some((v, i) => !sameScene(v, y.scenes[i]))) return false;
    const pk = new Set([...Object.keys(x.params), ...Object.keys(y.params)]);
    for (const k of pk) if (x.params[k] !== y.params[k]) return false;
    const fk = new Set([...Object.keys(x.files), ...Object.keys(y.files)]);
    for (const k of fk) if (x.files[k]?.key !== y.files[k]?.key) return false;
    return true;
  });
}

// A cadeia salva com a cena i aplicada: trocar de cena não conta como mudança no preset.
export const withScene = (chain, i) => chain.map(b => {
  const s = b.scenes[i];
  return s ? { ...b, on: s.on, params: s.params ? { ...b.params, ...s.params } : b.params } : b;
});

// A cadeia atual difere do preset salvo por algo além de uma troca de cena?
export function chainDirty(chain, presetChain) {
  if (!presetChain || sameChain(chain, presetChain)) return false;
  return !SCENE_NAMES.some((_, i) => sameChain(chain, withScene(presetChain, i)));
}

// Lê o estado salvo (de qualquer versão, ou nenhum) e devolve o estado completo desta versão.
// factory: presets de fábrica [{ name, aliases?, chain }] e a versão dessa lista; quem ainda não tem um ganha.
export function migrateState(saved, { factory = [], factoryVersion = 0 } = {}) {
  if (!saved || typeof saved !== 'object') saved = null;
  const state = {
    schema: SCHEMA_VERSION,
    master: num(saved?.master, -6, -60, 12),
    inputGain: num(saved?.inputGain, 0, -30, 30),
    measuredMs: typeof saved?.measuredMs === 'number' ? saved.measuredMs : null,
    // Quem já usava o app antes do cartão de primeiros passos não precisa vê-lo.
    introDone: saved ? saved.introDone ?? true : false,
    // Modo simples (primeira visita): sem cenas, link, exportar, MIDI… só o que um iniciante usa.
    simple: saved ? saved.simple ?? false : true,
    // Aviso do monitor direto da interface, mostrado só na primeira vez que o som liga.
    monitorHintDone: saved?.monitorHintDone ?? false,
    // Visão do chão: o sinal corre da direita para a esquerda, como a pedaleira vista por quem pisa nela.
    floorView: saved?.floorView ?? false,
    deviceId: str(saved?.deviceId, 200),
    inputChannel: ['auto', 0, 1].includes(saved?.inputChannel) ? saved.inputChannel : 'auto',
    // Buffer de áudio pedido ao sistema (iPhone como app): menor = menos atraso, mais risco de estalo.
    bufferMs: [2.7, 5, 10, 20].includes(saved?.bufferMs) ? saved.bufferMs : 5,
    // Andamento global (BPM): TAP em qualquer lugar, o BPM do Pulso e o SYNC do Eco 8 seguem o mesmo número.
    bpm: num(saved?.bpm, 120, 40, 240),
    chain: normalizeChain(saved?.chain || DEFAULT_CHAIN.map(newBlock)),
    presets: (Array.isArray(saved?.presets) ? saved.presets : [])
      .filter(p => p && typeof p.name === 'string' && p.name)
      .map(p => ({ name: p.name.slice(0, 40), chain: normalizeChain(p.chain), ...(typeof p.bpm === 'number' ? { bpm: num(p.bpm, 120, 40, 240) } : {}) })),
    preset: typeof saved?.preset === 'string' ? saved.preset : null,
    factory: num(saved?.factory, 0, 0, 1e6),
    // Rascunhos: mudanças não salvas por preset ('' = sem preset).
    drafts: Object.fromEntries(Object.entries(saved?.drafts || {}).map(([k, c]) => [k, normalizeChain(c)])),
    midi: Array.isArray(saved?.midi) ? saved.midi.filter(m => m && typeof m.key === 'string' && m.target) : [],
  };
  if (!state.chain.length) state.chain = DEFAULT_CHAIN.map(newBlock);
  if (state.preset && !state.presets.some(p => p.name === state.preset)) state.preset = null;
  // Presets de fábrica que a pessoa ainda não tem (pelo nome: um preset dela com o mesmo nome fica).
  // Pelos nomes nos três idiomas: quem trocou de idioma não ganha cópias.
  if (state.factory < factoryVersion) {
    const add = factory.filter(f => !state.presets.some(p => (f.aliases || [f.name]).includes(p.name)));
    state.presets.push(...add.map(p => ({ name: p.name, chain: normalizeChain(p.chain) })));
    state.factory = factoryVersion;
  }
  return state;
}

const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
