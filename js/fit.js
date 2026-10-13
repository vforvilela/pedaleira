// Busca do encaixe da pedaleira na tela, sem DOM: quem chama passa a medição como função.
// Separado de board.js para testar sem navegador.

// Maior zoom entre min e max em que fits(z) é verdade (fits é monótona: se cabe com z, cabe com menos).
// Nada cabe: devolve min (a área da pedaleira rola). Arredonda para baixo em centésimos.
export function largestZoom(fits, min, max, steps = 7) {
  if (fits(max)) return max;
  if (!fits(min)) return min;
  let lo = min, hi = max;
  for (let i = 0; i < steps; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  return Math.floor(lo * 100) / 100;
}

// Maior aperto lateral (px) entre 0 e max em que keeps(px) é verdade: o número de fileiras não muda.
export function largestSqueeze(keeps, max, steps = 8) {
  let lo = 0, hi = Math.max(0, max);
  for (let i = 0; i < steps; i++) { const m = (lo + hi) / 2; if (keeps(m)) lo = m; else hi = m; }
  return Math.floor(lo);
}
