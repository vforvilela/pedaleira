// Teste de fumaça no Chrome headless com microfone falso.
// Uso: node tests/browser-smoke.mjs [pasta-de-saida]
// Sobe um servidor local, abre o app, liga o áudio, carrega uma captura NAM no amp e tira screenshots.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const out = process.argv[2] || mkdtempSync(join(tmpdir(), 'pedaleira-smoke-'));
mkdirSync(out, { recursive: true });
const PORT = 8765, DBG = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', root], { stdio: 'ignore' });
const chrome = spawn('google-chrome', [
  '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'chr-'))}`,
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,900', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

try {
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    await sleep(200);
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
      const page = tabs.find(t => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* ainda subindo */ }
  }
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'erro no evaluate');
    return r.result.result.value;
  };
  const shot = async (name, w = 1280, h = 900, mobile = false) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await sleep(300);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, name), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1500);

  check(await evaluate(`document.querySelectorAll('.pedal').length`) === 4, 'pedaleira padrão com 4 pedais');
  await shot('1-desligado.png');

  await evaluate(`document.getElementById('power').click()`);
  await sleep(2500);
  const st = await evaluate(`document.getElementById('status').textContent`);
  check(await evaluate(`__pedaleira.engine.running`), `áudio ligado (status: "${st}")`);
  check(await evaluate(`!!__pedaleira.engine.wasmBytes`), 'nam.wasm baixado e válido');

  const outPeak = () => evaluate(`(() => { const e = __pedaleira.engine, b = new Float32Array(1024); let p = 0;
    for (let i = 0; i < 1; i++) p = Math.max(p, e.peak(b, e.outAnalyser)); return p; })()`);
  // O microfone falso toca bipes: mede o pico de saída durante 1,5 s.
  const peakOver = async ms => { let p = 0; for (let t = 0; t < ms; t += 50) { p = Math.max(p, await outPeak()); await sleep(50); } return p; };
  const p1 = await peakOver(1500);
  check(p1 > 0.001, `sinal na saída com o circuito interno (pico ${p1.toFixed(4)})`);

  // Carrega uma captura NAM no amp.
  const loadRes = await evaluate(`(async () => {
    const { state, live } = __pedaleira;
    const amp = state.chain.find(b => b.type === 'amp');
    const nam = await (await fetch('tests/fixtures/wavenet_a1_standard.nam')).json();
    const info = await live.get(amp.uid).audio.loadFile('nam', nam);
    return info;
  })()`);
  check(loadRes?.engine === 'wasm', `captura NAM carregada no amp (motor: ${loadRes?.engine})`);
  const p2 = await peakOver(1500);
  check(p2 > 0.001, `sinal na saída com NAM (pico ${p2.toFixed(4)})`);

  // Liga/desliga o delay e gira um botão pelo teclado.
  await evaluate(`document.querySelectorAll('.pedal')[2].querySelector('.footswitch').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  check(await evaluate(`__pedaleira.state.chain[2].on === false`), 'footswitch desliga o Eco 8');
  await evaluate(`(() => { const k = document.querySelectorAll('.pedal')[0].querySelector('.knob'); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })); })()`);
  check(await evaluate(`__pedaleira.state.chain[0].params.level`) === 6, 'seta para cima gira o LEVEL do Sol Drive de 5 para 6');

  // Arrasta o Sol Drive pelo ⠿ até depois do Amp.
  const pos = await evaluate(`(() => {
    const g = document.querySelectorAll('.pedal')[0].querySelector('.grip').getBoundingClientRect();
    const a = document.querySelectorAll('.pedal')[1].getBoundingClientRect();
    return { x: g.x + g.width / 2, y: g.y + g.height / 2, to: a.right - 10 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  for (let x = pos.x; x <= pos.to; x += 20) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: pos.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.to, y: pos.y, button: 'left', clickCount: 1 });
  await sleep(200);
  const order = await evaluate(`__pedaleira.state.chain.map(b => b.type).join(',')`);
  check(order === 'amp,sol-drive,eco-8,salao', `arrastar muda a ordem (${order})`);

  const stats = await evaluate(`(() => { const s = __pedaleira.engine.ctx.playoutStats; return s ? { fallback: s.fallbackFramesEvents, total: s.totalFramesDuration } : null; })()`);
  if (stats) console.log(`info: playoutStats ${JSON.stringify(stats)}`);

  await shot('2-ligado.png');
  await shot('3-celular.png', 390, 844, true);

  check(errors.length === 0, `sem erros no console${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`);
  console.log(`screenshots em ${out}`);
  ws.close();
} catch (e) {
  console.log('FAIL', e.message);
  failed = true;
} finally {
  chrome.kill(); server.kill();
}
process.exit(failed ? 1 : 0);
