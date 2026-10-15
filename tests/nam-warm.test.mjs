// A captura NAM aquece em pedaços (warm) sem mudar o resultado em relação ao pré-aquecimento de uma vez,
// e cada pedaço é curto o bastante para caber num quantum do AudioWorklet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../js/nam/nam-engine.js';
import { encodeForWasm } from '../js/nam/nam-core.js';

const wasmModule = new WebAssembly.Module(readFileSync(new URL('../js/nam/nam.wasm', import.meta.url)));
const nam = JSON.parse(readFileSync(new URL('./fixtures/wavenet_a1_standard.nam', import.meta.url), 'utf8'));

function signal(n) {
  const x = new Float32Array(n);
  for (let t = 0; t < n; t++) x[t] = 0.3 * Math.sin(2 * Math.PI * 110 * t / 48000) * Math.exp(-t / 24000);
  return x;
}
function render(model, input) {
  const out = new Float32Array(input.length);
  for (let s = 0; s < input.length; s += 128) model.process(input.subarray(s, s + 128), out.subarray(s, s + 128));
  return out;
}

for (const [name, blocks, maxMs, make] of [
  ['wasm', 2, 2.7, opts => createEngine(encodeForWasm(nam), wasmModule, opts)],
  ['js', 1, 8, opts => createEngine(nam, null, opts)], // motor de reserva: um bloco por vez, e o JIT ainda aquece
]) {
  test(`NAM ${name}: aquecer em pedaços dá o mesmo som que aquecer de uma vez, em passos curtos`, () => {
    const full = make({});
    assert.equal(full.engine, name);
    const lazy = make({ deferWarm: true });
    let steps = 0, worst = 0, left;
    do {
      const t0 = performance.now();
      left = lazy.warm(blocks);
      worst = Math.max(worst, performance.now() - t0);
      steps++;
    } while (left > 0);
    assert.ok(steps > 4, `aqueceu em ${steps} passos`);
    assert.equal(lazy.warm(2), 0);
    assert.ok(worst < maxMs * 1.3, // folga de 30% para o ruído de medição do Node
       `passo mais longo ${worst.toFixed(2)} ms (um quantum a 48 kHz tem 2,67 ms)`);
    const input = signal(48000);
    const a = render(full, input), b = render(lazy, input);
    let maxErr = 0;
    for (let i = 0; i < a.length; i++) maxErr = Math.max(maxErr, Math.abs(a[i] - b[i]));
    assert.ok(maxErr < 1e-6, `diferença máxima ${maxErr}`);
  });
}

test('NAM: a captura já achatada pode ser transferida para o worklet (buffers próprios)', () => {
  const enc = encodeForWasm(nam);
  assert.ok(enc.cfg instanceof Int32Array && enc.weights instanceof Float32Array);
  assert.equal(enc.cfg.byteOffset, 0);
  assert.equal(enc.weights.byteOffset, 0);
  assert.equal(enc.weights.buffer.byteLength, enc.weights.byteLength);
});
