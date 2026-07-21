// Chart + section renderers. Zero dependencies — hand-rolled SVG.
// Every chart here is single-series (one person's watching), so one amber
// carries all marks; identity comes from labels, not hue. Tooltips on marks.

const SVGNS = 'http://www.w3.org/2000/svg';
const AMBER = '#e6a648';
// Sequential ramp for the heatmap (monotonic lightness, validated on dark).
const RAMP = ['#4a3517', '#7d5a24', '#b28031', '#e6a648'];

const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

export const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// ---------- tooltip ----------
let tip;
export function initTip() {
  tip = document.createElement('div');
  tip.id = 'tip';
  document.body.appendChild(tip);
}
function bindTip(node, text) {
  node.addEventListener('mousemove', (e) => {
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 240) + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
  });
  node.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}

export function stars(r) {
  if (!r) return '';
  return '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');
}

// ---------- vertical bar chart ----------
// items: [{label, value, tipText?, valueLabel?}]. Direct labels only when few bars.
export function vBars(items, { height = 190, labelEvery = 1 } = {}) {
  const wrap = h('div', 'chart');
  const W = 640, H = height, padB = 22, padT = 16;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const max = Math.max(1, ...items.map((d) => d.value));
  const n = items.length;
  const gap = 2;                                  // surface gap between bars
  const bw = Math.min(56, (W - gap * n) / n);
  const totalW = n * bw + (n - 1) * gap;
  const x0 = (W - totalW) / 2;
  const showVals = n <= 12;

  items.forEach((d, i) => {
    const bh = Math.max(d.value > 0 ? 3 : 0, ((H - padB - padT) * d.value) / max);
    const x = x0 + i * (bw + gap);
    const y = H - padB - bh;
    const bar = el('rect', { class: 'bar', x, y, width: bw, height: bh, rx: 3 });
    bindTip(bar, d.tipText || `${d.label} — ${d.value}`);
    svg.appendChild(bar);
    if (i % labelEvery === 0) {
      svg.appendChild(el('text', { class: 'axis', x: x + bw / 2, y: H - 7, 'text-anchor': 'middle' }, d.label));
    }
    if (showVals && d.value > 0) {
      svg.appendChild(el('text', { class: 'val', x: x + bw / 2, y: y - 5, 'text-anchor': 'middle' }, d.valueLabel ?? String(d.value)));
    }
  });
  wrap.appendChild(svg);
  return wrap;
}

// ---------- horizontal bars (genres) ----------
export function hBars(items) {
  const wrap = h('div', 'chart');
  const W = 640, rowH = 28, padL = 132, padR = 78;
  const H = items.length * rowH + 6;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const max = Math.max(1, ...items.map((d) => d.value));
  items.forEach((d, i) => {
    const y = i * rowH + 5;
    const bw = Math.max(3, ((W - padL - padR) * d.value) / max);
    svg.appendChild(el('text', { class: 'axis', x: padL - 10, y: y + 13, 'text-anchor': 'end' }, d.label));
    const bar = el('rect', { class: 'bar', x: padL, y, width: bw, height: rowH - 10, rx: 3 });
    bindTip(bar, d.tipText || `${d.label} — ${d.value}`);
    svg.appendChild(bar);
    svg.appendChild(el('text', { class: 'val', x: padL + bw + 8, y: y + 13 }, d.valueLabel ?? String(d.value)));
  });
  wrap.appendChild(svg);
  return wrap;
}

// ---------- calendar heatmap ----------
// opts.weeks pins the grid width — pass the same value for every strip so
// year-over-year cells share one scale (a partial year just ends early).
export function heatmap(byDate, opts = {}) {
  const wrap = h('div', 'heatmap');
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return wrap;
  const cell = 11, gapPx = 2, padL = 38, padT = 24;
  const first = new Date(dates[0] + 'T12:00:00Z');
  const startCol = (first.getUTCDay() + 6) % 7; // Monday-first
  const weeks = opts.weeks || Math.ceil((dates.length + startCol) / 7);
  const W = padL + weeks * (cell + gapPx) + 4;
  const H = padT + 7 * (cell + gapPx) + 6;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const max = Math.max(1, ...Object.values(byDate));

  ['Mon', 'Wed', 'Sun'].forEach((d, i) => {
    svg.appendChild(el('text', { class: 'axis', x: 2, y: padT + [0, 2, 6][i] * (cell + gapPx) + 9 }, d));
  });

  let seenMonth = '';
  dates.forEach((ds, i) => {
    const idx = i + startCol;
    const col = Math.floor(idx / 7), row = idx % 7;
    const x = padL + col * (cell + gapPx), y = padT + row * (cell + gapPx);
    const v = byDate[ds];
    let attrs = { x, y, width: cell, height: cell, rx: 2 };
    if (v === 0) attrs.class = 'cell-0';
    else attrs.fill = RAMP[Math.min(RAMP.length - 1, Math.ceil((v / max) * RAMP.length) - 1)];
    const r = el('rect', attrs);
    const names = v > 0 && opts.titles?.get(ds);
    bindTip(r, `${ds} — ${v} film${v === 1 ? '' : 's'}${names ? ': ' + names.join(', ') : ''}`);
    svg.appendChild(r);
    const m = ds.slice(0, 7);
    if (m !== seenMonth && row === 0) {
      seenMonth = m;
      svg.appendChild(el('text', { class: 'axis', x, y: 13 },
        new Date(ds + 'T12:00:00Z').toLocaleString('en', { month: 'short', timeZone: 'UTC' })));
    }
  });
  wrap.appendChild(svg);
  return wrap;
}

// ---------- calibration scatter (you vs the crowd) ----------
export function scatterChart(points, opts = {}) {
  const wrap = h('div', 'chart scatter');
  const W = 640, H = 340, padL = 42, padB = 32, padT = 14, padR = 16;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const sx = (v) => padL + ((v - 0.5) / 4.5) * (W - padL - padR);
  const sy = (v) => H - padB - ((v - 0.5) / 4.5) * (H - padT - padB);
  for (let g = 1; g <= 5; g++) {
    svg.appendChild(el('line', { class: 'gridline', x1: sx(g), y1: padT, x2: sx(g), y2: H - padB }));
    svg.appendChild(el('line', { class: 'gridline', x1: padL, y1: sy(g), x2: W - padR, y2: sy(g) }));
    svg.appendChild(el('text', { class: 'axis', x: sx(g), y: H - 12, 'text-anchor': 'middle' }, `${g}★ crowd`));
    svg.appendChild(el('text', { class: 'axis', x: padL - 8, y: sy(g) + 3, 'text-anchor': 'end' }, `${g}★`));
  }
  // the agreement line
  svg.appendChild(el('line', {
    x1: sx(0.5), y1: sy(0.5), x2: sx(5), y2: sy(5),
    stroke: 'currentColor', opacity: 0.25, 'stroke-width': 1.5, 'stroke-dasharray': '5 5',
  }));
  // ratings sit on a half-star grid — deterministic jitter keeps stacks hoverable
  points.forEach((p, i) => {
    const jx = (((i * 7) % 11) - 5) * 1.1;
    const jy = (((i * 13) % 9) - 4) * 1.1;
    const dot = el('circle', {
      cx: sx(p.crowd) + jx, cy: sy(p.mine) + jy, r: 4.5,
      fill: AMBER, 'fill-opacity': 0.7,
    });
    bindTip(dot, `${p.t} (${p.y}) — you ${p.mine}★ · crowd ${p.crowd}★`);
    const href = opts.href?.(p);
    if (href) {
      const a = el('a');
      a.setAttribute('href', href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      dot.setAttribute('style', 'cursor: pointer');
      a.appendChild(dot);
      svg.appendChild(a);
    } else {
      svg.appendChild(dot);
    }
  });
  // number the biggest disagreements on-chart; name them below it, where
  // labels can't collide with each other or the axes
  const outliers = [...points]
    .map((p) => ({ ...p, delta: Math.abs(p.mine - p.crowd) }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 4)
    .filter((p) => p.delta >= 1);
  outliers.forEach((p, i) => {
    const cx = sx(p.crowd), cy = sy(p.mine);
    svg.appendChild(el('circle', { cx, cy, r: 8, fill: 'none', stroke: AMBER, 'stroke-width': 1.5 }));
    svg.appendChild(el('text', {
      class: 'val', x: cx, y: cy + 3.5, 'text-anchor': 'middle', 'font-weight': 700,
    }, String(i + 1)));
  });
  wrap.appendChild(svg);
  if (outliers.length) {
    const cap = h('div', 'scatter-caption');
    outliers.forEach((p, i) => {
      cap.appendChild(h('span', null,
        `${i + 1} · ${p.t} (${p.y}) — you ${p.mine}★, crowd ${p.crowd}★`));
    });
    wrap.appendChild(cap);
  }
  return wrap;
}

// ---------- ranked list ----------
export function ranked(items, fmtExtra) {
  const ol = h('ol', 'ranked');
  items.forEach((d, i) => {
    const li = h('li');
    li.appendChild(h('span', 'n', String(i + 1).padStart(2, '0')));
    li.appendChild(h('span', 'name', d.name));
    if (fmtExtra) {
      const extra = fmtExtra(d);
      if (extra) li.appendChild(h('span', 'extra', extra));
    }
    li.appendChild(h('span', 'count', `×${d.count}`));
    ol.appendChild(li);
  });
  return ol;
}

export function callout(k, v, s, neg = false) {
  const c = h('div', 'callout' + (neg ? ' neg' : ''));
  c.appendChild(h('p', 'k', k));
  c.appendChild(h('p', 'v', v));
  if (s) c.appendChild(h('p', 's', s));
  return c;
}

export function tile(k, v, s, { animate = true } = {}) {
  const t = h('div', 'tile');
  t.appendChild(h('p', 'k', k));
  const vEl = h('p', 'v', v);
  if (animate && /^\d[\d,]*$/.test(v)) vEl.dataset.count = v.replace(/,/g, '');
  t.appendChild(vEl);
  if (s) t.appendChild(h('p', 's', s));
  return t;
}

let blockNo = 0;
export function resetBlockCounter() { blockNo = 0; }

export function block(title, note) {
  const s = h('section', 'block');
  const head = h('div', 'block-head');
  const h3 = h('h3');
  h3.appendChild(h('span', 'reelno', `Reel ${String(++blockNo).padStart(2, '0')}`));
  h3.appendChild(document.createTextNode(title));
  head.appendChild(h3);
  head.appendChild(h('div', 'rule'));
  if (note) head.appendChild(h('span', 'note', note));
  s.appendChild(head);
  return s;
}

// ---------- the map of world cinema ----------
// paths: {countryName: svgPathD}, view: [w, h], filmsBy: {countryName: [{t,y,r}]}
// TMDB names that differ from the map's Natural Earth names:
const MAP_ALIASES = {
  'United States': 'United States of America',
  Czechia: 'Czech Republic', Czechoslovakia: 'Czech Republic',
  'Soviet Union': 'Russia', Serbia: 'Republic of Serbia',
  'North Macedonia': 'Macedonia', Tanzania: 'United Republic of Tanzania',
  'East Germany': 'Germany', 'West Germany': 'Germany',
};
export function worldMap(paths, view, filmsBy, onPick) {
  const wrap = h('div', 'chart worldmap');
  const svg = el('svg', { viewBox: `0 0 ${view[0]} ${view[1]}`, role: 'img' });
  const byMapName = new Map();
  for (const [c, films] of Object.entries(filmsBy)) {
    const key = MAP_ALIASES[c] || c;
    if (!paths[key]) continue;
    const cur = byMapName.get(key) || [];
    byMapName.set(key, cur.concat(films));
  }
  const max = Math.max(1, ...[...byMapName.values()].map((f) => f.length));
  for (const [name, d] of Object.entries(paths)) {
    const films = byMapName.get(name);
    const p = el('path', { d, class: films ? 'land lit' : 'land' });
    if (films) {
      // log ramp so 1 film still glows and 233 doesn't blow out the scale
      p.style.fillOpacity = (0.25 + 0.75 * (Math.log(1 + films.length) / Math.log(1 + max))).toFixed(2);
      bindTip(p, `${name} — ${films.length} film${films.length === 1 ? '' : 's'}`);
      p.addEventListener('click', () => onPick(name, films));
    } else {
      bindTip(p, `${name} — unscreened`);
    }
    svg.appendChild(p);
  }
  wrap.appendChild(svg);
  const unmapped = Object.keys(filmsBy).filter((c) => !paths[MAP_ALIASES[c] || c]);
  return { node: wrap, lit: byMapName.size, unmapped };
}

// ---------- the century strip ----------
// years: [{y, n, top}] — one column per year 1895→now, era bands beneath.
const ERAS = [
  [1895, 1926, 'silents'], [1927, 1933, 'pre-Code'], [1934, 1945, 'golden age'],
  [1946, 1958, 'noir & neorealism'], [1959, 1967, 'new waves'], [1968, 1980, 'New Hollywood'],
  [1981, 1989, 'high concept'], [1990, 1999, 'indies'], [2000, 2009, 'world cinema'],
  [2010, 2019, 'streaming'], [2020, 9999, 'now'],
];
export function centuryStrip(years, endYear) {
  const byYear = new Map(years.map((r) => [r.y, r]));
  const first = 1895;
  const colW = 9, dotR = 2.6, dotGap = 7, padB = 62, padT = 12;
  const n = endYear - first + 1;
  const W = n * colW, maxN = Math.max(1, ...years.map((r) => r.n));
  const H = padT + Math.min(maxN, 18) * dotGap + padB;
  const outer = h('div', 'century-scroll');
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  svg.style.width = `${W}px`;
  svg.style.height = '100%';
  const base = H - padB; // dots sit above this line, the ruler below it
  svg.appendChild(el('line', { class: 'century-base', x1: 0, y1: base, x2: W, y2: base }));
  let band = 0;
  for (const [a, b, label] of ERAS) {
    const x = (Math.max(a, first) - first) * colW;
    const w = (Math.min(b, endYear) - Math.max(a, first) + 1) * colW;
    if (w <= 0) continue;
    // era ribbon lives in the footer, under the decade ticks — one label row,
    // centered in its own band; a name that can't fit stays tooltip-only
    const ribbon = el('rect', { class: `era era-${band % 2}`, x: x + 0.5, y: base + 24, width: w - 1, height: 18 });
    bindTip(ribbon, `${label} · ${Math.max(a, first)}–${b === 9999 ? 'now' : b}`);
    svg.appendChild(ribbon);
    if (label.length * 6.2 <= w - 8) {
      svg.appendChild(el('text', {
        class: 'era-label', x: x + w / 2, y: base + 36, 'text-anchor': 'middle',
      }, label));
    }
    band++;
  }
  for (let y = first; y <= endYear; y++) {
    const x = (y - first) * colW + colW / 2;
    if (y % 10 === 0) {
      svg.appendChild(el('text', { class: 'axis', x, y: base + 14, 'text-anchor': 'middle' }, `’${String(y).slice(2)}`));
    }
    const row = byYear.get(y);
    if (!row) continue;
    const shown = Math.min(row.n, 18);
    for (let i = 0; i < shown; i++) {
      svg.appendChild(el('circle', {
        class: 'century-dot', cx: x, cy: base - 8 - i * dotGap, r: dotR,
      }));
    }
    const hit = el('rect', { x: x - colW / 2, y: 0, width: colW, height: base, fill: 'transparent' });
    bindTip(hit, `${y} — ${row.n} film${row.n === 1 ? '' : 's'} · best: ${row.top}`);
    svg.appendChild(hit);
  }
  outer.appendChild(svg);
  // the biggest hole between the first film year with anything and today
  let gap = null, run = 0, runStart = 0;
  for (let y = first; y <= endYear; y++) {
    if (!byYear.has(y)) { if (!run) runStart = y; run++; }
    else { if (!gap || run > gap.len) gap = { from: runStart, to: y - 1, len: run }; run = 0; }
  }
  if (run && (!gap || run > gap.len)) gap = { from: runStart, to: endYear, len: run };
  return { node: outer, gap };
}
