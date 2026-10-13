// Testes de idioma: os três dicionários batem, toda chave usada existe, nada em português ficou solto no JS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DICTS, LANGS, detectLang, fmtNum, t, useLang } from '../js/i18n.js';

const root = new URL('..', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const walk = dir => readdirSync(new URL(dir, root), { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]));
const placeholders = v => [...new Set(JSON.stringify(v).match(/\{\w+\}/g) || [])].sort().join(',');

test('i18n: pt, en e es têm as mesmas chaves e os mesmos {marcadores}', () => {
  const keys = Object.keys(DICTS.pt).sort();
  assert.ok(keys.length > 250, `só ${keys.length} chaves`);
  for (const l of ['en', 'es']) {
    assert.deepEqual(Object.keys(DICTS[l]).sort(), keys, `chaves diferentes em ${l}`);
    const bad = keys.filter(k => placeholders(DICTS[l][k]) !== placeholders(DICTS.pt[k]));
    assert.deepEqual(bad, [], `marcadores diferentes em ${l}: ${bad.join(', ')}`);
    const empty = keys.filter(k => !JSON.stringify(DICTS[l][k]).replace(/"/g, '').trim());
    assert.deepEqual(empty, [], `vazias em ${l}`);
  }
});

test('i18n: toda chave usada no JS e no HTML existe', () => {
  const js = walk('js/').filter(f => f.endsWith('.js') && !f.startsWith('js/i18n/')).map(read).join('\n');
  const html = read('index.html');
  const used = new Set([
    ...[...js.matchAll(/\bt\(\s*'([\w.]+)'/g)].map(m => m[1]),
    ...[...html.matchAll(/data-i18n(?:-html)?="([\w.]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap(m => m[1].split(';').map(p => p.split(':')[1].trim())),
  ]);
  const missing = [...used].filter(k => !(k in DICTS.pt));
  assert.deepEqual(missing, [], `chaves que não existem: ${missing.join(', ')}`);
});

test('i18n: nenhum texto em português solto no JS (fora dos dicionários)', () => {
  // Nomes de pedal são marcas e ficam iguais em todo idioma.
  const allowed = /^(Salão|Laço|Uá|Silêncio|Afinador|Equalizador|Oitava|Baleia|Aperto|Ondas|Coro|Marimbondo|Abafa|Ratazana|Pulso|Fase 90|Eco 8|Turbo|Volume|Sol Drive|Flange)$/;
  const found = [];
  for (const f of walk('js/').filter(f => f.endsWith('.js') && !f.startsWith('js/i18n') && !f.includes('/audio/') && !f.includes('/nam/'))) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
    for (const m of code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      const s = m[2];
      if (/[ãõçáéíóúâêôà]/i.test(s) && !allowed.test(s)) found.push(`${f}: ${s.slice(0, 60)}`);
    }
  }
  assert.deepEqual(found, [], `textos sem tradução:\n${found.join('\n')}`);
});

test('i18n: idioma do sistema, escolha guardada e inglês para os outros', () => {
  assert.equal(detectLang(null, ['es-AR', 'en']), 'es');
  assert.equal(detectLang(null, ['pt-PT']), 'pt');
  assert.equal(detectLang(null, ['fr-FR', 'de']), 'en');
  assert.equal(detectLang('pt', ['en-US']), 'pt');
  assert.equal(detectLang('xx', []), 'en');
  assert.deepEqual(Object.keys(LANGS), ['pt', 'en', 'es']);
});

test('i18n: plural e número no jeito de cada idioma', () => {
  const key = Object.keys(DICTS.pt).find(k => typeof DICTS.pt[k] === 'object');
  assert.ok(key, 'nenhum texto com plural');
  useLang('pt'); const pt1 = t(key, { n: 1 }), pt2 = t(key, { n: 2 });
  assert.notEqual(pt1, pt2);
  assert.equal(fmtNum(2.5, 1), '2,5');
  useLang('en'); assert.equal(fmtNum(2.5, 1), '2.5'); assert.equal(fmtNum(1234), '1,234');
  useLang('es'); assert.equal(fmtNum(2.5, 1), '2,5');
  assert.equal(t('nao.existe'), 'nao.existe');
  useLang('pt');
});
