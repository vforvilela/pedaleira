// Ligar e desligar o áudio, escolher a entrada, medidor, volume, latência e afinadores.
import { setStageTuner } from './stage.js';
import { noteOf } from './audio/pitch.js';
import { $, applyStoredFiles, createAudio, engine, live, reconnect, save, state, status } from './core.js';

export async function listDevices(selectedId) {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  const sel = $('device');
  sel.replaceChildren(...devs.map((d, i) => new Option(d.label || `Entrada ${i + 1}`, d.deviceId)));
  // Na primeira vez, tenta achar o Tank Mini pelo nome.
  const tank = devs.find(d => /tank/i.test(d.label));
  sel.value = selectedId || (tank && tank.deviceId) || sel.value;
}

let meterRaf = 0, latencyTimer = 0, tunerTimer = 0;

// Lê os afinadores ligados ~12 vezes por segundo; desligados, o visor apaga.
export function runTuners() {
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
  const tick = () => {
    if (!engine.running) return;
    const peak = engine.peak(buf);
    const db = 20 * Math.log10(peak || 1e-6);
    bar.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    meter.classList.toggle('clip', peak > 0.98);
    meterRaf = requestAnimationFrame(tick);
  };
  tick();
}

export async function start() {
  status('Ligando…');
  const track = await engine.start($('device').value || state.deviceId);
  state.deviceId = track.getSettings().deviceId || state.deviceId;
  await listDevices(state.deviceId);
  if (!engine.wasmBytes) status('Motor WebAssembly indisponível: capturas NAM vão usar o motor JS, mais pesado.', true);
  for (const b of state.chain) createAudio(b);
  reconnect();
  engine.setMaster(state.master);
  engine.setInputGain(state.inputGain);
  watchAudio(track);
  await Promise.all(state.chain.map(applyStoredFiles));
  runMeter();
  tunerTimer = setInterval(runTuners, 80);
  let warned = false;
  const showLat = () => {
    const ms = engine.latencyMs();
    $('latency').textContent = `${ms.toFixed(1)} ms`;
    $('latency').parentElement.classList.toggle('high', ms > 80);
    // Fone ou caixa Bluetooth somam 150 ms ou mais: dá para ouvir, não para tocar.
    if (ms > 80 && !warned) {
      warned = true;
      status(`Latência alta (${Math.round(ms)} ms). Fone ou caixa Bluetooth atrasam demais para tocar: use fone com fio ou a saída da interface.`, true);
    }
  };
  showLat();
  latencyTimer = setInterval(showLat, 1000);
  if (!$('status').classList.contains('err')) status(`Tocando: ${track.label}`);
  $('power').textContent = 'Desligar';
  $('power').setAttribute('aria-pressed', 'true');
  save();
}

export async function stop() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  cancelAnimationFrame(meterRaf);
  clearInterval(latencyTimer);
  clearInterval(tunerTimer);
  await engine.stop();
  for (const l of live.values()) l.audio = null;
  runTuners();
  $('meter').firstElementChild.style.width = '0';
  $('latency').textContent = '—';
  status('Desligado.');
  $('power').textContent = 'Ligar';
  $('power').setAttribute('aria-pressed', 'false');
}

$('power').onclick = async () => {
  $('power').disabled = true;
  try {
    engine.running ? await stop() : await start();
  } catch (e) {
    await stop();
    const msg = e.name === 'NotAllowedError' ? 'O navegador não deu acesso à entrada de áudio.'
      : e.name === 'NotFoundError' ? 'Nenhuma entrada de áudio encontrada. Conecte a interface.'
      : `${e.name}: ${e.message}`;
    status(`Erro: ${msg}`, true);
  } finally {
    $('power').disabled = false;
  }
};

$('device').onchange = async () => {
  state.deviceId = $('device').value;
  save();
  if (!engine.running) return;
  await stop();
  $('power').click();
};

$('inGain').value = state.inputGain;
const showInput = () => { $('inGainV').textContent = `${state.inputGain > 0 ? '+' : ''}${state.inputGain} dB`; };
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
  if (!engine.running || document.visibilityState !== 'visible' || wakeLock || !navigator.wakeLock) return;
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
  if (ctx.state === 'running') status('Áudio de volta.');
  else status('O sistema pausou o áudio. Toque na tela para voltar.', true);
}

function watchAudio(track) {
  keepScreenOn();
  engine.ctx.onstatechange = () => { if (engine.running) resumeAudio(); };
  track.addEventListener('ended', async () => {
    if (!engine.running) return;
    await stop();
    status('A entrada de áudio sumiu (interface desconectada?). Conecte de novo e clique em Ligar.', true);
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
export const showMaster = () => { $('masterV').textContent = `${state.master} dB`; };
showMaster();
$('master').oninput = () => {
  state.master = +$('master').value;
  showMaster();
  engine.setMaster(state.master);
  save();
};
