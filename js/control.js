// Controle pelo pé: MIDI e teclado (inclusive footswitch Bluetooth de virar página).
import { undoRemove } from './board.js';
import { t } from './i18n.js';
import { $, blockByUid, closest, save, SCENE_NAMES, setParam, state, status, tapGlobal, tapTempo, toggleBlock } from './core.js';
import { Midi, midiSupported } from './midi.js';
import { hasNativeMidi, nativeMidi, pairBluetoothMidi, platform } from './platform.js';
import { byType } from './pedals/index.js';
import { applyPreset, stepPreset, presetForProgram } from './presets.js';
import { recallScene, sceneButtons } from './scenes.js';

// ---------- Controle: MIDI e teclado ----------


export function runAction(target, msg) {
  if (target.kind === 'program') {
    const p = presetForProgram(msg.program);
    if (p) applyPreset(p.name);
    return;
  }
  // msg.trigger: pisada que conta (ver midi.js). Teclado e cliques chegam sem msg.
  const fires = !msg || msg.trigger !== false;
  if (target.kind === 'tempo') { if (fires) tapGlobal(); return; }
  if (target.kind === 'tuner') { if (fires) import('./power.js').then(m => m.toggleGlobalTuner()); return; }
  if (target.kind === 'preset') { if (fires) stepPreset(target.dir); return; }
  if (target.kind === 'scene') { if (fires) recallScene(target.index); return; }
  // O mapeamento lembra o pedal onde foi aprendido; em outro preset (outro uid), vale o primeiro pedal do mesmo
  // tipo: o pedal de expressão no wah funciona em todas as músicas, como nas pedaleiras digitais.
  let block = blockByUid(target.uid);
  if (block && !target.type) { target.type = block.type; save(); } // mapeamentos antigos aprendem o tipo
  if (!block && target.type) block = state.chain.find(b => b.type === target.type);
  if (!block) return;
  if (target.kind === 'knob') {
    const c = byType[block.type].controls.find(c => c.id === target.param);
    if (!c) return;
    const max = c.type === 'select' ? c.options.length - 1 : 10;
    const v = c.type === 'select' ? Math.round((msg.value / 127) * max) : Math.round((msg.value / 127) * 100) / 10;
    setParam(block, c.id, v);
    if (block.type === 'ua' && c.id === 'pedal') autoEngage(block, v);
  } else if (fires) {
    if (target.kind === 'toggle') toggleBlock(block);
    else if (target.kind === 'tap') tapTempo(block);
  }
}

// Auto-engage do Uá pelo pedal de expressão: sair do calcanhar liga; parado no calcanhar por meio segundo, desliga.
let heelTimer = 0;
function autoEngage(block, v) {
  clearTimeout(heelTimer);
  if (v > 0.6) { if (!block.on) toggleBlock(block); return; }
  if (block.on) heelTimer = setTimeout(() => { if (block.on && block.params.pedal <= 0.6) toggleBlock(block); }, 500);
}

export function describeTarget(tg) {
  if (tg.kind === 'tempo') return t('control.tempo');
  if (tg.kind === 'tuner') return t('control.tuner');
  if (tg.kind === 'preset') return tg.dir > 0 ? t('control.nextPreset') : t('control.prevPreset');
  if (tg.kind === 'scene') return t('control.scene', { name: SCENE_NAMES[tg.index] });
  const b = blockByUid(tg.uid), name = b ? byType[b.type].name : t('control.pedal');
  if (tg.kind === 'toggle') return t('control.toggle', { name });
  if (tg.kind === 'tap') return `${name} (TAP)`;
  return `${name} → ${tg.param.toUpperCase()}`;
}

export const midi = new Midi(state.midi, {
  native: nativeMidi,
  onAction: runAction,
  onChange: save,
  onLearned(target, msg) { status(t('control.learned', { msg: t(`control.midi.${msg.kind}`, { n: msg.n, ch: msg.ch }), target: describeTarget(target) })); },
});

let learning = false;
export function setLearning(on) {
  learning = on;
  document.body.classList.toggle('midi-learn', on);
  $('midi').setAttribute('aria-pressed', on);
  $('midiClear').hidden = !on;
  midi.learn(null);
  if (!on) document.querySelectorAll('.learn-target').forEach(x => x.classList.remove('learn-target'));
}

if (midiSupported() || hasNativeMidi) {
  $('midi').hidden = false;
  $('midi').onclick = async () => {
    if (learning) { setLearning(false); status(t('control.midiReady')); return; }
    try {
      await midi.enable();
    } catch {
      status(t('control.midiDenied'), true);
      return;
    }
    setLearning(true);
    // App nativo: procura o footswitch Bluetooth. No Android a busca é silenciosa, então roda sempre; no iPhone
    // abre o painel de parear do sistema, só quando não há nenhum controlador ligado.
    if (hasNativeMidi && (platform === 'android' || !midi.inputNames().length)) pairBluetoothMidi().catch(() => {});
    const names = midi.inputNames();
    status(`${names.length ? t('control.controllers', { names: names.join(', ') }) : t('control.noController')} ${t('control.learnHowTo')}`);
  };
  $('midiClear').onclick = () => {
    state.midi.splice(0);
    save();
    status(t('control.midiCleared'));
  };
  // Liga o MIDI sozinho se já houver mapeamentos (o navegador lembra a permissão).
  if (state.midi.length) midi.enable().catch(() => {});
}

// No modo de aprendizado, um toque escolhe o alvo em vez de agir.
document.addEventListener('pointerdown', e => {
  if (!learning) return;
  const el = closest(e, '.footswitch, .tap-btn, .knob, .scene-btn, #presetPrev, #presetNext, #tempo, #stageTune');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  let target;
  if (el.id === 'tempo') target = { kind: 'tempo' };
  else if (el.id === 'stageTune') target = { kind: 'tuner' };
  else if (el.id === 'presetPrev' || el.id === 'presetNext') target = { kind: 'preset', dir: el.id === 'presetNext' ? 1 : -1 };
  else if (el.classList.contains('scene-btn')) target = { kind: 'scene', index: sceneButtons.indexOf(el) };
  else {
    const id = el.closest('.pedal')?.dataset.uid;
    if (!id) return;
    const type = state.chain.find(b => b.uid === id)?.type;
    if (el.classList.contains('footswitch')) target = { kind: 'toggle', uid: id, type };
    else if (el.classList.contains('tap-btn')) target = { kind: 'tap', uid: id, type };
    else target = { kind: 'knob', uid: id, type, param: el.dataset.param };
  }
  document.querySelectorAll('.learn-target').forEach(x => x.classList.remove('learn-target'));
  el.classList.add('learn-target');
  midi.learn(target);
  status(t('control.pressNow', { target: describeTarget(target) }));
}, true);
document.addEventListener('click', e => {
  if (learning && closest(e, '.footswitch, .tap-btn, .knob, .scene-btn, #presetPrev, #presetNext, #tempo, #stageTune')) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Teclado do computador como footswitch: 1–9 liga/desliga o pedal na posição, T = tap, [ ] = presets,
// A–D = cenas. Setas e PageUp/PageDown também trocam de preset: é o que mandam os footswitches
// Bluetooth de virar página (que funcionam como teclado no celular, inclusive no iPhone).
export const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const stageOn = () => document.body.classList.contains('stage');
const PREV_KEYS = new Set(['[', 'ArrowLeft', 'ArrowUp', 'PageUp']);
export const NEXT_KEYS = new Set([']', 'ArrowRight', 'ArrowDown', 'PageDown']);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !closest(e, 'input, textarea')) { undoRemove(); e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || closest(e, 'input, select, textarea, .knob')) return;
  // Setas só trocam de preset sem nada em foco (ou no modo palco): com foco num botão, elas são do botão.
  if (ARROWS.has(e.key) && !stageOn() && document.activeElement && document.activeElement !== document.body) return;
  const scene = 'abcd'.indexOf(e.key.toLowerCase());
  if (e.key.length === 1 && scene >= 0) { if (state.simple) return; recallScene(scene); }
  else if (/^[1-9]$/.test(e.key)) {
    const b = state.chain[+e.key - 1];
    if (b) { toggleBlock(b); if (!byType[b.type].press) status(t(b.on ? 'control.pedalOn' : 'control.pedalOff', { name: byType[b.type].name })); }
  } else if (e.key === 't' || e.key === 'T') {
    tapGlobal();
  } else if (e.key === 'u' || e.key === 'U') {
    import('./power.js').then(m => m.toggleGlobalTuner());
  } else if (PREV_KEYS.has(e.key)) stepPreset(-1);
  else if (NEXT_KEYS.has(e.key)) stepPreset(1);
  else return;
  e.preventDefault();
});
