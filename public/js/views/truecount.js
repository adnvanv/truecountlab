// True Count: convert a running count using the discard tray.
import { h, signed, numberField, head, field, select, trayEl, typingInField } from '../ui.js';
import { SYSTEMS, trueCount, randInt, TC_MODES } from '../cards.js';
import { pushHistory } from '../store.js';

export function mount(root, ctx) {
  const S = ctx.settings;
  const cfg = S.tcDrill;
  const st = ctx.stats.truecount;
  const sys = SYSTEMS[S.system];
  let prob = null;
  let answered = false;

  const area = h('div', { class: 'tc-area' });
  const result = h('div', { class: 'answer' });
  const record = h('div', { class: 'mini-stats' });

  root.append(h('section', { class: 'view' },
    head('True Count', `Divide the running count by the decks still in the shoe — estimate those from the discard tray (ticks mark each deck). Rounding: ${TC_MODES[S.tcMode].toLowerCase()}.`),
    !sys.balanced ? h('div', { class: 'panel note' }, `${sys.name} is unbalanced and normally skips this step — this drill still trains the conversion for balanced counts.`) : null,
    h('div', { class: 'panel toolbar' },
      field('Show decks remaining', select([['0', 'No — estimate from tray'], ['1', 'Yes (learning)']], cfg.showDecks ? '1' : '0', (v) => { cfg.showDecks = v === '1'; ctx.save(); render(); })),
      field('Shoe size', h('span', { class: 'static' }, `${Math.max(2, S.decks)} decks (from Settings)`))),
    area, result, record));

  function newProblem() {
    const decks = Math.max(2, S.decks);
    const discardedHalves = 1 + randInt(decks * 2 - 2); // 0.5 .. decks-1
    const remaining = decks - discardedHalves / 2;
    let rc = 0;
    while (rc === 0) rc = randInt(31) - 15;
    prob = { decks, remaining, rc, dealt: discardedHalves * 26, t: performance.now() };
    answered = false;
    render();
  }

  function render() {
    if (!prob) return;
    const f = numberField('True count');
    area.replaceChildren(h('div', { class: 'tc-problem' },
      h('div', { class: 'tc-tray' }, trayEl(prob.dealt, prob.decks, { tall: true }), h('span', { class: 'k' }, `Discards · ${prob.decks}-deck shoe`)),
      h('div', { class: 'tc-main' },
        h('div', { class: 'k' }, 'Running count'),
        h('div', { class: 'big mono' }, signed(prob.rc)),
        cfg.showDecks ? h('div', { class: 'muted' }, `${prob.remaining} decks remaining`) : h('div', { class: 'muted' }, 'Decks remaining: estimate from the tray'),
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
    const ans = trueCount(prob.rc, prob.remaining, S.tcMode);
    const ok = guess === ans;
    const ms = performance.now() - prob.t;
    st.attempts++;
    if (ok) { st.correct++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); } else st.streak = 0;
    pushHistory(st.history, { t: Date.now(), ok, ms });
    ctx.save();
    const btn = h('button', { class: 'btn primary', onclick: newProblem }, 'Next', h('kbd', {}, 'Enter'));
    result.replaceChildren(
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` }, ok ? `✓ ${signed(ans)}` : `✗ You said ${signed(guess)} — it's ${signed(ans)}`,
        h('span', { class: 'muted' }, ` · ${(ms / 1000).toFixed(1)}s`)),
      h('div', { class: 'muted' }, `${signed(prob.rc)} ÷ ${prob.remaining} decks = ${(prob.rc / prob.remaining).toFixed(2)} → ${signed(ans)} (${S.tcMode})`),
      h('div', { class: 'row' }, btn));
    btn.focus();
    renderRecord();
  }

  function renderRecord() {
    const recent = st.history.slice(-20);
    const avg = recent.length ? recent.reduce((s, r) => s + r.ms, 0) / recent.length / 1000 : 0;
    record.replaceChildren(
      h('span', {}, `Streak ${st.streak} (best ${st.bestStreak})`),
      h('span', {}, `Accuracy ${st.attempts ? Math.round((100 * st.correct) / st.attempts) : 0}% (${st.attempts})`),
      h('span', {}, `Avg time ${avg ? `${avg.toFixed(1)}s` : '—'}`));
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
