// Presets, rascunhos, exportar e importar.
import { ensureView, fileInput, renderBoard } from './board.js';
import { $, changeListeners, sameScene, createAudio, engine, live, loadIntoAudio, normalizeBlock, normalizeChain, reconnect, releaseFile, save, SCENE_NAMES, snapshot, state, status } from './core.js';
import { getFile, putFile } from './store.js';

// ---------- Presets ----------
// Mudança não salva num preset vira rascunho: trocar de preset não perde nada
// (nem quando a troca vem do pé, pelo MIDI ou pelo teclado). O * no nome indica rascunho.

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

export const presetByName = name => state.presets.find(p => p.name === name);
// A cadeia salva com a cena i aplicada: trocar de cena não conta como mudança no preset.
export const withScene = (chain, i) => chain.map(b => {
  const s = b.scenes[i];
  return s ? { ...b, on: s.on, params: s.params ? { ...b.params, ...s.params } : b.params } : b;
});
export const isDirty = () => {
  const p = presetByName(state.preset);
  if (!p || sameChain(state.chain, p.chain)) return false;
  return !SCENE_NAMES.some((_, i) => sameChain(state.chain, withScene(p.chain, i)));
};
export const hasDraft = name => !!state.drafts[name] || (name === state.preset && isDirty());

export function renderPresets() {
  const sel = $('preset');
  sel.replaceChildren(
    new Option('— sem preset —', ''),
    ...state.presets.map(p => new Option(hasDraft(p.name) ? `${p.name} *` : p.name, p.name)),
  );
  sel.value = state.preset ?? '';
  if (document.activeElement !== $('presetName')) $('presetName').value = state.preset ?? '';
  const dirty = isDirty();
  $('presetDelete').disabled = !state.preset;
  $('presetRevert').hidden = !dirty;
  $('presetSave').classList.toggle('attention', dirty);
  $('presetSave').title = dirty ? 'Há mudanças não salvas neste preset' : 'Salvar preset';
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
  if (!name) { status('Dê um nome ao preset (ex.: o nome da música).', true); $('presetName').focus(); return; }
  const existing = presetByName(name);
  const old = existing?.chain;
  if (existing) existing.chain = snapshot(state.chain);
  else state.presets.push({ name, chain: snapshot(state.chain) });
  // Salvar a partir de outro preset deixa aquele como estava salvo.
  if (state.preset !== name) delete state.drafts[state.preset ?? ''];
  delete state.drafts[name];
  state.preset = name;
  // Arquivos que só a versão antiga usava podem ser liberados.
  for (const b of old || []) for (const f of Object.values(b.files)) releaseFile(f.key);
  lastDirty = null;
  save();
  renderPresets();
  status(`Preset "${name}" salvo.`);
}

export function deletePreset() {
  const i = state.presets.findIndex(p => p.name === state.preset);
  if (i < 0) return;
  const [p] = state.presets.splice(i, 1);
  delete state.drafts[p.name];
  for (const b of p.chain) for (const f of Object.values(b.files)) releaseFile(f.key);
  status(`Preset "${p.name}" apagado. A pedaleira continua como está.`);
  state.preset = null;
  save();
  renderPresets();
}

// Volta o preset atual para a versão salva, descartando o rascunho.
export async function revertPreset() {
  const name = state.preset;
  if (!presetByName(name)) return;
  delete state.drafts[name];
  await loadChain(presetByName(name).chain, name);
  status(`"${name}" voltou para a versão salva.`);
}

// Troca de preset. O ajuste não salvo do preset atual vira rascunho dele.
export async function applyPreset(name) {
  const from = state.preset ?? '';
  if (name === from) return;
  if (from === '' || isDirty()) state.drafts[from] = snapshot(state.chain);
  else delete state.drafts[from];
  const target = name === '' ? state.drafts[''] : state.drafts[name] || presetByName(name)?.chain;
  if (!target) { state.preset = name || null; save(); renderPresets(); return; }
  await loadChain(target, name || null);
  status(name ? `Preset: ${name}${state.drafts[name] ? ' (com mudanças não salvas)' : ''}` : 'Sem preset.');
}

// Carrega uma cadeia reaproveitando o áudio dos pedais que continuam
// (assim a troca é rápida, o delay não corta e as capturas NAM não recarregam à toa).
export async function loadChain(chain, presetName) {
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
  for (const gone of current.values()) { live.get(gone.uid)?.audio?.dispose(); live.delete(gone.uid); }
  state.chain = next;
  state.preset = presetName;
  if (presetName && state.drafts[presetName] && sameChain(next, presetByName(presetName).chain)) delete state.drafts[presetName];
  for (const b of next) ensureView(b);
  if (engine.running) {
    for (const b of next) {
      const l = live.get(b.uid);
      if (!l.audio) { createAudio(b); b.reload = Object.keys(b.files); }
    }
    reconnect();
    await Promise.all(next.map(async b => {
      for (const kind of b.reload || []) {
        const data = await getFile(b.files[kind].key);
        if (data !== undefined) await loadIntoAudio(b, kind, data, b.files[kind].name);
      }
    }));
  }
  for (const b of next) { delete b.reload; live.get(b.uid).view.update(); }
  renderBoard();
  lastDirty = null;
  save();
  renderPresets();
}

export function stepPreset(dir) {
  if (!state.presets.length) { status('Nenhum preset salvo ainda.'); return; }
  const i = state.presets.findIndex(p => p.name === state.preset);
  const n = state.presets.length;
  applyPreset(state.presets[(i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n)].name);
}

$('preset').onchange = () => applyPreset($('preset').value);
$('presetSave').onclick = savePreset;
$('presetName').onkeydown = e => { if (e.key === 'Enter') savePreset(); };
$('presetDelete').onclick = deletePreset;
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
  const presets = state.presets.length ? state.presets : [{ name: 'Minha pedaleira', chain: state.chain }];
  const files = {};
  for (const p of presets)
    for (const b of p.chain)
      for (const f of Object.values(b.files)) {
        if (files[f.key]) continue;
        const data = await getFile(f.key);
        if (data === undefined) continue;
        files[f.key] = data instanceof ArrayBuffer ? { type: 'base64', data: toBase64(data) } : { type: 'json', data };
      }
  return { app: 'pedaleira', version: 1, exportedAt: new Date().toISOString(), presets: snapshot(presets), files };
}

export async function exportPresets() {
  const doc = await buildExport();
  const presets = doc.presets;
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pedaleira-presets-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  const unsaved = state.presets.some(p => hasDraft(p.name));
  status(`${presets.length} preset(s) exportado(s)${unsaved ? '. Mudanças não salvas (*) não vão no arquivo' : ''}.`);
}

export async function importPresets(file) {
  let doc;
  try {
    doc = JSON.parse(await file.text());
    if (doc?.app !== 'pedaleira' || !Array.isArray(doc.presets)) throw new Error();
  } catch {
    status(`${file.name} não é um arquivo de presets da Pedaleira.`, true);
    return;
  }
  for (const [key, f] of Object.entries(doc.files || {}))
    await putFile(key, f.type === 'base64' ? fromBase64(f.data) : f.data);
  let added = 0, same = 0;
  for (const p of doc.presets) {
    const chain = normalizeChain(p.chain || []);
    if (!chain.length) continue;
    const existing = presetByName(p.name);
    if (existing && sameChain(existing.chain, chain)) { same++; continue; }
    let name = String(p.name || 'Preset').slice(0, 40);
    for (let i = 2; presetByName(name); i++) name = `${String(p.name).slice(0, 34)} (${i})`;
    state.presets.push({ name, chain });
    added++;
  }
  save();
  renderPresets();
  status(`${added} preset(s) importado(s)${same ? `, ${same} já existia(m) igual` : ''}.`);
}

$('presetExport').onclick = () => exportPresets().catch(e => status(`Não consegui exportar: ${e.message}`, true));
$('presetImport').onclick = () => {
  fileInput.accept = '.json,application/json';
  fileInput.value = '';
  fileInput.onchange = () => fileInput.files[0] && importPresets(fileInput.files[0]);
  fileInput.click();
};
