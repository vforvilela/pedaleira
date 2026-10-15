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

test('Eco 8 SYNC: subdivisões do andamento; OFF usa o D.TIME', async () => {
  const { delaySeconds, SYNC } = await import('../js/pedals/eco-8.js');
  const at = (sync, bpm = 120) => delaySeconds({ time: 5, sync: SYNC.indexOf(sync) }, bpm);
  assert.equal(at('1/4'), 0.5);
  assert.equal(at('1/8'), 0.25);
  assert.equal(at('1/8.'), 0.375);
  assert.ok(Math.abs(at('1/8T') - 1 / 6) < 1e-9);
  assert.equal(at('1/16'), 0.125);
  assert.equal(at('1/4', 20), 2, 'nunca passa dos 2 s do buffer');
  assert.ok(Math.abs(at('OFF') - 0.2) < 1e-9, 'OFF: D.TIME 5 na escala log de 20 ms a 2 s = 200 ms');
});

test('Pulso: botão BPM ↔ BPM', async () => {
  const { bpmOf, knobOfBpm } = await import('../js/pedals/pulso.js');
  for (const bpm of [40, 60, 97, 120, 240]) assert.equal(bpmOf(knobOfBpm(bpm)), bpm);
});
