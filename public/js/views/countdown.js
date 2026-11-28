// Single-deck countdown (mode 1).
import { h, cardEl, sleep, signed, secs, numberField, head, field, select, typingInField } from '../ui.js';
import { hiLo, makeDecks, shuffleInPlace, randInt } from '../cards.js';
import { addRun } from '../store.js';
import { sfx } from '../sfx.js';

// Goal pace: a full deck in under 30s, i.e. about 0.58s per card.
export const GOAL_PER_CARD = 30000 / 52;
export const RANGES = { '10-15': [10, 15], '15-20': [15, 20], '20-30': [20, 30], '26-26': [26, 26], '52-52': [52, 52] };
const RANGE_LABELS = [['10-15', '10–15 cards'], ['15-20', '15–20 cards'], ['20-30', '20–30 cards'], ['26-26', 'Half deck (26)'], ['52-52', 'Full deck (52)']];


export function mount(root, ctx) {
  const cfg = ctx.settings.countdown;
  const st = ctx.stats.countdown;
  const since = Date.now(); // this session
  let alive = true;
  let runId = 0;
  let phase = 'idle'; // idle | running | answer | result
  let cards = [];
  let i = 0;
  let t0 = 0;
  let elapsed = 0;
  let tick = null;

  const clock = h('div', { class: 'clock mono' }, '0.0s');
  const prog = h('div', { class: 'muted' });
  const goal = h('div', { class: 'goal' }, 'Goal: right count at deck pace (≤ 0.58s per card)');
  const stage = h('div', { class: 'stage tap', onclick: () => { if (phase === 'running' && !cfg.auto) next(); } },
    h('div', { class: 'stage-hint' }, cfg.auto ? 'Press Start — cards flip automatically.' : 'Press Start. Tap the card or press Space for the next one.'));
  const answer = h('div', { class: 'answer' });
  const startBtn = h('button', { class: 'btn primary', onclick: start }, 'Start', h('kbd', {}, 'Enter'));
  const record = h('div', { class: 'mini-stats' });

  const msOut = h('output', {}, `${cfg.ms} ms`);
  const speedIn = h('input', {
    type: 'range', min: 200, max: 1500, step: 25, value: cfg.ms,
    oninput: (e) => { cfg.ms = Number(e.target.value); msOut.textContent = `${cfg.ms} ms · ${secs(cfg.ms * 52)} per deck`; },
    onchange: () => ctx.save(),
  });
  msOut.textContent = `${cfg.ms} ms · ${secs(cfg.ms * 52)} per deck`;
  if (!RANGES[cfg.range]) cfg.range = '15-20';

  const toolbar = h('div', { class: 'panel toolbar' },
    field('Pace', select([['1', 'Auto flip'], ['0', 'Tap / Space']], cfg.auto ? '1' : '0', (v) => { cfg.auto = v === '1'; ctx.save(); })),
    field('Auto speed', h('div', { class: 'range' }, speedIn, msOut)),
    field('Cards per run', select(RANGE_LABELS, cfg.range, (v) => { cfg.range = v; ctx.save(); })),
    startBtn);

  root.append(h('section', { class: 'view' },
    head('Countdown', 'Cards flip from a fresh deck — a random 15–20 by default — then you enter the Hi-Lo running count. The stop point is random, so you can’t guess the answer.'),
    toolbar,
    h('div', { class: 'timer-row' }, clock, prog, goal),
    h('div', { class: 'stage-wrap' }, h('div', { class: 'stage-box' }, stage)),
    answer, record));

  // Practice shows this session only; signed-in players see all-time numbers on Stats.
  function renderRecord() {
    const runs = st.runs.filter((r) => r.t >= since);
    const ok = runs.filter((r) => r.ok);
    const best = ok.length ? Math.min(...ok.map((r) => r.ms)) : null;
    const goals = runs.filter((r) => r.goal).length;
    const last = runs.slice(-12);
    record.replaceChildren(
      h('span', {}, `This session ${runs.length ? Math.round((100 * ok.length) / runs.length) : 0}% (${runs.length})`),
      h('span', {}, `Best ${best ? secs(best) : '—'}`),
      h('span', {}, `Goal met ${goals}×`),
      h('span', { class: 'dots' }, last.map((r) => h('i', { class: r.goal ? 'gold' : r.ok ? 'ok' : 'no', title: `${r.ok ? 'correct' : 'miss'} · ${secs(r.ms)}` }))));
  }

  function show() {
    const group = cards.slice(i, i + 1);
    stage.replaceChildren(h('div', { class: 'flash' }, group.map((c) => cardEl(c, { size: 'lg' }))));
    sfx.tick();
    prog.textContent = `${Math.min(i + 1, cards.length)} / ${cards.length}`;
  }

  async function start() {
    if (phase === 'running') return;
    const id = ++runId;
    const [lo, hi] = RANGES[cfg.range];
    cards = shuffleInPlace(makeDecks(1)).slice(0, lo + randInt(hi - lo + 1));
    i = 0;
    answer.replaceChildren();
    startBtn.disabled = true;
    phase = 'running';
    t0 = performance.now();
    clearInterval(tick);
    tick = setInterval(() => { clock.textContent = secs(performance.now() - t0); }, 100);
    show();
    if (cfg.auto) {
      while (alive && id === runId && phase === 'running') {
        await sleep(cfg.ms);
        if (!alive || id !== runId || phase !== 'running') return;
        next();
      }
    }
  }

  function next() {
    i++;
    if (i >= cards.length) return finish();
    show();
  }

  // ---- results -----------------------------------------------------------
  function finish() {
    clearInterval(tick);
    elapsed = performance.now() - t0;
    clock.textContent = secs(elapsed);
    phase = 'answer';
    stage.replaceChildren(h('div', { class: 'stage-hint' }, `${cards.length} cards. What's the running count?`));
    const f = numberField('Final count');
    answer.replaceChildren(h('form', {
      class: 'answer-form',
      onsubmit: (e) => { e.preventDefault(); if (f.value != null) grade(f.value); },
    }, f.el, h('button', { class: 'btn primary', type: 'submit' }, 'Submit')));
    f.input.focus();
  }

  function grade(guess) {
    phase = 'result';
    const expected = cards.reduce((s, c) => s + hiLo(c), 0);
    const ok = guess === expected;
    const perCard = elapsed / cards.length;
    const goalMet = ok && perCard <= GOAL_PER_CARD;
    if (goalMet) sfx.win(); else if (ok) sfx.right(); else sfx.wrong();
    addRun(st, {
      ms: Math.round(elapsed), ok, goal: goalMet, n: cards.length, exp: expected, diff: guess - expected, auto: cfg.auto, speed: cfg.auto ? cfg.ms : null,
    });
    ctx.save();
    startBtn.disabled = false;
    const kids = [
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` },
        ok ? `✓ ${signed(expected)} after ${cards.length} cards in ${secs(elapsed)}` : `✗ You said ${signed(guess)} — the count was ${signed(expected)} (off by ${Math.abs(guess - expected)})`,
        goalMet ? h('span', { class: 'goal-badge' }, 'Goal met') : ok ? h('span', { class: 'muted' }, ` · ${(perCard / 1000).toFixed(2)}s per card, goal is 0.58s`) : null),
    ];
    if (!ok) {
      let run = 0;
      kids.push(h('div', { class: 'review-title' }, 'Review (tag · running count)'),
        h('div', { class: 'review' }, cards.map((c) => { const t = hiLo(c); run += t; return h('div', { class: 'rv' },
          cardEl(c, { size: 'sm' }), h('div', { class: `tag ${t > 0 ? 'pos' : t < 0 ? 'neg' : ''}` }, signed(t)), h('div', { class: 'run' }, signed(run))); })));
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

  return () => {
    alive = false;
    clearInterval(tick);
    removeEventListener('keydown', onKey);
  };
}
