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
  // Português nos testes (o headless sai em inglês e ignora --lang); a seção de idiomas troca pela escolha guardada.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!localStorage.getItem('brasa.lang')) localStorage.setItem('brasa.lang', 'pt'); } catch {}` });
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
      await viewport(w, h); await sleep(900);
      const m = await noScroll();
      check(m.sh <= m.vh && m.sw <= m.vw && m.fits, `${label}, ${name} ${w}×${h}: sem rolagem (página ${m.sw}×${m.sh}, zoom ${m.z})`);
    }
    await viewport(1024, 768); await sleep(900);
  };
  await fitAll('5 pedais');
  await ev(`(() => { const s = document.getElementById('preset'); const o = [...s.options].find(o => /Crunch/.test(o.textContent)); s.value = o.value; s.dispatchEvent(new Event('change')); })()`);
  await sleep(600);
  await fitAll('6 pedais (Crunch)');
  // Redimensionar devagar (arrastar a janela, dividir a tela do iPad): o topo tem só duas formas e os pedais
  // não ficam pulando de fileira a cada pixel.
  const layoutAt = () => ev(`(() => { const b = document.getElementById('board'); let rows = 0, bot = -1e9;
    for (const c of b.children) { if (c.offsetTop >= bot - 1) { rows++; bot = c.offsetTop + c.offsetHeight; } else bot = Math.max(bot, c.offsetTop + c.offsetHeight); }
    return { top: Math.round(document.querySelector('.top').getBoundingClientRect().height), rows }; })()`);
  for (const dir of [1, -1]) {
    const tops = new Set(); let flips = 0, prev = null;
    for (let i = 0; i <= 40; i++) {
      const w = dir > 0 ? 770 + i * 16 : 1410 - i * 16;
      await viewport(w, 800); await sleep(40);
      const m = await layoutAt();
      tops.add(m.top);
      if (prev && m.rows !== prev.rows) flips++;
      prev = m;
    }
    check(tops.size <= 2 && flips <= 2, `redimensionando ${dir > 0 ? 'para mais largo' : 'para mais estreito'}: topo com ${tops.size} forma(s), fileiras trocam ${flips} vez(es)`);
  }
  // No fim do redimensionamento, a arrumação é a mesma de abrir a página direto naquele tamanho.
  const settled = async () => ev(`(() => { const b = document.getElementById('board');
    return b.style.zoom + ' / ' + [...b.children].map(c => c.offsetTop).join(','); })()`);
  for (const w of [1300, 1200, 1100, 1000, 900, 1180]) { await viewport(w, 820); await sleep(30); }
  await sleep(900);
  const afterResize = await settled();
  await send('Page.reload'); await sleep(1500);
  const afterLoad = await settled();
  check(afterResize === afterLoad, `depois de redimensionar fica igual a abrir a página no tamanho final (${afterResize} | ${afterLoad})`);
  await viewport(1024, 768); await sleep(900);
  const zLand = await ev(`document.getElementById('board').style.zoom`);
  await viewport(768, 1024); await sleep(900);
  const zPort = await ev(`document.getElementById('board').style.zoom`);
  check(zLand !== zPort, `girar o tablet recalcula o tamanho da pedaleira (deitado ${zLand}, em pé ${zPort})`);
  await viewport(1024, 768); await sleep(900);

  // ---------- Jeito de app ----------
  const app = await ev(`(() => { const w = document.querySelector('.board-wrap').getBoundingClientRect();
    const meta = n => document.querySelector('meta[name="' + n + '"]')?.content;
    return { bottom: Math.round(w.bottom), left: Math.round(w.left), right: Math.round(w.right), vh: innerHeight, vw: innerWidth,
      capable: meta('apple-mobile-web-app-capable'), bar: meta('apple-mobile-web-app-status-bar-style'),
      overscroll: getComputedStyle(document.body).overscrollBehaviorY }; })()`);
  check(app.bottom === app.vh && app.left === 0 && app.right === app.vw, `pedaleira de borda a borda e até embaixo (${JSON.stringify(app)})`);
  check(app.capable === 'yes' && app.bar === 'black-translucent' && app.overscroll === 'none', 'instalada abre como app: sem barra do navegador e sem elástico na borda');
  check(!(await ev(`document.getElementById('fullscreen').hidden`)), 'tecla de tela cheia à vista no navegador');
  await tapEl(`document.getElementById('fullscreen')`);
  await sleep(500);
  check(await ev(`!!document.fullscreenElement && document.getElementById('fullscreen').getAttribute('aria-pressed') === 'true'`), 'tocar na tecla entra em tela cheia');
  await tapEl(`document.getElementById('fullscreen')`);
  await sleep(500);
  check(await ev(`!document.fullscreenElement && document.getElementById('fullscreen').getAttribute('aria-pressed') === 'false'`), 'tocar de novo sai da tela cheia');
  await viewport(1024, 768); await sleep(900);

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
    face: document.querySelector('.face').getBoundingClientRect().height, z: document.getElementById('board').style.zoom }))()`);
  const stable = async (what, change) => {
    const a = await layoutNow(); await ev(change); await sleep(300); const b = await layoutNow();
    check(a.top === b.top && a.face === b.face && a.z === b.z, `${what}: topo e pedaleira não mudam de tamanho (${JSON.stringify(a)} → ${JSON.stringify(b)})`);
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

  // ---------- Como no chão (sinal da direita para a esquerda) ----------
  const xs = () => ev(`(() => { const c = e => e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2;
    const j = [...document.querySelectorAll('#board .jack')], p = [...document.querySelectorAll('#board .pedal')];
    return { guitar: c(j[0]), out: c(j.at(-1)), p0: c(p[0]), p1: c(p[1]) }; })()`);
  const ltr = await xs();
  check(ltr.guitar < ltr.p0 && ltr.p0 < ltr.p1, `padrão: guitarra à esquerda, sinal para a direita (${JSON.stringify(ltr)})`);
  await tapEl(`document.getElementById('moreBtn')`);
  await tapEl(`document.getElementById('floorView')`);
  await sleep(300);
  const rtl = await xs();
  check(await ev(`document.getElementById('floorView').getAttribute('aria-pressed') === 'true' && __pedaleira.state.floorView`), 'Como no chão liga (aria-pressed e estado)');
  check(rtl.guitar > rtl.p0 && rtl.p0 > rtl.p1, `como no chão: guitarra à direita, sinal para a esquerda (${JSON.stringify(rtl)})`);
  const fm = await noScroll();
  check(fm.sh <= fm.vh && fm.fits, `como no chão: continua sem rolagem (zoom ${fm.z})`);
  await shot('3-como-no-chao.png');
  // Arrastar no espelho: o 1º pedal (mais à direita) solto à esquerda do 2º vira o 2º.
  const o0 = await chain();
  const g2 = await center(`document.querySelectorAll('#board .pedal')[0].querySelector('.grip')`);
  const t2 = await ev(`(() => { const r = document.querySelectorAll('#board .pedal')[1].getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g2.x, y: g2.y }] });
  for (let k = 1; k <= 15; k++) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g2.x + (t2.x - g2.x) * k / 15, y: g2.y + (t2.y - g2.y) * k / 15 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const o1 = await chain();
  check(o1.split(',')[1] === o0.split(',')[0] && o1.split(',')[0] === o0.split(',')[1], `como no chão: arrastar para a esquerda põe depois na cadeia (${o0} → ${o1})`);
  // Setas no ⠿ seguem a tela: ← leva para depois na cadeia.
  await ev(`document.querySelectorAll('#board .pedal')[0].querySelector('.grip').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await sleep(200);
  const o2 = await chain();
  check(o2.split(',')[1] === o1.split(',')[0], `como no chão: ← no ⠿ anda para a esquerda, que é depois na cadeia (${o1} → ${o2})`);
  await send('Page.reload'); await sleep(1500);
  check(await ev(`document.body.classList.contains('floor')`), 'como no chão continua depois de recarregar');
  await ev(`document.getElementById('floorView').click()`);
  await sleep(200);
  check(!(await ev(`document.body.classList.contains('floor')`)), 'desliga de novo');

  // ---------- Telefone: outra tela (em pé e deitado) ----------
  for (const [w, h, nome] of [[390, 844, 'telefone em pé'], [360, 640, 'telefone pequeno'], [844, 390, 'telefone deitado']]) {
    await viewport(w, h); await sleep(700);
    const ph = await ev(`(() => { const r = s => document.querySelector(s).getBoundingClientRect();
      const dockTop = Math.min(r('.scenes').top, r('.actions').top), board = r('#board'), wrap = r('.board-wrap');
      const keys = [...document.querySelectorAll('.scenes button, .actions button')].map(b => b.getBoundingClientRect());
      return { pagina: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
        cabe: board.bottom <= dockTop + 1 && board.top >= wrap.top - 1, dock: dockTop < innerHeight && r('.actions').bottom <= innerHeight + 1,
        teclas: Math.round(Math.min(...keys.map(k => Math.min(k.width, k.height)))), faixa: r('.rack').top >= innerHeight - 1 }; })()`);
    check(!ph.pagina && ph.cabe && ph.dock && ph.teclas >= 44 && ph.faixa,
      `${nome} ${w}×${h}: uma tela sem rolar, pedais inteiros acima do rodapé, cenas e ações ≥ 44 px, entrada guardada (${JSON.stringify(ph)})`);
    await shot(`fone-${w}x${h}.png`);
  }
  await viewport(390, 844); await sleep(600);
  // Gaveta de entrada e volume.
  await tapEl(`document.getElementById('rackOpen')`);
  await sleep(400);
  const gav = await ev(`(() => { const r = document.getElementById('rack').getBoundingClientRect(), f = document.getElementById('master').getBoundingClientRect();
    return { aberta: document.body.classList.contains('rack-on') && r.top < innerHeight - 100, fader: f.top >= r.top && f.bottom <= innerHeight && f.height >= 44 }; })()`);
  check(gav.aberta && gav.fader, `telefone: Entrada abre a gaveta com os faders à vista e no tamanho do dedo (${JSON.stringify(gav)})`);
  await shot('fone-gaveta.png');
  await tapEl(`document.getElementById('rackClose')`); await sleep(400);
  check(!(await ev(`document.body.classList.contains('rack-on')`)), 'telefone: ✕ fecha a gaveta');
  await tapEl(`document.getElementById('rackOpen')`); await sleep(400);
  await tap(200, 60); await sleep(400);
  check(!(await ev(`document.body.classList.contains('rack-on')`)), 'telefone: tocar fora (no fundo escuro) fecha a gaveta');
  // Mapa da cadeia: tocar no nome traz o pedal para a tela.
  const ultimo = await ev(`[...document.querySelectorAll('#chainMap .map-chip')].at(-1).dataset.uid`);
  await tapEl(`[...document.querySelectorAll('#chainMap .map-chip')].at(-1)`);
  await sleep(900);
  check(await ev(`(() => { const r = document.querySelector('.pedal[data-uid="${ultimo}"]').getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; })()`),
    'telefone: tocar no nome do pedal no mapa traz o pedal para a tela');
  // + Pedal no rodapé abre a biblioteca.
  await tapEl(`document.getElementById('libOpen')`);
  check(await open(), 'telefone: + Pedal no rodapé abre a biblioteca');
  await tapEl(`document.getElementById('libClose')`);
  await viewport(1024, 768); await sleep(900);

  // ---------- Cadeia longa: todos os pedais da biblioteca ----------
  await ev(`(() => { for (const b of document.querySelectorAll('#library .add')) b.click(); })()`);
  await sleep(600);
  for (const [w, h] of [[1024, 768], [768, 1024]]) {
    await viewport(w, h); await sleep(900); // ¼ s até o ajuste final + o deslize
    const lg = await ev(`(() => { const b = document.getElementById('board'), wr = b.parentElement;
      const tools = [...b.querySelectorAll('.tools button')].map(e => e.getBoundingClientRect()).filter(r => r.width);
      return { n: __pedaleira.state.chain.length, z: b.style.zoom, rola: wr.style.overflow === 'auto' || b.getBoundingClientRect().height > wr.clientHeight + 1,
        pagina: document.documentElement.scrollHeight > innerHeight, menor: Math.round(Math.min(...tools.map(r => Math.min(r.width, r.height)))) }; })()`);
    check(!lg.rola && !lg.pagina && lg.menor >= 36, `${lg.n} pedais em ${w}×${h}: cabe sem rolar (zoom ${lg.z}), botões com ≥ 36 px (${lg.menor})`);
  }
  await viewport(1024, 768); await sleep(300);

  check(errors.length === 0, `sem erros no console${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`);

  // ---------- Idiomas: inglês e espanhol (o espanhol é o mais comprido) ----------
  for (const L of ['en', 'es']) {
    // Do zero, como alguém que abre pela primeira vez com o sistema nesse idioma.
    await ev(`localStorage.clear(); localStorage.setItem('brasa.lang', '${L}')`);
    await viewport(1024, 768);
    await send('Page.reload'); await sleep(1800);
    if (!(await ev(`document.getElementById('intro').hidden`))) await tapEl(`document.getElementById('introOk')`);
    const info = await ev(`(() => ({
      lang: document.documentElement.lang, power: document.getElementById('power').textContent.trim(),
      presets: [...document.getElementById('preset').options].map(o => o.textContent).join(' | '),
      groups: [...document.querySelectorAll('.lib-group h3')].map(h => h.textContent).join(' | '),
      ptLeft: [...document.querySelectorAll('.top button, .top label, .top small, .top span, .lib-group h3, .caption, #intro')]
        .filter(e => e.offsetParent && /\b(Ligar|Salvar|Palco|Cenas?|Gravar|Entrada padrão|inspirado no|Dinâmica|Primeiros passos)\b/.test(e.textContent))
        .map(e => e.textContent.trim().slice(0, 30)) }))()`);
    check(info.lang === L && info.power && !/Ligar/.test(info.power), `${L}: página no idioma (lang=${info.lang}, LIGAR = "${info.power}")`);
    check(!/Limpo com chorus|Crunch: base e solo/.test(info.presets), `${L}: presets de fábrica com nome no idioma (${info.presets.slice(0, 90)}…)`);
    check(info.ptLeft.length === 0, `${L}: nenhum texto em português na tela${info.ptLeft.length ? ': ' + info.ptLeft.join(' / ') : ''}`);
    for (const [w, h] of [[1024, 768], [768, 1024], [390, 844]]) {
      await viewport(w, h); await sleep(900);
      const lay = await ev(`(() => {
        const cut = [...document.querySelectorAll('.top button, .top label, .scenes button, .actions button')]
          .filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && !e.closest('.pick'))
          .map(e => (e.id || e.className) + ' "' + e.textContent.trim().slice(0, 20) + '"');
        return { cut, scroll: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
          top: Math.round(document.querySelector('.top').getBoundingClientRect().height) };
      })()`);
      check(!lay.scroll && lay.cut.length === 0, `${L} ${w}×${h}: sem rolagem e nenhum rótulo cortado (topo ${lay.top} px)${lay.cut.length ? ': ' + lay.cut.join(', ') : ''}`);
      await shot(`idioma-${L}-${w}x${h}.png`);
    }
  }
  await ev(`localStorage.setItem('brasa.lang', 'pt')`);
  await viewport(1024, 768);
  await send('Page.reload'); await sleep(1500);
  check(await ev(`document.documentElement.lang === 'pt-BR' && document.getElementById('power').textContent.trim() === 'Ligar'`), 'voltando para português pelo seletor guardado');

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
