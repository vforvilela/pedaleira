import solDrive from './sol-drive.js';
import eco8 from './eco-8.js';
import salao from './salao.js';
import amp from './amp.js';
import afinador from './afinador.js';
import silencio from './silencio.js';
import aperto from './aperto.js';
import marimbondo from './marimbondo.js';

export const PEDALS = [afinador, silencio, aperto, solDrive, marimbondo, amp, eco8, salao];
export const byType = Object.fromEntries(PEDALS.map(p => [p.type, p]));

export const DEFAULT_CHAIN = ['afinador', 'sol-drive', 'amp', 'eco-8', 'salao'];

// Ordem comum na pedaleira: ao adicionar, o pedal entra antes do primeiro de ordem maior.
export const ORDER = { tuner: 0, gate: 1, comp: 2, drive: 3, amp: 4, time: 9 };

export function defaultParams(def) {
  return Object.fromEntries(def.controls.map(c => [c.id, c.default]));
}
