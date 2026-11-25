// Deviation trainer (mode 5): a hand plus a true count — basic play, the deviation, or wrong?
import { h, cardEl, signed, secs, head, field, select, toggle, typingInField, pct } from '../ui.js';
import { randInt, pick, makeCard, cardForValue, TENS } from '../cards.js';
import { activeDevs, basicStrategy, correctAction, insuranceCorrect, devNote, ACTIONS, DEV_GROUPS, handLabel } from '../strategy.js';
import { addRun } from '../store.js';
import { sfx } from '../sfx.js';

export const DEV_ERRORS = {
  missed: 'Picked basic strategy when the deviation applied',
  early: 'Picked the deviation when basic strategy applied',
  other: 'Picked a wrong play (neither basic nor the deviation)',
};
const PICKED = { basic: 'basic strategy', deviation: 'the deviation', wrong: 'a wrong play' };

function hardCards(total) {
  const opts = [];
  for (let a = 2; a <= 10; a++) { const b = total - a; if (b >= 2 && b <= 10 && b !== a) opts.push([a, b]); }
  const [a, b] = pick(opts);
  const cards = [cardForValue(a), cardForValue(b)];
  return randInt(2) ? cards.reverse() : cards;
}

// Miss rate per deviation over its last 30 tries (untried ones count as worth practicing).
function weightsFor(devs, runs) {
  return devs.map((d) => {
    const rs = runs.filter((r) => r.dev === d.id).slice(-30);
    if (!rs.length) return 2;
    const miss = rs.filter((r) => !r.ok).length / rs.length;
    return 0.6 + 8 * miss + (rs.length < 5 ? 1 : 0);
  });
}

function weightedPick(items, weights) {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export function mount(root, ctx) {
  const S = ctx.settings;
  const cfg = S.deviation;
  const st = ctx.stats.deviation;
  const devs = activeDevs(S.surrender);
  let sc = null;
  let answered = false;
  let autoTimer = null;

  const stage = h('div', { class: 'strat-stage' });
  const buttons = h('div', { class: 'actions four' });
  const result = h('div', { class: 'answer' });
  const record = h('div', { class: 'mini-stats' });
  const table = h('div');

  root.append(h('section', { class: 'view' },
    head('Deviation Trainer', `Each hand shows its true count. Decide whether basic strategy holds or the count deviation applies. ${devs.length} deviations${S.surrender ? ' (including surrender)' : ''}. Surrender can be turned on in Settings.`),
    h('div', { class: 'panel toolbar' },
      field('Drill', select([
        ['mixed', 'Mixed counts (index ±3)'],
        ['threshold', 'Threshold drill (just below / at / just above)'],
      ], cfg.mode, (v) => { cfg.mode = v; ctx.save(); next(); })),
      toggle(cfg, 'focus', 'Focus on the ones I miss', () => ctx.save()),
      toggle(cfg, 'auto', 'Auto-advance when correct', () => ctx.save())),
    stage, buttons, result, record,
    h('div', { class: 'chart-block' }, h('h2', {}, 'By deviation'), table)));

  function next() {
    clearTimeout(autoTimer);
    const d = cfg.focus ? weightedPick(devs, weightsFor(devs, st.runs)) : pick(devs);
    const offset = cfg.mode === 'threshold' ? pick([-1, 0, 0, 1]) : randInt(7) - 3;
    const tc = d.tc + offset;
    const cards = d.kind === 'ins' ? hardCards(5 + randInt(15)) : hardCards(d.total);
    const upCard = d.up === 10 ? makeCard(pick(TENS)) : cardForValue(d.up);
    sc = { d, tc, cards, up: d.up, upCard, t: performance.now() };
    answered = false;
    result.replaceChildren();
    stage.replaceChildren(
      h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, 'Dealer'), h('div', { class: 'hand' }, cardEl(upCard))),
      h('div', { class: 'strat-q' }, h('div', { class: 'tc-pill mono big-pill' }, `True count ${signed(tc)}`), d.kind === 'ins' ? h('div', {}, 'Dealer offers insurance.') : null),
      h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, `You · ${handLabel(cards)}`), h('div', { class: 'hand' }, cards.map((c) => cardEl(c)))));
    const acts = d.kind === 'ins'
      ? [['Y', 'Insure'], ['N', 'No insurance']]
      : ['H', 'S', 'D'].concat(S.surrender ? ['R'] : []).map((a) => [a, ACTIONS[a]]);
    buttons.replaceChildren(...acts.map(([k, label]) => h('button', { class: `btn act act-${k}`, 'data-k': k, onclick: () => answer(k) }, h('span', {}, label), h('kbd', {}, k))));
  }

  function answer(a) {
    if (answered) return;
    answered = true;
    const { d, tc } = sc;
    let want;
    let basic;
    if (d.kind === 'ins') {
      want = insuranceCorrect(tc) ? 'Y' : 'N';
      basic = 'N';
    } else {
      const o = { canDouble: true, canSplit: false, canSurrender: S.surrender };
      want = correctAction(sc.cards, sc.up, o, tc).action;
      basic = basicStrategy(sc.cards, sc.up, o).action;
    }
    const ok = a === want;
    if (ok) sfx.right(); else sfx.wrong();
    // The deviation play is whichever side differs from basic (for low-count hits, that's the hit).
    const devPlay = d.at !== basic ? d.at : d.below;
    const picked = a === basic ? 'basic' : a === devPlay ? 'deviation' : 'wrong';
    const err = ok ? null : picked === 'basic' ? 'missed' : picked === 'deviation' ? 'early' : 'other';
    const ms = performance.now() - sc.t;
    addRun(st, { ok, ms: Math.round(ms), dev: d.id, tc, offset: tc - d.tc, want, chose: a, picked, err });
    ctx.save();
    for (const btn of buttons.querySelectorAll('button')) {
      btn.disabled = true;
      if (btn.dataset.k === want) btn.classList.add('right');
      if (!ok && btn.dataset.k === a) btn.classList.add('wrong');
    }
    const wantKind = want === basic ? 'basic strategy' : 'the deviation';
    const side = tc >= d.tc ? `TC ${signed(tc)} is at or above ${signed(d.tc)}` : `TC ${signed(tc)} is below ${signed(d.tc)}`;
    result.replaceChildren(
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` },
        ok ? `✓ ${ACTIONS[want]}` : `✗ Correct play: ${ACTIONS[want]}`, h('span', { class: 'muted' }, ` · ${secs(ms)}`)),
      h('div', { class: 'picked' },
        h('span', { class: `pill ${picked}` }, `You picked ${PICKED[picked]}`),
        h('span', { class: 'muted' }, ` — the right answer was ${wantKind} (${ACTIONS[want]}).`)),
      h('div', { class: 'muted' }, `${devNote(d)}. ${side}.`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: next }, 'Next', h('kbd', {}, 'Enter'))));
    renderRecord();
    if (ok && cfg.auto) autoTimer = setTimeout(next, 900);
  }

  function renderRecord() {
    const runs = st.runs;
    let streak = 0;
    for (let k = runs.length - 1; k >= 0 && runs[k].ok; k--) streak++;
    const near = runs.filter((r) => r.offset != null && Math.abs(r.offset) <= 1);
    record.replaceChildren(
      h('span', {}, `Streak ${streak}`),
      h('span', {}, `Accuracy ${pct(runs.filter((r) => r.ok).length, runs.length)} (${runs.length})`),
      h('span', {}, `Last 100 ${pct(runs.slice(-100).filter((r) => r.ok).length, Math.min(100, runs.length))}`),
      h('span', {}, `Within ±1 of the index ${pct(near.filter((r) => r.ok).length, near.length)}`));
    const rows = [];
    for (const [g, label] of Object.entries(DEV_GROUPS)) {
      const ds = devs.filter((d) => d.group === g);
      if (!ds.length) continue;
      rows.push(h('tr', { class: 'group-row' }, h('td', { colspan: 7 }, label)));
      for (const d of ds) {
        const rs = runs.filter((r) => r.dev === d.id);
        const acc = rs.length ? rs.filter((r) => r.ok).length / rs.length : null;
        rows.push(h('tr', { class: acc != null && acc < 0.9 && rs.length >= 3 ? 'weak-row' : '' },
          h('td', {}, d.kind === 'surrender' ? `${d.name} (surrender)` : d.name), h('td', { class: 'mono' }, signed(d.tc)), h('td', {}, rs.length),
          h('td', {}, pct(rs.filter((r) => r.ok).length, rs.length)),
          h('td', {}, rs.filter((r) => r.err === 'missed').length), h('td', {}, rs.filter((r) => r.err === 'early').length),
          h('td', {}, rs.filter((r) => r.err === 'other').length)));
      }
    }
    table.replaceChildren(h('div', { class: 'chart-scroll' }, h('table', { class: 'devs' },
      h('thead', {}, h('tr', {}, ['Deviation', 'Index', 'Tries', 'Accuracy', 'Picked basic', 'Picked dev early', 'Wrong play'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows))));
  }

  function onKey(e) {
    if (typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (answered && (k === 'enter' || k === ' ')) { e.preventDefault(); next(); return; }
    if (!answered && k.length === 1) {
      const btn = buttons.querySelector(`[data-k="${k.toUpperCase()}"]`);
      if (btn && !btn.disabled) answer(k.toUpperCase());
    }
  }
  addEventListener('keydown', onKey);
  renderRecord();
  next();

  return () => { clearTimeout(autoTimer); removeEventListener('keydown', onKey); };
}
