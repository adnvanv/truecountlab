// Basic strategy trainer (mode 4) with a mistake heatmap.
import { h, cardEl, head, toggle, typingInField, secs, strategyTag } from '../ui.js';
import { randInt, pick, makeCard, cardForValue, TENS } from '../cards.js';
import { basicStrategy, cellOf, cellKey, handLabel, upLabel, UPCARDS, ACTIONS, CODE_TEXT, DEFAULT_STRATEGY } from '../strategy.js';
import { addRun, scoreFor } from '../store.js';
import { sfx } from '../sfx.js';

const HARD_ROWS = ['8', '9', '10', '11', '12', '13', '14', '15', '16', '17'];
const SOFT_ROWS = ['13', '14', '15', '16', '17', '18', '19', '20'];
const PAIR_ROWS = ['A', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const COLS = UPCARDS.map(upLabel);

const rowLabel = (group, r) => (group === 'hard' ? (r === '8' ? '5–8' : r === '17' ? '17+' : r)
  : group === 'soft' ? `A,${Number(r) - 11}` : r === 'T' ? '10,10' : `${r},${r}`);
const chartCode = (chart, group, r, ci) => (group === 'hard' ? chart.hard[r][ci] : group === 'soft' ? chart.soft[r][ci] : chart.pairs[r][ci]);

export const ALL_CELLS = [
  ...HARD_ROWS.flatMap((r) => COLS.map((c) => ({ group: 'hard', row: r, col: c }))),
  ...SOFT_ROWS.flatMap((r) => COLS.map((c) => ({ group: 'soft', row: r, col: c }))),
  ...PAIR_ROWS.flatMap((r) => COLS.map((c) => ({ group: 'pair', row: r, col: c }))),
];

/** @param {Record<string, { n: number, miss: number }>} cells @param {import('../strategy.js').Strategy} [strat] */
export function heatmapEl(cells, strat = DEFAULT_STRATEGY) {
  const grid = (title, group, rows) => h('div', { class: 'heat-block' },
    h('h3', {}, title),
    h('div', { class: 'chart-scroll' }, h('table', { class: 'chart heat' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), COLS.map((c) => h('th', {}, c)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('th', {}, rowLabel(group, r)),
        COLS.map((c, ci) => {
          const d = cells[`${group}:${r}:${c}`];
          const code = chartCode(strat.chart, group, r, ci);
          if (!d || !d.n) return h('td', { class: 'none', title: 'Not tried yet' }, code);
          const rate = d.miss / d.n;
          const bg = d.miss ? `hsl(${Math.round(40 - 40 * Math.min(1, rate * 2))} 85% ${Math.round(62 - 18 * Math.min(1, rate * 2))}%)` : 'hsl(145 45% 42%)';
          return h('td', { style: `background:${bg}`, title: `${rowLabel(group, r)} vs ${c}: ${d.miss} miss${d.miss === 1 ? '' : 'es'} in ${d.n}` }, code);
        })))))));
  return h('div', { class: 'heatmap' },
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'swatch', style: 'background:hsl(145 45% 42%)' }), 'No misses'),
      h('span', {}, h('i', { class: 'swatch', style: 'background:hsl(40 85% 62%)' }), 'Some'),
      h('span', {}, h('i', { class: 'swatch', style: 'background:hsl(0 85% 44%)' }), '50%+ missed'),
      h('span', {}, h('i', { class: 'swatch none' }), 'Not tried'),
      h('span', { class: 'muted' }, 'Letters are the correct play.')),
    h('div', { class: 'heat-grids' }, grid('Hard totals', 'hard', HARD_ROWS), grid('Soft totals', 'soft', SOFT_ROWS), grid('Pairs', 'pair', PAIR_ROWS)));
}

function hardCards(total) {
  const opts = [];
  for (let a = 2; a <= 10; a++) { const b = total - a; if (b >= 2 && b <= 10 && b !== a) opts.push([a, b]); }
  const [a, b] = pick(opts);
  return [cardForValue(a), cardForValue(b)];
}

function handForCell(c) {
  let cards;
  if (c.group === 'pair') {
    cards = c.row === 'T' ? [makeCard(pick(TENS)), makeCard(pick(TENS))] : [makeCard(c.row), makeCard(c.row)];
  } else if (c.group === 'soft') {
    cards = [makeCard('A'), cardForValue(Number(c.row) - 11)];
  } else {
    const total = c.row === '8' ? 5 + randInt(4) : c.row === '17' ? 17 + randInt(3) : Number(c.row);
    cards = hardCards(total);
  }
  if (randInt(2)) cards.reverse();
  const up = c.col === 'A' ? 11 : Number(c.col);
  return { cards, up, upCard: up === 10 ? makeCard(pick(TENS)) : cardForValue(up) };
}

export function mount(root, ctx) {
  const cfg = ctx.settings.basic;
  const st = ctx.stats.basic;
  const strat = ctx.strategy;
  const since = Date.now(); // this session
  let sc = null;
  let answered = false;
  let autoTimer = null;

  const stage = h('div', { class: 'strat-stage' });
  const buttons = h('div', { class: 'actions four' });
  const result = h('div', { class: 'answer' });
  const record = h('div', { class: 'mini-stats' });
  const heat = h('div');

  root.append(h('section', { class: 'view' },
    head('Basic Strategy Trainer', 'Random hands against a dealer upcard: 6 decks, S17, double after split, no surrender. The heatmap shows where your mistakes are this session.'),
    strategyTag(strat),
    h('div', { class: 'panel toolbar' },
      toggle(cfg, 'focus', 'Focus on my mistakes', () => ctx.save()),
      toggle(cfg, 'auto', 'Auto-advance when correct', () => ctx.save())),
    stage, buttons, result, record,
    h('div', { class: 'chart-block' }, h('h2', {}, 'Mistake heatmap'), heat)));

  function pickCell() {
    if (!cfg.focus) return pick(ALL_CELLS);
    const weights = ALL_CELLS.map((c) => {
      const d = st.cells[cellKey(c)];
      return !d || !d.n ? 1.5 : 1 + 12 * (d.miss / d.n);
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let k = 0; k < ALL_CELLS.length; k++) { r -= weights[k]; if (r <= 0) return ALL_CELLS[k]; }
    return ALL_CELLS[0];
  }

  function next() {
    clearTimeout(autoTimer);
    sc = { ...handForCell(pickCell()), t: performance.now() };
    answered = false;
    result.replaceChildren();
    const pair = sc.cards[0].rank === sc.cards[1].rank || (TENS.includes(sc.cards[0].rank) && TENS.includes(sc.cards[1].rank));
    stage.replaceChildren(
      h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, 'Dealer'), h('div', { class: 'hand' }, cardEl(sc.upCard))),
      h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, `You · ${handLabel(sc.cards)}`), h('div', { class: 'hand' }, sc.cards.map((c) => cardEl(c)))));
    buttons.replaceChildren(...['H', 'S', 'D', 'P'].map((a) => h('button', {
      class: `btn act act-${a}`, disabled: a === 'P' && !pair, 'data-k': a, onclick: () => answer(a),
    }, h('span', {}, ACTIONS[a]), h('kbd', {}, a))));
  }

  function answer(a) {
    if (answered) return;
    answered = true;
    const o = { canDouble: true, canSplit: true };
    const b = basicStrategy(sc.cards, sc.up, o, strat);
    const ok = a === b.action;
    scoreFor('plays', ok);
    if (ok) sfx.right(); else sfx.wrong();
    const cell = cellOf(sc.cards, sc.up);
    const key = cellKey(cell);
    const d = (st.cells[key] ||= { n: 0, miss: 0 });
    d.n++;
    if (!ok) d.miss++;
    const ms = performance.now() - sc.t;
    addRun(st, { ok, ms: Math.round(ms), cell: key, want: b.action, chose: a });
    ctx.save();
    for (const btn of buttons.querySelectorAll('button')) {
      btn.disabled = true;
      if (btn.dataset.k === b.action) btn.classList.add('right');
      if (!ok && btn.dataset.k === a) btn.classList.add('wrong');
    }
    const label = `${handLabel(sc.cards)} vs ${upLabel(sc.up)}`;
    result.replaceChildren(
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` }, ok ? `✓ ${ACTIONS[a]}` : `✗ ${label}: ${CODE_TEXT[b.code]}`, h('span', { class: 'muted' }, ` · ${secs(ms)}`)),
      ...(ok ? [] : [h('div', { class: 'muted' }, `You chose ${ACTIONS[a]}.`)]),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: next }, 'Next', h('kbd', {}, 'Enter'))));
    renderRecord();
    if (ok && cfg.auto) autoTimer = setTimeout(next, 700);
  }

  // Practice shows this session only; signed-in players see all-time numbers on Stats.
  function renderRecord() {
    const runs = st.runs.filter((r) => r.t >= since);
    let streak = 0;
    for (let k = runs.length - 1; k >= 0 && runs[k].ok; k--) streak++;
    const last50 = runs.slice(-50);
    /** @type {Record<string, { n: number, miss: number }>} */
    const cells = {};
    for (const r of runs) {
      if (!r.cell) continue;
      const c = (cells[r.cell] ||= { n: 0, miss: 0 });
      c.n++;
      if (!r.ok) c.miss++;
    }
    record.replaceChildren(
      h('span', {}, `Streak ${streak}`),
      h('span', {}, `This session: ${runs.length ? Math.round((100 * runs.filter((r) => r.ok).length) / runs.length) : 0}% (${runs.length})`),
      ...(runs.length > 50 ? [h('span', {}, `Last 50: ${Math.round((100 * last50.filter((r) => r.ok).length) / last50.length)}%`)] : []));
    heat.replaceChildren(heatmapEl(cells, strat));
  }

  function onKey(e) {
    if (typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (answered && (k === 'enter' || k === ' ')) { e.preventDefault(); next(); return; }
    if (!answered && k.length === 1 && 'hsdp'.includes(k)) {
      const btn = buttons.querySelector(`[data-k="${k.toUpperCase()}"]`);
      if (btn && !btn.disabled) answer(k.toUpperCase());
    }
  }
  addEventListener('keydown', onKey);
  renderRecord();
  next();

  return () => { clearTimeout(autoTimer); removeEventListener('keydown', onKey); };
}
