// Full table simulation (mode 7) with sessions: $500 buy-in, stop-loss at the buy-in.
import { h, cardEl, sleep, signed, trayEl, money, numberField, typingInField, pct } from '../ui.js';
import { RULES, BETS, betFor, Shoe, hiLo, rankKey, tcFromCards, tcCandidates, decksEstimate } from '../cards.js';
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

  const hud = h('div', { class: 'hud' });
  const dealerZone = h('div', { class: 'zone dealer-zone' });
  const seatsZone = h('div', { class: 'zone seats' });
  const fb = h('div', { class: 'feedback', 'aria-live': 'polite' });
  const controls = h('div', { class: 'controls' });
  const cheatPanel = h('div', { class: 'cheat-panel', 'aria-live': 'polite' });
  const rulesText = S.surrender ? RULES.text.replace('no surrender', 'late surrender (count-based)') : RULES.text;
  root.append(h('section', { class: `view table-view${training ? ' training' : ''}` },
    training
      ? h('div', { class: 'training-bar' },
        h('div', {}, h('strong', {}, 'Training table'), h('span', { class: 'muted' }, ' · practice chips, nothing logged · '), rulesText),
        h('button', { class: `btn sm cheat-btn${cheatCfg.cheat ? ' on' : ''}`, onclick: toggleCheat }, cheatCfg.cheat ? 'Cheat: ON' : 'Cheat: OFF', h('kbd', {}, 'X')))
      : h('div', { class: 'rules-line muted' }, rulesText),
    hud, training ? cheatPanel : null, h('div', { class: 'felt' }, dealerZone, seatsZone), fb, controls));

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
    if (shoe.remaining === 0) { shoe.shuffle(); rc = 0; note('Shoe ran out mid-round — reshuffled, count reset.', 'warn'); }
    const c = shoe.draw();
    c.anim = true;
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
    fb.replaceChildren(...notes.map((n) => h('div', { class: `fb-line ${n.kind}` }, n.msg)));
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

  function totalText(cards) {
    const vis = cards.filter((c) => !c.down);
    if (!vis.length) return '';
    const { total, soft } = handTotal(vis);
    if (total > 21) return 'Bust';
    if (cards.length === 2 && vis.length === 2 && total === 21) return 'BJ';
    return soft && total < 21 ? `${total - 10}/${total}` : String(total);
  }
  const badge = (cards) => (cards.length ? h('span', { class: 'badge' }, totalText(cards)) : null);

  // ---- rendering ---------------------------------------------------------
  function renderHud() {
    const stat = (k, v) => h('div', { class: 'stat' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
    const s = sess();
    hud.replaceChildren(
      h('div', { class: 'hud-tray' }, trayEl(shoe.dealt, RULES.decks), h('span', { class: 'k' }, 'Discards')),
      h('div', { class: 'hud-info' },
        training ? stat('Practice chips', `${money(s.stack)} (${money(s.stack - s.buyIn, { sign: true })})`)
          : stat('Session stack', s ? `${money(s.stack)} (${money(s.stack - s.buyIn, { sign: true })})` : '—'),
        training ? stat('Decisions', `${pct(T.correct, T.decisions)} of ${T.decisions}`) : stat('Bankroll', money(G.bankroll + stack())),
        stat(training ? 'Hands' : 'Hands this session', s ? String(s.hands || 0) : '—'),
        h('div', { class: `stat count${reveal ? ' on' : ''}` },
          h('span', { class: 'k' }, 'Count'),
          h('div', { class: 'count-row' },
            reveal ? h('span', { class: 'v mono' }, `RC ${signed(rc)} · TC ${signed(tc())}`) : h('span', { class: 'v muted' }, 'Hidden'),
            h('button', { class: 'btn sm ghost', onclick: toggleReveal, title: 'Show or hide the count (C)' }, reveal ? 'Hide' : 'Reveal', h('kbd', {}, 'C'))))));
  }

  function renderTable() {
    dealerZone.replaceChildren(
      h('div', { class: 'zone-label' }, 'Dealer', badge(dealer)),
      h('div', { class: 'hand' }, dealer.length ? dealer.map((c) => cardEl(c, { down: c.down, anim: takeAnim(c) })) : h('div', { class: 'slot' })));
    const otherSeats = others.map((o, i) => h('div', { class: 'seat other' },
      h('div', { class: 'zone-label' }, `Player ${i + 1}`, badge(o.cards)),
      h('div', { class: 'hand' }, o.cards.map((c) => cardEl(c, { size: 'sm', anim: takeAnim(c) })))));
    const mine = h('div', { class: 'seat me' },
      h('div', { class: 'zone-label' }, 'You'),
      hands.length
        ? h('div', { class: 'my-hands' }, hands.map((hd, i) => h('div', {
          class: `my-hand${phase === 'play' && i === active ? ' active' : ''}${hd.result ? ` ${hd.result.cls}` : ''}`,
        },
        h('div', { class: 'hand' }, hd.cards.map((c) => cardEl(c, { anim: takeAnim(c) }))),
        h('div', { class: 'hand-meta' }, badge(hd.cards), h('span', { class: 'chip' }, money(hd.bet)),
          hd.result ? h('span', { class: 'result' }, hd.result.text) : null))))
        : h('div', { class: 'placeholder' }, sess() ? 'Place your bet and deal.' : 'Start a session to play.'));
    seatsZone.replaceChildren(...otherSeats, mine);
  }

  function renderControls() {
    if (phase === 'check') return;
    if (phase === 'bet' && !sess()) {
      const can = G.bankroll >= RULES.buyIn;
      controls.replaceChildren(h('div', { class: 'session-start' },
        h('div', {}, `Bankroll ${money(G.bankroll)}. Each session buys in for ${money(RULES.buyIn)}; it ends at the stop-loss (the whole buy-in lost) or when you cash out.`),
        can
          ? h('button', { class: 'btn primary deal', onclick: startSession }, `Buy in ${money(RULES.buyIn)}`, h('kbd', {}, 'Enter'))
          : h('div', { class: 'row' }, h('span', { class: 'bad' }, 'Bankroll can’t cover a buy-in.'),
            h('button', { class: 'btn', onclick: resetBankroll }, `Reset bankroll to ${money(RULES.bankroll)}`))));
      return;
    }
    if (phase === 'bet') {
      controls.replaceChildren(
        h('div', { class: 'bet-row' },
          h('div', { class: 'bet-quick' }, BETS.map((b, i) => h('button', { class: `btn chip-btn${bet === b ? ' on' : ''}`, onclick: () => { setBet(b); render(); }, disabled: b > stack() }, money(b), h('kbd', {}, String(i + 1))))),
          h('div', { class: 'bet-adjust' },
            h('button', { class: 'btn round', onclick: () => { setBet(bet - MIN); render(); }, 'aria-label': 'Lower bet' }, '−'),
            h('div', { class: 'bet-amt' }, h('div', { class: 'v' }, money(bet)), h('div', { class: 'k' }, 'bet')),
            h('button', { class: 'btn round', onclick: () => { setBet(bet + MIN); render(); }, 'aria-label': 'Raise bet' }, '+')),
          h('button', { class: 'btn primary deal', onclick: () => run(deal), disabled: bet > stack() }, 'Deal', h('kbd', {}, 'Space'))),
        h('div', { class: 'bet-sub' },
          training
            ? h('button', { class: 'btn sm', onclick: () => { practice.stack = PRACTICE; practice.buyIn = PRACTICE; render(); } }, 'Reset chips')
            : h('button', { class: 'btn sm', onclick: () => endSession('Cashed out') }, `Cash out ${money(stack())}`),
          h('button', { class: 'link', onclick: newShoe }, 'Shuffle new shoe'),
          h('span', { class: 'muted hide-sm' }, '1/2/3 or ↑/↓ set the bet')));
      return;
    }
    const hint = training && cheatCfg.cheat ? cheatAdvice().key : null;
    if (phase === 'insurance') {
      controls.replaceChildren(h('div', { class: 'ins-row' },
        h('span', {}, 'Dealer shows an Ace. Insurance?'),
        h('button', { class: `btn${hint === 'Y' ? ' hint' : ''}`, onclick: () => pendingInsurance?.(true) }, 'Yes', h('kbd', {}, 'Y')),
        h('button', { class: `btn${hint === 'N' ? ' hint' : ''}`, onclick: () => pendingInsurance?.(false) }, 'No', h('kbd', {}, 'N'))));
      return;
    }
    const hd = hands[active];
    const o = phase === 'play' && hd ? optsFor(hd) : null;
    controls.replaceChildren(h('div', { class: `actions ${ACTS.length > 4 ? 'five' : 'four'}` }, ACTS.map((a) => h('button', {
      class: `btn act act-${a}${o && !busy && hint === a ? ' hint' : ''}`, disabled: !o || busy || !allowed(a, o), onclick: () => run(() => act(a)),
    }, h('span', {}, ACTIONS[a]), h('kbd', {}, a)))));
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
    note(betOk ? `✓ Bet ${money(bet)} fits the ramp.` : `✗ Ramp says ${money(want)} at TC ${signed(tc())} — you bet ${money(bet)}.`, betOk ? 'good' : 'warn');

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
      if (take) { insuranceBet = Math.min(bet / 2, stack()); sess().stack -= insuranceBet; }
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
      sess().stack -= hd.bet;
      hd.bet *= 2;
      hd.cards.push(draw());
      await step();
      hd.done = true;
    } else if (a === 'P') {
      const moved = hd.cards.pop();
      const nh = { cards: [moved], bet: hd.bet, fromSplit: true };
      hd.fromSplit = true;
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
    if (hole) { hole.down = false; hole.anim = true; rc += hiLo(hole); }
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
      note('Cut card reached (75%) — fresh shoe, count back to 0.', 'info');
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
    if (ok) note(`✓ ${ACTIONS[a]} on ${label}${devRes ? ` — ${devRes.note}` : ''}`, 'good');
    else {
      note(`✗ ${ACTIONS[a]} on ${label}. Correct: ${ACTIONS[main.action]}${main.dev ? ` — ${main.note} (TC ${signed(tc())})` : ' (basic strategy)'}`, 'bad');
      T.misses[label] = (T.misses[label] || 0) + 1;
    }
  }

  function gradeInsurance(take) {
    const answers = new Set(tcCandidates(rc, shoe.remaining).map((t) => insuranceCorrect(t)));
    const ok = answers.has(take);
    count('decisions', ok);
    count('devs', ok);
    note(`${ok ? '✓' : '✗'} ${take ? 'Took' : 'Declined'} insurance — take it at TC ≥ +3 (TC now ${signed(tc())}).`, ok ? 'good' : 'bad');
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
      else if (['1', '2', '3'].includes(k)) { setBet(BETS[Number(k) - 1]); render(); }
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
