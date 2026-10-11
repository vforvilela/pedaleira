// Detecção de afinação (YIN) para o afinador.
// Reduz a taxa pela metade antes, o que deixa o cálculo 4× mais barato e ainda cobre do Si grave (31 Hz)
// até ~1,4 kHz.

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// buf: amostras na taxa sampleRate. Devolve a frequência em Hz, ou null se não há nota clara.
export function detectPitch(buf, sampleRate, { minHz = 30, maxHz = 1400, threshold = 0.15 } = {}) {
  const n = buf.length >> 1, sr = sampleRate / 2;
  const x = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = 0.5 * (buf[2 * i] + buf[2 * i + 1]);
    energy += x[i] * x[i];
  }
  if (Math.sqrt(energy / n) < 0.003) return null; // silêncio

  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(sr / minHz));
  const W = n - tauMax;
  if (W < 64) return null;
  const d = new Float32Array(tauMax + 1);

  // Diferença e normalização cumulativa (CMNDF) do YIN.
  let running = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const v = x[i] - x[i + tau];
      sum += v * v;
    }
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  // Primeiro vale abaixo do limiar.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // Interpolação parabólica para precisão abaixo de uma amostra.
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    if (den !== 0) better = tau + (a - c) / (2 * den);
  }
  return sr / better;
}

// Hz → { note: 'A', octave: 4, cents: -3.2 } relativo ao Lá de referência.
export function noteOf(hz, ref = 440) {
  const midi = 69 + 12 * Math.log2(hz / ref);
  const nearest = Math.round(midi);
  return {
    note: NOTES[((nearest % 12) + 12) % 12],
    octave: Math.floor(nearest / 12) - 1,
    cents: (midi - nearest) * 100,
  };
}
