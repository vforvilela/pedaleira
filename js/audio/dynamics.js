// Gate, compressor e limitador amostra a amostra, sem atraso (sem lookahead).
// Rodam no AudioWorklet (dsp-worklet.js) e também no Node, nos testes de unidade.

const dbToLin = db => Math.pow(10, db / 20);
const LOG10_20 = 20 / Math.LN10;
const linToDb = x => (x > 1e-9 ? Math.log(x) * LOG10_20 : -180);
// Coeficiente de um filtro de um polo com constante de tempo t (s).
const coef = (t, sr) => (t > 0 ? Math.exp(-1 / (t * sr)) : 0);

// Noise gate: abre na hora quando o sinal passa do limiar e fecha devagar (DECAY) quando
// fica 6 dB abaixo dele por HOLD. A histerese evita o "metralhar" no fim da nota.
export class Gate {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.env = 0;
    this.gain = 0;
    this.open = false;
    this.holdLeft = 0;
    this.hold = Math.round(0.02 * sampleRate);
    this.envRel = coef(0.01, sampleRate);
    this.att = coef(0.0005, sampleRate);
    this.set(-60, 0.1);
  }

  set(thresholdDb, decaySec) {
    this.openAt = dbToLin(thresholdDb);
    this.closeAt = dbToLin(thresholdDb - 6);
    this.dec = coef(decaySec / 6.9, this.sr); // cai 60 dB no tempo DECAY
  }

  process(inp, out) {
    let { env, gain, open, holdLeft } = this;
    for (let i = 0; i < inp.length; i++) {
      const a = Math.abs(inp[i]);
      env = a > env ? a : env * this.envRel;
      if (env > this.openAt) { open = true; holdLeft = this.hold; }
      else if (open && env < this.closeAt && --holdLeft <= 0) open = false;
      gain = open ? 1 - (1 - gain) * this.att : gain * this.dec;
      out[i] = inp[i] * gain;
    }
    Object.assign(this, { env, gain, open, holdLeft });
  }
}

// Compressor de pedal: detector de pico com ataque e soltura, joelho suave de 6 dB.
export class Compressor {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.grDb = 0; // redução de ganho atual (dB, ≤ 0)
    this.knee = 6;
    this.set({ threshold: -30, ratio: 4, attack: 0.01, release: 0.2, makeup: 0 });
  }

  set({ threshold, ratio, attack, release, makeup }) {
    this.threshold = threshold;
    this.slope = 1 / ratio - 1;
    this.att = coef(attack, this.sr);
    this.rel = coef(release, this.sr);
    this.makeup = dbToLin(makeup);
  }

  // Redução de ganho desejada (dB) para um nível em dB.
  curve(db) {
    const over = db - this.threshold, k = this.knee / 2;
    if (over <= -k) return 0;
    if (over >= k) return this.slope * over;
    return (this.slope * (over + k) ** 2) / (2 * this.knee);
  }

  process(inp, out) {
    let gr = this.grDb;
    for (let i = 0; i < inp.length; i++) {
      const target = this.curve(linToDb(Math.abs(inp[i])));
      // Mais redução = ataque; menos = soltura.
      gr = target < gr ? target + (gr - target) * this.att : target + (gr - target) * this.rel;
      out[i] = inp[i] * dbToLin(gr) * this.makeup;
    }
    this.grDb = gr;
  }
}

// Limitador de segurança antes do fone: ataque instantâneo, nunca passa do teto.
// O DynamicsCompressorNode do navegador atrasa todo o som em ~6 ms para olhar à frente; este não.
export class Limiter {
  constructor(sampleRate, ceilingDb = -1) {
    this.ceiling = dbToLin(ceilingDb);
    this.gain = 1;
    this.rel = coef(0.1, sampleRate);
  }

  process(inp, out) {
    let g = this.gain;
    const c = this.ceiling;
    for (let i = 0; i < inp.length; i++) {
      const a = Math.abs(inp[i]);
      const target = a > c ? c / a : 1;
      g = target < g ? target : target + (g - target) * this.rel;
      out[i] = inp[i] * g;
    }
    this.gain = g;
  }
}
