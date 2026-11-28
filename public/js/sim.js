// Monte Carlo blackjack for a strategy: plays whole shoes exactly as the strategy says
// (chart, index plays, insurance, bet ramp) and measures the player's edge. Used by the
// strategy editor (in a worker, see edge-worker.js) and by scripts/preset-edges.mjs.
// Rules: 6 decks, S17, dealer peeks, DAS, split to 4 hands, split aces get one card,
// 3:2 blackjack, 75% penetration, optional late surrender. The player counts perfectly
// and estimates decks to the nearest half deck, like the trainer grades.
import { RULES } from './cards.js';

const CODE = { H: 0, S: 1, D: 2, Ds: 3, P: 4 };
const ACT = { H: 0, S: 1, D: 2, P: 4, R: 5 };
const RK = { A: 1, T: 10 };
const rk = (k) => RK[k] ?? Number(k);

/** Lookup tables for fast play. @param {import('./strategy.js').Strategy} s */
function compile(s) {
  const up = (u) => (u === 11 ? 1 : u); // the sim stores aces as 1
  const hard = []; const soft = []; const pairs = [];
  for (let t = 0; t <= 21; t++) { hard[t] = new Int8Array(11); soft[t] = new Int8Array(11); }
  for (let r = 0; r <= 10; r++) pairs[r] = new Int8Array(11);
  for (let u = 2; u <= 11; u++) {
    const col = u - 2;
    for (let t = 4; t <= 21; t++) hard[t][up(u)] = t >= 18 ? CODE.S : CODE[s.chart.hard[Math.max(8, Math.min(17, t))][col]];
    for (let t = 12; t <= 21; t++) soft[t][up(u)] = t >= 21 ? CODE.S : CODE[(s.chart.soft[t] || s.chart.soft[Math.min(20, t)])[col]] ?? CODE.S;
    for (const [k, row] of Object.entries(s.chart.pairs)) pairs[rk(k)][up(u)] = CODE[row[col]];
  }
  const key = (t, u) => t * 16 + up(u);
  const hardDev = new Map(); const pairDev = new Map(); const surrDev = new Map();
  let ins = Infinity;
  for (const d of s.devs) {
    const v = { tc: d.tc, at: ACT[d.at], below: ACT[d.below] };
    if (d.kind === 'ins') ins = d.tc;
    else if (d.kind === 'surrender') surrDev.set(key(d.total, d.up), v);
    else if (d.pair) pairDev.set(key(rk(d.pair), d.up), v);
    else hardDev.set(key(d.total, d.up), v);
  }
  const tags = new Int8Array(11);
  for (const [k, v] of Object.entries(s.count.values)) tags[rk(k)] = v;
  const ramp = [...s.ramp].sort((a, b) => a.at - b.at);
  return { hard, soft, pairs, hardDev, pairDev, surrDev, ins, tags, ramp, key, running: s.count.kind === 'running', irc: s.count.kind === 'running' ? s.count.irc || 0 : 0 };
}

/**
 * Simulate `rounds` rounds. Returns sums so batches can be combined.
 * @param {import('./strategy.js').Strategy} strategy
 * @param {{ rounds: number, surrender?: boolean, state?: any, track?: Record<number, number[]> }} opts
 *   state carries the shoe between batches; track collects [rounds, flat result] by the count at the bet
 */
export function simulate(strategy, { rounds, surrender = false, state, track }) {
  const S = compile(strategy);
  const N = RULES.decks * 52;
  const cut = Math.floor(N * RULES.penetration);
  const st = state || { shoe: new Int8Array(N), pos: N, rc: 0 };
  const shoe = st.shoe;
  let pos = st.pos;
  let rc = st.rc;
  function shuffle() {
    let i = 0;
    for (let r = 1; r <= 10; r++) for (let n = (r === 10 ? 16 : 4) * RULES.decks; n > 0; n--) shoe[i++] = r;
    for (let j = N - 1; j > 0; j--) { const k = (Math.random() * (j + 1)) | 0; const t = shoe[j]; shoe[j] = shoe[k]; shoe[k] = t; }
    pos = 0;
    rc = S.irc;
  }
  const draw = () => { const c = shoe[pos++]; rc += S.tags[c]; return c; };
  const index = () => {
    if (S.running) return rc;
    const decks = Math.max(0.5, Math.round(((N - pos) / 52) * 2) / 2);
    return Math.floor(rc / decks);
  };
  const units = (idx) => { let u = 1; for (const r of S.ramp) if (idx >= r.at) u = r.units; return u; };

  let flatWin = 0; let flatSq = 0; let rampWin = 0; let rampSq = 0; let rampBet = 0;
  // Hands in play this round (up to 4 after splits): total, soft, card count, bet (1 or 2
  // when doubled), aces counted as 11, split aces, surrendered.
  const hT = new Int16Array(4); const hSoft = new Int8Array(4); const hN = new Int8Array(4);
  const hBet = new Int8Array(4); const hAces = new Int8Array(4);
  const hSplitAces = new Int8Array(4); const hSurr = new Int8Array(4);

  const addCard = (i, c) => {
    hN[i]++;
    hT[i] += c === 1 ? 11 : c;
    if (c === 1) hAces[i]++;
    while (hT[i] > 21 && hAces[i]) { hT[i] -= 10; hAces[i]--; }
    hSoft[i] = hAces[i] > 0 ? 1 : 0;
  };

  for (let n = 0; n < rounds; n++) {
    if (pos === N || pos >= cut) shuffle();
    if (N - pos < 20) shuffle();
    const idx0 = index();
    const u = units(idx0);
    let hands = 1;
    hT[0] = 0; hAces[0] = 0; hN[0] = 0; hBet[0] = 1; hSplitAces[0] = 0; hSurr[0] = 0;
    const c1 = draw(); const up = draw(); const c2 = draw();
    addCard(0, c1); addCard(0, c2);
    hCards[0] = [c1, c2];
    const hole = shoe[pos++]; // counted when it's turned over
    let result = 0; // in units of the initial bet
    const dealerBJ = (up === 1 && hole === 10) || (up === 10 && hole === 1);
    if (up === 1 && index() >= S.ins) result += dealerBJ ? 1 : -0.5; // insurance: half a bet at 2:1
    const playerBJ = hT[0] === 21;
    if (dealerBJ || playerBJ) {
      rc += S.tags[hole];
      if (playerBJ && !dealerBJ) result += 1.5;
      else if (dealerBJ && !playerBJ) result -= 1;
    } else {
      // Player decisions, hand by hand.
      for (let i = 0; i < hands; i++) {
        if (hN[i] === 1) { const c = draw(); addCard(i, c); hCards[i].push(c); } // a split hand's second card
        if (hSplitAces[i]) continue;
        for (;;) {
          const t = hT[i];
          if (t >= 21) break;
          const two = hN[i] === 2;
          const idx = index();
          // Surrender (first two cards, before any split).
          if (surrender && two && hands === 1) {
            const d = S.surrDev.get(S.key(t, up === 1 ? 11 : up));
            if (d && !hSoft[i] && idx >= d.tc) { hSurr[i] = 1; break; }
          }
          let act;
          const isPair = two && hands < 4 && hCards[i][0] === hCards[i][1];
          if (isPair) {
            const pr = hCards[i][0];
            const pd = S.pairDev.get(S.key(pr, up === 1 ? 11 : up));
            if (pd) act = idx >= pd.tc ? pd.at : pd.below;
            else if (S.pairs[pr][up] === CODE.P) act = ACT.P;
          }
          if (act === undefined) {
            const code = hSoft[i] ? S.soft[t][up] : S.hard[t][up];
            act = code === CODE.Ds ? (two ? ACT.D : ACT.S) : code === CODE.D ? (two ? ACT.D : ACT.H) : code === CODE.P ? ACT.H : code;
            if (!hSoft[i]) {
              const d = S.hardDev.get(S.key(t, up === 1 ? 11 : up));
              if (d) { act = idx >= d.tc ? d.at : d.below; if (act === ACT.D && !two) act = ACT.H; }
            }
          }
          if (act === ACT.P && !(two && hands < 4)) act = ACT.H;
          if (act === ACT.S) break;
          if (act === ACT.H) { const c = draw(); addCard(i, c); hCards[i].push(c); continue; }
          if (act === ACT.D) { hBet[i] = 2; const c = draw(); addCard(i, c); hCards[i].push(c); break; }
          if (act === ACT.P) {
            const pr = hCards[i][0];
            const j = hands++;
            hT[i] = 0; hAces[i] = 0; hN[i] = 0; addCard(i, pr); hCards[i] = [pr];
            hT[j] = 0; hAces[j] = 0; hN[j] = 0; hBet[j] = 1; hSurr[j] = 0; addCard(j, pr); hCards[j] = [pr];
            hSplitAces[i] = hSplitAces[j] = pr === 1 ? 1 : 0;
            const c = draw(); addCard(i, c); hCards[i].push(c);
            if (pr === 1) { const c2 = draw(); addCard(j, c2); hCards[j].push(c2); break; }
            continue;
          }
          break;
        }
      }
      // Dealer.
      rc += S.tags[hole];
      let live = false;
      for (let i = 0; i < hands; i++) if (!hSurr[i] && hT[i] <= 21) live = true;
      let dT = (up === 1 ? 11 : up) + (hole === 1 ? 11 : hole);
      let dA = (up === 1 ? 1 : 0) + (hole === 1 ? 1 : 0);
      while (dT > 21 && dA) { dT -= 10; dA--; }
      if (live) {
        while (dT < 17) { const c = draw(); dT += c === 1 ? 11 : c; if (c === 1) dA++; while (dT > 21 && dA) { dT -= 10; dA--; } }
      }
      for (let i = 0; i < hands; i++) {
        const b = hBet[i];
        if (hSurr[i]) { result -= 0.5; continue; }
        const t = hT[i];
        if (t > 21) result -= b;
        else if (dT > 21 || t > dT) result += b;
        else if (t < dT) result -= b;
      }
    }
    if (track) { const b = (track[idx0] ||= [0, 0]); b[0]++; b[1] += result; }
    flatWin += result; flatSq += result * result;
    rampWin += result * u; rampSq += result * result * u * u; rampBet += u;
  }
  st.pos = pos; st.rc = rc;
  return { rounds, flatWin, flatSq, rampWin, rampSq, rampBet, state: st };
}

// The cards of each hand, for pair checks (kept outside the typed arrays: they're short).
/** @type {number[][]} */
const hCards = [[], [], [], []];

/** Combine batch sums into edges (% of money bet) with standard errors. */
export function edgeOf(sum) {
  const n = sum.rounds;
  const flat = sum.flatWin / n;
  const flatSE = Math.sqrt(Math.max(0, sum.flatSq / n - flat * flat) / n);
  const meanBet = sum.rampBet / n;
  const ramp = sum.rampWin / sum.rampBet;
  const perRound = sum.rampWin / n;
  const rampSE = Math.sqrt(Math.max(0, sum.rampSq / n - perRound * perRound) / n) / meanBet;
  return { hands: n, flat: flat * 100, flatSE: flatSE * 100, ramp: ramp * 100, rampSE: rampSE * 100, meanBet };
}
