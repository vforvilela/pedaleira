// Mantém o cache do service worker em dia: calcula o hash dos arquivos do SHELL e, se mudou desde a última
// vez, sobe a versão em sw.js (pedaleira-vN) e grava o hash novo. Rode `npm run sw` antes de commitar
// mudanças em js/, css/, index.html…; o teste em tests/validate.test.mjs cobra.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
export const shellHash = () => {
  const sw = readFileSync(`${root}sw.js`, 'utf8');
  const files = [...sw.matchAll(/'([^']+\.[a-z0-9]+)'/g)].map(m => m[1]).filter(f => f !== 'sw.js' && !f.startsWith('pedaleira'));
  const h = createHash('sha256');
  for (const f of [...new Set(files)].sort()) h.update(f).update(readFileSync(`${root}${f.replace(/^\.\//, '')}`));
  return h.digest('hex').slice(0, 12);
};
export const recorded = sw => sw.match(/const CACHE = 'pedaleira-v(\d+)'; \/\/ shell ([0-9a-f]{12})/);

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const sw = readFileSync(`${root}sw.js`, 'utf8');
  const m = recorded(sw), hash = shellHash();
  if (m && m[2] === hash) { console.log(`sw.js em dia (v${m[1]}, shell ${hash})`); process.exit(0); }
  const v = m ? +m[1] + 1 : +(sw.match(/pedaleira-v(\d+)/)?.[1] ?? 0) + 1;
  const out = sw.replace(/const CACHE = 'pedaleira-v\d+';[^\n]*/, `const CACHE = 'pedaleira-v${v}'; // shell ${hash}`);
  writeFileSync(`${root}sw.js`, out);
  console.log(`sw.js: pedaleira-v${v} (shell ${hash})`);
}
