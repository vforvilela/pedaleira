// index.html pede com modulepreload todos os módulos que o app.js importa, direta ou indiretamente.
// Esquecer um módulo novo (um pedal, por exemplo) volta a escada de downloads na abertura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = f => readFileSync(join(root, f), 'utf8');

function graph(entry) {
  const seen = new Set();
  const walk = f => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of read(f).matchAll(/^(?:import|export)\s(?:[^'";]*?\sfrom\s)?['"](\.[^'"]+\.js)['"]/gm))
      walk(relative(root, join(root, dirname(f), m[1])));
  };
  walk(entry);
  seen.delete(entry);
  return seen;
}

test('modulepreload cobre o grafo de imports do app.js', () => {
  const preloaded = new Set([...read('index.html').matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]));
  const needed = graph('js/app.js');
  assert.deepEqual([...needed].filter(f => !preloaded.has(f)), [], 'faltam no index.html');
  assert.deepEqual([...preloaded].filter(f => !needed.has(f)), [], 'sobram no index.html');
});
