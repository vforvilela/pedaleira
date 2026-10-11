// Footswitch MIDI: aprende um botão do controlador para cada ação e dispara as ações.
// Program Change escolhe o preset pelo número, sem precisar aprender.

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
  constructor(mappings, { onAction, onLearned, onChange }) {
    this.mappings = mappings;
    this.onAction = onAction;
    this.onLearned = onLearned;
    this.onChange = onChange;
    this.learnTarget = null;
    this.access = null;
  }

  async enable() {
    if (this.access) return this.access;
    this.access = await navigator.requestMIDIAccess();
    const attach = () => { for (const input of this.access.inputs.values()) input.onmidimessage = e => this.handle(e.data); };
    attach();
    this.access.onstatechange = attach;
    return this.access;
  }

  inputNames() {
    return this.access ? [...this.access.inputs.values()].map(i => i.name) : [];
  }

  learn(target) { this.learnTarget = target; }

  handle(data) {
    const msg = parseMidi(data);
    if (!msg) return;
    if (this.learnTarget && msg.key.startsWith('pc:') === false) {
      const target = this.learnTarget;
      this.learnTarget = null;
      // Um botão do controlador faz uma coisa só; um alvo recebe um botão só.
      this.mappings.splice(0, this.mappings.length,
        ...this.mappings.filter(m => m.key !== msg.key && JSON.stringify(m.target) !== JSON.stringify(target)),
        { key: msg.key, label: msg.label, target });
      this.onChange();
      this.onLearned(target, msg);
      return;
    }
    if (msg.program !== undefined) { this.onAction({ kind: 'program' }, msg); return; }
    for (const m of this.mappings) if (m.key === msg.key) this.onAction(m.target, msg);
  }
}
