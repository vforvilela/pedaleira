// Estado da pedaleira, áudio de cada bloco e ações básicas (ligar, girar, tap) usadas por todos os módulos.
import { Engine } from './audio/engine.js';
import { byType } from './pedals/index.js';
import { uid, SCENES, SCENE_NAMES, newBlock, normalizeBlock, normalizeChain, sceneMatches, sameScene, sameChain, withScene, chainDirty, safeUrl, SCHEMA_VERSION, migrateState } from './chain.js';
import { deleteFile, getFile, loadState, saveState } from './store.js';
import { FACTORY_VERSION, factoryPresets } from './factory.js';
import { DICTS, t } from './i18n.js';

export const $ = id => document.getElementById(id);
export const engine = new Engine();
export { uid, SCENES, SCENE_NAMES, newBlock, normalizeBlock, normalizeChain, sceneMatches, sameScene, sameChain, withScene, chainDirty, safeUrl, SCHEMA_VERSION };

// ---------- Estado ----------

export const saved = loadState();
export const state = migrateState(saved, { factory: factoryPresets(), factoryVersion: FACTORY_VERSION });

// Quem precisa reagir a qualquer mudança (asterisco do preset, botões de cena) se inscreve aqui.
export const changeListeners = [];
let saveTimer = 0, storageWarned = false;
export const save = () => {
  clearTimeout(saveTimer); saveTimer = 0;
  if (!saveState(state) && !storageWarned) { storageWarned = true; status(t('core.saveFailed'), true); }
  for (const f of changeListeners) f();
};
// Para o arraste de um botão: salva e avisa quem escuta só quando a mão para (ou a página sai),
// em vez de serializar o estado e refazer a tela a cada pixel.
export const saveSoon = () => { if (!saveTimer) saveTimer = setTimeout(save, 150); };
export const flushSave = () => { if (saveTimer) save(); };
globalThis.addEventListener?.('pagehide', flushSave);
globalThis.document?.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') flushSave(); });
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
    const heavy = info?.engine === 'js';
    if (info?.sampleRate && info.sampleRate !== engine.ctx.sampleRate)
      status(t('core.rateMismatch', { name, rate: info.sampleRate, ctxRate: engine.ctx.sampleRate }), true);
    else status(t(heavy ? 'core.loadedJs' : 'core.loaded', { name }));
  } catch (err) {
    const msg = err.code && `core.nam.${err.code}` in DICTS.pt ? t(`core.nam.${err.code}`, { detail: err.detail || '' }) : err.message;
    status(t('core.loadFailed', { name, msg }), true);
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
  const times = (taps.get(block.uid) || []).filter(x => now - x < 2500);
  times.push(now);
  taps.set(block.uid, times.slice(-4));
  if (times.length < 2) { status(t('core.tapAgain', { name: def.name })); return; }
  const gaps = times.slice(1).map((x, i) => x - times[i]);
  const sec = gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000;
  const v = Math.round(Math.max(0, Math.min(10, def.tap.fromSeconds(sec))) * 10) / 10;
  setParam(block, def.tap.param, v);
  status(t('core.tapTempo', { name: def.name, ms: Math.round(sec * 1000), bpm: Math.round(60 / sec) }));
}

export function setParam(block, id, v) {
  block.params[id] = v;
  const l = live.get(block.uid);
  l?.audio?.set(id, v);
  l?.view?.update();
  saveSoon();
}

export function toggleBlock(block) {
  const l = live.get(block.uid);
  // Pedais com pisada própria (looper): a pisada vai para o pedal, ele não liga nem desliga.
  if (l?.def.press) {
    if (l.audio) l.audio.press();
    else status(t('core.turnOnFirst', { name: l.def.name }));
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
  const box = $('toast');
  box.querySelector('span').textContent = msg;
  const b = box.querySelector('button');
  b.textContent = action;
  b.onclick = fn;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 10000);
}
export function hideToast() { $('toast').hidden = true; }

