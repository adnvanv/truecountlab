// Full table simulation (mode 7) with sessions: $500 buy-in, stop-loss at the buy-in.
import { h, cardEl, sleep, signed, trayEl, money, numberField, typingInField, pct } from '../ui.js';
import { RULES, BETS, betFor, Shoe, hiLo, rankKey, tcFromCards, tcCandidates, decksEstimate } from '../cards.js';
import { sfx, configure, shuffleMs } from '../sfx.js';
import { handTotal, isBlackjack, correctAction, insuranceCorrect, upValue, handLabel, upLabel, ACTIONS } from '../strategy.js';

const ABORT = Symbol('abort');
const MIN = RULES.minBet;

export function mount(root, ctx, { training = false } = {}) {
  const S = ctx.settings;
  const T = training ? ctx.stats.training : ctx.stats.table;
  const G = ctx.state; // bankroll, session, sessions
  const cheatCfg = S.training;
  let alive = true;
  // Training mode plays with practice chips: no buy-in, no stop-loss, nothing logged.
  const PRACTICE = 5000;
  const practice = { stack: PRACTICE, buyIn: PRACTICE, hands: 0, peeks: 0 };

  const shoe = new Shoe();
  let rc = 0;
  let bet = MIN;
  let phase = 'bet'; // bet | dealing | insurance | play | dealer | check
  let busy = false;
  let dealer = [];
  let others = [];
  let hands = [];
  let active = 0;
  let insuranceBet = 0;
  let pendingInsurance = null;
  let reveal = S.showCount;
  let notes = [];
  let lastActivity = Date.now();
  let shoeFresh = true; // play the shuffle before the first deal of each shoe
  configure(S.sound);

  const hud = h('div', { class: 'hud' }); // desktop stats strip
  const mhud = h('div', { class: 'mhud' }); // phone header
  const dealerZone = h('div', { class: 'zone dealer-zone' });
  const seatsZone = h('div', { class: 'zone seats' });
  const fb = h('div', { class: 'feedback', 'aria-live': 'polite', onclick: () => fb.classList.toggle('expanded') });
  const controls = h('div', { class: 'controls' });
  const cheatPanel = h('div', { class: 'cheat-panel', 'aria-live': 'polite' });
  const trayBox = h('div', { class: 'felt-tray' });
  const shoeEl = h('div', { class: 'felt-shoe', 'aria-hidden': 'true' }, h('div', { class: 'shoe-body' }, h('div', { class: 'shoe-card' })), h('span', { class: 'felt-tag' }, 'Shoe'));
  const rulesText = S.surrender ? RULES.text.replace('no surrender', 'late surrender (count-based)') : RULES.text;
  const arcId = `arc-${training ? 't' : 'r'}`;
  const arc = h('svg:svg', { class: 'felt-arc', viewBox: '0 0 600 110', 'aria-hidden': 'true' },
    h('svg:path', { id: arcId, d: 'M 30 18 Q 300 150 570 18', fill: 'none' }),
    h('svg:path', { id: `${arcId}b`, d: 'M 70 42 Q 300 160 530 42', fill: 'none' }),
    h('svg:text', { class: 'arc-big' }, h('svg:textPath', { href: `#${arcId}`, startOffset: '50%', 'text-anchor': 'middle' }, 'BLACKJACK PAYS 3 TO 2')),
    h('svg:text', { class: 'arc-small' }, h('svg:textPath', { href: `#${arcId}b`, startOffset: '50%', 'text-anchor': 'middle' }, 'Dealer stands on all 17s · Insurance pays 2 to 1')));
  root.append(h('section', { class: `view table-view${training ? ' training' : ''}` },
    training
      ? h('div', { class: 'training-bar' },
        h('div', {}, h('strong', {}, 'Training table'), h('span', { class: 'muted' }, ' · practice chips, nothing logged · '), rulesText),
        h('button', { class: `btn sm cheat-btn${cheatCfg.cheat ? ' on' : ''}`, onclick: toggleCheat }, cheatCfg.cheat ? 'Cheat: ON' : 'Cheat: OFF', h('kbd', {}, 'X')))
      : h('div', { class: 'rules-line muted' }, rulesText),
    mhud,
    // Desktop: stats, cheat panel and the hand log live in a side column so the table fits one screen.
    h('aside', { class: 'side' }, hud, training ? cheatPanel : null, fb),
    h('div', { class: 'felt' }, trayBox, shoeEl, dealerZone, arc, seatsZone),
    h('div', { class: 'dock' }, controls)));

  // ---- helpers -----------------------------------------------------------
  const sess = () => (training ? practice : G.session);
  const stack = () => sess()?.stack ?? 0;
  const tc = () => tcFromCards(rc, shoe.remaining);
  const takeAnim = (c) => { if (c.anim) { c.anim = false; return true; } return false; };

  function count(key, ok) {
    // key: decisions | devs | checks | bets — mirrored in lifetime stats and the session
    const pairs = { decisions: 'correct', devs: 'devsCorrect', checks: 'checksCorrect', bets: 'betsCorrect' };
    for (const o of [T, sess()]) {
      if (!o) continue;
      o[key] = (o[key] || 0) + 1;
      if (ok) o[pairs[key]] = (o[pairs[key]] || 0) + 1;
    }
  }

  function setBet(v) {
    const max = Math.max(MIN, Math.floor(stack() / MIN) * MIN);
    bet = Math.min(Math.max(MIN, Math.round(v / MIN) * MIN), max);
  }

  function touch() {
    const now = Date.now();
    if (sess()) sess().activeMs = (sess().activeMs || 0) + Math.min(now - lastActivity, 5 * 60 * 1000);
    lastActivity = now;
  }

  function draw(faceDown = false) {
    if (shoe.remaining === 0) { shoe.shuffle(); rc = 0; sfx.shuffle(); note('Shoe ran out mid-round — reshuffled, count reset.', 'warn'); }
    const c = shoe.draw();
    c.anim = true;
    sfx.deal();
    if (faceDown) c.down = true; else rc += hiLo(c);
    return c;
  }

  async function step(ms = S.dealSpeed) {
    render();
    await sleep(ms);
    if (!alive) throw ABORT;
  }

  function note(msg, kind = '') {
    notes.push({ msg, kind });
    if (notes.length > 6) notes.shift();
    fb.replaceChildren(...notes.map((n, i) => {
      // Lines starting with ✓/✗ get a big icon and a CORRECT/WRONG tag so a misplay jumps out.
      const m = n.msg.match(/^([✓✗])\s*([\s\S]*)$/);
      const latest = i === notes.length - 1 ? ' latest' : '';
      if (!m) return h('div', { class: `fb-line ${n.kind}${latest}` }, n.msg);
      const tag = n.kind.includes('play') ? (m[1] === '✓' ? 'Correct' : 'Wrong') : n.kind.includes('bet') ? (m[1] === '✓' ? 'Bet OK' : 'Bet off') : '';
      return h('div', { class: `fb-line ${n.kind}${latest}` },
        h('span', { class: 'fb-icon', 'aria-hidden': 'true' }, m[1]),
        h('span', { class: 'fb-text' }, tag ? h('b', { class: 'fb-tag' }, tag) : null, m[2]));
    }));
  }

  function optsFor(hd) {
    const two = hd.cards.length === 2;
    return {
      canDouble: two && stack() >= hd.bet,
      canSplit: two && rankKey(hd.cards[0].rank) === rankKey(hd.cards[1].rank) && hands.length < 4 && stack() >= hd.bet && !hd.splitAces,
      canSurrender: S.surrender && two && hands.length === 1 && !hd.fromSplit,
    };
  }
  const allowed = (a, o) => a === 'H' || a === 'S' || (a === 'D' && o.canDouble) || (a === 'P' && o.canSplit) || (a === 'R' && o.canSurrender);
  const ACTS = ['H', 'S', 'D', 'P'].concat(S.surrender ? ['R'] : []);

  // What the cheat panel recommends right now.
  function cheatAdvice() {
    const t = tc();
    if (phase === 'insurance') return { key: insuranceCorrect(t) ? 'Y' : 'N', text: `${insuranceCorrect(t) ? 'Take' : 'Decline'} insurance (take at TC ≥ +3; TC is ${signed(t)})` };
    if (phase === 'play' && hands[active] && dealer.length) {
      const hd = hands[active];
      const r = correctAction(hd.cards, upValue(dealer[0]), optsFor(hd), t);
      return { key: r.action, text: `${ACTIONS[r.action]} — ${r.dev ? r.note : `basic strategy for ${handLabel(hd.cards)} vs ${upLabel(upValue(dealer[0]))}`}` };
    }
    if (phase === 'bet') return { key: null, text: `Bet ${money(betFor(t))} (TC ${signed(t)})` };
    return { key: null, text: 'Watch the cards…' };
  }

  function renderCheat() {
    if (!training) return;
    if (!cheatCfg.cheat) { cheatPanel.replaceChildren(); cheatPanel.classList.remove('on'); return; }
    cheatPanel.classList.add('on');
    const est = decksEstimate(shoe.remaining);
    const adv = cheatAdvice();
    const item = (k, v) => h('div', { class: 'cheat-item' }, h('span', { class: 'k' }, k), h('span', { class: 'v mono' }, v));
    cheatPanel.replaceChildren(
      item('Running count', signed(rc)),
      item('Decks left', `${(shoe.remaining / 52).toFixed(2)} → ${est}`),
      item('True count', `${signed(rc)} ÷ ${est} → ${signed(tc())}`),
      item('Bet', money(betFor(tc()))),
      h('div', { class: 'cheat-item wide' }, h('span', { class: 'k' }, 'Correct play'), h('span', { class: 'v' }, adv.text)));
  }

  function toggleCheat() {
    cheatCfg.cheat = !cheatCfg.cheat;
    ctx.save();
    const b = root.querySelector('.cheat-btn');
    if (b) { b.classList.toggle('on', cheatCfg.cheat); b.firstChild.textContent = cheatCfg.cheat ? 'Cheat: ON' : 'Cheat: OFF'; }
    render();
  }

  function cardView(c, opts = {}) {
    const el = cardEl(c, { down: c.down, anim: takeAnim(c), ...opts });
    if (c.flip) { c.flip = false; el.classList.add('flip'); }
    return el;
  }

  // A pile of casino chips seen from above, slightly offset like a real stack:
  // $100 black, $25 green, $5 red, $1 white. The top chip shows its value.
  function chipStack(amount, { label = true } = {}) {
    const chips = [];
    let left = Math.floor(amount);
    for (const [d, c] of [[100, 'black'], [25, 'green'], [5, 'red'], [1, 'white']]) {
      while (left >= d && chips.length < 8) { chips.push([d, c]); left -= d; }
    }
    return h('div', { class: 'chip-pile', title: money(amount), style: `--n:${chips.length}` },
      h('div', { class: 'pile' }, chips.map(([d, c], i) => h('i', { class: `pchip ${c}`, style: `--i:${i}` },
        i === chips.length - 1 ? h('span', {}, String(d)) : null))),
      label ? h('span', { class: 'chip-amt' }, money(amount)) : null);
  }

  function soundBtn(cls) {
    const label = S.sound.on ? 'Mute sounds' : 'Turn sounds on';
    return h('button', {
      class: `${cls} sound-btn`, title: label, 'aria-label': label,
      onclick: () => { S.sound.on = !S.sound.on; configure(S.sound); ctx.save(); if (S.sound.on) sfx.chip(1); render(); },
    }, S.sound.on ? '🔊' : '🔇');
  }

  // ---- rendering ---------------------------------------------------------
  function renderHud() {
    const stat = (k, v) => h('div', { class: 'stat' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
    const s = sess();
    hud.replaceChildren(
      h('div', { class: 'hud-info' },
        training ? stat('Practice chips', `${money(s.stack)} (${money(s.stack - s.buyIn, { sign: true })})`)
          : stat('Session stack', s ? `${money(s.stack)} (${money(s.stack - s.buyIn, { sign: true })})` : '—'),
        training ? stat('Decisions', `${pct(T.correct, T.decisions)} of ${T.decisions}`) : stat('Bankroll', money(G.bankroll + stack())),
        stat(training ? 'Hands' : 'Hands this session', s ? String(s.hands || 0) : '—'),
        h('div', { class: `stat count${reveal ? ' on' : ''}` },
          h('span', { class: 'k' }, 'Count'),
          h('div', { class: 'count-row' },
            reveal ? h('span', { class: 'v mono' }, `RC ${signed(rc)} · TC ${signed(tc())}`) : h('span', { class: 'v muted' }, 'Hidden'),
            h('button', { class: 'btn sm ghost', onclick: toggleReveal, title: 'Show or hide the count (C)' }, reveal ? 'Hide' : 'Reveal', h('kbd', {}, 'C'))))),
      soundBtn('btn ghost'));

    // Phone header: stack, count pill, sound, cheat.
    const showCount = reveal || (training && cheatCfg.cheat);
    mhud.replaceChildren(
      h('div', { class: 'm-stack' }, h('span', { class: 'k' }, training ? 'Chips' : s ? 'Stack' : 'Bankroll'),
        h('span', { class: 'v' }, s ? money(s.stack) : money(G.bankroll)),
        s ? h('span', { class: `m-delta ${s.stack >= s.buyIn ? 'good' : 'bad'}` }, money(s.stack - s.buyIn, { sign: true })) : null),
      h('button', { class: `m-count${showCount ? ' on' : ''}`, onclick: toggleReveal, 'aria-label': 'Show or hide the count' },
        showCount ? h('span', { class: 'mono' }, `RC ${signed(rc)} · TC ${signed(tc())}`) : h('span', {}, 'Count ••• ', h('small', {}, 'tap'))),
      soundBtn('m-icon'),
      training ? h('button', { class: `m-icon cheat-btn${cheatCfg.cheat ? ' on' : ''}`, onclick: toggleCheat, 'aria-label': 'Toggle cheat panel' }, cheatCfg.cheat ? '👁' : '🙈') : null);
  }

  function renderTable() {
    trayBox.replaceChildren(trayEl(shoe.dealt, RULES.decks), h('span', { class: 'felt-tag' }, 'Discards'));
    shoeEl.style.setProperty('--left', String(shoe.remaining / (RULES.decks * 52)));
    dealerZone.replaceChildren(
      h('div', { class: 'zone-label' }, 'Dealer'),
      h('div', { class: 'hand' }, dealer.length ? dealer.map((c) => cardView(c)) : [h('div', { class: 'slot' }), h('div', { class: 'slot' })]));
    const otherSeats = others.map((o, i) => h('div', { class: 'seat other' },
      h('div', { class: 'hand' }, o.cards.map((c) => cardView(c, { size: 'sm' }))),
      h('div', { class: 'zone-label' }, `P${i + 1}`)));
    const handEls = hands.length
      ? hands.map((hd, i) => h('div', {
        class: `my-hand${phase === 'play' && i === active ? ' active' : ''}${hd.result ? ` ${hd.result.cls}` : ''}`,
      },
      hd.result ? h('div', { class: 'result-bubble' }, hd.result.text) : null,
      h('div', { class: 'hand' }, hd.cards.map((c) => cardView(c))),
      h('div', { class: 'bet-spot' }, chipStack(hd.bet))))
      : [h('div', { class: 'my-hand empty' },
        h('div', { class: 'hand' }, h('div', { class: 'slot' }), h('div', { class: 'slot' })),
        h('div', { class: 'bet-spot' }, sess() ? chipStack(bet) : h('span', { class: 'muted' }, 'Buy in')))];
    const mine = h('div', { class: 'seat me' },
      h('div', { class: `my-hands n${Math.max(1, hands.length)}` }, handEls),
      h('div', { class: 'zone-label you' }, 'You'));
    // Other players sit on both sides of you, like a real table.
    const half = Math.ceil(otherSeats.length / 2);
    seatsZone.className = `zone seats o${Math.min(others.length || S.others, 5)}`;
    seatsZone.replaceChildren(h('div', { class: 'others left' }, otherSeats.slice(0, half)), mine, h('div', { class: 'others right' }, otherSeats.slice(half)));
  }

  function renderControls() {
    if (phase === 'check') return;
    if (phase === 'bet' && !sess()) {
      const can = G.bankroll >= RULES.buyIn;
      controls.replaceChildren(h('div', { class: 'session-start' },
        h('div', {}, `Bankroll ${money(G.bankroll)}. Each session buys in for ${money(RULES.buyIn)}; it ends at the stop-loss (the whole buy-in lost) or when you cash out.`),
        can
          ? h('button', { class: 'btn primary deal', onclick: () => { sfx.chip(4); startSession(); } }, `Buy in ${money(RULES.buyIn)}`, h('kbd', {}, 'Enter'))
          : h('div', { class: 'row' }, h('span', { class: 'bad' }, 'Bankroll can’t cover a buy-in.'),
            h('button', { class: 'btn', onclick: resetBankroll }, `Reset bankroll to ${money(RULES.bankroll)}`))));
      return;
    }
    if (phase === 'bet') {
      const chipColors = ['green', 'orange', 'purple'];
      controls.replaceChildren(
        h('div', { class: 'bet-row' },
          h('div', { class: 'bet-quick' }, BETS.map((b, i) => h('button', {
            class: `chip-btn ${chipColors[i]}${bet === b ? ' on' : ''}`, disabled: b > stack(), 'aria-label': `Bet ${money(b)}`,
            onclick: () => { setBet(b); sfx.chip(i + 1); render(); },
          }, h('span', { class: 'chip-face' }, String(b)), h('kbd', {}, String(i + 1))))),
          h('div', { class: 'bet-adjust' },
            h('button', { class: 'btn round', onclick: () => { setBet(bet - MIN); sfx.chip(1); render(); }, 'aria-label': 'Lower bet' }, '−'),
            h('div', { class: 'bet-amt' }, h('div', { class: 'v' }, money(bet)), h('div', { class: 'k' }, 'bet')),
            h('button', { class: 'btn round', onclick: () => { setBet(bet + MIN); sfx.chip(1); render(); }, 'aria-label': 'Raise bet' }, '+')),
          h('button', { class: 'btn primary deal', onclick: () => run(deal), disabled: bet > stack() }, 'Deal', h('kbd', {}, 'Space'))),
        h('div', { class: 'bet-sub' },
          training
            ? h('button', { class: 'btn sm', onclick: () => { practice.stack = PRACTICE; practice.buyIn = PRACTICE; sfx.chip(5); render(); } }, 'Reset chips')
            : h('button', { class: 'btn sm', onclick: () => endSession('Cashed out') }, `Cash out ${money(stack())}`),
          h('button', { class: 'link', onclick: newShoe }, 'Shuffle new shoe'),
          h('span', { class: 'muted hide-sm' }, '1/2/3 or ↑/↓ set the bet')));
      return;
    }
    const hint = training && cheatCfg.cheat ? cheatAdvice().key : null;
    if (phase === 'insurance') {
      controls.replaceChildren(h('div', { class: 'ins-row' },
        h('span', { class: 'ins-q' }, 'Dealer shows an Ace. Insurance?'),
        h('div', { class: 'ins-btns' },
          h('button', { class: `btn act${hint === 'Y' ? ' hint' : ''}`, onclick: () => pendingInsurance?.(true) }, 'Yes', h('kbd', {}, 'Y')),
          h('button', { class: `btn act${hint === 'N' ? ' hint' : ''}`, onclick: () => pendingInsurance?.(false) }, 'No', h('kbd', {}, 'N')))));
      return;
    }
    const hd = hands[active];
    const o = phase === 'play' && hd ? optsFor(hd) : null;
    const icons = { H: '＋', S: '✋', D: '×2', P: '⇆', R: '⚑' };
    controls.replaceChildren(h('div', { class: `actions table-acts ${ACTS.length > 4 ? 'five' : 'four'}` }, ACTS.map((a) => h('button', {
      class: `btn act act-${a}${o && !busy && hint === a ? ' hint' : ''}`, disabled: !o || busy || !allowed(a, o), onclick: () => run(() => act(a)),
    }, h('span', { class: 'act-icon', 'aria-hidden': 'true' }, icons[a]), h('span', { class: 'act-label' }, ACTIONS[a]), h('kbd', {}, a)))));
  }

  function render() {
    if (!alive) return;
    renderHud();
    renderCheat();
    renderTable();
    renderControls();
  }

  // ---- sessions ----------------------------------------------------------
  function startSession() {
    if (sess() || G.bankroll < RULES.buyIn) return;
    G.bankroll -= RULES.buyIn;
    G.session = { start: Date.now(), buyIn: RULES.buyIn, stack: RULES.buyIn, activeMs: 0, hands: 0, decisions: 0, correct: 0, devs: 0, devsCorrect: 0, checks: 0, checksCorrect: 0, bets: 0, betsCorrect: 0, peeks: 0 };
    lastActivity = Date.now();
    notes = [];
    note(`Session started: ${money(RULES.buyIn)} buy-in. Stop-loss at ${money(RULES.buyIn)} down.`, 'info');
    setBet(MIN);
    render();
    ctx.save();
  }

  function endSession(reason) {
    const s = sess();
    if (!s || phase !== 'bet') return;
    touch();
    G.bankroll += s.stack;
    G.sessions.push({
      id: `${s.start}`, kind: 'sim', t: s.start, end: Date.now(), buyIn: s.buyIn, cashOut: s.stack,
      hours: Math.round((s.activeMs / 3.6e6) * 100) / 100, hands: s.hands,
      countAcc: s.checks ? Math.round((100 * s.checksCorrect) / s.checks) : null,
      decisionAcc: s.decisions ? Math.round((100 * s.correct) / s.decisions) : null,
      betAcc: s.bets ? Math.round((100 * s.betsCorrect) / s.bets) : null,
      peeks: s.peeks, notes: reason,
    });
    G.session = null;
    note(`${reason}: ${money(s.stack - s.buyIn, { sign: true })} over ${s.hands} hand${s.hands === 1 ? '' : 's'}. Logged in Sessions.`, s.stack >= s.buyIn ? 'good' : 'bad');
    hands = [];
    render();
    ctx.save();
  }

  function resetBankroll() {
    G.bankroll = RULES.bankroll;
    note(`Bankroll reset to ${money(RULES.bankroll)}.`, 'info');
    render();
    ctx.save();
  }

  // ---- round flow --------------------------------------------------------
  async function run(fn) {
    try { await fn(); } catch (e) { if (e !== ABORT) throw e; }
  }

  async function deal() {
    if (phase !== 'bet' || busy || !sess() || bet > stack()) return;
    touch();
    busy = true;
    phase = 'dealing';
    notes = [];
    fb.replaceChildren();

    const want = betFor(tc());
    const betOk = bet === want;
    count('bets', betOk);
    note(betOk ? `✓ Bet ${money(bet)} fits the ramp.` : `✗ Ramp says ${money(want)} at TC ${signed(tc())} — you bet ${money(bet)}.`, betOk ? 'good bet' : 'warn bet');

    if (dealer.length) sfx.collect(); // sweep last round's cards
    sfx.chip(2);
    if (shoeFresh) {
      shoeFresh = false;
      note('Shuffling…', 'info');
      sfx.shuffle();
      await step(shuffleMs());
    }
    sess().stack -= bet;
    insuranceBet = 0;
    hands = [{ cards: [], bet }];
    dealer = [];
    others = Array.from({ length: S.others }, () => ({ cards: [] }));

    for (let r = 0; r < 2; r++) {
      for (const o of others) { o.cards.push(draw()); await step(); }
      hands[0].cards.push(draw()); await step();
      dealer.push(draw(r === 1)); await step();
    }

    const up = upValue(dealer[0]);
    if (up === 11) {
      phase = 'insurance';
      busy = false;
      render();
      const take = await new Promise((res) => { pendingInsurance = res; });
      pendingInsurance = null;
      if (!alive) throw ABORT;
      busy = true;
      phase = 'dealing';
      gradeInsurance(take);
      if (take) { insuranceBet = Math.min(bet / 2, stack()); sess().stack -= insuranceBet; sfx.chip(1); }
    }

    if ((up === 11 || up === 10) && isBlackjack(dealer)) {
      revealHole();
      note('Dealer has blackjack.', 'bad');
      await step();
      return finishRound();
    }
    if (insuranceBet) note('No dealer blackjack — insurance lost.');

    for (const o of others) await autoPlay(o);
    if (isBlackjack(hands[0].cards)) hands[0].done = true;
    active = 0;
    return advance();
  }

  async function autoPlay(o) {
    const up = upValue(dealer[0]);
    if (isBlackjack(o.cards)) return;
    for (;;) {
      if (handTotal(o.cards).total >= 21) return;
      const { action } = correctAction(o.cards, up, { canDouble: o.cards.length === 2, canSplit: false });
      if (action === 'S') return;
      o.cards.push(draw());
      await step();
      if (action === 'D') return;
    }
  }

  async function advance() {
    while (active < hands.length && hands[active].done) active++;
    if (active < hands.length) {
      phase = 'play';
      busy = false;
      render();
      return;
    }
    busy = true;
    phase = 'dealer';
    await dealerPlay();
    return finishRound();
  }

  async function act(a) {
    if (phase !== 'play' || busy) return;
    const hd = hands[active];
    const o = optsFor(hd);
    if (!allowed(a, o)) return;
    busy = true;
    grade(hd, a, o);
    if (a === 'H') {
      hd.cards.push(draw());
      await step();
      if (handTotal(hd.cards).total >= 21) hd.done = true;
    } else if (a === 'S') {
      hd.done = true;
    } else if (a === 'R') {
      hd.surrendered = true;
      hd.done = true;
    } else if (a === 'D') {
      sfx.chip(2);
      sess().stack -= hd.bet;
      hd.bet *= 2;
      hd.cards.push(draw());
      await step();
      hd.done = true;
    } else if (a === 'P') {
      const moved = hd.cards.pop();
      const nh = { cards: [moved], bet: hd.bet, fromSplit: true };
      hd.fromSplit = true;
      sfx.chip(2);
      sess().stack -= hd.bet;
      hands.splice(active + 1, 0, nh);
      const aces = rankKey(moved.rank) === 'A';
      hd.cards.push(draw()); await step();
      nh.cards.push(draw()); await step();
      for (const x of [hd, nh]) {
        if (aces) { x.splitAces = true; x.done = true; }
        else if (handTotal(x.cards).total === 21) x.done = true;
      }
    }
    return advance();
  }

  function revealHole() {
    const hole = dealer.find((c) => c.down);
    if (hole) { hole.down = false; hole.flip = true; rc += hiLo(hole); sfx.flip(); }
  }

  async function dealerPlay() {
    revealHole();
    await step();
    const natural = hands.length === 1 && isBlackjack(hands[0].cards);
    const live = (!natural && hands.some((x) => !x.surrendered && handTotal(x.cards).total <= 21))
      || others.some((o) => handTotal(o.cards).total <= 21 && !isBlackjack(o.cards));
    if (!live) return;
    while (handTotal(dealer).total < 17) { dealer.push(draw()); await step(); } // stands on all 17s
  }

  async function finishRound() {
    const d = handTotal(dealer);
    const dBJ = isBlackjack(dealer);
    let payout = 0;
    let wagered = insuranceBet;
    if (insuranceBet && dBJ) payout += insuranceBet * 3;
    for (const x of hands) {
      wagered += x.bet;
      const p = handTotal(x.cards).total;
      const natural = hands.length === 1 && isBlackjack(x.cards);
      let r;
      if (x.surrendered) r = ['Surrendered', x.bet / 2, 'push'];
      else if (p > 21) r = ['Bust', 0, 'lose'];
      else if (dBJ) r = natural ? ['Push', x.bet, 'push'] : ['Lose', 0, 'lose'];
      else if (natural) r = ['Blackjack!', x.bet * 2.5, 'win'];
      else if (d.total > 21 || p > d.total) r = ['Win', x.bet * 2, 'win'];
      else if (p === d.total) r = ['Push', x.bet, 'push'];
      else r = ['Lose', 0, 'lose'];
      x.result = { text: r[0], cls: r[2] };
      payout += r[1];
    }
    const net = payout - wagered;
    sess().stack += payout;
    T.hands++;
    sess().hands++;
    touch();
    note(`Round: ${money(net, { sign: true })}`, net > 0 ? 'good' : net < 0 ? 'bad' : '');
    if (hands.some((x) => x.result.text === 'Blackjack!')) sfx.blackjack();
    else if (net > 0) sfx.win();
    else if (net < 0 && hands.every((x) => x.result.text === 'Bust')) sfx.bust();
    else if (net < 0) sfx.lose();
    else sfx.push();
    hands.forEach((x) => { x.done = true; });
    busy = false;
    render();
    ctx.save();

    const due = S.countCheck === 'every' || (S.countCheck === 'random' && Math.random() < 0.3) || (S.countCheck === 'shoe' && shoe.pastCut);
    if (due) await countCheck();
    if (!alive) return;
    if (shoe.pastCut) {
      shoe.shuffle();
      rc = 0;
      shoeFresh = true;
      note('Cut card reached (75%) — the dealer shuffles before the next hand. Count back to 0.', 'info');
    }
    phase = 'bet';
    if (training && stack() < MIN) {
      practice.stack += PRACTICE;
      practice.buyIn += PRACTICE;
      note(`Practice chips topped up by ${money(PRACTICE)}.`, 'info');
      setBet(bet);
      render();
    } else if (stack() < MIN) {
      endSession('Stop-loss hit');
    } else {
      setBet(bet);
      render();
    }
    ctx.save();
  }

  // ---- grading -----------------------------------------------------------
  function grade(hd, a, o) {
    const up = upValue(dealer[0]);
    const results = tcCandidates(rc, shoe.remaining).map((t) => correctAction(hd.cards, up, o, t));
    const ok = results.some((r) => r.action === a);
    const main = results[0];
    const devRes = results.find((r) => r.dev);
    const label = `${handLabel(hd.cards)} vs ${upLabel(up)}`;
    count('decisions', ok);
    if (devRes) count('devs', ok);
    if (ok) note(`✓ ${ACTIONS[a]} on ${label}${devRes ? ` — ${devRes.note}` : ''}`, 'good play');
    else {
      sfx.wrong();
      note(`✗ ${ACTIONS[a]} on ${label}. Correct: ${ACTIONS[main.action]}${main.dev ? ` — ${main.note} (TC ${signed(tc())})` : ' (basic strategy)'}`, 'bad play');
      T.misses[label] = (T.misses[label] || 0) + 1;
    }
  }

  function gradeInsurance(take) {
    const answers = new Set(tcCandidates(rc, shoe.remaining).map((t) => insuranceCorrect(t)));
    const ok = answers.has(take);
    count('decisions', ok);
    count('devs', ok);
    note(`${ok ? '✓' : '✗'} ${take ? 'Took' : 'Declined'} insurance — take it at TC ≥ +3 (TC now ${signed(tc())}).`, ok ? 'good play' : 'bad play');
    if (!ok) T.misses.Insurance = (T.misses.Insurance || 0) + 1;
  }

  function countCheck() {
    return new Promise((resolve) => {
      phase = 'check';
      const rcF = numberField('Running count');
      const tcF = numberField('True count');
      const result = h('div', { class: 'check-result' });
      const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Check');
      let answered = false;
      const form = h('form', {
        class: 'check',
        onsubmit: (e) => {
          e.preventDefault();
          if (answered) { resolve(); return; }
          answered = true;
          const rcOk = rcF.value === rc;
          const cands = tcCandidates(rc, shoe.remaining);
          const tcOk = cands.includes(tcF.value);
          count('checks', rcOk && tcOk);
          if (rcOk && tcOk) sfx.right(); else sfx.wrong();
          const est = decksEstimate(shoe.remaining);
          result.replaceChildren(
            h('div', { class: rcOk ? 'good' : 'bad' }, `${rcOk ? '✓' : '✗'} Running count ${signed(rc)}${rcOk ? '' : ` (you said ${rcF.value == null ? '—' : signed(rcF.value)})`}`),
            h('div', { class: tcOk ? 'good' : 'bad' }, `${tcOk ? '✓' : '✗'} True count ${signed(cands[0])} = ${signed(rc)} ÷ ${est} decks, rounded down`));
          btn.textContent = 'Continue';
          btn.focus();
          ctx.save();
        },
      },
      h('div', { class: 'check-title' }, 'Count check'),
      h('div', { class: 'check-fields' }, rcF.el, tcF.el, btn),
      result);
      controls.replaceChildren(form);
      rcF.input.focus();
    });
  }

  // ---- misc --------------------------------------------------------------
  function toggleReveal() {
    reveal = !reveal;
    if (reveal) { T.peeks++; if (sess()) sess().peeks++; }
    renderHud();
  }

  function newShoe() {
    if (phase !== 'bet') return;
    shoe.shuffle();
    rc = 0;
    shoeFresh = false;
    sfx.shuffle();
    hands = []; dealer = []; others = [];
    notes = [];
    note('New shoe. Count starts at 0.', 'info');
    render();
  }

  function onKey(e) {
    if (typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'c' && phase !== 'check') { toggleReveal(); return; }
    if (k === 'x' && training) { toggleCheat(); return; }
    if (phase === 'bet' && !sess()) {
      if (k === 'enter' || k === ' ') { e.preventDefault(); startSession(); }
    } else if (phase === 'bet') {
      if (k === ' ' || k === 'enter') { e.preventDefault(); run(deal); }
      else if (k === 'arrowup') { e.preventDefault(); setBet(bet + MIN); render(); }
      else if (k === 'arrowdown') { e.preventDefault(); setBet(bet - MIN); render(); }
      else if (['1', '2', '3'].includes(k)) { setBet(BETS[Number(k) - 1]); sfx.chip(Number(k)); render(); }
    } else if (phase === 'insurance' && (k === 'y' || k === 'n')) {
      pendingInsurance?.(k === 'y');
    } else if (phase === 'play' && k.length === 1 && 'hsdpr'.includes(k)) {
      run(() => act(k.toUpperCase()));
    }
  }
  addEventListener('keydown', onKey);

  if (training) note(`Training table: ${money(PRACTICE)} in practice chips. Press X to toggle the cheat panel (count, true count, bet and the correct play).`, 'info');
  else if (sess()) note(`Session in progress: ${money(stack())} stack. New shoe — count starts at 0.`, 'info');
  setBet(MIN);
  render();

  return () => {
    alive = false;
    removeEventListener('keydown', onKey);
    if (sess() && hands.length && !hands.every((x) => x.result)) {
      sess().stack += hands.reduce((s, x) => s + x.bet, 0) + insuranceBet; // abandoned round: refund
    }
    ctx.save();
  };
}

export const tableSummary = (T) => ({
  decisions: pct(T.correct, T.decisions),
  devs: pct(T.devsCorrect, T.devs),
  checks: pct(T.checksCorrect, T.checks),
  bets: pct(T.betsCorrect, T.bets),
});
