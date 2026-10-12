// Pedaleira: junta os módulos e inicia o app.
import { loadWasmBytes } from './audio/engine.js';
import { addBlock, renderBoard } from './board.js';
import { midi } from './control.js';
import { $, engine, live, state } from './core.js';
import { buildExport, importPresets, openSharedLink, renderPresets, shareLink } from './presets.js';
import { renderScenes } from './scenes.js';
import { getFile } from './store.js';
import { installDefs } from './ui/pedal-view.js';
import { PEDALS } from './pedals/index.js';
import './power.js';
import './stage.js';

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
window.__pedaleira = { engine, get state() { return state; }, live, midi, buildExport, importPresets, getFile, shareLink, openSharedLink };
openSharedLink();
addEventListener('hashchange', openSharedLink);
loadWasmBytes();
if ('serviceWorker' in navigator && location.protocol !== 'file:')
  navigator.serviceWorker.register('sw.js').catch(() => {});
