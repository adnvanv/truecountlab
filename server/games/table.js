// Shared blackjack table: up to five players at one 6-deck shoe, same rules as the solo
// table (S17, DAS, 3:2, no surrender, 75% penetration). The server deals, keeps the
// count and grades every bet, play and count check, privately for each player.
'use strict';

module.exports = ({ cards: C, strategy: S }, records) => {
  const SCALE = Number(process.env.LIVE_TIME_SCALE) || 1;
  const ms = (n) => Math.round(n * SCALE);
  const SEATS = 5;
  const MIN = C.RULES.minBet;
  const MAX_BET = 200;
  const BUY_IN = C.RULES.buyIn;
  const T = { bet: 15000, insurance: 10000, turn: 20000, away: 4000, check: 20000, card: 550, settle: 4000, shuffle: 2200, between: 900 };
  const MAX_MISSED = 3; // rounds a dropped connection can miss before its seat is given up
  const ACTS = ['H', 'S', 'D', 'P'];
  const NAMES = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split' };
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  // $25, $37.50, −$12.50 (blackjack pays 3:2, so half dollars happen).
  const money = (n, sign = false) => {
    const a = Math.abs(n);
    return `${n < 0 ? '−' : sign && n > 0 ? '+' : sign ? '±' : ''}$${a % 1 ? a.toFixed(2) : a}`;
  };

  const plain = (c) => (c.down ? { down: true } : { rank: c.rank, suit: c.suit });

  return class Table {
    static kind = 'table';

    constructor(room) {
      this.room = room;
      this.shoe = new C.Shoe();
      this.rc = 0;
      this.fresh = true;
      this.seats = Array(SEATS).fill(null);
      this.dealer = [];
      this.phase = 'idle'; // idle | betting | shuffle | dealing | insurance | play | dealer | settle | check
      this.deadline = 0;
      this.turn = null; // { seat, hand }
      this.events = [];
      this.rounds = 0;
      this.sinceCheck = 0;
      this.dead = false;
      this.waiter = null;
      this.running = false;
    }

    get capacity() { return 12; } // five seats plus people watching
    status() { return this.seats.some(Boolean) ? 'playing' : 'waiting'; }
    summary() { return `${this.seats.filter(Boolean).length} of ${SEATS} seats taken`; }
    seatCount() { return this.seats.filter(Boolean).length; }
    hasRoom() { return this.seats.some((s) => !s); }

    destroy() { this.dead = true; this.release(); }

    // ---- small helpers ------------------------------------------------------
    sleep(n) { return new Promise((r) => setTimeout(r, ms(n))); }
    tc() { return C.tcFromCards(this.rc, this.shoe.remaining); }
    seatOf(id) { return this.seats.findIndex((s) => s && s.id === id); }
    event(text) { this.events.push(text); if (this.events.length > 6) this.events.shift(); }
    // kind: good | bad | warn | info | won | lost | even; cat: play | bet | check | round | info (styles the hand log).
    note(seat, text, kind, cat = 'info') { seat.notes.push({ text, kind, cat }); if (seat.notes.length > 8) seat.notes.shift(); }
    connected(seat) { return Boolean(this.room.members.get(seat.id)?.connected); }
    live() { return this.seats.filter((s) => s && s.hands.length); }

    stat(seat, key, ok) {
      const pairs = { decisions: 'correct', bets: 'betsCorrect', checks: 'checksCorrect' };
      for (const o of [seat.stats, seat.pending]) {
        o[key] = (o[key] || 0) + 1;
        if (ok) o[pairs[key]] = (o[pairs[key]] || 0) + 1;
      }
    }

    flushStats(seat) {
      const d = seat.pending;
      seat.pending = {};
      if (!seat.userId || !Object.keys(d).length) return;
      try { records.addTableStats(seat.userId, d); } catch (e) { console.error('Saving table stats failed:', e); }
    }

    draw(down = false) {
      if (this.shoe.remaining === 0) { this.shoe.shuffle(); this.rc = 0; this.event('The shoe ran out mid-round: reshuffled, count back to 0.'); }
      const c = this.shoe.draw();
      if (down) c.down = true; else this.rc += C.hiLo(c);
      return c;
    }

    async dealTo(list) {
      list.push(this.draw());
      this.room.changed();
      await this.sleep(T.card);
    }

    // Wait until done() is true or the time runs out. Actions call poke().
    wait(n, done) {
      return new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); this.waiter = null; resolve(); };
        const timer = setTimeout(finish, ms(n));
        this.deadline = Date.now() + ms(n);
        this.waiter = { done, finish };
        if (done()) finish();
      });
    }
    poke() { if (this.waiter && this.waiter.done()) this.waiter.finish(); }
    release() { if (this.waiter) this.waiter.finish(); }

    // ---- seats ----------------------------------------------------------------
    sit(m, i) {
      if (this.seatOf(m.id) >= 0) return 'You already have a seat.';
      if (!Number.isInteger(i) || i < 0 || i >= SEATS) return 'Pick a seat.';
      if (this.seats[i]) return 'That seat is taken.';
      this.seats[i] = {
        id: m.id, name: m.name, guest: m.guest, userId: m.userId,
        stack: BUY_IN, buyIns: 1, bet: null, out: false, missed: 0, hands: [], insurance: null,
        net: null, notes: [], stats: {}, pending: {}, check: null, leaving: false,
        late: this.phase === 'betting', // sat down with the bet timer already running
      };
      this.note(this.seats[i], `Sat down with ${money(BUY_IN)} in table chips. Bet ${money(MIN)}–${money(MAX_BET)}; the ramp is $25 at TC ≤ +1, $50 at +2/+3, $75 at +4 and up.`, 'info');
      this.room.system(`${m.name} sat down.`);
      this.run();
      return null;
    }

    standUp(i, why) {
      const s = this.seats[i];
      if (!s) return;
      if (s.hands.length && !['idle', 'betting', 'settle', 'check'].includes(this.phase)) { s.leaving = true; return; }
      this.flushStats(s);
      this.seats[i] = null;
      if (why) this.room.system(why);
      this.poke();
    }

    onJoin() {}
    onLeave(m) { const i = this.seatOf(m.id); if (i >= 0) this.standUp(i, `${m.name} left the table.`); }
    onDisconnect() { this.poke(); }
    onReconnect() {}

    // ---- the round loop ---------------------------------------------------------
    run() {
      if (this.running || this.dead) return;
      this.running = true;
      this.loop().catch((e) => console.error('Table loop failed:', e)).finally(() => {
        this.running = false;
        if (!this.dead && this.seats.some(Boolean)) setTimeout(() => this.run(), ms(T.between)); // someone sat down as it stopped
      });
    }

    async loop() {
      while (!this.dead && this.seats.some(Boolean)) {
        await this.betting();
        if (this.dead) return;
        const players = this.seats.filter((s) => s && s.bet > 0);
        if (!players.length) { this.phase = 'idle'; await this.sleep(T.between); continue; }
        await this.playRound(players);
        if (this.dead) return;
        await this.afterRound(players);
      }
      this.phase = 'idle';
      this.dealer = [];
      this.room.changed();
    }

    async betting() {
      for (const s of this.seats) {
        if (!s) continue;
        s.bet = null; s.out = false; s.hands = []; s.insurance = null; s.net = null; s.check = null; s.late = false;
        if (s.stack < MIN) {
          s.stack += BUY_IN; s.buyIns++;
          this.note(s, `Out of chips: rebought for ${money(BUY_IN)}.`, 'info');
        }
      }
      this.turn = null;
      this.dealer = [];
      this.phase = 'betting';
      this.betTc = C.tcCandidates(this.rc, this.shoe.remaining);
      this.room.changed();
      const pending = () => this.seats.filter((s) => s && s.bet == null && !s.out && this.connected(s));
      await this.wait(T.bet, () => pending().length === 0);
      for (let i = 0; i < SEATS; i++) {
        const s = this.seats[i];
        if (!s || s.bet != null) continue;
        if (this.connected(s) && !s.late) {
          // Online but no bet when the timer ran out: give the seat up so the table isn't held.
          this.room.tell(s.id, 'You didn’t bet in time, so you left your seat. Pick a seat to play again.');
          this.standUp(i, `${s.name} didn’t bet in time and left the seat.`);
          continue;
        }
        // Sat down late, or the connection dropped: sit this hand out and keep the seat.
        s.out = true;
        s.bet = 0;
        if (s.late) continue;
        if (++s.missed >= MAX_MISSED) this.standUp(i, `${s.name} was offline for ${MAX_MISSED} hands and lost the seat.`);
      }
    }

    async playRound(players) {
      this.rounds++;
      this.dealer = [];
      for (const s of players) { s.missed = 0; s.stack -= s.bet; s.hands = [{ cards: [], bet: s.bet }]; }
      if (this.fresh) {
        this.fresh = false;
        this.phase = 'shuffle';
        this.deadline = Date.now() + ms(T.shuffle);
        this.event('The dealer shuffles a fresh shoe. Count starts at 0.');
        this.room.changed();
        await this.sleep(T.shuffle);
      }
      this.phase = 'dealing';
      for (let r = 0; r < 2; r++) {
        for (const s of players) await this.dealTo(s.hands[0].cards);
        if (r === 0) await this.dealTo(this.dealer);
        else { this.dealer.push(this.draw(true)); this.room.changed(); await this.sleep(T.card); }
      }
      if (this.dead) return;

      const up = S.upValue(this.dealer[0]);
      if (up === 11) await this.insurance(players);
      if ((up === 11 || up === 10) && S.isBlackjack(this.dealer)) {
        this.revealHole();
        this.event('Dealer has blackjack.');
        this.room.changed();
        await this.sleep(T.card * 2);
        return this.settle(players);
      }
      if (players.some((s) => s.insurance > 0)) this.event('No dealer blackjack: insurance loses.');

      for (const s of players) {
        for (let h = 0; h < s.hands.length; h++) {
          const hd = s.hands[h];
          if (s.hands.length === 1 && S.isBlackjack(hd.cards)) hd.done = true;
          while (!hd.done && !this.dead) await this.turnFor(s, h);
        }
      }
      this.turn = null;
      this.phase = 'dealer';
      this.revealHole();
      this.room.changed();
      await this.sleep(T.card);
      const needsDealer = players.some((s) => s.hands.some((hd) => S.handTotal(hd.cards).total <= 21 && !(s.hands.length === 1 && S.isBlackjack(hd.cards))));
      if (needsDealer) while (S.handTotal(this.dealer).total < 17) await this.dealTo(this.dealer);
      return this.settle(players);
    }

    async insurance(players) {
      this.phase = 'insurance';
      for (const s of players) s.insurance = null;
      this.room.changed();
      await this.wait(T.insurance, () => players.every((s) => s.insurance != null || !this.connected(s) || s.leaving));
      for (const s of players) {
        if (s.insurance != null) continue;
        // Letting the timer run out declines insurance, and is graded as declining
        // (so waiting it out can't dodge a hard call). Offline players aren't graded.
        if (this.connected(s) && !s.leaving) {
          this.note(s, 'Time ran out: no insurance.', 'info');
          this.gradeInsurance(s, false);
        }
        s.insurance = 0;
      }
    }

    gradeInsurance(s, take) {
      const answers = new Set(C.tcCandidates(this.rc, this.shoe.remaining).map((t) => S.insuranceCorrect(t)));
      const ok = answers.has(take);
      this.stat(s, 'decisions', ok);
      this.note(s, `${ok ? '✓' : '✗'} ${take ? 'Took' : 'Declined'} insurance. Take it at TC ≥ +3 (TC now ${signed(this.tc())}).`, ok ? 'good' : 'bad', 'play');
    }

    // Grade a play against basic strategy and the deviations, at any true count a careful
    // player could reach from the tray.
    gradePlay(s, hd, a) {
      const o = this.optsFor(s, hd);
      const up = S.upValue(this.dealer[0]);
      const results = C.tcCandidates(this.rc, this.shoe.remaining).map((t) => S.correctAction(hd.cards, up, o, t));
      const ok = results.some((r) => r.action === a);
      const label = `${S.handLabel(hd.cards)} vs ${S.upLabel(up)}`;
      const main = results[0];
      const dev = results.find((r) => r.dev);
      this.stat(s, 'decisions', ok);
      this.note(s, ok
        ? `✓ ${NAMES[a]} on ${label}${dev ? `: ${dev.note}` : ''}`
        : `✗ ${NAMES[a]} on ${label}. Correct: ${NAMES[main.action]}${main.dev ? ` (${main.note}, TC ${signed(this.tc())})` : ' (basic strategy)'}`, ok ? 'good' : 'bad', 'play');
    }

    async turnFor(s, h) {
      this.phase = 'play';
      this.turn = { seat: this.seats.indexOf(s), hand: h };
      s.choice = null;
      s.awaiting = true; // moves are only taken while the table is actually waiting for one
      this.room.changed();
      const away = !this.connected(s) || s.leaving;
      // Someone who's offline when their turn comes gets a few seconds to come back.
      await this.wait(away ? T.away : T.turn, () => s.choice != null || s.leaving);
      s.awaiting = false;
      const hd = s.hands[h];
      const a = s.choice;
      s.choice = null;
      if (!a) {
        // The hand stands. If you were here and let the clock run out, that's graded as
        // standing, so timing out can't dodge a hard decision.
        if (!s.leaving && this.connected(s)) {
          this.note(s, 'Time ran out: your hand stood.', 'info');
          this.gradePlay(s, hd, 'S');
        }
        hd.done = true;
        return;
      }
      if (a === 'H') {
        await this.dealTo(hd.cards);
        if (S.handTotal(hd.cards).total >= 21) hd.done = true;
      } else if (a === 'S') {
        hd.done = true;
      } else if (a === 'D') {
        s.stack -= hd.bet; hd.bet *= 2;
        await this.dealTo(hd.cards);
        hd.done = true;
      } else if (a === 'P') {
        const moved = hd.cards.pop();
        const nh = { cards: [moved], bet: hd.bet, fromSplit: true };
        hd.fromSplit = true;
        s.stack -= hd.bet;
        s.hands.splice(h + 1, 0, nh);
        const aces = C.rankKey(moved.rank) === 'A';
        await this.dealTo(hd.cards);
        await this.dealTo(nh.cards);
        for (const x of [hd, nh]) {
          if (aces) { x.splitAces = true; x.done = true; } else if (S.handTotal(x.cards).total === 21) x.done = true;
        }
      }
    }

    optsFor(s, hd) {
      const two = hd.cards.length === 2;
      return {
        canDouble: two && s.stack >= hd.bet,
        canSplit: two && C.rankKey(hd.cards[0].rank) === C.rankKey(hd.cards[1].rank) && s.hands.length < 4 && s.stack >= hd.bet && !hd.splitAces,
        canSurrender: false,
      };
    }

    revealHole() {
      const hole = this.dealer.find((c) => c.down);
      if (hole) { hole.down = false; this.rc += C.hiLo(hole); }
    }

    async settle(players) {
      const d = S.handTotal(this.dealer);
      const dBJ = S.isBlackjack(this.dealer);
      for (const s of players) {
        let payout = 0;
        let wagered = s.insurance || 0;
        if (s.insurance && dBJ) payout += s.insurance * 3;
        for (const x of s.hands) {
          wagered += x.bet;
          const p = S.handTotal(x.cards).total;
          const natural = s.hands.length === 1 && S.isBlackjack(x.cards);
          let r;
          if (p > 21) r = ['Bust', 0, 'lose'];
          else if (dBJ) r = natural ? ['Push', x.bet, 'push'] : ['Lose', 0, 'lose'];
          else if (natural) r = ['Blackjack!', x.bet * 2.5, 'win'];
          else if (d.total > 21 || p > d.total) r = ['Win', x.bet * 2, 'win'];
          else if (p === d.total) r = ['Push', x.bet, 'push'];
          else r = ['Lose', 0, 'lose'];
          x.result = { text: r[0], cls: r[2] };
          x.done = true;
          payout += r[1];
        }
        s.stack += payout;
        s.net = payout - wagered;
        this.note(s, `Round: ${money(s.net, true)}`, s.net > 0 ? 'won' : s.net < 0 ? 'lost' : 'even', 'round');
        s.stats.hands = (s.stats.hands || 0) + 1;
        s.pending.hands = (s.pending.hands || 0) + 1;
      }
      const totals = players.map((s) => `${s.name} ${money(s.net, true)}`);
      this.event(`Dealer ${d.total > 21 ? 'busts' : dBJ ? 'blackjack' : d.total}. ${totals.join(' · ')}`);
      this.phase = 'settle';
      this.deadline = Date.now() + ms(T.settle);
      this.room.changed();
      await this.sleep(T.settle);
    }

    async afterRound(players) {
      this.sinceCheck++;
      const due = this.sinceCheck >= 7 || (this.sinceCheck >= 3 && C.chance(0.3));
      const checkers = players.filter((s) => this.seats.includes(s) && !s.leaving && this.connected(s));
      if (due && checkers.length) {
        this.sinceCheck = 0;
        this.checkAnswer = { rc: this.rc, tcs: C.tcCandidates(this.rc, this.shoe.remaining), est: C.decksEstimate(this.shoe.remaining) };
        for (const s of checkers) s.check = { pending: true };
        this.phase = 'check';
        this.turn = null;
        this.room.changed();
        await this.wait(T.check, () => checkers.every((s) => !s.check?.pending || !this.seats.includes(s) || !this.connected(s)));
        const A = this.checkAnswer;
        for (const s of checkers) {
          if (!s.check?.pending) continue;
          // No answer in time counts as a miss (so skipping a check can't protect your score).
          const here = this.seats.includes(s) && this.connected(s);
          if (here) {
            this.stat(s, 'checks', false);
            this.note(s, `✗ Count check: time ran out. Running ${signed(A.rc)}, true ${signed(A.tcs[0])} (${signed(A.rc)} ÷ ${A.est} decks).`, 'bad', 'check');
          }
          s.check = { pending: false, missed: true, answer: { rc: A.rc, tc: A.tcs[0], est: A.est } };
        }
        this.room.changed();
        await this.sleep(T.between * 2);
      }
      for (const s of players) this.flushStats(s);
      for (let i = 0; i < SEATS; i++) if (this.seats[i]?.leaving) { const s = this.seats[i]; s.leaving = false; s.hands = []; this.standUp(i, null); }
      if (this.shoe.pastCut) {
        this.shoe.shuffle();
        this.rc = 0;
        this.fresh = true;
        this.event('Cut card reached. New shoe next hand: count back to 0, bets back to $25.');
      }
    }

    // ---- what players send ---------------------------------------------------------
    action(m, msg) {
      const i = this.seatOf(m.id);
      const s = i >= 0 ? this.seats[i] : null;
      switch (msg.a) {
        case 'sit': return this.sit(m, Number(msg.seat));
        case 'stand':
          if (!s) return null;
          if (s.hands.length && !['idle', 'betting', 'settle', 'check'].includes(this.phase)) return 'You can leave your seat once this hand is over.';
          this.standUp(i, `${s.name} stood up.`);
          this.room.changed();
          return null;
        case 'bet': {
          if (!s || this.phase !== 'betting' || s.bet != null) return null;
          const amt = Number(msg.amount);
          if (!Number.isInteger(amt) || amt % MIN || amt < MIN || amt > Math.min(MAX_BET, s.stack)) return `Bet ${money(MIN)}–${money(Math.min(MAX_BET, s.stack))} in $25 steps.`;
          s.bet = amt;
          const want = this.betTc.map((t) => C.betFor(t));
          const ok = want.includes(amt);
          this.stat(s, 'bets', ok);
          this.note(s, ok ? `✓ Bet ${money(amt)} fits the ramp.` : `✗ The ramp says ${money(want[0])} at TC ${signed(this.betTc[0])}; you bet ${money(amt)}.`, ok ? 'good' : 'warn', 'bet');
          this.room.changed();
          this.poke();
          return null;
        }
        case 'sitout':
          if (!s || this.phase !== 'betting' || s.bet != null) return null;
          s.bet = 0; s.out = true;
          this.room.changed();
          this.poke();
          return null;
        case 'insurance': {
          if (!s || this.phase !== 'insurance' || !s.hands.length || s.insurance != null) return null;
          const take = Boolean(msg.take);
          this.gradeInsurance(s, take);
          s.insurance = take ? Math.min(s.hands[0].bet / 2, s.stack) : 0;
          s.stack -= s.insurance;
          this.room.changed();
          this.poke();
          return null;
        }
        case 'act': {
          // Ignore clicks while a card is still being dealt (they'd be graded but never played).
          if (!s || this.phase !== 'play' || !this.turn || this.turn.seat !== i || !s.awaiting || s.choice != null) return null;
          const a = msg.move;
          const hd = s.hands[this.turn.hand];
          const o = this.optsFor(s, hd);
          if (!ACTS.includes(a) || (a === 'D' && !o.canDouble) || (a === 'P' && !o.canSplit)) return null;
          this.gradePlay(s, hd, a);
          s.choice = a;
          this.poke();
          return null;
        }
        case 'check': {
          if (!s || this.phase !== 'check' || !s.check?.pending) return null;
          const rc = Number(msg.rc);
          const tc = Number(msg.tc);
          if (!Number.isInteger(rc) || !Number.isInteger(tc)) return 'Enter both counts as whole numbers.';
          const A = this.checkAnswer;
          const rcOk = rc === A.rc;
          const tcOk = A.tcs.includes(tc);
          this.stat(s, 'checks', rcOk && tcOk);
          s.check = { pending: false, rc, tc, rcOk, tcOk, answer: { rc: A.rc, tc: A.tcs[0], est: A.est } };
          this.note(s, `${rcOk && tcOk ? '✓' : '✗'} Count check: running ${signed(A.rc)}, true ${signed(A.tcs[0])} (${signed(A.rc)} ÷ ${A.est} decks). You said ${signed(rc)} / ${signed(tc)}.`, rcOk && tcOk ? 'good' : 'bad', 'check');
          this.room.changed();
          this.poke();
          return null;
        }
        default: return null;
      }
    }

    // ---- what each browser sees ------------------------------------------------------
    view(id) {
      const mine = this.seatOf(id);
      const me = mine >= 0 ? this.seats[mine] : null;
      const holeShown = !this.dealer.some((c) => c.down);
      const v = {
        kind: 'table',
        phase: this.phase,
        deadlineIn: ['betting', 'insurance', 'play', 'check', 'settle', 'shuffle'].includes(this.phase) ? Math.max(0, this.deadline - Date.now()) : null,
        dealt: this.shoe.dealt,
        decks: C.RULES.decks,
        rules: C.RULES.text,
        minBet: MIN,
        maxBet: MAX_BET,
        dealer: this.dealer.map(plain),
        dealerTotal: this.dealer.length && holeShown ? S.handTotal(this.dealer).total : null,
        events: this.events,
        turn: this.turn,
        seats: this.seats.map((s, i) => s && {
          i, id: s.id, name: s.name, guest: s.guest, stack: s.stack, bet: s.bet, out: s.out, net: s.net,
          connected: this.connected(s), insurance: s.insurance,
          waiting: (this.phase === 'betting' && s.bet == null) || (this.phase === 'insurance' && s.hands.length && s.insurance == null) || (this.phase === 'check' && Boolean(s.check?.pending)),
          hands: s.hands.map((hd) => ({ cards: hd.cards.map(plain), bet: hd.bet, total: S.handTotal(hd.cards).total, soft: S.handTotal(hd.cards).soft, result: hd.result || null })),
        }),
        you: null,
      };
      if (me) {
        const you = { seat: mine, notes: me.notes, stack: me.stack, buyIns: me.buyIns, stats: me.stats, check: me.check };
        if (this.phase === 'betting' && me.bet == null) you.bet = { min: MIN, max: Math.min(MAX_BET, me.stack) };
        if (this.phase === 'insurance' && me.hands.length && me.insurance == null) you.insurance = true;
        if (this.phase === 'play' && this.turn?.seat === mine && me.awaiting && me.choice == null) {
          const o = this.optsFor(me, me.hands[this.turn.hand]);
          you.moves = { H: true, S: true, D: o.canDouble, P: o.canSplit };
        }
        v.you = you;
      }
      return v;
    }
  };
};
