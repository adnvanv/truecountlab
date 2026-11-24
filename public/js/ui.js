// Small DOM helpers shared by every view.
import { isRed, SUIT_NAMES } from './cards.js';

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') e[k] = !!v;
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

export function money(n) {
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs.toLocaleString(undefined, { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${neg ? '−' : ''}$${s}`;
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

// Discard tray: filled portion = cards already played, ticks every deck.
export function trayEl(dealtCards, totalDecks, { tall = false } = {}) {
  const frac = Math.min(1, dealtCards / (totalDecks * 52));
  const ticks = [];
  for (let i = 1; i < totalDecks; i++) ticks.push(h('div', { class: 'tick', style: `bottom:${(i / totalDecks) * 100}%` }));
  return h('div', { class: tall ? 'tray tall' : 'tray', title: 'Discard tray' },
    h('div', { class: 'stack', style: `height:${frac * 100}%` }), ticks);
}

// Text field for signed integers, with a ± button for phone keypads that lack a minus key.
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

export const typingInField = (e) => e.target instanceof Element && e.target.matches('input, select, textarea');

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
