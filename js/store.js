// Persistência: estado da pedaleira no localStorage, arquivos (.nam, IR) no IndexedDB.
// Tudo protegido por try/catch: em janela anônima ou com armazenamento bloqueado o app funciona sem salvar.
const KEY = 'pedaleira.v1';

export function loadState() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

export function saveState(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sem armazenamento */ }
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

export const putFile = (key, value) => { persist(); return tx('readwrite', s => s.put(value, key)).catch(() => {}); };

// Pede ao navegador para não apagar os dados quando faltar espaço (capturas e IRs dão trabalho para achar de novo).
let asked = false;
export function persist() {
  if (asked || !navigator.storage?.persist) return;
  asked = true;
  navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
}
export const getFile = key => tx('readonly', s => s.get(key)).catch(() => undefined);
export const deleteFile = key => tx('readwrite', s => s.delete(key)).catch(() => {});
