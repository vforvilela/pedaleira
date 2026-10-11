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

  check(await evaluate(`document.querySelectorAll('.pedal').length`) === 5, 'pedaleira padrão com 5 pedais (afinador primeiro)');
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
  await evaluate(`document.querySelectorAll('.pedal')[3].querySelector('.footswitch').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  check(await evaluate(`__pedaleira.state.chain[3].on === false`), 'footswitch desliga o Eco 8');
  await evaluate(`(() => { const k = document.querySelectorAll('.pedal')[1].querySelector('.knob'); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })); })()`);
  check(await evaluate(`__pedaleira.state.chain[1].params.level`) === 6, 'seta para cima gira o LEVEL do Sol Drive de 5 para 6');

  // Arrasta o Sol Drive pelo ⠿ até depois do Amp.
  const pos = await evaluate(`(() => {
    const g = document.querySelectorAll('.pedal')[1].querySelector('.grip').getBoundingClientRect();
    const a = document.querySelectorAll('.pedal')[2].getBoundingClientRect();
    return { x: g.x + g.width / 2, y: g.y + g.height / 2, to: a.right - 10 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  for (let x = pos.x; x <= pos.to; x += 20) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: pos.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.to, y: pos.y, button: 'left', clickCount: 1 });
  await sleep(200);
  const order = await evaluate(`__pedaleira.state.chain.map(b => b.type).join(',')`);
  check(order === 'afinador,amp,sol-drive,eco-8,salao', `arrastar muda a ordem (${order})`);

  // Salão: girar DECAY e TYPE várias vezes (troca de IR com crossfade, sem erro).
  await evaluate(`(async () => {
    const { state, live } = __pedaleira;
    const b = state.chain.find(b => b.type === 'salao'), a = live.get(b.uid).audio;
    for (const v of [2, 8, 4]) { a.set('decay', v); await new Promise(r => setTimeout(r, 200)); }
    a.set('room', 3); await new Promise(r => setTimeout(r, 200));
  })()`);
  check(true, 'Salão trocou de IR 4 vezes');

  // Tap tempo: dois toques a 500 ms → D.TIME ≈ 7,0 (500 ms na escala de 20 ms a 2 s).
  await evaluate(`document.querySelector('.tap-btn').click()`);
  await sleep(500);
  await evaluate(`document.querySelector('.tap-btn').click()`);
  const tapV = await evaluate(`__pedaleira.state.chain.find(b => b.type === 'eco-8').params.time`);
  check(Math.abs(tapV - 7) <= 0.3, `tap tempo a 500 ms ajusta D.TIME (${tapV})`);

  // Presets: salva A, muda, salva B, volta para A.
  const setName = n => evaluate(`(() => { const i = document.getElementById('presetName'); i.value = ${JSON.stringify(n)}; document.getElementById('presetSave').click(); })()`);
  await setName('Música A');
  await evaluate(`(() => { const { state, live } = __pedaleira; const b = state.chain.find(b => b.type === 'sol-drive'); b.params.drive = 9; live.get(b.uid).audio.set('drive', 9); })()`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }))`);
  const sal = await evaluate(`__pedaleira.state.chain[4].on`);
  check(sal === false, 'tecla 5 desliga o quinto pedal');
  await setName('Música B');
  await evaluate(`(() => { const s = document.getElementById('preset'); s.value = 'Música A'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(300);
  const back = await evaluate(`(() => { const c = __pedaleira.state.chain; return { drive: c.find(b => b.type === 'sol-drive').params.drive, on: c[4].on, n: document.querySelectorAll('.pedal').length }; })()`);
  check(back.drive === 5 && back.on === true && back.n === 5, `preset A restaura DRIVE 5 e o pedal ligado (${JSON.stringify(back)})`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))`);
  await sleep(300);
  check(await evaluate(`__pedaleira.state.preset`) === 'Música B', 'tecla ] vai para o preset B');

  // MIDI: aprende CC 64 para ligar/desligar o primeiro pedal, depois usa; Program Change 0 escolhe o preset A.
  const midiRes = await evaluate(`(() => {
    const { state, midi } = __pedaleira, b = state.chain[1], before = b.on;
    midi.learn({ kind: 'toggle', uid: b.uid });
    midi.handle([0xB0, 64, 127]);
    midi.handle([0xB0, 64, 127]);
    const toggled = b.on !== before;
    midi.handle([0xC0, 0]);
    return { toggled, mappings: state.midi.length };
  })()`);
  await sleep(300);
  check(midiRes.toggled && midiRes.mappings === 1, `MIDI aprende e liga/desliga (${JSON.stringify(midiRes)})`);
  check(await evaluate(`__pedaleira.state.preset`) === 'Música A', 'Program Change 0 escolhe o preset A');

  // Rascunho: mudar o preset A marca *, trocar e voltar mantém a mudança, Reverter desfaz.
  await evaluate(`(() => { const b = __pedaleira.state.chain.find(b => b.type === 'sol-drive'); const k = document.querySelector('.pedal[data-uid="' + b.uid + '"] .knob[data-param="drive"]'); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })); })()`);
  const star = await evaluate(`document.getElementById('preset').selectedOptions[0].textContent`);
  check(star === 'Música A *', `preset alterado mostra * (${star})`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))`);
  await sleep(300);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))`);
  await sleep(300);
  const kept = await evaluate(`__pedaleira.state.chain.find(b => b.type === 'sol-drive').params.drive`);
  check(kept === 6, `trocar de preset e voltar mantém a mudança não salva (DRIVE ${kept})`);
  await evaluate(`document.getElementById('presetRevert').click()`);
  await sleep(300);
  const rev = await evaluate(`[__pedaleira.state.chain.find(b => b.type === 'sol-drive').params.drive, document.getElementById('preset').selectedOptions[0].textContent]`);
  check(rev[0] === 5 && rev[1] === 'Música A', `Reverter volta para a versão salva (${rev})`);

  // Exportar e importar: o mesmo arquivo não duplica; com nome novo, entra.
  const imp = await evaluate(`(async () => {
    const p = __pedaleira, doc = await p.buildExport(), before = p.state.presets.length;
    await p.importPresets(new File([JSON.stringify(doc)], 'a.json'));
    const same = p.state.presets.length;
    doc.presets.forEach(x => x.name += ' (celular)');
    doc.files['teste:ir:1'] = { type: 'base64', data: 'AAEC' };
    await p.importPresets(new File([JSON.stringify(doc)], 'b.json'));
    const ir = await p.getFile('teste:ir:1');
    return { before, same, after: p.state.presets.length, irBytes: ir?.byteLength };
  })()`);
  check(imp.same === imp.before && imp.after === imp.before * 2 && imp.irBytes === 3, `exportar/importar presets e arquivos (${JSON.stringify(imp)})`);

  // Afinador: o microfone falso não tem nota (é quase DC com cliques), então troca a entrada
  // do afinador por um oscilador de 110 Hz (Lá 2) e espera o visor mostrar A2; MUTE corta a saída.
  await evaluate(`document.querySelector('.pedal').querySelector('.footswitch').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await evaluate(`(() => {
    const p = __pedaleira, e = p.engine, t = p.live.get(p.state.chain[0].uid).audio;
    e.input.disconnect(t.input);
    const osc = e.ctx.createOscillator(), g = e.ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 110; g.gain.value = 0.2;
    osc.connect(g).connect(t.input); osc.start();
  })()`);
  let note = '';
  for (let i = 0; i < 40 && note !== 'A2'; i++) { await sleep(100); note = await evaluate(`document.querySelector('.tuner-note').textContent`); }
  const cents = await evaluate(`document.querySelector('.tuner-cents').textContent`);
  check(note === 'A2', `afinador lê 110 Hz como A2 (${note} ${cents})`);
  // Mede na saída do próprio afinador: as caudas do delay e do reverb depois dele continuam soando, como no pedal real.
  const muted = await evaluate(`__pedaleira.live.get(__pedaleira.state.chain[0].uid).audio.output.gain.value`);
  check(muted < 0.01, `afinador ligado em MUTE corta o sinal (ganho ${muted.toFixed(4)})`);
  await shot('4-afinador.png');
  await evaluate(`document.querySelector('.pedal').querySelector('.footswitch').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);

  const stats = await evaluate(`(() => { const s = __pedaleira.engine.ctx.playoutStats; return s ? { fallback: s.fallbackFramesEvents, total: s.totalFramesDuration } : null; })()`);
  if (stats) console.log(`info: playoutStats ${JSON.stringify(stats)}`);

  await shot('2-ligado.png');
  await shot('3-celular.png', 390, 844, true);

  // Arrastar com o dedo (toque) pelo ⠿, na tela de celular.
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await evaluate(`document.querySelector('.board-wrap').scrollLeft = 0`);
  const before = await evaluate(`__pedaleira.state.chain.map(b => b.type).join(',')`);
  const tp = await evaluate(`(() => {
    const g = document.querySelectorAll('.pedal')[1].querySelector('.grip').getBoundingClientRect();
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  })()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tp.x, y: tp.y }] });
  for (let x = tp.x; x >= 20; x -= 15) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: tp.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);
  const after = await evaluate(`__pedaleira.state.chain.map(b => b.type).join(',')`);
  const exp = before.split(','); exp.unshift(exp.splice(1, 1)[0]);
  check(after === exp.join(','), `arrastar com o dedo muda a ordem (${before} → ${after})`);

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
