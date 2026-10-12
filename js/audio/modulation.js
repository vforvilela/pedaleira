// Oitava abaixo (divisor analógico), flanger e seguidor de envelope, amostra a amostra.
// Rodam no AudioWorklet (dsp-worklet.js) e nos testes de unidade.

const onePole = (hz, sr) => 1 - Math.exp((-2 * Math.PI * hz) / sr);

// Como o Boss OC-2: acha o período da nota grave por cruzamentos de zero (com histerese) e gera ondas
// quadradas com metade e um quarto da frequência, no volume da nota. Monofônico, como o original.
export class OctaveDown {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.lpA = onePole(320, sampleRate); // deixa só a fundamental para o detector
    this.lp = 0; this.lp2 = 0;
    this.env = 0;
    this.envAtt = onePole(400, sampleRate);
    this.envRel = onePole(12, sampleRate);
    this.high = false;
    this.ff1 = 1; this.ff2 = 1;
    this.smoothA = onePole(1800, sampleRate);
    this.o1 = 0; this.o2 = 0;
    this.set({ oct1: 0.7, oct2: 0, direct: 0.7 });
  }

  set({ oct1, oct2, direct }) { Object.assign(this, { g1: oct1, g2: oct2, gd: direct }); }

  process(inp, out) {
    for (let i = 0; i < inp.length; i++) {
      const x = inp[i];
      this.lp += this.lpA * (x - this.lp);
      this.lp2 += this.lpA * (this.lp - this.lp2);
      const a = Math.abs(x);
      this.env += (a > this.env ? this.envAtt : this.envRel) * (a - this.env);
      // Histerese proporcional ao volume: ruído e harmônicos não viram cruzamentos falsos.
      const h = this.env * 0.15;
      if (!this.high && this.lp2 > h) {
        this.high = true;
        this.ff1 = -this.ff1;
        if (this.ff1 > 0) this.ff2 = -this.ff2;
      } else if (this.high && this.lp2 < -h) this.high = false;
      this.o1 += this.smoothA * (this.ff1 * this.env - this.o1);
      this.o2 += this.smoothA * (this.ff2 * this.env - this.o2);
      out[i] = this.gd * x + this.g1 * this.o1 + this.g2 * this.o2;
    }
  }
}

// Flanger como o Boss BF-2: atraso curto que varre (MANUAL + DEPTH·LFO) com realimentação (RES).
export class Flanger {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.buf = new Float32Array(2048);
    this.w = 0;
    this.phase = 0;
    this.set({ manual: 0.5, depth: 0.5, rate: 0.5, res: 0.5 });
  }

  // manual, depth, res: 0..1; rate em Hz.
  set({ manual, depth, rate, res }) {
    this.center = (0.4 + manual * 4) / 1000 * this.sr; // 0,4 a 4,4 ms
    this.depth = depth;
    this.inc = rate / this.sr;
    this.fb = res * 0.85;
  }

  process(inp, out) {
    const { buf } = this, mask = buf.length - 1;
    for (let i = 0; i < inp.length; i++) {
      this.phase += this.inc;
      if (this.phase >= 1) this.phase -= 1;
      const tri = this.phase < 0.5 ? this.phase * 4 - 1 : 3 - this.phase * 4;
      const d = Math.max(1, this.center * (1 + 0.9 * this.depth * tri));
      const r = this.w - d, i0 = Math.floor(r), f = r - i0;
      const y = buf[i0 & mask] * (1 - f) + buf[(i0 + 1) & mask] * f;
      buf[this.w & mask] = inp[i] + this.fb * y;
      this.w++;
      out[i] = 0.6 * (inp[i] + y);
    }
  }
}

// Seguidor de envelope para o auto-wah: sai 0..1 conforme a força da palhetada.
export class Envelope {
  constructor(sampleRate) {
    this.att = onePole(150, sampleRate);
    this.rel = onePole(6, sampleRate);
    this.env = 0;
    this.sens = 1;
  }

  process(inp, out) {
    for (let i = 0; i < inp.length; i++) {
      const a = Math.min(1, Math.abs(inp[i]) * this.sens);
      this.env += (a > this.env ? this.att : this.rel) * (a - this.env);
      out[i] = this.env;
    }
  }
}

// Mudança de altura por duas cabeças de leitura que andam na velocidade ratio (2 = uma oitava acima)
// e se revezam com crossfade. Cada cabeça, ao recomeçar, procura o ponto em que a onda casa com a da
// outra (WSOLA): sem isso a troca desloca a fase e a nota sai desafinada e trêmula.
export class PitchShifter {
  // Janela de 30 ms: mais curta atrasa menos, mais longa treme menos nas notas graves.
  constructor(sampleRate, windowMs = 30) {
    this.buf = new Float32Array(16384);
    this.w = 0;
    this.win = Math.round((windowMs / 1000) * sampleRate);
    this.search = Math.round(0.007 * sampleRate); // procura ±7 ms (cobre o período de um Mi grave)
    this.cmp = Math.round(0.003 * sampleRate);
    this.heads = [{ pos: 0, age: 0 }, { pos: 0, age: Math.round(this.win / 2) }];
    this.ratio = 1;
    this.target = 1;
    this.glide = 1 - Math.exp(-1 / (0.01 * sampleRate)); // 10 ms para o pedal não "degrauzar"
    this.dry = 0;
    this.wet = 1;
    this.started = false;
  }

  set({ ratio, dry = 0, wet = 1 }) { this.target = ratio; this.dry = dry; this.wet = wet; }

  read(r) {
    const { buf } = this, mask = buf.length - 1;
    const i0 = Math.floor(r), f = r - i0;
    return buf[i0 & mask] * (1 - f) + buf[(i0 + 1) & mask] * f;
  }

  // Atraso inicial: subindo, a cabeça alcança a escrita; descendo, fica para trás. As duas cabem no buffer.
  startDelay() {
    const travel = (this.ratio - 1) * this.win;
    return Math.max(0, travel) + this.search + this.cmp * Math.max(1, this.ratio) + 4;
  }

  restart(h, other) {
    const nominal = this.w - this.startDelay();
    if (!this.started) { h.pos = nominal; return; }
    // Casa o trecho que a outra cabeça vai tocar com os candidatos em torno da posição nominal.
    const n = this.cmp, step = this.ratio;
    let best = 0, bestScore = -Infinity;
    for (let k = -this.search; k <= 0; k += 2) {
      let score = 0;
      for (let j = 0; j < n; j += 2) score += this.read(other.pos + j * step) * this.read(nominal + k + j * step);
      if (score > bestScore) { bestScore = score; best = k; }
    }
    h.pos = nominal + best;
  }

  process(inp, out) {
    const [A, B] = this.heads, win = this.win;
    for (let i = 0; i < inp.length; i++) {
      this.buf[this.w & (this.buf.length - 1)] = inp[i];
      this.w++;
      this.ratio += this.glide * (this.target - this.ratio);
      if (!this.started) { this.restart(A, B); this.restart(B, A); this.started = true; }
      let y = 0;
      for (const h of this.heads) {
        if (h.age >= win) { h.age = 0; this.restart(h, h === A ? B : A); }
        const g = Math.sin((Math.PI * h.age) / win);
        y += this.read(h.pos) * g * g;
        h.pos += this.ratio;
        h.age++;
      }
      out[i] = this.dry * inp[i] + this.wet * y;
    }
  }
}
