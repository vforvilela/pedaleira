// Presets, rascunhos, exportar e importar.
import { ensureView, fetchFile, fileInput, renderBoard } from './board.js';
import { $, changeListeners, hideToast, toast, createAudio, engine, fileData, live, loadIntoAudio, setTrim, syncTempoFromChain, tapGlobal, normalizeBlock, normalizeChain, normalizePreset, normalizeSceneMeta, reconnect, releaseFile, save, snapshot, state, status, uid } from './core.js';
import { chainDirty, sameChain, withScene } from './chain.js';
import { sceneActive } from './scenes.js';
import { t } from './i18n.js';
import { saveFile } from './platform.js';
import { getFile, putFile } from './store.js';

// ---------- Presets ----------
// Mudança não salva num preset vira rascunho: trocar de preset não perde nada
// (nem quando a troca vem do pé, pelo MIDI ou pelo teclado). O * no nome indica rascunho.

export { sameChain, withScene };
export const presetByName = name => state.presets.find(p => p.name === name);
// A ordem que vale para ◀ ▶, footswitch, palco e Program Change por posição: o setlist ativo, ou todos os presets.
export const activeSetlist = () => (state.setlist === null ? null : state.setlists[state.setlist] || null);
export const activeOrder = () => {
  const sl = activeSetlist();
  return sl ? sl.order.map(presetByName).filter(Boolean) : state.presets;
};
// Preset de um Program Change: pc fixo vence; senão, a posição na ordem ativa.
export const presetForProgram = n => state.presets.find(p => p.pc === n) || activeOrder()[n] || null;
// Dicionários por nome de preset: só as chaves próprias (um preset chamado "constructor" não pega Object.prototype).
export const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
// O que um preset guarda além da cadeia.
export const presetMeta = p => ({ trim: p.trim ?? 0, sceneMeta: p.sceneMeta ?? null, bpm: p.bpm ?? null });
const currentMeta = () => ({ trim: state.trim, sceneMeta: snapshot(state.sceneMeta), bpm: state.bpm });
// Sujo: a cadeia mudou (fora uma troca de cena), o nível mudou (fora o nível de uma cena) ou as cenas mudaram
// (nome, nível, andamento). O andamento sozinho não suja: o tap vive mudando no palco.
export const isDirty = () => {
  const p = presetByName(state.preset);
  if (!p) return false;
  if (chainDirty(state.chain, p.chain)) return true;
  const saved = normalizeSceneMeta(p.sceneMeta);
  if (JSON.stringify(saved) !== JSON.stringify(state.sceneMeta)) return true;
  const trims = [p.trim ?? 0, ...saved.filter(m => typeof m?.trim === 'number').map(m => m.trim)];
  return !trims.includes(state.trim);
};
export const hasDraft = name => !!own(state.drafts, name) || (name === state.preset && isDirty());

export function renderPresets() {
  const sel = $('preset');
  const order = activeOrder(), rest = state.presets.filter(p => !order.includes(p));
  const opt = p => new Option(hasDraft(p.name) ? `${p.name} *` : p.name, p.name);
  const outside = document.createElement('optgroup');
  outside.label = t('presets.outsideSetlist');
  outside.append(...rest.map(opt));
  sel.replaceChildren(new Option(t('presets.noPreset'), ''), ...order.map(opt), ...(rest.length ? [outside] : []));
  sel.value = state.preset ?? '';
  if (document.activeElement !== $('presetName')) $('presetName').value = state.preset ?? '';
  const dirty = isDirty();
  $('presetRevert').hidden = !dirty;
  $('presetSave').classList.toggle('attention', dirty);
  renderNow(dirty);
  $('presetSave').title = dirty ? t('presets.saveTitleDirty') : t('presets.saveTitle');
}

// Nome do preset em letras grandes acima da pedaleira (o que está tocando, legível de longe).
function renderNow(dirty) {
  const order = activeOrder(), c = $('nowCount'), idx = order.findIndex(p => p.name === state.preset);
  const sl = activeSetlist();
  c.textContent = (idx >= 0 ? t('presets.countOf', { i: idx + 1, total: order.length }) : t('presets.countNone')) + (sl ? ` · ${sl.name}` : '');
  if (dirty) {
    const tag = document.createElement('span');
    tag.className = 'dirty';
    tag.textContent = t('presets.dirtyTag');
    c.append(tag);
  }
}

// Chamado depois de cada mudança: atualiza o * sem refazer a lista inteira à toa.
let lastDirty = null;
changeListeners.push(() => refreshDirty());
export function refreshDirty() {
  const d = isDirty();
  if (d === lastDirty) return;
  lastDirty = d;
  renderPresets();
}

export function savePreset() {
  const name = $('presetName').value.trim();
  if (!name) { status(t('presets.nameRequired'), true); $('presetName').focus(); return; }
  const existing = presetByName(name);
  const old = existing?.chain;
  const meta = snapshot(state.sceneMeta);
  // Nível base: com uma cena ativa no nível dela, o nível base do preset continua o que era (o da cena já está
  // guardado na cena); senão, o nível de agora.
  const active = state.sceneMeta.findIndex((m, i) => typeof m?.trim === 'number' && m.trim === state.trim && sceneActive(i));
  const trim = active >= 0 && existing ? existing.trim ?? 0 : state.trim;
  if (existing) { existing.chain = snapshot(state.chain); existing.bpm = state.bpm; existing.trim = trim; existing.sceneMeta = meta; }
  else state.presets.push({ name, chain: snapshot(state.chain), bpm: state.bpm, trim, sceneMeta: meta });
  // Salvar a partir de outro preset deixa aquele como estava salvo.
  if (state.preset !== name) { delete state.drafts[state.preset ?? '']; delete state.draftMeta[state.preset ?? '']; }
  delete state.drafts[name];
  delete state.draftMeta[name];
  state.preset = name;
  // Arquivos que só a versão antiga usava podem ser liberados.
  for (const b of old || []) for (const f of Object.values(b.files)) releaseFile(f.key);
  lastDirty = null;
  save();
  renderPresets();
  status(t('presets.saved', { name }));
}

// Apaga com 10 s para desfazer; os arquivos do preset só saem do armazenamento depois.
let deleted = null;
export function deletePresetAt(i) {
  if (i < 0 || i >= state.presets.length) return;
  finishDelete();
  const [p] = state.presets.splice(i, 1);
  // Lugar do preset em cada setlist, para o Desfazer devolver (senão o PC por posição muda no meio do show).
  const spots = state.setlists.map(l => l.order.indexOf(p.name));
  for (const l of state.setlists) l.order = l.order.filter(n => n !== p.name);
  const wasCurrent = state.preset === p.name;
  deleted = { p, i, spots, draft: own(state.drafts, p.name), draftMeta: own(state.draftMeta, p.name), wasCurrent, timer: setTimeout(finishDelete, 10000) };
  delete state.draftMeta[p.name];
  delete state.drafts[p.name];
  if (wasCurrent) state.preset = null;
  save();
  renderPresets();
  renderSetlist();
  status(t('presets.deletedStatus', { name: p.name }));
  toast(t('presets.deletedToast', { name: p.name }), t('presets.undo'), undoDelete);
}

function finishDelete() {
  if (!deleted) return;
  clearTimeout(deleted.timer);
  for (const b of deleted.p.chain) for (const f of Object.values(b.files)) releaseFile(f.key);
  deleted = null;
}

function undoDelete() {
  if (!deleted) return;
  const { p, i, spots, draft, draftMeta, wasCurrent, timer } = deleted;
  clearTimeout(timer);
  deleted = null;
  hideToast();
  let name = p.name;
  for (let n = 2; presetByName(name); n++) name = `${p.name} (${n})`;
  state.presets.splice(Math.min(i, state.presets.length), 0, { ...p, name });
  if (draft) state.drafts[name] = draft;
  if (draftMeta) state.draftMeta[name] = draftMeta;
  state.setlists.forEach((l, k) => { if (spots[k] >= 0) l.order.splice(Math.min(spots[k], l.order.length), 0, name); });
  if (wasCurrent && state.preset === null) state.preset = name;
  save();
  renderPresets();
  renderSetlist();
  status(t('presets.restored', { name }));
}

// ---------- Setlist: ordem, nomes e apagar ----------
// A ordem é a do ◀ ▶ e a do Program Change MIDI (PC 0 = primeiro).

export function renderSetlist() {
  const list = $('setlistItems');
  if (!list) return;
  const sl = activeSetlist();
  // Seletor de setlist: todos os presets, cada setlist, e os botões de criar/renomear/apagar.
  const pick = $('setlistPick');
  pick.replaceChildren(new Option(t('presets.setlistAll'), ''), ...state.setlists.map((l, i) => new Option(l.name, String(i))));
  pick.value = state.setlist === null ? '' : String(state.setlist);
  $('setlistRename').hidden = $('setlistDelete').hidden = !sl;
  $('setlistHintAll').hidden = !!sl;
  $('setlistHintOne').hidden = !sl;
  const row = (p, i, opts) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="pc"></span><input type="text" maxlength="40">
      <input type="number" class="pcfix" min="0" max="127" placeholder="PC"><button class="up">▲</button><button class="down">▼</button><button class="del">✕</button>`;
    li.querySelector('input').setAttribute('aria-label', t('presets.nameLabel'));
    li.querySelector('.pcfix').setAttribute('aria-label', t('presets.pcFixed'));
    li.querySelector('.pcfix').title = t('presets.pcFixedTitle');
    li.querySelector('.up').setAttribute('aria-label', t('presets.moveUp'));
    li.querySelector('.down').setAttribute('aria-label', t('presets.moveDown'));
    li.querySelector('.del').setAttribute('aria-label', opts.remove ? t('presets.removeFromSetlist') : t('presets.delete'));
    li.querySelector('.del').title = opts.remove ? t('presets.removeFromSetlist') : t('presets.delete');
    li.querySelector('.pc').textContent = String(i + 1);
    li.querySelector('.pc').title = p.pc !== undefined ? t('presets.pcIs', { n: p.pc }) : `Program Change ${i}`;
    const input = li.querySelector('input');
    input.value = p.name;
    input.onchange = () => renamePreset(p, input.value.trim()) || (input.value = p.name);
    const pcfix = li.querySelector('.pcfix');
    pcfix.value = p.pc ?? '';
    pcfix.onchange = () => { const v = pcfix.value === '' ? undefined : Math.max(0, Math.min(127, Math.round(+pcfix.value))); if (v === undefined) delete p.pc; else p.pc = v; save(); renderSetlist(); };
    li.querySelector('.up').disabled = i === 0;
    li.querySelector('.down').disabled = i === opts.n - 1;
    li.querySelector('.up').onclick = () => opts.move(i, -1);
    li.querySelector('.down').onclick = () => opts.move(i, 1);
    li.querySelector('.del').onclick = () => (opts.remove ? opts.remove(i) : deletePresetAt(i));
    return li;
  };
  if (!sl) {
    list.replaceChildren(...state.presets.map((p, i) => row(p, i, { n: state.presets.length, move: movePreset })));
    $('setlistOutside').hidden = true;
  } else {
    const order = activeOrder();
    const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= sl.order.length) return; [sl.order[i], sl.order[j]] = [sl.order[j], sl.order[i]]; save(); renderPresets(); renderSetlist(); };
    const remove = i => { sl.order.splice(i, 1); save(); renderPresets(); renderSetlist(); };
    list.replaceChildren(...order.map((p, i) => row(p, i, { n: order.length, move, remove })));
    // Fora do setlist: um + por preset.
    const rest = state.presets.filter(p => !order.includes(p));
    $('setlistOutside').hidden = !rest.length;
    $('setlistOutsideList').replaceChildren(...rest.map(p => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="pc"></span><span class="name"></span><button class="add-to">+</button>';
      li.querySelector('.name').textContent = p.name;
      li.querySelector('.add-to').setAttribute('aria-label', t('presets.addToSetlist', { name: p.name }));
      li.querySelector('.add-to').onclick = () => { sl.order.push(p.name); save(); renderPresets(); renderSetlist(); };
      return li;
    }));
  }
  $('setlistEmpty').hidden = state.presets.length > 0;
}

function pickSetlist(v) {
  state.setlist = v === '' ? null : +v;
  save();
  renderPresets();
  renderSetlist();
}
$('setlistPick').onchange = () => pickSetlist($('setlistPick').value);
$('setlistNew').onclick = () => {
  const name = prompt(t('presets.setlistNamePrompt'), '')?.trim().slice(0, 30);
  if (!name) return;
  state.setlists.push({ name, order: activeOrder().map(p => p.name) }); // começa com a ordem atual
  pickSetlist(String(state.setlists.length - 1));
};
$('setlistRename').onclick = () => {
  const sl = activeSetlist();
  if (!sl) return;
  const name = prompt(t('presets.setlistNamePrompt'), sl.name)?.trim().slice(0, 30);
  if (!name) return;
  sl.name = name;
  save(); renderPresets(); renderSetlist();
};
$('setlistDelete').onclick = () => {
  if (state.setlist === null) return;
  state.setlists.splice(state.setlist, 1);
  pickSetlist('');
};

function renamePreset(p, name) {
  if (!name || name === p.name) return false;
  if (presetByName(name)) { status(t('presets.nameExists', { name }), true); return false; }
  if (state.drafts[p.name]) { state.drafts[name] = state.drafts[p.name]; delete state.drafts[p.name]; }
  if (state.preset === p.name) state.preset = name;
  for (const l of state.setlists) l.order = l.order.map(n => (n === p.name ? name : n));
  p.name = name;
  save();
  renderPresets();
  renderSetlist();
  return true;
}

function movePreset(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.presets.length) return;
  [state.presets[i], state.presets[j]] = [state.presets[j], state.presets[i]];
  save();
  renderPresets();
  renderSetlist();
  $('setlistItems').children[j]?.querySelector(dir < 0 ? '.up' : '.down')?.focus();
}

$('presetOrganize').onclick = () => { renderSetlist(); $('setlist').showModal(); };
$('tempo').onclick = () => tapGlobal();
const showTempo = () => { $('tempoBpm').textContent = state.bpm; };
showTempo();
changeListeners.push(showTempo);
$('setlistClose').onclick = () => $('setlist').close();

// ---------- Compartilhar por link ----------
// O link leva a pedaleira atual (pedais, botões e cenas). Capturas .nam e IRs não cabem num link:
// para levá-las, use Exportar.

const b64url = bytes => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => fromBase64(s.replace(/-/g, '+').replace(/_/g, '/'));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// Copia sem travar a página: o navigator.clipboard pode ficar pendente ou ser negado.
function copyText(text) {
  const viaApi = !!navigator.clipboard?.writeText;
  navigator.clipboard?.writeText(text).catch(() => {});
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* sem suporte */ }
  ta.remove();
  return ok || viaApi;
}

export async function shareLink() {
  const name = state.preset || t('presets.sharedBoardName');
  // Arquivos só vão pelo endereço (os vindos de um link); os do aparelho ficam de fora.
  const chain = snapshot(state.chain).map(b => ({
    ...b,
    files: Object.fromEntries(Object.entries(b.files).filter(([, f]) => f.url).map(([k, f]) => [k, { name: f.name, url: f.url }])),
  }));
  const json = new TextEncoder().encode(JSON.stringify({ name, chain }));
  const packed = typeof CompressionStream === 'function' ? `1.${b64url(await pipe(json, new CompressionStream('deflate-raw')))}` : `0.${b64url(json)}`;
  const url = `${location.origin}${location.pathname}#p=${packed}`;
  const noFiles = state.chain.some(b => Object.values(b.files).some(f => !f.url))
    ? ` ${t('presets.linkNoFiles')}` : '';
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: name, url }); return url; } catch { /* cancelado: copia */ }
  }
  status(copyText(url) ? t('presets.linkCopied', { name }) + noFiles : t('presets.copyFailed', { url }));
  return url;
}

// Abre um link compartilhado: entra como preset novo e já fica selecionado.
export async function openSharedLink() {
  const m = location.hash.match(/^#p=([01])\.([\w-]+)$/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    let bytes = new Uint8Array(unb64url(m[2]));
    if (m[1] === '1') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    // Arquivos de um link só existem pelo endereço: a chave local é sempre nova, para um link forjado
    // não poder trocar um arquivo que já está no aparelho.
    const chain = normalizeChain((Array.isArray(doc.chain) ? doc.chain : []).map(b => ({
      ...b,
      files: Object.fromEntries(Object.entries(b?.files || {}).map(([k, f]) => [k, { name: f?.name, url: f?.url, key: `link:${uid()}` }])),
    })));
    if (!chain.length) throw new Error('vazio');
    // O mesmo link aberto de novo (arquivos comparados pelo endereço) só seleciona o preset que já existe.
    const byUrl = ch => snapshot(ch).map(b => ({ ...b, files: Object.fromEntries(Object.entries(b.files).map(([k, f]) => [k, { key: f.url || f.key }])) }));
    const same = state.presets.find(p => sameChain(byUrl(p.chain), byUrl(chain)));
    // Capturas que vieram por endereço: baixa agora; se falhar, o pedal fica sem ela (e avisa).
    const failed = [];
    if (!same) {
      for (const b of chain)
        for (const [kind, f] of Object.entries(b.files)) {
          try {
            if (!f.url) throw new Error('no-url'); // interno: cai no catch e entra na lista de falhas
            await putFile(f.key, await fetchFile(kind, f.url));
          } catch { failed.push(f.name); delete b.files[kind]; }
        }
    }
    const base = String(doc.name || t('presets.sharedDefaultName')).slice(0, 34);
    let name = same?.name || base;
    if (!same) {
      for (let n = 2; presetByName(name); n++) name = `${base} (${n})`;
      state.presets.push({ name, chain });
    }
    save();
    await applyPreset(name);
    status(t('presets.receivedByLink', { name }) + (failed.length ? ` ${t('presets.downloadFailed', { files: failed.join(', ') })}` : ''), failed.length > 0);
    return true;
  } catch {
    status(t('presets.linkBroken'), true);
    return false;
  }
}

$('presetShare').onclick = () => shareLink().catch(e => status(t('presets.linkCreateFailed', { error: e.message }), true));

// Volta o preset atual para a versão salva, descartando o rascunho.
export function revertPreset() {
  return enqueue(async () => {
    const name = state.preset;
    const p = presetByName(name);
    if (!p) return;
    delete state.drafts[name];
    delete state.draftMeta[name];
    await loadChainNow(p.chain, name, presetMeta(p));
    status(t('presets.reverted', { name }));
  });
}

// Troca de preset. O ajuste não salvo do preset atual vira rascunho dele.
export function applyPreset(name) {
  pendingPreset = name;
  return enqueue(() => applyPresetNow(name)).finally(() => { if (pendingPreset === name) pendingPreset = undefined; });
}

async function applyPresetNow(name) {
  const from = state.preset ?? '';
  if (name === from) return;
  // O que não foi salvo no preset que sai (cadeia, nível, cenas) vira rascunho dele.
  if (from === '' || isDirty()) { state.drafts[from] = snapshot(state.chain); state.draftMeta[from] = currentMeta(); }
  else { delete state.drafts[from]; delete state.draftMeta[from]; }
  const p = presetByName(name);
  const target = name === '' ? own(state.drafts, '') : own(state.drafts, name) || p?.chain;
  if (!target) { state.preset = name || null; save(); renderPresets(); return; }
  const meta = own(state.draftMeta, name) || (p ? presetMeta(p) : { trim: 0, sceneMeta: null, bpm: null });
  await loadChainNow(target, name || null, meta);
  status('');
}

// Carrega uma cadeia reaproveitando o áudio dos pedais que continuam
// (assim a troca é rápida, o delay não corta e as capturas NAM não recarregam à toa).
// Quanto tempo a cauda de cada tipo continua depois da troca de preset.
const SPILL_SECONDS = { time: 8 };
// Pedais cujo áudio passa de um preset para o outro quando os dois têm um do mesmo tipo.
const CARRY = new Set(['laco', 'pulso']);

// Trocas de preset entram numa fila: loadChain espera capturas (await) e duas execuções entrelaçadas sobre
// state.chain e live (pé rápido no footswitch, PC MIDI, setas) estourariam uma na outra.
// Tudo o que troca a cadeia (preset, reverter, link) passa por aqui, inteiro: o rascunho do preset que sai é
// tirado do estado que está de fato tocando, não do de um pedido que ainda espera a vez.
let loading = Promise.resolve();
function enqueue(fn) {
  const run = loading.then(fn);
  loading = run.catch(() => {}); // a fila segue mesmo se uma troca falhar; o erro vai para quem chamou
  return run;
}
export const loadChain = (chain, presetName, meta) => enqueue(() => loadChainNow(chain, presetName, meta));
// Resolve quando não há troca na fila (testes e quem precisa da pedaleira parada).
export const presetsIdle = () => loading;
// Destino do último pedido de troca ainda na fila: ◀ ▶ em rajada contam a partir dele, não do que está tocando.
let pendingPreset;

async function loadChainNow(chain, presetName, meta = null) {
  meta ??= presetName && presetByName(presetName) ? presetMeta(presetByName(presetName)) : { trim: 0, sceneMeta: null, bpm: null };
  const current = new Map(state.chain.map(b => [b.uid, b]));
  const next = snapshot(chain).map(snap => {
    const ex = current.get(snap.uid);
    if (!ex || ex.type !== snap.type) return normalizeBlock(snap);
    current.delete(snap.uid);
    const l = live.get(ex.uid);
    for (const [id, v] of Object.entries(snap.params)) if (ex.params[id] !== v) { ex.params[id] = v; l?.audio?.set(id, v); }
    if (ex.on !== snap.on) { ex.on = snap.on; l?.audio?.setOn(ex.on); }
    ex.scenes = snap.scenes;
    const reload = [];
    for (const kind of new Set([...Object.keys(ex.files), ...Object.keys(snap.files)])) {
      if (ex.files[kind]?.key === snap.files[kind]?.key) continue;
      if (!snap.files[kind]) l?.audio?.clearFile(kind);
      else reload.push(kind);
    }
    ex.files = snap.files;
    ex.reload = reload;
    return ex;
  });
  // Quem sai: delay e reverb ligados continuam com a cauda (spillover); o resto sai quando a cadeia nova entra.
  const gone = [...current.values()].map(g => [g, live.get(g.uid)]).filter(([, l]) => l);
  for (const g of current.values()) live.delete(g.uid);
  state.chain = next;
  state.preset = presetName;
  if (presetName && own(state.drafts, presetName) && sameChain(next, presetByName(presetName).chain)) { delete state.drafts[presetName]; delete state.draftMeta[presetName]; }
  for (const b of next) ensureView(b);
  if (engine.running) {
    // Looper e metrônomo atravessam a troca: se o preset novo tem um pedal do mesmo tipo, ele herda o áudio do
    // que sai (o loop continua tocando, o clique não perde o compasso), com os botões do preset novo.
    for (const b of next) {
      const l = live.get(b.uid);
      if (l.audio || !CARRY.has(b.type)) continue;
      const k = gone.findIndex(([g, gl]) => g.type === b.type && gl.audio);
      if (k < 0) continue;
      const [[, gl]] = gone.splice(k, 1);
      l.audio = gl.audio;
      for (const [id, v] of Object.entries(b.params)) l.audio.set(id, v);
      l.audio.setOn(b.on);
      l.audio.onState?.(s => { l.view?.setState(s, l.def.stateLabels?.[s]); for (const f of changeListeners) f(); });
    }
    for (const b of next) {
      const l = live.get(b.uid);
      if (!l.audio) { createAudio(b); b.reload = Object.keys(b.files); }
    }
    // Capturas e IRs dos pedais novos carregam antes da troca: a cadeia antiga continua tocando até então,
    // em vez de o amp novo soar com o circuito interno e mudar de timbre quando a captura chega.
    await Promise.all(next.map(async b => {
      for (const kind of b.reload || []) {
        const data = await fileData(b, kind);
        if (data !== undefined) await loadIntoAudio(b, kind, data, b.files[kind].name);
      }
    }));
    // Nível do preset novo entra com a troca (o mergulho sobe já nele); quem sai, só depois da troca.
    setTrim(meta.trim ?? 0);
    await reconnect();
    for (const [g, l] of gone) {
      if (l.audio && g.on && SPILL_SECONDS[l.def.category]) engine.spill(l.audio, SPILL_SECONDS[l.def.category]);
      else l.audio?.dispose();
    }
  } else {
    for (const [, l] of gone) l.audio?.dispose();
    setTrim(meta.trim ?? 0);
  }
  for (const b of next) { delete b.reload; live.get(b.uid).view.update(); }
  state.sceneMeta = normalizeSceneMeta(meta.sceneMeta);
  syncTempoFromChain(meta.bpm ?? null);
  renderBoard();
  lastDirty = null;
  save();
  renderPresets();
}

export function stepPreset(dir) {
  const order = activeOrder();
  if (!order.length) { status(t('presets.noPresetsYet')); return; }
  const at = pendingPreset !== undefined ? pendingPreset : state.preset;
  const i = order.findIndex(p => p.name === at);
  const n = order.length;
  applyPreset(order[(i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n)].name);
}

$('preset').onchange = () => applyPreset($('preset').value);
$('presetSave').onclick = savePreset;
$('presetName').onkeydown = e => { if (e.key === 'Enter') savePreset(); };
$('presetRevert').onclick = revertPreset;
$('presetPrev').onclick = () => stepPreset(-1);
$('presetNext').onclick = () => stepPreset(1);

// ---------- Exportar e importar ----------
// Um arquivo .json com os presets e as capturas/IRs que eles usam: serve de backup
// e para levar os presets do PC para o celular.

export function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function buildExport() {
  // Sem presets salvos, exporta a pedaleira atual como um preset.
  const presets = state.presets.length ? state.presets : [{ name: t('presets.myBoard'), chain: state.chain }];
  const files = {};
  for (const p of presets)
    for (const b of p.chain)
      for (const f of Object.values(b.files)) {
        if (files[f.key]) continue;
        const data = await getFile(f.key, { cache: false });
        if (data === undefined) continue;
        files[f.key] = data instanceof ArrayBuffer ? { type: 'base64', data: toBase64(data) } : { type: 'json', data };
      }
  // Setlists e mapeamentos MIDI vão junto: levar o show do PC para o celular não pode perder a noite.
  return { app: 'pedaleira', version: 2, exportedAt: new Date().toISOString(), presets: snapshot(presets), files,
    setlists: snapshot(state.setlists), midi: snapshot(state.midi) };
}

export async function exportPresets() {
  const doc = await buildExport();
  const presets = doc.presets;
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  await saveFile(blob, `tonesmith-presets-${new Date().toISOString().slice(0, 10)}.json`);
  const unsaved = state.presets.some(p => hasDraft(p.name));
  status(t('presets.exported', { n: presets.length }) + (unsaved ? ` ${t('presets.exportUnsavedNote')}` : ''));
}

export async function importPresets(file) {
  let doc;
  try {
    doc = JSON.parse(await file.text());
    if (doc?.app !== 'pedaleira' || !Array.isArray(doc.presets)) throw new Error();
  } catch {
    status(t('presets.notPresetFile', { file: file.name }), true);
    return;
  }
  // As chaves do arquivo viram chaves novas: um .json forjado não troca um arquivo que já está no aparelho,
  // e só entra o que um preset novo usa. Preset igual a um que já existe (mesmo nome, mesmos botões, mesmos
  // nomes de arquivo) não entra de novo, nem os arquivos dele.
  const files = doc.files || {};
  const byName = ch => snapshot(ch).map(b => ({ ...b, files: Object.fromEntries(Object.entries(b.files).map(([k, f]) => [k, { key: f.name }])) }));
  const keyMap = new Map();
  const remap = b => ({
    ...b,
    files: Object.fromEntries(Object.entries(b?.files || {}).filter(([, f]) => typeof f?.key === 'string' && Object.hasOwn(files, f.key)).map(([k, f]) => [k, { ...f, key: `import:${f.key}` }])),
  });
  let added = 0, same = 0;
  const names = new Map(); // nome no arquivo → nome final aqui (para os setlists importados)
  for (const p of doc.presets) {
    if (!p || typeof p !== 'object') continue;
    const chain = normalizeChain((Array.isArray(p.chain) ? p.chain : []).map(remap));
    if (!chain.length) continue;
    const existing = presetByName(p.name);
    if (existing && sameChain(byName(existing.chain), byName(chain))) { same++; names.set(p.name, existing.name); continue; }
    for (const b of chain)
      for (const f of Object.values(b.files)) {
        const src = f.key.slice('import:'.length), entry = files[src];
        if (!keyMap.has(src)) {
          const data = entry?.type === 'base64' ? fromBase64(entry.data) : entry?.data;
          const ok = data !== undefined && (data instanceof ArrayBuffer ? data.byteLength <= 64 << 20 : JSON.stringify(data).length <= 64 << 20);
          keyMap.set(src, ok ? `import:${uid()}` : null);
          if (ok) await putFile(keyMap.get(src), data);
        }
        f.key = keyMap.get(src);
      }
    for (const b of chain) for (const k of Object.keys(b.files)) if (!b.files[k].key) delete b.files[k];
    const base = String(p.name || t('presets.defaultName')).slice(0, 34);
    let name = String(p.name || t('presets.defaultName')).slice(0, 40);
    for (let i = 2; presetByName(name); i++) name = `${base} (${i})`;
    // Mesmo normalizador do armazenamento: cenas (nome, nível, andamento), nível, andamento e PC fixo vêm junto.
    state.presets.push({ ...normalizePreset({ ...p, chain: [] }), name, chain });
    names.set(p.name, name);
    added++;
  }
  // Setlists do arquivo, com os nomes finais; nome de setlist repetido ganha (2).
  for (const l of Array.isArray(doc.setlists) ? doc.setlists : []) {
    if (!l || typeof l.name !== 'string' || !Array.isArray(l.order)) continue;
    const order = l.order.map(n => names.get(n)).filter(Boolean);
    if (!order.length) continue;
    let name = l.name.slice(0, 30);
    for (let i = 2; state.setlists.some(x => x.name === name); i++) name = `${l.name.slice(0, 26)} (${i})`;
    state.setlists.push({ name, order });
  }
  // Mapeamentos MIDI: entram os de botões que ainda não fazem nada aqui.
  for (const m of Array.isArray(doc.midi) ? doc.midi : [])
    if (m && typeof m.key === 'string' && m.target && !state.midi.some(x => x.key === m.key)) state.midi.push(m);
  save();
  renderPresets();
  status(t('presets.imported', { n: added }) + (same ? t('presets.importedSame', { n: same }) : '') + '.');
}

$('presetExport').onclick = () => exportPresets().catch(e => status(t('presets.exportFailed', { error: e.message }), true));
$('presetImport').onclick = () => {
  fileInput.accept = '.json,application/json';
  fileInput.value = '';
  fileInput.onchange = () => fileInput.files[0] && importPresets(fileInput.files[0]);
  fileInput.click();
};
