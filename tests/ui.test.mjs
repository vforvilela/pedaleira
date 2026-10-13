// Testes de unidade da interface, sem navegador: encaixe da pedaleira na tela e ligações HTML ↔ JS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { largestSqueeze, largestZoom } from '../js/fit.js';

// ---------- Encaixe da pedaleira (js/fit.js) ----------

// Modelo da pedaleira: pedais de larguras dadas quebram em fileiras como no flex-wrap, numa área de
// largura `width` e altura `avail` (px na tela). Com zoom z, cabe width / z de conteúdo por fileira.
function layout(widths, { width, rowH = 380, gap = 10, pad = 36 }) {
  const rowsAt = (z, squeeze = 0) => {
    const room = width / z - 2 * squeeze;
    let rows = 1, x = 0;
    for (const w of widths) {
      if (x && x + w > room) { rows++; x = 0; }
      x += w;
    }
    return rows;
  };
  const height = (z, squeeze = 0) => { const r = rowsAt(z, squeeze); return z * (r * rowH + (r - 1) * gap + pad); };
  return { rowsAt, height };
}

test('encaixe: tudo cabe no zoom máximo → usa o máximo', () => {
  const { height } = layout([180, 180, 180], { width: 1366 });
  assert.equal(largestZoom(z => height(z) <= 1100, .5, 1.3), 1.3);
});

test('encaixe: nem no mínimo cabe (cadeia enorme) → fica no mínimo e a área rola', () => {
  const { height } = layout(Array(60).fill(180), { width: 1024 });
  assert.equal(largestZoom(z => height(z) <= 300, .5, 1.3), .5);
});

test('encaixe: acha o maior zoom que cabe, com erro < 2 centésimos', () => {
  // iPad deitado com 6 pedais: 2 fileiras não cabem em 100 %, mas cabem reduzindo.
  const { height } = layout([180, 180, 180, 290, 180, 180], { width: 992 });
  const avail = 540;
  const z = largestZoom(zz => height(zz) <= avail, .5, 1.3);
  assert.ok(height(z) <= avail, `z=${z} não cabe`);
  assert.ok(height(z + .02) > avail, `z=${z} é pequeno demais: ${z + .02} também cabe`);
});

test('encaixe: fileiras equilibradas (6 pedais iguais viram 3 + 3, não 5 + 1)', () => {
  const widths = Array(6).fill(200);
  const { rowsAt } = layout(widths, { width: 1000 });
  assert.equal(rowsAt(1), 2);
  const px = largestSqueeze(p => rowsAt(1, p) === 2, 500);
  // Com o aperto, a fileira só comporta 3: 600 px de pedais em 1000 - 2·px.
  assert.ok(1000 - 2 * px >= 600 && 1000 - 2 * px < 800, `aperto ${px} px`);
  assert.equal(rowsAt(1, px), 2);
});

test('encaixe: aperto nunca negativo, nem com área zerada', () => {
  assert.equal(largestSqueeze(() => false, 300), 0);
  assert.equal(largestSqueeze(() => true, -10), 0);
});

// ---------- Ligações HTML ↔ JS ----------

const root = new URL('..', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const walk = dir => readdirSync(new URL(dir, root), { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]));
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const js = walk('js/').filter(f => f.endsWith('.js')).map(f => readFileSync(new URL(f, root), 'utf8')).join('\n') + inlineScripts;
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

test('todo botão do index.html com id tem ação no JS (nada de botão morto)', () => {
  const buttons = [...html.matchAll(/<button\b[^>]*\sid="([^"]+)"/g)].map(m => m[1]);
  assert.ok(buttons.includes('libOpen'), 'o + Pedal sumiu do index.html');
  const dead = buttons.filter(id => !js.includes(`$('${id}')`) && !js.includes(`getElementById('${id}')`));
  assert.deepEqual(dead, [], `botões sem nenhuma referência no JS: ${dead.join(', ')}`);
});

test("todo $('id') do JS existe no index.html (id renomeado quebraria a inicialização)", () => {
  const used = [...new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
  const missing = used.filter(id => !htmlIds.has(id));
  assert.deepEqual(missing, [], `ids que o JS procura e o HTML não tem: ${missing.join(', ')}`);
});

test('+ Pedal abre a gaveta da biblioteca, e escolher um pedal fecha a gaveta', () => {
  const app = readFileSync(new URL('js/app.js', root), 'utf8');
  assert.match(app, /\$\('libOpen'\)\.onclick = \(\) => \$\('libSheet'\)\.showModal\(\)/);
  assert.match(app, /\$\('libSheet'\)\.close\(\); addBlock\(def\.type\)/);
  assert.match(html, /<dialog id="libSheet"[^>]*>[\s\S]*id="library"[\s\S]*<\/dialog>/, 'a biblioteca precisa estar dentro da gaveta');
});

test('app.js marca data-ready no fim, e o index.html tem a guarda que avisa se isso não acontecer', () => {
  const app = readFileSync(new URL('js/app.js', root), 'utf8').trimEnd();
  assert.ok(app.endsWith("document.documentElement.dataset.ready = '1';"), 'data-ready precisa ser a última linha de app.js');
  assert.match(inlineScripts, /dataset\.ready/);
  assert.ok(htmlIds.has('bootFail') && htmlIds.has('bootReload'));
});

test('service worker confere com o servidor (não entrega cópia velha do cache HTTP)', () => {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  assert.match(sw, /fetch\([^)]*\{ cache: 'no-cache' \}\)/);
});
