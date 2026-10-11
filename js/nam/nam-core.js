// Inferência de capturas NAM (.nam) em JavaScript puro.
// Suporta as arquiteturas "A1": WaveNet (standard, lite, feather, nano) e LSTM.
// Segue a ordem de pesos do NeuralAmpModelerCore (NAM/wavenet/model.cpp, NAM/lstm.cpp).
// Roda tanto no AudioWorklet quanto no Node (testes).

const ACTIVATIONS = {
  Tanh: Math.tanh,
  Fasttanh: Math.tanh,
  ReLU: x => (x > 0 ? x : 0),
  Hardtanh: x => (x > 1 ? 1 : x < -1 ? -1 : x),
  Sigmoid: x => 1 / (1 + Math.exp(-x)),
  LeakyReLU: x => (x > 0 ? x : 0.01 * x),
};

const sigmoid = x => 1 / (1 + Math.exp(-x));

export class NamError extends Error {}

// Lê o JSON do .nam e devolve um modelo pronto para process().
export function createModel(nam) {
  if (!nam || typeof nam !== 'object') throw new NamError('Arquivo .nam inválido.');
  const weights = Float32Array.from(nam.weights || []);
  const sampleRate = nam.sample_rate || 48000;
  let model;
  if (nam.architecture === 'WaveNet') model = new WaveNet(nam.config, weights);
  else if (nam.architecture === 'LSTM') model = new LSTM(nam.config, weights);
  else throw new NamError(`Arquitetura "${nam.architecture}" ainda não suportada (só WaveNet A1 e LSTM).`);
  model.sampleRate = sampleRate;
  model.loudness = nam.metadata?.loudness ?? null;
  model.prewarm();
  return model;
}

class WeightReader {
  constructor(weights) { this.w = weights; this.i = 0; }
  take(n) {
    if (this.i + n > this.w.length) throw new NamError('Arquivo .nam com pesos faltando.');
    const out = this.w.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
  next() { return this.take(1)[0]; }
  done() {
    if (this.i !== this.w.length) throw new NamError(`Arquivo .nam com ${this.w.length - this.i} pesos sobrando.`);
  }
}

// Conv1D: pesos na ordem [saída][entrada][k]. Reordeno para [k][saída][entrada],
// que é como o laço interno lê.
function readConv(r, outCh, inCh, kernel, bias) {
  const raw = r.take(outCh * inCh * kernel);
  const w = new Float32Array(kernel * outCh * inCh);
  for (let o = 0; o < outCh; o++)
    for (let i = 0; i < inCh; i++)
      for (let k = 0; k < kernel; k++)
        w[(k * outCh + o) * inCh + i] = raw[(o * inCh + i) * kernel + k];
  return { w, b: bias ? Float32Array.from(r.take(outCh)) : new Float32Array(outCh) };
}

// Conv1x1: pesos [saída][entrada], depois o bias.
function read1x1(r, outCh, inCh, bias) {
  const w = Float32Array.from(r.take(outCh * inCh));
  return { w, b: bias ? Float32Array.from(r.take(outCh)) : new Float32Array(outCh) };
}

const BLOCK = 128;

const ACT_CODES = { Tanh: 0, Fasttanh: 0, ReLU: 1, Hardtanh: 2, Sigmoid: 3, LeakyReLU: 4 };

// Recusa recursos das arquiteturas novas (A2, FiLM, slimmable) que o motor ainda não implementa.
function checkWaveNet(config) {
  if (!config || !Array.isArray(config.layers)) throw new NamError('Configuração WaveNet inválida.');
  if (config.head) throw new NamError('WaveNet com "head" ainda não suportado.');
  config.layers.forEach((c, ai) => {
    for (const key of ['head1x1', 'layer1x1', 'bottleneck', 'groups_input', 'film_params', 'kernel_sizes', 'head'])
      if (c[key] !== undefined && c[key] !== null && !(key === 'bottleneck' && c[key] === c.channels) && !(key === 'groups_input' && c[key] === 1))
        throw new NamError(`Captura em formato novo (A2) ainda não suportada: "${key}".`);
    if (typeof c.activation !== 'string' || !ACTIVATIONS[c.activation])
      throw new NamError(`Ativação ${JSON.stringify(c.activation)} não suportada.`);
    if (c.condition_size !== 1) throw new NamError('condition_size diferente de 1 não suportado.');
    if (ai > 0 && config.layers[ai - 1].head_size !== c.channels)
      throw new NamError('head_size de um bloco difere dos canais do próximo.');
  });
}

// Config achatada para o motor WebAssembly (ver nam-wasm/src/lib.rs).
export function encodeForWasm(nam) {
  if (nam?.architecture !== 'WaveNet') return null;
  checkWaveNet(nam.config);
  const cfg = [nam.config.layers.length];
  for (const c of nam.config.layers)
    cfg.push(c.input_size, c.channels, c.kernel_size, c.gated ? 1 : 0, c.head_size, c.head_bias ? 1 : 0,
      ACT_CODES[c.activation], c.dilations.length, ...c.dilations);
  return { cfg: Int32Array.from(cfg), weights: Float32Array.from(nam.weights || []) };
}

class WaveNet {
  constructor(config, weights) {
    checkWaveNet(config);
    const r = new WeightReader(weights);
    this.arrays = config.layers.map(c => {
      const C = c.channels, K = c.kernel_size, gated = !!c.gated, Z = gated ? 2 * C : C;
      const arr = {
        inSize: c.input_size, C, K, gated, headSize: c.head_size,
        act: ACTIVATIONS[c.activation],
        rechannel: read1x1(r, C, c.input_size, false),
        layers: c.dilations.map(d => ({
          d, R: d * (K - 1),
          conv: readConv(r, Z, C, K, true),
          mixin: read1x1(r, Z, c.condition_size, false),
          out1x1: read1x1(r, C, C, true),
        })),
      };
      arr.head = read1x1(r, c.head_size, C, !!c.head_bias);
      return arr;
    });
    this.headScale = r.next();
    r.done();

    // Buffers: cada camada guarda [R amostras de histórico | BLOCK atuais] × canais, intercalado por tempo.
    for (const a of this.arrays) {
      for (const L of a.layers) L.buf = new Float32Array((L.R + BLOCK) * a.C);
      a.out = new Float32Array(BLOCK * a.C);   // saída da última camada
      a.headAcc = new Float32Array(BLOCK * a.C);
      a.headOut = new Float32Array(BLOCK * a.headSize);
    }
    this.z = new Float32Array(Math.max(...this.arrays.map(a => 2 * a.C)));
    this.receptiveField = 1 + this.arrays.reduce((s, a) => s + a.layers.reduce((t, L) => t + L.R, 0), 0);
  }

  prewarm() {
    const zeros = new Float32Array(BLOCK), out = new Float32Array(BLOCK);
    for (let n = 0; n < this.receptiveField; n += BLOCK) this.process(zeros, out);
  }

  // Processa qualquer tamanho de bloco, em pedaços de até BLOCK amostras.
  process(input, output) {
    for (let s = 0; s < input.length; s += BLOCK) {
      const n = Math.min(BLOCK, input.length - s);
      this._block(input.subarray(s, s + n), output.subarray(s, s + n), n);
    }
  }

  _block(x, y, N) {
    const z = this.z;
    let prevOut = null, prevC = 1, prevHead = null;
    for (const a of this.arrays) {
      const { C, K, gated, act, layers } = a;
      const Z = gated ? 2 * C : C;

      // Rechannel: entrada (sinal cru no 1º bloco, saída do bloco anterior nos outros) → buffer da 1ª camada.
      const first = layers[0], rw = a.rechannel.w;
      for (let t = 0; t < N; t++) {
        const dst = (first.R + t) * C;
        for (let o = 0; o < C; o++) {
          let acc = 0;
          if (prevOut === null) acc = rw[o] * x[t];
          else for (let i = 0; i < prevC; i++) acc += rw[o * prevC + i] * prevOut[t * prevC + i];
          first.buf[dst + o] = acc;
        }
      }

      // O acumulador da cabeça começa com a saída da cabeça do bloco anterior (ou zero).
      const head = a.headAcc;
      if (prevHead === null) head.fill(0, 0, N * C);
      else head.set(prevHead.subarray(0, N * C));

      for (let li = 0; li < layers.length; li++) {
        const L = layers[li], { d, R, buf } = L;
        const cw = L.conv.w, cb = L.conv.b, mw = L.mixin.w, ow = L.out1x1.w, ob = L.out1x1.b;
        const nextBuf = li + 1 < layers.length ? layers[li + 1].buf : a.out;
        const nextR = li + 1 < layers.length ? layers[li + 1].R : 0;
        for (let t = 0; t < N; t++) {
          const cond = x[t];
          for (let o = 0; o < Z; o++) {
            let acc = cb[o] + mw[o] * cond;
            for (let k = 0; k < K; k++) {
              const base = (R + t - d * (K - 1 - k)) * C, wb = (k * Z + o) * C;
              for (let i = 0; i < C; i++) acc += cw[wb + i] * buf[base + i];
            }
            z[o] = acc;
          }
          if (gated) for (let o = 0; o < C; o++) z[o] = Math.tanh(z[o]) * sigmoid(z[o + C]);
          else for (let o = 0; o < C; o++) z[o] = act(z[o]);
          const hb = t * C;
          for (let o = 0; o < C; o++) head[hb + o] += z[o];
          const src = (R + t) * C, dst = (nextR + t) * C;
          for (let o = 0; o < C; o++) {
            let acc = buf[src + o] + ob[o];
            const wb = o * C;
            for (let j = 0; j < C; j++) acc += ow[wb + j] * z[j];
            nextBuf[dst + o] = acc;
          }
        }
        // Guarda as últimas R amostras como histórico do próximo bloco.
        if (R > 0) buf.copyWithin(0, N * C, (R + N) * C);
      }

      // Cabeça: canais → head_size.
      const hw = a.head.w, hbias = a.head.b, H = a.headSize;
      for (let t = 0; t < N; t++)
        for (let h = 0; h < H; h++) {
          let acc = hbias[h];
          for (let c = 0; c < C; c++) acc += hw[h * C + c] * head[t * C + c];
          a.headOut[t * H + h] = acc;
        }
      prevOut = a.out; prevC = C; prevHead = a.headOut;
    }
    const s = this.headScale;
    for (let t = 0; t < N; t++) y[t] = s * prevHead[t];
  }
}

class LSTM {
  constructor(config, weights) {
    const { input_size: I = 1, hidden_size: H, num_layers: Ln } = config || {};
    if (!H || !Ln) throw new NamError('Configuração LSTM inválida.');
    const r = new WeightReader(weights);
    this.H = H;
    this.cells = [];
    for (let l = 0; l < Ln; l++) {
      const inSize = l === 0 ? I : H;
      const w = Float32Array.from(r.take(4 * H * (inSize + H)));
      const b = Float32Array.from(r.take(4 * H));
      const h0 = Float32Array.from(r.take(H));
      const c0 = Float32Array.from(r.take(H));
      const xh = new Float32Array(inSize + H);
      xh.set(h0, inSize);
      this.cells.push({ inSize, w, b, xh, c: c0, ifgo: new Float32Array(4 * H) });
    }
    this.headW = Float32Array.from(r.take(H));
    this.headB = r.next();
    r.done();
  }

  prewarm() {
    const n = Math.max(1, Math.floor(0.5 * (this.sampleRate || 48000)));
    const zeros = new Float32Array(BLOCK), out = new Float32Array(BLOCK);
    for (let i = 0; i < n; i += BLOCK) this.process(zeros, out);
  }

  process(input, output) {
    const H = this.H;
    for (let t = 0; t < input.length; t++) {
      let xin = null;
      for (const cell of this.cells) {
        const { inSize, w, b, xh, c, ifgo } = cell, cols = inSize + H;
        if (xin === null) xh[0] = input[t];
        else for (let i = 0; i < inSize; i++) xh[i] = xin[i];
        for (let r = 0; r < 4 * H; r++) {
          let acc = b[r];
          const wb = r * cols;
          for (let j = 0; j < cols; j++) acc += w[wb + j] * xh[j];
          ifgo[r] = acc;
        }
        for (let i = 0; i < H; i++)
          c[i] = sigmoid(ifgo[i + H]) * c[i] + sigmoid(ifgo[i]) * Math.tanh(ifgo[i + 2 * H]);
        for (let i = 0; i < H; i++)
          xh[inSize + i] = sigmoid(ifgo[i + 3 * H]) * Math.tanh(c[i]);
        xin = xh.subarray(inSize);
      }
      let y = this.headB;
      for (let i = 0; i < H; i++) y += this.headW[i] * xin[i];
      output[t] = y;
    }
  }
}
