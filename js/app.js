// Pedaleira: junta os módulos e inicia o app.
import { loadWasmBytes } from './audio/engine.js';
import { addBlock, directUrl, renderBoard } from './board.js';
import { midi } from './control.js';
import { $, engine, live, save, snapshot, state, status } from './core.js';
import { buildExport, importPresets, loadChain, openSharedLink, renderPresets, shareLink } from './presets.js';
import { renderScenes } from './scenes.js';
import { getFile, persist } from './store.js';
import { installDefs } from './ui/pedal-view.js';
import { PEDALS } from './pedals/index.js';
import './power.js';
import './stage.js';

// ---------- Biblioteca ----------

// Agrupada pela posição na cadeia, na ordem em que o sinal passa.
const GROUPS = [
  ['Afinar e filtrar', ['tuner', 'filter']],
  ['Dinâmica', ['comp', 'gate', 'volume']],
  ['Drive e amp', ['drive', 'amp', 'eq']],
  ['Modulação', ['mod']],
  ['Delay, reverb e looper', ['time', 'looper']],
];
const addButton = def => {
  const b = document.createElement('button');
  b.className = 'add';
  b.innerHTML = `<span class="swatch ${def.look.style}" aria-hidden="true"></span><span><b></b><small></small></span>`;
  b.querySelector('.swatch').style.setProperty('--body', def.look.body);
  b.querySelector('b').textContent = def.name;
  b.querySelector('small').textContent = def.inspiredBy ? `inspirado no ${def.inspiredBy}` : 'amp + caixa, aceita captura NAM';
  // Fecha a gaveta para o pedal novo ser visto pousando na pedaleira.
  b.onclick = () => { $('libSheet').close(); addBlock(def.type); };
  return b;
};
$('library').replaceChildren(...GROUPS.map(([title, cats]) => {
  const group = document.createElement('section');
  group.className = 'lib-group';
  const h = document.createElement('h3');
  h.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'lib-grid';
  grid.append(...PEDALS.filter(d => cats.includes(d.category)).map(addButton));
  group.append(h, grid);
  return group;
}));

// Gaveta da biblioteca: abre por cima da pedaleira, que assim ocupa a tela inteira (tablet sem rolagem).
$('libOpen').onclick = () => $('libSheet').showModal();
$('libClose').onclick = () => $('libSheet').close();
// Toque fora da gaveta (no fundo escurecido) fecha.
$('libSheet').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  if (e.target === e.currentTarget && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) e.currentTarget.close();
});

// ---------- Início ----------

installDefs();
renderBoard();
renderPresets();
renderScenes();
// Acesso para depuração pelo console e para os testes no navegador.
window.__pedaleira = { engine, get state() { return state; }, live, midi, buildExport, importPresets, getFile, shareLink, openSharedLink, loadChain, snapshot, directUrl };
openSharedLink();
// Instalar como app: Chrome/Edge/Android oferecem o evento; no iPhone, o caminho é pelo menu Compartilhar.
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('install').hidden = false; });
addEventListener('appinstalled', () => { $('install').hidden = true; status('Brasa instalada como app.'); });
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (iOS && !standalone) $('install').hidden = false;
$('install').onclick = async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('install').hidden = true;
  } else if (iOS) status('Para instalar no iPhone/iPad: toque em Compartilhar (□↑) e depois em "Adicionar à Tela de Início".');
};

// Navegador sem AudioWorklet (muito antigo): avisa logo, antes de tentar ligar.
if (!window.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia)
  status('Este navegador não tem o que a Brasa precisa (AudioWorklet e entrada de áudio). Use Chrome, Edge, Firefox ou Safari atualizados.', true);
persist();

$('intro').hidden = state.introDone;
$('introOk').onclick = () => { state.introDone = true; $('intro').hidden = true; save(); };

$('moreBtn').onclick = () => {
  const open = $('presetsRow').classList.toggle('show-more');
  $('moreBtn').setAttribute('aria-expanded', open);
};
addEventListener('hashchange', openSharedLink);
loadWasmBytes();
if ('serviceWorker' in navigator && location.protocol !== 'file:')
  navigator.serviceWorker.register('sw.js').catch(() => {});
// Aviso cortado em uma linha (tablet e PC): um toque mostra inteiro.
$('status').onclick = e => e.currentTarget.classList.toggle('full');

// Fim da inicialização: a guarda do index.html deixa de esperar (ver #bootFail).
document.documentElement.dataset.ready = '1';
