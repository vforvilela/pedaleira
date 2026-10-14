// Caminhos do app nativo (Capacitor) sem WebView: um window.Capacitor de mentira antes de importar platform.js.
// Exportar e gravar vão para a folha de compartilhar; o MIDI nativo alimenta o mesmo aprendizado do Web MIDI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Midi } from '../js/midi.js';

const calls = [];
globalThis.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
  Plugins: {
    Filesystem: { writeFile: async o => { calls.push(['writeFile', o]); return { uri: 'file:///cache/' + o.path }; } },
    Share: { share: async o => { calls.push(['share', o]); } },
    StatusBar: { hide: async () => { calls.push(['hide']); } },
    KeepAwake: { keepAwake: async () => calls.push(['keepAwake']), allowSleep: async () => calls.push(['allowSleep']) },
    Midi: { bluetooth: async () => { calls.push(['bluetooth']); return { inputs: ['Chocolate Plus'] }; } },
  },
};
const platform = await import('../js/platform.js');

test('no app nativo, platform.js sabe que é nativo, esconde a barra de status e vê o MIDI', () => {
  assert.equal(platform.isNative, true);
  assert.equal(platform.platform, 'android');
  assert.equal(platform.hasNativeMidi, true);
  assert.deepEqual(calls.find(c => c[0] === 'hide'), ['hide']);
});

test('saveFile no app grava no cache em base64 e abre a folha de compartilhar', async () => {
  calls.length = 0;
  await platform.saveFile(new Blob(['{"a":1}'], { type: 'application/json' }), 'presets.json');
  assert.deepEqual(calls, [
    ['writeFile', { path: 'presets.json', data: 'eyJhIjoxfQ==', directory: 'CACHE' }],
    ['share', { title: 'presets.json', files: ['file:///cache/presets.json'] }],
  ]);
});

test('saveFile aguenta um arquivo de alguns MB (base64 em pedaços)', async () => {
  calls.length = 0;
  const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i & 0xff);
  await platform.saveFile(new Blob([big]), 'rec.webm');
  const b64 = calls[0][1].data;
  assert.equal(Buffer.from(b64, 'base64').length, big.length);
  assert.equal(Buffer.from(b64, 'base64')[1000], 1000 & 0xff);
});

test('keepAwake usa o plugin do sistema', async () => {
  calls.length = 0;
  await platform.keepAwake(true);
  await platform.keepAwake(false);
  assert.deepEqual(calls, [['keepAwake'], ['allowSleep']]);
});

test('MIDI nativo: sem requestMIDIAccess, a fonte nativa ensina e dispara como o Web MIDI', async () => {
  assert.equal(navigator.requestMIDIAccess, undefined, 'o Node não tem Web MIDI');
  let send = null;
  const actions = [], learned = [];
  const midi = new Midi([], {
    onAction: (target, msg) => actions.push([target, msg.value]),
    onLearned: target => learned.push(target),
    onChange: () => {},
    native: async onMessage => { send = onMessage; return ['Footswitch USB']; },
  });
  await midi.enable();
  assert.deepEqual(midi.inputNames(), ['Footswitch USB']);
  midi.learn({ kind: 'pedal', index: 2 });
  send(Uint8Array.from([0xb0, 20, 127]));
  assert.deepEqual(learned, [{ kind: 'pedal', index: 2 }]);
  send(Uint8Array.from([0xb0, 20, 127]));
  assert.deepEqual(actions, [[{ kind: 'pedal', index: 2 }, 127]]);
  send(Uint8Array.from([0xc0, 4]));
  assert.deepEqual(actions.at(-1), [{ kind: 'program' }, 4]);
});

test('pairBluetoothMidi chama o plugin e devolve as entradas', async () => {
  calls.length = 0;
  assert.deepEqual(await platform.pairBluetoothMidi(), ['Chocolate Plus']);
  assert.deepEqual(calls, [['bluetooth']]);
});

test('MIDI nativo: entradas que chegam depois (Bluetooth) atualizam inputNames', async () => {
  let announce = null;
  const midi = new Midi([], {
    onAction: () => {}, onLearned: () => {}, onChange: () => {},
    native: async (_onMessage, onInputs) => { announce = onInputs; return []; },
  });
  await midi.enable();
  assert.deepEqual(midi.inputNames(), []);
  announce(['Chocolate Plus']);
  assert.deepEqual(midi.inputNames(), ['Chocolate Plus']);
});
