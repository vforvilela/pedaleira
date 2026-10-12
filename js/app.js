// Pedaleira: monta a cadeia de pedais, liga ao áudio e salva o estado.
import { Engine, loadWasmBytes } from './audio/engine.js';
import { PEDALS, byType, DEFAULT_CHAIN, ORDER, defaultParams } from './pedals/index.js';
import { noteOf } from './audio/pitch.js';
import { pedalView, installDefs } from './ui/pedal-view.js';
import { loadState, saveState, putFile, getFile, deleteFile } from './store.js';
import { Midi, midiSupported } from './midi.js';

const $ = id => document.getElementById(id);
const engine = new Engine();
const uid = () => Math.random().toString(36).slice(2, 10);
const SCENES = 4, SCENE_NAMES = ['A', 'B', 'C', 'D'];

// ---------- Estado ----------

function newBlock(type) {
  const def = byType[type];
  return { uid: uid(), type, on: def.defaultOn !== false, params: defaultParams(def), files: {}, scenes: Array(SCENES).fill(null) };
}

// Completa um bloco salvo com os padrões do pedal (o pedal pode ter ganhado controles novos).
const normalizeBlock = b => ({
  uid: b.uid, type: b.type, on: b.on !== false,
  params: { ...defaultParams(byType[b.type]), ...b.params },
  files: Object.fromEntries(Object.entries(b.files || {}).map(([k, f]) => [k, { ...f, key: f.key || `${b.uid}:${k}` }])),
  // scenes[i]: ligado (true), desligado (false) ou fora (null) na cena i.
  scenes: Array.from({ length: SCENES }, (_, i) => (typeof b.scenes?.[i] === 'boolean' ? b.scenes[i] : null)),
});
const normalizeChain = chain => chain.filter(b => byType[b.type]).map(normalizeBlock);

const saved = loadState();
const state = {
  master: saved?.master ?? -6,
  deviceId: saved?.deviceId ?? '',
  chain: normalizeChain(saved?.chain || DEFAULT_CHAIN.map(newBlock)),
  presets: (saved?.presets || []).map(p => ({ name: p.name, chain: normalizeChain(p.chain) })),
  preset: saved?.preset ?? null,
  // Rascunhos: mudanças não salvas por preset ('' = sem preset).
  drafts: Object.fromEntries(Object.entries(saved?.drafts || {}).map(([k, c]) => [k, normalizeChain(c)])),
  midi: saved?.midi || [],
};
const save = () => { saveState(state); refreshDirty(); renderScenes(); };
const snapshot = chain => JSON.parse(JSON.stringify(chain));

// Um arquivo (.nam, IR) só sai do IndexedDB quando nem a pedaleira nem algum preset usa mais.
function releaseFile(key) {
  const used = [state.chain, ...state.presets.map(p => p.chain), ...Object.values(state.drafts)]
    .some(chain => chain.some(b => Object.values(b.files).some(f => f.key === key)));
  if (!used) deleteFile(key);
}

// Partes que não vão para o armazenamento: definição, áudio e vista de cada bloco.
const live = new Map(); // uid → { def, audio, view }

// ---------- Áudio ----------

function createAudio(block) {
  const l = live.get(block.uid);
  l.audio = l.def.create(engine.ctx, { params: { ...block.params }, wasmBytes: engine.wasmBytes });
  l.audio.setOn(block.on);
}

function reconnect() {
  if (!engine.running) return;
  engine.connectChain(state.chain.map(b => live.get(b.uid)));
}

async function applyStoredFiles(block) {
  for (const kind of Object.keys(block.files)) {
    const data = await getFile(block.files[kind].key);
    if (data === undefined) { delete block.files[kind]; continue; }
    await loadIntoAudio(block, kind, data, block.files[kind].name);
  }
  live.get(block.uid).view.update();
}

async function loadIntoAudio(block, kind, data, name) {
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

// ---------- Pedaleira ----------

const board = $('board');

function cable() {
  const c = document.createElement('div');
  c.className = 'cable';
  c.setAttribute('aria-hidden', 'true');
  return c;
}

function jack(label, icon) {
  const j = document.createElement('div');
  j.className = 'jack';
  j.innerHTML = `<span class="jack-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
  return j;
}

function ensureView(block) {
  if (!live.has(block.uid)) live.set(block.uid, { def: byType[block.type] });
  const l = live.get(block.uid);
  if (l.view) return l.view;
  l.view = pedalView({ ...block, def: l.def, get on() { return block.on; }, params: block.params, get files() { return block.files; } }, {
    change(id, v) { block.params[id] = v; l.audio?.set(id, v); save(); },
    toggle() { block.on = !block.on; l.audio?.setOn(block.on); save(); },
    tap: () => tapTempo(block),
    file: (kind, accept) => pickFile(block, kind, accept),
    clearFile(kind) {
      const key = block.files[kind]?.key;
      delete block.files[kind];
      if (key) releaseFile(key);
      l.audio?.clearFile(kind);
      l.view.update();
      save();
    },
    remove: () => removeBlock(block.uid),
  });
  makeDraggable(block, l.view);
  return l.view;
}

function renderBoard() {
  const nodes = [jack('Guitarra', '🎸')];
  state.chain.forEach((b, i) => {
    const v = ensureView(b);
    v.setNumber(i < 9 ? i + 1 : 0); // número = tecla que liga e desliga
    nodes.push(cable(), v.root);
  });
  nodes.push(cable(), jack('Saída', '🎧'));
  board.replaceChildren(...nodes);
  $('empty').hidden = state.chain.length > 0;
}

function addBlock(type) {
  const block = newBlock(type);
  // Entra na posição de costume: afinador, gate, compressor, drives, amp, delay e reverb.
  // Depois dá para arrastar para onde quiser.
  const rank = b => ORDER[byType[b.type].category] ?? 9;
  const at = state.chain.findIndex(b => rank(b) > rank(block));
  state.chain.splice(at < 0 ? state.chain.length : at, 0, block);
  ensureView(block);
  if (engine.running) createAudio(block);
  renderBoard();
  reconnect();
  save();
  live.get(block.uid).view.root.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function removeBlock(id) {
  const i = state.chain.findIndex(b => b.uid === id);
  if (i < 0) return;
  const [block] = state.chain.splice(i, 1);
  reconnect();
  live.get(id)?.audio?.dispose();
  live.delete(id);
  for (const f of Object.values(block.files)) releaseFile(f.key);
  renderBoard();
  save();
}

function moveBlock(id, to) {
  const from = state.chain.findIndex(b => b.uid === id);
  if (from < 0 || to === from) return;
  const [b] = state.chain.splice(from, 1);
  state.chain.splice(to > from ? to - 1 : to, 0, b);
  renderBoard();
  reconnect();
  save();
}

// Arrastar: pelo ⠿ (mouse ou toque) ou pelo corpo do pedal com o mouse.
function makeDraggable(block, view) {
  const { root, grip } = view;
  let drag = null;

  const begin = e => {
    drag = { x: e.clientX, id: e.pointerId, started: false };
    (e.currentTarget).setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.started && Math.abs(dx) < 6) return;
    drag.started = true;
    root.classList.add('dragging');
    root.style.transform = `translateX(${dx}px)`;
    const others = [...board.querySelectorAll('.pedal')].filter(p => p !== root);
    let to = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { to = i; break; }
    }
    others.forEach((p, i) => p.classList.toggle('drop-before', i === to));
    board.classList.toggle('drop-end', to === others.length);
    drag.to = to;
  };
  const end = () => {
    if (!drag) return;
    const { started, to } = drag;
    drag = null;
    root.classList.remove('dragging');
    root.style.transform = '';
    board.querySelectorAll('.drop-before').forEach(p => p.classList.remove('drop-before'));
    board.classList.remove('drop-end');
    if (!started) return;
    // "to" conta os outros pedais; converte para índice na cadeia completa.
    const from = state.chain.findIndex(b => b.uid === block.uid);
    moveBlock(block.uid, to >= from ? to + 1 : to);
  };

  grip.addEventListener('pointerdown', e => { e.preventDefault(); begin(e); });
  root.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target.closest('.knob, .footswitch, button')) return;
    begin(e);
  });
  for (const t of [grip, root]) {
    t.addEventListener('pointermove', move);
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', end);
  }
}

// ---------- Arquivos (.nam, IR) ----------

const fileInput = $('file');
function pickFile(block, kind, accept) {
  fileInput.accept = accept;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    let data;
    try {
      data = kind === 'nam' ? JSON.parse(await f.text()) : await f.arrayBuffer();
    } catch {
      status(`${f.name} não é um arquivo ${kind === 'nam' ? '.nam' : '.wav'} válido.`, true);
      return;
    }
    const old = block.files[kind]?.key;
    // Chave nova a cada arquivo: um preset salvo antes continua com o arquivo dele.
    const key = `${block.uid}:${kind}:${Date.now().toString(36)}`;
    await putFile(key, data);
    block.files[kind] = { name: f.name.replace(/\.(nam|wav)$/i, ''), key };
    if (old) releaseFile(old);
    save();
    if (engine.running) await loadIntoAudio(block, kind, data, f.name);
    else status(`${f.name} guardado. Ele toca quando você clicar em Ligar.`);
    live.get(block.uid).view.update();
  };
  fileInput.click();
}

// ---------- Entrada, medidor, latência ----------

function status(msg, err = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('err', err);
}

async function listDevices(selectedId) {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  const sel = $('device');
  sel.replaceChildren(...devs.map((d, i) => new Option(d.label || `Entrada ${i + 1}`, d.deviceId)));
  // Na primeira vez, tenta achar o Tank Mini pelo nome.
  const tank = devs.find(d => /tank/i.test(d.label));
  sel.value = selectedId || (tank && tank.deviceId) || sel.value;
}

let meterRaf = 0, latencyTimer = 0, tunerTimer = 0;

// Lê os afinadores ligados ~12 vezes por segundo; desligados, o visor apaga.
function runTuners() {
  for (const b of state.chain) {
    const l = live.get(b.uid);
    if (l?.def.category !== 'tuner' || !l.view) continue;
    const active = b.on && !!l.audio;
    const hz = active ? l.audio.read() : null;
    l.view.setDisplay(hz ? noteOf(hz, l.audio.ref()) : null, active);
  }
}
function runMeter() {
  const buf = new Float32Array(engine.analyser.fftSize);
  const meter = $('meter'), bar = meter.firstElementChild;
  const tick = () => {
    if (!engine.running) return;
    const peak = engine.peak(buf);
    const db = 20 * Math.log10(peak || 1e-6);
    bar.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    meter.classList.toggle('clip', peak > 0.98);
    meterRaf = requestAnimationFrame(tick);
  };
  tick();
}

async function start() {
  status('Ligando…');
  const track = await engine.start($('device').value || state.deviceId);
  state.deviceId = track.getSettings().deviceId || state.deviceId;
  await listDevices(state.deviceId);
  if (!engine.wasmBytes) status('Motor WebAssembly indisponível: capturas NAM vão usar o motor JS, mais pesado.', true);
  for (const b of state.chain) createAudio(b);
  reconnect();
  engine.setMaster(state.master);
  await Promise.all(state.chain.map(applyStoredFiles));
  runMeter();
  tunerTimer = setInterval(runTuners, 80);
  let warned = false;
  const showLat = () => {
    const ms = engine.latencyMs();
    $('latency').textContent = `${ms.toFixed(1)} ms`;
    $('latency').parentElement.classList.toggle('high', ms > 80);
    // Fone ou caixa Bluetooth somam 150 ms ou mais: dá para ouvir, não para tocar.
    if (ms > 80 && !warned) {
      warned = true;
      status(`Latência alta (${Math.round(ms)} ms). Fone ou caixa Bluetooth atrasam demais para tocar: use fone com fio ou a saída da interface.`, true);
    }
  };
  showLat();
  latencyTimer = setInterval(showLat, 1000);
  if (!$('status').classList.contains('err')) status(`Tocando: ${track.label}`);
  $('power').textContent = 'Desligar';
  $('power').setAttribute('aria-pressed', 'true');
  save();
}

async function stop() {
  cancelAnimationFrame(meterRaf);
  clearInterval(latencyTimer);
  clearInterval(tunerTimer);
  await engine.stop();
  for (const l of live.values()) l.audio = null;
  runTuners();
  $('meter').firstElementChild.style.width = '0';
  $('latency').textContent = '—';
  status('Desligado.');
  $('power').textContent = 'Ligar';
  $('power').setAttribute('aria-pressed', 'false');
}

$('power').onclick = async () => {
  $('power').disabled = true;
  try {
    engine.running ? await stop() : await start();
  } catch (e) {
    await stop();
    const msg = e.name === 'NotAllowedError' ? 'O navegador não deu acesso à entrada de áudio.'
      : e.name === 'NotFoundError' ? 'Nenhuma entrada de áudio encontrada. Conecte a interface.'
      : `${e.name}: ${e.message}`;
    status(`Erro: ${msg}`, true);
  } finally {
    $('power').disabled = false;
  }
};

$('device').onchange = async () => {
  state.deviceId = $('device').value;
  save();
  if (!engine.running) return;
  await stop();
  $('power').click();
};

$('master').value = state.master;
const showMaster = () => { $('masterV').textContent = `${state.master} dB`; };
showMaster();
$('master').oninput = () => {
  state.master = +$('master').value;
  showMaster();
  engine.setMaster(state.master);
  save();
};

// ---------- Tap tempo ----------

const taps = new Map(); // uid → tempos dos últimos toques (ms)
function tapTempo(block) {
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

function setParam(block, id, v) {
  block.params[id] = v;
  const l = live.get(block.uid);
  l?.audio?.set(id, v);
  l?.view?.update();
  save();
}

function toggleBlock(block) {
  block.on = !block.on;
  const l = live.get(block.uid);
  l?.audio?.setOn(block.on);
  l?.view?.update();
  save();
}

// ---------- Presets ----------
// Mudança não salva num preset vira rascunho: trocar de preset não perde nada
// (nem quando a troca vem do pé, pelo MIDI ou pelo teclado). O * no nome indica rascunho.

// Compara duas cadeias pelo que importa para o som (ignora a ordem das chaves).
function sameChain(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    if (x.uid !== y.uid || x.type !== y.type || x.on !== y.on) return false;
    if (x.scenes.some((v, i) => v !== y.scenes[i])) return false;
    const pk = new Set([...Object.keys(x.params), ...Object.keys(y.params)]);
    for (const k of pk) if (x.params[k] !== y.params[k]) return false;
    const fk = new Set([...Object.keys(x.files), ...Object.keys(y.files)]);
    for (const k of fk) if (x.files[k]?.key !== y.files[k]?.key) return false;
    return true;
  });
}

const presetByName = name => state.presets.find(p => p.name === name);
// A cadeia salva com a cena i aplicada: trocar de cena não conta como mudança no preset.
const withScene = (chain, i) => chain.map(b => (b.scenes[i] === null ? b : { ...b, on: b.scenes[i] }));
const isDirty = () => {
  const p = presetByName(state.preset);
  if (!p || sameChain(state.chain, p.chain)) return false;
  return !SCENE_NAMES.some((_, i) => sameChain(state.chain, withScene(p.chain, i)));
};
const hasDraft = name => !!state.drafts[name] || (name === state.preset && isDirty());

function renderPresets() {
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
function refreshDirty() {
  const d = isDirty();
  if (d === lastDirty) return;
  lastDirty = d;
  renderPresets();
}

function savePreset() {
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

function deletePreset() {
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
async function revertPreset() {
  const name = state.preset;
  if (!presetByName(name)) return;
  delete state.drafts[name];
  await loadChain(presetByName(name).chain, name);
  status(`"${name}" voltou para a versão salva.`);
}

// Troca de preset. O ajuste não salvo do preset atual vira rascunho dele.
async function applyPreset(name) {
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
async function loadChain(chain, presetName) {
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

function stepPreset(dir) {
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

// ---------- Cenas ----------
// Uma cena liga e desliga vários pedais de uma vez (ex.: A = base, B = solo), dentro do mesmo preset.
// Cada pedal guarda o próprio estado em cada cena; pedais adicionados depois ficam como estão.

let recordingScene = false;
const sceneButtons = [...document.querySelectorAll('.scene-btn')];
const sceneUsed = i => state.chain.some(b => b.scenes[i] !== null);
// Cena que bate com o que está ligado agora (para acender o botão).
const sceneActive = i => sceneUsed(i) && state.chain.every(b => b.scenes[i] === null || b.scenes[i] === b.on);

function renderScenes() {
  sceneButtons.forEach((btn, i) => {
    btn.classList.toggle('used', sceneUsed(i));
    btn.setAttribute('aria-pressed', sceneActive(i));
  });
  $('sceneRec').setAttribute('aria-pressed', recordingScene);
  $('scenes').classList.toggle('recording', recordingScene);
}

function sceneSummary(i) {
  const on = state.chain.filter(b => b.scenes[i]).map(b => byType[b.type].name);
  return on.length ? `liga ${on.join(', ')}` : 'tudo desligado';
}

function recallScene(i) {
  if (!sceneUsed(i)) {
    status(`Cena ${SCENE_NAMES[i]} vazia. Ligue os pedais que quer, clique em Gravar cena e depois em ${SCENE_NAMES[i]}.`);
    return;
  }
  for (const b of state.chain) {
    const want = b.scenes[i];
    if (want === null || want === b.on) continue;
    b.on = want;
    const l = live.get(b.uid);
    l?.audio?.setOn(want);
    l?.view?.update();
  }
  save();
  status(`Cena ${SCENE_NAMES[i]}: ${sceneSummary(i)}.`);
}

function storeScene(i) {
  for (const b of state.chain) b.scenes[i] = b.on;
  recordingScene = false;
  save();
  status(`Cena ${SCENE_NAMES[i]} gravada: ${sceneSummary(i)}. Salve o preset para guardar a cena nele.`);
}

sceneButtons.forEach((btn, i) => { btn.onclick = () => (recordingScene ? storeScene(i) : recallScene(i)); });
$('sceneRec').onclick = () => {
  recordingScene = !recordingScene;
  renderScenes();
  status(recordingScene ? 'Gravar cena: clique em A, B, C ou D para guardar quais pedais estão ligados agora.' : 'Gravação de cena cancelada.');
};

// ---------- Exportar e importar ----------
// Um arquivo .json com os presets e as capturas/IRs que eles usam: serve de backup
// e para levar os presets do PC para o celular.

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function buildExport() {
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

async function exportPresets() {
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

async function importPresets(file) {
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

// ---------- Controle: MIDI e teclado ----------

function blockByUid(id) { return state.chain.find(b => b.uid === id); }
// O alvo de um evento pode ser o próprio document (sem closest).
const closest = (e, sel) => (e.target instanceof Element ? e.target.closest(sel) : null);

function runAction(target, msg) {
  if (target.kind === 'program') {
    const p = state.presets[msg.program];
    if (p) applyPreset(p.name);
    return;
  }
  // msg.trigger: pisada que conta (ver midi.js). Teclado e cliques chegam sem msg.
  const fires = !msg || msg.trigger !== false;
  if (target.kind === 'preset') { if (fires) stepPreset(target.dir); return; }
  if (target.kind === 'scene') { if (fires) recallScene(target.index); return; }
  const block = blockByUid(target.uid);
  if (!block) return;
  if (target.kind === 'knob') {
    const c = byType[block.type].controls.find(c => c.id === target.param);
    if (!c) return;
    const max = c.type === 'select' ? c.options.length - 1 : 10;
    const v = c.type === 'select' ? Math.round((msg.value / 127) * max) : Math.round((msg.value / 127) * 100) / 10;
    setParam(block, c.id, v);
  } else if (fires) {
    if (target.kind === 'toggle') toggleBlock(block);
    else if (target.kind === 'tap') tapTempo(block);
  }
}

function describeTarget(t) {
  if (t.kind === 'preset') return t.dir > 0 ? 'próximo preset' : 'preset anterior';
  if (t.kind === 'scene') return `cena ${SCENE_NAMES[t.index]}`;
  const b = blockByUid(t.uid), name = b ? byType[b.type].name : 'pedal';
  if (t.kind === 'toggle') return `${name} (liga/desliga)`;
  if (t.kind === 'tap') return `${name} (TAP)`;
  return `${name} → ${t.param.toUpperCase()}`;
}

const midi = new Midi(state.midi, {
  onAction: runAction,
  onChange: save,
  onLearned(target, msg) { status(`MIDI: ${msg.label} → ${describeTarget(target)}. Escolha outro alvo ou clique em MIDI para sair.`); },
});

let learning = false;
function setLearning(on) {
  learning = on;
  document.body.classList.toggle('midi-learn', on);
  $('midi').setAttribute('aria-pressed', on);
  $('midiClear').hidden = !on;
  midi.learn(null);
  if (!on) document.querySelectorAll('.learn-target').forEach(x => x.classList.remove('learn-target'));
}

if (midiSupported()) {
  $('midi').hidden = false;
  $('midi').onclick = async () => {
    if (learning) { setLearning(false); status('MIDI pronto.'); return; }
    try {
      await midi.enable();
    } catch {
      status('O navegador não deu acesso ao MIDI.', true);
      return;
    }
    setLearning(true);
    const names = midi.inputNames();
    status(`${names.length ? `Controlador: ${names.join(', ')}.` : 'Nenhum controlador MIDI conectado.'} Toque no que quer controlar (pedal, TAP, botão, cena, ◀ ▶) e depois pise no controlador.`);
  };
  $('midiClear').onclick = () => {
    state.midi.splice(0);
    save();
    status('Todos os mapeamentos MIDI foram apagados.');
  };
  // Liga o MIDI sozinho se já houver mapeamentos (o navegador lembra a permissão).
  if (state.midi.length) midi.enable().catch(() => {});
}

// No modo de aprendizado, um toque escolhe o alvo em vez de agir.
document.addEventListener('pointerdown', e => {
  if (!learning) return;
  const el = closest(e, '.footswitch, .tap-btn, .knob, .scene-btn, #presetPrev, #presetNext');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  let target;
  if (el.id === 'presetPrev' || el.id === 'presetNext') target = { kind: 'preset', dir: el.id === 'presetNext' ? 1 : -1 };
  else if (el.classList.contains('scene-btn')) target = { kind: 'scene', index: sceneButtons.indexOf(el) };
  else {
    const id = el.closest('.pedal')?.dataset.uid;
    if (!id) return;
    if (el.classList.contains('footswitch')) target = { kind: 'toggle', uid: id };
    else if (el.classList.contains('tap-btn')) target = { kind: 'tap', uid: id };
    else target = { kind: 'knob', uid: id, param: el.dataset.param };
  }
  document.querySelectorAll('.learn-target').forEach(x => x.classList.remove('learn-target'));
  el.classList.add('learn-target');
  midi.learn(target);
  status(`Agora pise no botão do controlador para: ${describeTarget(target)}.`);
}, true);
document.addEventListener('click', e => {
  if (learning && closest(e, '.footswitch, .tap-btn, .knob, .scene-btn, #presetPrev, #presetNext')) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Teclado do computador como footswitch: 1–9 liga/desliga o pedal na posição, T = tap, [ ] = presets,
// A–D = cenas. Setas e PageUp/PageDown também trocam de preset: é o que mandam os footswitches
// Bluetooth de virar página (que funcionam como teclado no celular, inclusive no iPhone).
const PREV_KEYS = new Set(['[', 'ArrowLeft', 'ArrowUp', 'PageUp']);
const NEXT_KEYS = new Set([']', 'ArrowRight', 'ArrowDown', 'PageDown']);
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || closest(e, 'input, select, textarea, .knob')) return;
  const scene = 'abcd'.indexOf(e.key.toLowerCase());
  if (e.key.length === 1 && scene >= 0) recallScene(scene);
  else if (/^[1-9]$/.test(e.key)) {
    const b = state.chain[+e.key - 1];
    if (b) { toggleBlock(b); status(`${byType[b.type].name}: ${b.on ? 'ligado' : 'desligado'}`); }
  } else if (e.key === 't' || e.key === 'T') {
    const b = state.chain.find(b => byType[b.type].tap);
    if (b) tapTempo(b);
  } else if (PREV_KEYS.has(e.key)) stepPreset(-1);
  else if (NEXT_KEYS.has(e.key)) stepPreset(1);
  else return;
  e.preventDefault();
});

// ---------- Biblioteca ----------

$('library').replaceChildren(...PEDALS.map(def => {
  const b = document.createElement('button');
  b.className = 'add';
  b.innerHTML = `<span class="swatch" style="background:${def.look.body}"></span><span><b></b><small></small></span>`;
  b.querySelector('b').textContent = def.name;
  b.querySelector('small').textContent = def.inspiredBy ? `inspirado no ${def.inspiredBy}` : 'amp + caixa, aceita captura NAM';
  b.onclick = () => addBlock(def.type);
  return b;
}));

// ---------- Início ----------

installDefs();
renderBoard();
renderPresets();
renderScenes();
// Acesso para depuração pelo console e para os testes no navegador.
window.__pedaleira = { engine, get state() { return state; }, live, midi, buildExport, importPresets, getFile };
loadWasmBytes();
if ('serviceWorker' in navigator && location.protocol !== 'file:')
  navigator.serviceWorker.register('sw.js').catch(() => {});
