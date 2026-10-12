// Controle pelo pé: MIDI e teclado (inclusive footswitch Bluetooth de virar página).
import { $, blockByUid, closest, save, SCENE_NAMES, setParam, state, status, tapTempo, toggleBlock } from './core.js';
import { Midi, midiSupported } from './midi.js';
import { byType } from './pedals/index.js';
import { applyPreset, stepPreset } from './presets.js';
import { recallScene, sceneButtons } from './scenes.js';

// ---------- Controle: MIDI e teclado ----------


export function runAction(target, msg) {
  if (target.kind === 'program') {
    const p = state.presets[msg.program];
    if (p) applyPreset(p.name);
    return;
  }
  // msg.trigger: pisada que conta (ver midi.js). Teclado e cliques chegam sem msg.
  const fires = !msg || msg.trigger !== false;
  if (target.kind === 'preset') { if (fires) stepPreset(target.dir); return; }
  if (target.kind === 'scene') { if (fires) recallScene(target.index); return; }
  const block = blockByUid(target.uid);
  if (!block) return;
  if (target.kind === 'knob') {
    const c = byType[block.type].controls.find(c => c.id === target.param);
    if (!c) return;
    const max = c.type === 'select' ? c.options.length - 1 : 10;
    const v = c.type === 'select' ? Math.round((msg.value / 127) * max) : Math.round((msg.value / 127) * 100) / 10;
    setParam(block, c.id, v);
  } else if (fires) {
    if (target.kind === 'toggle') toggleBlock(block);
    else if (target.kind === 'tap') tapTempo(block);
  }
}

export function describeTarget(t) {
  if (t.kind === 'preset') return t.dir > 0 ? 'próximo preset' : 'preset anterior';
  if (t.kind === 'scene') return `cena ${SCENE_NAMES[t.index]}`;
  const b = blockByUid(t.uid), name = b ? byType[b.type].name : 'pedal';
  if (t.kind === 'toggle') return `${name} (liga/desliga)`;
  if (t.kind === 'tap') return `${name} (TAP)`;
  return `${name} → ${t.param.toUpperCase()}`;
}

export const midi = new Midi(state.midi, {
  onAction: runAction,
  onChange: save,
  onLearned(target, msg) { status(`MIDI: ${msg.label} → ${describeTarget(target)}. Escolha outro alvo ou clique em MIDI para sair.`); },
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

if (midiSupported()) {
  $('midi').hidden = false;
  $('midi').onclick = async () => {
    if (learning) { setLearning(false); status('MIDI pronto.'); return; }
    try {
      await midi.enable();
    } catch {
      status('O navegador não deu acesso ao MIDI.', true);
      return;
    }
    setLearning(true);
    const names = midi.inputNames();
    status(`${names.length ? `Controlador: ${names.join(', ')}.` : 'Nenhum controlador MIDI conectado.'} Toque no que quer controlar (pedal, TAP, botão, cena, ◀ ▶) e depois pise no controlador.`);
  };
  $('midiClear').onclick = () => {
    state.midi.splice(0);
    save();
    status('Todos os mapeamentos MIDI foram apagados.');
  };
  // Liga o MIDI sozinho se já houver mapeamentos (o navegador lembra a permissão).
  if (state.midi.length) midi.enable().catch(() => {});
}

// No modo de aprendizado, um toque escolhe o alvo em vez de agir.
document.addEventListener('pointerdown', e => {
  if (!learning) return;
  const el = closest(e, '.footswitch, .tap-btn, .knob, .scene-btn, #presetPrev, #presetNext');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  let target;
  if (el.id === 'presetPrev' || el.id === 'presetNext') target = { kind: 'preset', dir: el.id === 'presetNext' ? 1 : -1 };
  else if (el.classList.contains('scene-btn')) target = { kind: 'scene', index: sceneButtons.indexOf(el) };
  else {
    const id = el.closest('.pedal')?.dataset.uid;
    if (!id) return;
    if (el.classList.contains('footswitch')) target = { kind: 'toggle', uid: id };
    else if (el.classList.contains('tap-btn')) target = { kind: 'tap', uid: id };
    else target = { kind: 'knob', uid: id, param: el.dataset.param };
  }
  document.querySelectorAll('.learn-target').forEach(x => x.classList.remove('learn-target'));
  el.classList.add('learn-target');
  midi.learn(target);
  status(`Agora pise no botão do controlador para: ${describeTarget(target)}.`);
}, true);
document.addEventListener('click', e => {
  if (learning && closest(e, '.footswitch, .tap-btn, .knob, .scene-btn, #presetPrev, #presetNext')) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Teclado do computador como footswitch: 1–9 liga/desliga o pedal na posição, T = tap, [ ] = presets,
// A–D = cenas. Setas e PageUp/PageDown também trocam de preset: é o que mandam os footswitches
// Bluetooth de virar página (que funcionam como teclado no celular, inclusive no iPhone).
export const PREV_KEYS = new Set(['[', 'ArrowLeft', 'ArrowUp', 'PageUp']);
export const NEXT_KEYS = new Set([']', 'ArrowRight', 'ArrowDown', 'PageDown']);
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || closest(e, 'input, select, textarea, .knob')) return;
  const scene = 'abcd'.indexOf(e.key.toLowerCase());
  if (e.key.length === 1 && scene >= 0) recallScene(scene);
  else if (/^[1-9]$/.test(e.key)) {
    const b = state.chain[+e.key - 1];
    if (b) { toggleBlock(b); status(`${byType[b.type].name}: ${b.on ? 'ligado' : 'desligado'}`); }
  } else if (e.key === 't' || e.key === 'T') {
    const b = state.chain.find(b => byType[b.type].tap);
    if (b) tapTempo(b);
  } else if (PREV_KEYS.has(e.key)) stepPreset(-1);
  else if (NEXT_KEYS.has(e.key)) stepPreset(1);
  else return;
  e.preventDefault();
});
