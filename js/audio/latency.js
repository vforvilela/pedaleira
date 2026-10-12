// Mede a latência de ida e volta: toca um clique, espera ele voltar pela entrada e conta as amostras.
// Precisa de um caminho da saída para a entrada (cabo da saída da interface na entrada, ou o fone
// encostado no microfone). Roda no AudioWorklet e nos testes de unidade.

export class LatencyProbe {
  constructor(sampleRate, { clicks = 6, every = 0.4, maxWait = 0.35 } = {}) {
    this.sr = sampleRate;
    this.clicks = clicks;
    this.every = Math.round(every * sampleRate);
    this.maxWait = Math.round(maxWait * sampleRate);
    this.frame = 0;
    this.quiet = Math.round(0.15 * sampleRate); // escuta o ruído antes do primeiro clique
    this.noise = 0;
    this.sent = [];
    this.found = [];
    this.done = false;
  }

  // Amostras de atraso de cada clique (os que não voltaram ficam de fora).
  get delays() { return this.found.filter(d => d !== null); }

  process(inp, out) {
    for (let i = 0; i < out.length; i++, this.frame++) {
      const f = this.frame, x = inp ? Math.abs(inp[i]) : 0;
      if (f < this.quiet) { this.noise = Math.max(this.noise, x); out[i] = 0; continue; }
      const t = f - this.quiet, k = Math.floor(t / this.every), at = t - k * this.every;
      // Clique: 1 ms de onda quadrada de 2 kHz, bem audível e fácil de achar.
      out[i] = k < this.clicks && at < this.sr / 1000 ? (Math.floor(at / (this.sr / 4000)) % 2 ? -0.5 : 0.5) : 0;
      if (k < this.clicks && at === 0) { this.sent.push(f); this.found.push(null); }
      // Procura a volta do último clique enviado.
      const n = this.sent.length - 1;
      if (n >= 0 && this.found[n] === null && f - this.sent[n] < this.maxWait && x > Math.max(0.02, this.noise * 4))
        this.found[n] = f - this.sent[n];
      if (k >= this.clicks && at > this.maxWait) this.done = true;
    }
  }

  // Mediana em ms, ou null se nenhum clique voltou.
  resultMs() {
    const d = [...this.delays].sort((a, b) => a - b);
    return d.length ? (d[d.length >> 1] / this.sr) * 1000 : null;
  }
}
