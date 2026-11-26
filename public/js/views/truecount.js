// True count drill (mode 3).
import { h, signed, secs, numberField, head, field, select, trayEl, typingInField } from '../ui.js';
import { RULES, randInt, trueCount, decksEstimate } from '../cards.js';
import { addRun } from '../store.js';
import { sfx } from '../sfx.js';

export const TC_ERRORS = {
  rounding: 'Rounding (should round down)',
  played: 'Divided by decks played, not remaining',
  estimate: 'Decks estimate off by ½ deck or more',
  sign: 'Sign flipped',
  other: 'Other',
};

export function classifyTC(guess, rc, remainingDecks) {
  const raw = rc / remainingDecks;
  if (guess === Math.round(raw) || guess === Math.trunc(raw) || guess === Math.ceil(raw)) return 'rounding';
  const played = RULES.decks - remainingDecks;
  if (played > 0 && guess === Math.floor(rc / played)) return 'played';
  for (const d of [remainingDecks - 0.5, remainingDecks + 0.5, remainingDecks - 1, remainingDecks + 1]) {
    if (d > 0 && guess === trueCount(rc, d)) return 'estimate';
  }
  if (guess === -trueCount(rc, remainingDecks)) return 'sign';
  return 'other';
}

export function mount(root, ctx) {
  const cfg = ctx.settings.tcDrill;
  const st = ctx.stats.truecount;
  let prob = null;
  let answered = false;

  const area = h('div');
  const result = h('div', { class: 'answer' });
  const record = h('div', { class: 'mini-stats' });

  root.append(h('section', { class: 'view' },
    head('True Count Drill', 'Estimate decks remaining from the discard tray, rounded to the nearest half deck, then divide the running count by it and round down. Gold lines mark whole decks; faint lines mark half decks.'),
    h('div', { class: 'panel toolbar' },
      field('Show', select([['tray', 'Discard tray (estimate it)'], ['decks', 'Decks-remaining number']], cfg.display, (v) => { cfg.display = v; ctx.save(); render(); }))),
    area, result, record));

  function newProblem() {
    const halves = 3 + randInt(9); // 1.5 … 5.5 decks remain (75% penetration)
    const jitter = randInt(15) - 7; // never enough to change the half-deck estimate
    const remainingCards = halves * 26 + jitter;
    let rc = 0;
    while (rc === 0) rc = randInt(29) - 14;
    prob = { rc, remainingCards, est: decksEstimate(remainingCards), t: performance.now() };
    answered = false;
    render();
  }

  function render() {
    if (!prob) return;
    const f = numberField('True count');
    const dealt = RULES.decks * 52 - prob.remainingCards;
    area.replaceChildren(h('div', { class: 'tc-problem' },
      cfg.display === 'tray'
        ? h('div', { class: 'tc-tray' }, trayEl(dealt, RULES.decks, { tall: true }), h('span', { class: 'k' }, 'Discard tray · 6-deck shoe'))
        : h('div', { class: 'tc-decks' }, h('div', { class: 'k' }, 'Decks remaining'), h('div', { class: 'big mono' }, String(prob.est))),
      h('div', { class: 'tc-main' },
        h('div', { class: 'k' }, 'Running count'),
        h('div', { class: 'big mono' }, signed(prob.rc)),
        h('form', {
          class: 'answer-form',
          onsubmit: (e) => {
            e.preventDefault();
            if (answered) return newProblem();
            if (f.value != null) grade(f.value);
          },
        }, f.el, h('button', { class: 'btn primary', type: 'submit' }, 'Submit')))));
    result.replaceChildren();
    f.input.focus();
  }

  function grade(guess) {
    answered = true;
    const ans = trueCount(prob.rc, prob.est);
    const ok = guess === ans;
    const ms = performance.now() - prob.t;
    const err = ok ? null : classifyTC(guess, prob.rc, prob.est);
    if (ok) sfx.right(); else sfx.wrong();
    addRun(st, { ok, ms: Math.round(ms), err, rc: prob.rc, decks: prob.est });
    ctx.save();
    const btn = h('button', { class: 'btn primary', onclick: newProblem }, 'Next', h('kbd', {}, 'Enter'));
    result.replaceChildren(
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` }, ok ? `✓ ${signed(ans)}` : `✗ You said ${signed(guess)} — it's ${signed(ans)}`,
        h('span', { class: 'muted' }, ` · ${secs(ms)}`)),
      h('div', { class: 'muted' }, `${prob.remainingCards} cards left ≈ ${prob.est} decks. ${signed(prob.rc)} ÷ ${prob.est} = ${(prob.rc / prob.est).toFixed(2)} → round down → ${signed(ans)}`),
      ...(err ? [h('div', { class: 'warn' }, `Likely mistake: ${TC_ERRORS[err]}`)] : []),
      h('div', { class: 'row' }, btn));
    btn.focus();
    renderRecord();
  }

  function renderRecord() {
    const runs = st.runs;
    const recent = runs.slice(-20);
    const ok = runs.filter((r) => r.ok).length;
    let streak = 0;
    for (let k = runs.length - 1; k >= 0 && runs[k].ok; k--) streak++;
    record.replaceChildren(
      h('span', {}, `Streak ${streak}`),
      h('span', {}, `Accuracy ${runs.length ? Math.round((100 * ok) / runs.length) : 0}% (${runs.length})`),
      h('span', {}, `Avg time (last 20) ${recent.length ? secs(recent.reduce((s, r) => s + r.ms, 0) / recent.length) : '—'}`));
  }

  function onKey(e) {
    if (typingInField(e)) return;
    if (e.key === 'Enter' && answered) { e.preventDefault(); newProblem(); }
  }
  addEventListener('keydown', onKey);
  renderRecord();
  newProblem();

  return () => removeEventListener('keydown', onKey);
}
