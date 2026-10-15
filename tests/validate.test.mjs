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
