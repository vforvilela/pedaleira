// Cenas dentro do preset.
import { $, changeListeners, live, save, SCENE_NAMES, sceneMatches, state, status } from './core.js';
import { byType } from './pedals/index.js';
import { t } from './i18n.js';

// ---------- Cenas ----------
// Uma cena liga e desliga vários pedais e muda a posição dos botões de uma vez (ex.: A = base, B = solo
// com mais volume e delay), dentro do mesmo preset, como o snapshot das pedaleiras digitais.
// Cada pedal guarda o próprio estado em cada cena; pedais adicionados depois ficam como estão.

let recordingScene = false;
export const sceneButtons = [...document.querySelectorAll('.scene-btn')];
export const sceneUsed = i => state.chain.some(b => b.scenes[i] !== null);
// Cena que bate com o que está ligado agora (para acender o botão).
export const sceneActive = i => sceneUsed(i) && state.chain.every(b => sceneMatches(b, i));

changeListeners.push(() => renderScenes());
export function renderScenes() {
  sceneButtons.forEach((btn, i) => {
    btn.classList.toggle('used', sceneUsed(i));
    btn.setAttribute('aria-pressed', sceneActive(i));
  });
  $('sceneRec').setAttribute('aria-pressed', recordingScene);
  $('scenes').classList.toggle('recording', recordingScene);
}

export function sceneSummary(i) {
  const on = state.chain.filter(b => b.scenes[i]?.on).map(b => byType[b.type].name);
  return on.length ? t('scenes.turnsOn', { names: on.join(', ') }) : t('scenes.allOff');
}

export function recallScene(i) {
  if (!sceneUsed(i)) {
    status(t('scenes.empty', { name: SCENE_NAMES[i] }));
    return;
  }
  for (const b of state.chain) {
    const s = b.scenes[i];
    if (!s || sceneMatches(b, i)) continue;
    const l = live.get(b.uid);
    for (const [id, v] of Object.entries(s.params || {}))
      if (b.params[id] !== v) { b.params[id] = v; l?.audio?.set(id, v); }
    if (b.on !== s.on) { b.on = s.on; l?.audio?.setOn(s.on); }
    l?.view?.update();
  }
  save();
  status(t('scenes.recalled', { name: SCENE_NAMES[i], summary: sceneSummary(i) }));
}

export function storeScene(i) {
  for (const b of state.chain) b.scenes[i] = { on: b.on, params: { ...b.params } };
  recordingScene = false;
  save();
  status(t('scenes.stored', { name: SCENE_NAMES[i], summary: sceneSummary(i) }));
}

sceneButtons.forEach((btn, i) => { btn.onclick = () => (recordingScene ? storeScene(i) : recallScene(i)); });
$('sceneRec').onclick = () => {
  recordingScene = !recordingScene;
  renderScenes();
  status(recordingScene ? t('scenes.recordHowTo') : '');
};
