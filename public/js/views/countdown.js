// Single-deck countdown (mode 1) and Distraction mode (mode 2).
import { h, cardEl, sleep, signed, secs, numberField, head, field, select, toggle, typingInField } from '../ui.js';
import { hiLo, makeDecks, shuffleInPlace, randInt, pick } from '../cards.js';
import { addRun } from '../store.js';
import { createAmbience } from '../audio.js';

// Goal pace: a full deck in under 30s, i.e. about 0.58s per card.
export const GOAL_PER_CARD = 30000 / 52;
export const RANGES = { '10-15': [10, 15], '15-20': [15, 20], '20-30': [20, 30], '26-26': [26, 26], '52-52': [52, 52] };
const RANGE_LABELS = [['10-15', '10–15 cards'], ['15-20', '15–20 cards'], ['20-30', '20–30 cards'], ['26-26', 'Half deck (26)'], ['52-52', 'Full deck (52)']];

const CHATTER = [
  () => `Seat ${1 + randInt(7)}: "Come on, ${pick(['five', 'six', 'ten', 'face'])}!"`,
  () => `Dealer: "${12 + randInt(9)}… ${17 + randInt(5)}. Pay ${pick(['nineteen', 'twenty', 'twenty-one'])}."`,
  () => `Craps table: "${pick(['Seven out!', 'Yo eleven!', 'Hard eight!', 'Point is nine!'])}"`,
  () => `Slot bank: JACKPOT $${(randInt(90) + 10) * 25}`,
  () => `Pit boss: "Table ${randInt(20) + 1}, color up $${(randInt(30) + 5) * 25}."`,
  () => `Neighbor: "I had ${12 + randInt(9)}, he had ${12 + randInt(10)}, can you believe it?"`,
  () => `Keno board: ${Array.from({ length: 4 }, () => 1 + randInt(80)).join(' · ')}`,
  () => `Seat ${1 + randInt(7)}: "Hit me. ${pick(['Ugh.', 'Yes!', 'Again.', 'Stand.'])}"`,
  () => `PA: "Paging guest in room ${100 + randInt(900)}…"`,
];

function makePopup() {
  const r = randInt(4);
  if (r === 0) {
    const a = 3 + randInt(13);
    const b = 3 + randInt(13);
    return { kind: 'num', q: `Quick — what's ${a} + ${b}?`, answer: a + b };
  }
  if (r === 1) {
    const reds = 1 + randInt(5);
    const greens = 1 + randInt(4);
    return { kind: 'num', q: `Color up: ${reds} red ($5) + ${greens} green ($25) = $?`, answer: reds * 5 + greens * 25 };
  }
  if (r === 2) return { kind: 'choice', q: 'Cocktail server: "Anything to drink?"', choices: ['Water', 'Coffee', 'No thanks'] };
  return { kind: 'choice', q: 'Pit boss: "Are you rated? Player\'s card?"', choices: ['Sure', 'Not today'] };
}

export function mount(root, ctx, { distraction = false } = {}) {
  const S = ctx.settings;
  const cfg = distraction ? S.distraction : S.countdown;
  const st = distraction ? ctx.stats.distraction : ctx.stats.countdown;
  let alive = true;
  let runId = 0;
  let phase = 'idle'; // idle | running | answer | result
  let cards = [];
  let i = 0;
  let t0 = 0;
  let elapsed = 0;
  let tick = null;
  let ambience = null;
  let popup = null;
  let popStats = { shown: 0, ok: 0 };
  const timers = [];

  const clock = h('div', { class: 'clock mono' }, '0.0s');
  const prog = h('div', { class: 'muted' });
  const goal = h('div', { class: 'goal' }, 'Goal: right count at deck pace (≤ 0.58s per card)');
  const stage = h('div', { class: 'stage tap', onclick: () => { if (phase === 'running' && !cfg.auto) next(); } },
    h('div', { class: 'stage-hint' }, cfg.auto ? 'Press Start — cards flip automatically.' : 'Press Start. Tap the card or press Space for the next one.'));
  const popLayer = h('div', { class: 'popup-layer' });
  const chatter = h('div', { class: 'chatter', 'aria-hidden': 'true' });
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
  const distractBar = distraction ? h('div', { class: 'panel toolbar' },
    toggle(cfg, 'audio', 'Casino audio', () => ctx.save()),
    toggle(cfg, 'voice', 'Spoken chatter', () => ctx.save()),
    toggle(cfg, 'popups', 'Pop-up questions', () => ctx.save()),
    toggle(cfg, 'chatter', 'Chatter ticker', () => ctx.save()),
    field('Volume', h('input', {
      type: 'range', min: 0, max: 1, step: 0.05, value: cfg.volume,
      oninput: (e) => { cfg.volume = Number(e.target.value); ambience?.setVolume(cfg.volume); },
      onchange: () => ctx.save(),
    }))) : null;

  root.append(h('section', { class: 'view' },
    distraction
      ? head('Distraction Mode', 'The countdown drill with a noisy casino around you: crowd noise, chips, slots, voices calling out numbers, chatter, and people asking you things. Answer the pop-ups and keep the count.')
      : head('Countdown', 'Cards flip from a fresh deck — a random 15–20 by default — then you enter the Hi-Lo running count. The stop point is random, so you can’t guess the answer.'),
    toolbar, distractBar,
    h('div', { class: 'timer-row' }, clock, prog, goal),
    h('div', { class: distraction ? 'stage-wrap with-chatter' : 'stage-wrap' }, h('div', { class: 'stage-box' }, stage, popLayer), distraction ? chatter : null),
    answer, record));

  function renderRecord() {
    const runs = st.runs;
    const ok = runs.filter((r) => r.ok);
    const best = ok.length ? Math.min(...ok.map((r) => r.ms)) : null;
    const goals = runs.filter((r) => r.goal).length;
    const last = runs.slice(-12);
    record.replaceChildren(
      h('span', {}, `Accuracy ${runs.length ? Math.round((100 * ok.length) / runs.length) : 0}% (${runs.length})`),
      h('span', {}, `Best ${best ? secs(best) : '—'}`),
      h('span', {}, `Goal met ${goals}×`),
      ...(distraction ? [h('span', {}, `Pop-ups answered ${popupRate()}`)] : []),
      h('span', { class: 'dots' }, last.map((r) => h('i', { class: r.goal ? 'gold' : r.ok ? 'ok' : 'no', title: `${r.ok ? 'correct' : 'miss'} · ${secs(r.ms)}` }))));
  }
  function popupRate() {
    const s = st.runs.reduce((a, r) => ({ n: a.n + (r.popups || 0), ok: a.ok + (r.popupsOk || 0) }), { n: 0, ok: 0 });
    return s.n ? `${Math.round((100 * s.ok) / s.n)}%` : '—';
  }

  function show() {
    const group = cards.slice(i, i + 1);
    stage.replaceChildren(h('div', { class: 'flash' }, group.map((c) => cardEl(c, { size: 'lg' }))));
    prog.textContent = `${Math.min(i + 1, cards.length)} / ${cards.length}`;
  }

  async function start() {
    if (phase === 'running') return;
    const id = ++runId;
    const [lo, hi] = RANGES[cfg.range];
    cards = shuffleInPlace(makeDecks(1)).slice(0, lo + randInt(hi - lo + 1));
    i = 0;
    popStats = { shown: 0, ok: 0 };
    answer.replaceChildren();
    chatter.replaceChildren();
    startBtn.disabled = true;
    phase = 'running';
    if (distraction) startDistractions(id);
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
    if (!cfg.auto && popup) { stage.classList.add('blocked'); setTimeout(() => stage.classList.remove('blocked'), 300); return; }
    i++;
    if (i >= cards.length) return finish();
    show();
  }

  // ---- distractions ------------------------------------------------------
  function startDistractions(id) {
    if (cfg.audio) ambience = createAmbience({ volume: cfg.volume, voice: cfg.voice });
    const later = (fn, min, max) => timers.push(setTimeout(() => { if (alive && id === runId && phase === 'running') fn(); }, min + Math.random() * (max - min)));
    const chatLoop = () => {
      if (cfg.chatter) {
        chatter.prepend(h('div', { class: 'chat-line' }, pick(CHATTER)()));
        while (chatter.children.length > 6) chatter.lastChild.remove();
      }
      later(chatLoop, 900, 2300);
    };
    const popLoop = () => { if (cfg.popups) showPopup(); later(popLoop, 5000, 10000); };
    later(chatLoop, 300, 900);
    later(popLoop, 3500, 7000);
  }

  function stopDistractions() {
    timers.splice(0).forEach(clearTimeout);
    ambience?.stop();
    ambience = null;
    if (popup) closePopup(false);
  }

  function showPopup() {
    if (popup) closePopup(false); // ignored the last one
    const p = makePopup();
    popStats.shown++;
    let body;
    if (p.kind === 'num') {
      const f = numberField('Answer');
      body = h('form', {
        class: 'answer-form',
        onsubmit: (e) => { e.preventDefault(); if (f.value != null) closePopup(f.value === p.answer); },
      }, f.el, h('button', { class: 'btn primary sm', type: 'submit' }, 'OK'));
      setTimeout(() => f.input.focus(), 0);
    } else {
      body = h('div', { class: 'row tight' }, p.choices.map((c) => h('button', { class: 'btn sm', onclick: () => closePopup(true) }, c)));
    }
    popup = h('div', { class: 'popup' }, h('div', { class: 'popup-q' }, p.q), body);
    popLayer.replaceChildren(popup);
  }

  function closePopup(ok) {
    if (ok) popStats.ok++;
    popup = null;
    popLayer.replaceChildren();
  }

  // ---- results -----------------------------------------------------------
  function finish() {
    clearInterval(tick);
    elapsed = performance.now() - t0;
    clock.textContent = secs(elapsed);
    if (distraction) stopDistractions();
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
    addRun(st, {
      ms: Math.round(elapsed), ok, goal: goalMet, n: cards.length, exp: expected, diff: guess - expected, auto: cfg.auto, speed: cfg.auto ? cfg.ms : null,
      ...(distraction ? { popups: popStats.shown, popupsOk: popStats.ok } : {}),
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
    if (distraction) kids.push(h('div', { class: 'muted' }, `Pop-ups: ${popStats.ok} of ${popStats.shown} answered correctly.`));
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
    stopDistractions();
    removeEventListener('keydown', onKey);
  };
}
