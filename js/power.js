// Ligar e desligar o áudio, escolher a entrada, medidor, volume, latência e afinadores.
import { setStageTuner } from './stage.js';
import { detectPitch, noteOf } from './audio/pitch.js';
import { pickChannel } from './audio/channel.js';
import { t, fmtNum } from './i18n.js';
import { $, applyStoredFiles, changeListeners, createAudio, engine, live, prepareSetlist, reconnect, save, setEq, setTrim, state, status } from './core.js';
import { backgroundAudio, hasAudioSession, keepAwake, saveFile } from './platform.js';
import { preloadFiles } from './store.js';

export async function listDevices(selectedId) {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  const sel = $('device');
  sel.replaceChildren(...devs.map((d, i) => new Option(d.label || t('power.inputN', { i: i + 1 }), d.deviceId)));
  // Na primeira vez, tenta achar o Tank Mini pelo nome.
  const tank = devs.find(d => /tank/i.test(d.label));
  sel.value = selectedId || (tank && tank.deviceId) || sel.value;
}

let meterRaf = 0, latencyTimer = 0, tunerTimer = 0, channelTimer = 0;

// A entrada parece ser o microfone do próprio aparelho (não uma interface de guitarra)?
export function isBuiltInMic(track) {
  const label = track.label || '';
  if (/\b(mic|micro|microphone|microfone|micrófono|built-?in|internal|interno|integrado|array|webcam|camera|default|padrão|predeterminado)\b/i.test(label)) return true;
  // Interfaces de guitarra têm 2 canais ou um nome de produto; "Entrada 1" sem nome é o celular.
  return !label.trim();
}

// Lê os afinadores ligados ~12 vezes por segundo; desligados, o visor apaga.
// Afinador geral (tecla U, alvo MIDI, toque longo no palco): cala a saída e lê a entrada, em qualquer preset.
let globalTuner = false;
const tunerBuf = new Float32Array(4096);
export function toggleGlobalTuner(on = !globalTuner) {
  if (!engine.running) { status(t('power.tunerNeedsSound')); return; }
  globalTuner = on;
  engine.setTunerMute(on);
  document.body.classList.toggle('global-tuner', on);
  status(t(on ? 'power.tunerOn' : 'power.tunerOff'), false, on);
  runTuners();
}
export const globalTunerOn = () => globalTuner;

export function runTuners() {
  if (globalTuner && engine.running) {
    engine.tunerAnalyser.getFloatTimeDomainData(tunerBuf);
    const hz = detectPitch(tunerBuf, engine.ctx.sampleRate);
    setStageTuner(hz ? noteOf(hz, 440) : null, true);
    return;
  }
  let tuner = null, tunerOn = false;
  for (const b of state.chain) {
    const l = live.get(b.uid);
    if (l?.def.category !== 'tuner' || !l.view) continue;
    const active = b.on && !!l.audio;
    const hz = active ? l.audio.read() : null;
    const r = hz ? noteOf(hz, l.audio.ref()) : null;
    l.view.setDisplay(r, active);
    if (active) tuner = r ?? null, tunerOn = true;
  }
  setStageTuner(tuner, tunerOn);
}
export function runMeter() {
  const buf = new Float32Array(engine.analyser.fftSize);
  const meter = $('meter'), bar = meter.firstElementChild;
  let shown = -1;
  const tick = () => {
    if (!engine.running) return;
    const peak = engine.peak(buf);
    const db = 20 * Math.log10(peak || 1e-6);
    // clip-path em vez de width: não recalcula o layout a cada quadro, e os LEDs verde, âmbar e vermelho
    // ficam no lugar (com scaleX a faixa de cor encolheria junto).
    // Em meio ponto percentual (mais fino que um LED) e só quando muda: em silêncio o medidor não redesenha a cada quadro.
    const pct = Math.round(200 * Math.max(0, Math.min(1, (db + 60) / 60))) / 2;
    if (pct !== shown) { shown = pct; bar.style.clipPath = `inset(0 ${100 - pct}% 0 0)`; }
    meter.classList.toggle('clip', peak > 0.98);
    meterRaf = requestAnimationFrame(tick);
  };
  tick();
}

export async function start() {
  status(t('power.starting'));
  const track = await engine.start($('device').value || state.deviceId, state.bufferMs);
  state.deviceId = track.getSettings().deviceId || state.deviceId;
  await listDevices(state.deviceId);
  if (!engine.wasmBytes) status(t('power.noWasm'), true);
  for (const b of state.chain) createAudio(b);
  reconnect();
  engine.setMaster(state.master);
  engine.setTrim(state.trim);
  engine.setEq(state.eq);
  engine.setInputGain(state.inputGain);
  setupChannel();
  watchAudio(track);
  await Promise.all(state.chain.map(applyStoredFiles));
  // Capturas e IRs dos outros presets vão para a memória agora, para a troca de preset não esperar o disco.
  const used = [...state.presets.flatMap(p => p.chain), ...Object.values(state.drafts).flat()]
    .flatMap(b => Object.values(b.files).map(f => f.key));
  preloadFiles(used).catch(() => {});
  // E o que ainda não está no aparelho (presets de fábrica com captura, links recebidos) baixa agora.
  setTimeout(() => prepareSetlist().catch(() => {}), 1500);
  runMeter();
  tunerTimer = setInterval(runTuners, 80);
  let warned = false;
  const showLat = () => {
    const ms = engine.latencyMs();
    // Um veredito ao lado do número: quem nunca mediu latência não sabe se 23 ms é bom.
    const verdict = ms > 80 ? t('power.latHigh') : ms <= 25 ? t('power.latGood') : '';
    const buf = engine.session?.bufferSeconds ? ` · ${t('power.bufferMs', { ms: fmtNum(engine.session.bufferSeconds * 1000, 1) })}` : '';
    $('latency').textContent = t('power.latencyMs', { ms: fmtNum(ms, 1) }) + (verdict ? ` · ${verdict}` : '') + buf;
    $('latency').parentElement.classList.toggle('high', ms > 80);
    // Fone ou caixa Bluetooth somam 150 ms ou mais: dá para ouvir, não para tocar.
    if (ms > 80 && !warned) {
      warned = true;
      status(t('power.latencyHigh', { ms: fmtNum(Math.round(ms)) }), true);
    }
  };
  showLat();
  latencyTimer = setInterval(showLat, 1000);
  if (!$('status').classList.contains('err')) {
    // Microfone do aparelho (uma entrada só, ou nome de microfone): o perigo é o som voltar pela caixa e
    // microfonar; o aviso de fone fica até a pessoa trocar para uma interface. Com interface, a primeira vez
    // avisa do engano mais comum: o monitor direto dobrando o som limpo.
    const mic = isBuiltInMic(track);
    // Primeira vez pelo microfone do aparelho: o Volume desce para −20 dB, para não apitar antes de pôr o fone.
    let lowered = '';
    if (mic && !state.micGuard) {
      state.micGuard = true;
      if (state.master > -20) { state.master = -20; engine.setMaster(state.master); $('master').value = state.master; showMaster(); lowered = ` ${t('power.micLowered')}`; }
      save();
    }
    const key = mic ? 'power.playingMic' : state.monitorHintDone ? 'power.playing' : 'power.playingFirst';
    status(t(key, { device: track.label }) + lowered, false, mic);
    if (!mic && !state.monitorHintDone) { state.monitorHintDone = true; save(); }
  }
  $('measure').hidden = false;
  $('record').hidden = false;
  $('power').textContent = t('power.turnOff');
  $('power').setAttribute('aria-pressed', 'true');
  save();
}

export async function stop() {
  if (globalTuner) { globalTuner = false; document.body.classList.remove('global-tuner'); }
  await stopRecording();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  keepAwake(false);
  backgroundAudio(false);
  cancelAnimationFrame(meterRaf);
  clearInterval(latencyTimer);
  clearInterval(tunerTimer);
  clearInterval(channelTimer);
  await engine.stop();
  for (const l of live.values()) { l.audio = null; l.view?.setState(''); }
  runTuners();
  $('meter').firstElementChild.style.clipPath = '';
  $('latency').textContent = '—';
  status(t('power.stopped'));
  $('measure').hidden = true;
  $('record').hidden = true;
  $('power').textContent = t('power.turnOn');
  $('power').setAttribute('aria-pressed', 'false');
}

$('power').onclick = async () => {
  $('power').disabled = true;
  try {
    engine.running ? await stop() : await start();
  } catch (e) {
    await stop();
    const msg = e.name === 'NotAllowedError' ? t('power.errNoPermission')
      : e.name === 'NotFoundError' ? t('power.errNoInput')
      : e.name === 'NotReadableError' || e.name === 'AbortError' ? t('power.errBusy')
      : `${e.name}: ${e.message}`;
    status(t('power.error', { msg }), true);
  } finally {
    $('power').disabled = false;
  }
};

// Tamanho do buffer: só onde dá para pedir ao sistema (iPhone como app). Trocar religa o som.
if (hasAudioSession) {
  $('buffer').hidden = $('bufferRow').hidden = false;
  $('buffer').value = String(state.bufferMs);
  $('buffer').onchange = async () => {
    state.bufferMs = +$('buffer').value;
    save();
    if (!engine.running) return;
    await stop();
    $('power').click();
  };
}

$('device').onchange = async () => {
  state.deviceId = $('device').value;
  save();
  if (!engine.running) return;
  await stop();
  $('power').click();
};

// ---------- Canal da interface (2 entradas: guitarra num canal só) ----------

function setupChannel() {
  clearInterval(channelTimer);
  $('channel').hidden = engine.channels === 1;
  $('channel').value = state.inputChannel;
  if (engine.channels === 1) return;
  if (state.inputChannel !== 'auto') { engine.useChannel(+state.inputChannel); return; }
  // Automático: até a primeira palhetada, a mistura dos dois; depois, o canal onde ela apareceu.
  engine.useChannel(null);
  const buf = new Float32Array(1024), max = [0, 0];
  channelTimer = setInterval(() => {
    engine.chAnalyser.forEach((a, i) => { max[i] = Math.max(max[i], engine.peak(buf, a)); });
    const ch = pickChannel(max[0], max[1]);
    if (ch === null) return;
    clearInterval(channelTimer);
    engine.useChannel(ch);
    $('channel').options[0].textContent = t('power.channelAutoPicked', { ch: ch + 1 });
    status(t('power.guitarOnChannel', { ch: ch + 1 }));
  }, 50);
}

$('channel').onchange = () => {
  state.inputChannel = $('channel').value;
  $('channel').options[0].textContent = t('power.channelAuto');
  save();
  if (engine.running) setupChannel();
};

// ---------- Gravar o que sai ----------

let finishRec = null, recTimer = 0;
// Números com vírgula decimal em pt/es; inteiros ficam sem casas, como antes.
const fmtMs = ms => fmtNum(ms, Number.isInteger(ms) ? 0 : 1);
const fmtDb = db => fmtNum(db, Number.isInteger(db) ? 0 : 1);
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function stopRecording() {
  if (!finishRec) return;
  const finish = finishRec;
  finishRec = null;
  clearInterval(recTimer);
  $('record').textContent = t('power.recordAudio');
  $('record').setAttribute('aria-pressed', 'false');
  const blob = await finish();
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const name = `tonesmith-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`;
  await saveFile(blob, name);
  status(t('power.recordingSaved', { name }));
}

$('record').onclick = async () => {
  if (finishRec) return stopRecording();
  if (!engine.running) return;
  try {
    finishRec = engine.record();
  } catch (e) {
    status(t('power.recordUnsupported', { msg: e.message }), true);
    return;
  }
  const t0 = Date.now();
  $('record').setAttribute('aria-pressed', 'true');
  const tick = () => { $('record').textContent = t('power.recordingStop', { time: mmss((Date.now() - t0) / 1000) }); };
  tick();
  recTimer = setInterval(tick, 500);
};

// Medir a latência real: o usuário liga um cabo da saída na entrada; a pedaleira fica muda por ~3 s.
$('measure').onclick = async () => {
  if (!engine.running) return;
  if ($('measure').dataset.ready !== '1') {
    $('measure').dataset.ready = '1';
    $('measure').textContent = t('power.measureStart');
    status(t('power.measureHowTo'));
    return;
  }
  $('measure').dataset.ready = '';
  $('measure').textContent = t('power.measuring');
  $('measure').disabled = true;
  try {
    const r = await engine.measureRoundTrip();
    if (r.ms === null) status(t('power.measureNoReturn'), true);
    else {
      state.measuredMs = Math.round(r.ms * 10) / 10;
      save();
      const verdict = state.measuredMs <= 12 ? t('power.measureGreat') : state.measuredMs <= 20 ? t('power.measureGood') : t('power.measureHigh');
      status(t('power.measureResult', { ms: fmtMs(state.measuredMs), hits: r.hits, n: r.clicks, verdict }), state.measuredMs > 20);
      showMeasured();
    }
  } catch (e) {
    status(t('power.measureFailed', { msg: e.message }), true);
  } finally {
    $('measure').textContent = t('power.measureLatency');
    $('measure').disabled = false;
  }
};
const showMeasured = () => {
  if (state.measuredMs) $('measure').title = t('power.measureLast', { ms: fmtMs(state.measuredMs) });
};
showMeasured();

$('inGain').value = state.inputGain;
const showInput = () => { $('inGainV').textContent = `${state.inputGain > 0 ? '+' : ''}${fmtDb(state.inputGain)} dB`; };
showInput();
$('inGain').oninput = () => {
  state.inputGain = +$('inGain').value;
  showInput();
  engine.setInputGain(state.inputGain);
  save();
};

// ---------- Para tocar ao vivo: tela acesa, áudio que volta sozinho, interface desconectada ----------

let wakeLock = null;
async function keepScreenOn() {
  if (!engine.running || document.visibilityState !== 'visible' || wakeLock) return;
  // WebView sem a API (app nativo): o plugin do sistema faz o mesmo.
  if (!navigator.wakeLock) { keepAwake(true); return; }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* sem permissão ou sem suporte: segue sem */ }
}

// O sistema pode pausar o áudio (ligação no celular, app em segundo plano, fone tirado no iPhone).
async function resumeAudio() {
  const ctx = engine.ctx;
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
  try { await ctx.resume(); } catch { /* precisa de um toque */ }
  if (ctx.state === 'running') status(t('power.audioBack'));
  else status(t('power.audioPaused'), true);
}

function watchAudio(track) {
  keepScreenOn();
  backgroundAudio(true, t('power.playing', { device: track.label }));
  engine.ctx.onstatechange = () => { if (engine.running) resumeAudio(); };
  track.addEventListener('ended', async () => {
    if (!engine.running) return;
    await stop();
    status(t('power.inputLost'), true);
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  resumeAudio();
  keepScreenOn();
});
document.addEventListener('pointerdown', resumeAudio, true);
navigator.mediaDevices?.addEventListener?.('devicechange', () => listDevices(state.deviceId).catch(() => {}));

$('master').value = state.master;
export const showMaster = () => { $('masterV').textContent = `${fmtDb(state.master)} dB`; };
showMaster();
// Nível do preset: o slider segue o estado (muda ao trocar de preset) e o estado segue o slider.
const showTrim = () => { $('trim').value = state.trim; $('trimV').textContent = `${state.trim > 0 ? '+' : ''}${fmtDb(state.trim)} dB`; };
showTrim();
changeListeners.push(showTrim);
$('trim').oninput = () => setTrim(+$('trim').value);
// EQ geral: igual, por faixa.
const EQ_IDS = { low: 'eqLow', mid: 'eqMid', high: 'eqHigh' };
const showEq = () => { for (const [band, id] of Object.entries(EQ_IDS)) { $(id).value = state.eq[band]; $(`${id}V`).textContent = `${state.eq[band] > 0 ? '+' : ''}${fmtDb(state.eq[band])}`; } };
showEq();
for (const [band, id] of Object.entries(EQ_IDS)) $(id).oninput = () => { setEq(band, +$(id).value); showEq(); };
$('master').oninput = () => {
  state.master = +$('master').value;
  showMaster();
  engine.setMaster(state.master);
  save();
};
