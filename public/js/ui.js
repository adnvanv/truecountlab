// Small DOM helpers shared by every view.
import { isRed, SUIT_NAMES } from './cards.js';

export function h(tag, attrs = {}, ...kids) {
  const svg = tag.startsWith('svg:');
  const e = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.setAttribute('class', v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (!svg && (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled')) e[k] = k === 'value' ? v : !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const signed = (n) => (n > 0 ? `+${n}` : String(n));
export const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
export const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

export function money(n, { sign = false } = {}) {
  const abs = Math.abs(n);
  const s = abs.toLocaleString(undefined, { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}$${s}`;
}

export function cardEl(card, { down = false, size = '', anim = false } = {}) {
  const cls = ['card'];
  if (size) cls.push(size);
  if (anim) cls.push('deal');
  if (down) {
    cls.push('down');
    return h('div', { class: cls.join(' '), 'aria-label': 'face-down card' });
  }
  cls.push(isRed(card.suit) ? 'red' : 'black');
  const face = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
  const corner = (pos) => h('div', { class: `corner ${pos}` }, h('span', { class: 'r' }, card.rank), h('span', { class: 's' }, card.suit));
  return h('div', { class: cls.join(' '), role: 'img', 'aria-label': `${card.rank} of ${SUIT_NAMES[card.suit]}` },
    corner('tl'),
    h('div', { class: face ? 'pip face' : 'pip' }, face ? card.rank : card.suit),
    corner('br'));
}

// Discard tray: filled portion = cards played. Major ticks every deck, minor every half deck.
export function trayEl(dealtCards, totalDecks, { tall = false, labels = false } = {}) {
  const frac = Math.min(1, dealtCards / (totalDecks * 52));
  const ticks = [];
  for (let i = 1; i < totalDecks * 2; i++) {
    const major = i % 2 === 0;
    ticks.push(h('div', { class: major ? 'tick' : 'tick minor', style: `bottom:${(i / (totalDecks * 2)) * 100}%` },
      labels && major ? h('span', {}, String(i / 2)) : null));
  }
  return h('div', { class: tall ? 'tray tall' : 'tray', title: 'Discard tray' },
    h('div', { class: 'stack', style: `height:${frac * 100}%` }), ticks);
}

// Text field for signed integers, with ± for phone keypads that lack a minus key.
export function numberField(placeholder = '') {
  const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'num', placeholder, 'aria-label': placeholder });
  const flip = h('button', {
    type: 'button', class: 'btn sign', title: 'Toggle sign', 'aria-label': 'Toggle sign',
    onclick: () => {
      const v = input.value.trim();
      input.value = v.startsWith('-') ? v.slice(1) : `-${v.replace(/^\+/, '')}`;
      input.focus();
    },
  }, '±');
  return {
    el: h('div', { class: 'numfield' }, flip, input),
    input,
    get value() {
      const n = parseInt(input.value.replace('−', '-'), 10);
      return Number.isNaN(n) ? null : n;
    },
  };
}

export const head = (title, sub) => h('header', { class: 'view-head' }, h('h1', {}, title), sub ? h('p', { class: 'sub' }, sub) : null);
export const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
export function select(options, value, onChange) {
  return h('select', { onchange: (e) => onChange(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
}
export const toggle = (obj, key, label, onChange) => h('label', { class: 'check-opt' },
  h('input', { type: 'checkbox', checked: obj[key], onchange: (e) => { obj[key] = e.target.checked; onChange?.(); } }), label);

export const typingInField = (e) => e.target instanceof Element && e.target.matches('input, select, textarea');

/**
 * Line chart.
 * @param {{ name: string, color: string, points: { x: number, y: number }[] }[]} series
 * @param {{ height?: number, yFmt?: (v: number) => string, xFmt?: (x: number) => string, zero?: boolean, yMin?: number, yMax?: number }} [opts]
 */
export function lineChart(series, { height = 160, yFmt = (v) => String(v), xFmt = (x) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), zero = false, yMin, yMax } = {}) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return h('div', { class: 'chart-empty muted' }, 'No data yet — keep practicing.');
  const W = 600;
  const H = height;
  const pad = { l: 46, r: 12, t: 10, b: 24 };
  let x0 = Math.min(...pts.map((p) => p.x));
  let x1 = Math.max(...pts.map((p) => p.x));
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  let y0 = yMin ?? Math.min(...pts.map((p) => p.y), zero ? 0 : Infinity);
  let y1 = yMax ?? Math.max(...pts.map((p) => p.y), zero ? 0 : -Infinity);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const X = (x) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const grid = [y0, (y0 + y1) / 2, y1].map((y) => [
    h('svg:line', { x1: pad.l, x2: W - pad.r, y1: Y(y), y2: Y(y), class: 'grid' }),
    h('svg:text', { x: pad.l - 6, y: Y(y) + 4, 'text-anchor': 'end', class: 'axis' }, yFmt(Math.round(y))),
  ]);
  const zeroLine = zero && y0 < 0 && y1 > 0 ? h('svg:line', { x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0), class: 'zero' }) : null;
  const lines = series.filter((s) => s.points.length).map((s) => [
    h('svg:polyline', { points: s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    s.points.map((p) => h('svg:circle', { cx: X(p.x), cy: Y(p.y), r: 3.5, fill: s.color }, h('svg:title', {}, `${s.name}: ${yFmt(p.y)} · ${xFmt(p.x)}`))),
  ]);
  const xLabels = [x0, x1].map((x, i) => h('svg:text', { x: X(x), y: H - 6, 'text-anchor': i ? 'end' : 'start', class: 'axis' }, xFmt(x)));
  return h('div', { class: 'linechart' },
    h('svg:svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': series.map((s) => s.name).join(', ') }, grid, zeroLine, lines, xLabels),
    series.length > 1 ? h('div', { class: 'chart-legend' }, series.map((s) => h('span', {}, h('i', { style: `background:${s.color}` }), s.name))) : null);
}

// Accuracy per day from runs [{t, ok}].
export function dailyAccuracy(runs) {
  const days = new Map();
  for (const r of runs) {
    const d = new Date(r.t);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const e = days.get(key) || { n: 0, ok: 0, ms: 0, msN: 0 };
    e.n++;
    if (r.ok) e.ok++;
    if (r.ms) { e.ms += r.ms; e.msN++; }
    days.set(key, e);
  }
  return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([x, e]) => ({ x, acc: (100 * e.ok) / e.n, ms: e.msN ? e.ms / e.msN : null, n: e.n }));
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
