// O que entra de fora (link, arquivo importado, localStorage antigo) passa pelo filtro de parâmetros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byType, defaultParams, validParams } from '../js/pedals/index.js';

test('validParams: só números finitos dentro da faixa; o resto volta ao padrão', () => {
  const amp = byType.amp, d = defaultParams(amp);
  const v = validParams(amp, { gain: 'alto', bass: NaN, mid: 99, treble: -3, volume: 7.25, cab: 2.6, extra: 1, __proto__: { x: 1 } });
  assert.equal(v.gain, d.gain);
  assert.equal(v.bass, d.bass);
  assert.equal(v.mid, 10);
  assert.equal(v.treble, 0);
  assert.equal(v.volume, 7.25);
  assert.equal(v.cab, 3);
  assert.equal('extra' in v, false);
  assert.deepEqual(validParams(amp, null), d);
  assert.deepEqual(validParams(amp, 'lixo'), d);
});

test('validParams: select fora da lista é cortado para a última opção', () => {
  const eco = byType['eco-8'], sel = eco.controls.find(c => c.type === 'select');
  assert.equal(validParams(eco, { [sel.id]: 999 })[sel.id], sel.options.length - 1);
  assert.equal(validParams(eco, { [sel.id]: -4 })[sel.id], 0);
});

test('ajuda: todo pedal tem uma linha "o que faz" e todo botão uma dica, nos três idiomas', async () => {
  const { DICTS } = await import('../js/i18n.js');
  for (const lang of ['pt', 'en', 'es'])
    for (const def of Object.values(byType)) {
      assert.ok(DICTS[lang][`help.about.${def.type}`], `${lang}: help.about.${def.type}`);
      for (const c of def.controls) assert.ok(DICTS[lang][`help.knob.${def.type}.${c.id}`], `${lang}: help.knob.${def.type}.${c.id}`);
    }
});

test('www.sh e pages.yml copiam a mesma lista de pastas do app (o app nativo e o site não divergem)', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('..', import.meta.url).pathname;
  const list = s => s.match(/cp -r (.+?) (?:www|_site)\//)[1].split(/\s+/).filter(f => f !== 'privacy.html').sort();
  const www = list(readFileSync(`${root}scripts/www.sh`, 'utf8'));
  const pages = list(readFileSync(`${root}.github/workflows/pages.yml`, 'utf8'));
  assert.deepEqual(www, pages);
  // E tudo que o service worker guarda está dentro dessas pastas.
  const shell = readFileSync(`${root}sw.js`, 'utf8').match(/'([^']+)'/g).map(s => s.slice(1, -1)).filter(s => s.includes('.') && !s.startsWith('pedaleira'));
  const outside = shell.filter(f => f !== './' && !www.some(d => f === d || f.startsWith(`${d}/`)));
  assert.deepEqual(outside, [], 'arquivos do SHELL fora das pastas copiadas');
});
