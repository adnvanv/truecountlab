// Bet sizing drill (mode 6): see the count, pick the bet.
import { h, signed, secs, head, field, select, trayEl, typingInField, money, pct } from '../ui.js';
import { RULES, BETS, betFor, randInt, decksEstimate, trueCount } from '../cards.js';
import { addRun } from '../store.js';

export function mount(root, ctx) {
  const cfg = ctx.settings.betDrill;
  const st = ctx.stats.betting;
  let prob = null;
  let answered = false;
  let autoTimer = null;

  const area = h('div');
  const buttons = h('div', { class: 'actions bets' });
  const result = h('div', { class: 'answer' });
  const record = h('div', { class: 'mini-stats' });

  root.append(h('section', { class: 'view' },
    head('Bet Sizing Drill', 'Ramp: $25 at a true count of +1 or lower, $50 at +2 and +3, $75 at +4 or higher.'),
    h('div', { class: 'panel toolbar' },
      field('Show', select([['tc', 'True count'], ['rc', 'Running count + discard tray (harder)']], cfg.display, (v) => { cfg.display = v; ctx.save(); next(); }))),
    area, buttons, result, record));

  function next() {
    clearTimeout(autoTimer);
    const tc = randInt(11) - 3; // −3 … +7, weighted to the ramp's interesting range
    let rc = null;
    let remainingCards = null;
    if (cfg.display === 'rc') {
      remainingCards = (3 + randInt(9)) * 26 + randInt(15) - 7;
      const d = decksEstimate(remainingCards);
      rc = Math.round(tc * d + Math.random() * (d - 0.01));
    }
    const realTC = rc == null ? tc : trueCount(rc, decksEstimate(remainingCards));
    prob = { tc: realTC, rc, remainingCards, t: performance.now() };
    answered = false;
    result.replaceChildren();
    area.replaceChildren(rc == null
      ? h('div', { class: 'tc-problem' }, h('div', { class: 'tc-main center' }, h('div', { class: 'k' }, 'True count'), h('div', { class: 'big mono' }, signed(realTC))))
      : h('div', { class: 'tc-problem' },
        h('div', { class: 'tc-tray' }, trayEl(RULES.decks * 52 - remainingCards, RULES.decks, { tall: true }), h('span', { class: 'k' }, 'Discard tray')),
        h('div', { class: 'tc-main' }, h('div', { class: 'k' }, 'Running count'), h('div', { class: 'big mono' }, signed(rc)))));
    buttons.replaceChildren(...BETS.map((b, i) => h('button', { class: 'btn act bet', 'data-k': String(i + 1), onclick: () => answer(b) }, h('span', {}, money(b)), h('kbd', {}, String(i + 1)))));
  }

  function answer(bet) {
    if (answered) return;
    answered = true;
    const want = betFor(prob.tc);
    const ok = bet === want;
    const ms = performance.now() - prob.t;
    const err = ok ? null : bet < want ? 'under' : 'over';
    addRun(st, { ok, ms: Math.round(ms), tc: prob.tc, want, chose: bet, err });
    ctx.save();
    for (const btn of buttons.querySelectorAll('button')) {
      btn.disabled = true;
      if (Number(btn.dataset.k) === BETS.indexOf(want) + 1) btn.classList.add('right');
      if (!ok && Number(btn.dataset.k) === BETS.indexOf(bet) + 1) btn.classList.add('wrong');
    }
    const how = prob.rc != null ? `${signed(prob.rc)} ÷ ${decksEstimate(prob.remainingCards)} decks → TC ${signed(prob.tc)}. ` : '';
    result.replaceChildren(
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` }, ok ? `✓ ${money(want)}` : `✗ Bet ${money(want)} — you ${err === 'under' ? 'under' : 'over'}bet`, h('span', { class: 'muted' }, ` · ${secs(ms)}`)),
      h('div', { class: 'muted' }, `${how}TC ${signed(prob.tc)} → ${money(want)}.`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: next }, 'Next', h('kbd', {}, 'Enter'))));
    renderRecord();
    if (ok) autoTimer = setTimeout(next, 700);
  }

  function renderRecord() {
    const runs = st.runs;
    let streak = 0;
    for (let k = runs.length - 1; k >= 0 && runs[k].ok; k--) streak++;
    record.replaceChildren(
      h('span', {}, `Streak ${streak}`),
      h('span', {}, `Accuracy ${pct(runs.filter((r) => r.ok).length, runs.length)} (${runs.length})`),
      h('span', {}, `Underbets ${runs.filter((r) => r.err === 'under').length} · Overbets ${runs.filter((r) => r.err === 'over').length}`));
  }

  function onKey(e) {
    if (typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (answered && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); return; }
    if (!answered && ['1', '2', '3'].includes(e.key)) answer(BETS[Number(e.key) - 1]);
  }
  addEventListener('keydown', onKey);
  renderRecord();
  next();

  return () => { clearTimeout(autoTimer); removeEventListener('keydown', onKey); };
}
