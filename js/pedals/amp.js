// Amplificador: circuito simples por padrão, ou uma captura NAM. Caixa interna (filtros) ou IR .wav.
import { Bypass, NamSlot, biquad, cabFilters, chain, curve, dbToGain, logMap, namMakeupDb, smooth } from './common.js';

const CABS = ['INT', 'IR', 'OFF'];

export default {
  type: 'amp',
  name: 'Amp',
  inspiredBy: null,
  category: 'amp',
  look: { style: 'amp', body: '#1b1b1b', panel: '#c9a85a', ink: '#1b1b1b', led: '#ff5a36' },
  controls: [
    { id: 'gain', label: 'GAIN', default: 5 },
    { id: 'tone', label: 'TONE', default: 6 },
    { id: 'volume', label: 'VOLUME', default: 5 },
    { id: 'cab', label: 'CAB', type: 'select', options: CABS, default: 0 },
  ],
  files: {
    nam: { label: 'Captura .nam', accept: '.nam' },
    ir: { label: 'IR de caixa .wav', accept: '.wav,audio/wav' },
  },

  create(ctx, env) {
    const bp = new Bypass(ctx);

    // Pré-amp interno: ganho → corta grave → satura.
    const pre = ctx.createGain();
    const tight = biquad(ctx, 'highpass', 90, 0.7);
    const shaper = ctx.createWaveShaper();
    shaper.curve = curve(x => Math.tanh(3 * x) / Math.tanh(3));
    shaper.oversample = '4x';
    const preOut = ctx.createGain();
    chain(pre, tight, shaper, preOut);

    // Captura NAM.
    const namIn = ctx.createGain();
    const nam = new NamSlot(ctx, env.wasmBytes);
    const namOut = ctx.createGain();
    chain(namIn, nam.node, namOut);
    let namMakeup = 0, usingNam = false;

    const tone = biquad(ctx, 'lowpass', 6000, 0.5);
    const cabIn = ctx.createGain();
    const cabInt = cabFilters(ctx);
    const conv = ctx.createConvolver();
    const volume = ctx.createGain();
    chain(cabIn, ...cabInt, volume);
    preOut.connect(tone);
    namOut.connect(tone);
    tone.connect(cabIn);
    volume.connect(bp.wet);
    bp.input.connect(pre);

    const p = { ...env.params };
    let cabRoute = '';
    const route = () => {
      const want = CABS[p.cab] === 'IR' && conv.buffer ? 'IR' : CABS[p.cab] === 'OFF' ? 'OFF' : 'INT';
      if (want === cabRoute) return;
      cabRoute = want;
      cabIn.disconnect(); conv.disconnect();
      if (want === 'INT') cabIn.connect(cabInt[0]);
      else if (want === 'IR') { cabIn.connect(conv); conv.connect(volume); }
      else cabIn.connect(volume);
    };
    const apply = () => {
      smooth(ctx, pre.gain, dbToGain(p.gain * 4));
      smooth(ctx, preOut.gain, dbToGain(-6 - p.gain * 1.2));
      smooth(ctx, namIn.gain, dbToGain((p.gain - 5) * 4));
      smooth(ctx, namOut.gain, dbToGain(namMakeup));
      smooth(ctx, tone.frequency, logMap(p.tone, 1200, 18000));
      smooth(ctx, volume.gain, dbToGain(-30 + p.volume * 5));
      route();
    };
    apply();

    const useNam = on => {
      if (on === usingNam) return;
      usingNam = on;
      bp.input.disconnect();
      bp.input.connect(bp.dry);
      bp.input.connect(on ? namIn : pre);
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
