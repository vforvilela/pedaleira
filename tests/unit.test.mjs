// Testes de unidade sem navegador: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, noteOf } from '../js/audio/pitch.js';
import { parseMidi, Midi } from '../js/midi.js';
import { FuzzBias, fuzzShape } from '../js/audio/fuzz.js';

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

// ---------- Looper ----------
import { Looper } from '../js/audio/looper.js';

test('looper grava, toca em loop, sobrepõe e para', () => {
  const l = new Looper(1000, 10); // 1 kHz para o teste ficar pequeno
  const block = v => new Float32Array(250).fill(v);
  const out = new Float32Array(250);
  l.command('press');
  l.process(block(1), out); // grava 0,25 s de 1
  l.command('press');
  assert.equal(l.state, 'play');
  assert.equal(l.len, 250);
  l.process(block(0), out);
  assert.equal(out[0], 1, 'toca o que gravou');
  l.command('press'); // sobrepõe 0,5
  l.process(block(0.5), out);
  assert.equal(out[10], 1, 'durante a sobreposição toca a camada antiga');
  l.command('press');
  l.process(block(0), out);
  assert.equal(out[10], 1.5, 'a camada nova ficou no loop');
  l.command('stop');
  l.process(block(0.2), out);
  assert.equal(out[3], 0, 'parado, o loop cala (o som ao vivo passa por fora)');
  l.command('clear');
  assert.equal(l.state, 'empty');
});

test('looper ignora gravação de menos de 0,1 s (pisada sem querer)', () => {
  const l = new Looper(1000, 10);
  l.command('press');
  l.process(new Float32Array(50), new Float32Array(50));
  l.command('press');
  assert.equal(l.state, 'empty');
});

// ---------- Offline ----------
import { readFileSync, readdirSync } from 'node:fs';

test('todo arquivo do app está no cache offline do service worker', () => {
  const root = new URL('..', import.meta.url);
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const walk = dir => readdirSync(new URL(dir, root), { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]));
  const missing = walk('js/').filter(f => /\.(js|wasm)$/.test(f) && !sw.includes(`'${f}'`));
  assert.deepEqual(missing, []);
});

// ---------- Latência ----------
import { LatencyProbe } from '../js/audio/latency.js';

test('medição de latência acha o atraso de um cabo simulado (com ruído)', () => {
  const sr = 48000, delay = 517; // ~10,8 ms
  const p = new LatencyProbe(sr);
  const line = new Float32Array(sr * 6); // o que sai, para devolver atrasado
  let s = 3;
  const out = new Float32Array(128), inp = new Float32Array(128);
  for (let f = 0; !p.done && f < line.length - 128; f += 128) {
    for (let i = 0; i < 128; i++) {
      const noise = ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
      inp[i] = (f + i >= delay ? 0.3 * line[f + i - delay] : 0) + noise;
    }
    p.process(inp, out);
    line.set(out, f);
  }
  assert.ok(p.done);
  assert.equal(p.delays.length, 6);
  assert.ok(Math.abs(p.resultMs() - (delay / sr) * 1000) < 0.1, `${p.resultMs()} ms`);
});

test('sem cabo, a medição avisa que o clique não voltou', () => {
  const p = new LatencyProbe(48000);
  const out = new Float32Array(128);
  for (let f = 0; !p.done && f < 48000 * 6; f += 128) p.process(new Float32Array(128), out);
  assert.equal(p.resultMs(), null);
});

// ---------- Oitava, flanger, envelope ----------
import { OctaveDown, Flanger, Envelope, PitchShifter } from '../js/audio/modulation.js';

test('pitch shifter: 220 Hz vira 440 (+1 oitava), 110 (-1) e 330 (+5ª)', () => {
  for (const [ratio, want] of [[2, 440], [0.5, 110], [2 ** (7 / 12), 329.6]]) {
    const ps = new PitchShifter(SR);
    ps.set({ ratio });
    ps.ratio = ratio; // sem a rampa de 10 ms
    const out = run(ps, sine(220, 0.5, SR));
    // Conta a frequência dominante pela FFT simples (DFT nas vizinhanças).
    let best = 0, bestHz = 0;
    for (let hz = 80; hz < 600; hz += 0.5) {
      let re = 0, im = 0;
      for (let i = SR / 4; i < SR; i += 2) { re += out[i] * Math.cos(2 * Math.PI * hz * i / SR); im += out[i] * Math.sin(2 * Math.PI * hz * i / SR); }
      const m = re * re + im * im;
      if (m > best) { best = m; bestHz = hz; }
    }
    assert.ok(Math.abs(bestHz - want) / want < 0.01, `ratio ${ratio.toFixed(3)} → ${bestHz} Hz`);
  }
});

// Frequência dominante por cruzamentos de zero (subindo) depois do transiente.
function zeroCrossHz(b, sr, from) {
  let n = 0, first = -1, last = -1;
  for (let i = from + 1; i < b.length; i++)
    if (b[i - 1] <= 0 && b[i] > 0) { if (first < 0) first = i; last = i; n++; }
  return ((n - 1) * sr) / (last - first);
}

test('oitava: Lá de 110 Hz sai a 55 Hz (OCT 1) e 27,5 Hz (OCT 2)', () => {
  const pluck = Float32Array.from({ length: SR }, (_, i) => 0.3 * (Math.sin((2 * Math.PI * 110 * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR + 1)));
  for (const [cfg, want] of [[{ oct1: 1, oct2: 0, direct: 0 }, 55], [{ oct1: 0, oct2: 1, direct: 0 }, 27.5]]) {
    const o = new OctaveDown(SR);
    o.set(cfg);
    const out = run(o, pluck);
    const hz = zeroCrossHz(out, SR, SR / 4);
    assert.ok(Math.abs(hz - want) / want < 0.02, `${JSON.stringify(cfg)} → ${hz.toFixed(1)} Hz`);
  }
});

test('flanger: estável com RES no máximo e soma um eco curto', () => {
  const f = new Flanger(SR);
  f.set({ manual: 0.5, depth: 1, rate: 1, res: 1 });
  const out = run(f, sine(220, 0.5, SR));
  assert.ok(out.every(Number.isFinite));
  assert.ok(peakOf(out) < 2, `pico ${peakOf(out)}`);
});

test('envelope sobe com a palhetada e cai no silêncio', () => {
  const e = new Envelope(SR);
  const out = run(e, Float32Array.from({ length: SR }, (_, i) => (i < SR / 4 ? 0.5 * Math.sin(i / 10) : 0)));
  assert.ok(out[SR / 4 - 1] > 0.25, `aberto: ${out[SR / 4 - 1]}`);
  assert.ok(out[SR - 1] < 0.01, `fechado: ${out[SR - 1]}`);
});

test('css: nenhuma cor fixa fora das variáveis de :root', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');
  const outside = css.replace(/:root\s*\{[^}]*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const hex = outside.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], `cores fixas fora de :root: ${hex.join(', ')}`);
});

test('fuzz limpa quando o volume da guitarra baixa (como o Fuzz Face)', () => {
  const F = 196;
  const goertzel = (x, f) => {
    const c = 2 * Math.cos((2 * Math.PI * f) / SR);
    let s1 = 0, s2 = 0;
    for (const v of x) { const s = v + c * s1 - s2; s2 = s1; s1 = s; }
    return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
  };
  const thd = amp => {
    const x = new Float32Array(SR), y = new Float32Array(SR);
    for (let i = 0; i < SR; i++) x[i] = amp * Math.sin((2 * Math.PI * F * i) / SR);
    new FuzzBias(SR).process(x, y);
    const z = y.subarray(SR / 2).map(v => fuzzShape(Math.max(-1, Math.min(1, v))));
    let h = 0;
    for (let k = 2; k <= 12; k++) h += goertzel(z, F * k) ** 2;
    return Math.sqrt(h) / goertzel(z, F);
  };
  const full = thd(0.3), mid = thd(0.09), low = thd(0.045);
  assert.ok(full > 0.35, `volume 100% satura (THD ${full.toFixed(3)})`);
  assert.ok(mid < full / 2.5, `volume 30% bem menos sujo (THD ${mid.toFixed(3)})`);
  assert.ok(low < 0.02, `volume 15% limpo (THD ${low.toFixed(3)})`);
});

test('canal da interface: escolhe o canal da palhetada, não decide com canais iguais ou silêncio', async () => {
  const { pickChannel } = await import('../js/audio/channel.js');
  assert.equal(pickChannel(0, 0), null);
  assert.equal(pickChannel(0.005, 0), null, 'chiado não decide');
  assert.equal(pickChannel(0.3, 0.002), 0);
  assert.equal(pickChannel(0.001, 0.2), 1);
  assert.equal(pickChannel(0.3, 0.3), null, 'interface que duplica a entrada fica na mistura');
  assert.equal(pickChannel(0.3, 0.1), null, 'menos de 12 dB de diferença: não decide');
});

test('metrônomo: clique a cada tempo no BPM certo, acento no primeiro do compasso', async () => {
  const { Metronome } = await import('../js/audio/metro.js');
  const sr = 48000, m = new Metronome(sr);
  m.set({ bpm: 120, beats: 3, level: 1, on: true });
  const out = new Float32Array(sr * 2);
  for (let i = 0; i < out.length; i += 128) m.process(null, out.subarray(i, i + 128));
  // Inícios de clique: amostra com som depois de 10 ms de silêncio.
  const starts = [];
  for (let i = 0, quiet = 1e9; i < out.length; i++) {
    if (Math.abs(out[i]) > 1e-4) { if (quiet > sr * 0.01) starts.push(i); quiet = 0; } else quiet++;
  }
  assert.deepEqual(starts.map(s => Math.round(s / 100)), [0, 240, 480, 720]);
  // Cruzamentos por zero nos primeiros 5 ms: o acento (1760 Hz) tem mais que os outros (1100 Hz).
  const zc = s => { let n = 0; for (let i = s + 1; i < s + 240; i++) if ((out[i - 1] < 0) !== (out[i] < 0)) n++; return n; };
  assert.ok(zc(starts[0]) > zc(starts[1]) + 2 && zc(starts[3]) > zc(starts[1]) + 2, `acento: ${zc(starts[0])} vs ${zc(starts[1])}`);
  m.set({ on: false });
  const off = new Float32Array(sr);
  m.process(null, off);
  assert.ok(off.every(x => x === 0) || off.slice(1500).every(x => x === 0), 'desligado não clica');
});
