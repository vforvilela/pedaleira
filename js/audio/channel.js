// Interfaces de 2 entradas (Scarlett 2i2, iRig HD 2...) mandam 2 canais e a guitarra fica em só um.
// Misturar os dois tira 6 dB e soma o chiado do pré vazio; pegar só o 1º deixa mudo quem pluga no 2.
// No modo automático, o app ouve os dois e fica com o canal onde a palhetada aparece.

// Picos máximos de cada canal desde que ligou → índice do canal da guitarra, ou null se ainda não dá para saber.
// Precisa de uma palhetada de verdade (> -34 dBFS) e 12 dB de diferença: canais iguais (interface que
// duplica a entrada) nunca decidem e ficam na mistura, como antes.
export function pickChannel(max0, max1, { min = 0.02, ratio = 4 } = {}) {
  const hi = Math.max(max0, max1), lo = Math.min(max0, max1);
  if (hi < min || hi < lo * ratio) return null;
  return max0 > max1 ? 0 : 1;
}
