// Estado da pedaleira, áudio de cada bloco e ações básicas (ligar, girar, tap) usadas por todos os módulos.
import { Engine } from './audio/engine.js';
import { DEFAULT_CHAIN, byType, defaultParams } from './pedals/index.js';
import { deleteFile, getFile, loadState, saveState } from './store.js';
import { FACTORY_VERSION, factoryPresets } from './factory.js';

export const $ = id => document.getElementById(id);
export const engine = new Engine();
export const uid = () => Math.random().toString(36).slice(2, 10);
export const SCENES = 4, SCENE_NAMES = ['A', 'B', 'C', 'D'];

// ---------- Estado ----------

export function newBlock(type) {
  const def = byType[type];
  return { uid: uid(), type, on: def.defaultOn !== false, params: defaultParams(def), files: {}, scenes: Array(SCENES).fill(null) };
}

// Completa um bloco salvo com os padrões do pedal (o pedal pode ter ganhado controles novos).
export const normalizeBlock = b => ({
  uid: b.uid, type: b.type, on: b.on !== false,
  params: { ...defaultParams(byType[b.type]), ...b.params },
  files: Object.fromEntries(Object.entries(b.files || {}).map(([k, f]) => [k, { ...f, key: f.key || `${b.uid}:${k}` }])),
  scenes: Array.from({ length: SCENES }, (_, i) => normalizeScene(b.scenes?.[i], b.type)),
});

// scenes[i] de um pedal: null (fora da cena i) ou { on, params } (ligado/desligado e posição dos botões).
// Versões antigas guardavam só true/false.
function normalizeScene(s, type) {
  if (typeof s === 'boolean') return { on: s, params: null };
  if (!s || typeof s !== 'object') return null;
  return { on: !!s.on, params: s.params ? { ...defaultParams(byType[type]), ...s.params } : null };
}

// O pedal está como a cena i manda? (true também quando ele está fora da cena)
export function sceneMatches(b, i) {
  const s = b.scenes[i];
  if (!s) return true;
  return s.on === b.on && (!s.params || Object.keys(s.params).every(k => s.params[k] === b.params[k]));
}

export const sameScene = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const normalizeChain = chain => chain.filter(b => byType[b.type]).map(normalizeBlock);

export const saved = loadState();
export const state = {
  master: saved?.master ?? -6,
  inputGain: saved?.inputGain ?? 0,
  measuredMs: saved?.measuredMs ?? null,
  // Quem já usava o app antes do cartão de primeiros passos não precisa vê-lo.
  introDone: saved ? saved.introDone ?? true : false,
  deviceId: saved?.deviceId ?? '',
  inputChannel: saved?.inputChannel ?? 'auto',
  chain: normalizeChain(saved?.chain || DEFAULT_CHAIN.map(newBlock)),
  presets: (saved?.presets || []).map(p => ({ name: p.name, chain: normalizeChain(p.chain) })),
  preset: saved?.preset ?? null,
  factory: saved?.factory ?? 0,
  // Rascunhos: mudanças não salvas por preset ('' = sem preset).
  drafts: Object.fromEntries(Object.entries(saved?.drafts || {}).map(([k, c]) => [k, normalizeChain(c)])),
  midi: saved?.midi || [],
};
// Presets de fábrica que a pessoa ainda não tem (pelo nome: um preset dela com o mesmo nome fica).
if (state.factory < FACTORY_VERSION) {
  const add = factoryPresets().filter(f => !state.presets.some(p => p.name === f.name));
  state.presets.push(...add.map(p => ({ name: p.name, chain: normalizeChain(p.chain) })));
  state.factory = FACTORY_VERSION;
}

// Quem precisa reagir a qualquer mudança (asterisco do preset, botões de cena) se inscreve aqui.
export const changeListeners = [];
export const save = () => { saveState(state); for (const f of changeListeners) f(); };
export const snapshot = chain => JSON.parse(JSON.stringify(chain));

// Um arquivo (.nam, IR) só sai do IndexedDB quando nem a pedaleira nem algum preset usa mais.
export function releaseFile(key) {
  const used = [state.chain, ...state.presets.map(p => p.chain), ...Object.values(state.drafts)]
    .some(chain => chain.some(b => Object.values(b.files).some(f => f.key === key)));
  if (!used) deleteFile(key);
}

// Partes que não vão para o armazenamento: definição, áudio e vista de cada bloco.
export const live = new Map(); // uid → { def, audio, view }

// ---------- Áudio ----------

export function createAudio(block) {
  const l = live.get(block.uid);
  l.audio = l.def.create(engine.ctx, { params: { ...block.params }, wasmBytes: engine.wasmBytes });
  l.audio.setOn(block.on);
  l.audio.onState?.(s => { l.view?.setState(s, l.def.stateLabels?.[s]); for (const f of changeListeners) f(); });
}

export function reconnect() {
  if (!engine.running) return;
  engine.connectChain(state.chain.map(b => live.get(b.uid)));
}

export async function applyStoredFiles(block) {
  for (const kind of Object.keys(block.files)) {
    const data = await getFile(block.files[kind].key);
    if (data === undefined) { delete block.files[kind]; continue; }
    await loadIntoAudio(block, kind, data, block.files[kind].name);
  }
  live.get(block.uid).view.update();
}

export async function loadIntoAudio(block, kind, data, name) {
  const audio = live.get(block.uid)?.audio;
  if (!audio) return;
  try {
    const info = await audio.loadFile(kind, data);
    const engineName = info?.engine === 'js' ? ' (motor JS, mais pesado)' : '';
    if (info?.sampleRate && info.sampleRate !== engine.ctx.sampleRate)
      status(`${name}: captura feita a ${info.sampleRate} Hz, o áudio está a ${engine.ctx.sampleRate} Hz. O som pode mudar.`, true);
    else status(`${name} carregado${engineName}.`);
  } catch (err) {
    status(`Não consegui carregar ${name}: ${err.message}`, true);
    const key = block.files[kind]?.key;
    delete block.files[kind];
    if (key) releaseFile(key);
    save();
  }
}

export function status(msg, err = false) {
  const s = $('status');
  s.textContent = s.title = msg; // no tablet a linha é uma só: a mensagem inteira fica no title e num toque
  s.classList.toggle('err', err);
}

// ---------- Tap tempo ----------

export const taps = new Map(); // uid → tempos dos últimos toques (ms)
export function tapTempo(block) {
  const def = byType[block.type];
  if (!def.tap) return;
  const now = performance.now();
  const t = (taps.get(block.uid) || []).filter(x => now - x < 2500);
  t.push(now);
  taps.set(block.uid, t.slice(-4));
  if (t.length < 2) { status(`${def.name}: toque mais uma vez no ritmo.`); return; }
  const gaps = t.slice(1).map((x, i) => x - t[i]);
  const sec = gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000;
  const v = Math.round(Math.max(0, Math.min(10, def.tap.fromSeconds(sec))) * 10) / 10;
  setParam(block, def.tap.param, v);
  status(`${def.name}: ${Math.round(sec * 1000)} ms (${Math.round(60 / sec)} BPM).`);
}

export function setParam(block, id, v) {
  block.params[id] = v;
  const l = live.get(block.uid);
  l?.audio?.set(id, v);
  l?.view?.update();
  save();
}

export function toggleBlock(block) {
  const l = live.get(block.uid);
  // Pedais com pisada própria (looper): a pisada vai para o pedal, ele não liga nem desliga.
  if (l?.def.press) {
    if (l.audio) l.audio.press();
    else status(`${l.def.name}: clique em Ligar primeiro.`);
    return;
  }
  block.on = !block.on;
  l?.audio?.setOn(block.on);
  l?.view?.update();
  save();
}

export function blockByUid(id) { return state.chain.find(b => b.uid === id); }
// O alvo de um evento pode ser o próprio document (sem closest).
export const closest = (e, sel) => (e.target instanceof Element ? e.target.closest(sel) : null);

// Aviso no rodapé com um botão de ação.
let toastTimer = 0;
export function toast(msg, action, fn) {
  const t = $('toast');
  t.querySelector('span').textContent = msg;
  const b = t.querySelector('button');
  b.textContent = action;
  b.onclick = fn;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 10000);
}
export function hideToast() { $('toast').hidden = true; }

