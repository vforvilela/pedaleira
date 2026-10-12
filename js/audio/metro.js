// Metrônomo amostra a amostra (roda no AudioWorklet e nos testes de unidade): um clique curto por tempo,
// mais agudo no primeiro tempo do compasso. beats = 0: sem acento.
export class Metronome {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.bpm = 120;
    this.beats = 4;
    this.level = 0.5;
    this.on = false;
    this.next = 0; // amostras até o próximo clique
    this.beat = 0;
    this.click = 0; // amostras restantes do clique atual
    this.freq = 0;
    this.n = 0;
  }

  set({ bpm, beats, level, on }) {
    if (bpm !== undefined) this.bpm = bpm;
    if (beats !== undefined) this.beats = beats;
    if (level !== undefined) this.level = level;
    // Ligou: o primeiro tempo (com acento) cai na hora.
    if (on !== undefined && on !== this.on) { this.on = on; this.next = 0; this.beat = 0; }
  }

  process(inp, out) {
    const sr = this.sr, len = Math.round(sr * 0.03);
    for (let i = 0; i < out.length; i++) {
      if (this.on && this.next <= 0) {
        this.freq = this.beats && this.beat === 0 ? 1760 : 1100;
        this.click = len;
        this.n = 0;
        this.beat = this.beats ? (this.beat + 1) % this.beats : 0;
        this.next += (sr * 60) / this.bpm;
      }
      this.next--;
      let s = 0;
      if (this.click > 0) {
        s = Math.sin((2 * Math.PI * this.freq * this.n) / sr) * Math.exp(-this.n / (sr * 0.006)) * this.level;
        this.n++;
        this.click--;
      }
      out[i] = s;
    }
  }
}
