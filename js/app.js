// Pedaleira: junta os módulos e inicia o app.
import './i18n-apply.js';
import { LANGS, lang, setLang, t } from './i18n.js';
import { loadWasmBytes } from './audio/engine.js';
import { addBlock, directUrl, renderBoard, setFloorView } from './board.js';
import { midi } from './control.js';
import { $, engine, live, save, snapshot, state, status } from './core.js';
import { buildExport, importPresets, loadChain, openSharedLink, renderPresets, shareLink } from './presets.js';
import { renderScenes } from './scenes.js';
import { isNative } from './platform.js';
import { getFile, persist } from './store.js';
import { installDefs } from './ui/pedal-view.js';
import { PEDALS } from './pedals/index.js';
import './power.js';
import './stage.js';

// ---------- Biblioteca ----------

// Agrupada pela posição na cadeia, na ordem em que o sinal passa.
const GROUPS = [
  ['app.groupTune', ['tuner', 'filter']],
  ['app.groupDynamics', ['comp', 'gate', 'volume']],
  ['app.groupDrive', ['drive', 'amp', 'eq']],
  ['app.groupMod', ['mod']],
  ['app.groupTime', ['time', 'looper']],
];
const addButton = def => {
  const b = document.createElement('button');
  b.className = 'add';
  b.innerHTML = `<span class="swatch ${def.look.style}" aria-hidden="true"></span><span><b></b><small></small></span>`;
  b.querySelector('.swatch').style.setProperty('--body', def.look.body);
  b.querySelector('b').textContent = def.name;
  b.querySelector('small').textContent = def.inspiredBy ? t('app.inspired', { name: def.inspiredBy }) : t('app.ampDesc');
  // Fecha a gaveta para o pedal novo ser visto pousando na pedaleira.
  b.onclick = () => { $('libSheet').close(); addBlock(def.type); };
  return b;
};
$('library').replaceChildren(...GROUPS.map(([title, cats]) => {
  const group = document.createElement('section');
  group.className = 'lib-group';
  const h = document.createElement('h3');
  h.textContent = t(title);
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
setFloorView(state.floorView);
renderBoard();
renderPresets();
renderScenes();
// Acesso para depuração pelo console e para os testes no navegador.
window.__pedaleira = { engine, get state() { return state; }, live, midi, buildExport, importPresets, getFile, shareLink, openSharedLink, loadChain, snapshot, directUrl };
openSharedLink();
// Instalar como app: Chrome/Edge/Android oferecem o evento; no iPhone, o caminho é pelo menu Compartilhar.
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('install').hidden = false; });
addEventListener('appinstalled', () => { $('install').hidden = true; status(t('app.installed')); });
// App nativo (Android/iOS): já é instalado e abre sem barras, como o PWA da tela de início.
const standalone = isNative || matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (iOS && !standalone) $('install').hidden = false;

// Tela cheia (navegador comum; instalada, ela já abre sem barras). No iPad o Safari usa o prefixo webkit.
const root = document.documentElement;
const enterFs = root.requestFullscreen || root.webkitRequestFullscreen;
const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
const inFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
$('fullscreen').hidden = !enterFs || standalone;
const syncFs = () => {
  $('fullscreen').setAttribute('aria-pressed', inFs());
  $('fullscreen').setAttribute('aria-label', t(inFs() ? 'app.fsExit' : 'app.fsEnter'));
};
$('fullscreen').onclick = () => Promise.resolve(inFs() ? exitFs.call(document) : enterFs.call(root))
  .catch(e => status(t('app.fsDenied', { msg: e.message }), true));
document.addEventListener('fullscreenchange', syncFs);
document.addEventListener('webkitfullscreenchange', syncFs);
$('install').onclick = async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('install').hidden = true;
  } else if (iOS) status(t('app.iosInstall'));
};

// Navegador sem AudioWorklet (muito antigo): avisa logo, antes de tentar ligar.
if (!window.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia)
  status(t('app.unsupported'), true);
persist();

$('intro').hidden = state.introDone;
$('introOk').onclick = () => { state.introDone = true; $('intro').hidden = true; save(); };

$('moreBtn').onclick = () => {
  const open = $('presetsRow').classList.toggle('show-more');
  $('moreBtn').setAttribute('aria-expanded', open);
};
addEventListener('hashchange', openSharedLink);
loadWasmBytes();
// No app nativo os arquivos vêm empacotados: o service worker não teria o que guardar.
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isNative)
  navigator.serviceWorker.register('sw.js').catch(() => {});
$('floorView').onclick = () => { setFloorView(!state.floorView); save(); status(t(state.floorView ? 'app.floorOn' : 'app.floorOff')); };

// Telefone: gaveta de entrada e volume (no tablet e no PC essa faixa fica sempre à vista no topo).
const setRack = on => { document.body.classList.toggle('rack-on', on); $('rackOpen').setAttribute('aria-expanded', on); };
$('rackOpen').onclick = () => setRack(true);
$('rackClose').onclick = () => setRack(false);
// Toque fora da gaveta (no fundo escurecido) fecha; Esc também.
document.addEventListener('pointerdown', e => {
  if (document.body.classList.contains('rack-on') && !e.target.closest('#rack, #rackOpen')) setRack(false);
});
addEventListener('keydown', e => { if (e.key === 'Escape') setRack(false); });

// Idioma: escolhido no ⋯ (padrão: o do sistema). Trocar recarrega a página.
$('lang').replaceChildren(...Object.entries(LANGS).map(([code, name]) => new Option(name, code, false, code === lang)));
$('lang').onchange = e => setLang(e.target.value);

// Aviso cortado em uma linha (tablet e PC): um toque mostra inteiro.
$('status').onclick = e => e.currentTarget.classList.toggle('full');

// Fim da inicialização: a guarda do index.html deixa de esperar (ver #bootFail).
document.documentElement.dataset.ready = '1';
