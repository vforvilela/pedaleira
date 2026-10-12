// Looper amostra a amostra (roda no AudioWorklet e nos testes de unidade).
// Pisada: vazio → grava → toca → sobrepõe → toca → … ; parado → toca. STOP para; APAGAR esvazia.
// A saída é o sinal que entra mais o loop (no volume LEVEL).

export class Looper {
  constructor(sampleRate, maxSeconds = 120) {
    this.sr = sampleRate;
    this.buf = new Float32Array(Math.round(sampleRate * maxSeconds));
    this.len = 0;
    this.pos = 0;
    this.level = 1;
    this.state = 'empty';
  }

  command(cmd) {
    const s = this.state;
    if (cmd === 'clear') { this.state = 'empty'; this.len = this.pos = 0; return; }
    if (cmd === 'stop') {
      if (s === 'rec') this.finishRecording();
      if (this.len) { this.state = 'stop'; this.pos = 0; }
      return;
    }
    // press
    if (s === 'empty') { this.state = 'rec'; this.pos = 0; }
    else if (s === 'rec') this.finishRecording();
    else if (s === 'play') this.state = 'dub';
    else if (s === 'dub') this.state = 'play';
    else if (s === 'stop') { this.state = 'play'; this.pos = 0; }
  }

  finishRecording() {
    // Menos de 0,1 s é pisada sem querer: volta a vazio.
    if (this.pos < this.sr * 0.1) { this.state = 'empty'; this.len = this.pos = 0; return; }
    this.len = this.pos;
    this.pos = 0;
    this.state = 'play';
  }

  process(inp, out) {
    const { buf, level } = this;
    for (let i = 0; i < inp.length; i++) {
      const x = inp[i];
      if (this.state === 'rec') {
        buf[this.pos++] = x;
        out[i] = x;
        if (this.pos >= buf.length) this.finishRecording();
      } else if (this.state === 'play' || this.state === 'dub') {
        const y = buf[this.pos];
        if (this.state === 'dub') buf[this.pos] = y + x;
        out[i] = x + level * y;
        if (++this.pos >= this.len) this.pos = 0;
      } else out[i] = x;
    }
  }
}
