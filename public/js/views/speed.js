// Speed Count: cards flash at a set pace; report the running count at the end.
import { h, cardEl, sleep, signed, numberField, head, field, select, typingInField } from '../ui.js';
import { SYSTEMS, tagOf, makeDecks, shuffleInPlace } from '../cards.js';
import { pushHistory } from '../store.js';

export function mount(root, ctx) {
  const S = ctx.settings;
  const cfg = S.speed;
  const st = ctx.stats.speed;
  const sys = SYSTEMS[S.system];
  let alive = true;
  let runId = 0;
  let phase = 'idle'; // idle | running | answer | result

  const msOut = h('output', {}, `${cfg.ms} ms`);
  const speedIn = h('input', {
    type: 'range', min: 150, max: 2000, step: 50, value: cfg.ms,
    oninput: (e) => { cfg.ms = Number(e.target.value); msOut.textContent = `${cfg.ms} ms`; },
    onchange: () => ctx.save(),
  });
  const startBtn = h('button', { class: 'btn primary', onclick: start }, 'Start', h('kbd', {}, 'Enter'));
  const stage = h('div', { class: 'stage' }, h('div', { class: 'stage-hint' }, 'Press Start — cards will flash here.'));
  const answer = h('div', { class: 'answer' });
  const record = h('div', { class: 'mini-stats' });

  root.append(h('section', { class: 'view' },
    head('Speed Count', `Keep the ${sys.name} running count as the cards flash, then enter it. Push the speed until you start missing.`),
    h('div', { class: 'panel toolbar' },
      field('Cards', select([[10, '10'], [20, '20'], [30, '30'], [52, '1 deck'], [104, '2 decks'], [156, '3 decks']], cfg.cards, (v) => { cfg.cards = Number(v); ctx.save(); })),
      field('Per flash', select([[1, '1 card'], [2, '2 cards'], [3, '3 cards']], cfg.group, (v) => { cfg.group = Number(v); ctx.save(); })),
      field('Speed per flash', h('div', { class: 'range' }, speedIn, msOut)),
      startBtn),
    stage, answer, record));

  function renderRecord() {
    const last = st.history.slice(-10);
    record.replaceChildren(
      h('span', {}, `Accuracy ${st.attempts ? Math.round((100 * st.correct) / st.attempts) : 0}% over ${st.attempts} runs`),
      h('span', { class: 'dots' }, last.map((r) => h('i', { class: r.ok ? 'ok' : 'no', title: `${r.n} cards @ ${r.ms}ms` }))));
  }

  async function start() {
    if (phase === 'running') return;
    const id = ++runId;
    phase = 'running';
    startBtn.disabled = true;
    answer.replaceChildren();
    const seq = shuffleInPlace(makeDecks(Math.ceil(cfg.cards / 52))).slice(0, cfg.cards);
    for (const n of [3, 2, 1]) {
      stage.replaceChildren(h('div', { class: 'countdown' }, n));
      await sleep(420);
      if (!alive || id !== runId) return;
    }
    const t0 = performance.now();
    for (let i = 0; i < seq.length; i += cfg.group) {
      stage.replaceChildren(h('div', { class: 'flash' }, seq.slice(i, i + cfg.group).map((c) => cardEl(c, { size: 'lg' }))));
      await sleep(cfg.ms);
      if (!alive || id !== runId) return;
      stage.replaceChildren();
      await sleep(50);
      if (!alive || id !== runId) return;
    }
    ask(seq, performance.now() - t0);
  }

  function ask(seq, elapsed) {
    phase = 'answer';
    stage.replaceChildren(h('div', { class: 'stage-hint' }, `${seq.length} cards done. What's the count?`));
    const f = numberField('Running count');
    const form = h('form', {
      class: 'answer-form',
      onsubmit: (e) => { e.preventDefault(); if (f.value != null) grade(seq, elapsed, f.value); },
    }, f.el, h('button', { class: 'btn primary', type: 'submit' }, 'Submit'));
    answer.replaceChildren(form);
    f.input.focus();
  }

  function grade(seq, elapsed, guess) {
    phase = 'result';
    let run = 0;
    const steps = seq.map((c) => { const tag = tagOf(S.system, c); run += tag; return { c, tag, run }; });
    const ok = guess === run;
    st.attempts++;
    if (ok) st.correct++;
    pushHistory(st.history, { t: Date.now(), n: seq.length, ms: cfg.ms, group: cfg.group, ok });
    ctx.save();
    const cpm = Math.round((seq.length / elapsed) * 60000);
    startBtn.disabled = false;
    answer.replaceChildren(
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` },
        ok ? `✓ Correct — ${signed(run)}` : `✗ You said ${signed(guess)}, the count was ${signed(run)}`,
        h('span', { class: 'muted' }, ` · ${cpm} cards/min`)),
      h('div', { class: 'review-title' }, 'Review (tag · running count)'),
      h('div', { class: 'review' }, steps.map((s) => h('div', { class: 'rv' },
        cardEl(s.c, { size: 'sm' }),
        h('div', { class: `tag ${s.tag > 0 ? 'pos' : s.tag < 0 ? 'neg' : ''}` }, signed(s.tag)),
        h('div', { class: 'run' }, signed(s.run))))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: start }, 'Again', h('kbd', {}, 'Enter'))));
    renderRecord();
  }

  function onKey(e) {
    if (typingInField(e)) return;
    if (e.key === 'Enter' && (phase === 'idle' || phase === 'result')) { e.preventDefault(); start(); }
  }
  addEventListener('keydown', onKey);
  renderRecord();

  return () => { alive = false; removeEventListener('keydown', onKey); };
}
