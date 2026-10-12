// WaveNet do NAM (A1 e A2) em WebAssembly com SIMD (vetoriza no tempo, 4 amostras por instrução).
// Mesma matemática de js/nam/nam-core.js, que serve de referência e de reserva.
// Build: ./build.sh (gera js/nam/nam.wasm).
//
// Protocolo (uma instância wasm = um modelo):
//   p = alloc(bytes)                 → espaço para config (i32) e pesos (f32)
//   init(cfg, cfg_len, w, w_len)     → 0 ok; <0 erro
//   input_ptr()/output_ptr()         → buffers de 128 amostras
//   process(n)                       → processa n ≤ 128 amostras de input para output
//
// Config e pesos vêm de encodeForWasm() (nam-core.js), lidos em sequência:
//   modelo: tem_cond, [modelo cond], n_blocos, blocos..., n_convs_pos, [ativação, convs...], canais_saída
//           (+ peso head_scale)
//   bloco:  channels, bottleneck, head_in, conv rechannel, n_camadas, camadas..., conv da cabeça
//   camada: gating, ativação, [ativação 2], conv, mixin, tem_l1x1 [conv], tem_h1x1 [conv],
//           8 × (tem_film, [shift, dim, conv])
//   conv:   in, out, kernel, dilação (+ pesos densos [k][out][in] e bias)
//   ativação: código, n_params (+ params nos pesos)
// Códigos: 0 tanh, 1 relu, 2 hardtanh, 3 sigmoid, 4 leaky relu, 5 fast tanh, 6 prelu, 7 silu,
//          8 hardswish, 9 leaky hardtanh, 10 softsign

use core::arch::wasm32::*;

const B: usize = 128;

struct Conv {
    inc: usize,
    outc: usize,
    k: usize,
    d: usize,
    w: Vec<f32>, // [k][o][i]
    b: Vec<f32>,
}

struct Act {
    code: i32,
    p: Vec<f32>,
}

struct Film {
    shift: bool,
    dim: usize,
    conv: Conv,
}

// Linhas por canal, contíguas no tempo: [hist amostras de histórico | B atuais].
struct Buf {
    v: Vec<f32>,
    rows: usize,
    hist: usize,
}

impl Buf {
    fn new(rows: usize, hist: usize) -> Buf {
        Buf { v: vec![0.0; rows * (hist + B)], rows, hist }
    }
    fn s(&self) -> usize {
        self.hist + B
    }
    // Ponteiro para o instante 0 do bloco no canal 0.
    fn p(&mut self) -> *mut f32 {
        unsafe { self.v.as_mut_ptr().add(self.hist) }
    }
    // As últimas `hist` amostras de cada canal vão para o início.
    fn shift(&mut self, n: usize) {
        if self.hist > 0 {
            let s = self.s();
            for i in 0..self.rows {
                self.v.copy_within(i * s + n..i * s + n + self.hist, i * s);
            }
        }
    }
}

struct Layer {
    gating: i32,
    act: Act,
    act2: Option<Act>,
    c: usize,
    bn: usize,
    conv: Conv,
    mixin: Conv,
    l1: Option<Conv>,
    h1: Option<Conv>,
    films: [Option<Film>; 8],
    hist: Buf,        // entrada da conv (com FiLM, se houver)
    raw: Option<Buf>, // entrada sem FiLM, para o residual (só com conv_pre_film)
}

impl Layer {
    fn input(&mut self) -> (*mut f32, usize) {
        match self.raw.as_mut() {
            Some(r) => (r.p(), B),
            None => (self.hist.p(), self.hist.s()),
        }
    }
}

struct Array {
    head_in: usize,
    rech: Conv,
    layers: Vec<Layer>,
    head_conv: Conv,
    out: Buf,
    head_acc: Buf,
    head_out: Buf,
}

struct Post {
    act: Act,
    convs: Vec<Conv>,
    ins: Vec<Buf>,
}

struct Model {
    cond: Option<Box<Model>>,
    arrays: Vec<Array>,
    post: Option<Post>,
    head_scale: f32,
    out: Buf,
    z: Buf,
    m: Buf,
    h: Buf,
    ss: Buf,
    c: Buf,
    receptive_field: usize,
}

static mut MODEL: Option<Model> = None;
static mut INPUT: [f32; B] = [0.0; B];
static mut OUTPUT: [f32; B] = [0.0; B];

#[no_mangle]
pub extern "C" fn alloc(bytes: usize) -> *mut u8 {
    let mut v = vec![0u8; bytes];
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn input_ptr() -> *mut f32 {
    core::ptr::addr_of_mut!(INPUT) as *mut f32
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *mut f32 {
    core::ptr::addr_of_mut!(OUTPUT) as *mut f32
}

#[no_mangle]
pub extern "C" fn receptive_field() -> usize {
    unsafe { (*core::ptr::addr_of!(MODEL)).as_ref().map_or(0, |m| m.receptive_field) }
}

struct Reader<'a> {
    cfg: &'a [i32],
    ci: usize,
    w: &'a [f32],
    wi: usize,
}

impl<'a> Reader<'a> {
    fn int(&mut self) -> Option<usize> {
        let v = *self.cfg.get(self.ci)?;
        self.ci += 1;
        if v < 0 {
            return None;
        }
        Some(v as usize)
    }
    fn take(&mut self, n: usize) -> Option<Vec<f32>> {
        if self.wi + n > self.w.len() {
            return None;
        }
        let s = self.w[self.wi..self.wi + n].to_vec();
        self.wi += n;
        Some(s)
    }
    fn conv(&mut self) -> Option<Conv> {
        let (inc, outc, k, d) = (self.int()?, self.int()?, self.int()?, self.int()?);
        if k == 0 {
            return None;
        }
        let w = self.take(k * outc * inc)?;
        let b = self.take(outc)?;
        Some(Conv { inc, outc, k, d, w, b })
    }
    fn act(&mut self) -> Option<Act> {
        let code = self.int()? as i32;
        let n = self.int()?;
        let p = self.take(n)?;
        if code > 10 || (code == 6 && p.is_empty()) || (code == 4 && n < 1) || (code == 9 && n < 4) {
            return None;
        }
        Some(Act { code, p })
    }
    fn model(&mut self) -> Option<Model> {
        let cond = if self.int()? != 0 { Some(Box::new(self.model()?)) } else { None };
        let mut rf = cond.as_ref().map_or(1, |c| c.receptive_field);
        let mut max_rows = 1;
        let n_arrays = self.int()?;
        let mut arrays = Vec::new();
        for _ in 0..n_arrays {
            let (c, bn, head_in) = (self.int()?, self.int()?, self.int()?);
            let rech = self.conv()?;
            let n_layers = self.int()?;
            if n_layers == 0 {
                return None;
            }
            let mut layers = Vec::new();
            for _ in 0..n_layers {
                let gating = self.int()? as i32;
                let act = self.act()?;
                let act2 = if gating != 0 { Some(self.act()?) } else { None };
                let conv = self.conv()?;
                let mixin = self.conv()?;
                let l1 = if self.int()? != 0 { Some(self.conv()?) } else { None };
                let h1 = if self.int()? != 0 { Some(self.conv()?) } else { None };
                let mut films: [Option<Film>; 8] = Default::default();
                for f in films.iter_mut() {
                    if self.int()? != 0 {
                        let shift = self.int()? != 0;
                        let dim = self.int()?;
                        let conv = self.conv()?;
                        max_rows = max_rows.max(conv.outc);
                        *f = Some(Film { shift, dim, conv });
                    }
                }
                let r = conv.d * (conv.k - 1);
                rf += r;
                max_rows = max_rows.max(conv.outc).max(c).max(mixin.inc);
                if let Some(h) = &h1 {
                    max_rows = max_rows.max(h.outc);
                }
                let raw = if films[0].is_some() { Some(Buf::new(c, 0)) } else { None };
                layers.push(Layer { gating, act, act2, c, bn, conv, mixin, l1, h1, films, hist: Buf::new(c, r), raw });
            }
            let head_conv = self.conv()?;
            let hr = head_conv.d * (head_conv.k - 1);
            rf += hr;
            arrays.push(Array {
                head_in,
                rech,
                layers,
                out: Buf::new(c, 0),
                head_acc: Buf::new(head_in, hr),
                head_out: Buf::new(head_conv.outc, 0),
                head_conv,
            });
        }
        let n_post = self.int()?;
        let post = if n_post > 0 {
            let act = self.act()?;
            let mut convs = Vec::new();
            let mut ins = Vec::new();
            for _ in 0..n_post {
                let c = self.conv()?;
                rf += c.k - 1;
                ins.push(Buf::new(c.inc, c.k - 1));
                convs.push(c);
            }
            Some(Post { act, convs, ins })
        } else {
            None
        };
        let out_ch = self.int()?;
        let head_scale = self.take(1)?[0];
        Some(Model {
            cond,
            arrays,
            post,
            head_scale,
            out: Buf::new(out_ch, 0),
            z: Buf::new(max_rows, 0),
            m: Buf::new(max_rows, 0),
            h: Buf::new(max_rows, 0),
            ss: Buf::new(max_rows, 0),
            c: Buf::new(max_rows, 0),
            receptive_field: rf,
        })
    }
}

#[no_mangle]
pub extern "C" fn init(cfg: *const i32, cfg_len: usize, w: *const f32, w_len: usize) -> i32 {
    let cfg = unsafe { core::slice::from_raw_parts(cfg, cfg_len) };
    let w = unsafe { core::slice::from_raw_parts(w, w_len) };
    let mut r = Reader { cfg, ci: 0, w, wi: 0 };
    match r.model() {
        Some(m) if r.wi == w.len() && r.ci == cfg.len() => {
            unsafe { MODEL = Some(m) };
            prewarm();
            0
        }
        _ => -1,
    }
}

#[no_mangle]
pub extern "C" fn prewarm() {
    let rf = receptive_field();
    unsafe { (*core::ptr::addr_of_mut!(INPUT)).fill(0.0) };
    let mut n = 0;
    while n < rf {
        process(B);
        n += B;
    }
}

#[inline(always)]
fn tanh4(x: v128) -> v128 {
    // Padé 7/6 com saturação: erro máximo ~1e-4.
    let x = f32x4_max(f32x4_min(x, f32x4_splat(20.0)), f32x4_splat(-20.0));
    let x2 = f32x4_mul(x, x);
    let num = f32x4_mul(
        x,
        f32x4_add(f32x4_splat(135135.0), f32x4_mul(x2, f32x4_add(f32x4_splat(17325.0), f32x4_mul(x2, f32x4_add(f32x4_splat(378.0), x2))))),
    );
    let den = f32x4_add(
        f32x4_splat(135135.0),
        f32x4_mul(x2, f32x4_add(f32x4_splat(62370.0), f32x4_mul(x2, f32x4_add(f32x4_splat(3150.0), f32x4_mul(x2, f32x4_splat(28.0)))))),
    );
    let y = f32x4_div(num, den);
    f32x4_max(f32x4_min(y, f32x4_splat(1.0)), f32x4_splat(-1.0))
}

#[inline(always)]
fn sigmoid4(x: v128) -> v128 {
    let h = f32x4_splat(0.5);
    f32x4_add(h, f32x4_mul(h, tanh4(f32x4_mul(h, x))))
}

// fast_tanh() do NeuralAmpModelerCore.
#[inline(always)]
fn fast_tanh4(x: v128) -> v128 {
    let ax = f32x4_abs(x);
    let x2 = f32x4_mul(x, x);
    let a = f32x4_splat(2.45550750702956);
    let num = f32x4_mul(
        x,
        f32x4_add(
            f32x4_add(a, f32x4_mul(a, ax)),
            f32x4_mul(f32x4_add(f32x4_splat(0.893229853513558), f32x4_mul(f32x4_splat(0.821226666969744), ax)), x2),
        ),
    );
    let e = f32x4_splat(2.44506634652299);
    let den = f32x4_add(e, f32x4_mul(f32x4_add(e, x2), f32x4_abs(f32x4_add(x, f32x4_mul(f32x4_splat(0.814642734961073), f32x4_mul(x, ax))))));
    f32x4_div(num, den)
}

// x > 0 ? x : s·x
#[inline(always)]
fn leaky4(x: v128, s: f32) -> v128 {
    v128_bitselect(x, f32x4_mul(x, f32x4_splat(s)), f32x4_gt(x, f32x4_splat(0.0)))
}

#[inline(always)]
fn act4(a: &Act, ch: usize, x: v128) -> v128 {
    match a.code {
        1 => f32x4_max(x, f32x4_splat(0.0)),
        2 => f32x4_max(f32x4_min(x, f32x4_splat(1.0)), f32x4_splat(-1.0)),
        3 => sigmoid4(x),
        4 => leaky4(x, a.p[0]),
        5 => fast_tanh4(x),
        6 => leaky4(x, a.p[ch % a.p.len()]),
        7 => f32x4_mul(x, sigmoid4(x)),
        8 => {
            let t = f32x4_max(f32x4_min(f32x4_add(x, f32x4_splat(3.0)), f32x4_splat(6.0)), f32x4_splat(0.0));
            f32x4_mul(f32x4_mul(x, t), f32x4_splat(1.0 / 6.0))
        }
        9 => {
            let (lo, hi) = (f32x4_splat(a.p[0]), f32x4_splat(a.p[1]));
            let below = f32x4_add(f32x4_mul(f32x4_sub(x, lo), f32x4_splat(a.p[2])), lo);
            let above = f32x4_add(f32x4_mul(f32x4_sub(x, hi), f32x4_splat(a.p[3])), hi);
            v128_bitselect(below, v128_bitselect(above, x, f32x4_gt(x, hi)), f32x4_lt(x, lo))
        }
        10 => f32x4_div(x, f32x4_add(f32x4_splat(1.0), f32x4_abs(x))),
        _ => tanh4(x),
    }
}

#[inline(always)]
unsafe fn ld(p: *const f32) -> v128 {
    v128_load(p as *const v128)
}

#[inline(always)]
unsafe fn st(p: *mut f32, v: v128) {
    v128_store(p as *mut v128, v)
}

// dst = (base ou 0) + bias + Σ w[k][o][i] · src[i][t − d·(K−1−k)], 16 amostras por vez em registradores.
// base pode ser o próprio dst (acumula).
unsafe fn conv(c: &Conv, src: *const f32, ss: usize, dst: *mut f32, ds: usize, base: *const f32, bs: usize, n4: usize) {
    let (k, inc, outc, d) = (c.k, c.inc, c.outc, c.d);
    for o in 0..outc {
        let bias = f32x4_splat(c.b[o]);
        let dsto = dst.add(o * ds);
        let baseo = if base.is_null() { base } else { base.add(o * bs) };
        let init = |t: usize| if baseo.is_null() { bias } else { f32x4_add(bias, ld(baseo.add(t))) };
        let mut t = 0;
        while t < n4 {
            if t + 16 <= n4 {
                let (mut a0, mut a1, mut a2, mut a3) = (init(t), init(t + 4), init(t + 8), init(t + 12));
                for kk in 0..k {
                    let back = d * (k - 1 - kk);
                    let wrow = c.w.as_ptr().add((kk * outc + o) * inc);
                    for i in 0..inc {
                        let wv = f32x4_splat(*wrow.add(i));
                        let p = src.add(i * ss + t).sub(back);
                        a0 = f32x4_add(a0, f32x4_mul(wv, ld(p)));
                        a1 = f32x4_add(a1, f32x4_mul(wv, ld(p.add(4))));
                        a2 = f32x4_add(a2, f32x4_mul(wv, ld(p.add(8))));
                        a3 = f32x4_add(a3, f32x4_mul(wv, ld(p.add(12))));
                    }
                }
                st(dsto.add(t), a0);
                st(dsto.add(t + 4), a1);
                st(dsto.add(t + 8), a2);
                st(dsto.add(t + 12), a3);
                t += 16;
            } else {
                let mut a0 = init(t);
                for kk in 0..k {
                    let back = d * (k - 1 - kk);
                    let wrow = c.w.as_ptr().add((kk * outc + o) * inc);
                    for i in 0..inc {
                        a0 = f32x4_add(a0, f32x4_mul(f32x4_splat(*wrow.add(i)), ld(src.add(i * ss + t).sub(back))));
                    }
                }
                st(dsto.add(t), a0);
                t += 4;
            }
        }
    }
}

// FiLM: x = x · escala(cond) + deslocamento(cond).
unsafe fn film(f: &Film, cond: *const f32, cs: usize, x: *mut f32, xs: usize, ss: *mut f32, n4: usize) {
    conv(&f.conv, cond, cs, ss, B, core::ptr::null(), 0, n4);
    for c in 0..f.dim {
        let (xp, sp, hp) = (x.add(c * xs), ss.add(c * B), ss.add((f.dim + c) * B));
        for t in (0..n4).step_by(4) {
            let mut v = f32x4_mul(ld(xp.add(t)), ld(sp.add(t)));
            if f.shift {
                v = f32x4_add(v, ld(hp.add(t)));
            }
            st(xp.add(t), v);
        }
    }
}

unsafe fn copy_rows(src: *const f32, ss: usize, dst: *mut f32, ds: usize, rows: usize, n4: usize) {
    for i in 0..rows {
        core::ptr::copy_nonoverlapping(src.add(i * ss), dst.add(i * ds), n4);
    }
}

// dst += src
unsafe fn add_rows(src: *const f32, ss: usize, dst: *mut f32, ds: usize, rows: usize, n4: usize) {
    for i in 0..rows {
        let (s, d) = (src.add(i * ss), dst.add(i * ds));
        for t in (0..n4).step_by(4) {
            st(d.add(t), f32x4_add(ld(d.add(t)), ld(s.add(t))));
        }
    }
}

unsafe fn act_rows(a: &Act, x: *mut f32, xs: usize, rows: usize, n4: usize) {
    for c in 0..rows {
        let p = x.add(c * xs);
        for t in (0..n4).step_by(4) {
            st(p.add(t), act4(a, c, ld(p.add(t))));
        }
    }
}

struct Scratch {
    z: *mut f32,
    m: *mut f32,
    h: *mut f32,
    ss: *mut f32,
    c: *mut f32,
}

unsafe fn layer(l: &mut Layer, cond: *const f32, cs: usize, n: usize, n4: usize, out: *mut f32, os: usize, head: *mut f32, hs: usize, sc: &Scratch) {
    let (hist, hst) = (l.hist.p(), l.hist.s());
    let (inp, is) = l.input();
    let null = core::ptr::null();
    let (z, bn, zc) = (sc.z, l.bn, l.conv.outc);
    let f = &l.films;
    if let Some(fm) = &f[0] {
        copy_rows(inp, is, hist, hst, l.c, n4);
        film(fm, cond, cs, hist, hst, sc.ss, n4);
    }
    // z = mixin(cond) + conv(entrada)
    let mut mix_in = cond;
    if let Some(fm) = &f[2] {
        copy_rows(cond, cs, sc.c, B, fm.dim, n4);
        film(fm, cond, cs, sc.c, B, sc.ss, n4);
        mix_in = sc.c;
    }
    conv(&l.mixin, mix_in, if f[2].is_some() { B } else { cs }, z, B, null, 0, n4);
    if let Some(fm) = &f[3] {
        film(fm, cond, cs, z, B, sc.ss, n4);
    }
    if let Some(fm) = &f[1] {
        conv(&l.conv, hist, hst, sc.m, B, null, 0, n4);
        film(fm, cond, cs, sc.m, B, sc.ss, n4);
        add_rows(sc.m, B, z, B, zc, n4);
    } else {
        conv(&l.conv, hist, hst, z, B, z, B, n4);
    }
    if let Some(fm) = &f[4] {
        film(fm, cond, cs, z, B, sc.ss, n4);
    }

    // Ativação nas linhas de cima de z (com gate ou blend usando as de baixo).
    match (l.gating, &l.act2) {
        (1, Some(a2)) => {
            for c in 0..bn {
                let (p, q) = (z.add(c * B), z.add((c + bn) * B));
                for t in (0..n4).step_by(4) {
                    st(p.add(t), f32x4_mul(act4(&l.act, c, ld(p.add(t))), act4(a2, c, ld(q.add(t)))));
                }
            }
        }
        (2, Some(a2)) => {
            for c in 0..bn {
                let (p, q) = (z.add(c * B), z.add((c + bn) * B));
                for t in (0..n4).step_by(4) {
                    let v = ld(p.add(t));
                    let a = act4(a2, c, ld(q.add(t)));
                    let y = f32x4_add(f32x4_mul(a, act4(&l.act, c, v)), f32x4_mul(f32x4_sub(f32x4_splat(1.0), a), v));
                    st(p.add(t), y);
                }
            }
        }
        _ => act_rows(&l.act, z, B, bn, n4),
    }
    if let Some(fm) = &f[5] {
        film(fm, cond, cs, z, B, sc.ss, n4);
    }

    // Cabeça: z (ou head1x1(z)) acumula no bloco.
    if let Some(h1) = &l.h1 {
        conv(h1, z, B, sc.h, B, null, 0, n4);
        if let Some(fm) = &f[7] {
            film(fm, cond, cs, sc.h, B, sc.ss, n4);
        }
        add_rows(sc.h, B, head, hs, h1.outc, n4);
    } else {
        add_rows(z, B, head, hs, bn, n4);
    }

    // Residual: entrada + layer1x1(z) → próxima camada.
    match &l.l1 {
        None => copy_rows(inp, is, out, os, l.c, n4),
        Some(l1) => {
            if let Some(fm) = &f[6] {
                conv(l1, z, B, out, os, null, 0, n4);
                film(fm, cond, cs, out, os, sc.ss, n4);
                add_rows(inp, is, out, os, l.c, n4);
            } else {
                conv(l1, z, B, out, os, inp, is, n4);
            }
        }
    }
    l.hist.shift(n);
}

impl Model {
    // Processa n ≤ B amostras de x (1 canal) para self.out.
    unsafe fn run(&mut self, x: *const f32, n: usize) {
        let n4 = (n + 3) & !3;
        let (cond, cs) = match self.cond.as_mut() {
            Some(c) => {
                c.run(x, n);
                (c.out.p() as *const f32, B)
            }
            None => (x, B),
        };
        let sc = Scratch { z: self.z.p(), m: self.m.p(), h: self.h.p(), ss: self.ss.p(), c: self.c.p() };
        let null = core::ptr::null();
        let mut prev: Option<(*const f32, *const f32)> = None; // (saída, cabeça) do bloco anterior
        for a in self.arrays.iter_mut() {
            // Rechannel: sinal cru no 1º bloco, saída do bloco anterior nos outros.
            let (dst, ds) = a.layers[0].input();
            conv(&a.rech, prev.map_or(x, |p| p.0), B, dst, ds, null, 0, n4);
            // O acumulador da cabeça começa com a saída da cabeça do bloco anterior (ou zero).
            let (ha, hs) = (a.head_acc.p(), a.head_acc.s());
            match prev {
                Some((_, ph)) => copy_rows(ph, B, ha, hs, a.head_in, n4),
                None => {
                    for i in 0..a.head_in {
                        core::ptr::write_bytes(ha.add(i * hs), 0, n4);
                    }
                }
            }
            let nl = a.layers.len();
            for li in 0..nl {
                let (cur, rest) = a.layers.split_at_mut(li + 1);
                let (out, os) = if li + 1 < nl { rest[0].input() } else { (a.out.p(), B) };
                layer(&mut cur[li], cond, cs, n, n4, out, os, ha, hs, &sc);
            }
            conv(&a.head_conv, ha, hs, a.head_out.p(), B, null, 0, n4);
            a.head_acc.shift(n);
            prev = Some((a.out.p(), a.head_out.p()));
        }

        let last = prev.unwrap().1;
        let sc4 = f32x4_splat(self.head_scale);
        let (dst, ds, rows) = match self.post.as_mut() {
            Some(p) => (p.ins[0].p(), p.ins[0].s(), p.convs[0].inc),
            None => (self.out.p(), B, self.out.rows),
        };
        for c in 0..rows {
            for t in (0..n4).step_by(4) {
                st(dst.add(c * ds + t), f32x4_mul(sc4, ld(last.add(c * B + t))));
            }
        }
        if let Some(p) = self.post.as_mut() {
            // Cabeça pós-pilha: ativação e depois conv, em cadeia.
            let np = p.convs.len();
            for i in 0..np {
                let (src, ss) = (p.ins[i].p(), p.ins[i].s());
                act_rows(&p.act, src, ss, p.convs[i].inc, n4);
                let (dst, ds) = if i + 1 < np { (p.ins[i + 1].p(), p.ins[i + 1].s()) } else { (self.out.p(), B) };
                conv(&p.convs[i], src, ss, dst, ds, null, 0, n4);
                p.ins[i].shift(n);
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn process(n: usize) {
    unsafe {
        let Some(m) = (*core::ptr::addr_of_mut!(MODEL)).as_mut() else { return };
        let n = n.min(B);
        m.run(core::ptr::addr_of!(INPUT) as *const f32, n);
        core::ptr::copy_nonoverlapping(m.out.p(), core::ptr::addr_of_mut!(OUTPUT) as *mut f32, n);
    }
}
