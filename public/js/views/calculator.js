// Bankroll calculator: hourly EV, standard deviation and risk of ruin for this game.
import { h, head, field, money } from '../ui.js';

// Share of rounds at each floored true count (half-deck estimates) and the average
// exact true count inside that bucket. Simulated: 6 decks, 75% penetration,
// 3 players + dealer, 200,000 shoes. Ends are clamped (≤ −6, ≥ +8).
export const TC_DIST = [
  [-6, 0.0252, -6.6], [-5, 0.0176, -4.62], [-4, 0.0388, -3.58], [-3, 0.0576, -2.6], [-2, 0.125, -1.56],
  [-1, 0.195, -0.56], [0, 0.2679, 0.31], [1, 0.1127, 1.35], [2, 0.0737, 2.32], [3, 0.0348, 3.32],
  [4, 0.0244, 4.28], [5, 0.011, 5.27], [6, 0.008, 6.18], [7, 0.0034, 7.18], [8, 0.0048, 8.89],
];
const BASE_EDGE = -0.004; // 6D S17 DAS 3:2, no surrender, perfect basic strategy
const PER_TC = 0.005; // each true count is worth about +0.5%
const VAR = 1.32; // variance per hand, in units²

// Same shape as the $25/$50/$75 ramp: 1 unit at ≤ +1, halfway at +2/+3, the full spread at +4 and up.
export const unitsAt = (tc, spread) => (tc <= 1 ? 1 : tc <= 3 ? 1 + (spread - 1) / 2 : spread);

export function calc({ bankroll, unit, spread, hands }) {
  const rows = TC_DIST.map(([tc, f, raw]) => {
    const u = unitsAt(tc, spread);
    const edge = BASE_EDGE + PER_TC * raw;
    return { tc, f, u, edge };
  });
  const totalF = rows.reduce((s, r) => s + r.f, 0);
  const ev = rows.reduce((s, r) => s + r.f * r.u * r.edge, 0) / totalF; // units per hand
  const v = rows.reduce((s, r) => s + r.f * r.u * r.u * VAR, 0) / totalF - ev * ev; // units² per hand
  const avgBet = rows.reduce((s, r) => s + r.f * r.u, 0) / totalF;
  const bUnits = bankroll / unit;
  const ror = ev <= 0 ? 1 : Math.exp((-2 * ev * bUnits) / v);
  return {
    rows,
    evHour: ev * hands * unit,
    sdHour: Math.sqrt(v * hands) * unit,
    ror,
    evPerHand: ev,
    edgePct: (100 * ev) / avgBet,
    avgBet: avgBet * unit,
    n0: ev > 0 ? v / (ev * ev) : Infinity,
    bUnits,
  };
}

export function mount(root, ctx) {
  const cfg = ctx.settings.calc;
  const out = h('div');
  const input = (key, attrs) => h('input', {
    type: 'number', class: 'num wide', inputmode: 'decimal', value: cfg[key], ...attrs,
    oninput: (e) => { const v = Number(e.target.value); if (v > 0) { cfg[key] = v; ctx.save(); draw(); } },
  });

  root.append(h('section', { class: 'view' },
    head('Bankroll Calculator', 'Estimated results for this game (6 decks, S17, DAS, 3:2, 75% penetration) with Hi-Lo, playing every hand on a ramp shaped like yours.'),
    h('div', { class: 'panel form-grid' }, h('div', { class: 'form-row' },
      field('Bankroll ($)', input('bankroll', { min: 1, step: 100 })),
      field('Unit size ($)', input('unit', { min: 1, step: 5 })),
      field('Spread (max units)', input('spread', { min: 1, max: 50, step: 1 }), '3 = your $25–$75 ramp'),
      field('Hands per hour', input('hands', { min: 1, step: 10 }), '~60 full table · ~100 with 2–3 players · ~200 heads-up'))),
    out));

  function draw() {
    const r = calc(cfg);
    const big = (label, value, sub, cls = '') => h('div', { class: `kpi big ${cls}` }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 'muted' }, sub) : null);
    const rorPct = r.ror >= 0.9995 ? '100%' : r.ror < 0.0005 ? '< 0.1%' : `${(r.ror * 100).toFixed(1)}%`;
    out.replaceChildren(
      h('div', { class: 'kpis three' },
        big('Hourly EV', money(Math.round(r.evHour * 100) / 100, { sign: true }), `${(r.edgePct).toFixed(2)}% edge on an average bet of ${money(Math.round(r.avgBet))}`, r.evHour > 0 ? 'good' : 'bad'),
        big('Standard deviation', `${money(Math.round(r.sdHour))}/hr`, `Swings of ±${money(Math.round(r.sdHour * 2))} in an hour are normal (2 SD)`),
        big('Risk of ruin', rorPct, r.ror >= 1 ? 'No edge: losing the bankroll is certain over time' : `Chance of losing ${money(cfg.bankroll)} (${Math.round(r.bUnits)} units) playing forever`, r.ror > 0.2 ? 'bad' : r.ror > 0.05 ? 'warn' : 'good')),
      r.evHour <= 0
        ? h('div', { class: 'panel note' }, `At a 1–${cfg.spread} spread, the high counts don't come up often enough to beat the house edge. A wider spread (try 8–12), more hands at high counts (leave or sit out negative counts), or better penetration is needed for a positive EV.`)
        : h('div', { class: 'muted calc-extra' }, `Hours to be ~84% sure you're ahead (N0): ${Number.isFinite(r.n0) ? Math.round(r.n0 / cfg.hands).toLocaleString() : '—'}.`),
      h('div', { class: 'chart-block' },
        h('h2', {}, 'How the estimate is built'),
        h('div', { class: 'chart-scroll' }, h('table', { class: 'devs' },
          h('thead', {}, h('tr', {}, ['True count', 'Share of hands', 'Bet', 'Player edge'].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.rows.map((x) => h('tr', {},
            h('td', { class: 'mono' }, x.tc === -6 ? '≤ −6' : x.tc === 8 ? '≥ +8' : (x.tc > 0 ? `+${x.tc}` : String(x.tc))),
            h('td', {}, `${(x.f * 100).toFixed(1)}%`),
            h('td', {}, `${money(Math.round(x.u * cfg.unit * 100) / 100)} (${Math.round(x.u * 10) / 10}u)`),
            h('td', { class: x.edge > 0 ? 'good' : 'bad' }, `${(x.edge * 100).toFixed(2)}%`)))))),
        h('p', { class: 'muted' }, 'Assumptions: off-the-top house edge 0.40% with perfect basic strategy, +0.5% per true count, variance 1.32 units² per hand, every hand played. Count frequencies were simulated for this exact game. Index plays add a little EV that isn’t counted here, so treat this as slightly conservative. Risk of ruin uses the standard formula e^(−2·EV·bankroll / variance).')));
  }
  draw();
}
