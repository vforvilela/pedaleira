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
  // --mute-audio: o teste mede a saída dentro da página; nada toca nos alto-falantes de quem roda.
  '--mute-audio', '--window-size=1280,900', '--no-first-run',
  // CI (GitHub Actions): o Ubuntu novo restringe os namespaces que a sandbox do Chrome usa.
  ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

try {
  let ws;
  // O runner do CI às vezes leva dezenas de segundos para subir o Chrome.
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
  // Português nos testes (o headless sai em inglês e ignora --lang); a seção de idiomas troca pela escolha guardada.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!localStorage.getItem('brasa.lang')) localStorage.setItem('brasa.lang', 'pt'); } catch {}` });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1500);

  check(await evaluate(`document.querySelectorAll('.pedal').length`) === 5, 'pedaleira padrão com 5 pedais (afinador primeiro)');
  const facNames = await evaluate(`[...document.getElementById('preset').options].map(o => o.textContent).join(', ')`);
  check(['Limpo com chorus', 'Crunch: base e solo', 'Solo com delay', 'Fuzz anos 60', 'Ambiente'].every(n => facNames.includes(n)),
    `primeira visita já tem os presets de fábrica (${facNames})`);
  await shot('1-desligado.png');
  check(await evaluate(`!document.getElementById('intro').hidden`), 'primeira visita mostra os primeiros passos');
  await evaluate(`document.getElementById('introOk').click()`);
  check(await evaluate(`document.getElementById('intro').hidden && __pedaleira.state.introDone`), 'Entendi esconde os primeiros passos e lembra');

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

  // Canal da interface. O microfone falso manda o mesmo bipe nos 2 canais, ~1 por segundo: cada canal sozinho
  // chega inteiro, a mistura também, e o automático não escolhe (canais iguais).
  const chan = await evaluate(`(async () => {
    const e = __pedaleira.engine, b = new Float32Array(1024), wait = () => new Promise(r => setTimeout(r, 150));
    // Espera um bipe e mede a entrada junto com o canal cru: a razão é o ganho do caminho escolhido.
    // ch: canal escolhido; null: a mistura, comparada com a média dos dois.
    const peak = async ch => {
      await wait();
      for (let i = 0; i < 60; i++) {
        const r0 = e.peak(b, e.chAnalyser[0]), r1 = e.peak(b, e.chAnalyser[1]), inp = e.peak(b);
        const raw = ch === null ? (r0 + r1) / 2 : [r0, r1][ch];
        if (raw > 0.05) return inp / raw;
        await new Promise(r => setTimeout(r, 50));
      }
      return null; // esse canal não bipou (o microfone falso às vezes manda só um)
    };
    e.useChannel(1); const c2 = await peak(1);
    e.useChannel(0); const c1 = await peak(0);
    e.useChannel(null); const mix = await peak(null);
    return { c1, c2, mix, channels: e.channels, hidden: document.getElementById('channel').hidden,
      auto: document.getElementById('channel').options[0].textContent };
  })()`);
  check([chan.c1, chan.c2, chan.mix].filter(g => g !== null).length >= 2 && [chan.c1, chan.c2, chan.mix].every(g => g === null || Math.abs(g - 1) < 0.1),
    `canal escolhido passa inteiro (ganho: canal 1 = ${chan.c1?.toFixed(2)}, canal 2 = ${chan.c2?.toFixed(2)}, mistura = ${chan.mix?.toFixed(2)})`);
  check(chan.hidden === (chan.channels === 1), `seletor de canal some só com entrada mono (canais: ${chan.channels})`);
  check(chan.auto === 'Canal: auto', `automático não escolhe canal quando os dois são iguais ("${chan.auto}")`);

  // Gravar: o arquivo baixado tem o som da pedaleira.
  const rec = await evaluate(`(async () => {
    let blob = null, name = '';
    const orig = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = b => { blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { name = this.download; };
    const btn = document.getElementById('record');
    const shown = !btn.hidden;
    btn.click();
    await new Promise(r => setTimeout(r, 2500));
    const label = btn.textContent;
    btn.click();
    for (let i = 0; i < 40 && !blob; i++) await new Promise(r => setTimeout(r, 100));
    URL.createObjectURL = orig; HTMLAnchorElement.prototype.click = click;
    if (!blob) return { shown, label };
    const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
    const d = buf.getChannelData(0);
    let p = 0; for (const x of d) p = Math.max(p, Math.abs(x));
    return { shown, label, name, type: blob.type, secs: buf.duration, peak: p };
  })()`);
  check(rec.shown && /Parar/.test(rec.label) && rec.secs > 1.5 && rec.peak > 0.001 && /^tonesmith-.*\.(webm|m4a|ogg)$/.test(rec.name),
    `Gravar baixa o som tocado (${rec.name}, ${rec.type}, ${rec.secs?.toFixed(1)} s, pico ${rec.peak?.toFixed(3)}, botão "${rec.label}")`);

  // Carrega uma captura NAM no amp.
  const loadRes = await evaluate(`(async () => {
    const { state, live } = __pedaleira;
    const amp = state.chain.find(b => b.type === 'amp');
    const nam = await (await fetch('tests/fixtures/wavenet_a1_standard.nam')).json();
    const info = await live.get(amp.uid).audio.loadFile('nam', nam);
    return info;
  })()`);
  check(loadRes?.engine === 'wasm', `captura NAM carregada no amp (motor: ${loadRes?.engine})`);
  // Captura A2 (formato novo, dentro de um SlimmableContainer) também roda no wasm.
  const a2 = await evaluate(`(async () => {
    const { state, live } = __pedaleira;
    const amp = state.chain.find(b => b.type === 'amp');
    const nam = await (await fetch('tests/fixtures/A2.nam')).json();
    return live.get(amp.uid).audio.loadFile('nam', nam);
  })()`);
  check(a2?.engine === 'wasm', `captura NAM A2 carregada no amp (motor: ${a2?.engine})`);
  const p2 = await peakOver(1500);
  check(p2 > 0.001, `sinal na saída com NAM (pico ${p2.toFixed(4)})`);

  // Liga/desliga o delay e gira um botão pelo teclado.
  await evaluate(`document.querySelectorAll('.pedal')[3].querySelector('.footswitch').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  check(await evaluate(`__pedaleira.state.chain[3].on === false`), 'footswitch desliga o Eco 8');
  await evaluate(`(() => { const k = document.querySelectorAll('.pedal')[1].querySelector('.knob'); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })); })()`);
  check(await evaluate(`__pedaleira.state.chain[1].params.level`) === 6, 'seta para cima gira o LEVEL do Sol Drive de 5 para 6');

  // Arrasta o Sol Drive pelo ⠿ até depois do Amp.
  const pos = await evaluate(`(() => {
    const grip = document.querySelectorAll('.pedal')[1].querySelector('.grip');
    document.querySelector('.board-wrap').scrollLeft = 0;
    const g = grip.getBoundingClientRect();
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

  // MIDI: aprende CC 64 para ligar/desligar o primeiro pedal, depois usa; Program Change N escolhe o preset
  // N+1 da setlist (os de fábrica vêm antes do preset A).
  const midiRes = await evaluate(`(() => {
    const { state, midi } = __pedaleira, b = state.chain[1], before = b.on;
    midi.learn({ kind: 'toggle', uid: b.uid });
    midi.handle([0xB0, 64, 127]);
    midi.handle([0xB0, 64, 127]);
    const toggled = b.on !== before;
    const pc = state.presets.findIndex(p => p.name === 'Música A');
    midi.handle([0xC0, pc]);
    return { toggled, mappings: state.midi.length, pc };
  })()`);
  await sleep(300);
  check(midiRes.toggled && midiRes.mappings === 1, `MIDI aprende e liga/desliga (${JSON.stringify(midiRes)})`);
  check(await evaluate(`__pedaleira.state.preset`) === 'Música A', `Program Change ${midiRes.pc} escolhe o preset A`);

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
  // Tela alta: o toque precisa cair dentro dela, e a emulação não rola a página.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1200, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  // No telefone os pedais são grandes, um por vez: rola até o 2º pedal, arrasta até a borda esquerda e segura ali
  // (a pedaleira rola sozinha até o começo).
  await sleep(300);
  const before = await evaluate(`__pedaleira.state.chain.map(b => b.type).join(',')`);
  const tp = await evaluate(`(() => {
    const p = document.querySelectorAll('.pedal')[1];
    p.scrollIntoView({ inline: 'center', block: 'nearest' });
    const g = p.querySelector('.grip').getBoundingClientRect();
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  })()`);
  await sleep(100);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tp.x, y: tp.y }] });
  for (let x = tp.x; x >= 20; x -= 15) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: tp.y }] });
  for (let i = 0; i < 60; i++) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 10 + (i % 2), y: tp.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);
  const after = await evaluate(`__pedaleira.state.chain.map(b => b.type).join(',')`);
  const exp = before.split(','); exp.unshift(exp.splice(1, 1)[0]);
  check(after === exp.join(','), `arrastar com o dedo muda a ordem (${before} → ${after})`);
  // Toque sem arrastar num botão do pedal: abre os controles em tamanho de dedo (≥ 44 px).
  const kp = await evaluate(`(() => {
    const k = document.querySelector('.pedal .knob[data-param="level"]');
    k.closest('.pedal').scrollIntoView({ inline: 'center', block: 'nearest' });
    const r = k.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: kp.x, y: kp.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);
  const sheet = await evaluate(`(() => {
    const d = document.querySelector('.knob-sheet');
    if (!d?.open) return null;
    const rows = [...d.querySelectorAll('.knob-row input')];
    const minH = Math.min(...rows.map(i => i.getBoundingClientRect().height));
    const block = __pedaleira.state.chain.find(b => b.uid === document.querySelector('.pedal .knob[data-param="level"]').closest('.pedal').dataset.uid);
    const input = d.querySelector('input[data-param="level"]');
    input.value = 7.5; input.dispatchEvent(new Event('input'));
    const ok = block.params.level === 7.5;
    d.querySelector('button').click();
    return { rows: rows.length, minH, ok, closed: !d.open };
  })()`);
  check(sheet && sheet.minH >= 44 && sheet.ok && sheet.closed,
    `toque num botão abre os controles em tamanho de dedo (${JSON.stringify(sheet)})`);

  // Pedais novos entram na posição de costume: gate e compressor antes dos drives, fuzz junto dos drives.
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await shot('5-antes-dos-novos.png');
  for (const name of ['Marimbondo', 'Aperto', 'Silêncio'])
    await evaluate(`[...document.querySelectorAll('#library .add')].find(b => b.querySelector('b').textContent === ${JSON.stringify(name)}).click()`);
  await sleep(500);
  const order2 = await evaluate(`__pedaleira.state.chain.map(b => b.type).join(',')`);
  // (o teste de toque deixou o amp em primeiro: os novos entram antes dele, na ordem compressor → fuzz → gate)
  const at = t => order2.split(',').indexOf(t);
  check(at('aperto') < at('marimbondo') && at('marimbondo') < at('silencio') && at('silencio') < at('amp'),
    `gate, compressor e fuzz entram no lugar certo (${order2})`);
  const p3 = await peakOver(1500);
  check(p3 > 0.001, `sinal na saída com gate, compressor e fuzz ligados (pico ${p3.toFixed(4)})`);
  await shot('6-pedais-novos.png', 1600, 900);

  // Cenas: A = só o reverb e o delay; B = tudo. Trocar de cena não marca o preset com *.
  const sceneRes = await evaluate(`(async () => {
    const p = __pedaleira, c = p.state.chain, key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const setOn = on => c.forEach(b => { if (b.on !== on(b)) { const i = c.indexOf(b); key(String(i + 1)); } });
    setOn(b => b.type === 'eco-8' || b.type === 'salao' || b.type === 'amp');
    document.getElementById('sceneRec').click(); document.querySelectorAll('.scene-btn')[0].click();
    setOn(b => b.type !== 'afinador');
    document.getElementById('sceneRec').click(); document.querySelectorAll('.scene-btn')[1].click();
    const i = document.getElementById('presetName'); i.value = 'Cenas'; document.getElementById('presetSave').click();
    key('a');
    const a = c.filter(b => b.on).map(b => b.type).join(',');
    const starA = document.getElementById('preset').selectedOptions[0].textContent;
    const litA = document.querySelectorAll('.scene-btn')[0].getAttribute('aria-pressed');
    key('b');
    const b = c.filter(b => b.on).length;
    return { a, starA, litA, b, total: c.length };
  })()`);
  check(sceneRes.a === 'amp,eco-8,salao' && sceneRes.b === sceneRes.total - 1, `cenas A e B ligam os pedais gravados (${JSON.stringify(sceneRes)})`);
  check(sceneRes.starA === 'Cenas' && sceneRes.litA === 'true', `trocar de cena não marca o preset com * e acende o botão (${sceneRes.starA})`);
  const sceneMidi = await evaluate(`(() => {
    const { state, midi } = __pedaleira;
    midi.learn({ kind: 'scene', index: 0 });
    midi.handle([0xB0, 70, 127]); midi.handle([0xB0, 70, 0]);
    midi.handle([0xB0, 70, 127]);
    return state.chain.filter(b => b.on).map(b => b.type).join(',');
  })()`);
  check(sceneMidi === 'amp,eco-8,salao', `MIDI chama a cena A (${sceneMidi})`);
  await shot('7-cenas.png');

  // Footswitch Bluetooth de virar página: PageDown e seta para a direita trocam de preset.
  const pages = await evaluate(`(async () => {
    const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const seen = [__pedaleira.state.preset];
    for (const k of ['PageDown', 'ArrowRight', 'PageUp']) { key(k); await new Promise(r => setTimeout(r, 300)); seen.push(__pedaleira.state.preset); }
    return seen;
  })()`);
  const ix = pages.map(n => n);
  check(pages[1] !== pages[0] && pages[2] !== pages[1] && pages[3] === pages[1], `PageDown, seta e PageUp trocam de preset (${ix.join(' → ')})`);
  // Volta para o preset de antes (os de fábrica no meio da lista não têm todos os pedais dos testes seguintes).
  await evaluate(`(() => { const s = document.getElementById('preset'); s.value = ${JSON.stringify(ix[0])}; s.dispatchEvent(new Event('change')); })()`);

  // Cena guarda a posição dos botões: B com o Eco 8 mais alto; A volta ao normal.
  const sceneParams = await evaluate(`(() => {
    const p = __pedaleira, c = p.state.chain, eco = c.find(b => b.type === 'eco-8');
    const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const rec = i => { document.getElementById('sceneRec').click(); document.querySelectorAll('.scene-btn')[i].click(); };
    const base = eco.params.level;
    rec(0);
    eco.params.level = 9;
    rec(1);
    key('a'); const inA = eco.params.level;
    key('b'); const inB = eco.params.level;
    return { base, inA, inB };
  })()`);
  check(sceneParams.inB === 9 && sceneParams.inA === sceneParams.base, `cena guarda a posição dos botões (${JSON.stringify(sceneParams)})`);

  // Remover um pedal por engano e desfazer: volta no mesmo lugar, com as cenas.
  const undo = await evaluate(`(async () => {
    const p = __pedaleira, c = () => p.state.chain.map(b => b.type).join(',');
    const before = c(), n = p.state.chain.length;
    document.querySelectorAll('.pedal')[2].querySelector('.remove').click();
    const removed = p.state.chain.length === n - 1 && !document.getElementById('toast').hidden;
    document.querySelector('#toast button').click();
    await new Promise(r => setTimeout(r, 300));
    return { removed, back: c() === before, hidden: getComputedStyle(document.getElementById('toast')).display === 'none' };
  })()`);
  check(undo.removed && undo.back && undo.hidden, `remover pedal mostra Desfazer e desfazer devolve no lugar (${JSON.stringify(undo)})`);

  // Ganho de entrada.
  const gain = await evaluate(`(async () => {
    const i = document.getElementById('inGain'); i.value = 6; i.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 200));
    return [__pedaleira.state.inputGain, __pedaleira.engine.input.gain.value];
  })()`);
  check(gain[0] === 6 && Math.abs(gain[1] - 1.995) < 0.05, `ganho de entrada +6 dB (${gain})`);

  // Modo palco: abre, mostra preset e pedais, liga/desliga pelo botão grande, mostra o afinador, sai com Esc.
  const stage = await evaluate(`(async () => {
    const p = __pedaleira;
    document.getElementById('stageBtn').click();
    const shown = !document.getElementById('stage').hidden;
    const title = document.getElementById('stagePreset').textContent;
    const btns = document.querySelectorAll('.stage-pedal');
    const before = p.state.chain[1].on;
    btns[1].click();
    const toggled = p.state.chain[1].on !== before && document.querySelectorAll('.stage-pedal')[1].getAttribute('aria-pressed') === String(!before);
    document.querySelectorAll('.stage-pedal')[1].click();
    document.querySelectorAll('.stage-scene')[0].click();
    const sceneLit = document.querySelectorAll('.stage-scene')[0].getAttribute('aria-pressed');
    return { shown, title, pedals: btns.length, toggled, sceneLit, chain: p.state.chain.length };
  })()`);
  check(stage.shown && stage.title.startsWith(await evaluate('__pedaleira.state.preset')) && stage.pedals === stage.chain && stage.toggled && stage.sceneLit === 'true',
    `modo palco mostra preset, pedais e cenas e liga/desliga (${JSON.stringify(stage)})`);
  await evaluate(`(() => { const p = __pedaleira, t = p.state.chain.find(b => b.type === 'afinador'); if (!t.on) document.querySelector('.stage-pedal[aria-pressed="false"]') && [...document.querySelectorAll('.stage-pedal')][p.state.chain.indexOf(t)].click(); })()`);
  await sleep(400);
  check(await evaluate(`!document.getElementById('stageTuner').hidden`), 'afinador ligado aparece grande no modo palco');
  await shot('8-palco-celular.png', 390, 844, true);
  await shot('9-palco-pc.png');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check(await evaluate(`getComputedStyle(document.getElementById('stage')).display === 'none'`), 'Esc sai do modo palco');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // Amp interno: nível de saída razoável do limpo ao saturado (guitarra simulada a -20 dBFS).
  const ampLv = await evaluate(`(async () => {
    const { default: amp } = await import('./js/pedals/amp.js');
    const { defaultParams } = await import('./js/pedals/index.js');
    const res = {};
    for (const gain of [0, 5, 10]) {
      const ctx = new OfflineAudioContext(1, 48000, 48000);
      await ctx.audioWorklet.addModule('js/nam/nam-worklet.js');
      const a = amp.create(ctx, { params: { ...defaultParams(amp), gain } });
      a.setOn(true);
      const osc = ctx.createOscillator(); osc.frequency.value = 110;
      const g = ctx.createGain(); g.gain.value = 0.1;
      osc.connect(g).connect(a.input); a.output.connect(ctx.destination); osc.start();
      const out = (await ctx.startRendering()).getChannelData(0).subarray(24000);
      let sum = 0; for (const x of out) sum += x * x;
      res[gain] = Math.round(10 * Math.log10(sum / out.length));
    }
    return res;
  })()`);
  check(Object.values(ampLv).every(db => db > -40 && db < -3), `amp interno com nível de saída usável no limpo e no saturado (dB RMS por GAIN: ${JSON.stringify(ampLv)})`);

  // Setlist: subir, renomear, apagar e desfazer.
  const setl = await evaluate(`(async () => {
    const p = __pedaleira, names = () => p.state.presets.map(x => x.name);
    document.getElementById('presetOrganize').click();
    const open = document.getElementById('setlist').open;
    const before = names();
    document.querySelectorAll('#setlistItems li')[1].querySelector('.up').click();
    const moved = names()[0] === before[1] && names()[1] === before[0];
    const inp = document.querySelectorAll('#setlistItems li')[0].querySelector('input');
    inp.value = 'Abertura'; inp.dispatchEvent(new Event('change'));
    const renamed = names()[0] === 'Abertura';
    document.querySelectorAll('#setlistItems li')[0].querySelector('.del').click();
    const gone = !names().includes('Abertura');
    document.querySelector('#toast button').click();
    const back = names()[0] === 'Abertura';
    document.getElementById('setlistClose').click();
    return { open, moved, renamed, gone, back };
  })()`);
  // Modo palco com wah: fader grande muda a posição do pedal.
  const expr = await evaluate(`(async () => {
    const p = __pedaleira;
    [...document.querySelectorAll('#library .add')].find(b => b.querySelector('b').textContent === 'Uá').click();
    document.getElementById('stageBtn').click();
    const input = document.querySelector('#stageExpr input');
    input.value = 8.5; input.dispatchEvent(new Event('input'));
    const ua = p.state.chain.find(b => b.type === 'ua');
    const ok = !!input && ua.params.pedal === 8.5;
    document.getElementById('stageExit').click();
    return ok;
  })()`);
  check(expr, 'modo palco: fader grande controla o wah');
  check(Object.values(setl).every(Boolean), `setlist reordena, renomeia, apaga e desfaz (${JSON.stringify(setl)})`);

  // Link: copia a pedaleira atual e, aberto noutro lugar, vira um preset igual.
  const link = await evaluate(`(async () => {
    const p = __pedaleira;
    // Sem a janela de compartilhar do sistema (no headless ela nunca responde): testa o caminho de copiar.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const url = await p.shareLink();
    const chain = JSON.stringify(p.state.chain.map(b => [b.type, b.on, b.params]));
    const n = p.state.presets.length;
    p.state.presets.splice(0); // simula outro aparelho
    location.hash = url.slice(url.indexOf('#'));
    await new Promise(r => setTimeout(r, 800));
    return { len: url.length, got: p.state.presets.length, same: JSON.stringify(p.state.chain.map(b => [b.type, b.on, b.params])) === chain, hash: location.hash };
  })()`);
  check(link.got === 1 && link.same && link.hash === '' && link.len < 4000, `link compartilhado recria a pedaleira (${JSON.stringify(link)})`);

  // Medição de latência: num laço simulado de 10 ms dentro do navegador, acha ~10 ms.
  const rt = await evaluate(`(async () => {
    const ctx = new OfflineAudioContext(1, 48000 * 4, 48000);
    await ctx.audioWorklet.addModule('js/audio/dsp-worklet.js');
    const probe = new AudioWorkletNode(ctx, 'latency', { outputChannelCount: [1] });
    const cable = ctx.createDelay(1); cable.delayTime.value = 0.010;
    probe.connect(cable).connect(probe);
    probe.connect(ctx.destination); // sem isso o navegador não processa o nó
    let result = null;
    probe.port.onmessage = e => { result = e.data; };
    await ctx.startRendering();
    await new Promise(r => setTimeout(r, 100));
    // E no áudio ao vivo, sem cabo (microfone falso): termina e avisa que o clique não voltou.
    const live = await __pedaleira.engine.measureRoundTrip();
    return { result, live };
  })()`);
  check(rt.result?.hits >= 5 && rt.result.ms > 9.5 && rt.result.ms < 13.5 && rt.live && 'ms' in rt.live,
    `medição de latência acha o laço de 10 ms (${JSON.stringify(rt)})`);

  // Todos os pedais, com todos os botões no mínimo, no padrão e no máximo: nada de NaN, silêncio ou explosão.
  const matrix = await evaluate(`(async () => {
    const { PEDALS, defaultParams } = await import('./js/pedals/index.js');
    const bad = [], levels = {};
    for (const def of PEDALS) {
      for (const pos of ['min', 'padrão', 'max']) {
        const ctx = new OfflineAudioContext(1, 24000, 48000);
        await ctx.audioWorklet.addModule('js/nam/nam-worklet.js');
        await ctx.audioWorklet.addModule('js/audio/dsp-worklet.js');
        const params = defaultParams(def);
        if (pos !== 'padrão') for (const c of def.controls) params[c.id] = pos === 'min' ? 0 : c.type === 'select' ? c.options.length - 1 : 10;
        const a = def.create(ctx, { params });
        a.setOn(true);
        // Guitarra simulada: dente de serra de 110 Hz que decai, a -12 dBFS.
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 110;
        const env = ctx.createGain(); env.gain.setValueAtTime(0.25, 0); env.gain.setTargetAtTime(0.02, 0.05, 0.2);
        osc.connect(env).connect(a.input); a.output.connect(ctx.destination); osc.start();
        const out = (await ctx.startRendering()).getChannelData(0);
        let sum = 0, peak = 0, finite = true;
        for (const x of out) { if (!Number.isFinite(x)) finite = false; sum += x * x; peak = Math.max(peak, Math.abs(x)); }
        const db = Math.round(10 * Math.log10(sum / out.length + 1e-20));
        levels[def.type + ':' + pos] = db;
        // Volume no mínimo pode calar de propósito (pedal de volume, LEVEL 0); fora isso, tem que soar.
        const mayBeSilent = pos === 'min';
        // EQ com todas as faixas e o volume no máximo soma +30 dB de propósito (como o GE-7 de verdade).
        const maxPeak = def.type === 'equalizador' && pos === 'max' ? 40 : 8;
        if (!finite || peak > maxPeak || (!mayBeSilent && db < -60)) bad.push(def.type + ':' + pos + ' (' + (finite ? db + ' dB, pico ' + peak.toFixed(2) : 'NaN') + ')');
      }
    }
    return { bad, levels };
  })()`);
  check(matrix.bad.length === 0, `todos os pedais soam sem NaN, silêncio ou explosão no mínimo, padrão e máximo${matrix.bad.length ? ': ' + matrix.bad.join(', ') : ''}`);
  console.log('info: nível (dB RMS) por pedal e posição:', JSON.stringify(matrix.levels));

  // Latência: o limitador novo não atrasa nada; o DynamicsCompressorNode do navegador atrasa.
  const lat = await evaluate(`(async () => {
    const delayOf = async build => {
      const ctx = new OfflineAudioContext(1, 4800, 48000);
      await ctx.audioWorklet.addModule('js/audio/dsp-worklet.js');
      const buf = ctx.createBuffer(1, 4800, 48000); buf.getChannelData(0)[100] = 0.5;
      const src = ctx.createBufferSource(); src.buffer = buf;
      src.connect(build(ctx)).connect(ctx.destination); src.start();
      const out = (await ctx.startRendering()).getChannelData(0);
      let at = 0; for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > Math.abs(out[at])) at = i;
      return (at - 100) / 48;
    };
    return {
      ours: await delayOf(ctx => new AudioWorkletNode(ctx, 'limiter')),
      native: await delayOf(ctx => ctx.createDynamicsCompressor()),
    };
  })()`);
  check(lat.ours === 0, `limitador de saída sem atraso (nosso ${lat.ours} ms; o do navegador atrasaria ${lat.native} ms)`);

  // Os outros pedais: todos entram, tocam e não dão erro.
  const more = ['Uá', 'Baleia', 'Oitava', 'Turbo', 'Equalizador', 'Coro', 'Flange', 'Fase 90', 'Ondas', 'Volume', 'Laço'];
  for (const name of more)
    await evaluate(`[...document.querySelectorAll('#library .add')].find(b => b.querySelector('b').textContent === ${JSON.stringify(name)}).click()`);
  await sleep(600);
  const all = await evaluate(`__pedaleira.state.chain.map(b => b.type)`);
  check(['ua', 'baleia', 'oitava', 'turbo', 'equalizador', 'coro', 'flange', 'fase-90', 'ondas', 'volume', 'laco'].every(t => all.includes(t)) && all[all.length - 1] === 'laco',
    `os pedais novos entram, looper no fim (${all.join(',')})`);
  // Liga todos os pedais, e desliga o afinador (que cortaria o som em MUTE).
  await evaluate(`__pedaleira.state.chain.forEach((b, i) => { if (b.on === (b.type === 'afinador')) document.querySelectorAll('.pedal')[i].querySelector('.footswitch').dispatchEvent(new MouseEvent('click', { bubbles: true })); })`);
  const p4 = await peakOver(1500);
  check(p4 > 0.0005, `sinal na saída com todos os pedais ligados (pico ${p4.toFixed(4)})`);

  // Estéreo: com reverb e chorus, os dois lados da saída são diferentes (e nenhum está mudo).
  const stereo = await evaluate(`(async () => {
    const e = __pedaleira.engine, ctx = e.ctx;
    const split = ctx.createChannelSplitter(2), L = ctx.createAnalyser(), R = ctx.createAnalyser();
    L.fftSize = R.fftSize = 2048;
    e.limiter.connect(split); split.connect(L, 0); split.connect(R, 1);
    const a = new Float32Array(2048), b = new Float32Array(2048);
    let diff = 0, eL = 0, eR = 0;
    for (let t = 0; t < 15; t++) {
      await new Promise(r => setTimeout(r, 100));
      L.getFloatTimeDomainData(a); R.getFloatTimeDomainData(b);
      for (let i = 0; i < a.length; i++) { diff += (a[i] - b[i]) ** 2; eL += a[i] ** 2; eR += b[i] ** 2; }
    }
    e.limiter.disconnect(split);
    return { diffRatio: diff / (eL + eR + 1e-12), eL, eR };
  })()`);
  check(stereo.diffRatio > 0.01 && stereo.eL > 0 && stereo.eR > 0, `saída estéreo: reverb e chorus diferentes em cada lado (${JSON.stringify(stereo)})`);

  // Looper: grava 0,6 s, toca, sobrepõe, para, apaga.
  const loopStates = await evaluate(`(async () => {
    const p = __pedaleira, i = p.state.chain.findIndex(b => b.type === 'laco');
    const el = document.querySelectorAll('.pedal')[i], foot = el.querySelector('.footswitch');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const st = () => el.dataset.state;
    const seen = [st()];
    const press = async ms => { foot.dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(ms); seen.push(st()); };
    await press(600); await press(500); await press(500);
    el.querySelector('[data-action="stop"]').click(); await wait(200); seen.push(st());
    await press(500);
    el.querySelector('[data-action="clear"]').click(); await wait(200); seen.push(st());
    return seen;
  })()`);
  check(loopStates.join(',') === 'empty,rec,play,dub,stop,play,empty', `looper grava, toca, sobrepõe, para e apaga (${loopStates.join(' → ')})`);
  await evaluate(`document.querySelector('.pedal.treadle').scrollIntoView({ inline: 'center', block: 'nearest' }); scrollTo(0, 0)`);
  await shot('10-todos-os-pedais.png', 1600, 900);
  await evaluate(`document.querySelector('.pedal[data-uid] .slider')?.closest('.pedal').scrollIntoView({ inline: 'center', block: 'nearest' }); scrollTo(0, 0)`);
  await shot('11-equalizador.png', 1600, 900);

  // Captura por link: o botão NAM abre o painel, o link carrega, o link de preset leva o endereço
  // e quem abre o link recebe a captura baixada.
  const viaLink = await evaluate(`(async () => {
    const p = __pedaleira, wait = ms => new Promise(r => setTimeout(r, ms));
    if (!p.state.chain.some(b => b.type === 'amp')) document.querySelector('#library .add:not([hidden])') &&
      [...document.querySelectorAll('#library .add')].find(b => b.querySelector('b').textContent === 'Amp').click();
    const amp = p.state.chain.find(b => b.type === 'amp');
    document.querySelector('.pedal[data-uid="' + amp.uid + '"] .file-btn[data-kind="nam"]').click();
    const opened = document.getElementById('fileSheet').open;
    document.getElementById('fileUrl').value = location.origin + '/tests/fixtures/A2.nam';
    document.getElementById('fileUrlForm').requestSubmit();
    for (let i = 0; i < 50 && !amp.files.nam?.url; i++) await wait(100);
    const stored = !!amp.files.nam?.url && !document.getElementById('fileSheet').open;
    const link = await p.shareLink();
    const presets = p.state.presets.length;
    location.hash = new URL(link).hash;
    await p.openSharedLink();
    const got = p.state.chain.find(b => b.type === 'amp');
    const data = got?.files.nam ? await p.getFile(got.files.nam.key) : null;
    const urls = [
      p.directUrl('https://github.com/u/r/blob/main/caps/x.nam'),
      p.directUrl('https://www.dropbox.com/s/abc/x.nam?dl=0'),
    ];
    return { opened, stored, newPreset: p.state.presets.length === presets + 1, received: !!data?.architecture, urls };
  })()`);
  check(viaLink.opened && viaLink.stored && viaLink.newPreset && viaLink.received
    && viaLink.urls[0] === 'https://raw.githubusercontent.com/u/r/main/caps/x.nam'
    && viaLink.urls[1] === 'https://dl.dropboxusercontent.com/s/abc/x.nam',
    `captura por link vai junto no link de preset e chega baixada (${JSON.stringify(viaLink)})`);

  // Sugestões grátis no NAM do amp: 3 capturas; escolher uma carrega por link e desliga a caixa do amp.
  // O download é trocado pela captura de teste local (o CI não depende do GitHub).
  const sug = await evaluate(`(async () => {
    const p = __pedaleira, wait = ms => new Promise(r => setTimeout(r, ms));
    const realFetch = window.fetch, local = location.origin + '/tests/fixtures/A2.nam';
    window.fetch = (u, ...rest) => realFetch(String(u).includes('nam-profiles-colab') ? local : u, ...rest);
    try {
      const amp = p.state.chain.find(b => b.type === 'amp');
      document.querySelector('.pedal[data-uid="' + amp.uid + '"] .file-btn[data-kind="nam"]').click();
      const items = [...document.querySelectorAll('#fileSuggest:not([hidden]) .suggest')];
      items[2].click();
      for (let i = 0; i < 50 && !amp.files.nam?.url?.includes('5150'); i++) await wait(100);
      const cab = p.live.get(amp.uid).def.controls.find(c => c.id === 'cab').options[amp.params.cab];
      return { n: items.length, url: !!amp.files.nam?.url?.includes('nam-profiles-colab'), name: amp.files.nam?.name, cab,
        closed: !document.getElementById('fileSheet').open };
    } finally { window.fetch = realFetch; }
  })()`);
  check(sug.n === 3 && sug.url && sug.cab === 'OFF' && sug.closed, `capturas grátis sugeridas no amp carregam e desligam a caixa (${JSON.stringify(sug)})`);

  // IRs grátis no IR do amp: escolher uma liga o CAB em IR. Um link raw do GitHub de arquivo no Git LFS
  // (o raw só tem o ponteiro) é seguido até o media.githubusercontent.com.
  const irs = await evaluate(`(async () => {
    const p = __pedaleira, wait = ms => new Promise(r => setTimeout(r, ms));
    const realFetch = window.fetch, local = location.origin + '/tests/fixtures/cab-ir.wav', asked = [];
    window.fetch = (u, ...rest) => {
      u = String(u); asked.push(u.split('/')[2]);
      if (u.startsWith('https://raw.githubusercontent.com/')) return Promise.resolve(new Response('version https://git-lfs.github.com/spec/v1\\noid sha256:0\\nsize 1\\n', { headers: { 'content-length': '60' } }));
      return realFetch(u.startsWith('https://media.githubusercontent.com/') ? local : u, ...rest);
    };
    const amp = p.state.chain.find(b => b.type === 'amp');
    const cabOf = () => p.live.get(amp.uid).def.controls.find(c => c.id === 'cab').options[amp.params.cab];
    try {
      document.querySelector('.pedal[data-uid="' + amp.uid + '"] .file-btn[data-kind="ir"]').click();
      const title = document.getElementById('fileSuggestTitle').textContent;
      const items = [...document.querySelectorAll('#fileSuggest:not([hidden]) .suggest')];
      items[1].click();
      for (let i = 0; i < 50 && !amp.files.ir?.url?.includes('SM48'); i++) await wait(100);
      const sugg = { n: items.length, title, cab: cabOf(), name: amp.files.ir?.name, closed: !document.getElementById('fileSheet').open };
      p.setParam?.(amp, 'cab', 0);
      document.querySelector('.pedal[data-uid="' + amp.uid + '"] .file-btn[data-kind="ir"]').click();
      document.getElementById('fileUrl').value = 'https://github.com/alguem/irs/blob/main/minha%20caixa.wav';
      asked.length = 0;
      document.getElementById('fileUrlForm').requestSubmit();
      for (let i = 0; i < 50 && amp.files.ir?.name !== 'minha caixa'; i++) await wait(100);
      return { ...sugg, lfs: asked.join(' '), lfsName: amp.files.ir?.name, lfsCab: cabOf() };
    } finally { window.fetch = realFetch; }
  })()`);
  check(irs.n === 3 && irs.title === 'IRs grátis' && irs.cab === 'IR' && irs.closed && irs.name === 'Engl SM48',
    `IRs grátis sugeridas no amp carregam e ligam o CAB em IR (${JSON.stringify(irs)})`);
  check(irs.lfsName === 'minha caixa' && irs.lfs === 'raw.githubusercontent.com media.githubusercontent.com',
    `link do GitHub de IR no Git LFS é seguido até o arquivo (${irs.lfs})`);

  // Spillover: trocar para um preset sem o delay não corta a cauda; ela some depois de alguns segundos.
  const spill = await evaluate(`(async () => {
    const p = __pedaleira, e = p.engine, ctx = e.ctx, wait = ms => new Promise(r => setTimeout(r, ms));
    const an = ctx.createAnalyser(); an.fftSize = 2048; e.master.connect(an);
    const buf = new Float32Array(an.fftSize), peak = () => { an.getFloatTimeDomainData(buf); return Math.max(...buf.map(Math.abs)); };
    // Pedaleira só com o delay, ligado, realimentação alta e repetições curtas.
    await p.loadChain([{ uid: 'spill-eco', type: 'eco-8', on: true, params: { level: 10, feedback: 8, time: 1, mode: 0 }, files: {}, scenes: [] }], null);
    e.setInputGain(0);
    await wait(1200);
    e.setInputGain(-200);                // corta a guitarra: daqui em diante só a cauda soa
    await wait(30);
    const before = peak();
    await p.loadChain([], null);         // preset sem o delay
    await wait(400);
    const tail = peak();
    await wait(8500);
    const after = peak();
    e.master.disconnect(an); e.setInputGain(0);
    return { before: +before.toFixed(4), tail: +tail.toFixed(4), after: +after.toFixed(5) };
  })()`);
  check(spill.tail > 0.005 && spill.after < 0.0005, `delay continua soando depois da troca de preset e some depois (${JSON.stringify(spill)})`);

  // Celular: em todos os pedais, um toque no primeiro botão abre o painel com um slider de ≥ 44 px por controle.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 2400, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await sleep(300);
  await evaluate(`(() => { // completa a pedaleira com os pedais que os testes anteriores tiraram
    const on = new Set(__pedaleira.state.chain.map(b => __pedaleira.live.get(b.uid).def.name));
    for (const b of document.querySelectorAll('#library .add')) if (!on.has(b.querySelector('b').textContent)) b.click();
  })()`);
  await sleep(500);
  const uids = await evaluate(`[...document.querySelectorAll('#board .pedal')].map(p => p.dataset.uid)`);
  const sheetBad = [];
  for (const uid of uids) {
    const kp = await evaluate(`(() => {
      const wrap = document.querySelector('.board-wrap'), p = document.querySelector('.pedal[data-uid="${uid}"]');
      wrap.scrollLeft += p.getBoundingClientRect().left - 60;
      const r = p.querySelector('.knob').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [kp] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
    const r = await evaluate(`(() => {
      const d = document.querySelector('.knob-sheet'), b = __pedaleira.state.chain.find(b => b.uid === '${uid}');
      const def = __pedaleira.live.get('${uid}').def;
      const name = def.name;
      if (!d?.open) return { name, open: false };
      const hs = [...d.querySelectorAll('.knob-row input')].map(i => Math.round(i.getBoundingClientRect().height));
      const res = { name, open: true, rows: hs.length, want: def.controls.length, minH: Math.min(...hs), fits: d.getBoundingClientRect().bottom <= innerHeight };
      d.querySelector('button').click();
      return res;
    })()`);
    if (!r.open || r.rows !== r.want || r.minH < 44 || !r.fits) sheetBad.push(JSON.stringify(r));
    // Área dos controles: ≥ 44×44 px, e um toque num ponto dela fora dos botões também abre o painel.
    const zp = await evaluate(`(() => {
      const z = document.querySelector('.pedal[data-uid="${uid}"] .knob-zone'), r = z.getBoundingClientRect();
      for (let y = r.top + 2; y < r.bottom; y += 3) for (let x = r.left + 2; x < r.right; x += 3)
        if (document.elementFromPoint(x, y) === z) return { x, y, w: Math.round(r.width), h: Math.round(r.height) };
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    let zoneOpen = false;
    if (zp.x !== undefined) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: zp.x, y: zp.y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(250);
      zoneOpen = await evaluate(`(() => { const d = document.querySelector('.knob-sheet'); const o = !!d?.open; if (o) d.querySelector('button').click(); return o; })()`);
    }
    if (zp.w < 44 || zp.h < 44 || !zoneOpen) sheetBad.push(JSON.stringify({ name: r.name, zone: zp, zoneOpen }));
  }
  check(uids.length >= 19 && sheetBad.length === 0,
    `painel de toque abre em todos os ${uids.length} pedais (pelo botão e pela área dos controles, ≥ 44 px)${sheetBad.length ? ': ' + sheetBad.join(' ') : ''}`);

  // Toque: todo controle HTML visível (topo, presets, cenas, mapa, ⠿ ✕ NAM TAP…) com pelo menos 44×44 px.
  const small = await evaluate(`(() => {
    const out = [];
    for (const e of document.querySelectorAll('button, select, input:not([type=file])')) {
      if (e.closest('dialog:not([open]), #stage') ) continue;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.width < 44 || r.height < 44) out.push((e.id || e.className || e.textContent).toString().slice(0, 24) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return { total: document.querySelectorAll('button, select, input').length, small: [...new Set(out)] };
  })()`);
  // Item 1 da auditoria, nos desenhos: footswitches (inclusive o ON do amp) e as chaves MODE/REF do afinador.
  const svgSmall = await evaluate(`(() => {
    const out = [], els = [...document.querySelectorAll('#board .footswitch')];
    for (const p of document.querySelectorAll('#board .pedal')) if (p.querySelector('.tuner-display')) els.push(...p.querySelectorAll('.knob'));
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.push((e.getAttribute('aria-label') || '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return { n: els.length, out };
  })()`);
  check(svgSmall.out.length === 0, `toque: footswitches e chaves do afinador com ≥ 44 px (${svgSmall.out.length ? svgSmall.out.join(', ') : svgSmall.n + ' medidos'})`);
  check(small.small.length === 0, `toque: todos os controles com ≥ 44 px (${small.small.length ? small.small.join(', ') : small.total + ' controles medidos'})`);

  // Mouse (tela de PC): ⠿ ✕ NAM IR TAP com 44×44 px; com a cadeia longa e os pedais pequenos, nunca menos de 32.
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const mouseSmall = await evaluate(`[...document.querySelectorAll('#board .tools button')].map(b => b.getBoundingClientRect())
    .filter(r => { const t = +document.getElementById('board').style.zoom >= .6 ? 43.5 : 31.5; return r.width < t || r.height < t; }).map(r => Math.round(r.width) + 'x' + Math.round(r.height))`);
  check(!(await evaluate(`matchMedia('(pointer: coarse)').matches`)) && mouseSmall.length === 0,
    `mouse: botões dos pedais com ≥ 44 px (≥ 32 com pedais abaixo de 60 %) (${mouseSmall.length ? mouseSmall.join(', ') : 'todos'})`);

  // Fonte própria (Archivo) carregada do app e usada no título e nos rótulos dos botões.
  const font = await evaluate(`document.fonts.ready.then(() => {
    const faces = [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Archivo');
    return { loaded: faces.some(f => f.status === 'loaded'), check: document.fonts.check('700 16px Archivo'),
      h1: getComputedStyle(document.querySelector('h1')).fontFamily, klabel: getComputedStyle(document.querySelector('.klabel')).fontFamily };
  })`);
  check(font.loaded && font.check && font.h1.startsWith('Archivo') && font.klabel.startsWith('Archivo'), `fonte Archivo carregada e em uso (${JSON.stringify(font)})`);

  // Presets de fábrica: cada um soa e nenhum fica muito mais alto ou baixo que os outros. Render offline da
  // cadeia (só os pedais ligados) com a guitarra simulada a -12 dBFS.
  const fac = await evaluate(`(async () => {
    const { byType } = await import('./js/pedals/index.js');
    const { factoryPresets } = await import('./js/factory.js');
    const levels = {};
    for (const f of factoryPresets().filter(f => f.chain.every(b => !Object.keys(b.files).length))) {
      const ctx = new OfflineAudioContext(2, 48000, 48000);
      await ctx.audioWorklet.addModule('js/nam/nam-worklet.js');
      await ctx.audioWorklet.addModule('js/audio/dsp-worklet.js');
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 110;
      const env = ctx.createGain(); env.gain.setValueAtTime(0.25, 0); env.gain.setTargetAtTime(0.02, 0.05, 0.2);
      let prev = osc.connect(env);
      for (const b of f.chain.filter(b => b.on)) {
        const a = byType[b.type].create(ctx, { params: b.params }); a.setOn(true);
        prev.connect(a.input); prev = a.output;
      }
      prev.connect(ctx.destination); osc.start();
      const d = (await ctx.startRendering()).getChannelData(0);
      let sum = 0; for (const x of d) sum += x * x;
      levels[f.name] = Math.round(10 * Math.log10(sum / d.length + 1e-20));
    }
    return levels;
  })()`);
  const lv = Object.values(fac);
  check(lv.length === 7 && Math.min(...lv) > -30 && Math.max(...lv) - Math.min(...lv) <= 6,
    `presets de fábrica tocam com volume parecido (dB RMS: ${JSON.stringify(fac)})`);

  // Preset de fábrica com captura por endereço: escolher baixa a captura do GitHub, guarda e carrega no amp.
  const facCap = await evaluate(`(async () => {
    const p = __pedaleira, wait = ms => new Promise(r => setTimeout(r, ms));
    // (os presets foram zerados acima para simular outro aparelho: pega direto da lista de fábrica)
    const { factoryPresets } = await import('./js/factory.js');
    const preset = factoryPresets().find(x => /5150/.test(x.name));
    if (!preset) return { preset: false };
    p.state.presets.push(preset);
    await p.loadChain(preset.chain, preset.name);
    const amp = p.state.chain.find(b => b.type === 'amp');
    for (let i = 0; i < 100 && !(amp.files.nam && await p.getFile(amp.files.nam.key)); i++) await wait(100);
    const data = amp.files.nam ? await p.getFile(amp.files.nam.key) : null;
    const status = document.getElementById('status').textContent;
    return { preset: true, cab: amp.params.cab, stored: !!data?.architecture, status };
  })()`);
  check(facCap.preset && facCap.stored && facCap.cab === 2 && /carregad/.test(facCap.status),
    `preset de fábrica com captura baixa e carrega a captura (${JSON.stringify(facCap)})`);

  // Andamento global: duas teclas T a 500 ms dão 120 BPM; o Pulso espelha no botão e o Eco 8 em SYNC 1/4 fica em 500 ms.
  const tempo = await evaluate(`(async () => {
    const p = __pedaleira, wait = ms => new Promise(r => setTimeout(r, ms));
    const key = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    key(); await wait(500); key(); await wait(500); key();
    const bpm = p.state.bpm, shown = +document.getElementById('tempoBpm').textContent;
    const pulso = p.state.chain.find(b => b.type === 'pulso');
    const { bpmOf } = await import('./js/pedals/pulso.js');
    const { delaySeconds, SYNC } = await import('./js/pedals/eco-8.js');
    const eco = p.state.chain.find(b => b.type === 'eco-8');
    const sec = eco ? delaySeconds({ ...eco.params, sync: SYNC.indexOf('1/4') }, bpm) : null;
    return { bpm, shown, pulsoBpm: pulso ? bpmOf(pulso.params.bpm) : null, sec };
  })()`);
  check(tempo.bpm >= 112 && tempo.bpm <= 128 && tempo.shown === tempo.bpm && (tempo.pulsoBpm === null || tempo.pulsoBpm === tempo.bpm)
    && (tempo.sec === null || Math.abs(tempo.sec - 60 / tempo.bpm) < 1e-9),
    `andamento global: tecla T acerta o BPM, o Pulso espelha, o Eco 8 em SYNC segue (${JSON.stringify(tempo)})`);

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
