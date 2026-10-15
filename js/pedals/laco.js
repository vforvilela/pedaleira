// Looper inspirado no TC Electronic Ditto: pise para gravar, pise para tocar, pise para sobrepor.
// Duas pisadas rápidas param. STOP, DESFAZER (a última camada; de novo, refaz) e APAGAR ficam embaixo do pedal.
// SYNC: o tamanho do loop fecha em batidas do andamento global (1, 2 ou 4), para o loop não "andar" com o Pulso.
import { monoWorklet } from './common.js';
import { t } from '../i18n.js';

// Getters: o texto sai no idioma da página quando é mostrado.
const LABELS = {
  get empty() { return t('pedals.loopEmpty'); },
  get rec() { return t('pedals.loopRec'); },
  get play() { return t('pedals.loopPlay'); },
  get dub() { return t('pedals.loopDub'); },
  get stop() { return t('pedals.loopStop'); },
};

export const SYNC = ['OFF', '1', '2', '4'];
const SYNC_BEATS = [0, 1, 2, 4];

export default {
  type: 'laco',
  name: 'Laço',
  inspiredBy: 'TC Electronic Ditto',
  category: 'looper',
  press: true,
  syncsTempo: true,
  stateLabels: LABELS,
  look: { style: 'stomp', body: '#cfd2d6', ink: '#202225', accent: '#202225', subtitle: 'Looper', led: '#3aa0ff' },
  controls: [
    { id: 'level', label: 'LOOP LVL', default: 7 },
    { id: 'sync', label: 'SYNC', type: 'select', options: SYNC, default: 0 },
  ],
  actions: [
    { id: 'stop', get label() { return t('pedals.loopStopLabel'); }, get title() { return t('pedals.loopStopTitle'); } },
    { id: 'undo', get label() { return t('pedals.loopUndoLabel'); }, get title() { return t('pedals.loopUndoTitle'); } },
    { id: 'clear', get label() { return t('pedals.loopClearLabel'); }, get title() { return t('pedals.loopClearTitle'); } },
  ],

  create(ctx, env) {
    const input = ctx.createGain();
    const node = monoWorklet(ctx, 'looper');
    const output = ctx.createGain();
    input.connect(output); // o som ao vivo passa direto (e continua estéreo)
    input.connect(node).connect(output);
    const p = { ...env.params };
    let bpm = env.bpm || 120;
    let state = 'empty', listener = null, lastPress = -1e9;
    node.port.onmessage = ({ data }) => { state = data.state; listener?.(state); };
    const apply = () => node.port.postMessage({
      level: (p.level / 10) ** 2 * 1.5,
      quantum: SYNC_BEATS[p.sync] ? SYNC_BEATS[p.sync] * (60 / bpm) * ctx.sampleRate : 0,
    });
    apply();
    return {
      input, output,
      get state() { return state; },
      set(id, v) { p[id] = v; apply(); },
      setTempo(b) { bpm = b; apply(); },
      setOn() {}, // o looper está sempre na cadeia; a pisada é que manda
      press() {
        const now = performance.now();
        node.port.postMessage({ cmd: now - lastPress < 400 ? 'stop' : 'press' });
        lastPress = now;
      },
      action(id) { node.port.postMessage({ cmd: id }); },
      onState(fn) { listener = fn; fn(state); },
      dispose() { output.disconnect(); node.disconnect(); },
    };
  },
};
