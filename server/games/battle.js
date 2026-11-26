// Count battle: everyone gets the same question at the same moment and races to answer.
// Rounds: running count (cards flash by, then type the count), true count (a running
// count and a discard tray), and play the hand (a hand, an upcard and a true count).
// Right answers score 100 plus up to 100 for speed. The server holds the answers and
// the clock; browsers only ever see what's on screen right now.
'use strict';

module.exports = ({ cards: C, strategy: S }, records) => {
  const SCALE = Number(process.env.LIVE_TIME_SCALE) || 1; // tests run the clock faster
  const ms = (n) => Math.round(n * SCALE);
  const TYPES = ['rc', 'tc', 'play'];
  const WINDOW = { rc: 12000, tc: 15000, play: 10000 };
  const INTRO = 3500;
  const REVEAL = 5500;
  const AUTO_START = 20000;
  const ROUND_COUNTS = [6, 9, 12];
  const MAX_PLAYERS = 8;

  function cleanSettings(s = {}) {
    const types = Array.isArray(s.types) ? TYPES.filter((t) => s.types.includes(t)) : TYPES.slice();
    return {
      rounds: ROUND_COUNTS.includes(Number(s.rounds)) ? Number(s.rounds) : 9,
      types: types.length ? types : TYPES.slice(),
    };
  }

  const plain = (c) => ({ rank: c.rank, suit: c.suit });

  function hardCards(total) {
    const opts = [];
    for (let a = 2; a <= 10; a++) { const b = total - a; if (b >= 2 && b <= 10 && b !== a) opts.push([a, b]); }
    const [a, b] = C.pick(opts);
    const cards = [C.cardForValue(a), C.cardForValue(b)];
    return C.randInt(2) ? cards.reverse() : cards;
  }

  // k counts rounds of this type so far; each one is a little harder.
  function makeRound(type, k) {
    if (type === 'rc') {
      const n = Math.min(24, 10 + 3 * k);
      const pace = Math.max(320, 760 - 90 * k);
      const cards = C.shuffleInPlace(C.makeDecks(1)).slice(0, n).map(plain);
      const answer = cards.reduce((s, c) => s + C.hiLo(c), 0);
      return { type, cards, pace, answer, explain: `${n} cards, running count ${answer > 0 ? '+' : ''}${answer}` };
    }
    if (type === 'tc') {
      const halves = 3 + C.randInt(9); // 1.5 … 5.5 decks left
      const remaining = halves * 26 + C.randInt(15) - 7; // never enough to change the estimate
      let rc = 0;
      while (rc === 0) rc = C.randInt(29) - 14;
      const est = C.decksEstimate(remaining);
      const answer = C.trueCount(rc, est);
      return { type, rc, dealt: C.RULES.decks * 52 - remaining, answer, explain: `${rc > 0 ? '+' : ''}${rc} ÷ ${est} decks = ${(rc / est).toFixed(2)}, rounded down` };
    }
    // Play the hand: mostly hands near a deviation index, some plain basic strategy.
    let cards; let up; let tc;
    if (C.chance(0.65)) {
      const d = C.pick(S.DEVS.filter((x) => x.kind === 'play'));
      cards = hardCards(d.total);
      up = d.up;
      tc = d.tc + C.pick([-2, -1, 0, 0, 1, 2]);
    } else {
      cards = [C.cardForValue(2 + C.randInt(10)), C.cardForValue(2 + C.randInt(10))];
      up = 2 + C.randInt(10);
      tc = C.randInt(9) - 4;
    }
    const o = { canDouble: true, canSplit: S.isPair(cards), canSurrender: false };
    const res = S.correctAction(cards, up, o, tc);
    return {
      type, cards: cards.map(plain), up: plain(C.cardForValue(up)), tc, canSplit: o.canSplit,
      answer: res.action, explain: res.dev ? S.devNote(res.dev) : 'Basic strategy',
    };
  }

  return class Battle {
    static kind = 'battle';

    constructor(room, settings) {
      this.room = room;
      this.settings = cleanSettings(settings);
      this.phase = 'waiting'; // waiting | intro | show | answer | reveal | final
      this.players = new Map(); // id → { id, name, guest, userId, score, correct, answers: [] }
      this.rounds = [];
      this.i = -1;
      this.cardIndex = -1;
      this.deadline = 0;
      this.openedAt = 0;
      this.timer = null;
      this.autoAt = 0;
      this.final = null;
    }

    get capacity() { return MAX_PLAYERS; }
    get playing() { return !['waiting', 'final'].includes(this.phase); }
    status() { return this.playing ? 'playing' : 'waiting'; }
    summary() { return `${this.settings.rounds} rounds · ${this.settings.types.map((t) => ({ rc: 'running count', tc: 'true count', play: 'play the hand' })[t]).join(', ')}`; }

    after(delay, fn) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; fn(); }, delay);
    }

    destroy() { clearTimeout(this.timer); clearTimeout(this.autoTimer); }

    // Public rooms start by themselves 20s after a second player shows up.
    checkAutoStart() {
      if (this.room.visibility !== 'public' || this.playing) { this.cancelAuto(); return; }
      const ready = this.room.connectedMembers().length >= 2;
      if (ready && !this.autoAt) {
        this.autoAt = Date.now() + ms(AUTO_START);
        this.autoTimer = setTimeout(() => { this.autoAt = 0; this.start(); }, ms(AUTO_START));
      } else if (!ready) this.cancelAuto();
    }
    cancelAuto() { clearTimeout(this.autoTimer); this.autoAt = 0; }

    onJoin() { this.checkAutoStart(); }
    onLeave(m) {
      this.checkAutoStart();
      if (this.playing && ![...this.players.keys()].some((id) => this.room.members.get(id)?.connected)) this.abort();
      else if (this.phase === 'answer' && this.players.has(m.id)) this.maybeEndEarly();
    }
    onDisconnect(m) { this.onLeave(m); }
    onReconnect() { this.checkAutoStart(); }

    abort() {
      clearTimeout(this.timer);
      this.phase = 'waiting';
      this.players.clear();
      this.room.system('The battle stopped because every player left.');
      this.checkAutoStart();
      this.room.changed();
    }

    start() {
      if (this.playing) return;
      const ms0 = this.room.connectedMembers();
      if (!ms0.length) return;
      this.cancelAuto();
      this.players = new Map(ms0.slice(0, MAX_PLAYERS).map((m) => [m.id, { id: m.id, name: m.name, guest: m.guest, userId: m.userId, score: 0, correct: 0, answers: [] }]));
      const seen = {};
      this.rounds = Array.from({ length: this.settings.rounds }, (_, i) => {
        const type = this.settings.types[i % this.settings.types.length];
        seen[type] = (seen[type] || 0) + 1;
        return makeRound(type, seen[type] - 1);
      });
      this.i = -1;
      this.final = null;
      this.phase = 'intro';
      this.deadline = Date.now() + ms(INTRO);
      this.room.changed();
      this.after(ms(INTRO), () => this.nextRound());
    }

    nextRound() {
      this.i++;
      if (this.i >= this.rounds.length) return this.finish();
      const r = this.rounds[this.i];
      r.answers = new Map();
      if (r.type === 'rc') {
        this.phase = 'show';
        this.cardIndex = -1;
        const step = () => {
          this.cardIndex++;
          if (this.cardIndex >= r.cards.length) return this.open();
          this.room.changed();
          this.after(ms(r.pace), step);
        };
        step();
      } else this.open();
    }

    open() {
      const r = this.rounds[this.i];
      this.phase = 'answer';
      this.openedAt = Date.now();
      this.deadline = this.openedAt + ms(WINDOW[r.type]);
      this.room.changed();
      this.after(ms(WINDOW[r.type]), () => this.reveal());
    }

    maybeEndEarly() {
      const r = this.rounds[this.i];
      const waiting = [...this.players.keys()].filter((id) => this.room.members.get(id)?.connected && !r.answers.has(id));
      if (!waiting.length) this.after(ms(400), () => this.reveal());
    }

    reveal() {
      const r = this.rounds[this.i];
      const window = ms(WINDOW[r.type]);
      for (const p of this.players.values()) {
        const a = r.answers.get(p.id);
        const ok = a != null && a.value === r.answer;
        const points = ok ? 100 + Math.round(100 * Math.max(0, 1 - a.ms / window)) : 0;
        p.score += points;
        if (ok) p.correct++;
        p.answers.push({ value: a?.value ?? null, ok, points, ms: a?.ms ?? null });
      }
      this.phase = 'reveal';
      this.deadline = Date.now() + ms(REVEAL);
      this.room.changed();
      this.after(ms(REVEAL), () => this.nextRound());
    }

    finish() {
      const list = [...this.players.values()].sort((a, b) => b.score - a.score);
      let changes = new Map();
      try {
        changes = records.saveBattle(list.map((p) => ({ userId: p.userId, score: p.score, rounds: this.rounds.length, correct: p.correct })));
      } catch (e) { console.error('Saving battle results failed:', e); }
      let place = 0;
      this.final = list.map((p, idx) => {
        if (idx === 0 || p.score < list[idx - 1].score) place = idx + 1;
        const c = p.userId ? changes.get(p.userId) : null;
        return {
          id: p.id, name: p.name, guest: p.guest, score: p.score, correct: p.correct, place,
          rating: c ? { before: Math.round(c.before), after: Math.round(c.after) } : null,
        };
      });
      this.phase = 'final';
      const w = this.final.filter((x) => x.place === 1);
      this.room.system(w.length > 1 ? `Tie for first: ${w.map((x) => x.name).join(', ')}.` : `${w[0].name} wins with ${w[0].score} points.`);
      this.room.changed();
      this.checkAutoStart();
    }

    action(m, msg) {
      if (msg.a === 'start') {
        if (!this.room.isHost(m.id)) return 'Only the host can start.';
        if (this.playing) return null;
        this.start();
        return null;
      }
      if (msg.a === 'settings') {
        if (!this.room.isHost(m.id)) return 'Only the host can change the settings.';
        if (this.playing) return 'Wait for this battle to finish.';
        this.settings = cleanSettings(msg.settings);
        this.room.changed();
        this.room.lobbyChanged();
        return null;
      }
      if (msg.a === 'answer') {
        if (this.phase !== 'answer') return null;
        const p = this.players.get(m.id);
        const r = this.rounds[this.i];
        if (!p || r.answers.has(m.id)) return null;
        let value = msg.value;
        if (r.type === 'play') {
          if (!['H', 'S', 'D', 'P'].includes(value)) return null;
        } else {
          value = Number(value);
          if (!Number.isInteger(value) || Math.abs(value) > 99) return null;
        }
        r.answers.set(m.id, { value, ms: Date.now() - this.openedAt });
        this.room.changed();
        this.maybeEndEarly();
        return null;
      }
      return null;
    }

    view(id) {
      const r = this.rounds[this.i];
      const now = Date.now();
      const v = {
        kind: 'battle',
        phase: this.phase,
        settings: this.settings,
        roundCounts: ROUND_COUNTS,
        autoStartIn: this.autoAt ? Math.max(0, this.autoAt - now) : null,
        deadlineIn: this.deadline ? Math.max(0, this.deadline - now) : null,
        you: { playing: this.players.has(id) },
        players: [...this.players.values()].map((p) => ({
          id: p.id, name: p.name, guest: p.guest, score: p.score, correct: p.correct,
          connected: Boolean(this.room.members.get(p.id)?.connected),
          answered: this.phase === 'answer' && r ? r.answers.has(p.id) : false,
          last: this.phase === 'reveal' ? p.answers[p.answers.length - 1] : null,
        })),
        round: null,
        final: this.phase === 'final' ? this.final : null,
      };
      if (this.phase === 'final' && !this.final) v.final = [];
      if (r && ['show', 'answer', 'reveal'].includes(this.phase)) {
        const q = { i: this.i, n: this.rounds.length, type: r.type, window: ms(WINDOW[r.type]) };
        if (r.type === 'rc') {
          q.total = r.cards.length;
          q.pace = ms(r.pace);
          if (this.phase === 'show') { q.index = this.cardIndex; q.card = r.cards[this.cardIndex]; }
        } else if (r.type === 'tc') {
          q.rc = r.rc;
          q.dealt = r.dealt;
        } else {
          q.cards = r.cards; q.up = r.up; q.tc = r.tc; q.canSplit = r.canSplit;
        }
        if (this.phase === 'reveal') { q.answer = r.answer; q.explain = r.explain; }
        v.round = q;
        const mine = r.answers?.get(id);
        v.you.answered = Boolean(mine);
        v.you.answer = mine ? mine.value : null;
      }
      return v;
    }
  };
};
