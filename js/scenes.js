// Cenas dentro do preset.
import { $, changeListeners, live, save, SCENE_NAMES, state, status } from './core.js';
import { byType } from './pedals/index.js';

// ---------- Cenas ----------
// Uma cena liga e desliga vários pedais de uma vez (ex.: A = base, B = solo), dentro do mesmo preset.
// Cada pedal guarda o próprio estado em cada cena; pedais adicionados depois ficam como estão.

let recordingScene = false;
export const sceneButtons = [...document.querySelectorAll('.scene-btn')];
export const sceneUsed = i => state.chain.some(b => b.scenes[i] !== null);
// Cena que bate com o que está ligado agora (para acender o botão).
export const sceneActive = i => sceneUsed(i) && state.chain.every(b => b.scenes[i] === null || b.scenes[i] === b.on);

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
  const on = state.chain.filter(b => b.scenes[i]).map(b => byType[b.type].name);
  return on.length ? `liga ${on.join(', ')}` : 'tudo desligado';
}

export function recallScene(i) {
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

export function storeScene(i) {
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
