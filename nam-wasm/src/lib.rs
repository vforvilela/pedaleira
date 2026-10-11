// WaveNet A1 do NAM em WebAssembly com SIMD (vetoriza no tempo, 4 amostras por instrução).
// Mesma matemática de js/nam/nam-core.js, que serve de referência e de reserva.
// Build: ./build.sh (gera js/nam/nam.wasm).
//
// Protocolo (uma instância wasm = um modelo):
//   p = alloc(bytes)                 → espaço para config (i32) e pesos (f32)
//   init(cfg, cfg_len, w, w_len)     → 0 ok; <0 erro
//   input_ptr()/output_ptr()         → buffers de 128 amostras
//   process(n)                       → processa n ≤ 128 amostras de input para output
//
// Config: [n_arrays, para cada: input_size, channels, kernel, gated, head_size, head_bias, act, n_layers, dilações...]
// act: 0 tanh, 1 relu, 2 hardtanh, 3 sigmoid, 4 leaky relu

use core::arch::wasm32::*;

const B: usize = 128;

struct Layer {
    d: usize,
    r: usize,
    stride: usize,
    conv_w: Vec<f32>, // [k][o][i]
    conv_b: Vec<f32>,
    mix_w: Vec<f32>,
    out_w: Vec<f32>, // [o][j]
    out_b: Vec<f32>,
    buf: Vec<f32>, // C linhas × (R + B)
}

struct Array {
    c: usize,
    k: usize,
    gated: bool,
    head_size: usize,
    act: i32,
    in_size: usize,
    rech_w: Vec<f32>, // [o][i]
    layers: Vec<Layer>,
    head_w: Vec<f32>,
    head_b: Vec<f32>,
    out: Vec<f32>,      // C × B
    head_acc: Vec<f32>, // C × B
    head_out: Vec<f32>, // H × B
}

struct Model {
    arrays: Vec<Array>,
    head_scale: f32,
    z: Vec<f32>,
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
    w: &'a [f32],
    i: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [f32]> {
        if self.i + n > self.w.len() {
            return None;
        }
        let s = &self.w[self.i..self.i + n];
        self.i += n;
        Some(s)
    }
}

#[no_mangle]
pub extern "C" fn init(cfg: *const i32, cfg_len: usize, w: *const f32, w_len: usize) -> i32 {
    let cfg = unsafe { core::slice::from_raw_parts(cfg, cfg_len) };
    let w = unsafe { core::slice::from_raw_parts(w, w_len) };
    match build(cfg, w) {
        Some(m) => {
            unsafe { MODEL = Some(m) };
            prewarm();
            0
        }
        None => -1,
    }
}

fn build(cfg: &[i32], w: &[f32]) -> Option<Model> {
    let mut ci = 0;
    let mut next = || {
        let v = *cfg.get(ci)?;
        ci += 1;
        Some(v as usize)
    };
    let n_arrays = next()?;
    let mut r = Reader { w, i: 0 };
    let mut arrays = Vec::new();
    let mut max_z = 0;
    let mut rf = 1;
    for _ in 0..n_arrays {
        let in_size = next()?;
        let c = next()?;
        let k = next()?;
        let gated = next()? != 0;
        let head_size = next()?;
        let head_bias = next()? != 0;
        let act = next()? as i32;
        let n_layers = next()?;
        let zc = if gated { 2 * c } else { c };
        max_z = max_z.max(zc);
        let rech_w = r.take(c * in_size)?.to_vec();
        let mut layers = Vec::new();
        for _ in 0..n_layers {
            let d = next()?;
            let rr = d * (k - 1);
            rf += rr;
            let raw = r.take(zc * c * k)?;
            let mut conv_w = vec![0.0; zc * c * k];
            for o in 0..zc {
                for i in 0..c {
                    for kk in 0..k {
                        conv_w[(kk * zc + o) * c + i] = raw[(o * c + i) * k + kk];
                    }
                }
            }
            let conv_b = r.take(zc)?.to_vec();
            let mix_w = r.take(zc)?.to_vec();
            let out_w = r.take(c * c)?.to_vec();
            let out_b = r.take(c)?.to_vec();
            let stride = rr + B;
            layers.push(Layer { d, r: rr, stride, conv_w, conv_b, mix_w, out_w, out_b, buf: vec![0.0; c * stride] });
        }
        let head_w = r.take(head_size * c)?.to_vec();
        let head_b = if head_bias { r.take(head_size)?.to_vec() } else { vec![0.0; head_size] };
        arrays.push(Array {
            c, k, gated, head_size, act, in_size, rech_w, layers, head_w, head_b,
            out: vec![0.0; c * B],
            head_acc: vec![0.0; c * B],
            head_out: vec![0.0; head_size * B],
        });
    }
    let head_scale = r.take(1)?[0];
    if r.i != w.len() {
        return None;
    }
    Some(Model { arrays, head_scale, z: vec![0.0; max_z * B], receptive_field: rf })
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

#[inline(always)]
fn act4(a: i32, x: v128) -> v128 {
    match a {
        1 => f32x4_max(x, f32x4_splat(0.0)),
        2 => f32x4_max(f32x4_min(x, f32x4_splat(1.0)), f32x4_splat(-1.0)),
        3 => sigmoid4(x),
        4 => {
            let neg = f32x4_mul(x, f32x4_splat(0.01));
            f32x4_max(x, neg)
        }
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

#[no_mangle]
pub extern "C" fn process(n: usize) {
    unsafe {
        let Some(m) = (*core::ptr::addr_of_mut!(MODEL)).as_mut() else { return };
        let n = n.min(B);
        let n4 = (n + 3) & !3;
        let x = core::ptr::addr_of!(INPUT) as *const f32;
        let z = m.z.as_mut_ptr();
        let mut prev_out: *const f32 = core::ptr::null();
        let mut prev_head: *const f32 = core::ptr::null();
        let mut prev_c = 1;

        for a in m.arrays.iter_mut() {
            let c = a.c;
            let zc = if a.gated { 2 * c } else { c };

            // Rechannel → buffer da primeira camada.
            {
                let l0 = &mut a.layers[0];
                let dst0 = l0.buf.as_mut_ptr();
                for o in 0..c {
                    let dst = dst0.add(o * l0.stride + l0.r);
                    for t in (0..n4).step_by(4) {
                        let mut acc = f32x4_splat(0.0);
                        if prev_out.is_null() {
                            acc = f32x4_mul(f32x4_splat(a.rech_w[o]), ld(x.add(t)));
                        } else {
                            for i in 0..prev_c {
                                acc = f32x4_add(acc, f32x4_mul(f32x4_splat(a.rech_w[o * a.in_size + i]), ld(prev_out.add(i * B + t))));
                            }
                        }
                        st(dst.add(t), acc);
                    }
                }
            }

            let head = a.head_acc.as_mut_ptr();
            if prev_head.is_null() {
                a.head_acc.fill(0.0);
            } else {
                core::ptr::copy_nonoverlapping(prev_head, head, c * B);
            }

            let nl = a.layers.len();
            for li in 0..nl {
                let (cur, rest) = a.layers.split_at_mut(li + 1);
                let l = &mut cur[li];
                let buf = l.buf.as_mut_ptr();
                let (s, r, d) = (l.stride, l.r, l.d);
                let k = a.k;

                // z = conv(buf) + bias + mixin * cond, 16 amostras por vez em registradores.
                for o in 0..zc {
                    let zo = z.add(o * B);
                    let bias = f32x4_splat(l.conv_b[o]);
                    let mw = f32x4_splat(l.mix_w[o]);
                    let mut t = 0;
                    while t < n4 {
                        if t + 16 <= n4 {
                            let mut a0 = f32x4_add(bias, f32x4_mul(mw, ld(x.add(t))));
                            let mut a1 = f32x4_add(bias, f32x4_mul(mw, ld(x.add(t + 4))));
                            let mut a2 = f32x4_add(bias, f32x4_mul(mw, ld(x.add(t + 8))));
                            let mut a3 = f32x4_add(bias, f32x4_mul(mw, ld(x.add(t + 12))));
                            for kk in 0..k {
                                let base = r - d * (k - 1 - kk) + t;
                                let wrow = l.conv_w.as_ptr().add((kk * zc + o) * c);
                                for i in 0..c {
                                    let wv = f32x4_splat(*wrow.add(i));
                                    let p = buf.add(i * s + base);
                                    a0 = f32x4_add(a0, f32x4_mul(wv, ld(p)));
                                    a1 = f32x4_add(a1, f32x4_mul(wv, ld(p.add(4))));
                                    a2 = f32x4_add(a2, f32x4_mul(wv, ld(p.add(8))));
                                    a3 = f32x4_add(a3, f32x4_mul(wv, ld(p.add(12))));
                                }
                            }
                            st(zo.add(t), a0);
                            st(zo.add(t + 4), a1);
                            st(zo.add(t + 8), a2);
                            st(zo.add(t + 12), a3);
                            t += 16;
                        } else {
                            let mut a0 = f32x4_add(bias, f32x4_mul(mw, ld(x.add(t))));
                            for kk in 0..k {
                                let base = r - d * (k - 1 - kk) + t;
                                let wrow = l.conv_w.as_ptr().add((kk * zc + o) * c);
                                for i in 0..c {
                                    a0 = f32x4_add(a0, f32x4_mul(f32x4_splat(*wrow.add(i)), ld(buf.add(i * s + base))));
                                }
                            }
                            st(zo.add(t), a0);
                            t += 4;
                        }
                    }
                }

                // Ativação (com gate, se houver) e acumulação na cabeça.
                for o in 0..c {
                    let zo = z.add(o * B);
                    let ho = head.add(o * B);
                    for t in (0..n4).step_by(4) {
                        let v = if a.gated {
                            f32x4_mul(tanh4(ld(zo.add(t))), sigmoid4(ld(z.add((o + c) * B + t))))
                        } else {
                            act4(a.act, ld(zo.add(t)))
                        };
                        st(zo.add(t), v);
                        st(ho.add(t), f32x4_add(ld(ho.add(t)), v));
                    }
                }

                // Saída residual: entrada + 1x1(z) → próxima camada (ou saída do bloco).
                let (dst, ds, dr) = if li + 1 < nl {
                    let nx = &mut rest[0];
                    (nx.buf.as_mut_ptr(), nx.stride, nx.r)
                } else {
                    (a.out.as_mut_ptr(), B, 0)
                };
                for o in 0..c {
                    let ob = f32x4_splat(l.out_b[o]);
                    let wrow = l.out_w.as_ptr().add(o * c);
                    let src = buf.add(o * s + r);
                    let dsto = dst.add(o * ds + dr);
                    for t in (0..n4).step_by(4) {
                        let mut acc = f32x4_add(ld(src.add(t)), ob);
                        for j in 0..c {
                            acc = f32x4_add(acc, f32x4_mul(f32x4_splat(*wrow.add(j)), ld(z.add(j * B + t))));
                        }
                        st(dsto.add(t), acc);
                    }
                }

                // Histórico: as últimas R amostras de cada canal vão para o início.
                if r > 0 {
                    for i in 0..c {
                        let row = buf.add(i * s);
                        core::ptr::copy(row.add(n), row, r);
                    }
                }
            }

            // Cabeça: canais → head_size.
            let h = a.head_size;
            let ho = a.head_out.as_mut_ptr();
            for hh in 0..h {
                let hb = f32x4_splat(a.head_b[hh]);
                for t in (0..n4).step_by(4) {
                    let mut acc = hb;
                    for cc in 0..c {
                        acc = f32x4_add(acc, f32x4_mul(f32x4_splat(a.head_w[hh * c + cc]), ld(head.add(cc * B + t))));
                    }
                    st(ho.add(hh * B + t), acc);
                }
            }
            prev_out = a.out.as_ptr();
            prev_head = a.head_out.as_ptr();
            prev_c = c;
        }

        let y = core::ptr::addr_of_mut!(OUTPUT) as *mut f32;
        let sc = f32x4_splat(m.head_scale);
        for t in (0..n4).step_by(4) {
            st(y.add(t), f32x4_mul(sc, ld(prev_head.add(t))));
        }
    }
}
