// Cenas dentro do preset.
import { $, changeListeners, live, save, SCENE_NAMES, sceneMatches, setTrim, state, status, syncTempoFromChain } from './core.js';
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
// Nome da cena ("Solo") ou a letra.
export const sceneLabel = i => state.sceneMeta[i]?.name || SCENE_NAMES[i];
export function renderScenes() {
  sceneButtons.forEach((btn, i) => {
    btn.classList.toggle('used', sceneUsed(i));
    btn.setAttribute('aria-pressed', sceneActive(i));
    const name = state.sceneMeta[i]?.name;
    btn.textContent = name || SCENE_NAMES[i];
    btn.classList.toggle('named', !!name);
    btn.title = t(name ? 'scenes.titleNamed' : 'scenes.title', { letter: SCENE_NAMES[i], name });
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
  // Nível e andamento da cena (gravados com ela); sem eles, o andamento vem do Pulso.
  const meta = state.sceneMeta[i];
  if (typeof meta?.trim === 'number') setTrim(meta.trim);
  syncTempoFromChain(meta?.bpm ?? null);
  save();
  status(t('scenes.recalled', { name: sceneLabel(i), summary: sceneSummary(i) }));
}

export function storeScene(i) {
  for (const b of state.chain) b.scenes[i] = { on: b.on, params: { ...b.params } };
  state.sceneMeta[i] = { name: state.sceneMeta[i]?.name || '', trim: state.trim, bpm: state.bpm };
  recordingScene = false;
  save();
  status(t('scenes.stored', { name: sceneLabel(i), summary: sceneSummary(i) }));
}

// Nome da cena: duplo clique (ou toque longo) no botão. Vazio volta à letra.
export function renameScene(i) {
  const cur = state.sceneMeta[i]?.name || '';
  const name = prompt(t('scenes.namePrompt', { letter: SCENE_NAMES[i] }), cur);
  if (name === null) return;
  state.sceneMeta[i] = { ...(state.sceneMeta[i] || {}), name: name.trim().slice(0, 16) };
  save();
}

sceneButtons.forEach((btn, i) => {
  let hold = 0, held = false;
  // O click que vem depois de um toque longo (que abriu o nome) não chama nem grava a cena.
  btn.onclick = () => { if (held) { held = false; return; } recordingScene ? storeScene(i) : recallScene(i); };
  btn.ondblclick = () => renameScene(i);
  btn.addEventListener('pointerdown', e => { held = false; if (e.pointerType === 'touch') hold = setTimeout(() => { held = true; renameScene(i); }, 600); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => clearTimeout(hold));
});
$('sceneRec').onclick = () => {
  recordingScene = !recordingScene;
  renderScenes();
  status(recordingScene ? t('scenes.recordHowTo') : '');
};
