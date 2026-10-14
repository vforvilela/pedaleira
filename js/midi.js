// Footswitch MIDI: aprende um botão do controlador para cada ação e dispara as ações.
// Program Change escolhe o preset pelo número, sem precisar aprender.
//
// Funciona com os dois tipos de footswitch sem configurar nada:
// - momentâneo: manda 127 ao pisar e 0 ao soltar → dispara no 127, ignora o 0 que vem logo depois;
// - de trava (latching): manda 127 numa pisada e 0 na seguinte → dispara nos dois.
// A diferença é o tempo: um 0 que chega mais de LATCH_MS depois do último 127 é outra pisada.

export const LATCH_MS = 1000;

export const midiSupported = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;

// Converte uma mensagem MIDI em { key, value, press } ou null.
export function parseMidi([status, d1, d2 = 0]) {
  const type = status & 0xf0, ch = (status & 0x0f) + 1;
  if (type === 0xb0) return { key: `cc:${ch}:${d1}`, label: `CC ${d1} (canal ${ch})`, value: d2, press: d2 >= 64 };
  if (type === 0x90 && d2 > 0) return { key: `note:${ch}:${d1}`, label: `nota ${d1} (canal ${ch})`, value: d2, press: true };
  if (type === 0xc0) return { key: `pc:${ch}`, label: `Program Change ${d1}`, value: d1, program: d1 };
  return null;
}

export class Midi {
  // mappings: [{ key, label, target }] (persistido pelo app). onAction(target, msg).
  // native(onMessage) → nomes das entradas: fonte MIDI do app nativo, usada quando não há navigator.requestMIDIAccess.
  constructor(mappings, { onAction, onLearned, onChange, native = null, now = () => Date.now() }) {
    this.now = now;
    this.native = native;
    this.lastPress = {};
    this.mappings = mappings;
    this.onAction = onAction;
    this.onLearned = onLearned;
    this.onChange = onChange;
    this.learnTarget = null;
    this.access = null;
  }

  async enable() {
    if (this.access) return this.access;
    // App nativo (WebView sem Web MIDI): o plugin do sistema entrega os bytes; o resto é igual.
    if (!navigator.requestMIDIAccess && this.native) {
      this.nativeInputs = await this.native(data => this.handle(data), inputs => { this.nativeInputs = inputs; });
      this.access = { native: true };
      return this.access;
    }
    this.access = await navigator.requestMIDIAccess();
    const attach = () => { for (const input of this.access.inputs.values()) input.onmidimessage = e => this.handle(e.data); };
    attach();
    this.access.onstatechange = attach;
    return this.access;
  }

  inputNames() {
    if (this.access?.native) return this.nativeInputs ?? [];
    return this.access ? [...this.access.inputs.values()].map(i => i.name) : [];
  }

  learn(target) { this.learnTarget = target; }

  handle(data) {
    const msg = parseMidi(data);
    if (!msg) return;
    const now = this.now();
    if (this.learnTarget && msg.key.startsWith('pc:') === false) {
      const target = this.learnTarget;
      this.learnTarget = null;
      // A pisada que ensinou conta como pisada: o 0 do "soltar" logo depois não dispara nada.
      this.lastPress[msg.key] = now;
      // Um botão do controlador faz uma coisa só; um alvo recebe um botão só.
      this.mappings.splice(0, this.mappings.length,
        ...this.mappings.filter(m => m.key !== msg.key && JSON.stringify(m.target) !== JSON.stringify(target)),
        { key: msg.key, label: msg.label, target });
      this.onChange();
      this.onLearned(target, msg);
      return;
    }
    if (msg.program !== undefined) { this.onAction({ kind: 'program' }, msg); return; }
    msg.trigger = true;
    if (msg.key.startsWith('cc:')) {
      if (msg.press) this.lastPress[msg.key] = now;
      else msg.trigger = now - (this.lastPress[msg.key] ?? -Infinity) > LATCH_MS;
    }
    // Botões contínuos recebem todo valor; pedais, TAP e presets só as pisadas que contam.
    for (const m of this.mappings)
      if (m.key === msg.key && (msg.trigger || m.target.kind === 'knob')) this.onAction(m.target, msg);
  }
}
