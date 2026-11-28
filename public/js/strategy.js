// The rules engine: basic strategy, count deviations, the count itself and the bet ramp,
// for any strategy (see strategies.js for the premade ones and custom ones). Without a
// strategy argument everything uses the default: TrueCountLab's own Hi-Lo strategy for
// 6 decks, S17, DAS, no surrender.
import { rankKey, bjValue, RULES } from './cards.js';
import { COUNTS } from './presets.js';

/** @typedef {import('./cards.js').Card} Card */
/** @typedef {{ canDouble: boolean, canSplit: boolean, canSurrender?: boolean }} Options */
/** @typedef {'H' | 'S' | 'D' | 'P' | 'R'} Action */
/** @typedef {'H' | 'S' | 'D' | 'Ds' | 'P'} Code a chart entry: Ds is double, else stand */
/**
 * @typedef {object} Deviation
 * @property {string} id @property {string} group @property {'ins' | 'play' | 'surrender'} kind @property {string} name
 * @property {number} [total] hard total (plays and surrenders)
 * @property {string} [pair] rank key of a pair this play splits (e.g. 'T' for 10,10 vs 5)
 * @property {number} up @property {number} tc the index (a true count, or a running count for unbalanced counts)
 * @property {string} at the play at or above the index @property {string} below the play under it
 */
/** @typedef {import('./presets.js').CountSystem} CountSystem */
/**
 * @typedef {object} Strategy
 * @property {string} id @property {string} name @property {string} [desc]
 * @property {boolean} [preset] one of the premade strategies (custom ones are false)
 * @property {CountSystem} count
 * @property {{ hard: Record<number, Code[]>, soft: Record<number, Code[]>, pairs: Record<string, Code[]> }} chart
 * @property {Deviation[]} devs index plays, insurance and surrenders
 * @property {{ at: number, units: number }[]} ramp bet `units` x the table minimum at counts >= `at` (1 unit below the first step)
 * @property {{ flat: number, ramp: number, hands: number }} [edge] simulated player edge, % of money bet
 */

/** @type {Record<string, string>} */
export const ACTIONS = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender', Y: 'Take insurance', N: 'Decline insurance' };
export const UPCARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** @param {number} v */
export const upLabel = (v) => (v === 11 ? 'A' : String(v));
/** @param {number} n */
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** @param {Card[]} cards */
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
/** @param {Card[]} cards */
export const isPair = (cards) => cards.length === 2 && rankKey(cards[0].rank) === rankKey(cards[1].rank);
/** @param {Card[]} cards */
export const isBlackjack = (cards) => cards.length === 2 && handTotal(cards).total === 21;
/** @param {Card} card */
export const upValue = (card) => bjValue(card.rank);

/** @param {Card[]} cards */
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
/** @param {string} s @returns {Code[]} */
const row = (s) => /** @type {Code[]} */ (s.trim().split(/\s+/));
//                        2  3  4  5  6  7  8  9  T  A
/** @type {Record<number, Code[]>} */
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
/** @type {Record<number, Code[]>} */
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
/** @type {Record<string, Code[]>} */
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

/** A chart code as a play you can make with these options. @param {Code} code @param {Options} o @returns {Action} */
const resolve = (code, o) => (code === 'D' ? (o.canDouble ? 'D' : 'H') : code === 'Ds' ? (o.canDouble ? 'D' : 'S') : code);

// Heatmap cell for a decision: { group: 'hard'|'soft'|'pair', row, col }.
/** @param {Card[]} cards @param {number} up @param {boolean} [canSplit] */
export function cellOf(cards, up, canSplit = true) {
  const { total, soft } = handTotal(cards);
  const col = upLabel(up);
  if (canSplit && isPair(cards)) return { group: 'pair', row: rankKey(cards[0].rank), col };
  if (soft) return { group: 'soft', row: String(Math.min(total, 20)), col };
  return { group: 'hard', row: String(Math.min(Math.max(total, 8), 17)), col };
}
/** @param {{ group: string, row: string, col: string }} c */
export const cellKey = (c) => `${c.group}:${c.row}:${c.col}`;

/** @param {Card[]} cards @param {number} up dealer upcard value (11 = ace) @param {Options} o @param {Strategy} [strat] */
export function basicStrategy(cards, up, o, strat = DEFAULT_STRATEGY) {
  const col = up - 2;
  const { hard, soft: softRows, pairs } = strat.chart;
  const { total, soft } = handTotal(cards);
  if (o.canSplit && isPair(cards)) {
    const code = pairs[rankKey(cards[0].rank)][col];
    return { action: resolve(code, o), code, kind: 'pair', total, soft };
  }
  if (soft) {
    const code = total >= 21 ? 'S' : softRows[Math.max(12, total)]?.[col] ?? 'S';
    return { action: resolve(code, o), code, kind: 'soft', total, soft };
  }
  const code = total >= 18 ? 'S' : hard[Math.max(8, total)][col];
  return { action: resolve(code, o), code, kind: 'hard', total, soft };
}

// Count deviations. Make the `at` play when TC >= tc (the index); otherwise `below`.
// group: core (original 8) · low (low-count hits) · extra · surrender (only with the toggle on).
export const DEV_GROUPS = { core: 'Core', low: 'Low-count hits', extra: 'Extra doubles/stands', surrender: 'Surrender' };
/** @type {Deviation[]} */
export const DEVS = [
  { id: 'ins', group: 'core', kind: 'ins', name: 'Insurance', tc: 3, at: 'Y', below: 'N', up: 11 },
  { id: '16v10', group: 'core', kind: 'play', name: '16 vs 10', total: 16, up: 10, tc: 0, at: 'S', below: 'H' },
  { id: '15v10', group: 'core', kind: 'play', name: '15 vs 10', total: 15, up: 10, tc: 4, at: 'S', below: 'H' },
  { id: '12v3', group: 'core', kind: 'play', name: '12 vs 3', total: 12, up: 3, tc: 2, at: 'S', below: 'H' },
  { id: '12v2', group: 'core', kind: 'play', name: '12 vs 2', total: 12, up: 2, tc: 3, at: 'S', below: 'H' },
  { id: '10v10', group: 'core', kind: 'play', name: '10 vs 10', total: 10, up: 10, tc: 4, at: 'D', below: 'H' },
  { id: '10vA', group: 'core', kind: 'play', name: '10 vs A', total: 10, up: 11, tc: 4, at: 'D', below: 'H' },
  { id: '9v2', group: 'core', kind: 'play', name: '9 vs 2', total: 9, up: 2, tc: 1, at: 'D', below: 'H' },
  // Low-count hits: basic strategy stands; hit once the count drops below the index.
  { id: '12v4', group: 'low', kind: 'play', name: '12 vs 4', total: 12, up: 4, tc: 0, at: 'S', below: 'H' },
  { id: '12v5', group: 'low', kind: 'play', name: '12 vs 5', total: 12, up: 5, tc: -2, at: 'S', below: 'H' },
  { id: '12v6', group: 'low', kind: 'play', name: '12 vs 6', total: 12, up: 6, tc: -1, at: 'S', below: 'H' },
  { id: '13v2', group: 'low', kind: 'play', name: '13 vs 2', total: 13, up: 2, tc: 0, at: 'S', below: 'H' },
  { id: '13v3', group: 'low', kind: 'play', name: '13 vs 3', total: 13, up: 3, tc: -1, at: 'S', below: 'H' },
  // Extra doubles and stands.
  { id: '11vA', group: 'extra', kind: 'play', name: '11 vs A', total: 11, up: 11, tc: 1, at: 'D', below: 'H' },
  { id: '9v7', group: 'extra', kind: 'play', name: '9 vs 7', total: 9, up: 7, tc: 3, at: 'D', below: 'H' },
  { id: '8v6', group: 'extra', kind: 'play', name: '8 vs 6', total: 8, up: 6, tc: 2, at: 'D', below: 'H' },
  { id: '8v5', group: 'extra', kind: 'play', name: '8 vs 5', total: 8, up: 5, tc: 4, at: 'D', below: 'H' },
  { id: '16v9', group: 'extra', kind: 'play', name: '16 vs 9', total: 16, up: 9, tc: 5, at: 'S', below: 'H' },
  // Surrender (only when the surrender toggle is on). Below the index, play the hand normally.
  { id: 'R15v10', group: 'surrender', kind: 'surrender', name: '15 vs 10', total: 15, up: 10, tc: 0, at: 'R', below: 'play' },
  { id: 'R14v10', group: 'surrender', kind: 'surrender', name: '14 vs 10', total: 14, up: 10, tc: 3, at: 'R', below: 'play' },
  { id: 'R15v9', group: 'surrender', kind: 'surrender', name: '15 vs 9', total: 15, up: 9, tc: 2, at: 'R', below: 'play' },
  { id: 'R15vA', group: 'surrender', kind: 'surrender', name: '15 vs A', total: 15, up: 11, tc: 1, at: 'R', below: 'play' },
];
/** @param {boolean} surrender @param {Strategy} [strat] */
export const activeDevs = (surrender, strat = DEFAULT_STRATEGY) => strat.devs.filter((d) => surrender || d.kind !== 'surrender');

/** 'TC' or 'RC': what this strategy's indexes and bets are keyed on. @param {Strategy} [strat] */
export const indexName = (strat = DEFAULT_STRATEGY) => (strat.count.kind === 'running' ? 'RC' : 'TC');

/** @param {Deviation} d @param {Strategy} [strat] */
export function devNote(d, strat = DEFAULT_STRATEGY) {
  const n = indexName(strat);
  if (d.kind === 'ins') return `Insurance: take at ${n} ≥ ${signed(d.tc)}`;
  if (d.kind === 'surrender') return `${d.name}: Surrender at ${n} ≥ ${signed(d.tc)}`;
  if (d.group === 'low') return `${d.name}: Hit at ${n} ≤ ${signed(d.tc - 1)}, otherwise Stand`;
  return `${d.name}: ${ACTIONS[d.at]} at ${n} ≥ ${signed(d.tc)}, otherwise ${ACTIONS[d.below]}`;
}

/** @param {number} tc @param {Strategy} [strat] */
export function insuranceCorrect(tc, strat = DEFAULT_STRATEGY) {
  const d = strat.devs.find((x) => x.kind === 'ins');
  return d ? tc >= d.tc : false;
}

// Correct play, applying deviations when a true count is given.
// o = { canDouble, canSplit, canSurrender }. Basic strategy itself never surrenders;
// surrender only comes from the four surrender deviations (toggle on).
// Deviations apply to hard totals, not to pairs that basic strategy splits.
/**
 * @param {Card[]} cards @param {number} up @param {Options} o
 * @param {number | null} [tc] the true count; without one, plain basic strategy
 * @returns {{ action: Action, basic: Action, info: ReturnType<typeof basicStrategy>, dev: Deviation | null, note: string | null }}
 */
export function correctAction(cards, up, o, tc = null, strat = DEFAULT_STRATEGY) {
  const b = basicStrategy(cards, up, o, strat);
  const res = { action: b.action, basic: b.action, info: b, dev: null, note: null };
  if (tc == null) return res;
  const devs = strat.devs;
  // A pair deviation (10,10 vs 5: split at +5) decides the hand on its own.
  if (o.canSplit && isPair(cards)) {
    const pk = rankKey(cards[0].rank);
    const pd = devs.find((x) => x.kind === 'play' && x.pair === pk && x.up === up);
    if (pd) return { ...res, action: /** @type {Action} */ (tc >= pd.tc ? pd.at : pd.below), dev: pd, note: devNote(pd, strat) };
  }
  if (b.soft || (b.kind === 'pair' && b.action === 'P')) return res;
  let surrDev = null;
  if (o.canSurrender) {
    surrDev = devs.find((x) => x.kind === 'surrender' && x.total === b.total && x.up === up);
    if (surrDev && tc >= surrDev.tc) return { ...res, action: 'R', dev: surrDev, note: devNote(surrDev, strat) };
  }
  const d = devs.find((x) => x.kind === 'play' && !x.pair && x.total === b.total && x.up === up);
  if (!d) return surrDev ? { ...res, dev: surrDev, note: devNote(surrDev, strat) } : res;
  let a = /** @type {Action} */ (tc >= d.tc ? d.at : d.below); // hard-total deviations are H, S or D
  if (a === 'D' && !o.canDouble) a = 'H';
  return { ...res, action: a, dev: d, note: devNote(d, strat) };
}

// ---- the count and the bet ramp ------------------------------------------------------
/** What a card adds to this strategy's count. @param {Card} card @param {Strategy} [strat] */
export const tagOf = (card, strat = DEFAULT_STRATEGY) => strat.count.values[rankKey(card.rank)] || 0;
/** The running count at the start of a shoe (0, or the IRC of an unbalanced count). @param {Strategy} [strat] */
export const startCount = (strat = DEFAULT_STRATEGY) => (strat.count.kind === 'running' ? strat.count.irc || 0 : 0);
/** Decks remaining as a player estimates them: nearest half deck, at least 1/2. @param {number} cardsRemaining */
const decksLeft = (cardsRemaining) => Math.max(0.5, Math.round((cardsRemaining / 52) * 2) / 2);
/**
 * The number this strategy bets and deviates on: the true count (running count / decks
 * left, rounded down) for balanced counts, the running count itself for unbalanced ones.
 * @param {number} rc @param {number} cardsRemaining @param {Strategy} [strat]
 */
export function countIndex(rc, cardsRemaining, strat = DEFAULT_STRATEGY) {
  if (strat.count.kind === 'running') return rc;
  return Math.floor(rc / decksLeft(cardsRemaining)) || 0;
}
/**
 * Counts a careful player could reach: estimating the decks a few cards either side of
 * the exact position can land on a neighbouring half deck. Running counts are exact.
 * @param {number} rc @param {number} cardsRemaining @param {Strategy} [strat] @returns {number[]}
 */
export function indexCandidates(rc, cardsRemaining, strat = DEFAULT_STRATEGY) {
  if (strat.count.kind === 'running') return [rc];
  const out = [countIndex(rc, cardsRemaining, strat)];
  for (const d of [-6, 6]) out.push(countIndex(rc, Math.max(1, cardsRemaining + d), strat));
  return [...new Set(out)];
}
/** Bet, in units of the table minimum, at this count. @param {number} idx @param {Strategy} [strat] */
export function betUnits(idx, strat = DEFAULT_STRATEGY) {
  let units = 1;
  for (const step of strat.ramp) if (idx >= step.at) units = step.units;
  return units;
}
/** @param {number} idx @param {Strategy} [strat] */
export const betAt = (idx, strat = DEFAULT_STRATEGY) => betUnits(idx, strat) * RULES.minBet;
/** Every bet the ramp uses, smallest first (the table's quick-bet chips). @param {Strategy} [strat] */
export const rampBets = (strat = DEFAULT_STRATEGY) => [...new Set([1, ...strat.ramp.map((r) => r.units)])].sort((a, b) => a - b).map((u) => u * RULES.minBet);
/** "$25 at TC <= +1, $50 at +2 to +3, $75 at +4 and up". @param {Strategy} [strat] */
export function rampText(strat = DEFAULT_STRATEGY) {
  const n = indexName(strat);
  const steps = [...strat.ramp].sort((a, b) => a.at - b.at);
  if (!steps.length) return `Flat $${RULES.minBet} on every hand`;
  const parts = [`$${RULES.minBet} at ${n} ≤ ${signed(steps[0].at - 1)}`];
  steps.forEach((st, i) => {
    const next = steps[i + 1];
    const range = !next ? `${signed(st.at)} and up` : next.at - st.at === 1 ? signed(st.at) : `${signed(st.at)} to ${signed(next.at - 1)}`;
    parts.push(`$${st.units * RULES.minBet} at ${range}`);
  });
  return parts.join(', ');
}


export const CODE_TEXT = { H: 'Hit', S: 'Stand', D: 'Double (hit if you can’t)', Ds: 'Double (stand if you can’t)', P: 'Split' };

/** TrueCountLab's own strategy: the charts and deviations above, Hi-Lo, $25/$50/$75. @type {Strategy} */
export const DEFAULT_STRATEGY = {
  id: 'tcl',
  name: 'TrueCountLab',
  desc: 'Hi-Lo with the full basic strategy chart, 22 index plays and a $25 to $75 ramp. The default.',
  preset: true,
  count: COUNTS.hilo,
  chart: { hard: HARD, soft: SOFT, pairs: PAIRS },
  devs: DEVS,
  ramp: [{ at: 2, units: 2 }, { at: 4, units: 3 }],
};
