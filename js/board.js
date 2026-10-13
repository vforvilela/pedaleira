// Pedaleira na tela: desenha a cadeia, adiciona, remove, arrasta e carrega arquivos nos pedais.
import { $, applyStoredFiles, changeListeners, createAudio, setParam, engine, live, loadIntoAudio, newBlock, reconnect, releaseFile, save, state, status, tapTempo, toast, hideToast, toggleBlock } from './core.js';
import { ORDER, byType } from './pedals/index.js';
import { putFile } from './store.js';
import { pedalView } from './ui/pedal-view.js';
import { SUGGESTIONS } from './suggestions.js';

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

// Cada pedal leva junto o cabo que chega nele: quando a pedaleira quebra em fileiras (tablet, PC),
// o pedal que abre a fileira mostra o cabo vindo da anterior, e nenhum cabo fica solto no fim da linha.
function slot(node, i) {
  const s = document.createElement('div');
  s.className = 'slot';
  s.style.setProperty('--i', i);
  s.append(cable(), node);
  return s;
}

let arrived = false;
export function renderBoard() {
  const nodes = [jack('Guitarra', '🎸')];
  state.chain.forEach((b, i) => {
    const v = ensureView(b);
    v.setNumber(i < 9 ? i + 1 : 0); // número = tecla que liga e desliga
    nodes.push(slot(v.root, i));
  });
  // A saída anda junto com o último pedal: nunca sobra sozinha numa fileira (o que gastaria uma fileira inteira de altura).
  const out = slot(jack('Saída', '🎧'), state.chain.length);
  if (state.chain.length) nodes.at(-1).append(...out.childNodes); else nodes.push(out);
  board.replaceChildren(...nodes);
  // Na primeira montagem os pedais pousam na pedaleira, da guitarra para a saída (o caminho do sinal).
  if (!arrived) {
    arrived = true;
    board.classList.add('arrive');
    setTimeout(() => board.classList.remove('arrive'), 600 + 70 * nodes.length);
  }
  $('empty').hidden = state.chain.length > 0;
  renderChainMap();
  fitBoard();
}

// Tablet e PC: a pedaleira inteira cabe na área que sobra embaixo do topo, sem rolar a página.
// Procura o maior zoom em que ela cabe na altura; com zoom menor cabem mais pedais por fileira,
// então às vezes duas fileiras viram uma. --z deixa o CSS manter os botões de toque em 44 px na tela.
const Z_MIN = .5, Z_MAX = 1.3;
const wide = matchMedia('(min-width: 761px)');
export const zoom = () => parseFloat(board.style.zoom) || 1;
function setZoom(z) {
  board.style.zoom = z;
  board.style.setProperty('--z', z);
}
export function fitBoard() {
  board.style.removeProperty('--squeeze');
  if (!wide.matches) { board.style.zoom = ''; board.style.removeProperty('--z'); return; }
  const avail = board.parentElement.clientHeight;
  if (!avail) return;
  const height = () => board.getBoundingClientRect().height;
  const fits = z => (setZoom(z), height() <= avail + .5);
  if (!fits(Z_MAX)) {
    // Nem no mínimo cabe (cadeia muito longa): fica no mínimo e a área da pedaleira rola.
    if (!fits(Z_MIN)) return;
    let lo = Z_MIN, hi = Z_MAX;
    for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
    setZoom(Math.floor(lo * 100) / 100);
  }
  balanceRows(height());
}
// Fileiras equilibradas (3 + 3, não 5 + 1): aperta as laterais da pedaleira enquanto o número de fileiras
// não muda, e os pedais ficam centralizados.
function balanceRows(h) {
  const keeps = px => (board.style.setProperty('--squeeze', `${px}px`), board.getBoundingClientRect().height <= h + .5);
  let lo = 0, hi = board.clientWidth / 2;
  for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (keeps(m)) lo = m; else hi = m; }
  board.style.setProperty('--squeeze', `${Math.floor(lo)}px`);
}
let fitQueued = false;
const queueFit = () => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => { fitQueued = false; fitBoard(); });
};
// Muda a área (girar o tablet, abrir os primeiros passos) ou a pedaleira passou da área (carregou uma captura e
// a legenda cresceu): ajusta de novo. Só o "passou" para não entrar em laço com o próprio zoom.
new ResizeObserver(queueFit).observe(board.parentElement);
new ResizeObserver(() => { if (board.getBoundingClientRect().height > board.parentElement.clientHeight + .5) queueFit(); }).observe(board);
wide.addEventListener('change', queueFit);
document.fonts?.ready.then(queueFit);

// Mapa da cadeia (só no celular, onde cabe pouco mais de um pedal na tela): a ordem inteira numa linha;
// tocar num nome leva até o pedal.
function renderChainMap() {
  $('chainMap').replaceChildren(...state.chain.map(b => {
    const def = byType[b.type];
    const chip = document.createElement('button');
    chip.className = 'map-chip';
    chip.dataset.uid = b.uid;
    chip.style.setProperty('--body', def.look.body);
    chip.textContent = def.name;
    chip.onclick = () => live.get(b.uid)?.view.root.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    return chip;
  }));
  updateChainMap();
}
function updateChainMap() {
  for (const chip of $('chainMap').children)
    chip.classList.toggle('on', !!state.chain.find(b => b.uid === chip.dataset.uid)?.on);
}
changeListeners.push(updateChainMap);

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
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, started: false };
    (e.currentTarget).setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.started && Math.hypot(dx, dy) < 6) return;
    const wrap = board.parentElement;
    if (!drag.started) {
      drag.started = true;
      root.classList.add('dragging');
      // Os outros pedais não se movem durante o arraste: mede uma vez, não a cada movimento (evita reflow).
      // Centro de cada um, em coordenadas da página (a pedaleira pode rolar na horizontal e a página na vertical).
      drag.others = [...board.querySelectorAll('.pedal')].filter(p => p !== root);
      drag.mids = drag.others.map(p => {
        const r = p.getBoundingClientRect();
        return { x: r.left + r.width / 2 + wrap.scrollLeft, y: r.top + r.height / 2 + scrollY };
      });
    }
    // Com zoom na pedaleira, o deslocamento dentro dela é multiplicado por ele: divide para o pedal seguir o dedo.
    const z = zoom();
    root.style.transform = `translate(${dx / z}px, ${dy / z}px)`;
    const { others, mids } = drag;
    const x = e.clientX + wrap.scrollLeft, y = e.clientY + scrollY;
    // Fileira mais próxima do dedo (pedais da mesma fileira têm o mesmo centro vertical, com folga
    // para alturas diferentes); dentro dela, entra antes do primeiro pedal à direita do dedo.
    const rowY = mids.reduce((best, m) => (Math.abs(m.y - y) < Math.abs(best - y) ? m.y : best), Infinity);
    const inRow = i => Math.abs(mids[i].y - rowY) < 60;
    let to = mids.findIndex((m, i) => inRow(i) && x < m.x);
    if (to < 0) { to = mids.findLastIndex((m, i) => inRow(i)) + 1; if (!mids.length) to = 0; }
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
  // Teclado: setas no ⠿ trocam o pedal de lugar com o vizinho.
  grip.addEventListener('keydown', e => {
    const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const from = state.chain.findIndex(b => b.uid === block.uid);
    const to = from + dir;
    if (to < 0 || to >= state.chain.length) return;
    moveBlock(block.uid, dir > 0 ? to + 1 : to);
    grip.focus();
    status(`${byType[block.type].name} agora é o ${to + 1}º da cadeia.`);
  });
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

// Guarda o arquivo (IndexedDB) e carrega no pedal. url: de onde veio, quando veio de um link
// (vai junto no link de preset para quem recebe baixar a mesma captura).
export async function storeFile(block, kind, data, fileName, url) {
  const old = block.files[kind]?.key;
  // Chave nova a cada arquivo: um preset salvo antes continua com o arquivo dele.
  const key = `${block.uid}:${kind}:${Date.now().toString(36)}`;
  await putFile(key, data);
  block.files[kind] = { name: fileName.replace(/\.(nam|wav)$/i, ''), key, ...(url ? { url } : {}) };
  if (old) releaseFile(old);
  // Carregou uma IR: o amp passa a usá-la (antes ficava na caixa interna até girar o CAB).
  if (kind === 'ir') selectOption(block, 'cab', 'IR');
  save();
  if (engine.running) await loadIntoAudio(block, kind, data, fileName);
  else status(`${fileName} guardado. Ele toca quando você clicar em Ligar.`);
  live.get(block.uid)?.view.update();
}

function selectOption(block, id, option) {
  const i = live.get(block.uid)?.def.controls.find(c => c.id === id)?.options?.indexOf(option);
  if (i >= 0) setParam(block, id, i);
}

const parseFile = async (kind, read) => (kind === 'nam' ? JSON.parse(await read.text()) : await read.arrayBuffer());

function pickLocal(block, kind, accept) {
  fileInput.accept = accept;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    let data;
    try { data = await parseFile(kind, f); } catch {
      status(`${f.name} não é um arquivo ${kind === 'nam' ? '.nam' : '.wav'} válido.`, true);
      return;
    }
    await storeFile(block, kind, data, f.name);
  };
  fileInput.click();
}

// Link de página do GitHub ou de compartilhamento do Dropbox → link direto do arquivo.
export function directUrl(text) {
  const u = new URL(text.trim());
  const gh = u.hostname === 'github.com' && u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
  if (/(^|\.)dropbox\.com$/.test(u.hostname) && u.hostname !== 'dl.dropboxusercontent.com') {
    u.hostname = 'dl.dropboxusercontent.com';
    u.searchParams.delete('dl');
  }
  return u.href;
}

// Baixa a captura (.nam) ou IR (.wav) de um link direto. Devolve os dados ou lança um erro legível.
export async function fetchFile(kind, url) {
  let res;
  try { res = await fetch(url); } catch {
    throw new Error('o site não deixa baixar daqui (use um link direto do GitHub ou do Dropbox)');
  }
  if (!res.ok) throw new Error(`o site respondeu ${res.status}`);
  const lfs = new URL(url).hostname === 'raw.githubusercontent.com' && res.headers.get('content-length') < 1024
    && (await res.clone().text()).startsWith('version https://git-lfs');
  // Arquivo no Git LFS: o raw só tem um ponteiro; o conteúdo está no media.githubusercontent.com.
  if (lfs) return fetchFile(kind, url.replace('https://raw.githubusercontent.com/', 'https://media.githubusercontent.com/media/'));
  try { return await parseFile(kind, res); } catch {
    throw new Error(`não é um arquivo ${kind === 'nam' ? '.nam' : '.wav'}`);
  }
}

export async function loadFromUrl(block, kind, text, label) {
  let url;
  try { url = directUrl(text); } catch { status('Isso não parece um link.', true); return false; }
  const fileName = label || decodeURIComponent(new URL(url).pathname.split('/').pop() || kind);
  status(`Baixando ${fileName}…`);
  try {
    await storeFile(block, kind, await fetchFile(kind, url), fileName, url);
    return true;
  } catch (err) {
    status(`Não consegui baixar ${fileName}: ${err.message}.`, true);
    return false;
  }
}

// Botão NAM / IR: escolher um arquivo do aparelho ou colar um link direto.
export function pickFile(block, kind, accept) {
  const d = $('fileSheet');
  const what = kind === 'nam' ? 'captura NAM (.nam)' : 'IR de caixa (.wav)';
  $('fileSheetTitle').textContent = `${live.get(block.uid).def.name}: ${what}`;
  $('fileUrl').value = '';
  // Sugestões grátis (só no amp por enquanto).
  const sug = block.type === 'amp' && SUGGESTIONS[kind];
  $('fileSuggest').hidden = !sug;
  if (sug) {
    $('fileSuggestTitle').textContent = sug.title;
    $('fileSuggestHint').textContent = sug.hint;
    $('fileCredit').textContent = sug.credit.who;
    $('fileCredit').href = sug.credit.page;
    $('fileLicense').textContent = sug.credit.license;
    $('fileSuggestList').replaceChildren(...sug.items.map(c => {
      const b = document.createElement('button');
      b.className = 'suggest';
      b.innerHTML = '<b></b><small></small>';
      b.querySelector('b').textContent = c.name;
      b.querySelector('small').textContent = c.note;
      b.setAttribute('aria-pressed', block.files[kind]?.url === c.url);
      b.onclick = async () => {
        if (!(await loadFromUrl(block, kind, c.url, c.name))) return;
        selectOption(block, 'cab', sug.cab);
        live.get(block.uid).view.update();
        d.close();
      };
      return b;
    }));
  }
  $('fileLocal').onclick = () => { d.close(); pickLocal(block, kind, accept); };
  $('fileUrlForm').onsubmit = async e => {
    e.preventDefault();
    if (await loadFromUrl(block, kind, $('fileUrl').value)) d.close();
  };
  d.showModal();
}

$('fileSheetClose').onclick = () => $('fileSheet').close();
