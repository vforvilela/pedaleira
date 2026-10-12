// Amplificador: circuito interno (dois estágios de pré, tone stack, power amp) ou uma captura NAM.
// BASS/MID/TREBLE agem também sobre a captura. Caixa 1x12 ou 4x12 (filtros), IR .wav ou nenhuma.
import { Bypass, NamSlot, biquad, cabFilters, chain, curve, dbToGain, namMakeupDb, smooth } from './common.js';

// Ordem mantida por compatibilidade com presets salvos (0 era a caixa interna, 1 o IR, 2 sem caixa).
const CABS = ['1x12', 'IR', 'OFF', '4x12'];

// Caixa 4x12 fechada: mais grave e mais corte no agudo que a 1x12.
const cab412 = ctx => [
  ['highpass', 70, 0.8, 0],
  ['peaking', 110, 1.0, 4],
  ['peaking', 500, 1.0, -4],
  ['peaking', 1800, 1.2, 3],
  ['lowpass', 4300, 0.7, 0],
  ['lowpass', 5200, 0.7, 0],
].map(([t, f, q, g]) => biquad(ctx, t, f, q, g));

// Válvula do pré: assimétrica (gera harmônicos pares) e sem deslocar o centro.
const bias = 0.25;
const tube = curve(x => Math.tanh(2.5 * x + bias) - Math.tanh(bias));
const power = curve(x => Math.tanh(1.3 * x) / Math.tanh(1.3));

export default {
  type: 'amp',
  name: 'Amp',
  inspiredBy: null,
  category: 'amp',
  look: { style: 'amp', body: '#1b1b1b', panel: '#c9a85a', ink: '#1b1b1b', led: '#ff5a36' },
  controls: [
    { id: 'gain', label: 'GAIN', default: 5 },
    { id: 'bass', label: 'BASS', default: 5 },
    { id: 'mid', label: 'MID', default: 5 },
    { id: 'treble', label: 'TREBLE', default: 6 },
    { id: 'volume', label: 'VOLUME', default: 5 },
    { id: 'cab', label: 'CAB', type: 'select', options: CABS, default: 0 },
  ],
  files: {
    nam: { label: 'Captura .nam', accept: '.nam' },
    ir: { label: 'IR de caixa .wav', accept: '.wav,audio/wav' },
  },

  create(ctx, env) {
    const bp = new Bypass(ctx);

    // Pré-amp interno: acoplamento → 1º estágio → corta grave entre estágios → 2º estágio.
    const pre = ctx.createGain();
    const couple = biquad(ctx, 'highpass', 70, 0.7);
    const stage1 = ctx.createWaveShaper();
    stage1.curve = tube;
    stage1.oversample = '4x';
    const tight = biquad(ctx, 'highpass', 160, 0.6);
    const smoothHi = biquad(ctx, 'lowpass', 9000, 0.6);
    const pre2 = ctx.createGain();
    const stage2 = ctx.createWaveShaper();
    stage2.curve = tube;
    stage2.oversample = '4x';
    const preOut = ctx.createGain();
    chain(pre, couple, stage1, tight, smoothHi, pre2, stage2, preOut);

    // Captura NAM.
    const namIn = ctx.createGain();
    const nam = new NamSlot(ctx, env.wasmBytes);
    const namOut = ctx.createGain();
    chain(namIn, nam.node, namOut);
    let namMakeup = 0, usingNam = false;

    // Tone stack (depois do pré, como num Marshall) e power amp.
    const bass = biquad(ctx, 'lowshelf', 120, 0.7, 0);
    const mid = biquad(ctx, 'peaking', 650, 0.8, 0);
    const treble = biquad(ctx, 'highshelf', 2800, 0.7, 0);
    const powerIn = ctx.createGain();
    const powerAmp = ctx.createWaveShaper();
    powerAmp.curve = power;
    powerAmp.oversample = '2x';
    chain(bass, mid, treble, powerIn, powerAmp);
    preOut.connect(bass);
    namOut.connect(bass);

    const cabIn = ctx.createGain();
    const cab112 = cabFilters(ctx);
    const cab412f = cab412(ctx);
    const conv = ctx.createConvolver();
    const volume = ctx.createGain();
    chain(...cab112, volume);
    chain(...cab412f, volume);
    powerAmp.connect(cabIn);
    volume.connect(bp.wet);
    bp.input.connect(pre);

    const p = { ...env.params };
    let cabRoute = '';
    const route = () => {
      let want = CABS[p.cab] || '1x12';
      if (want === 'IR' && !conv.buffer) want = '1x12';
      if (want === cabRoute) return;
      cabRoute = want;
      cabIn.disconnect(); conv.disconnect();
      if (want === '1x12') cabIn.connect(cab112[0]);
      else if (want === '4x12') cabIn.connect(cab412f[0]);
      else if (want === 'IR') { cabIn.connect(conv); conv.connect(volume); }
      else cabIn.connect(volume);
    };
    const apply = () => {
      const g = p.gain / 10;
      // GAIN reparte o ganho entre os dois estágios: limpo embaixo, saturado em cima.
      smooth(ctx, pre.gain, dbToGain(-4 + g * 22));
      smooth(ctx, pre2.gain, dbToGain(-10 + g * 26));
      smooth(ctx, preOut.gain, dbToGain(-4 - g * 4));
      smooth(ctx, namIn.gain, dbToGain((p.gain - 5) * 4));
      smooth(ctx, namOut.gain, dbToGain(namMakeup));
      smooth(ctx, bass.gain, (p.bass - 5) * 2.4);
      smooth(ctx, mid.gain, (p.mid - 5) * 2.4);
      smooth(ctx, treble.gain, (p.treble - 5) * 2.4);
      smooth(ctx, powerIn.gain, usingNam ? 0.5 : 0.9);
      smooth(ctx, volume.gain, dbToGain(-28 + p.volume * 3.2));
      route();
    };
    apply();

    const useNam = on => {
      if (on === usingNam) return;
      usingNam = on;
      bp.input.disconnect();
      bp.input.connect(bp.dry);
      bp.input.connect(on ? namIn : pre);
      apply();
    };

    return {
      input: bp.input,
      output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      async loadFile(kind, data) {
        if (kind === 'nam') {
          const info = await nam.load(data);
          namMakeup = namMakeupDb(data);
          apply();
          useNam(true);
          return info;
        }
        // IR: ArrayBuffer de um .wav. Usa só o primeiro canal se vier estéreo, para não espalhar.
        const audio = await ctx.decodeAudioData(data.slice(0));
        const mono = ctx.createBuffer(1, Math.min(audio.length, ctx.sampleRate), ctx.sampleRate);
        mono.copyToChannel(audio.getChannelData(0).subarray(0, mono.length), 0);
        conv.buffer = mono;
        cabRoute = '';
        apply();
        return { engine: 'IR' };
      },
      clearFile(kind) {
        if (kind === 'nam') { nam.clear(); useNam(false); }
        else { conv.buffer = null; cabRoute = ''; apply(); }
      },
      dispose() { bp.output.disconnect(); nam.node.disconnect(); },
    };
  },
};
