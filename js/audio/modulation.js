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
