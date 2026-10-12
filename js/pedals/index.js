import afinador from './afinador.js';
import ua from './ua.js';
import aperto from './aperto.js';
import turbo from './turbo.js';
import solDrive from './sol-drive.js';
import marimbondo from './marimbondo.js';
import ratazana from './ratazana.js';
import abafa from './abafa.js';
import silencio from './silencio.js';
import amp from './amp.js';
import equalizador from './equalizador.js';
import coro from './coro.js';
import fase90 from './fase-90.js';
import ondas from './ondas.js';
import volume from './volume.js';
import eco8 from './eco-8.js';
import salao from './salao.js';
import laco from './laco.js';
import oitava from './oitava.js';
import flange from './flange.js';
import baleia from './baleia.js';

// Na ordem em que costumam ficar na pedaleira (é também a ordem da lista "Adicionar pedal").
export const PEDALS = [afinador, ua, baleia, oitava, aperto, turbo, solDrive, ratazana, marimbondo, abafa, silencio, amp, equalizador, coro, flange, fase90, ondas, volume, eco8, salao, laco];
export const byType = Object.fromEntries(PEDALS.map(p => [p.type, p]));

export const DEFAULT_CHAIN = ['afinador', 'sol-drive', 'amp', 'eco-8', 'salao'];

// Ao adicionar, o pedal entra antes do primeiro de ordem maior. O gate fica depois dos drives
// (corta também o chiado que eles somam) e antes do amp.
export const ORDER = { tuner: 0, filter: 1, comp: 2, drive: 3, gate: 4, amp: 5, eq: 6, mod: 7, volume: 8, time: 9, looper: 10 };

export function defaultParams(def) {
  return Object.fromEntries(def.controls.map(c => [c.id, c.default]));
}
