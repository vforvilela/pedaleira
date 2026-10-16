// Pedaleira na tela: desenha a cadeia, adiciona, remove, arrasta e carrega arquivos nos pedais.
import { $, applyStoredFiles, changeListeners, createAudio, paramChanged, setParam, syncTempoFromChain, engine, live, loadIntoAudio, newBlock, reconnect, releaseFile, save, saveSoon, flushSave, state, status, tapTempo, toast, hideToast, toggleBlock } from './core.js';
import { ORDER, byType } from './pedals/index.js';
import { putFile } from './store.js';
import { pedalView } from './ui/pedal-view.js';
import { countRows, frozenZoom, keepRows, largestSqueeze, largestZoom } from './fit.js';
import { SUGGESTIONS } from './suggestions.js';
import { t } from './i18n.js';
import { directUrl, fetchFile, parseFile } from './files.js';
export { directUrl, fetchFile };

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
    change(id, v, live) { block.params[id] = v; l.audio?.set(id, v); paramChanged(block, id, v); live ? saveSoon() : save(); },
    settle: flushSave,
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

// Visão do chão: liga e desliga o espelhamento (CSS) e refaz o encaixe.
export function setFloorView(on) {
  state.floorView = on;
  document.body.classList.toggle('floor', on);
  $('floorView').setAttribute('aria-pressed', on);
  fitBoard();
}

let arrived = false;
export function renderBoard() {
  const nodes = [jack(t('board.jackGuitar'), '🎸')];
  state.chain.forEach((b, i) => {
    const v = ensureView(b);
    v.setNumber(i < 9 ? i + 1 : 0); // número = tecla que liga e desliga
    nodes.push(slot(v.root, i));
  });
  // A saída anda junto com o último pedal: nunca sobra sozinha numa fileira (o que gastaria uma fileira inteira de altura).
  const out = slot(jack(t('board.jackOutput'), '🎧'), state.chain.length);
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
const Z_MIN = .3, Z_MAX = 1.3, Z_TINY = .6;
// Tela larga = nem estreita (telefone em pé) nem baixa (telefone deitado); ver o fim do app.css.
const wide = matchMedia('(min-width: 761px) and (min-height: 501px)');
export const zoom = () => parseFloat(board.style.zoom) || 1;
function setZoom(z) {
  board.style.zoom = z;
  board.style.setProperty('--z', z);
  board.classList.toggle('tiny', z < Z_TINY);
}
const rowsNow = () => countRows([...board.children].map(c => ({ top: c.offsetTop, height: c.offsetHeight })));
let lastRows = 0;
// Tamanho da pedaleira (em unidades dela, sem zoom) no fim do último ajuste. Quando o evento de resize chega, o
// navegador já refez o layout na largura nova; medir ali congelaria a arrumação já mudada.
let fitted = null;
// Tamanho da área no último ajuste. Cada ajuste mede a pedaleira umas 20 vezes (caro no tablet); o observador da área
// avisa também na primeira observação e quando nada mudou de verdade, e aí o ajuste daria o mesmo resultado.
// fittedFonts: as fontes já tinham chegado nesse ajuste (então a chegada delas não muda nada).
let fittedArea = '', fittedFonts = false;
const areaKey = () => `${board.parentElement.clientWidth}x${board.parentElement.clientHeight}`;
const markFitted = () => { fittedArea = areaKey(); fittedFonts = document.fonts?.status === 'loaded'; };
const calm = matchMedia('(prefers-reduced-motion: reduce)');
export function fitBoard({ animate = false, fresh = false } = {}) {
  // Para animar (FLIP): onde cada peça estava antes do ajuste (medido antes de descongelar: é o que está na tela).
  const pieces = [...board.children];
  const before = animate && !calm.matches && !board.classList.contains('arrive') ? pieces.map(p => p.getBoundingClientRect()) : null;
  if (frozen) unfreeze();
  const rowsBefore = lastRows, zBefore = zoom();
  // fresh: como se a página abrisse agora neste tamanho (sem a preferência pelas fileiras de antes).
  if (fresh) lastRows = 0;
  board.style.removeProperty('--squeeze');
  if (!wide.matches) {
    // Telefone: uma fileira que desliza de lado; o zoom faz ela ocupar a altura toda (pedais grandes, um por vez).
    fitted = null; lastRows = 0; board.classList.remove('tiny'); board.parentElement.style.overflow = '';
    const avail = board.parentElement.clientHeight;
    if (avail) setZoom(largestZoom(z => (setZoom(z), board.getBoundingClientRect().height <= avail + .5), .4, 1.6));
    markFitted();
    return;
  }
  // Sem barra de rolagem enquanto mede: no PC ela aparece no meio da busca, rouba 15 px de largura, um pedal desce
  // de fileira e a barra fica (um estado estável, mas errado). Ela só volta se nem no zoom mínimo couber.
  const wrap = board.parentElement;
  wrap.style.overflow = 'hidden';
  const avail = wrap.clientHeight;
  if (!avail) return;
  const height = () => board.getBoundingClientRect().height;
  const fits = z => (setZoom(z), height() <= avail + .5);
  // Nem no mínimo cabe (cadeia muito longa): fica no mínimo e a área da pedaleira rola.
  let z = largestZoom(fits, Z_MIN, Z_MAX);
  setZoom(z);
  // Ficaria com mais fileiras do que agora: só troca se os pedais crescerem bastante (ver keepRows).
  if (lastRows && rowsNow() > lastRows) {
    const zKeep = largestZoom(zz => fits(zz) && rowsNow() <= lastRows, Z_MIN, z);
    setZoom(zKeep);
    if (rowsNow() <= lastRows && keepRows(z, zKeep)) z = zKeep;
    setZoom(z);
  }
  lastRows = rowsNow();
  // Fileiras equilibradas (3 + 3, não 5 + 1): aperta as laterais da pedaleira enquanto o número de fileiras
  // não muda, e os pedais ficam centralizados.
  // (Se nem assim couber, a área vai rolar: aí é melhor ocupar a largura toda, sem apertar.)
  const h = height();
  const squeeze = px => board.style.setProperty('--squeeze', `${px}px`);
  if (h <= avail + .5) squeeze(largestSqueeze(px => (squeeze(px), height() <= h + .5), board.clientWidth / 2));
  wrap.style.overflow = height() > avail + .5 ? 'auto' : 'hidden';
  const r = board.getBoundingClientRect(), zf = zoom();
  fitted = { w: r.width / zf, h: r.height / zf };
  markFitted();
  // Mudou o número de fileiras ou o tamanho deu um salto (o topo trocou de forma): cada peça desliza e muda de
  // tamanho do lugar antigo para o novo, em vez de pular. Mudanças pequenas e contínuas não precisam disso.
  if (before && (fresh || (rowsBefore && (lastRows !== rowsBefore || Math.abs(zoom() / zBefore - 1) > .05)))) glide(pieces, before);
}
function glide(pieces, before) {
  const z = zoom();
  pieces.forEach((p, i) => {
    const a = before[i], b = p.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const dx = (a.left - b.left) / z, dy = (a.top - b.top) / z, s = a.width / b.width;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < .01) return;
    p.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: '0 0' },
      { transform: 'none', transformOrigin: '0 0' },
    ], { duration: 320, easing: 'cubic-bezier(.25, 1, .5, 1)' });
  });
}
// Redimensionar a janela (ou dividir a tela, ou girar): enquanto o tamanho muda, nenhum pedal troca de fileira;
// a pedaleira inteira só muda de escala, como uma foto. Um quarto de segundo depois que o tamanho para de mudar,
// ela é arrumada do zero para o tamanho final, igual a abrir a página nele, e cada pedal desliza uma vez só.
let frozen = null, settleTimer = 0;
function freeze() {
  if (!fitted) return;
  frozen = { ...fitted };
  board.style.width = `${frozen.w}px`;
  board.style.alignSelf = 'center';
}
function unfreeze() {
  frozen = null;
  board.style.width = '';
  board.style.alignSelf = '';
}
function scaleFrozen() {
  const wrap = board.parentElement;
  // Só o zoom muda; --z (tamanho dos botões, legenda) fica como estava para nada trocar de lugar.
  board.style.zoom = frozenZoom(frozen.w, frozen.h, wrap.clientWidth, wrap.clientHeight);
}
addEventListener('resize', () => {
  if (!wide.matches) return;
  if (!frozen && state.chain.length) freeze();
  if (frozen) scaleFrozen();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { settleTimer = 0; fitBoard({ animate: true, fresh: true }); }, 250);
});

let fitQueued = false;
const queueFit = () => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    // No meio de um redimensionamento: só a escala (o ajuste completo vem quando o tamanho parar).
    if (frozen) scaleFrozen();
    else if (!settleTimer) fitBoard({ animate: true });
  });
};
// Muda a área (girar o tablet, abrir os primeiros passos) ou a pedaleira passou da área (carregou uma captura e
// a legenda cresceu): ajusta de novo. Só o "passou" para não entrar em laço com o próprio zoom.
new ResizeObserver(() => { if (areaKey() !== fittedArea) queueFit(); }).observe(board.parentElement);
new ResizeObserver(() => { if (board.getBoundingClientRect().height > board.parentElement.clientHeight + .5) queueFit(); }).observe(board);
wide.addEventListener('change', queueFit);
// Fontes chegaram depois do ajuste: as letras mudaram de largura, ajusta de novo. Se já tinham chegado, nada muda.
document.fonts?.ready.then(() => { if (!fittedFonts) queueFit(); });

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
  const audio = live.get(id)?.audio;
  live.delete(id);
  reconnect().then(() => audio?.dispose()); // depois da troca: descartar antes estalaria
  renderBoard();
  save();
  // Dá 10 s para desfazer (no palco, um toque errado no ✕ não pode custar o pedal e a captura dele).
  finishRemoval();
  removed = { block, index: i, timer: setTimeout(finishRemoval, 10000) };
  toast(t('board.removed', { name: byType[block.type].name }), t('board.undo'), undoRemove);
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
  syncTempoFromChain();
  save();
  status(t('board.restored', { name: byType[block.type].name }));
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
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, started: false, sl0: board.parentElement.scrollLeft };
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
      wrap.style.scrollSnapType = 'none'; // o encaixe brigaria com a rolagem automática
      // Os outros pedais não se movem durante o arraste: mede uma vez, não a cada movimento (evita reflow).
      // Centro de cada um, em coordenadas da página (a pedaleira pode rolar na horizontal e a página na vertical).
      drag.others = [...board.querySelectorAll('.pedal')].filter(p => p !== root);
      drag.mids = drag.others.map(p => {
        const r = p.getBoundingClientRect();
        return { x: r.left + r.width / 2 + wrap.scrollLeft, y: r.top + r.height / 2 + scrollY };
      });
    }
    // Dedo perto da borda (telefone: um pedal por vez na tela): a pedaleira rola sozinha para o lado,
    // até o lugar de destino aparecer.
    const wr = wrap.getBoundingClientRect(), edge = 48;
    if (wrap.scrollWidth > wrap.clientWidth) {
      if (e.clientX < wr.left + edge) wrap.scrollLeft -= 14;
      else if (e.clientX > wr.right - edge) wrap.scrollLeft += 14;
    }
    // Com zoom na pedaleira, o deslocamento dentro dela é multiplicado por ele: divide para o pedal seguir o dedo.
    // A rolagem desde o começo do arraste soma, para o pedal continuar embaixo do dedo.
    const z = zoom();
    root.style.transform = `translate(${(dx + wrap.scrollLeft - drag.sl0) / z}px, ${dy / z}px)`;
    const { others, mids } = drag;
    const x = e.clientX + wrap.scrollLeft, y = e.clientY + scrollY;
    // Fileira mais próxima do dedo (pedais da mesma fileira têm o mesmo centro vertical, com folga
    // para alturas diferentes); dentro dela, entra antes do primeiro pedal à direita do dedo.
    const rowY = mids.reduce((best, m) => (Math.abs(m.y - y) < Math.abs(best - y) ? m.y : best), Infinity);
    const inRow = i => Math.abs(mids[i].y - rowY) < 60;
    // Na visão do chão o sinal corre para a esquerda: "antes" de um pedal é à direita dele.
    let to = mids.findIndex((m, i) => inRow(i) && (state.floorView ? x > m.x : x < m.x));
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
    board.parentElement.style.scrollSnapType = '';
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
    // Esquerda/direita seguem a tela: na visão do chão, ir para a esquerda é andar para depois na cadeia.
    const side = state.floorView ? -1 : 1;
    const dir = { ArrowLeft: -side, ArrowUp: -1, ArrowRight: side, ArrowDown: 1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const from = state.chain.findIndex(b => b.uid === block.uid);
    const to = from + dir;
    if (to < 0 || to >= state.chain.length) return;
    moveBlock(block.uid, dir > 0 ? to + 1 : to);
    grip.focus();
    status(t('board.moved', { name: byType[block.type].name, n: to + 1 }));
  });
  root.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target.closest('.knob, .footswitch, button')) return;
    begin(e);
  });
  for (const el of [grip, root]) {
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
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
  else status(t('board.storedOff', { file: fileName }));
  live.get(block.uid)?.view.update();
}

function selectOption(block, id, option) {
  const i = live.get(block.uid)?.def.controls.find(c => c.id === id)?.options?.indexOf(option);
  if (i >= 0) setParam(block, id, i);
}


function pickLocal(block, kind, accept) {
  fileInput.accept = accept;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    let data;
    try { data = await parseFile(kind, f); } catch {
      status(t('board.invalidFile', { file: f.name, ext: kind === 'nam' ? '.nam' : '.wav' }), true);
      return;
    }
    await storeFile(block, kind, data, f.name);
  };
  fileInput.click();
}

export async function loadFromUrl(block, kind, text, label) {
  let url;
  try { url = directUrl(text); } catch { status(t('board.notLink'), true); return false; }
  const fileName = label || decodeURIComponent(new URL(url).pathname.split('/').pop() || kind);
  status(t('board.downloading', { file: fileName }));
  try {
    await storeFile(block, kind, await fetchFile(kind, url), fileName, url);
    return true;
  } catch (err) {
    status(t('board.downloadFailed', { file: fileName, reason: err.message }), true);
    return false;
  }
}

// Botão NAM / IR: escolher um arquivo do aparelho ou colar um link direto.
export function pickFile(block, kind, accept) {
  const d = $('fileSheet');
  $('fileSheetTitle').textContent = t(kind === 'nam' ? 'board.sheetTitleNam' : 'board.sheetTitleIr', { name: live.get(block.uid).def.name });
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
