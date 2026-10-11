// Pedaleira: monta a cadeia de pedais, liga ao áudio e salva o estado.
import { Engine, loadWasmBytes } from './audio/engine.js';
import { PEDALS, byType, DEFAULT_CHAIN, defaultParams } from './pedals/index.js';
import { pedalView, installDefs } from './ui/pedal-view.js';
import { loadState, saveState, putFile, getFile, deleteFile } from './store.js';

const $ = id => document.getElementById(id);
const engine = new Engine();
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Estado ----------

function newBlock(type) {
  const def = byType[type];
  return { uid: uid(), type, on: true, params: defaultParams(def), files: {} };
}

const saved = loadState();
const state = {
  master: saved?.master ?? -6,
  deviceId: saved?.deviceId ?? '',
  chain: (saved?.chain || DEFAULT_CHAIN.map(newBlock))
    .filter(b => byType[b.type])
    .map(b => ({ ...b, params: { ...defaultParams(byType[b.type]), ...b.params }, files: b.files || {} })),
};
const save = () => saveState(state);

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
    const data = await getFile(`${block.uid}:${kind}`);
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
    delete block.files[kind];
    deleteFile(`${block.uid}:${kind}`);
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
    file: (kind, accept) => pickFile(block, kind, accept),
    clearFile(kind) {
      delete block.files[kind];
      deleteFile(`${block.uid}:${kind}`);
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
  for (const b of state.chain) nodes.push(cable(), ensureView(b).root);
  nodes.push(cable(), jack('Saída', '🎧'));
  board.replaceChildren(...nodes);
  $('empty').hidden = state.chain.length > 0;
}

function addBlock(type) {
  const block = newBlock(type);
  // Drives entram antes do amp; o resto vai para o fim.
  const ampAt = state.chain.findIndex(b => byType[b.type].category === 'amp');
  const at = byType[type].category === 'drive' && ampAt >= 0 ? ampAt : state.chain.length;
  state.chain.splice(at, 0, block);
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
  for (const kind of Object.keys(block.files)) deleteFile(`${id}:${kind}`);
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
    block.files[kind] = { name: f.name.replace(/\.(nam|wav)$/i, '') };
    await putFile(`${block.uid}:${kind}`, data);
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

let meterRaf = 0, latencyTimer = 0;
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
  const showLat = () => { $('latency').textContent = `${engine.latencyMs().toFixed(1)} ms`; };
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
  await engine.stop();
  for (const l of live.values()) l.audio = null;
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
// Acesso para depuração pelo console e para os testes no navegador.
window.__pedaleira = { engine, state, live };
loadWasmBytes();
if ('serviceWorker' in navigator && location.protocol !== 'file:')
  navigator.serviceWorker.register('sw.js').catch(() => {});
