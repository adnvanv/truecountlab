// Full table: play hands against the dealer while keeping the count.
import { h, cardEl, sleep, signed, trayEl, money, numberField, typingInField } from '../ui.js';
import { Shoe, SYSTEMS, tagOf, initialCount, trueCount, rankKey, tcCandidates } from '../cards.js';
import { handTotal, isBlackjack, correctAction, insuranceCorrect, upValue, handLabel, upLabel, ACTIONS } from '../strategy.js';

const ABORT = Symbol('abort');

export function mount(root, ctx) {
  const S = ctx.settings;
  const T = ctx.stats.table;
  const sys = SYSTEMS[S.system];
  const rules = { h17: S.h17, das: S.das, surrender: S.surrender };
  const useDev = S.deviations && S.system === 'hilo';
  let alive = true;

  const shoe = new Shoe(S.decks, S.penetration / 100);
  let rc = initialCount(S.system, S.decks);
  if (T.bankroll == null) T.bankroll = S.bankroll;
  let bet = S.unit;
  setBet(T.lastBet ?? S.unit);

  let phase = 'bet'; // bet | dealing | insurance | play | dealer | check
  let busy = false;
  let dealer = [];
  let others = [];
  let hands = [];
  let active = 0;
  let insuranceBet = 0;
  let pendingInsurance = null;
  let peekUntil = 0;
  let peekTimer = null;
  let notes = [];

  const hud = h('div', { class: 'hud' });
  const dealerZone = h('div', { class: 'zone dealer-zone' });
  const seatsZone = h('div', { class: 'zone seats' });
  const fb = h('div', { class: 'feedback', 'aria-live': 'polite' });
  const controls = h('div', { class: 'controls' });
  root.append(h('section', { class: 'view table-view' }, hud, h('div', { class: 'felt' }, dealerZone, seatsZone), fb, controls));

  // ---- helpers -----------------------------------------------------------
  const exactTC = () => trueCount(rc, shoe.remaining / 52, S.tcMode);
  const tcs = () => (sys.balanced ? tcCandidates(rc, shoe.remaining, S.tcMode) : [null]);
  const takeAnim = (c) => { if (c.anim) { c.anim = false; return true; } return false; };

  function setBet(v) {
    const maxBet = Math.max(S.unit, Math.floor(T.bankroll / S.unit) * S.unit);
    bet = Math.min(Math.max(S.unit, Math.round(v / S.unit) * S.unit), maxBet);
  }

  function see(c) { rc += tagOf(S.system, c); }

  function draw(faceDown = false) {
    if (shoe.remaining === 0) {
      shoe.shuffle();
      rc = initialCount(S.system, S.decks);
      note('Shoe ran out mid-round — reshuffled, count reset.', 'warn');
    }
    const c = shoe.draw();
    c.anim = true;
    if (faceDown) c.down = true; else see(c);
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
    renderFb();
  }

  function recommendedUnits() {
    if (S.system === 'ko') {
      if (rc >= 4) return S.spread;
      if (rc >= 2) return Math.max(1, Math.round(S.spread / 2));
      return 1;
    }
    return Math.max(1, Math.min(S.spread, exactTC() - 1));
  }

  function optsFor(hd) {
    const two = hd.cards.length === 2;
    return {
      canDouble: two && T.bankroll >= hd.bet && (!hd.fromSplit || rules.das),
      canSplit: two && rankKey(hd.cards[0].rank) === rankKey(hd.cards[1].rank) && hands.length < 4 && T.bankroll >= hd.bet,
      canSurrender: rules.surrender && two && hands.length === 1,
      das: rules.das,
    };
  }
  const allowed = (a, o) => a === 'H' || a === 'S' || (a === 'D' && o.canDouble) || (a === 'P' && o.canSplit) || (a === 'R' && o.canSurrender);

  function totalText(cards) {
    const vis = cards.filter((c) => !c.down);
    if (!vis.length) return '';
    const { total, soft } = handTotal(vis);
    if (total > 21) return 'Bust';
    if (vis.length === 2 && total === 21 && cards.length === 2) return 'BJ';
    return soft && total < 21 ? `${total - 10}/${total}` : String(total);
  }
  const badge = (cards) => (cards.length ? h('span', { class: 'badge' }, totalText(cards)) : null);

  // ---- rendering ---------------------------------------------------------
  function renderHud() {
    const showing = S.showCount || Date.now() < peekUntil;
    const stat = (k, v) => h('div', { class: 'stat' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
    hud.replaceChildren(
      h('div', { class: 'hud-tray' }, trayEl(shoe.dealt, S.decks), h('span', { class: 'k' }, 'Discards')),
      h('div', { class: 'hud-info' },
        stat('Bankroll', money(T.bankroll)),
        stat('Shoe', `${(shoe.remaining / 52).toFixed(1)} of ${S.decks} decks left`),
        stat('System', `${sys.name}${useDev ? ' + indices' : ''}`),
        h('div', { class: `stat count${showing ? ' on' : ''}` },
          h('span', { class: 'k' }, 'Count'),
          showing
            ? h('span', { class: 'v mono' }, `RC ${signed(rc)}${sys.balanced ? `  ·  TC ${signed(exactTC())}` : ''}`)
            : h('button', { class: 'btn sm ghost', onclick: peek }, 'Peek'))));
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
        : h('div', { class: 'placeholder' }, 'Set your bet and deal.'));

    seatsZone.replaceChildren(...otherSeats, mine);
  }

  function renderFb() {
    fb.replaceChildren(...notes.map((n) => h('div', { class: `fb-line ${n.kind}` }, n.msg)));
  }

  function renderControls() {
    if (phase === 'check') return;
    if (phase === 'bet') {
      const broke = T.bankroll < S.unit;
      controls.replaceChildren(
        h('div', { class: 'bet-row' },
          h('button', { class: 'btn round', onclick: () => { setBet(bet - S.unit); render(); }, 'aria-label': 'Lower bet' }, '−'),
          h('div', { class: 'bet-amt' }, h('div', { class: 'v' }, money(bet)), h('div', { class: 'k' }, `${Math.round(bet / S.unit)} unit${bet === S.unit ? '' : 's'}`)),
          h('button', { class: 'btn round', onclick: () => { setBet(bet + S.unit); render(); }, 'aria-label': 'Raise bet' }, '+'),
          h('button', { class: 'btn primary deal', onclick: () => run(deal), disabled: broke || bet > T.bankroll }, 'Deal', h('kbd', {}, 'Space'))),
        h('div', { class: 'bet-sub' },
          broke ? h('button', { class: 'btn sm', onclick: rebuy }, `Rebuy ${money(S.bankroll)}`) : null,
          h('button', { class: 'link', onclick: newShoe }, 'Shuffle new shoe'),
          h('span', { class: 'muted' }, '↑/↓ change bet')));
      return;
    }
    if (phase === 'insurance') {
      controls.replaceChildren(h('div', { class: 'ins-row' },
        h('span', {}, 'Dealer shows an Ace. Insurance?'),
        h('button', { class: 'btn', onclick: () => pendingInsurance?.(true) }, 'Yes', h('kbd', {}, 'Y')),
        h('button', { class: 'btn', onclick: () => pendingInsurance?.(false) }, 'No', h('kbd', {}, 'N'))));
      return;
    }
    const hd = hands[active];
    const o = phase === 'play' && hd ? optsFor(hd) : null;
    const acts = ['H', 'S', 'D', 'P'].concat(rules.surrender ? ['R'] : []);
    controls.replaceChildren(h('div', { class: 'actions' }, acts.map((a) => h('button', {
      class: `btn act act-${a}`, disabled: !o || busy || !allowed(a, o), onclick: () => run(() => act(a)),
    }, h('span', {}, ACTIONS[a]), h('kbd', {}, a)))));
  }

  function render() {
    if (!alive) return;
    renderHud();
    renderTable();
    renderControls();
  }

  // ---- round flow --------------------------------------------------------
  async function run(fn) {
    try { await fn(); } catch (e) { if (e !== ABORT) throw e; }
  }

  async function deal() {
    if (phase !== 'bet' || busy || bet > T.bankroll || T.bankroll < S.unit) return;
    busy = true;
    phase = 'dealing';
    notes = [];
    renderFb();

    if (S.betHints) {
      const rec = recommendedUnits();
      const mine = Math.round(bet / S.unit);
      T.bets++;
      if (mine === rec) { T.betsCorrect++; note(`Bet ${mine}u matches the ramp.`, 'good'); }
      else note(`Bet ramp says ${rec}u at ${S.system === 'ko' ? `RC ${signed(rc)}` : `TC ${signed(exactTC())}`} — you bet ${mine}u.`, 'warn');
    }

    T.lastBet = bet;
    T.bankroll -= bet;
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
      if (take) { insuranceBet = Math.min(bet / 2, T.bankroll); T.bankroll -= insuranceBet; }
    }

    if ((up === 11 || up === 10) && isBlackjack(dealer)) {
      revealHole();
      note('Dealer has blackjack.', 'bad');
      await step();
      return finishRound();
    }
    if (insuranceBet) note(`No dealer blackjack — insurance lost.`);

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
      const { action } = correctAction(o.cards, up, rules, { canDouble: o.cards.length === 2, canSplit: false, canSurrender: false, das: rules.das });
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
    } else if (a === 'D') {
      T.bankroll -= hd.bet;
      hd.bet *= 2;
      hd.cards.push(draw());
      await step();
      hd.done = true;
    } else if (a === 'R') {
      hd.surrendered = true;
      hd.done = true;
    } else if (a === 'P') {
      const moved = hd.cards.pop();
      const nh = { cards: [moved], bet: hd.bet, fromSplit: true };
      hd.fromSplit = true;
      T.bankroll -= hd.bet;
      hands.splice(active + 1, 0, nh);
      const aces = rankKey(moved.rank) === 'A';
      hd.cards.push(draw()); await step();
      nh.cards.push(draw()); await step();
      for (const x of [hd, nh]) if (aces || handTotal(x.cards).total === 21) x.done = true;
    }
    return advance();
  }

  function revealHole() {
    const hole = dealer.find((c) => c.down);
    if (hole) { hole.down = false; hole.anim = true; see(hole); }
  }

  async function dealerPlay() {
    revealHole();
    await step();
    const natural = hands.length === 1 && isBlackjack(hands[0].cards);
    const live = hands.some((x) => !x.surrendered && handTotal(x.cards).total <= 21) && !natural
      || others.some((o) => handTotal(o.cards).total <= 21 && !isBlackjack(o.cards));
    if (!live) return;
    for (;;) {
      const { total, soft } = handTotal(dealer);
      if (total < 17 || (total === 17 && soft && rules.h17)) { dealer.push(draw()); await step(); } else break;
    }
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
    T.bankroll += payout;
    T.net += net;
    T.hands++;
    note(`Round: ${net > 0 ? '+' : ''}${money(net)}`, net > 0 ? 'good' : net < 0 ? 'bad' : '');
    hands.forEach((x) => { x.done = true; });
    busy = false;
    phase = 'dealer';
    render();
    ctx.save();

    const due = S.countCheck === 'every' || (S.countCheck === 'random' && Math.random() < 0.3) || (S.countCheck === 'shoe' && shoe.pastCut);
    if (due) await countCheck();
    if (!alive) return;
    if (shoe.pastCut) {
      shoe.shuffle();
      rc = initialCount(S.system, S.decks);
      note(`Cut card reached — fresh shoe. Count resets to ${signed(rc)}.`, 'info');
    }
    setBet(bet);
    phase = 'bet';
    render();
    ctx.save();
  }

  // ---- grading -----------------------------------------------------------
  function grade(hd, a, o) {
    const up = upValue(dealer[0]);
    const results = tcs().map((tc) => correctAction(hd.cards, up, rules, o, tc, useDev));
    const ok = results.some((r) => r.action === a);
    const main = results[0];
    const devRes = results.find((r) => r.dev);
    const label = `${handLabel(hd.cards)} vs ${upLabel(up)}`;
    T.decisions++;
    if (ok) T.correct++;
    if (devRes) { T.devs++; if (ok) T.devsCorrect++; }
    if (ok) {
      note(`✓ ${ACTIONS[a]} on ${label}${devRes ? ` — ${devRes.note}` : ''}`, 'good');
    } else {
      note(`✗ ${ACTIONS[a]} on ${label}. Correct: ${ACTIONS[main.action]}${main.dev ? ` — ${main.note} (TC ${signed(exactTC())})` : ' (basic strategy)'}`, 'bad');
      T.misses[label] = (T.misses[label] || 0) + 1;
    }
  }

  function gradeInsurance(take) {
    const answers = new Set(tcs().map((tc) => insuranceCorrect(tc, useDev)));
    const ok = answers.has(take);
    T.decisions++;
    if (ok) T.correct++;
    if (answers.has(true)) { T.devs++; if (ok) T.devsCorrect++; }
    const why = useDev ? `take it at TC ≥ +3 (TC now ${signed(exactTC())})` : 'never take insurance without index plays';
    note(ok ? `✓ ${take ? 'Took' : 'Declined'} insurance — ${why}.` : `✗ ${take ? 'Took' : 'Declined'} insurance — ${why}.`, ok ? 'good' : 'bad');
    if (!ok) T.misses['Insurance'] = (T.misses['Insurance'] || 0) + 1;
  }

  function countCheck() {
    return new Promise((resolve) => {
      phase = 'check';
      const rcF = numberField('Running count');
      const tcF = sys.balanced ? numberField('True count') : null;
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
          const cands = tcs();
          const tcOk = !tcF || cands.includes(tcF.value);
          T.checks++;
          if (rcOk && tcOk) T.checksCorrect++;
          const decks = shoe.remaining / 52;
          result.replaceChildren(
            h('div', { class: rcOk ? 'good' : 'bad' }, `${rcOk ? '✓' : '✗'} Running count ${signed(rc)}${rcOk ? '' : ` (you said ${rcF.value == null ? '—' : signed(rcF.value)})`}`),
            tcF ? h('div', { class: tcOk ? 'good' : 'bad' }, `${tcOk ? '✓' : '✗'} True count ${signed(cands[0])} = ${signed(rc)} ÷ ${decks.toFixed(1)} decks`) : null);
          btn.textContent = 'Continue';
          btn.focus();
          ctx.save();
        },
      },
      h('div', { class: 'check-title' }, 'Count check'),
      h('div', { class: 'check-fields' }, rcF.el, tcF ? tcF.el : null, btn),
      result);
      controls.replaceChildren(form);
      rcF.input.focus();
    });
  }

  // ---- misc actions ------------------------------------------------------
  function peek() {
    peekUntil = Date.now() + 2500;
    T.peeks++;
    renderHud();
    clearTimeout(peekTimer);
    peekTimer = setTimeout(renderHud, 2600);
  }

  function rebuy() {
    T.bankroll += S.bankroll;
    setBet(S.unit);
    note(`Rebought ${money(S.bankroll)}.`, 'info');
    render();
    ctx.save();
  }

  function newShoe() {
    if (phase !== 'bet') return;
    shoe.shuffle();
    rc = initialCount(S.system, S.decks);
    hands = []; dealer = []; others = [];
    notes = [];
    note(`New shoe. Count starts at ${signed(rc)}.`, 'info');
    render();
  }

  function onKey(e) {
    if (typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (phase === 'bet') {
      if (k === ' ' || k === 'enter') { e.preventDefault(); run(deal); }
      else if (k === 'arrowup') { e.preventDefault(); setBet(bet + S.unit); render(); }
      else if (k === 'arrowdown') { e.preventDefault(); setBet(bet - S.unit); render(); }
    } else if (phase === 'insurance' && (k === 'y' || k === 'n')) {
      pendingInsurance?.(k === 'y');
    } else if (phase === 'play' && k.length === 1 && 'hsdpr'.includes(k)) {
      run(() => act(k.toUpperCase()));
    }
  }
  addEventListener('keydown', onKey);

  if (S.system === 'ko') note(`KO count starts at ${signed(rc)} for ${S.decks} decks (4 − 4×decks). Bet up at +4.`, 'info');
  render();

  return () => {
    alive = false;
    removeEventListener('keydown', onKey);
    clearTimeout(peekTimer);
    if (phase !== 'bet' && hands.length && !hands.every((x) => x.result)) {
      // Round abandoned mid-way: refund outstanding wagers.
      T.bankroll += hands.reduce((s, x) => s + x.bet, 0) + insuranceBet;
    }
    ctx.save();
  };
}
