// Inferência de capturas NAM (.nam) em JavaScript puro.
// Suporta WaveNet A1 (standard, lite, feather, nano), WaveNet A2 (bottleneck, layer1x1/head1x1,
// convs em grupo, FiLM, gating/blending, kernel por camada, cabeça com kernel, cabeça pós-pilha,
// condition DSP), LSTM e SlimmableContainer (usa o submodelo completo, como o plugin por padrão).
// Segue a ordem de pesos do NeuralAmpModelerCore (NAM/wavenet/model.cpp, NAM/lstm.cpp).
// Roda tanto no AudioWorklet quanto no Node (testes).

const sigmoid = x => 1 / (1 + Math.exp(-x));

// Mesma fórmula de fast_tanh() do NeuralAmpModelerCore.
function fastTanh(x) {
  const ax = Math.abs(x), x2 = x * x;
  return (x * (2.45550750702956 + 2.45550750702956 * ax + (0.893229853513558 + 0.821226666969744 * ax) * x2))
    / (2.44506634652299 + (2.44506634652299 + x2) * Math.abs(x + 0.814642734961073 * x * ax));
}

export class NamError extends Error {}

// Ativações: código (o mesmo do motor wasm), parâmetros e função (x, canal).
function parseActivation(j) {
  const type = typeof j === 'string' ? j : j?.type;
  const p = j && typeof j === 'object' ? j : {};
  const f = v => Math.fround(v);
  const mk = (code, params, fn) => ({ code, params: Float32Array.from(params), fn });
  switch (type) {
    case 'Tanh': return mk(0, [], Math.tanh);
    case 'ReLU': return mk(1, [], x => (x > 0 ? x : 0));
    case 'Hardtanh': return mk(2, [], x => (x > 1 ? 1 : x < -1 ? -1 : x));
    case 'Sigmoid': return mk(3, [], sigmoid);
    case 'LeakyReLU': {
      const s = f(p.negative_slope ?? 0.01);
      return mk(4, [s], x => (x > 0 ? x : s * x));
    }
    case 'Fasttanh': return mk(5, [], fastTanh);
    case 'PReLU': {
      const s = (p.negative_slopes ?? [p.negative_slope ?? 0.01]).map(f), n = s.length;
      return mk(6, s, (x, c) => (x > 0 ? x : s[c % n] * x));
    }
    case 'SiLU': return mk(7, [], x => x * sigmoid(x));
    case 'Hardswish': return mk(8, [], x => x * Math.min(Math.max(x + 3, 0), 6) / 6);
    case 'LeakyHardtanh': case 'LeakyHardTanh': {
      const [lo, hi, ls, hs] = [p.min_val ?? -1, p.max_val ?? 1, p.min_slope ?? 0.01, p.max_slope ?? 0.01].map(f);
      return mk(9, [lo, hi, ls, hs], x => (x < lo ? (x - lo) * ls + lo : x > hi ? (x - hi) * hs + hi : x));
    }
    case 'Softsign': return mk(10, [], x => x / (1 + Math.abs(x)));
  }
  throw new NamError(`Ativação ${JSON.stringify(j)} não suportada.`);
}

// SlimmableContainer: sem controle de tamanho no app, usa o último submodelo (o completo).
function unwrap(nam) {
  if (!nam || typeof nam !== 'object') throw new NamError('Arquivo .nam inválido.');
  if (nam.architecture !== 'SlimmableContainer') return nam;
  const subs = nam.config?.submodels;
  if (!Array.isArray(subs) || !subs.length) throw new NamError('SlimmableContainer sem submodelos.');
  return unwrap(subs[subs.length - 1].model);
}

// Lê o JSON do .nam e devolve um modelo pronto para process().
// Com deferWarm, o pré-aquecimento fica para chamadas a model.warm(blocos), que devolve quantas amostras faltam.
export function createModel(nam, { deferWarm = false } = {}) {
  const inner = unwrap(nam);
  let model;
  if (inner.architecture === 'WaveNet') model = new WaveNet(parseWaveNet(inner));
  else if (inner.architecture === 'LSTM') model = new LSTM(inner.config, Float32Array.from(inner.weights || []));
  else throw new NamError(`Arquitetura "${inner.architecture}" ainda não suportada (só WaveNet e LSTM).`);
  model.sampleRate = inner.sample_rate || nam.sample_rate || 48000;
  model.loudness = nam.metadata?.loudness ?? inner.metadata?.loudness ?? null;
  if (!deferWarm) model.prewarm();
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

// Conv1D causal (Conv1x1 quando K = 1). No arquivo: por grupo, [saída][entrada do grupo][k], depois o bias.
// Expando os grupos para uma matriz densa [k][saída][entrada] (zeros fora dos blocos).
function readConv(r, inCh, outCh, K, d, bias, groups = 1) {
  if (inCh % groups || outCh % groups) throw new NamError('Canais não divisíveis pelo número de grupos.');
  const opg = outCh / groups, ipg = inCh / groups;
  const raw = r.take(outCh * ipg * K);
  const w = new Float32Array(K * outCh * inCh);
  let p = 0;
  for (let g = 0; g < groups; g++)
    for (let i = 0; i < opg; i++)
      for (let j = 0; j < ipg; j++)
        for (let k = 0; k < K; k++)
          w[(k * outCh + g * opg + i) * inCh + g * ipg + j] = raw[p++];
  return { inCh, outCh, K, d, w, b: bias ? Float32Array.from(r.take(outCh)) : new Float32Array(outCh) };
}

const GATING = { none: 0, gated: 1, blended: 2 };
const FILMS = ['conv_pre_film', 'conv_post_film', 'input_mixin_pre_film', 'input_mixin_post_film',
  'activation_pre_film', 'activation_post_film', 'layer1x1_post_film', 'head1x1_post_film'];

const perLayer = (v, n, what) => {
  if (!Array.isArray(v)) return Array(n).fill(v);
  if (v.length !== n) throw new NamError(`"${what}" com tamanho diferente de "dilations".`);
  return v;
};

// Config + pesos → árvore com matrizes densas, usada pelos dois motores (JS e wasm).
function parseWaveNet(nam) {
  const config = nam.config;
  if (!config || !Array.isArray(config.layers) || !config.layers.length) throw new NamError('Configuração WaveNet inválida.');
  if ((config.in_channels ?? 1) !== 1) throw new NamError('WaveNet com mais de um canal de entrada não suportado.');
  let condition = null;
  if (config.condition_dsp) {
    if (config.condition_dsp.architecture !== 'WaveNet')
      throw new NamError(`condition_dsp "${config.condition_dsp.architecture}" não suportado (só WaveNet).`);
    condition = parseWaveNet(config.condition_dsp);
  }
  const condSize = condition ? condition.outCh : 1;
  const r = new WeightReader(Float32Array.from(nam.weights || []));

  const arrays = config.layers.map((c, ai) => {
    const sl = c.slimmable;
    if (sl && typeof sl === 'object' && sl.method && sl.method !== 'slice_channels_uniform')
      throw new NamError(`Método slimmable "${sl.method}" não suportado.`);
    // (slimmable "slice_channels_uniform" no tamanho máximo é a WaveNet normal.)
    const C = c.channels, Bn = c.bottleneck ?? C, n = c.dilations?.length;
    if (!C || !n) throw new NamError('Configuração WaveNet inválida.');
    if (c.condition_size !== condSize) throw new NamError('condition_size não bate com a entrada de condição.');
    const kernels = c.kernel_sizes !== undefined ? perLayer(c.kernel_sizes, n, 'kernel_sizes') : Array(n).fill(c.kernel_size);
    const acts = perLayer(c.activation, n, 'activation').map(parseActivation);
    let gatings, acts2;
    if (c.gating_mode !== undefined) {
      gatings = perLayer(c.gating_mode, n, 'gating_mode').map(g => {
        if (!(g in GATING)) throw new NamError(`gating_mode "${g}" desconhecido.`);
        return GATING[g];
      });
      acts2 = gatings.map((g, i) => {
        if (!g) return null;
        const s = Array.isArray(c.secondary_activation) ? c.secondary_activation[i] : c.secondary_activation;
        return parseActivation(s ?? 'Sigmoid');
      });
    } else {
      gatings = Array(n).fill(c.gated ? 1 : 0);
      acts2 = gatings.map(g => (g ? parseActivation('Sigmoid') : null));
    }
    const l1 = c.layer1x1 ?? { active: true, groups: 1 };
    const h1 = c.head1x1 ?? { active: false, out_channels: C, groups: 1 };
    if (!l1.active && Bn !== C) throw new NamError('layer1x1 inativo exige bottleneck igual a channels.');
    const films = FILMS.map(key => {
      const f = c[key];
      if (!f || f.active === false) return null;
      return { shift: f.shift ?? true, groups: f.groups ?? 1 };
    });
    if (films[6] && !l1.active) throw new NamError('layer1x1_post_film sem layer1x1.');
    if (films[7] && !h1.active) throw new NamError('head1x1_post_film sem head1x1.');
    let head;
    if (c.head && typeof c.head === 'object')
      head = { size: c.head.out_channels, K: c.head.kernel_size, d: c.head.head_dilation ?? 1, bias: !!c.head.bias };
    else if (c.head_size !== undefined) head = { size: c.head_size, K: 1, d: 1, bias: !!c.head_bias };
    else throw new NamError('WaveNet sem "head" nem "head_size".');
    const headIn = h1.active ? h1.out_channels : Bn;
    if (ai > 0) {
      const prev = config.layers[ai - 1];
      const prevHead = prev.head?.out_channels ?? prev.head_size;
      if (prevHead !== C || c.input_size !== prev.channels || prevHead !== headIn)
        throw new NamError('Dimensões entre blocos da WaveNet não batem.');
    } else if (c.input_size !== 1) throw new NamError('input_size do primeiro bloco diferente de 1.');

    // Ordem dos pesos: rechannel, camadas (conv, mixin, layer1x1, head1x1, FiLMs), cabeça do bloco.
    const Z = gatings.map(g => (g ? 2 * Bn : Bn));
    const rechannel = readConv(r, c.input_size, C, 1, 0, false);
    const layers = c.dilations.map((d, li) => {
      const filmDims = [C, Z[li], condSize, Z[li], Z[li], Bn, C, h1.out_channels];
      const L = {
        K: kernels[li], d, gating: gatings[li], act: acts[li], act2: acts2[li], Bn, C,
        conv: readConv(r, C, Z[li], kernels[li], d, true, c.groups_input ?? 1),
        mixin: readConv(r, condSize, Z[li], 1, 0, false, c.groups_input_mixin ?? 1),
        l1: l1.active ? readConv(r, Bn, C, 1, 0, true, l1.groups ?? 1) : null,
        h1: h1.active ? readConv(r, Bn, h1.out_channels, 1, 0, true, h1.groups ?? 1) : null,
      };
      L.films = films.map((f, fi) => f && {
        shift: f.shift, dim: filmDims[fi],
        conv: readConv(r, condSize, (f.shift ? 2 : 1) * filmDims[fi], 1, 0, true, f.groups),
      });
      return L;
    });
    const headConv = readConv(r, headIn, head.size, head.K, head.d, head.bias);
    return { inSize: c.input_size, C, Bn, headIn, headSize: head.size, rechannel, layers, headConv };
  });

  let post = null, outCh = arrays[arrays.length - 1].headSize;
  if (config.head) {
    const h = config.head, ks = h.kernel_sizes;
    if (!Array.isArray(ks) || !ks.length) throw new NamError('"head" da WaveNet sem kernel_sizes.');
    let cin = outCh;
    post = { act: parseActivation(h.activation), convs: ks.map((k, i) => {
      const cout = i + 1 === ks.length ? h.out_channels : h.channels;
      const conv = readConv(r, cin, cout, k, 1, true);
      cin = cout;
      return conv;
    }) };
    outCh = h.out_channels;
  }
  const headScale = r.next();
  r.done();
  return { condition, arrays, post, headScale, outCh };
}

const BLOCK = 128;

// Todas as matrizes são linhas por canal, contíguas no tempo: vista { a, o, s } = array, início do
// instante 0 do bloco, passo entre canais. Convs com K > 1 leem o histórico antes de o.
const view = (rows, hist = 0) => ({ a: new Float32Array(rows * (hist + BLOCK)), o: hist, s: hist + BLOCK, rows, hist });

const acc = new Float64Array(BLOCK);

// dst = (base ou 0) + bias + Σ w[k][o][i] · src[i][t − d·(K−1−k)]
function conv(c, src, dst, n, base = null) {
  const { inCh, outCh, K, d, w, b } = c, sa = src.a, da = dst.a;
  for (let o = 0; o < outCh; o++) {
    if (base) for (let t = 0, p = base.o + o * base.s; t < n; t++) acc[t] = base.a[p + t] + b[o];
    else acc.fill(b[o], 0, n);
    for (let k = 0; k < K; k++) {
      const off = src.o - d * (K - 1 - k), wb = (k * outCh + o) * inCh;
      for (let i = 0; i < inCh; i++) {
        const wv = w[wb + i];
        if (wv === 0) continue; // zeros dos grupos
        for (let t = 0, p = off + i * src.s; t < n; t++) acc[t] += wv * sa[p + t];
      }
    }
    for (let t = 0, p = dst.o + o * dst.s; t < n; t++) da[p + t] = acc[t];
  }
}

// Desloca o histórico: as últimas `hist` amostras de cada canal vão para o início.
function shift(v, n) {
  if (v.hist > 0) for (let i = 0; i < v.rows; i++) v.a.copyWithin(i * v.s, i * v.s + n, i * v.s + n + v.hist);
}

function copy(src, dst, rows, n) {
  for (let i = 0; i < rows; i++) dst.a.set(src.a.subarray(src.o + i * src.s, src.o + i * src.s + n), dst.o + i * dst.s);
}

function activate(act, v, rows, n) {
  const f = act.fn, a = v.a;
  for (let c = 0; c < rows; c++)
    for (let t = 0, p = v.o + c * v.s; t < n; t++) a[p + t] = f(a[p + t], c);
}

// FiLM: x = x · escala(cond) + deslocamento(cond), por canal e instante.
function film(f, cond, x, n, scratch) {
  conv(f.conv, cond, scratch, n);
  const a = x.a, sa = scratch.a;
  for (let c = 0; c < f.dim; c++) {
    const p = x.o + c * x.s, q = c * BLOCK, h = (f.dim + c) * BLOCK;
    if (f.shift) for (let t = 0; t < n; t++) a[p + t] = a[p + t] * sa[q + t] + sa[h + t];
    else for (let t = 0; t < n; t++) a[p + t] *= sa[q + t];
  }
}

class WaveNet {
  constructor(spec) {
    this.spec = spec;
    this.condition = spec.condition ? new WaveNet(spec.condition) : null;
    let maxRows = 1, lookback = this.condition ? this.condition.receptiveField - 1 : 0;
    for (const A of spec.arrays) {
      for (const L of A.layers) {
        L.hist = view(L.C, L.d * (L.K - 1));
        L.raw = L.films[0] ? view(L.C) : null; // entrada sem FiLM, para o residual
        L.in = L.raw ?? L.hist;
        lookback += L.hist.hist;
        maxRows = Math.max(maxRows, 2 * L.Bn, L.C, L.h1?.outCh ?? 0, ...L.films.map(f => f ? f.conv.outCh : 0));
      }
      A.out = view(A.C);
      A.headAcc = view(A.headIn, A.headConv.d * (A.headConv.K - 1));
      A.headOut = view(A.headSize);
      lookback += A.headAcc.hist;
    }
    if (spec.post) {
      spec.post.ins = spec.post.convs.map(c => view(c.inCh, c.K - 1));
      lookback += spec.post.ins.reduce((s, v) => s + v.hist, 0);
    }
    this.out = view(spec.outCh);
    this.x = view(1);
    this.z = view(maxRows);
    this.m = view(maxRows);
    this.h = view(maxRows);
    this.ss = view(maxRows);
    this.c = view(Math.max(maxRows, spec.arrays[0].layers[0].mixin.inCh));
    this.receptiveField = 1 + lookback;
  }

  prewarm() {
    while (this.warm(Infinity) > 0);
  }

  // Pré-aquece até `maxBlocks` blocos de silêncio; devolve quantas amostras do campo receptivo ainda faltam.
  warm(maxBlocks) {
    this.warmLeft ??= this.receptiveField;
    if (this.warmLeft > 0) {
      this.zeros ??= new Float32Array(BLOCK);
      this.scratch ??= new Float32Array(BLOCK);
      for (let i = 0; i < maxBlocks && this.warmLeft > 0; i++) {
        this.process(this.zeros, this.scratch);
        this.warmLeft = Math.max(0, this.warmLeft - BLOCK);
      }
    }
    return this.warmLeft;
  }

  // Processa qualquer tamanho de bloco, em pedaços de até BLOCK amostras.
  process(input, output) {
    for (let s = 0; s < input.length; s += BLOCK) {
      const n = Math.min(BLOCK, input.length - s);
      this.x.a.set(input.subarray(s, s + n));
      this._block(this.x, n);
      output.set(this.out.a.subarray(0, n), s);
    }
  }

  _layer(L, cond, n, out, headAcc) {
    const { z, m, h, ss } = this, [convPre, convPost, mixPre, mixPost, actPre, actPost, l1Post, h1Post] = L.films;
    const Bn = L.Bn;
    if (convPre) { copy(L.raw, L.hist, L.C, n); film(convPre, cond, L.hist, n, ss); }
    // z = mixin(cond) + conv(entrada)
    let mixIn = cond;
    if (mixPre) { copy(cond, this.c, mixPre.dim, n); film(mixPre, cond, this.c, n, ss); mixIn = this.c; }
    conv(L.mixin, mixIn, z, n);
    if (mixPost) film(mixPost, cond, z, n, ss);
    if (convPost) {
      conv(L.conv, L.hist, m, n);
      film(convPost, cond, m, n, ss);
      for (let i = 0; i < L.conv.outCh * BLOCK; i++) z.a[i] += m.a[i];
    } else conv(L.conv, L.hist, z, n, z);
    if (actPre) film(actPre, cond, z, n, ss);

    // Ativação: nas linhas de cima de z (com gate ou blend usando as de baixo).
    const za = z.a, f = L.act.fn;
    if (L.gating === 0) activate(L.act, z, Bn, n);
    else {
      const g = L.act2.fn, blend = L.gating === 2;
      for (let c = 0; c < Bn; c++)
        for (let t = 0, p = c * BLOCK, q = (c + Bn) * BLOCK; t < n; t++) {
          const v = za[p + t], a = g(za[q + t], c);
          za[p + t] = blend ? a * f(v, c) + (1 - a) * v : f(v, c) * a;
        }
    }
    if (actPost) film(actPost, cond, z, n, ss);

    // Cabeça: z (ou head1x1(z)) acumula no bloco.
    let hv = z, hRows = Bn;
    if (L.h1) {
      conv(L.h1, z, h, n);
      if (h1Post) film(h1Post, cond, h, n, ss);
      hv = h; hRows = L.h1.outCh;
    }
    for (let c = 0; c < hRows; c++)
      for (let t = 0, p = headAcc.o + c * headAcc.s, q = c * BLOCK; t < n; t++) headAcc.a[p + t] += hv.a[q + t];

    // Residual: entrada + layer1x1(z) → próxima camada.
    const inp = L.raw ?? L.hist;
    if (!L.l1) copy(inp, out, L.C, n);
    else if (l1Post) {
      conv(L.l1, z, out, n);
      film(l1Post, cond, out, n, ss);
      for (let c = 0; c < L.C; c++)
        for (let t = 0, p = out.o + c * out.s, q = inp.o + c * inp.s; t < n; t++) out.a[p + t] += inp.a[q + t];
    } else conv(L.l1, z, out, n, inp);
    shift(L.hist, n);
  }

  _block(x, n) {
    const { spec } = this;
    let cond = x;
    if (this.condition) { this.condition._block(x, n); cond = this.condition.out; }
    let prev = null;
    for (const A of spec.arrays) {
      // Rechannel: sinal cru no 1º bloco, saída do bloco anterior nos outros.
      conv(A.rechannel, prev ? prev.out : x, A.layers[0].in, n);
      // O acumulador da cabeça começa com a saída da cabeça do bloco anterior (ou zero).
      if (prev) copy(prev.headOut, A.headAcc, A.headIn, n);
      else for (let c = 0; c < A.headIn; c++) A.headAcc.a.fill(0, A.headAcc.o + c * A.headAcc.s, A.headAcc.o + c * A.headAcc.s + n);
      A.layers.forEach((L, li) => this._layer(L, cond, n, li + 1 < A.layers.length ? A.layers[li + 1].in : A.out, A.headAcc));
      conv(A.headConv, A.headAcc, A.headOut, n);
      shift(A.headAcc, n);
      prev = A;
    }
    const s = spec.headScale, last = prev.headOut;
    const post = spec.post;
    const dst = post ? post.ins[0] : this.out;
    for (let c = 0; c < last.rows; c++)
      for (let t = 0, p = c * BLOCK, q = dst.o + c * dst.s; t < n; t++) dst.a[q + t] = s * last.a[p + t];
    if (post) {
      // Cabeça pós-pilha: ativação e depois conv, em cadeia.
      post.convs.forEach((c, i) => {
        const inp = post.ins[i];
        activate(post.act, inp, c.inCh, n);
        conv(c, inp, i + 1 < post.convs.length ? post.ins[i + 1] : this.out, n);
        shift(inp, n);
      });
    }
  }
}

// Árvore achatada para o motor WebAssembly (ver nam-wasm/src/lib.rs): config em i32 e pesos em f32,
// lidos na mesma ordem. Pesos já densos ([k][saída][entrada]), sem grupos.
export function encodeForWasm(nam) {
  const inner = unwrap(nam);
  if (inner.architecture !== 'WaveNet') return null;
  const cfg = [], w = [];
  const pushW = a => { for (const v of a) w.push(v); };
  const conv = c => { cfg.push(c.inCh, c.outCh, c.K, c.d); pushW(c.w); pushW(c.b); };
  const act = a => { cfg.push(a.code, a.params.length); pushW(a.params); };
  const model = m => {
    cfg.push(m.condition ? 1 : 0);
    if (m.condition) model(m.condition);
    cfg.push(m.arrays.length);
    for (const A of m.arrays) {
      cfg.push(A.C, A.Bn, A.headIn);
      conv(A.rechannel);
      cfg.push(A.layers.length);
      for (const L of A.layers) {
        cfg.push(L.gating);
        act(L.act);
        if (L.gating) act(L.act2);
        conv(L.conv);
        conv(L.mixin);
        for (const c of [L.l1, L.h1]) { cfg.push(c ? 1 : 0); if (c) conv(c); }
        for (const f of L.films) { cfg.push(f ? 1 : 0); if (f) { cfg.push(f.shift ? 1 : 0, f.dim); conv(f.conv); } }
      }
      conv(A.headConv);
    }
    cfg.push(m.post ? m.post.convs.length : 0);
    if (m.post) { act(m.post.act); m.post.convs.forEach(conv); }
    cfg.push(m.outCh);
    w.push(m.headScale);
  };
  model(parseWaveNet(inner));
  return {
    cfg: Int32Array.from(cfg), weights: Float32Array.from(w),
    sampleRate: inner.sample_rate || nam.sample_rate || 48000,
    loudness: nam.metadata?.loudness ?? inner.metadata?.loudness ?? null,
  };
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
  // O LSTM aquece pouco; faz tudo na primeira chamada.
  warm() {
    if (!this.warmed) { this.warmed = true; this.prewarm(); }
    return 0;
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
