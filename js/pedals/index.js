import solDrive from './sol-drive.js';
import eco8 from './eco-8.js';
import salao from './salao.js';
import amp from './amp.js';

export const PEDALS = [solDrive, amp, eco8, salao];
export const byType = Object.fromEntries(PEDALS.map(p => [p.type, p]));

export const DEFAULT_CHAIN = ['sol-drive', 'amp', 'eco-8', 'salao'];

export function defaultParams(def) {
  return Object.fromEntries(def.controls.map(c => [c.id, c.default]));
}
