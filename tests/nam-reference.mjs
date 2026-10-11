// Compara o NAM em JS com o render oficial do NeuralAmpModelerCore.
// Uso: node tests/nam-reference.mjs <render-bin> <modelo.nam> [<modelo.nam>...]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModel } from '../js/nam/nam-core.js';
import { createEngine } from '../js/nam/nam-engine.js';

const wasmModule = new WebAssembly.Module(readFileSync(new URL('../js/nam/nam.wasm', import.meta.url)));

const [render, ...models] = process.argv.slice(2);
const SR = 48000;

// Sinal de teste: palhetadas com harmônicos e decaimento, mais um pouco de ruído, 2 s.
function testSignal(n) {
  const x = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = 0; t < n; t++) {
    const pluck = Math.floor(t / 12000), tp = (t % 12000) / SR, f = [82.4, 110, 196, 330][pluck % 4];
    let s = 0;
    for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * tp) / h;
    x[t] = 0.4 * s * Math.exp(-tp * 4) + 0.002 * rnd();
  }
  return x;
}

function writeWav(path, data) {
  const buf = Buffer.alloc(44 + data.length * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(data.length * 4, 40);
  for (let i = 0; i < data.length; i++) buf.writeFloatLE(data[i], 44 + i * 4);
  writeFileSync(path, buf);
}

function readWavFloat(path) {
  const b = readFileSync(path);
  let p = 12;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'data') {
      const out = new Float32Array(size / 4);
      for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(p + 8 + i * 4);
      return out;
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('sem chunk data');
}

const dir = mkdtempSync(join(tmpdir(), 'nam-ref-'));
const input = testSignal(SR * 2);
writeWav(join(dir, 'in.wav'), input);

let failed = false;
for (const m of models) {
  const outPath = join(dir, 'out.wav');
  execFileSync(render, [m, join(dir, 'in.wav'), outPath], { stdio: 'pipe' });
  const ref = readWavFloat(outPath);

  const nam = JSON.parse(readFileSync(m, 'utf8'));
  const engines = [['js', createModel(nam)]];
  if (nam.architecture === 'WaveNet') engines.push(['wasm', createEngine(nam, wasmModule)]);
  for (const [name, model] of engines) {
    const out = new Float32Array(input.length);
    // Blocos de 128, como no AudioWorklet.
    for (let s = 0; s < input.length; s += 128) model.process(input.subarray(s, s + 128), out.subarray(s, s + 128));
    let maxErr = 0, peak = 0;
    for (let i = 0; i < ref.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(ref[i] - out[i]));
      peak = Math.max(peak, Math.abs(ref[i]));
    }
    const t0 = performance.now();
    for (let s = 0; s < input.length; s += 128) model.process(input.subarray(s, s + 128), out.subarray(s, s + 128));
    const rt = (performance.now() - t0) / 1000 / (input.length / SR);
    const ok = maxErr < 1e-3 * Math.max(peak, 1e-3);
    if (!ok) failed = true;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${m.split('/').pop()} [${name}]: erro máx ${maxErr.toExponential(2)} (pico ${peak.toFixed(3)}), CPU ${(rt * 100).toFixed(1)}% de tempo real`);
  }
}
process.exit(failed ? 1 : 0);
