// Fuzz Face: o que faz ele "limpar" quando você baixa o volume da guitarra.
// No pedal real, a entrada de baixa impedância e a polarização dos transistores fazem o ganho cair junto
// com o nível que chega. Aqui, um seguidor de envelope reduz o ganho antes da clipagem (o WaveShaper,
// com oversampling, fica no grafo Web Audio). Roda no AudioWorklet e no Node, nos testes.

// Clipagem: mesma inclinação dos dois lados (sinal fraco passa limpo), tetos diferentes (1 e 0,85):
// a assimetria só aparece quando clipa e gera os harmônicos pares do fuzz.
export const fuzzShape = x => (x >= 0 ? Math.tanh(6 * x) : 0.85 * Math.tanh((6 * x) / 0.85));

const onePole = (ms, sr) => 1 - Math.exp(-1 / ((ms / 1000) * sr));

export class FuzzBias {
  // ref: pico de uma palhetada normal com o volume da guitarra no máximo (a entrada calibrada pelo medidor).
  // k: quanto o ganho cai com o nível; 2,2 deixa o volume a 30% quase limpo, como no pedal.
  constructor(sampleRate, { ref = 0.3, k = 2.2 } = {}) {
    this.att = onePole(2, sampleRate);
    this.rel = onePole(120, sampleRate);
    this.env = 0;
    this.ref = ref;
    this.k = k;
    this.drive = 40;
  }

  process(inp, out) {
    const { att, rel, ref, k, drive } = this;
    let env = this.env;
    for (let i = 0; i < inp.length; i++) {
      const a = Math.abs(inp[i]);
      env += (a > env ? att : rel) * (a - env);
      const g = Math.min(1.5, Math.max(0.02, Math.pow(env / ref, k)));
      out[i] = inp[i] * drive * g;
    }
    this.env = env;
  }
}
