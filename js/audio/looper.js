// Looper amostra a amostra (roda no AudioWorklet e nos testes de unidade).
// Pisada: vazio → grava → toca → sobrepõe → toca → … ; parado → toca. STOP para; APAGAR esvazia.
// DESFAZER tira a última camada sobreposta (e de novo, traz de volta: refazer).
// A saída é só o loop (no volume LEVEL); o som ao vivo passa por fora, no pedal.

export class Looper {
  constructor(sampleRate, maxSeconds = 120) {
    this.sr = sampleRate;
    this.buf = new Float32Array(Math.round(sampleRate * maxSeconds));
    this.len = 0;
    this.pos = 0;
    this.level = 1;
    this.state = 'empty';
    this.undoBuf = null; // o loop como estava antes da última sobreposição
    this.canUndo = false;
    // Quantização: tamanho do loop arredondado para um múltiplo de `quantum` amostras (0 = livre).
    // Arredondando para cima, a gravação continua até lá; para baixo, corta o excesso.
    this.quantum = 0;
    this.target = 0;
  }

  command(cmd) {
    const s = this.state;
    if (cmd === 'clear') { this.state = 'empty'; this.len = this.pos = this.target = 0; this.canUndo = false; return; }
    if (cmd === 'undo') {
      // Troca o loop com a cópia guardada: desfaz a última camada, e chamado de novo refaz.
      if (!this.undoBuf || !this.len) return;
      if (s === 'dub') this.state = 'play';
      const cur = this.buf.slice(0, this.len);
      this.buf.set(this.undoBuf.subarray(0, this.len), 0);
      this.undoBuf = cur;
      return;
    }
    if (cmd === 'stop') {
      if (s === 'rec') this.finishRecording(this.target && this.target <= this.pos ? this.target : this.pos);
      if (this.len) { this.state = 'stop'; this.pos = 0; }
      return;
    }
    // press
    if (s === 'empty') { this.state = 'rec'; this.pos = this.target = 0; }
    else if (s === 'rec') {
      const q = this.quantum, want = q ? Math.max(q, Math.round(this.pos / q) * q) : this.pos;
      if (want > this.pos && want <= this.buf.length) this.target = want; // segue gravando até a batida
      else this.finishRecording(Math.min(want, this.pos));
    }
    else if (s === 'play') { this.undoBuf = this.buf.slice(0, this.len); this.canUndo = true; this.state = 'dub'; }
    else if (s === 'dub') this.state = 'play';
    else if (s === 'stop') { this.state = 'play'; this.pos = 0; }
  }

  finishRecording(len = this.pos) {
    this.target = 0;
    // Menos de 0,1 s é pisada sem querer: volta a vazio.
    if (len < this.sr * 0.1) { this.state = 'empty'; this.len = this.pos = 0; return; }
    this.len = len;
    this.pos = 0;
    this.state = 'play';
    this.undoBuf = null;
    this.canUndo = false;
  }

  process(inp, out) {
    const { buf, level } = this;
    for (let i = 0; i < inp.length; i++) {
      const x = inp[i];
      if (this.state === 'rec') {
        buf[this.pos++] = x;
        out[i] = 0;
        if (this.pos >= buf.length || (this.target && this.pos >= this.target)) this.finishRecording();
      } else if (this.state === 'play' || this.state === 'dub') {
        const y = buf[this.pos];
        if (this.state === 'dub') buf[this.pos] = y + x;
        out[i] = level * y;
        if (++this.pos >= this.len) this.pos = 0;
      } else out[i] = 0;
    }
  }
}
