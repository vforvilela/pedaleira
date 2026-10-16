// Estado da pedaleira, áudio de cada bloco e ações básicas (ligar, girar, tap) usadas por todos os módulos.
import { Engine } from './audio/engine.js';
import { byType } from './pedals/index.js';
import { bpmOf, knobOfBpm } from './pedals/pulso.js';
import { uid, SCENES, SCENE_NAMES, newBlock, normalizeBlock, normalizeChain, normalizePreset, normalizeSceneMeta, sceneMatches, sameScene, sameChain, withScene, chainDirty, safeUrl, SCHEMA_VERSION, migrateState } from './chain.js';
import { deleteFile, getFile, loadState, onWriteError, putFile, saveState } from './store.js';
import { fetchFile } from './files.js';
import { FACTORY_VERSION, factoryPresets } from './factory.js';
import { DICTS, t } from './i18n.js';

export const $ = id => document.getElementById(id);
export const engine = new Engine();
export { uid, SCENES, SCENE_NAMES, newBlock, normalizeBlock, normalizeChain, normalizePreset, normalizeSceneMeta, sceneMatches, sameScene, sameChain, withScene, chainDirty, safeUrl, SCHEMA_VERSION };

// ---------- Estado ----------

export const saved = loadState();
export const state = migrateState(saved, { factory: factoryPresets(), factoryVersion: FACTORY_VERSION });

// Quem precisa reagir a qualquer mudança (asterisco do preset, botões de cena) se inscreve aqui.
export const changeListeners = [];
let saveTimer = 0, storageWarned = false;
onWriteError(() => { if (!storageWarned) { storageWarned = true; status(t('core.saveFailed'), true); } });
export const save = () => {
  clearTimeout(saveTimer); saveTimer = 0;
  if (!saveState(state) && !storageWarned) { storageWarned = true; status(t('core.saveFailed'), true); }
  for (const f of changeListeners) f();
};
// Para o arraste de um botão: salva e avisa quem escuta só quando a mão para (ou a página sai),
// em vez de serializar o estado e refazer a tela a cada pixel.
export const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 150); };
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
  l.audio = l.def.create(engine.ctx, {
    params: { ...block.params }, wasmBytes: engine.wasmBytes, bpm: state.bpm, monitor: engine.monitor,
    guitarLeft: on => engine.setGuitarLeft(on),
  });
  l.audio.setOn(block.on);
  l.audio.onState?.(s => { l.view?.setState(s, l.def.stateLabels?.[s]); for (const f of changeListeners) f(); });
}

// Religa a cadeia; a promessa resolve depois da troca (ver engine.connectChain).
export function reconnect(inValley = null) {
  if (!engine.running) { inValley?.(); return Promise.resolve(); }
  return engine.connectChain(state.chain.map(b => live.get(b.uid)), inValley);
}

// Os dados do arquivo de um bloco: da memória ou do IndexedDB; se não estiver no aparelho mas tiver endereço
// (preset de fábrica, link recebido), baixa agora e guarda. undefined quando não há como obter (e o bloco perde o arquivo).
export async function fileData(block, kind) {
  const f = block.files[kind];
  if (!f) return undefined;
  let data = await getFile(f.key);
  if (data === undefined && f.url) data = await ensureFile(kind, f, true);
  // Sem dados e sem endereço não há de onde tirar: o bloco perde o arquivo. Com endereço (download falhou:
  // sem rede no palco), a referência fica e a próxima vez tenta de novo.
  if (data === undefined && !f.url) { delete block.files[kind]; save(); }
  return data;
}

// Baixa e guarda o arquivo de um endereço uma vez só: quem pedir a mesma chave enquanto baixa espera o mesmo
// download (prepareSetlist e uma troca de preset ao mesmo tempo). undefined se falhar.
const inflight = new Map();
export function ensureFile(kind, f, loud = false) {
  if (!inflight.has(f.key)) {
    const job = (async () => {
      if (loud) status(t('core.downloading', { name: f.name }));
      try {
        const data = await fetchFile(kind, f.url);
        await putFile(f.key, data);
        return data;
      } catch (err) {
        if (loud) status(t('core.downloadFailed', { name: f.name, msg: err.message }), true);
        return undefined;
      }
    })().finally(() => inflight.delete(f.key));
    inflight.set(f.key, job);
  }
  return inflight.get(f.key);
}

// Ao ligar: capturas e IRs que os presets apontam por endereço e ainda não estão no aparelho são baixados
// agora, em segundo plano, para a troca de preset no palco não depender da rede.
export async function prepareSetlist() {
  const refs = new Map(); // uma vez por chave (preset e rascunho costumam dividir o arquivo)
  for (const b of [...state.presets.flatMap(p => p.chain), ...Object.values(state.drafts).flat()])
    for (const [kind, f] of Object.entries(b.files)) if (f.url && !refs.has(f.key)) refs.set(f.key, { kind, f });
  const missing = [];
  for (const r of refs.values()) if ((await getFile(r.f.key)) === undefined) missing.push(r);
  if (!missing.length) return 0;
  // Não cobre um aviso que a pessoa precisa ler (o do fone, um erro): aí baixa calado.
  const quiet = () => $('status').classList.contains('warn') || $('status').classList.contains('err');
  if (!quiet()) status(t('core.preparing', { n: missing.length }));
  let done = 0, failed = 0;
  for (const { kind, f } of missing) ((await ensureFile(kind, f)) === undefined ? failed++ : done++);
  if (!quiet() || failed) status(t(failed ? 'core.preparedPartly' : 'core.prepared', { n: done, failed }), failed > 0);
  return done;
}

export async function applyStoredFiles(block) {
  for (const kind of Object.keys(block.files)) {
    const data = await fileData(block, kind);
    if (data !== undefined) await loadIntoAudio(block, kind, data, block.files[kind].name);
  }
  live.get(block.uid)?.view?.update(); // (o bloco pode ter saído da pedaleira enquanto carregava)
}

export async function loadIntoAudio(block, kind, data, name) {
  const audio = live.get(block.uid)?.audio;
  if (!audio) return;
  try {
    const info = await audio.loadFile(kind, data);
    if (info?.superseded) return; // outra captura entrou no meio: ela dá o próprio aviso
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

// err: vermelho e inteiro (quebra linha). warn: inteiro, sem vermelho (aviso que precisa ser lido, como o do fone).
export function status(msg, err = false, warn = false) {
  const s = $('status');
  s.textContent = s.title = msg; // no tablet a linha é uma só: a mensagem inteira fica no title e num toque
  s.classList.toggle('err', err);
  s.classList.toggle('warn', warn);
}

// ---------- Tap tempo ----------

export const taps = new Map(); // uid → tempos dos últimos toques (ms)
// Segundos entre as últimas batidas de `key` (null até a segunda batida).
function tapInterval(key) {
  const now = performance.now();
  const times = (taps.get(key) || []).filter(x => now - x < 2500);
  times.push(now);
  taps.set(key, times.slice(-4));
  if (times.length < 2) return null;
  const gaps = times.slice(1).map((x, i) => x - times[i]);
  return gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000;
}

// TAP de um pedal: acerta o botão dele (D.TIME, BPM) e o andamento global.
export function tapTempo(block) {
  const def = byType[block.type];
  if (!def.tap) return;
  const sec = tapInterval(block.uid);
  if (sec === null) { status(t('core.tapAgain', { name: def.name })); return; }
  const v = Math.round(Math.max(0, Math.min(10, def.tap.fromSeconds(sec))) * 10) / 10;
  setParam(block, def.tap.param, v);
  setTempo(60 / sec, block);
  status(t('core.tapTempo', { name: def.name, ms: Math.round(sec * 1000), bpm: Math.round(60 / sec) }));
}

// TAP global (botão de andamento, tecla T): só o andamento; quem segue é o Pulso e o Eco 8 em SYNC.
export function tapGlobal() {
  const sec = tapInterval('global');
  if (sec === null) { status(t('core.tapAgainGlobal')); return; }
  setTempo(60 / sec);
  flushSave();
  status(t('core.tempoSet', { bpm: state.bpm }));
}

// Andamento global. from: o bloco que originou a mudança (não recebe de volta). O Pulso espelha no botão BPM;
// pedais com syncsTempo recebem setTempo.
export function setTempo(bpm, from = null) {
  bpm = Math.round(Math.max(40, Math.min(240, bpm)));
  if (bpm === state.bpm) return;
  state.bpm = bpm;
  for (const b of state.chain) {
    if (b === from) continue;
    const l = live.get(b.uid);
    if (b.type === 'pulso') {
      const v = knobOfBpm(bpm);
      if (b.params.bpm !== v) { b.params.bpm = v; l?.audio?.set('bpm', v); l?.view?.update(); }
    } else if (l?.def.syncsTempo) l.audio?.setTempo?.(bpm);
  }
  saveSoon();
}

// EQ geral da saída (dB por faixa), fora dos presets.
export function setEq(band, db) {
  state.eq[band] = Math.round(Math.max(-6, Math.min(6, db)) * 2) / 2;
  engine.setEq(state.eq);
  save();
}

// Nível do preset (dB), aplicado no fim da cadeia; vai salvo com o preset.
export function setTrim(db) {
  state.trim = Math.round(Math.max(-12, Math.min(12, db)) * 2) / 2;
  engine.setTrim(state.trim);
  saveSoon(); // slider no palco: salva quando a mão para
}

// Depois de uma troca de cadeia ou cena: o andamento vem do preset (bpm salvo) ou, sem ele, do BPM do Pulso
// que está na pedaleira, para o Pulso, o Eco 8 e o Laço nunca seguirem números diferentes.
export function syncTempoFromChain(presetBpm = null) {
  if (presetBpm) { setTempo(presetBpm); return; }
  const pulso = state.chain.find(b => b.type === 'pulso');
  if (pulso) setTempo(bpmOf(pulso.params.bpm), pulso);
}

// Botão BPM do Pulso girado: o andamento global acompanha.
export function paramChanged(block, id, v) {
  if (block.type === 'pulso' && id === 'bpm') setTempo(bpmOf(v), block);
}

export function setParam(block, id, v) {
  block.params[id] = v;
  const l = live.get(block.uid);
  l?.audio?.set(id, v);
  l?.view?.update();
  paramChanged(block, id, v);
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
  // Afinador em MUTE cala a guitarra: quem não sabe acha que quebrou.
  if (block.type === 'afinador' && block.on && block.params.mode === 0) status(t('core.tunerMute'), false, true);
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

