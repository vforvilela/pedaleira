// Overdrive amarelo inspirado no Boss SD-1.
// Circuito: o drive só satura acima de ~720 Hz (o grave passa limpo), com clipagem assimétrica
// (dois diodos de um lado, um do outro), seguido de tom e volume.
import { Bypass, NamSlot, biquad, curve, dbToGain, namMakeupDb, smooth } from './common.js';
import { t } from '../i18n.js';

// Lado positivo satura no dobro do negativo, como 2 diodos contra 1.
const asymClip = curve(x => (x >= 0 ? Math.tanh(4 * x) / Math.tanh(4) : 0.5 * Math.tanh(8 * x) / Math.tanh(8)));

export default {
  type: 'sol-drive',
  name: 'Sol Drive',
  inspiredBy: 'Boss SD-1',
  category: 'drive',
  look: {
    style: 'compact', body: '#f2c12e', ink: '#2a2310', strip: '#151515', stripInk: '#f2c12e',
    subtitle: 'Super Overdrive', led: '#ff3b30',
  },
  controls: [
    { id: 'level', label: 'LEVEL', default: 5 },
    { id: 'tone', label: 'TONE', default: 5 },
    { id: 'drive', label: 'DRIVE', default: 5 },
  ],
  files: { nam: { get label() { return t('pedals.fileNam'); }, accept: '.nam' } },

  create(ctx, env) {
    const bp = new Bypass(ctx);

    // Circuito Web Audio.
    const clean = ctx.createGain();
    const hp = biquad(ctx, 'highpass', 720, 0.6);
    const drive = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = asymClip;
    shaper.oversample = '4x';
    const mix = ctx.createGain();
    bp.input.connect(clean).connect(mix);
    bp.input.connect(hp).connect(drive).connect(shaper).connect(mix);

    // Caminho da captura NAM (fica desconectado até carregar uma).
    const namIn = ctx.createGain();
    const nam = new NamSlot(ctx, env.wasmBytes);
    const namOut = ctx.createGain();
    namIn.connect(nam.node).connect(namOut);
    let namMakeup = 0;

    const dcBlock = biquad(ctx, 'highpass', 25, 0.7);
    // TONE ativo como no SD-1: abaixo do meio corta agudo, acima realça.
    const tone = biquad(ctx, 'highshelf', 1800, 0.7, 0);
    const hiCut = biquad(ctx, 'lowpass', 6500, 0.7);
    const level = ctx.createGain();
    dcBlock.connect(tone).connect(hiCut).connect(level).connect(bp.wet);
    mix.connect(dcBlock);

    const p = { ...env.params };
    const apply = () => {
      smooth(ctx, drive.gain, dbToGain(6 + p.drive * 4));
      smooth(ctx, namIn.gain, dbToGain(-12 + p.drive * 2.4));
      smooth(ctx, tone.gain, -15 + p.tone * 2.3);
      smooth(ctx, level.gain, dbToGain(-34 + p.level * 4));
      smooth(ctx, namOut.gain, dbToGain(namMakeup + 14));
    };

    apply();
    let usingNam = false;
    const useNam = on => {
      if (on === usingNam) return;
      usingNam = on;
      if (on) {
        mix.disconnect();
        bp.input.disconnect(clean); bp.input.disconnect(hp);
        bp.input.connect(namIn);
        namOut.connect(dcBlock);
      } else {
        bp.input.disconnect(namIn);
        namOut.disconnect();
        bp.input.connect(clean); bp.input.connect(hp);
        mix.connect(dcBlock);
      }
    };

    return {
      input: bp.input,
      output: bp.output,
      set(id, v) { p[id] = v; apply(); },
      setOn: on => bp.set(on),
      async loadFile(kind, data) {
        const info = await nam.load(data);
        if (info?.superseded) return info;
        namMakeup = namMakeupDb(data);
        apply();
        useNam(true);
        return info;
      },
      clearFile() {
        nam.clear();
        useNam(false);
      },
      dispose() { bp.output.disconnect(); nam.node.disconnect(); },
    };
  },
};
