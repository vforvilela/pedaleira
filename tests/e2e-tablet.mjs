// E2E no tablet: Chrome headless com toque de verdade (Input.dispatchTouchEvent), não element.click().
// Uso: node tests/e2e-tablet.mjs [pasta-de-saida]
// Cobre: tela sem rolagem em pé e deitado, + Pedal → gaveta → pedal novo na pedaleira, fechar a gaveta
// (✕, fora dela, Esc), arrastar com o dedo com zoom, alvos de toque e a guarda de inicialização
// (arquivo que falha e app.js de versão velha no cache, a causa do "+ Pedal não faz nada").
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const out = process.argv[2] || mkdtempSync(join(tmpdir(), 'pedaleira-e2e-'));
mkdirSync(out, { recursive: true });
const PORT = 8766, DBG = 9334;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', root], { stdio: 'ignore' });
const chrome = spawn('google-chrome', [
  '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'chr-'))}`,
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--mute-audio', '--no-first-run',
  ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

const TABLETS = [
  [1024, 768, 'iPad deitado'], [768, 1024, 'iPad em pé'], [1180, 820, 'iPad Air deitado'],
  [820, 1180, 'iPad Air em pé'], [1366, 1024, 'iPad Pro deitado'], [1024, 1366, 'iPad Pro em pé'],
];

try {
  let ws;
  for (let i = 0; i < 300 && !ws; i++) {
    await sleep(200);
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
      const page = tabs.find(t => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* ainda subindo */ }
  }
  if (!ws) throw new Error('Chrome não abriu a porta de depuração em 60 s');
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map(), handlers = [];
  const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    for (const h of handlers) h(m);
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'erro no evaluate');
    return r.result.result.value;
  };
  const viewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, name), Buffer.from(r.result.data, 'base64'));
  };
  // Toque de verdade: o navegador gera pointerdown/up e o click, como no iPad.
  const tap = async (x, y) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };
  // Centro do elemento na tela (rola para dentro da área visível do contêiner dele antes).
  const center = sel => ev(`(() => {
    const e = ${sel};
    if (!e) return null;
    e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`);
  const tapEl = async sel => { const c = await center(sel); if (!c) throw new Error(`não achei ${sel}`); await tap(c.x, c.y); return c; };
  const open = () => ev(`document.getElementById('libSheet').open`);
  const chain = () => ev(`__pedaleira.state.chain.map(b => __pedaleira.live.get(b.uid).def.name).join(',')`);
  const noScroll = () => ev(`(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth,
    vh: innerHeight, vw: innerWidth, fits: (() => { const b = document.getElementById('board').getBoundingClientRect(),
    w = document.getElementById('board').parentElement.getBoundingClientRect(); return b.bottom <= w.bottom + 1; })(),
    z: document.getElementById('board').style.zoom }))()`);

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await viewport(1024, 768);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1500);

  check(await ev(`document.documentElement.dataset.ready === '1' && document.getElementById('bootFail').hidden`), 'app inicia inteiro (data-ready) e sem aviso de erro');
  check(await ev(`matchMedia('(pointer: coarse)').matches`), 'emulação de toque ativa (pointer: coarse)');
  // Primeiros passos: fecha com toque.
  if (!(await ev(`document.getElementById('intro').hidden`))) await tapEl(`document.getElementById('introOk')`);

  // ---------- Sem rolagem, em todos os tablets, em pé e deitado ----------
  const fitAll = async label => {
    for (const [w, h, name] of TABLETS) {
      await viewport(w, h); await sleep(350);
      const m = await noScroll();
      check(m.sh <= m.vh && m.sw <= m.vw && m.fits, `${label}, ${name} ${w}×${h}: sem rolagem (página ${m.sw}×${m.sh}, zoom ${m.z})`);
    }
    await viewport(1024, 768); await sleep(350);
  };
  await fitAll('5 pedais');
  await ev(`(() => { const s = document.getElementById('preset'); const o = [...s.options].find(o => /Crunch/.test(o.textContent)); s.value = o.value; s.dispatchEvent(new Event('change')); })()`);
  await sleep(600);
  await fitAll('6 pedais (Crunch)');
  const zLand = await ev(`document.getElementById('board').style.zoom`);
  await viewport(768, 1024); await sleep(350);
  const zPort = await ev(`document.getElementById('board').style.zoom`);
  check(zLand !== zPort, `girar o tablet recalcula o tamanho da pedaleira (deitado ${zLand}, em pé ${zPort})`);
  await viewport(1024, 768); await sleep(350);

  // ---------- + Pedal ----------
  check(!(await open()), 'gaveta começa fechada');
  const btn = await center(`document.getElementById('libOpen')`);
  check(btn.w >= 44 && btn.h >= 44, `+ Pedal tem alvo de toque ≥ 44 px (${Math.round(btn.w)}×${Math.round(btn.h)})`);
  check(await ev(`(() => { const r = document.getElementById('libOpen').getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#libOpen') !== null; })()`),
    '+ Pedal não está coberto por outro elemento');
  await tap(btn.x, btn.y);
  check(await open(), 'tocar no + Pedal abre a gaveta da biblioteca');
  const nAdd = await ev(`[...document.querySelectorAll('#library .add')].filter(b => b.getBoundingClientRect().width > 0).length`);
  check(nAdd >= 20, `gaveta mostra a biblioteca inteira (${nAdd} pedais)`);
  await shot('1-gaveta.png');
  const before = await chain();
  await tapEl(`[...document.querySelectorAll('#library .add')].find(b => b.querySelector('b').textContent === 'Coro')`);
  await sleep(400);
  const after = await chain();
  check(after.split(',').length === before.split(',').length + 1 && after.split(',').includes('Coro') && !before.split(',').includes('Coro'),
    `tocar num pedal da gaveta põe ele na pedaleira (${before} → ${after})`);
  check(!(await open()), 'escolher um pedal fecha a gaveta');
  const m = await noScroll();
  check(m.sh <= m.vh && m.fits, `com o pedal novo, continua sem rolagem (zoom ${m.z})`);
  await shot('2-pedal-novo.png');

  // Fechar sem escolher: ✕, toque fora da gaveta, Esc. Toque dentro (no título) não fecha.
  const openLib = async () => { await tapEl(`document.getElementById('libOpen')`); if (!(await open())) throw new Error('+ Pedal não abriu a gaveta'); };
  await openLib();
  await tapEl(`document.getElementById('libTitle')`);
  check(await open(), 'tocar dentro da gaveta (no título) não fecha');
  await tapEl(`document.getElementById('libClose')`);
  check(!(await open()), '✕ fecha a gaveta');
  await openLib();
  await tap(40, 400);
  check(!(await open()), 'tocar fora da gaveta (no fundo escuro) fecha');
  await openLib();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);
  check(!(await open()), 'Esc fecha a gaveta');
  check(await chain() === after, 'fechar a gaveta sem escolher não muda a pedaleira');
  // Repetido rápido: abre e fecha 5 vezes, termina no estado certo.
  for (let i = 0; i < 5; i++) { await tapEl(`document.getElementById('libOpen')`); await tapEl(`document.getElementById('libClose')`); }
  check(!(await open()) && await chain() === after, 'abrir e fechar 5 vezes seguidas não deixa a gaveta presa nem muda nada');

  // ---------- Topo estável ----------
  // Nada que aparece no uso pode mudar a altura do topo: mudaria o tamanho da pedaleira e o lugar dos botões
  // (foi assim que o + Pedal "fugiu" do dedo depois do primeiro pedal adicionado).
  const layoutNow = () => ev(`(() => ({ top: document.querySelector('.top').getBoundingClientRect().height,
    deck: document.querySelector('.deck').getBoundingClientRect().height, z: document.getElementById('board').style.zoom }))()`);
  const stable = async (what, change) => {
    const a = await layoutNow(); await ev(change); await sleep(300); const b = await layoutNow();
    check(a.top === b.top && a.deck === b.deck && a.z === b.z, `${what}: topo e pedaleira não mudam de tamanho (${JSON.stringify(a)} → ${JSON.stringify(b)})`);
  };
  check(!(await ev(`document.getElementById('presetRevert').hidden`)), 'preset alterado mostra o Reverter');
  await stable('Reverter some (preset salvo)', `document.getElementById('presetRevert').hidden = true`);
  await stable('Reverter volta', `document.getElementById('presetRevert').hidden = false`);
  await stable('aparecem Canal e Instalar', `document.getElementById('channel').hidden = false; document.getElementById('install').hidden = false`);
  await stable('aviso comprido', `document.getElementById('status').textContent = 'Para instalar no iPhone/iPad: toque em Compartilhar (□↑) e depois em "Adicionar à Tela de Início". '.repeat(2)`);
  await ev(`document.getElementById('channel').hidden = true; document.getElementById('install').hidden = true`);

  // ---------- Alvos de toque ----------
  const small = await ev(`[...document.querySelectorAll('button, select, input:not([type=file])')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 43.5 || r.height < 43.5); })
    .map(e => (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + '×' + Math.round(e.getBoundingClientRect().height))`);
  check(small.length === 0, `todo botão e campo com ≥ 44 px na tela, mesmo com a pedaleira reduzida${small.length ? ': ' + small.join(', ') : ''}`);

  // ---------- Arrastar com o dedo, com zoom ----------
  const order0 = await chain();
  const g = await center(`[...document.querySelectorAll('#board .pedal')].at(-1).querySelector('.grip')`);
  const t = await ev(`(() => { const r = document.querySelectorAll('#board .pedal')[1].getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.x, y: g.y }] });
  for (let k = 1; k <= 20; k++) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g.x + (t.x - g.x) * k / 20, y: g.y + (t.y - g.y) * k / 20 }] });
  await sleep(200);
  const follow = await ev(`(() => { const p = document.querySelector('.pedal.dragging'); if (!p) return null; p.style.transition = 'none';
    const r = p.querySelector('.grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  check(follow && Math.hypot(follow.x - t.x, follow.y - t.y) < 4, `com zoom, o pedal arrastado segue o dedo (${follow && `${Math.round(follow.x)},${Math.round(follow.y)} vs ${Math.round(t.x)},${Math.round(t.y)}`})`);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const order1 = await chain();
  const last = order0.split(',').at(-1);
  check(order1.split(',')[1] === last, `arrastar o último pedal para o 2º lugar (${order0} → ${order1})`);

  check(errors.length === 0, `sem erros no console${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`);

  // ---------- Guarda de inicialização ----------
  // Intercepta arquivos do app (Fetch) e serve o que cada caso precisa; o resto vai para o servidor.
  let serve = null;
  handlers.push(async m => {
    if (m.method !== 'Fetch.requestPaused') return;
    const body = serve?.(m.params.request.url);
    if (body == null) return send('Fetch.continueRequest', { requestId: m.params.requestId });
    if (body === 404) return send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, body: '' });
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(body).toString('base64') });
  });
  // Sem o service worker: ele buscaria pela rede por conta própria, fora da interceptação desta página.
  await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/js/*' }] });

  // 1) Um módulo falha (404): aviso aparece logo, não 15 s depois.
  serve = url => (url.endsWith('/js/scenes.js') ? 404 : null);
  await send('Page.reload'); await sleep(1500);
  check(await ev(`!document.getElementById('bootFail').hidden && !document.documentElement.dataset.ready`), 'arquivo do app que não carrega: mostra o aviso com Recarregar');
  await shot('3-aviso.png');
  // Recarregar com o servidor já bom: volta a funcionar e o aviso some.
  serve = null;
  await tapEl(`document.getElementById('bootReload')`);
  await sleep(2000);
  check(await ev(`document.documentElement.dataset.ready === '1' && document.getElementById('bootFail').hidden`), 'Recarregar busca de novo e o app inicia inteiro');

  // 2) A causa do "+ Pedal não faz nada": index.html novo com app.js velho (de antes da gaveta) no cache.
  //    O app.js velho roda sem erro, mas não liga o + Pedal nem marca data-ready: a guarda avisa em 15 s.
  //    Simulado com o app.js atual sem essas linhas (o CI clona sem histórico).
  const oldApp = readFileSync(join(root, 'js/app.js'), 'utf8').split('\n')
    .filter(l => !/libOpen|libClose|dataset\.ready/.test(l)).join('\n');
  serve = url => (url.endsWith('/js/app.js') ? oldApp : null);
  await send('Page.reload'); await sleep(1500);
  check(await ev(`!document.documentElement.dataset.ready`), 'app.js velho: o app não se dá por iniciado');
  await sleep(15000);
  check(await ev(`!document.getElementById('bootFail').hidden`), 'app.js velho: em 15 s aparece o aviso, em vez de botões mortos sem explicação');
  serve = null;
  await send('Fetch.disable');

  console.log(`screenshots em ${out}`);
  ws.close();
} catch (e) {
  console.log('FAIL', e.message);
  failed = true;
} finally {
  chrome.kill(); server.kill();
}
process.exit(failed ? 1 : 0);
