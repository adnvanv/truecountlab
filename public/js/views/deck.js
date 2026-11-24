// Deck Countdown: count down a single deck as fast as you can.
import { h, cardEl, sleep, signed, numberField, head, field, select, typingInField } from '../ui.js';
import { SYSTEMS, tagOf, deckTotal, makeDecks, shuffleInPlace } from '../cards.js';
import { pushHistory } from '../store.js';

const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

export function mount(root, ctx) {
  const S = ctx.settings;
  const cfg = S.deckDrill;
  const st = ctx.stats.deck;
  const sys = SYSTEMS[S.system];
  const total = deckTotal(S.system);
  let alive = true;
  let runId = 0;
  let phase = 'idle'; // idle | running | answer | result
  let cards = [];
  let burned = null;
  let i = 0;
  let t0 = 0;
  let elapsed = 0;
  let tick = null;

  const clock = h('div', { class: 'clock mono' }, '0.0s');
  const prog = h('div', { class: 'muted' }, '');
  const stage = h('div', { class: 'stage tap', onclick: () => { if (phase === 'running' && !cfg.auto) next(); } },
    h('div', { class: 'stage-hint' }, 'Press Start. Tap the card (or press Space) to deal the next one.'));
  const answer = h('div', { class: 'answer' });
  const startBtn = h('button', { class: 'btn primary', onclick: start }, 'Start', h('kbd', {}, 'Enter'));
  const record = h('div', { class: 'mini-stats' });

  const endNote = total === 0
    ? 'A full deck counts to 0 in a balanced system.'
    : `A full deck counts to ${signed(total)} in ${sys.name}.`;

  root.append(h('section', { class: 'view' },
    head('Deck Countdown', `Run through one deck and give the final count. ${endNote} With "hide a card" on, one card is removed — your final count tells you what it was.`),
    h('div', { class: 'panel toolbar' },
      field('Hide a card', select([['1', 'Yes'], ['0', 'No']], cfg.burn ? '1' : '0', (v) => { cfg.burn = v === '1'; ctx.save(); })),
      field('Cards at a time', select([[1, '1'], [2, '2']], cfg.group, (v) => { cfg.group = Number(v); ctx.save(); })),
      field('Pace', select([['0', 'Self-paced (tap)'], ['1', 'Auto']], cfg.auto ? '1' : '0', (v) => { cfg.auto = v === '1'; ctx.save(); })),
      field('Auto speed', select([[250, '250 ms'], [400, '400 ms'], [500, '500 ms'], [700, '700 ms'], [1000, '1 s']], cfg.ms, (v) => { cfg.ms = Number(v); ctx.save(); })),
      startBtn),
    h('div', { class: 'timer-row' }, clock, prog),
    stage, answer, record));

  function renderRecord() {
    const correctRuns = st.history.filter((r) => r.ok).slice(-5);
    const avg = correctRuns.length ? correctRuns.reduce((s, r) => s + r.ms, 0) / correctRuns.length : null;
    record.replaceChildren(
      h('span', {}, `Best ${st.best ? fmt(st.best) : '—'}`),
      h('span', {}, `Avg of last 5 correct ${avg ? fmt(avg) : '—'}`),
      h('span', {}, `Accuracy ${st.attempts ? Math.round((100 * st.correct) / st.attempts) : 0}% (${st.attempts})`));
  }

  function show() {
    const group = cards.slice(i, i + cfg.group);
    stage.replaceChildren(h('div', { class: 'flash' }, group.map((c) => cardEl(c, { size: 'lg' }))));
    prog.textContent = `${Math.min(i + cfg.group, cards.length)} / ${cards.length}`;
  }

  async function start() {
    if (phase === 'running') return;
    const id = ++runId;
    const deck = shuffleInPlace(makeDecks(1));
    burned = cfg.burn ? deck.pop() : null;
    cards = deck;
    i = 0;
    answer.replaceChildren();
    startBtn.disabled = true;
    phase = 'running';
    t0 = performance.now();
    clearInterval(tick);
    tick = setInterval(() => { clock.textContent = fmt(performance.now() - t0); }, 100);
    show();
    if (cfg.auto) {
      while (phase === 'running' && alive && id === runId) {
        await sleep(cfg.ms);
        if (!alive || id !== runId || phase !== 'running') return;
        next();
      }
    }
  }

  function next() {
    i += cfg.group;
    if (i >= cards.length) return finish();
    show();
  }

  function finish() {
    clearInterval(tick);
    elapsed = performance.now() - t0;
    clock.textContent = fmt(elapsed);
    phase = 'answer';
    stage.replaceChildren(h('div', { class: 'stage-hint' }, 'Deck finished. Final count?'));
    const f = numberField('Final count');
    answer.replaceChildren(h('form', {
      class: 'answer-form',
      onsubmit: (e) => { e.preventDefault(); if (f.value != null) grade(f.value); },
    }, f.el, h('button', { class: 'btn primary', type: 'submit' }, 'Submit')));
    f.input.focus();
  }

  function grade(guess) {
    phase = 'result';
    const expected = total - (burned ? tagOf(S.system, burned) : 0);
    const ok = guess === expected;
    st.attempts++;
    if (ok) {
      st.correct++;
      if (!st.best || elapsed < st.best) st.best = elapsed;
    }
    pushHistory(st.history, { t: Date.now(), ms: elapsed, ok, burn: !!burned });
    ctx.save();
    startBtn.disabled = false;
    const kids = [h('div', { class: `verdict ${ok ? 'good' : 'bad'}` },
      ok ? `✓ Correct — ${signed(expected)} in ${fmt(elapsed)}` : `✗ You said ${signed(guess)}; the final count was ${signed(expected)}`)];
    if (burned) {
      const tag = tagOf(S.system, burned);
      kids.push(h('div', { class: 'burn' },
        h('span', {}, 'Hidden card:'), cardEl(burned, { size: 'sm' }),
        h('span', { class: 'muted' }, `tag ${signed(tag)} → the deck should end at ${signed(total)} − (${signed(tag)}) = ${signed(expected)}`)));
    }
    kids.push(h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: start }, 'Again', h('kbd', {}, 'Enter'))));
    answer.replaceChildren(...kids);
    renderRecord();
  }

  function onKey(e) {
    if (typingInField(e)) return;
    if (phase === 'running' && !cfg.auto && (e.key === ' ' || e.key === 'ArrowRight')) { e.preventDefault(); next(); }
    else if (e.key === 'Enter' && (phase === 'idle' || phase === 'result')) { e.preventDefault(); start(); }
  }
  addEventListener('keydown', onKey);
  renderRecord();

  return () => { alive = false; clearInterval(tick); removeEventListener('keydown', onKey); };
}
