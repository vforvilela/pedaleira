// Pedaleira na tela: desenha a cadeia, adiciona, remove, arrasta e carrega arquivos nos pedais.
import { $, applyStoredFiles, createAudio, engine, live, loadIntoAudio, newBlock, reconnect, releaseFile, save, state, status, tapTempo, toggleBlock } from './core.js';
import { ORDER, byType } from './pedals/index.js';
import { putFile } from './store.js';
import { pedalView } from './ui/pedal-view.js';

// ---------- Pedaleira ----------

export const board = $('board');

export function cable() {
  const c = document.createElement('div');
  c.className = 'cable';
  c.setAttribute('aria-hidden', 'true');
  return c;
}

export function jack(label, icon) {
  const j = document.createElement('div');
  j.className = 'jack';
  j.innerHTML = `<span class="jack-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
  return j;
}

export function ensureView(block) {
  if (!live.has(block.uid)) live.set(block.uid, { def: byType[block.type] });
  const l = live.get(block.uid);
  if (l.view) return l.view;
  l.view = pedalView({ ...block, def: l.def, get on() { return block.on; }, params: block.params, get files() { return block.files; } }, {
    change(id, v) { block.params[id] = v; l.audio?.set(id, v); save(); },
    toggle: () => toggleBlock(block),
    action: id => l.audio?.action?.(id),
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

export function renderBoard() {
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

export function addBlock(type) {
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

export function removeBlock(id) {
  const i = state.chain.findIndex(b => b.uid === id);
  if (i < 0) return;
  const [block] = state.chain.splice(i, 1);
  reconnect();
  live.get(id)?.audio?.dispose();
  live.delete(id);
  renderBoard();
  save();
  // Dá 10 s para desfazer (no palco, um toque errado no ✕ não pode custar o pedal e a captura dele).
  finishRemoval();
  removed = { block, index: i, timer: setTimeout(finishRemoval, 10000) };
  toast(`${byType[block.type].name} removido.`, 'Desfazer', undoRemove);
}

let removed = null;
function finishRemoval() {
  if (!removed) return;
  clearTimeout(removed.timer);
  for (const f of Object.values(removed.block.files)) releaseFile(f.key);
  removed = null;
  hideToast();
}

// Põe de volta o último pedal removido, no mesmo lugar (atalho: Ctrl+Z).
export async function undoRemove() {
  if (!removed) return;
  const { block, index, timer } = removed;
  clearTimeout(timer);
  removed = null;
  hideToast();
  state.chain.splice(Math.min(index, state.chain.length), 0, block);
  ensureView(block);
  if (engine.running) createAudio(block);
  renderBoard();
  reconnect();
  save();
  status(`${byType[block.type].name} voltou para a pedaleira.`);
  if (engine.running) await applyStoredFiles(block);
}

// Aviso no rodapé com um botão de ação.
let toastTimer = 0;
function toast(msg, action, fn) {
  const t = $('toast');
  t.querySelector('span').textContent = msg;
  const b = t.querySelector('button');
  b.textContent = action;
  b.onclick = fn;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 10000);
}
function hideToast() { $('toast').hidden = true; }

export function moveBlock(id, to) {
  const from = state.chain.findIndex(b => b.uid === id);
  if (from < 0 || to === from) return;
  const [b] = state.chain.splice(from, 1);
  state.chain.splice(to > from ? to - 1 : to, 0, b);
  renderBoard();
  reconnect();
  save();
}

// Arrastar: pelo ⠿ (mouse ou toque) ou pelo corpo do pedal com o mouse.
export function makeDraggable(block, view) {
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

export const fileInput = $('file');
export function pickFile(block, kind, accept) {
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
