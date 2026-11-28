// Computes count indexes (the count at which a deviation becomes the better play) for the
// premade strategies, from first principles:
//   1. Deal random shoes to random depths (6 decks, 75% penetration).
//   2. At each spot, for each deviation, work out the EV of both plays against what's
//      left in the shoe (dealer S17 with peek, double after split).
//   3. For each count, pick the index that wins the most EV over all those spots.
// EVs treat the remaining shoe as fixed while one hand plays out (no depletion inside a
// hand), which is accurate to a fraction of an index point with a shoe this size.
// Run it against Hi-Lo first: it should land on the published Illustrious 18 / Fab 4.
//
// Usage: node scripts/compute-indexes.mjs [samples=300000]
import { COUNTS, INDEX_PLAYS } from '../public/js/presets.js';

const SAMPLES = Number(process.argv[2]) || 300000;
const DEBUG = process.env.DEBUG_PLAY;
const dbg = {};
const DECKS = 6;
const CARDS = DECKS * 52;
const PEN = 0.75;

// Composition: c[1..10], 1 = ace, 10 = any ten.
const fullShoe = () => { const c = new Array(11).fill(DECKS * 4); c[0] = 0; c[10] = DECKS * 16; return c; };
const RANK = { A: 1, T: 10 };
const val = (k) => RANK[k] ?? Number(k);

/** Dealer's final totals [17,18,19,20,21,bust] for an upcard, given no blackjack (peek). */
function dealerDist(up, p) {
  const memo = new Map();
  function rec(total, soft) {
    // S17: stand on all 17s.
    let t = total; let s = soft;
    if (t > 21 && s) { t -= 10; s = false; }
    if (t > 21) return [0, 0, 0, 0, 0, 1];
    if (t >= 17) { const out = [0, 0, 0, 0, 0, 0]; out[t - 17] = 1; return out; }
    const key = t * 2 + (s ? 1 : 0);
    if (memo.has(key)) return memo.get(key);
    const out = [0, 0, 0, 0, 0, 0];
    for (let r = 1; r <= 10; r++) {
      if (!p[r]) continue;
      const eleven = r === 1 && t + 11 <= 21; // an ace counts 11 only if that doesn't bust
      const sub = rec(t + (eleven ? 11 : r), s || eleven);
      for (let i = 0; i < 6; i++) out[i] += p[r] * sub[i];
    }
    memo.set(key, out);
    return out;
  }
  // Hole card: never the card that would make a blackjack (we only play once the dealer has peeked).
  const out = [0, 0, 0, 0, 0, 0];
  let norm = 0;
  for (let r = 1; r <= 10; r++) {
    if ((up === 1 && r === 10) || (up === 10 && r === 1)) continue;
    norm += p[r];
  }
  const t0 = up === 1 ? 11 : up;
  for (let r = 1; r <= 10; r++) {
    if (!p[r] || (up === 1 && r === 10) || (up === 10 && r === 1)) continue;
    let t = t0; let s = up === 1;
    if (r === 1) { if (t + 11 <= 21) { t += 11; s = true; } else t += 1; } else t += r;
    const sub = rec(t, s);
    for (let i = 0; i < 6; i++) out[i] += (p[r] / norm) * sub[i];
  }
  return out;
}

/** EV of standing on a total against the dealer's final-total distribution. */
function stand(total, d) {
  if (total > 21) return -1;
  let ev = d[5]; // dealer busts
  for (let i = 0; i < 5; i++) { const dt = 17 + i; if (total > dt) ev += d[i]; else if (total < dt) ev -= d[i]; }
  return ev;
}

/** Best of hit/stand from (total, soft), and the EV of hitting once then playing on. */
function playerEVs(p, d) {
  const memo = new Map();
  const norm = (t, s) => (t > 21 && s ? [t - 10, false] : [t, s]);
  function best(t0, s0) {
    const [t, s] = norm(t0, s0);
    if (t > 21) return -1;
    const key = t * 2 + (s ? 1 : 0);
    if (memo.has(key)) return memo.get(key);
    const v = Math.max(stand(t, d), hit(t, s));
    memo.set(key, v);
    return v;
  }
  function hit(t, s) {
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (!p[r]) continue;
      const soft = r === 1 && t + 11 <= 21;
      ev += p[r] * best(t + (soft ? 11 : r), s || soft);
    }
    return ev;
  }
  function dbl(t, s) {
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (!p[r]) continue;
      const soft = r === 1 && t + 11 <= 21;
      const [nt] = norm(t + (soft ? 11 : r), s || soft);
      ev += p[r] * stand(nt, d);
    }
    return 2 * ev;
  }
  // One hand of a split, starting from a single card: stand, hit or double (DAS), no resplit.
  function splitHand(card) {
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (!p[r]) continue;
      const a = card === 1 ? 11 : card;
      const soft0 = card === 1 || (r === 1 && a + 11 <= 21);
      const t = a + (r === 1 && a + 11 <= 21 ? 11 : r);
      const [nt, ns] = norm(t, soft0);
      ev += p[r] * Math.max(stand(nt, d), hit(nt, ns), dbl(nt, ns));
    }
    return 2 * ev;
  }
  return { stand: (t) => stand(t, d), hit, dbl, splitHand };
}

/** EV of a play for a hand (card values, 1 = ace). */
function evOf(hand, action, p, d) {
  const E = playerEVs(p, d);
  let t = 0; let aces = 0;
  for (const r of hand) { t += r === 1 ? 11 : r; if (r === 1) aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  const soft = aces > 0;
  if (action === 'S') return E.stand(t);
  if (action === 'H') return E.hit(t, soft);
  if (action === 'D') return E.dbl(t, soft);
  if (action === 'R') return -0.5;
  if (action === 'P') return E.splitHand(hand[0]);
  throw new Error(action);
}

/** One random card from a composition, removed from it. */
function drawFrom(cc) {
  let n = 0;
  for (let r = 1; r <= 10; r++) n += cc[r];
  let x = Math.floor(Math.random() * n);
  for (let r = 1; r <= 10; r++) { if (x < cc[r]) { cc[r]--; return r; } x -= cc[r]; }
  throw new Error('empty shoe');
}

/**
 * Deal the player a hand for this play from the shoe, the way such hands come up: two
 * cards, then hits while below the total, so a "hard 16" is sometimes 10-6, sometimes
 * 9-7, sometimes 4-2-10. Doubles and surrenders need exactly two cards. Pairs that basic
 * strategy splits are skipped (they're a split decision, not this one). Removes the cards
 * from cc and returns them, or null if this shoe didn't produce one in a few tries.
 */
function dealHand(cc, play) {
  if (play.kind === 'ins') return [];
  if (play.at === 'P') { const r = val(play.cards[0]); if (cc[r] < 2) return null; cc[r] -= 2; return [r, r]; }
  const target = play.cards.reduce((a, k) => a + val(k), 0);
  const twoOnly = play.at === 'D' || play.kind === 'surrender';
  for (let tries = 0; tries < 60; tries++) {
    const tmp = cc.slice();
    const hand = [drawFrom(tmp), drawFrom(tmp)];
    if (hand[0] === hand[1] && hand[0] !== 5 && hand[0] !== 10) continue; // a pair you'd split
    let t = 0; let aces = 0;
    for (const r of hand) { t += r === 1 ? 11 : r; if (r === 1) aces++; }
    for (;;) {
      while (t > 21 && aces) { t -= 10; aces--; }
      if (t === target && aces === 0) { for (let r = 1; r <= 10; r++) cc[r] = tmp[r]; return hand; }
      if (t > 21 || twoOnly || (aces === 0 && t > target) || (aces > 0 && t >= 18)) break;
      const r = drawFrom(tmp);
      hand.push(r);
      t += r === 1 ? 11 : r;
      if (r === 1) aces++;
    }
  }
  return null;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** The count a player would act on: true count (floored, decks to the nearest half) or running count. */
function indexOf(count, rc, remaining) {
  if (count.kind === 'running') return rc;
  const decks = Math.max(0.5, Math.round((remaining / 52) * 2) / 2);
  return Math.floor(rc / decks);
}

function run(countId) {
  const count = COUNTS[countId];
  const tag = (r) => count.values[r === 1 ? 'A' : r === 10 ? 'T' : String(r)];
  /** @type {Map<string, Map<number, number>>} play id → index → summed ΔEV (at − below) */
  const sums = new Map(INDEX_PLAYS.map((x) => [x.id, new Map()]));
  const shoe = [];
  for (let r = 1; r <= 10; r++) for (let i = 0; i < (r === 10 ? 16 : 4) * DECKS; i++) shoe.push(r);
  for (let n = 0; n < SAMPLES; n++) {
    shuffle(shoe);
    const dealt = Math.floor(Math.random() * CARDS * PEN);
    const c = fullShoe();
    let rc = count.irc || 0;
    for (let i = 0; i < dealt; i++) { c[shoe[i]]--; rc += tag(shoe[i]); }
    for (const play of INDEX_PLAYS) {
      const cc = c.slice();
      const upR = play.up === 11 ? 1 : play.up;
      if (--cc[upR] < 0) continue;
      const hand = dealHand(cc, play);
      if (!hand) continue;
      const seen = [...hand, upR];
      const remaining = cc.reduce((a, b) => a + b, 0);
      const p = cc.map((x) => x / remaining);
      const idx = indexOf(count, rc + seen.reduce((a, r) => a + tag(r), 0), remaining);
      let delta;
      if (play.kind === 'ins') delta = 3 * p[10] - 1; // insurance pays 2:1 on half a bet: EV per unit of insurance
      else {
        const d = dealerDist(upR, p);
        delta = evOf(hand, play.at, p, d) - evOf(hand, play.below, p, d);
      }
      const m = sums.get(play.id);
      m.set(idx, (m.get(idx) || 0) + delta);
      if (DEBUG === play.id) { const b = (dbg[idx] ||= [0, 0]); b[0] += delta; b[1]++; }
    }
  }
  // Best index: make the `at` play at every count ≥ k. Choose k to collect the most EV.
  const out = {};
  for (const play of INDEX_PLAYS) {
    const m = sums.get(play.id);
    const keys = [...m.keys()].sort((a, b) => a - b);
    let bestK = null; let bestGain = 0; // gain relative to never deviating
    // If the `at` play is the basic play at neutral counts (e.g. stand 12v4), the index is a low one.
    for (let k = keys[0]; k <= keys[keys.length - 1] + 1; k++) {
      let gain = 0;
      for (const key of keys) if (key >= k) gain += m.get(key);
      if (bestK === null || gain > bestGain) { bestK = k; bestGain = gain; }
    }
    out[play.id] = bestK;
  }
  return out;
}

if (process.argv[2] === 'neutral') {
  // Sanity check against published 6-deck numbers at a full shoe.
  /** @type {[string[], number][]} */
  const spots = [[['T', '6'], 10], [['T', '2'], 2], [['T', '6'], 9], [['6', '4'], 10]];
  for (const [cards, up] of spots) {
    const c = fullShoe();
    for (const r of [...cards.map(val), up === 11 ? 1 : up]) c[r]--;
    const n = c.reduce((a, b) => a + b, 0);
    const p = c.map((x) => x / n);
    const d = dealerDist(up === 11 ? 1 : up, p);
    const hand = cards.map(val);
    console.log(cards.join(','), 'v', up, 'dealer', d.map((x) => x.toFixed(4)).join(' '), 'S', evOf(hand, 'S', p, d).toFixed(4), 'H', evOf(hand, 'H', p, d).toFixed(4), 'D', evOf(hand, 'D', p, d).toFixed(4));
  }
  process.exit(0);
}
const t0 = Date.now();
const results = {};
for (const id of (process.argv[3] || Object.keys(COUNTS).join(',')).split(',')) {
  results[id] = run(id);
  if (DEBUG) {
    for (const [k, [sum, n]] of Object.entries(dbg).sort((a, b) => Number(a[0]) - Number(b[0]))) console.error(`${k}: ${((sum / n) * 100).toFixed(2)}% (${n})`);
    for (const k in dbg) delete dbg[k];
  }
  console.error(`${id}: done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(JSON.stringify(results, null, 1));
