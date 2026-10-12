// Desenha cada pedal em SVG (réplica desenhada) e liga botões, chaves e footswitch.
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

function text(parent, x, y, str, attrs = {}) {
  const t = el('text', { x, y, 'text-anchor': 'middle', ...attrs }, parent);
  t.textContent = str;
  return t;
}

const SIZES = { compact: [140, 250], stomp: [140, 250], amp: [250, 160], treadle: [140, 270] };

// Ângulo do ponteiro: botão contínuo vai de -135° a 135°; chave seletora espalha as posições.
const knobAngle = (c, v) =>
  c.type === 'select' ? -120 + (240 * v) / Math.max(1, c.options.length - 1) : -135 + 27 * v;

// hit: raio da área de toque (unidades do SVG ≈ px); no mínimo 20, o que dá ~44 px na tela.
function drawKnob(svg, c, x, y, r, ink, hit = Math.max(r + 6, 20)) {
  const g = el('g', {
    class: 'knob', tabindex: 0, role: 'slider', 'aria-label': c.label, 'data-param': c.id,
    'aria-valuemin': 0, 'aria-valuemax': c.type === 'select' ? c.options.length - 1 : 10,
  }, svg);
  text(g, x, y - r - 7, c.label, { class: 'klabel', fill: ink, 'font-size': r >= 13 ? 10 : 8.5 });
  el('circle', { cx: x, cy: y + 1.5, r: r + 2.5, fill: 'rgba(0,0,0,.35)' }, g);
  el('circle', { cx: x, cy: y, r: r + 2, fill: '#2a2a2a' }, g);
  el('circle', { cx: x, cy: y, r, fill: 'url(#knobGrad)' }, g);
  const ptr = el('g', {}, g);
  el('line', { x1: x, y1: y - r * 0.2, x2: x, y2: y - r + 2, stroke: '#f5f5f5', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, ptr);
  const val = c.type === 'select' ? text(g, x, y + r + 11, '', { class: 'kval', fill: ink, 'font-size': 8 }) : null;
  el('circle', { cx: x, cy: y, r: hit, fill: 'transparent' }, g); // área de toque maior que o botão
  return {
    g,
    render(v) {
      ptr.setAttribute('transform', `rotate(${knobAngle(c, v)} ${x} ${y})`);
      g.setAttribute('aria-valuenow', v);
      g.setAttribute('aria-valuetext', c.type === 'select' ? c.options[v] : v.toFixed(1));
      if (val) val.textContent = c.options[v];
    },
  };
}

// Fader vertical (equalizador gráfico). Centro = 0 dB nos controles bipolares.
function drawSlider(svg, c, x, y0, y1, ink) {
  const g = el('g', {
    class: 'knob slider', tabindex: 0, role: 'slider', 'aria-label': c.label, 'data-param': c.id,
    'aria-valuemin': 0, 'aria-valuemax': 10,
  }, svg);
  el('rect', { x: x - 7, y: y0 - 4, width: 14, height: y1 - y0 + 8, fill: 'transparent' }, g); // área de toque
  el('rect', { x: x - 1.5, y: y0, width: 3, height: y1 - y0, rx: 1.5, fill: '#111' }, g);
  if (c.bipolar) el('line', { x1: x - 5, x2: x + 5, y1: (y0 + y1) / 2, y2: (y0 + y1) / 2, stroke: ink, 'stroke-width': 0.6, opacity: 0.6 }, g);
  const cap = el('rect', { x: x - 5, y: 0, width: 10, height: 6, rx: 1, fill: '#e8e8e8', stroke: '#333', 'stroke-width': 0.6 }, g);
  text(g, x, y1 + 10, c.label, { class: 'klabel', fill: ink, 'font-size': 5.2 });
  return {
    g,
    render(v) {
      cap.setAttribute('y', y1 - ((y1 - y0) * v) / 10 - 3);
      g.setAttribute('aria-valuenow', v);
      g.setAttribute('aria-valuetext', v.toFixed(1));
    },
  };
}

// Pedal de expressão (wah, volume): arrastar o pedal para cima e para baixo. O ponteiro na lateral mostra a posição.
function drawTreadle(svg, c, W, look) {
  const g = el('g', {
    class: 'knob treadle', tabindex: 0, role: 'slider', 'aria-label': c.label, 'data-param': c.id,
    'aria-valuemin': 0, 'aria-valuemax': 10,
  }, svg);
  el('rect', { x: 14, y: 16, width: W - 28, height: 176, rx: 8, fill: '#151515', stroke: '#000' }, g);
  for (let y = 26; y < 186; y += 8) el('line', { x1: 22, x2: W - 22, y1: y, y2: y, stroke: '#262626', 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
  text(g, W / 2, 112, look.plate || '', { class: 'pedal-name script', fill: look.accent, 'font-size': 22 });
  el('rect', { x: W - 10, y: 22, width: 3, height: 164, rx: 1.5, fill: '#000' }, g);
  const ptr = el('path', { d: 'M0 0 l-6 -4 v8 z', fill: look.accent }, g);
  return {
    g,
    render(v) {
      ptr.setAttribute('transform', `translate(${W - 10} ${186 - 16.4 * v})`);
      g.setAttribute('aria-valuenow', v);
      g.setAttribute('aria-valuetext', v.toFixed(1));
    },
  };
}

// Gradientes compartilhados por todos os pedais: um SVG escondido na página, criado uma vez.
export function installDefs() {
  const host = el('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute' });
  document.body.append(host);
  const d = el('defs', {}, host);
  const kg = el('radialGradient', { id: 'knobGrad', cx: '40%', cy: '35%', r: '70%' }, d);
  el('stop', { offset: '0%', 'stop-color': '#4a4a4a' }, kg);
  el('stop', { offset: '100%', 'stop-color': '#0d0d0d' }, kg);
  const mg = el('linearGradient', { id: 'metalGrad', x1: 0, y1: 0, x2: 1, y2: 1 }, d);
  el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0.55 }, mg);
  el('stop', { offset: '50%', 'stop-color': '#fff', 'stop-opacity': 0 }, mg);
  el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0.25 }, mg);
  const fg = el('radialGradient', { id: 'footGrad', cx: '40%', cy: '35%', r: '65%' }, d);
  el('stop', { offset: '0%', 'stop-color': '#f4f4f4' }, fg);
  el('stop', { offset: '100%', 'stop-color': '#8a8d92' }, fg);
  const tol = el('pattern', { id: 'tolex', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, d);
  el('rect', { width: 4, height: 4, fill: '#1b1b1b' }, tol);
  el('circle', { cx: 1, cy: 1, r: 0.6, fill: '#262626' }, tol);
  el('circle', { cx: 3, cy: 3, r: 0.6, fill: '#121212' }, tol);
}

// Desenha o corpo e devolve { svg, knobs: {id: knob}, led, footswitch }.
function drawPedal(def) {
  const { look } = def;
  const [W, H] = SIZES[look.style];
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: `pedal-svg ${look.style}`, role: 'group', 'aria-label': def.name });
  const knobs = {};
  const footAttrs = { class: 'footswitch', role: 'button', tabindex: 0, 'aria-label': `${def.name}: ligar ou desligar` };
  let led, foot;

  if (look.style === 'amp') {
    el('rect', { x: 1, y: 1, width: W - 2, height: H - 2, rx: 9, fill: 'url(#tolex)', stroke: '#000', 'stroke-width': 2 }, svg);
    el('rect', { x: 1, y: 1, width: W - 2, height: H - 2, rx: 9, fill: 'url(#metalGrad)', opacity: 0.25 }, svg);
    el('rect', { x: 12, y: 14, width: W - 24, height: 78, rx: 4, fill: look.panel, stroke: '#7d6631' }, svg);
    el('rect', { x: 12, y: 14, width: W - 24, height: 78, rx: 4, fill: 'url(#metalGrad)', opacity: 0.6 }, svg);
    const n = def.controls.length;
    def.controls.forEach((c, i) => {
      knobs[c.id] = drawKnob(svg, c, 12 + ((W - 24) * (i + 0.5)) / n, 56, 13, look.ink, Math.min(20, (W - 24) / n / 2));
    });
    text(svg, 26, 128, def.name, { 'text-anchor': 'start', class: 'amp-logo', fill: '#e9e3d0', 'font-size': 24 });
    foot = el('g', footAttrs, svg);
    el('rect', { x: W - 80, y: 100, width: 74, height: 50, fill: 'transparent' }, foot);
    el('rect', { x: W - 70, y: 108, width: 52, height: 30, rx: 4, fill: '#111', stroke: '#333' }, foot);
    led = el('circle', { cx: W - 56, cy: 123, r: 6, class: 'led', stroke: '#000' }, foot);
    text(foot, W - 34, 127, 'ON', { fill: '#bbb', 'font-size': 9, 'font-weight': 700 });
    return { svg, knobs, led, foot, W, H };
  }

  if (look.style === 'treadle') {
    el('rect', { x: 2, y: 2, width: W - 4, height: H - 4, rx: 12, fill: look.body, stroke: 'rgba(0,0,0,.6)', 'stroke-width': 2 }, svg);
    el('rect', { x: 2, y: 2, width: W - 4, height: H - 4, rx: 12, fill: 'url(#metalGrad)', opacity: 0.35 }, svg);
    const [main, ...rest] = def.controls;
    knobs[main.id] = drawTreadle(svg, main, W, look);
    rest.forEach((c, i) => { knobs[c.id] = drawKnob(svg, c, 26 + i * 30, 214, 8, look.ink, 15); });
    led = el('circle', { cx: W - 48, cy: 214, r: 3.6, class: 'led', stroke: 'rgba(0,0,0,.5)' }, svg);
    text(svg, W / 2, 262, look.subtitle, { fill: look.ink, 'font-size': 8, 'letter-spacing': 1.5 });
    foot = el('g', footAttrs, svg);
    el('circle', { cx: W - 26, cy: 228, r: 18, fill: 'transparent' }, foot);
    el('circle', { cx: W - 26, cy: 228, r: 12, fill: '#6d7075', stroke: '#3b3d40', 'stroke-width': 2 }, foot);
    el('circle', { cx: W - 26, cy: 228, r: 8, fill: 'url(#footGrad)', stroke: '#55585c' }, foot);
    return { svg, knobs, led, foot, W, H };
  }

  // Corpo do pedal.
  el('rect', { x: 2, y: 2, width: W - 4, height: H - 4, rx: look.style === 'stomp' ? 14 : 9, fill: look.body, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 2 }, svg);
  el('rect', { x: 2, y: 2, width: W - 4, height: H - 4, rx: look.style === 'stomp' ? 14 : 9, fill: 'url(#metalGrad)', opacity: look.style === 'stomp' ? 0.9 : 0.35 }, svg);

  let display = null;
  if (look.display === 'tuner') {
    // Afinador: visor no alto, chaves pequenas nos cantos de baixo.
    display = drawTunerDisplay(svg, W);
    def.controls.forEach((c, i) => {
      knobs[c.id] = drawKnob(svg, c, i === 0 ? 26 : W - 26, 73, 6.5, look.ink);
    });
  } else if (def.controls.every(c => c.type === 'slider')) {
    // Equalizador gráfico: uma fileira de faders.
    const n = def.controls.length, step = (W - 20) / n;
    def.controls.forEach((c, i) => { knobs[c.id] = drawSlider(svg, c, 10 + step * (i + 0.5), 22, 76, look.ink); });
  } else {
    const n = def.controls.length;
    const r = n > 3 ? 12 : 14.5;
    // Margem nas bordas para os rótulos não encostarem no canto do pedal.
    const pad = n > 3 ? 8 : 4;
    // Área de toque até a metade da distância para o vizinho, senão um botão rouba o toque do outro.
    const hit = Math.max(r + 4, Math.min(20, (W - 2 * pad) / n / 2));
    def.controls.forEach((c, i) => {
      knobs[c.id] = drawKnob(svg, c, pad + ((W - 2 * pad) * (i + 0.5)) / n, 46, c.type === 'select' ? r - 2 : r, look.ink, hit);
    });
  }

  if (look.style === 'compact') {
    // Pedal articulado estilo Boss: a placa inteira é o footswitch.
    led = el('circle', { cx: W / 2, cy: 12, r: 3.6, class: 'led', stroke: 'rgba(0,0,0,.5)' }, svg);
    if (!display) text(svg, W / 2 + 14, 14, 'CHECK', { 'font-size': 5, fill: look.ink, opacity: 0.7, 'aria-hidden': 'true' });
    foot = el('g', footAttrs, svg);
    el('rect', { x: 7, y: 92, width: W - 14, height: 151, rx: 6, fill: 'rgba(0,0,0,.07)', stroke: 'rgba(0,0,0,.25)' }, foot);
    el('rect', { x: 18, y: 100, width: W - 36, height: 70, rx: 4, fill: '#1c1c1c' }, foot);
    for (let y = 106; y < 166; y += 6) el('line', { x1: 22, x2: W - 22, y1: y, y2: y, stroke: '#2c2c2c', 'stroke-width': 2 }, foot);
    text(foot, W / 2, 196, def.name, { class: 'pedal-name', fill: look.ink, 'font-size': 17 });
    el('rect', { x: 12, y: 210, width: W - 24, height: 26, rx: 3, fill: look.strip }, foot);
    text(foot, W / 2, 227, look.subtitle, { fill: look.stripInk, 'font-size': 10, 'font-weight': 700, 'letter-spacing': 0.5 });
  } else {
    // Estilo TC: footswitch redondo de metal.
    led = el('circle', { cx: W / 2, cy: 104, r: 4, class: 'led', stroke: 'rgba(0,0,0,.5)' }, svg);
    text(svg, W / 2, 146, def.name, { class: 'pedal-name script', fill: look.accent, 'font-size': 26 });
    text(svg, W / 2, 162, look.subtitle.toUpperCase(), { fill: look.ink, 'font-size': 8, 'letter-spacing': 2 });
    foot = el('g', footAttrs, svg);
    el('circle', { cx: W / 2, cy: 210, r: 24, fill: 'transparent' }, foot);
    el('circle', { cx: W / 2, cy: 210, r: 17, fill: '#6d7075', stroke: '#3b3d40', 'stroke-width': 2 }, foot);
    el('circle', { cx: W / 2, cy: 210, r: 12, fill: 'url(#footGrad)', stroke: '#55585c' }, foot);
  }
  return { svg, knobs, led, foot, display, W, H };
}

// Visor do afinador: 11 LEDs (centro verde = afinado) e o nome da nota.
function drawTunerDisplay(svg, W) {
  // Sem aria-live: a leitura muda a cada quadro e inundaria o leitor de tela. O rótulo fica atualizado.
  const g = el('g', { class: 'tuner-display', role: 'img', 'aria-label': 'Afinador desligado' }, svg);
  el('rect', { x: 14, y: 19, width: W - 28, height: 37, rx: 3, fill: '#0a0d0b', stroke: 'rgba(0,0,0,.6)' }, g);
  const segs = [];
  const sw = 7, gap = 2.2, total = 11 * sw + 10 * gap, x0 = W / 2 - total / 2;
  for (let i = 0; i < 11; i++)
    segs.push(el('rect', { x: x0 + i * (sw + gap), y: 24, width: sw, height: 7, rx: 1, class: i === 5 ? 'seg mid' : 'seg' }, g));
  const note = text(g, W / 2, 51, '', { class: 'tuner-note', 'font-size': 15 });
  const cents = text(g, W - 19, 51, '', { class: 'tuner-cents', 'text-anchor': 'end', 'font-size': 6.5 });
  return {
    // r: { note, octave, cents } ou null (sem nota). active: afinador ligado.
    set(r, active) {
      g.classList.toggle('active', active);
      const idx = r ? Math.max(0, Math.min(10, Math.round(r.cents / 10) + 5)) : -1;
      const inTune = r && Math.abs(r.cents) < 3;
      segs.forEach((sEl, i) => sEl.classList.toggle('lit', active && (i === idx || (inTune && i === 5))));
      note.textContent = active ? (r ? `${r.note}${r.octave}` : '–') : '';
      note.classList.toggle('ok', !!inTune);
      cents.textContent = active && r ? `${r.cents > 0 ? '+' : ''}${Math.round(r.cents)}¢` : '';
      const label = !active ? 'Afinador desligado' : r ? `Afinador: ${note.textContent} ${cents.textContent}` : 'Afinador: sem nota';
      if (g.getAttribute('aria-label') !== label) g.setAttribute('aria-label', label);
    },
  };
}

// Monta o elemento de um pedal na pedaleira.
// block: { uid, def, on, params, files }; cb: { change, toggle, file, clearFile, remove }
export function pedalView(block, cb) {
  const { def } = block;
  const root = document.createElement('div');
  root.className = `pedal ${def.look.style}`;
  root.dataset.uid = block.uid;
  const { svg, knobs, led, foot, display } = drawPedal(def);
  root.append(svg);

  const caption = document.createElement('div');
  caption.className = 'caption';
  caption.innerHTML = `<span class="pname"></span><span class="inspired"></span><span class="files"></span>`;
  caption.querySelector('.pname').textContent = def.name;
  caption.querySelector('.inspired').textContent = def.inspiredBy ? `inspirado no ${def.inspiredBy}` : '';
  root.append(caption);

  const tools = document.createElement('div');
  tools.className = 'tools';
  const grip = document.createElement('button');
  grip.className = 'grip';
  grip.title = 'Arrastar para mudar a ordem';
  grip.setAttribute('aria-label', 'Arrastar para mudar a ordem');
  grip.textContent = '⠿';
  tools.append(grip);
  for (const [kind, f] of Object.entries(def.files || {})) {
    const b = document.createElement('button');
    b.className = 'file-btn';
    b.dataset.kind = kind;
    b.title = `Carregar ${f.label}`;
    b.textContent = kind.toUpperCase();
    b.onclick = () => cb.file(kind, f.accept);
    tools.append(b);
  }
  if (def.tap) {
    const tap = document.createElement('button');
    tap.className = 'tap-btn';
    tap.title = 'Tap tempo: toque no ritmo da música (atalho: T)';
    tap.textContent = 'TAP';
    tap.onclick = () => cb.tap();
    tools.append(tap);
  }
  for (const a of def.actions || []) {
    const b = document.createElement('button');
    b.className = 'action-btn';
    b.dataset.action = a.id;
    b.title = a.title || a.label;
    b.textContent = a.label;
    b.onclick = () => cb.action(a.id);
    tools.append(b);
  }
  const rm = document.createElement('button');
  rm.className = 'remove';
  rm.title = 'Tirar da pedaleira';
  rm.setAttribute('aria-label', `Tirar ${def.name} da pedaleira`);
  rm.textContent = '✕';
  rm.onclick = () => cb.remove();
  tools.append(rm);
  root.append(tools);

  const update = () => {
    root.classList.toggle('off', !block.on);
    led.classList.toggle('lit', block.on);
    foot.setAttribute('aria-pressed', block.on);
    for (const c of def.controls) knobs[c.id].render(block.params[c.id]);
    const fileSpan = caption.querySelector('.files');
    fileSpan.replaceChildren();
    for (const [kind, f] of Object.entries(block.files || {})) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.title = `Remover ${f.name}`;
      chip.textContent = `${kind.toUpperCase()}: ${f.name} ✕`;
      chip.onclick = () => cb.clearFile(kind);
      fileSpan.append(chip);
      tools.querySelector(`.file-btn[data-kind="${kind}"]`)?.classList.add('has');
    }
    for (const b of tools.querySelectorAll('.file-btn'))
      b.classList.toggle('has', !!block.files?.[b.dataset.kind]);
  };

  // Footswitch.
  const toggle = () => { cb.toggle(); update(); };
  foot.addEventListener('click', toggle);
  foot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

  // Botões: arrastar na vertical (ou horizontal), roda do mouse, setas, duplo clique volta ao padrão.
  const setters = {};
  for (const c of def.controls) {
    const k = knobs[c.id], g = k.g;
    const max = c.type === 'select' ? c.options.length - 1 : 10;
    const setV = v => {
      v = Math.max(0, Math.min(max, v));
      v = c.type === 'select' ? Math.round(v) : Math.round(v * 10) / 10;
      if (v === block.params[c.id]) return;
      block.params[c.id] = v;
      k.render(v);
      cb.change(c.id, v);
    };
    setters[c.id] = setV;
    let drag = null;
    g.addEventListener('pointerdown', e => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.focus({ preventScroll: true });
      drag = { x: e.clientX, y: e.clientY, v: block.params[c.id], moved: false };
      root.classList.add('turning');
    });
    g.addEventListener('pointermove', e => {
      if (!drag) return;
      const d = (drag.y - e.clientY) + (e.clientX - drag.x);
      if (Math.abs(d) > 3) drag.moved = true;
      const per = c.type === 'select' ? 28 : c.type === 'slider' ? 6 : 16; // pixels por unidade
      setV(drag.v + d / per);
    });
    const end = e => {
      // Toque sem arrastar: abre os controles do pedal em tamanho de dedo (o botão desenhado é pequeno demais).
      if (drag && !drag.moved && e.pointerType === 'touch') openKnobSheet(def, block, setters, c.id);
      else if (drag && !drag.moved && c.type === 'select') setV((block.params[c.id] + 1) % (max + 1));
      drag = null;
      root.classList.remove('turning');
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', () => { drag = null; root.classList.remove('turning'); });
    g.addEventListener('dblclick', () => setV(c.default));
    g.addEventListener('wheel', e => {
      e.preventDefault();
      setV(block.params[c.id] + (e.deltaY < 0 ? 1 : -1) * (c.type === 'select' ? 1 : 0.2));
    }, { passive: false });
    g.addEventListener('keydown', e => {
      const step = c.type === 'select' ? 1 : e.shiftKey ? 1 : 0.1;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setV(block.params[c.id] + step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setV(block.params[c.id] - step);
      else return;
      e.preventDefault();
    });
  }

  update();
  const num = document.createElement('span');
  num.className = 'num';
  num.title = 'Tecla do teclado que liga e desliga este pedal';
  root.prepend(num);
  return {
    root, grip, update,
    setDisplay: (r, active) => display?.set(r, active),
    setNumber(n) { num.textContent = n ? String(n) : ''; num.hidden = !n; },
    // Estado próprio do pedal (ex.: looper gravando/tocando): muda a cor do LED e a legenda.
    setState(s, label) {
      root.dataset.state = s || '';
      caption.querySelector('.inspired').textContent = label || (def.inspiredBy ? `inspirado no ${def.inspiredBy}` : '');
    },
  };
}

// Painel de controles em tamanho de dedo: um slider de 44 px por botão do pedal.
// No celular, os botões de um pedal de 4 controles não cabem em 44 px sem se sobrepor; este é o equivalente.
let sheet = null;
function openKnobSheet(def, block, setters, focusId) {
  if (!sheet) {
    sheet = document.createElement('dialog');
    sheet.className = 'knob-sheet';
    sheet.setAttribute('aria-labelledby', 'knobSheetTitle');
    sheet.innerHTML = '<div class="knob-sheet-head"><h2 id="knobSheetTitle"></h2><button class="primary">Pronto</button></div><div class="knob-sheet-rows"></div>';
    sheet.querySelector('button').onclick = () => sheet.close();
    // Toque fora do painel (no fundo escurecido) fecha. pointerdown, não click: o click sintético do próprio
    // toque que abriu o painel cairia no fundo e fecharia na hora.
    sheet.addEventListener('pointerdown', e => {
      const r = sheet.getBoundingClientRect();
      if (e.target === sheet && (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right)) sheet.close();
    });
    document.body.append(sheet);
  }
  sheet.querySelector('h2').textContent = def.name;
  const rows = def.controls.map(c => {
    const max = c.type === 'select' ? c.options.length - 1 : 10;
    const label = document.createElement('label');
    label.className = 'knob-row';
    label.innerHTML = '<span></span><input type="range" min="0"><output></output>';
    label.querySelector('span').textContent = c.label;
    const input = label.querySelector('input'), out = label.querySelector('output');
    input.max = max;
    input.step = c.type === 'select' ? 1 : 0.1;
    input.value = block.params[c.id];
    input.dataset.param = c.id;
    const show = () => { out.textContent = c.type === 'select' ? c.options[+input.value] : (+input.value).toFixed(1); };
    show();
    input.oninput = () => { setters[c.id](+input.value); show(); };
    return label;
  });
  sheet.querySelector('.knob-sheet-rows').replaceChildren(...rows);
  if (!sheet.open) sheet.showModal();
  sheet.querySelector(`input[data-param="${focusId}"]`)?.focus();
}
