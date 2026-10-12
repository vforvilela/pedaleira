// Modo palco: tela cheia com o preset em letras grandes, as cenas A–D, um botão grande por pedal
// e a nota do afinador. Pensado para o celular no chão ou no pedestal, no escuro.
import { $, changeListeners, live, SCENE_NAMES, setParam, state, toggleBlock } from './core.js';
import { byType } from './pedals/index.js';
import { stepPreset, isDirty } from './presets.js';
import { recallScene, sceneActive, sceneUsed } from './scenes.js';

const stage = $('stage');
const isOn = () => document.body.classList.contains('stage');

export function enterStage() {
  document.body.classList.add('stage');
  stage.hidden = false;
  renderStage();
  document.documentElement.requestFullscreen?.().catch(() => {});
  $('stageExit').focus();
}

export function exitStage() {
  document.body.classList.remove('stage');
  stage.hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('stageBtn').focus();
}

changeListeners.push(() => { if (isOn()) renderStage(); });
export function renderStage() {
  $('stagePreset').textContent = state.preset ? `${state.preset}${isDirty() ? ' *' : ''}` : 'Sem preset';
  const idx = state.presets.findIndex(p => p.name === state.preset);
  $('stageCount').textContent = state.presets.length ? `${idx + 1 || '–'} de ${state.presets.length}` : '';
  [...$('stageScenes').children].forEach((b, i) => {
    b.classList.toggle('used', sceneUsed(i));
    b.setAttribute('aria-pressed', sceneActive(i));
  });
  renderExpression();
  const pedals = $('stagePedals');
  pedals.replaceChildren(...state.chain.map((b, i) => {
    const def = byType[b.type];
    const btn = document.createElement('button');
    btn.className = 'stage-pedal';
    // Looper: o botão mostra o estado (gravando, tocando…) em vez de ligado/desligado.
    const loop = live.get(b.uid)?.audio?.state;
    btn.setAttribute('aria-pressed', def.press ? !!loop && loop !== 'empty' && loop !== 'stop' : b.on);
    if (def.press) btn.dataset.state = loop || '';
    btn.style.setProperty('--body', def.look.body);
    btn.innerHTML = `<span class="led"></span><b></b><small></small>`;
    btn.querySelector('b').textContent = def.name;
    btn.querySelector('small').textContent = def.press && loop ? { empty: 'vazio', rec: 'GRAVANDO', play: 'tocando', dub: 'SOBREPONDO', stop: 'parado' }[loop] : i < 9 ? String(i + 1) : '';
    btn.onclick = () => toggleBlock(b);
    return btn;
  }));
}

// Wah e volume: um fader grande por pedal de expressão. Só recria quando muda o conjunto de pedais,
// senão a re-renderização a cada movimento interromperia o arraste.
let exprKey = '';
function renderExpression() {
  const blocks = state.chain.filter(b => byType[b.type].look.style === 'treadle');
  const key = blocks.map(b => b.uid).join();
  const box = $('stageExpr');
  if (key !== exprKey) {
    exprKey = key;
    box.replaceChildren(...blocks.map(b => {
      const def = byType[b.type], c = def.controls[0];
      const label = document.createElement('label');
      label.className = 'stage-expr';
      label.dataset.uid = b.uid;
      label.innerHTML = '<input type="range" min="0" max="10" step="0.1"><span></span>';
      label.querySelector('span').textContent = def.name;
      const input = label.querySelector('input');
      input.setAttribute('aria-label', `${def.name}: ${c.label}`);
      input.oninput = () => setParam(b, c.id, +input.value);
      return label;
    }));
  }
  box.hidden = !blocks.length;
  for (const label of box.children) {
    const b = state.chain.find(x => x.uid === label.dataset.uid);
    const input = label.querySelector('input');
    if (b && document.activeElement !== input) input.value = b.params[byType[b.type].controls[0].id];
    label.classList.toggle('off', !b?.on);
  }
}

// Chamado pelos afinadores: com algum ligado, a nota aparece grande no meio da tela.
export function setStageTuner(r, active) {
  const t = $('stageTuner');
  t.hidden = !active;
  if (!active) return;
  const inTune = r && Math.abs(r.cents) < 3;
  t.classList.toggle('ok', !!inTune);
  t.querySelector('b').textContent = r ? `${r.note}${r.octave}` : '–';
  t.querySelector('small').textContent = r ? `${r.cents > 0 ? '+' : ''}${Math.round(r.cents)}¢` : '';
  // A agulha ocupa a barra inteira: deslocar c% dela põe o ponteiro a c% do centro (±50¢ = ponta).
  t.querySelector('i').style.transform = `translateX(${r ? Math.max(-50, Math.min(50, r.cents)) : 0}%)`;
}

$('stageBtn').onclick = enterStage;
$('stageExit').onclick = exitStage;
$('stagePrev').onclick = () => stepPreset(-1);
$('stageNext').onclick = () => stepPreset(1);
$('stageScenes').replaceChildren(...SCENE_NAMES.map((n, i) => {
  const b = document.createElement('button');
  b.className = 'stage-scene';
  b.textContent = n;
  b.setAttribute('aria-label', `Cena ${n}`);
  b.onclick = () => recallScene(i);
  return b;
}));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOn()) exitStage(); });
