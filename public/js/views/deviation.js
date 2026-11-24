// Deviation trainer (mode 5): a hand plus a true count — basic play or deviation?
import { h, cardEl, signed, secs, head, toggle, typingInField, pct } from '../ui.js';
import { randInt, pick, makeCard, cardForValue, TENS } from '../cards.js';
import { DEVS, correctAction, insuranceCorrect, devNote, ACTIONS, handLabel, upLabel } from '../strategy.js';
import { addRun } from '../store.js';

export const DEV_ERRORS = {
  missed: 'Played basic when the count called for the deviation',
  early: 'Deviated when the count was below the index',
  other: 'Wrong play entirely',
};

function hardCards(total) {
  const opts = [];
  for (let a = 2; a <= 10; a++) { const b = total - a; if (b >= 2 && b <= 10 && b !== a) opts.push([a, b]); }
  const [a, b] = pick(opts);
  const cards = [cardForValue(a), cardForValue(b)];
  return randInt(2) ? cards.reverse() : cards;
}

export function mount(root, ctx) {
  const cfg = ctx.settings.deviation;
  const st = ctx.stats.deviation;
  let sc = null;
  let answered = false;
  let autoTimer = null;

  const stage = h('div', { class: 'strat-stage' });
  const buttons = h('div', { class: 'actions four' });
  const result = h('div', { class: 'answer' });
  const record = h('div', { class: 'mini-stats' });
  const table = h('div');

  root.append(h('section', { class: 'view' },
    head('Deviation Trainer', 'Each hand comes with a true count. Decide whether basic strategy holds or the count deviation applies. Counts are drawn within ±3 of each index, so you see both sides of the line.'),
    h('div', { class: 'panel toolbar' }, toggle(cfg, 'auto', 'Auto-advance when correct', () => ctx.save())),
    stage, buttons, result, record,
    h('div', { class: 'chart-block' }, h('h2', {}, 'By deviation'), table)));

  function next() {
    clearTimeout(autoTimer);
    const d = pick(DEVS);
    const tc = d.tc + randInt(7) - 3;
    const cards = d.id === 'ins' ? hardCards(5 + randInt(15)) : hardCards(d.total);
    const upCard = d.up === 10 ? makeCard(pick(TENS)) : cardForValue(d.up);
    sc = { d, tc, cards, up: d.up, upCard, t: performance.now() };
    answered = false;
    result.replaceChildren();
    stage.replaceChildren(
      h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, 'Dealer'), h('div', { class: 'hand' }, cardEl(upCard))),
      h('div', { class: 'strat-q' }, h('div', { class: 'tc-pill mono' }, `True count ${signed(tc)}`), d.id === 'ins' ? h('div', {}, 'Dealer offers insurance.') : null),
      h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, `You · ${handLabel(cards)}`), h('div', { class: 'hand' }, cards.map((c) => cardEl(c)))));
    const acts = d.id === 'ins'
      ? [['Y', 'Insure'], ['N', 'No insurance']]
      : ['H', 'S', 'D'].map((a) => [a, ACTIONS[a]]);
    buttons.replaceChildren(...acts.map(([k, label]) => h('button', { class: `btn act act-${k}`, 'data-k': k, onclick: () => answer(k) }, h('span', {}, label), h('kbd', {}, k))));
  }

  function answer(a) {
    if (answered) return;
    answered = true;
    const { d, tc } = sc;
    let want;
    let basic;
    if (d.id === 'ins') { want = insuranceCorrect(tc) ? 'Y' : 'N'; basic = 'N'; }
    else {
      const r = correctAction(sc.cards, sc.up, { canDouble: true, canSplit: false }, tc);
      want = r.action;
      basic = r.basic;
    }
    const ok = a === want;
    const devPlay = d.at;
    const err = ok ? null : want === devPlay && a === basic ? 'missed' : want === basic && a === devPlay ? 'early' : 'other';
    const ms = performance.now() - sc.t;
    addRun(st, { ok, ms: Math.round(ms), dev: d.id, tc, want, chose: a, err });
    ctx.save();
    for (const btn of buttons.querySelectorAll('button')) {
      btn.disabled = true;
      if (btn.dataset.k === want) btn.classList.add('right');
      if (!ok && btn.dataset.k === a) btn.classList.add('wrong');
    }
    const side = tc >= d.tc ? `TC ${signed(tc)} is at or above ${signed(d.tc)} → deviate` : `TC ${signed(tc)} is below ${signed(d.tc)} → basic strategy`;
    result.replaceChildren(
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` }, ok ? `✓ ${ACTIONS[want]}` : `✗ Correct play: ${ACTIONS[want]}`, h('span', { class: 'muted' }, ` · ${secs(ms)}`)),
      h('div', { class: 'muted' }, `${devNote(d)}. ${side}.`),
      err ? h('div', { class: 'warn' }, DEV_ERRORS[err]) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: next }, 'Next', h('kbd', {}, 'Enter'))));
    renderRecord();
    if (ok && cfg.auto) autoTimer = setTimeout(next, 900);
  }

  function renderRecord() {
    const runs = st.runs;
    let streak = 0;
    for (let k = runs.length - 1; k >= 0 && runs[k].ok; k--) streak++;
    record.replaceChildren(
      h('span', {}, `Streak ${streak}`),
      h('span', {}, `Accuracy ${pct(runs.filter((r) => r.ok).length, runs.length)} (${runs.length})`));
    table.replaceChildren(h('div', { class: 'chart-scroll' }, h('table', { class: 'devs' },
      h('thead', {}, h('tr', {}, ['Deviation', 'Index', 'Tries', 'Accuracy', 'Missed', 'Too early'].map((t) => h('th', {}, t)))),
      h('tbody', {}, DEVS.map((d) => {
        const rs = runs.filter((r) => r.dev === d.id);
        return h('tr', {},
          h('td', {}, d.name), h('td', { class: 'mono' }, signed(d.tc)), h('td', {}, rs.length),
          h('td', {}, pct(rs.filter((r) => r.ok).length, rs.length)),
          h('td', {}, rs.filter((r) => r.err === 'missed').length), h('td', {}, rs.filter((r) => r.err === 'early').length));
      })))));
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
