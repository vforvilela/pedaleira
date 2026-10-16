// Footswitch MIDI: aprende um botão do controlador para cada ação e dispara as ações.
// Program Change escolhe o preset pelo número, sem precisar aprender.
//
// Funciona com os dois tipos de footswitch sem configurar nada:
// - momentâneo: manda 127 ao pisar e 0 ao soltar → dispara no 127, ignora o 0 que vem logo depois;
// - de trava (latching): manda 127 numa pisada e 0 na seguinte → dispara nos dois.
// A diferença é o tempo: um 0 que chega mais de LATCH_MS depois do último 127 é outra pisada.
// Só que um momentâneo segurado (esperando a virada) também solta tarde. Por isso um botão que alguma vez
// soltou rápido (0 menos de QUICK_MS depois do 127) fica marcado como momentâneo no mapeamento, e daí em
// diante o 0 dele nunca mais dispara, segure o tempo que segurar. A pisada que ensina já costuma marcar.

export const LATCH_MS = 1000, QUICK_MS = 400;

export const midiSupported = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;

// Converte uma mensagem MIDI em { key, kind, n, ch, value, press } ou null. O texto para a pessoa é da UI.
export function parseMidi([status, d1, d2 = 0]) {
  const type = status & 0xf0, ch = (status & 0x0f) + 1;
  if (type === 0xb0) return { key: `cc:${ch}:${d1}`, kind: 'cc', n: d1, ch, value: d2, press: d2 >= 64 };
  if (type === 0x90 && d2 > 0) return { key: `note:${ch}:${d1}`, kind: 'note', n: d1, ch, value: d2, press: true };
  if (type === 0xc0) return { key: `pc:${ch}`, kind: 'pc', n: d1, ch, value: d1, program: d1 };
  return null;
}

export class Midi {
  // mappings: [{ key, target, momentary? }] (persistido pelo app). onAction(target, msg).
  // native(onMessage) → nomes das entradas: fonte MIDI do app nativo, usada quando não há navigator.requestMIDIAccess.
  constructor(mappings, { onAction, onLearned, onChange, onClock = null, native = null, now = () => Date.now() }) {
    this.onClock = onClock;
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

  isMomentary(key) { return this.mappings.some(m => m.key === key && m.momentary); }

  // Um 0 chegou para o botão `key`. Devolve se ele conta como pisada (só num botão de trava).
  release(key, now) {
    const since = now - (this.lastPress[key] ?? -Infinity);
    if (since < QUICK_MS && !this.isMomentary(key)) {
      let changed = false;
      for (const m of this.mappings) if (m.key === key && !m.momentary) { m.momentary = true; changed = true; }
      if (changed) this.onChange();
    }
    return !this.isMomentary(key) && since > LATCH_MS;
  }

  // MIDI Clock (0xF8, 24 por semínima): a média das últimas 48 batidas dá o BPM; avisa onClock só quando mudou
  // pelo menos 1 BPM e no máximo duas vezes por segundo (o relógio treme um pouco). Start/Stop zeram a medida.
  clockTick(now) {
    const ticks = (this.ticks ??= []);
    if (ticks.length && now - ticks[ticks.length - 1] > 500) ticks.length = 0; // parou e voltou
    ticks.push(now);
    if (ticks.length > 49) ticks.shift();
    if (ticks.length < 25) return;
    const bpm = 60000 / (((ticks[ticks.length - 1] - ticks[0]) / (ticks.length - 1)) * 24);
    if (Math.abs(bpm - (this.clockBpm ?? 0)) < 1 || now - (this.clockAt ?? -1e9) < 500) return;
    this.clockBpm = bpm;
    this.clockAt = now;
    this.onClock?.(bpm);
  }

  handle(data) {
    if (data[0] === 0xf8) { this.clockTick(this.now()); return; }
    if (data[0] === 0xfa || data[0] === 0xfc) { this.ticks = []; return; }
    const msg = parseMidi(data);
    if (!msg) return;
    const now = this.now();
    if (this.learnTarget && msg.key.startsWith('pc:') === false) {
      if (msg.key.startsWith('cc:') && !msg.press) { this.release(msg.key, now); return; } // soltar do botão que ensinou
      const target = this.learnTarget;
      this.learnTarget = null;
      // A pisada que ensinou conta como pisada: o 0 do "soltar" logo depois não dispara nada.
      this.lastPress[msg.key] = now;
      // Um botão do controlador faz uma coisa só; um alvo recebe um botão só.
      this.mappings.splice(0, this.mappings.length,
        ...this.mappings.filter(m => m.key !== msg.key && JSON.stringify(m.target) !== JSON.stringify(target)),
        { key: msg.key, target });
      this.onChange();
      this.onLearned(target, msg);
      return;
    }
    if (msg.program !== undefined) { this.onAction({ kind: 'program' }, msg); return; }
    msg.trigger = true;
    if (msg.key.startsWith('cc:')) {
      if (msg.press) this.lastPress[msg.key] = now;
      else msg.trigger = this.release(msg.key, now);
    }
    // Botões contínuos recebem todo valor; pedais, TAP e presets só as pisadas que contam.
    for (const m of this.mappings)
      if (m.key === msg.key && (msg.trigger || m.target.kind === 'knob')) this.onAction(m.target, msg);
  }
}
