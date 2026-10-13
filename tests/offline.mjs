// Offline e sinal fraco: carrega o app uma vez, derruba o servidor e recarrega; depois um servidor que aceita
// a conexão e nunca responde (palco com 3G ruim). Nos dois casos o app tem que abrir pelo cache.
// Uso: node tests/offline.mjs
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs'; import { join, extname } from 'node:path'; import { tmpdir } from 'node:os';
const root = new URL('..', import.meta.url).pathname; const PORT = 8791, DBG = 9391; const sleep = ms => new Promise(r => setTimeout(r, ms));
let mode = 'up'; const types = { '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const srv = http.createServer(async (q, s) => {
  if (mode === 'hang') return; // sinal fraco: conecta mas nunca responde
  const p = decodeURIComponent(new URL(q.url, 'http://x').pathname); const f = join(root, p.endsWith('/') ? p + 'index.html' : p);
  try { const b = await readFile(f); s.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); s.end(b); } catch { s.writeHead(404); s.end(); }
}).listen(PORT);
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'chr-'))}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--mute-audio', '--no-first-run', ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
let ws; for (let i = 0; i < 300 && !ws; i++) { await sleep(200); try { const t = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); const pg = t.find(x => x.type === 'page'); if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl); } catch {} }
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await Promise.race([sleep(1000).then(()=>({})), send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })])).result?.result?.value;
const booted = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const ok = await ev(`document.title!=='OLD' && !!(window.__pedaleira && document.querySelector('.pedal, [data-pedal], .board *'))`).catch(() => false); if (ok) return Date.now() - t0; await sleep(250); } return -1; };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
let failed = false; const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };
const t0 = await booted(15000); check(t0 >= 0, `abre online (${t0} ms)`);
check(await ev(`navigator.serviceWorker.ready.then(r => !!r.active)`), 'service worker ativo');
await sleep(3000);
const n = await ev(`caches.keys().then(async k => (await (await caches.open(k[0])).keys()).length)`); check(n > 50, `${n} arquivos no cache`);
for (const m of ['down', 'hang']) {
  mode = m; if (m === 'down') { srv.closeAllConnections(); srv.close(); }
  else { srv.listen(PORT); await sleep(300); }
  await ev(`document.title='OLD'`); send('Page.reload', { ignoreCache: false });
  await sleep(500);
  const t = await booted(20000); check(t >= 0 && t < 8000, `${m === 'down' ? 'abre offline (sem servidor)' : 'abre com sinal fraco (servidor mudo)'}: ${t} ms`);
  if (m === 'down') await new Promise(r => setTimeout(r, 300));
}
chrome.kill(); srv.closeAllConnections(); srv.close(); process.exit(failed ? 1 : 0);
