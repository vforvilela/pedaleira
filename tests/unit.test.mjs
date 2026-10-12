// Testes de unidade sem navegador: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, noteOf } from '../js/audio/pitch.js';
import { parseMidi, Midi } from '../js/midi.js';

const SR = 48000;

// Corda de guitarra sintética: harmônicos que decaem, com fundamental fraca como nas cordas graves.
function pluck(hz, n = 4096, fundamental = 0.6) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = fundamental * Math.sin(2 * Math.PI * hz * t);
    for (let h = 2; h <= 8; h++) s += Math.sin(2 * Math.PI * hz * h * t + h) / h;
    b[i] = 0.3 * s;
  }
  return b;
}

const cents = (a, b) => 1200 * Math.log2(a / b);

test('afinador acha as 6 cordas soltas, o Si da de 7 cordas e o Si do baixo de 5 com erro < 3 cents', () => {
  for (const hz of [30.87, 61.74, 82.41, 110, 146.83, 196, 246.94, 329.63]) {
    const f = detectPitch(pluck(hz), SR);
    assert.ok(f, `sem nota para ${hz} Hz`);
    assert.ok(Math.abs(cents(f, hz)) < 3, `${hz} Hz → ${f.toFixed(2)} Hz`);
  }
});

test('afinador não confunde corda grave com a oitava de cima (fundamental fraca)', () => {
  const f = detectPitch(pluck(82.41, 4096, 0.15), SR);
  assert.ok(Math.abs(cents(f, 82.41)) < 3, `Mi grave → ${f.toFixed(2)} Hz`);
});

test('afinador fica quieto no silêncio e no ruído', () => {
  assert.equal(detectPitch(new Float32Array(4096), SR), null);
  let s = 1;
  const noise = Float32Array.from({ length: 4096 }, () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
  assert.equal(detectPitch(noise, SR), null);
});

test('nome da nota e cents', () => {
  assert.deepEqual(noteOf(440), { note: 'A', octave: 4, cents: 0 });
  const e = noteOf(82.41);
  assert.equal(`${e.note}${e.octave}`, 'E2');
  assert.ok(Math.abs(e.cents) < 1);
  assert.ok(noteOf(445).cents > 15);
  assert.equal(noteOf(442, 442).cents, 0);
});

test('mensagens MIDI', () => {
  assert.deepEqual(parseMidi([0xB0, 64, 127]), { key: 'cc:1:64', label: 'CC 64 (canal 1)', value: 127, press: true });
  assert.equal(parseMidi([0xB1, 64, 0]).press, false);
  assert.equal(parseMidi([0x90, 60, 100]).key, 'note:1:60');
  assert.equal(parseMidi([0x90, 60, 0]), null); // note on com velocidade 0 = soltar
  assert.equal(parseMidi([0xC0, 3]).program, 3);
  assert.equal(parseMidi([0xF8]), null); // clock
});

test('footswitch momentâneo dispara uma vez por pisada; de trava dispara em toda pisada', () => {
  let t = 0, fired = 0;
  const midi = new Midi([], { onAction: () => fired++, onLearned() {}, onChange() {}, now: () => t });
  midi.learn({ kind: 'toggle', uid: 'x' });
  midi.handle([0xB0, 64, 127]); // pisada que ensina
  t += 120; midi.handle([0xB0, 64, 0]); // soltar
  assert.equal(fired, 0, 'aprender não dispara');
  // Momentâneo: 3 pisadas, cada uma 127 e logo 0.
  for (let i = 0; i < 3; i++) { t += 2000; midi.handle([0xB0, 64, 127]); t += 150; midi.handle([0xB0, 64, 0]); }
  assert.equal(fired, 3);

  // De trava: cada pisada manda só um valor, alternando.
  fired = 0;
  const latch = new Midi([], { onAction: () => fired++, onLearned() {}, onChange() {}, now: () => t });
  latch.learn({ kind: 'toggle', uid: 'y' });
  latch.handle([0xB0, 80, 127]);
  for (const v of [0, 127, 0, 127]) { t += 1800; latch.handle([0xB0, 80, v]); }
  assert.equal(fired, 4);
});

// ---------- Gate, compressor e limitador ----------
import { Gate, Compressor, Limiter } from '../js/audio/dynamics.js';

const sine = (hz, amp, n) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const peakOf = (b, from = 0) => b.subarray(from).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const run = (dsp, inp) => { const out = new Float32Array(inp.length); dsp.process(inp, out); return out; };
const db = x => 20 * Math.log10(x);

test('gate: nota passa inteira, chiado abaixo do limiar some', () => {
  const g = new Gate(SR);
  g.set(-60, 0.1);
  const note = run(g, sine(220, 0.1, SR / 2)); // -20 dB, bem acima do limiar
  assert.ok(peakOf(note, 100) > 0.099, 'a nota não pode perder volume');
  let s = 7;
  const hiss = Float32Array.from({ length: SR }, () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.001); // ~ -66 dB
  const out = run(g, hiss);
  assert.ok(peakOf(out, SR / 2) < 1e-6, `chiado depois que a nota acabou: ${peakOf(out, SR / 2)}`);
});

test('compressor 4:1 tira 3/4 do que passa do limiar', () => {
  const c = new Compressor(SR);
  c.set({ threshold: -30, ratio: 4, attack: 0.001, release: 0.1, makeup: 0 });
  const out = run(c, sine(220, 0.5, SR)); // pico -6 dB, 24 dB acima do limiar
  const got = db(peakOf(out, SR / 2));
  assert.ok(Math.abs(got - (-30 + 24 / 4)) < 1.5, `pico na saída ${got.toFixed(1)} dB, esperado -24`);
  const quiet = run(new Compressor(SR), sine(220, 0.005, SR / 4)); // -46 dB: abaixo do limiar, passa igual
  assert.ok(Math.abs(peakOf(quiet, 1000) - 0.005) < 1e-4);
});

test('limitador nunca passa de -1 dB e não atrasa o som', () => {
  const l = new Limiter(SR, -1);
  const imp = new Float32Array(256); imp[10] = 0.5;
  assert.equal(run(l, imp)[10], 0.5, 'sinal abaixo do teto sai igual e na mesma amostra');
  const loud = run(new Limiter(SR, -1), sine(110, 3, SR / 4));
  assert.ok(peakOf(loud) <= 10 ** (-1 / 20) + 1e-6, `pico ${peakOf(loud)}`);
});
