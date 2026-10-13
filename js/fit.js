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

// Trocar o número de fileiras só quando compensa: com mais fileiras os pedais mudam todos de lugar, então só vale
// se ficarem bem maiores. zBest: zoom da melhor arrumação; zKeep: o maior zoom mantendo as fileiras de agora.
// Sem isso, ao redimensionar perto do ponto de troca, os pedais pulam de fileira a cada pixel.
export const ROW_SWITCH_GAIN = 1.08;
export function keepRows(zBest, zKeep, gain = ROW_SWITCH_GAIN) {
  return zKeep > 0 && zKeep * gain >= zBest;
}

// Número de fileiras de uma lista de caixas {top, height} na ordem do fluxo: uma fileira nova começa quando a
// caixa começa abaixo do fundo das caixas da fileira atual (vale para fileiras da esquerda ou da direita).
export function countRows(boxes) {
  let rows = 0, bottom = -Infinity;
  for (const b of boxes) {
    if (b.top >= bottom - 1) { rows++; bottom = b.top + b.height; }
    else bottom = Math.max(bottom, b.top + b.height);
  }
  return rows;
}

// Durante o redimensionamento a arrumação fica congelada (largura w × altura h, em unidades da pedaleira) e só a
// escala acompanha a área: o maior zoom em que ela cabe inteira, nos dois sentidos.
export function frozenZoom(w, h, availW, availH) {
  if (!(w > 0 && h > 0 && availW > 0 && availH > 0)) return 1;
  return Math.min(availW / w, availH / h);
}
