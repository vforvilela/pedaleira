// Looper inspirado no TC Electronic Ditto: pise para gravar, pise para tocar, pise para sobrepor.
// Duas pisadas rápidas param. STOP e APAGAR também ficam embaixo do pedal.
import { monoWorklet } from './common.js';

const LABELS = {
  empty: 'vazio · pise para gravar',
  rec: 'GRAVANDO · pise para tocar',
  play: 'TOCANDO · pise para sobrepor',
  dub: 'SOBREPONDO · pise para parar de sobrepor',
  stop: 'PARADO · pise para tocar',
};

export default {
  type: 'laco',
  name: 'Laço',
  inspiredBy: 'TC Electronic Ditto',
  category: 'looper',
  press: true,
  stateLabels: LABELS,
  look: { style: 'stomp', body: '#cfd2d6', ink: '#202225', accent: '#202225', subtitle: 'Looper', led: '#3aa0ff' },
  controls: [{ id: 'level', label: 'LOOP LVL', default: 7 }],
  actions: [
    { id: 'stop', label: 'STOP', title: 'Para o loop (ou pise duas vezes rápido)' },
    { id: 'clear', label: 'APAGAR', title: 'Apaga o loop' },
  ],

  create(ctx, env) {
    const input = ctx.createGain();
    const node = monoWorklet(ctx, 'looper');
    const output = ctx.createGain();
    input.connect(node).connect(output);
    const p = { ...env.params };
    let state = 'empty', listener = null, lastPress = -1e9;
    node.port.onmessage = ({ data }) => { state = data.state; listener?.(state); };
    const apply = () => node.port.postMessage({ level: (p.level / 10) ** 2 * 1.5 });
    apply();
    return {
      input, output,
      get state() { return state; },
      set(id, v) { p[id] = v; apply(); },
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
