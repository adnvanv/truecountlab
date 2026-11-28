// The premade strategies, custom strategies (accounts only), and checking that a custom
// strategy is well formed. Shared by the browser and the server, which grades online play
// with whatever strategy a player brings (premade strategies only in battles).
import { DEFAULT_STRATEGY, HARD, SOFT, PAIRS, DEVS, ACTIONS } from './strategy.js';
import { COUNTS, INDEX_PLAYS } from './presets.js';
import { INDEXES, RAMPS, EDGES } from './preset-data.js';
import { RULES } from './cards.js';

/** @typedef {import('./strategy.js').Strategy} Strategy */
/** @typedef {import('./strategy.js').Deviation} Deviation */

const UP_NAME = (u) => (u === 11 ? 'A' : String(u));
const LOW = new Set(['12v4', '12v5', '12v6', '13v2', '13v3']); // basic stands; hit when the count drops
const EXTRA = new Set(['8v6', '8v5']);

/** Turn an index-play definition plus an index into a deviation. @returns {Deviation} */
function devFrom(play, tc) {
  const total = play.cards.reduce((a, k) => a + (k === 'T' ? 10 : k === 'A' ? 11 : Number(k)), 0);
  const base = { id: play.id, kind: play.kind, up: play.up, tc, at: play.at, below: play.below };
  if (play.kind === 'ins') return { ...base, group: 'core', name: 'Insurance' };
  if (play.kind === 'surrender') return { ...base, group: 'surrender', total, name: `${total} vs ${UP_NAME(play.up)}` };
  if (play.at === 'P') return { ...base, group: 'core', pair: play.cards[0], total, name: `10,10 vs ${UP_NAME(play.up)}` };
  return { ...base, group: LOW.has(play.id) ? 'low' : EXTRA.has(play.id) ? 'extra' : 'core', total, name: `${total} vs ${UP_NAME(play.up)}` };
}
/** @param {Record<string, number>} idx @param {string[]} ids */
const devsFrom = (idx, ids) => INDEX_PLAYS.filter((p) => ids.includes(p.id) && idx[p.id] != null).map((p) => devFrom(p, idx[p.id]));

const I18 = ['ins', '16v10', '15v10', 'TTv5', 'TTv6', '10v10', '12v3', '12v2', '11vA', '9v2', '10vA', '9v7', '16v9', '13v2', '12v4', '12v5', '12v6', '13v3'];
const FAB4 = ['R14v10', 'R15v10', 'R15v9', 'R15vA'];
// Schlesinger's Illustrious 18 and Fab 4 for Hi-Lo, multi-deck S17, as published.
const PUBLISHED_I18 = {
  ins: 3, '16v10': 0, '15v10': 4, TTv5: 5, TTv6: 4, '10v10': 4, '12v3': 2, '12v2': 3, '11vA': 1, '9v2': 1,
  '10vA': 4, '9v7': 3, '16v9': 5, '13v2': -1, '12v4': 0, '12v5': -2, '12v6': -1, '13v3': -2,
  R14v10: 3, R15v10: 0, R15v9: 2, R15vA: 1,
};
const chart = { hard: HARD, soft: SOFT, pairs: PAIRS };

/** @type {Strategy[]} */
export const PRESETS = [
  { ...DEFAULT_STRATEGY, edge: EDGES.tcl },
  {
    id: 'basic', name: 'Basic strategy only', preset: true, count: COUNTS.hilo, chart, devs: [], ramp: [], edge: EDGES.basic,
    desc: 'The chart and nothing else: no index plays, the same bet every hand. Where every new player should start. You still keep the Hi-Lo count for the count checks.',
  },
  {
    id: 'i18', name: 'Hi-Lo Illustrious 18', preset: true, count: COUNTS.hilo, chart, devs: devsFrom(PUBLISHED_I18, [...I18, ...FAB4]), ramp: RAMPS.hilo, edge: EDGES.i18,
    desc: 'The classic pro setup: Hi-Lo, the 18 index plays worth the most (Schlesinger) plus the Fab 4 surrenders, and a $25 to $200 ramp.',
  },
  {
    id: 'ko', name: 'KO (Knock-Out)', preset: true, count: COUNTS.ko, chart, devs: devsFrom(INDEXES.ko, [...I18, ...FAB4]), ramp: RAMPS.ko, edge: EDGES.ko,
    desc: 'Unbalanced: 7s count +1 and you start the shoe at −20, so there\'s no true count to work out. Bets and index plays go by the running count.',
  },
  {
    id: 'hiopt2', name: 'Hi-Opt II', preset: true, count: COUNTS.hiopt2, chart, devs: devsFrom(INDEXES.hiopt2, [...I18, ...FAB4]), ramp: RAMPS.hiopt2, edge: EDGES.hiopt2,
    desc: 'A level-2 count (4s and 5s are +2, tens −2, aces 0). Harder to keep, more accurate, especially for insurance.',
  },
  {
    id: 'omega2', name: 'Omega II', preset: true, count: COUNTS.omega2, chart, devs: devsFrom(INDEXES.omega2, [...I18, ...FAB4]), ramp: RAMPS.omega2, edge: EDGES.omega2,
    desc: 'Level-2 like Hi-Opt II, but 6s are +2 and 9s −1. One of the strongest counts for playing decisions.',
  },
];
export const DEFAULT_ID = 'tcl';
/** Index plays computed by scripts/compute-indexes.mjs rather than taken from a book. */
export const COMPUTED = new Set(['ko', 'hiopt2', 'omega2']);

/** A strategy by id: a preset, one of the player's own, or the default. @param {string | undefined} id @param {Strategy[]} [mine] */
export function strategyById(id, mine = []) {
  return PRESETS.find((s) => s.id === id) || mine.find((s) => s.id === id) || PRESETS[0];
}

// ---- custom strategies ----------------------------------------------------------------
const RANK_KEYS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
const PER_DECK = { 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4, T: 16, A: 4 };
/** What one full deck adds to a count: 0 for a balanced count. @param {Record<string, number>} values */
export const deckSum = (values) => RANK_KEYS.reduce((a, k) => a + (values[k] || 0) * PER_DECK[k], 0);
/** Start-of-shoe running count for an unbalanced count, KO-style: −(deck sum × (decks − 1)). @param {Record<string, number>} values */
export const defaultIrc = (values) => -deckSum(values) * (RULES.decks - 1);

const HARD_ROWS = Object.keys(HARD).map(Number);
const SOFT_ROWS = Object.keys(SOFT).map(Number);
const PAIR_ROWS = Object.keys(PAIRS);
const CODES = { hard: ['H', 'S', 'D'], soft: ['H', 'S', 'D', 'Ds'], pairs: ['H', 'S', 'D', 'P'] };
export const CHART_CODES = CODES;
export const MAX_UNITS = 8; // $200 at a $25 table
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * A copy of a strategy to edit. @param {Strategy} from @param {string} [name]
 * @returns {Strategy}
 */
export function newCustom(from, name) {
  const s = structuredClone(from);
  return {
    ...s,
    id: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: (name || `My ${from.name}`).slice(0, 30),
    desc: `Started from ${from.name}.`,
    preset: false,
    edge: undefined,
  };
}

/**
 * A custom strategy as received from a browser, checked and rebuilt so nothing unexpected
 * gets through: integer tags and indexes in range, known chart codes, known plays.
 * @param {any} x @returns {Strategy | null}
 */
export function cleanStrategy(x) {
  if (!x || typeof x !== 'object') return null;
  if (typeof x.id !== 'string' || !/^c_[a-z0-9]{4,24}$/.test(x.id)) return null;
  const name = String(x.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30) || 'My strategy';
  /** @type {Record<string, number>} */
  const values = {};
  for (const k of RANK_KEYS) {
    const v = x.count?.values?.[k];
    if (!int(v, -3, 3)) return null;
    values[k] = v;
  }
  const balanced = deckSum(values) === 0;
  const irc = balanced ? undefined : int(x.count?.irc, -200, 200) ? x.count.irc : defaultIrc(values);
  const countName = String(x.count?.name || 'Custom count').slice(0, 30);
  const rows = (/** @type {'hard' | 'soft' | 'pairs'} */ kind, keys) => {
    /** @type {Record<string, import('./strategy.js').Code[]>} */
    const out = {};
    for (const r of keys) {
      const row = x.chart?.[kind]?.[r];
      if (!Array.isArray(row) || row.length !== 10 || !row.every((c) => CODES[kind].includes(c))) return null;
      out[r] = /** @type {import('./strategy.js').Code[]} */ (row.slice());
    }
    return out;
  };
  const hard = rows('hard', HARD_ROWS); const soft = rows('soft', SOFT_ROWS); const pairs = rows('pairs', PAIR_ROWS);
  if (!hard || !soft || !pairs) return null;
  if (!Array.isArray(x.devs) || x.devs.length > 60) return null;
  /** @type {Deviation[]} */
  const devs = [];
  const seen = new Set();
  for (const d of x.devs) {
    if (!d || !['ins', 'play', 'surrender'].includes(d.kind) || !int(d.tc, -60, 60) || !int(d.up, 2, 11)) return null;
    const key = d.kind === 'ins' ? 'ins' : `${d.kind}:${d.pair || d.total}:${d.up}`;
    if (seen.has(key)) continue; // one rule per hand
    seen.add(key);
    if (d.kind === 'ins') { devs.push({ id: 'ins', kind: 'ins', group: 'core', name: 'Insurance', up: 11, tc: d.tc, at: 'Y', below: 'N' }); continue; }
    if (d.kind === 'surrender') {
      if (!int(d.total, 12, 17)) return null;
      devs.push({ id: `R${d.total}v${d.up}`, kind: 'surrender', group: 'surrender', name: `${d.total} vs ${UP_NAME(d.up)}`, total: d.total, up: d.up, tc: d.tc, at: 'R', below: 'H' });
      continue;
    }
    if (!['H', 'S', 'D', 'P'].includes(d.at) || !['H', 'S', 'D', 'P'].includes(d.below) || d.at === d.below) return null;
    if (d.pair != null) {
      if (!PAIR_ROWS.includes(d.pair)) return null;
      const label = d.pair === 'T' ? '10' : d.pair;
      devs.push({ id: `P${d.pair}v${d.up}`, kind: 'play', group: 'core', name: `${label},${label} vs ${UP_NAME(d.up)}`, pair: d.pair, total: d.pair === 'A' ? 12 : (d.pair === 'T' ? 10 : Number(d.pair)) * 2, up: d.up, tc: d.tc, at: d.at, below: d.below });
      continue;
    }
    if (!int(d.total, 5, 20) || d.at === 'P' || d.below === 'P') return null;
    const group = d.at === 'S' && d.below === 'H' && hard[Math.min(17, Math.max(8, d.total))]?.[d.up - 2] === 'S' ? 'low' : 'core';
    devs.push({ id: `${d.total}v${UP_NAME(d.up)}`, kind: 'play', group, name: `${d.total} vs ${UP_NAME(d.up)}`, total: d.total, up: d.up, tc: d.tc, at: d.at, below: d.below });
  }
  if (!Array.isArray(x.ramp) || x.ramp.length > 10) return null;
  const ramp = [];
  for (const r of x.ramp) {
    if (!r || !int(r.at, -60, 60) || !int(r.units, 1, MAX_UNITS)) return null;
    ramp.push({ at: r.at, units: r.units });
  }
  ramp.sort((a, b) => a.at - b.at);
  return {
    id: x.id, name, desc: String(x.desc || '').slice(0, 120), preset: false,
    count: balanced ? { name: countName, kind: 'true', values } : { name: countName, kind: 'running', irc, values },
    chart: { hard, soft, pairs }, devs, ramp,
  };
}

/** Every play the editor offers to add, with the default strategy's index as a starting point. */
export const PLAY_CHOICES = INDEX_PLAYS.map((p) => devFrom(p, DEVS.find((d) => d.id === p.id)?.tc ?? PUBLISHED_I18[p.id] ?? 0));
export { ACTIONS };
