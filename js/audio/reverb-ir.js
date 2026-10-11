// Gera respostas ao impulso sintéticas para o reverb, por tipo de sala.
// Ruído com decaimento exponencial, escurecendo com o tempo (o ar absorve mais agudo).

export const ROOMS = {
  ROOM:   { min: 0.3, max: 1.6,  pre: 0.004, brightStart: 0.85, brightEnd: 0.35, early: 6 },
  HALL:   { min: 1.0, max: 6.0,  pre: 0.02,  brightStart: 0.75, brightEnd: 0.2,  early: 8 },
  PLATE:  { min: 0.7, max: 4.0,  pre: 0.0,   brightStart: 0.95, brightEnd: 0.6,  early: 0 },
  SPRING: { min: 0.8, max: 3.0,  pre: 0.0,   brightStart: 0.7,  brightEnd: 0.4,  early: 0, spring: true },
  CHURCH: { min: 2.5, max: 10.0, pre: 0.03,  brightStart: 0.6,  brightEnd: 0.12, early: 10 },
};

// decay: 0..10 (posição do botão). Devolve { length, channels: [Float32Array, Float32Array] }.
export function makeIR(sampleRate, room, decay, seed = 7) {
  const r = ROOMS[room] || ROOMS.HALL;
  const t60 = r.min * Math.pow(r.max / r.min, decay / 10);
  const pre = Math.round(r.pre * sampleRate);
  const length = pre + Math.round(t60 * 1.1 * sampleRate);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const channels = [new Float32Array(length), new Float32Array(length)];

  for (const ch of channels) {
    let lp = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.pow(10, (-3 * t) / t60); // -60 dB em t60
      // Coeficiente do passa-baixa de 1 polo, do brilho inicial para o final.
      const frac = Math.min(1, t / t60);
      const a = r.brightStart + (r.brightEnd - r.brightStart) * frac;
      lp += a * (rnd() - lp);
      ch[i] = lp * env;
    }
    // Primeiras reflexões: alguns impulsos esparsos nos primeiros 60 ms.
    for (let e = 0; e < r.early; e++) {
      const at = pre + Math.round((0.005 + Math.abs(rnd()) * 0.055) * sampleRate);
      if (at < length) ch[at] += rnd() * 0.6 * (1 - e / (r.early + 1));
    }
    // Mola: ecos curtos e regulares que dão o "boing" característico.
    if (r.spring) {
      const period = Math.round(0.029 * sampleRate);
      for (let i = length - 1; i >= period; i--) ch[i] += 0.55 * ch[i - period];
    }
  }

  // Normaliza pela energia para o volume não mudar muito entre salas.
  let energy = 0;
  for (const ch of channels) for (const v of ch) energy += v * v;
  const g = 1 / Math.sqrt(energy / 2 || 1) * 0.5;
  for (const ch of channels) for (let i = 0; i < length; i++) ch[i] *= g;
  return { length, channels };
}
