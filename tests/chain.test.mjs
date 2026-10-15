// A cadeia como dado puro: migração do estado salvo (qualquer versão), rascunho e cenas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, chainDirty, migrateState, newBlock, normalizeChain, sameChain, withScene } from '../js/chain.js';
import { DEFAULT_CHAIN } from '../js/pedals/index.js';

const factory = [{ name: 'Limpo', aliases: ['Limpo', 'Clean', 'Limpio'], chain: [newBlock('amp')] }];

test('migrateState: sem nada salvo, pedaleira padrão, intro por ver e presets de fábrica', () => {
  const s = migrateState(null, { factory, factoryVersion: 2 });
  assert.equal(s.schema, SCHEMA_VERSION);
  assert.deepEqual(s.chain.map(b => b.type), DEFAULT_CHAIN);
  assert.equal(s.introDone, false);
  assert.equal(s.master, -6);
  assert.deepEqual(s.presets.map(p => p.name), ['Limpo']);
  assert.equal(s.factory, 2);
});

test('migrateState: estado antigo (cenas booleanas, sem schema, campos faltando) vira o formato atual', () => {
  const old = {
    master: -3, chain: [{ uid: 'a1', type: 'sol-drive', on: true, params: { drive: 7 }, scenes: [true, false] }],
    presets: [{ name: 'Música', chain: [{ uid: 'a1', type: 'sol-drive', params: { drive: 7 } }] }],
    preset: 'Música', factory: 2,
  };
  const s = migrateState(old, { factory, factoryVersion: 2 });
  assert.equal(s.schema, SCHEMA_VERSION);
  assert.equal(s.introDone, true, 'quem já usava não vê o cartão');
  assert.deepEqual(s.chain[0].scenes, [{ on: true, params: null }, { on: false, params: null }, null, null]);
  assert.equal(s.chain[0].params.level, 5, 'controle que faltava ganha o padrão');
  assert.equal(s.chain[0].params.drive, 7);
  assert.equal(s.preset, 'Música');
  assert.equal(s.presets.length, 1, 'fábrica já na versão 2: não ganha de novo');
});

test('migrateState: lixo no estado salvo não derruba o app', () => {
  const junk = {
    master: 'alto', inputGain: Infinity, inputChannel: 7, deviceId: 42,
    chain: [null, { type: 'inexistente' }, { uid: '../x', type: 'amp', params: { gain: 'x', cab: 99 }, files: { nam: { key: 1, url: 'javascript:1' }, ir: 'x' } }],
    presets: [{ name: '' }, { chain: [] }, { name: 'ok', chain: 'não' }], preset: 'sumiu', drafts: { ok: [{ type: 'amp' }] }, midi: [{ foo: 1 }, { key: 'cc:1:1', target: { kind: 'toggle' } }],
  };
  const s = migrateState(junk);
  assert.equal(s.master, -6);
  assert.equal(s.inputGain, 0);
  assert.equal(s.inputChannel, 'auto');
  assert.equal(s.deviceId, '');
  assert.equal(s.chain.length, 1);
  assert.match(s.chain[0].uid, /^[\w-]+$/);
  assert.equal(s.chain[0].params.gain, 5);
  assert.equal(s.chain[0].params.cab, 3);
  assert.equal(s.chain[0].files.nam.url, undefined, 'url que não é https cai');
  assert.equal('ir' in s.chain[0].files, false);
  assert.deepEqual(s.presets.map(p => p.name), ['ok']);
  assert.equal(s.preset, null, 'preset selecionado que não existe some');
  assert.equal(s.midi.length, 1);
});

test('chainDirty: trocar de cena não suja o preset; mudar um botão suja', () => {
  const b = newBlock('sol-drive');
  b.scenes[1] = { on: false, params: { drive: 9 } };
  const preset = normalizeChain([b]);
  const live = normalizeChain([b]);
  assert.equal(chainDirty(live, preset), false);
  assert.equal(chainDirty(withScene(live, 1), preset), false, 'cena B aplicada continua limpo');
  live[0].params.drive = 2;
  assert.equal(chainDirty(live, preset), true);
  assert.equal(chainDirty(live, undefined), false, 'sem preset não há rascunho');
});

test('sameChain: ordem dos pedais e arquivos contam; ordem das chaves não', () => {
  const a = normalizeChain([newBlock('amp'), newBlock('eco-8')]);
  const same = JSON.parse(JSON.stringify(a));
  assert.equal(sameChain(a, same), true);
  assert.equal(sameChain(a, [same[1], same[0]]), false);
  same[0].files.nam = { name: 'x', key: 'k' };
  assert.equal(sameChain(a, same), false);
});

test('migrateState: primeira visita começa em modo simples; quem já usava fica no modo completo', () => {
  const first = migrateState(null, { factory, factoryVersion: 2 });
  assert.equal(first.simple, true);
  const old = migrateState({ chain: [{ uid: 'q', type: 'amp' }], presets: [], preset: null }, { factory, factoryVersion: 2 });
  assert.equal(old.preset, null);
  assert.equal(old.simple, false);
});

test('migrateState: nível e andamento do preset são opcionais e ficam na faixa', () => {
  const s = migrateState({ trim: 40, bpm: 'x', presets: [{ name: 'a', chain: [], trim: -30, bpm: 90 }, { name: 'b', chain: [] }] });
  assert.equal(s.trim, 12);
  assert.equal(s.bpm, 120);
  assert.equal(s.presets[0].trim, -12);
  assert.equal(s.presets[0].bpm, 90);
  assert.equal('trim' in s.presets[1], false);
});
