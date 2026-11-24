// Basic strategy for 6 decks, S17, DAS, no surrender — plus the eight count
// deviations this trainer drills.
import { rankKey, bjValue } from './cards.js';

export const ACTIONS = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', Y: 'Take insurance', N: 'Decline insurance' };
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
  if (soft) return cards.length === 2 ? `A,${total - 11}` : `soft ${total}`;
  return `hard ${total}`;
}

// Codes: H hit, S stand, D double (else hit), Ds double (else stand), P split.
const row = (s) => s.trim().split(/\s+/);
//                        2  3  4  5  6  7  8  9  T  A
export const HARD = {
  8:  row('H  H  H  H  H  H  H  H  H  H'),
  9:  row('H  D  D  D  D  H  H  H  H  H'),
  10: row('D  D  D  D  D  D  D  D  H  H'),
  11: row('D  D  D  D  D  D  D  D  D  H'),
  12: row('H  H  S  S  S  H  H  H  H  H'),
  13: row('S  S  S  S  S  H  H  H  H  H'),
  14: row('S  S  S  S  S  H  H  H  H  H'),
  15: row('S  S  S  S  S  H  H  H  H  H'),
  16: row('S  S  S  S  S  H  H  H  H  H'),
  17: row('S  S  S  S  S  S  S  S  S  S'),
};
export const SOFT = {
  12: row('H  H  H  H  H  H  H  H  H  H'),
  13: row('H  H  H  D  D  H  H  H  H  H'),
  14: row('H  H  H  D  D  H  H  H  H  H'),
  15: row('H  H  D  D  D  H  H  H  H  H'),
  16: row('H  H  D  D  D  H  H  H  H  H'),
  17: row('H  D  D  D  D  H  H  H  H  H'),
  18: row('S  Ds Ds Ds Ds S  S  H  H  H'),
  19: row('S  S  S  S  S  S  S  S  S  S'),
  20: row('S  S  S  S  S  S  S  S  S  S'),
};
export const PAIRS = {
  A: row('P  P  P  P  P  P  P  P  P  P'),
  T: row('S  S  S  S  S  S  S  S  S  S'),
  9: row('P  P  P  P  P  S  P  P  S  S'),
  8: row('P  P  P  P  P  P  P  P  P  P'),
  7: row('P  P  P  P  P  P  H  H  H  H'),
  6: row('P  P  P  P  P  H  H  H  H  H'),
  5: row('D  D  D  D  D  D  D  D  H  H'),
  4: row('H  H  H  P  P  H  H  H  H  H'),
  3: row('P  P  P  P  P  P  H  H  H  H'),
  2: row('P  P  P  P  P  P  H  H  H  H'),
};

const resolve = (code, o) => (code === 'D' ? (o.canDouble ? 'D' : 'H') : code === 'Ds' ? (o.canDouble ? 'D' : 'S') : code);

// Heatmap cell for a decision: { group: 'hard'|'soft'|'pair', row, col }.
export function cellOf(cards, up, canSplit = true) {
  const { total, soft } = handTotal(cards);
  const col = upLabel(up);
  if (canSplit && isPair(cards)) return { group: 'pair', row: rankKey(cards[0].rank), col };
  if (soft) return { group: 'soft', row: String(Math.min(total, 20)), col };
  return { group: 'hard', row: String(Math.min(Math.max(total, 8), 17)), col };
}
export const cellKey = (c) => `${c.group}:${c.row}:${c.col}`;

// o = { canDouble, canSplit }
export function basicStrategy(cards, up, o) {
  const col = up - 2;
  const { total, soft } = handTotal(cards);
  if (o.canSplit && isPair(cards)) {
    const code = PAIRS[rankKey(cards[0].rank)][col];
    return { action: resolve(code, o), code, kind: 'pair', total, soft };
  }
  if (soft) {
    const code = total >= 20 ? 'S' : SOFT[total][col];
    return { action: resolve(code, o), code, kind: 'soft', total, soft };
  }
  const code = total >= 18 ? 'S' : HARD[Math.max(8, total)][col];
  return { action: resolve(code, o), code, kind: 'hard', total, soft };
}

// The eight count deviations. Make the `at` play when TC >= index.
export const DEVS = [
  { id: 'ins', name: 'Insurance', tc: 3, at: 'Y', below: 'N', up: 11 },
  { id: '16v10', name: '16 vs 10', total: 16, up: 10, tc: 0, at: 'S', below: 'H' },
  { id: '15v10', name: '15 vs 10', total: 15, up: 10, tc: 4, at: 'S', below: 'H' },
  { id: '12v3', name: '12 vs 3', total: 12, up: 3, tc: 2, at: 'S', below: 'H' },
  { id: '12v2', name: '12 vs 2', total: 12, up: 2, tc: 3, at: 'S', below: 'H' },
  { id: '10v10', name: '10 vs 10', total: 10, up: 10, tc: 4, at: 'D', below: 'H' },
  { id: '10vA', name: '10 vs A', total: 10, up: 11, tc: 4, at: 'D', below: 'H' },
  { id: '9v2', name: '9 vs 2', total: 9, up: 2, tc: 1, at: 'D', below: 'H' },
];
export const devNote = (d) => (d.id === 'ins'
  ? `Insurance: take at TC ≥ ${signed(d.tc)}`
  : `${d.name}: ${ACTIONS[d.at]} at TC ≥ ${signed(d.tc)}, otherwise ${ACTIONS[d.below]}`);

export const insuranceCorrect = (tc) => tc >= 3;

// Correct play, applying deviations when a true count is given.
// Deviations apply to hard totals (not to pairs basic strategy splits).
export function correctAction(cards, up, o, tc = null) {
  const b = basicStrategy(cards, up, o);
  const res = { action: b.action, basic: b.action, info: b, dev: null, note: null };
  if (tc == null || b.soft || (b.kind === 'pair' && b.action === 'P')) return res;
  const d = DEVS.find((x) => x.total === b.total && x.up === up);
  if (!d) return res;
  let a = tc >= d.tc ? d.at : d.below;
  if (a === 'D' && !o.canDouble) a = 'H';
  return { ...res, action: a, dev: d, note: devNote(d) };
}

export const CODE_TEXT = { H: 'Hit', S: 'Stand', D: 'Double (hit if you can’t)', Ds: 'Double (stand if you can’t)', P: 'Split' };
