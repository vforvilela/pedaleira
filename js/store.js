// Persistência: estado da pedaleira no localStorage, arquivos (.nam, IR) no IndexedDB.
// Tudo protegido por try/catch: em janela anônima ou com armazenamento bloqueado o app funciona sem salvar.
const KEY = 'pedaleira.v1';

export function loadState() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

// Devolve false quando não conseguiu guardar (janela anônima, armazenamento bloqueado ou cheio).
export function saveState(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('pedaleira', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

// Arquivos já lidos ficam na memória: trocar de preset não espera o IndexedDB nem o JSON de novo.
// preloadFiles enche o cache ao ligar o som com tudo que os presets usam (até PRELOAD_BYTES).
// LRU: o Map guarda a ordem de uso; passou de CACHE_BYTES, sai o que não é usado há mais tempo.
const cache = new Map();
const PRELOAD_BYTES = 200 << 20, CACHE_BYTES = 256 << 20;
const sizeOf = v => (v instanceof ArrayBuffer ? v.byteLength : v?.weights?.length ? v.weights.length * 8 : 65536);
let cacheBytes = 0;
function remember(key, value) {
  if (cache.has(key)) { cacheBytes -= sizeOf(cache.get(key)); cache.delete(key); }
  cache.set(key, value);
  cacheBytes += sizeOf(value);
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_BYTES || k === key) break;
    cache.delete(k); cacheBytes -= sizeOf(v);
  }
}
function recall(key) {
  if (!cache.has(key)) return undefined;
  const v = cache.get(key);
  cache.delete(key); cache.set(key, v); // vai para o fim: usado agora
  return v;
}

export const putFile = (key, value) => { remember(key, value); persist(); return tx('readwrite', s => s.put(value, key)).catch(() => {}); };

export async function preloadFiles(keys) {
  let bytes = 0, n = 0;
  for (const key of new Set(keys)) {
    if (bytes > PRELOAD_BYTES) break;
    const v = await getFile(key);
    if (v !== undefined) { bytes += sizeOf(v); n++; }
  }
  return { n, bytes };
}

// Pede ao navegador para não apagar os dados quando faltar espaço (capturas e IRs dão trabalho para achar de novo).
let asked = false;
export function persist() {
  if (asked || !navigator.storage?.persist) return;
  asked = true;
  navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
}
// { cache: false }: só lê (exportar passa por todos os arquivos e não precisa deixá-los na memória).
export const getFile = async (key, { cache: keep = true } = {}) => {
  const hit = recall(key);
  if (hit !== undefined) return hit;
  const v = await tx('readonly', s => s.get(key)).catch(() => undefined);
  if (v !== undefined && keep) remember(key, v);
  return v;
};
export const deleteFile = key => { if (cache.has(key)) { cacheBytes -= sizeOf(cache.get(key)); cache.delete(key); } return tx('readwrite', s => s.delete(key)).catch(() => {}); };
