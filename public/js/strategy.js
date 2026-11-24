// Basic strategy (multi-deck) and Hi-Lo index plays.
import { rankKey, bjValue } from './cards.js';

export const ACTIONS = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender' };
export const UPCARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const upLabel = (v) => (v === 11 ? 'A' : String(v));
const signed = (n) => (n > 0 ? `+${n}` : String(n));

export function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = bjValue(c.rank);
    total += v;
    if (v === 11) aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

export const isPair = (cards) => cards.length === 2 && rankKey(cards[0].rank) === rankKey(cards[1].rank);
export const isBlackjack = (cards) => cards.length === 2 && handTotal(cards).total === 21;
export const upValue = (card) => bjValue(card.rank);

export function handLabel(cards) {
  const { total, soft } = handTotal(cards);
  if (isPair(cards)) {
    const k = rankKey(cards[0].rank);
    const n = k === 'T' ? '10' : k;
    return `${n},${n}`;
  }
  if (soft) return cards.length === 2 ? `A,${total - 11} (soft ${total})` : `soft ${total}`;
  return `hard ${total}`;
}

// Codes: H hit, S stand, D/Dh double else hit, Ds double else stand,
// P split, Ph split if DAS else hit, Rh/Rs/Rp surrender else hit/stand/split.
const row = (s) => s.trim().split(/\s+/);
//                     2  3  4  5  6  7  8  9  T  A
const BASE = {
  hard: {
    8:  row('H  H  H  H  H  H  H  H  H  H'),
    9:  row('H  D  D  D  D  H  H  H  H  H'),
    10: row('D  D  D  D  D  D  D  D  H  H'),
    11: row('D  D  D  D  D  D  D  D  D  H'),
    12: row('H  H  S  S  S  H  H  H  H  H'),
    13: row('S  S  S  S  S  H  H  H  H  H'),
    14: row('S  S  S  S  S  H  H  H  H  H'),
    15: row('S  S  S  S  S  H  H  H  Rh H'),
    16: row('S  S  S  S  S  H  H  Rh Rh Rh'),
    17: row('S  S  S  S  S  S  S  S  S  S'),
  },
  soft: {
    12: row('H  H  H  H  H  H  H  H  H  H'),
    13: row('H  H  H  Dh Dh H  H  H  H  H'),
    14: row('H  H  H  Dh Dh H  H  H  H  H'),
    15: row('H  H  Dh Dh Dh H  H  H  H  H'),
    16: row('H  H  Dh Dh Dh H  H  H  H  H'),
    17: row('H  Dh Dh Dh Dh H  H  H  H  H'),
    18: row('S  Ds Ds Ds Ds S  S  H  H  H'),
    19: row('S  S  S  S  S  S  S  S  S  S'),
    20: row('S  S  S  S  S  S  S  S  S  S'),
  },
  pair: {
    A: row('P  P  P  P  P  P  P  P  P  P'),
    T: row('S  S  S  S  S  S  S  S  S  S'),
    9: row('P  P  P  P  P  S  P  P  S  S'),
    8: row('P  P  P  P  P  P  P  P  P  P'),
    7: row('P  P  P  P  P  P  H  H  H  H'),
    6: row('Ph P  P  P  P  H  H  H  H  H'),
    4: row('H  H  H  Ph Ph H  H  H  H  H'),
    3: row('Ph Ph P  P  P  P  H  H  H  H'),
    2: row('Ph Ph P  P  P  P  H  H  H  H'),
  },
};

const cache = {};
export function tablesFor(rules) {
  const key = rules.h17 ? 'h17' : 's17';
  if (cache[key]) return cache[key];
  const tb = structuredClone(BASE);
  if (rules.h17) {
    tb.hard[11][9] = 'D';
    tb.hard[15][9] = 'Rh';
    tb.hard[17][9] = 'Rs';
    tb.soft[18][0] = 'Ds';
    tb.soft[19][4] = 'Ds';
    tb.pair['8'][9] = 'Rp';
  }
  return (cache[key] = tb);
}

export function resolveCode(code, o) {
  switch (code) {
    case 'D': case 'Dh': return o.canDouble ? 'D' : 'H';
    case 'Ds': return o.canDouble ? 'D' : 'S';
    case 'Ph': return o.das ? 'P' : 'H';
    case 'Rh': return o.canSurrender ? 'R' : 'H';
    case 'Rs': return o.canSurrender ? 'R' : 'S';
    case 'Rp': return o.canSurrender ? 'R' : 'P';
    default: return code;
  }
}

// o = { canDouble, canSplit, canSurrender, das }
export function basicStrategy(cards, up, rules, o) {
  const tb = tablesFor(rules);
  const col = up - 2;
  const { total, soft } = handTotal(cards);
  if (o.canSplit && isPair(cards)) {
    const r = tb.pair[rankKey(cards[0].rank)];
    if (r) return { action: resolveCode(r[col], o), code: r[col], kind: 'pair', total, soft };
  }
  if (soft) {
    const code = total >= 20 ? 'S' : tb.soft[total][col];
    return { action: resolveCode(code, o), code, kind: 'soft', total, soft };
  }
  const code = total >= 18 ? 'S' : tb.hard[Math.max(8, total)][col];
  return { action: resolveCode(code, o), code, kind: 'hard', total, soft };
}

// Hi-Lo indices: "at" when TC >= index, otherwise "below".
export const DEVS = [
  { kind: 'ins', name: 'Insurance', tc: 3, at: 'Y', below: 'N' },
  { kind: 'hard', name: '16 vs 10', total: 16, up: 10, tc: 0, at: 'S', below: 'H' },
  { kind: 'hard', name: '15 vs 10', total: 15, up: 10, tc: 4, at: 'S', below: 'H' },
  { kind: 'pair', name: '10,10 vs 5', pair: 'T', up: 5, tc: 5, at: 'P', below: 'S' },
  { kind: 'pair', name: '10,10 vs 6', pair: 'T', up: 6, tc: 4, at: 'P', below: 'S' },
  { kind: 'hard', name: '10 vs 10', total: 10, up: 10, tc: 4, at: 'D', below: 'H' },
  { kind: 'hard', name: '12 vs 3', total: 12, up: 3, tc: 2, at: 'S', below: 'H' },
  { kind: 'hard', name: '12 vs 2', total: 12, up: 2, tc: 3, at: 'S', below: 'H' },
  { kind: 'hard', name: '11 vs A', total: 11, up: 11, tc: 1, at: 'D', below: 'H', s17only: true },
  { kind: 'hard', name: '9 vs 2', total: 9, up: 2, tc: 1, at: 'D', below: 'H' },
  { kind: 'hard', name: '10 vs A', total: 10, up: 11, tc: 4, tcH17: 3, at: 'D', below: 'H' },
  { kind: 'hard', name: '9 vs 7', total: 9, up: 7, tc: 3, at: 'D', below: 'H' },
  { kind: 'hard', name: '16 vs 9', total: 16, up: 9, tc: 5, at: 'S', below: 'H' },
  { kind: 'hard', name: '13 vs 2', total: 13, up: 2, tc: -1, at: 'S', below: 'H' },
  { kind: 'hard', name: '12 vs 4', total: 12, up: 4, tc: 0, at: 'S', below: 'H' },
  { kind: 'hard', name: '12 vs 5', total: 12, up: 5, tc: -2, at: 'S', below: 'H' },
  { kind: 'hard', name: '12 vs 6', total: 12, up: 6, tc: -1, at: 'S', below: 'H' },
  { kind: 'hard', name: '13 vs 3', total: 13, up: 3, tc: -2, at: 'S', below: 'H' },
  // Fab 4 surrenders (only when late surrender is offered)
  { kind: 'surrender', name: '14 vs 10', total: 14, up: 10, tc: 3, at: 'R', below: 'basic' },
  { kind: 'surrender', name: '15 vs 10', total: 15, up: 10, tc: 0, at: 'R', below: 'basic' },
  { kind: 'surrender', name: '15 vs 9', total: 15, up: 9, tc: 2, at: 'R', below: 'basic' },
  { kind: 'surrender', name: '15 vs A', total: 15, up: 11, tc: 1, tcH17: -1, at: 'R', below: 'basic' },
];

export const devIndex = (d, rules) => (rules.h17 && d.tcH17 != null ? d.tcH17 : d.tc);

export function devNote(d, rules) {
  const idx = signed(devIndex(d, rules));
  if (d.kind === 'ins') return `Insurance: take at TC ≥ ${idx}`;
  if (d.kind === 'surrender') return `${d.name}: Surrender at TC ≥ ${idx}`;
  return `${d.name}: ${ACTIONS[d.at]} at TC ≥ ${idx}, else ${ACTIONS[d.below]}`;
}

export function applicableDevs(rules) {
  return DEVS.filter((d) => !(d.s17only && rules.h17) && !(d.kind === 'surrender' && !rules.surrender));
}

export const insuranceCorrect = (tc, useDev) => !!(useDev && tc != null && tc >= 3);

function playDev(cards, up, rules, o, b, tc) {
  const { total, soft } = b;
  if (b.kind === 'pair') {
    const k = rankKey(cards[0].rank);
    const d = DEVS.find((x) => x.kind === 'pair' && x.pair === k && x.up === up);
    if (d) return { action: tc >= devIndex(d, rules) ? d.at : d.below, dev: d, note: devNote(d, rules) };
    if (b.action === 'P' || soft) return null;
  } else if (b.kind !== 'hard') {
    return null;
  }
  if (b.action === 'R') return null;
  const d = DEVS.find((x) => x.kind === 'hard' && x.total === total && x.up === up && !(x.s17only && rules.h17));
  if (!d) return null;
  let a = tc >= devIndex(d, rules) ? d.at : d.below;
  if (a === 'D' && !o.canDouble) a = 'H';
  return { action: a, dev: d, note: devNote(d, rules) };
}

// The correct play, optionally including Hi-Lo index plays at true count `tc`.
export function correctAction(cards, up, rules, o, tc = null, useDev = false) {
  const base = basicStrategy(cards, up, rules, o);
  const plain = { action: base.action, basic: base.action, info: base, dev: null, note: null };
  if (!useDev || tc == null) return plain;

  if (o.canSurrender && !base.soft && !(base.kind === 'pair' && base.action === 'P')) {
    const d = DEVS.find((x) => x.kind === 'surrender' && x.total === base.total && x.up === up);
    if (d) {
      if (tc >= devIndex(d, rules)) return { action: 'R', basic: base.action, info: base, dev: d, note: devNote(d, rules) };
      const o2 = { ...o, canSurrender: false };
      const b2 = basicStrategy(cards, up, rules, o2);
      const play = playDev(cards, up, rules, o2, b2, tc);
      if (play) return { ...play, basic: base.action, info: base };
      return { action: b2.action, basic: base.action, info: base, dev: d, note: devNote(d, rules) };
    }
  }
  const play = playDev(cards, up, rules, o, base, tc);
  return play ? { ...play, basic: base.action, info: base } : plain;
}

export const CODE_TEXT = {
  H: 'Hit', S: 'Stand', D: 'Double (hit if not allowed)', Dh: 'Double (hit if not allowed)',
  Ds: 'Double (stand if not allowed)', P: 'Split', Ph: 'Split if double-after-split is allowed, else hit',
  Rh: 'Surrender (hit if not allowed)', Rs: 'Surrender (stand if not allowed)', Rp: 'Surrender (split if not allowed)',
};
