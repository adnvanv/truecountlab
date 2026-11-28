// Count battle: everyone gets the same question at the same moment and races to answer.
// Rounds: running count (cards flash by, then type the count) and play the hand (a hand,
// an upcard and a true count). Everyone in a room plays the same premade strategy (the
// host picks it), so everyone's right answer is the same.
// Right answers score 100 plus up to 100 for speed. The server holds the answers and
// the clock; browsers only ever see what's on screen right now.
'use strict';

/** @typedef {import('../types').GameLibs} GameLibs */
/** @typedef {import('../types').Records} Records */
/** @typedef {import('../types').RoomLike} RoomLike */
/** @typedef {import('../types').Member} Member */
/** @typedef {import('../types').GameMessage} GameMessage */
/** @typedef {import('../types').Game} Game */
/** @typedef {import('../types').Card} Card */
/** @typedef {'rc' | 'play'} RoundType */
/** @typedef {'waiting' | 'intro' | 'show' | 'answer' | 'reveal' | 'final'} Phase */
/** @typedef {{ rank: string, suit: string }} PlainCard */
/** @typedef {number | string} Answer a count, or a play letter (H S D P) */
/**
 * A question. Only what's on screen right now is ever sent to browsers (see view()).
 * @typedef {object} Round
 * @property {RoundType} type
 * @property {Answer} answer
 * @property {string} explain
 * @property {Map<string, { value: Answer, ms: number }>} answers by player id
 * @property {PlainCard[]} [cards] rc: the cards to flash; play: the player's hand
 * @property {number} [pace] rc: ms per card
 * @property {PlainCard} [up] play: the dealer's upcard
 * @property {number} [tc] play: the true count
 * @property {boolean} [canSplit] play: the hand is a pair
 */
/**
 * @typedef {object} Player
 * @property {string} id @property {string} name @property {boolean} guest @property {number | null} userId
 * @property {number} score @property {number} correct
 * @property {{ value: Answer | null, ok: boolean, points: number, ms: number | null }[]} answers one per round so far
 */
/** @typedef {{ rounds: number, types: RoundType[], strategy: string }} Settings */

/** @param {GameLibs} libs @param {Records} records */
module.exports = ({ cards: C, strategy: S, strategies: P }, records) => {
  const SCALE = Number(process.env.LIVE_TIME_SCALE) || 1; // tests run the clock faster
  /** @param {number} n */
  const ms = (n) => Math.round(n * SCALE);
  /** @type {RoundType[]} */
  const TYPES = ['rc', 'play'];
  /** @type {Record<RoundType, number>} answer windows, ms */
  const WINDOW = { rc: 12000, play: 10000 };
  const INTRO = 3500;
  const REVEAL = 5500;
  const AUTO_START = 20000;
  const ROUND_COUNTS = [6, 9, 12];
  const MAX_PLAYERS = 8;

  /** Whatever the host sent, made valid. @param {any} [s] @returns {Settings} */
  function cleanSettings(s = {}) {
    const types = Array.isArray(s?.types) ? TYPES.filter((t) => s.types.includes(t)) : TYPES.slice();
    return {
      rounds: ROUND_COUNTS.includes(Number(s?.rounds)) ? Number(s.rounds) : 9,
      types: types.length ? types : TYPES.slice(),
      strategy: P.PRESETS.some((x) => x.id === s?.strategy) ? String(s.strategy) : P.DEFAULT_ID,
    };
  }

  /** @param {Card} c @returns {PlainCard} */
  const plain = (c) => ({ rank: c.rank, suit: c.suit });

  /** Two different cards making a hard total. @param {number} total */
  function hardCards(total) {
    /** @type {[number, number][]} */
    const opts = [];
    for (let a = 2; a <= 10; a++) { const b = total - a; if (b >= 2 && b <= 10 && b !== a) opts.push([a, b]); }
    const [a, b] = C.pick(opts);
    const cards = [C.cardForValue(a), C.cardForValue(b)];
    return C.randInt(2) ? cards.reverse() : cards;
  }

  /**
   * k counts rounds of this type so far; each one is a little harder.
   * @param {RoundType} type @param {number} k @param {import('../types').Strat} strat
   * @returns {Round}
   */
  function makeRound(type, k, strat) {
    const answers = new Map();
    if (type === 'rc') {
      const n = Math.min(24, 10 + 3 * k);
      const pace = Math.max(320, 760 - 90 * k);
      const cards = C.shuffleInPlace(C.makeDecks(1)).slice(0, n).map(plain);
      const answer = cards.reduce((s, c) => s + S.tagOf(c, strat), 0);
      return { type, cards, pace, answer, answers, explain: `${n} cards, ${strat.count.name} running count ${answer > 0 ? '+' : ''}${answer}` };
    }
    // Play the hand: mostly hands near a deviation index, some plain basic strategy.
    /** @type {Card[]} */
    let cards;
    /** @type {number} */
    let up;
    /** @type {number} */
    let tc;
    const devs = strat.devs.filter((x) => x.kind === 'play');
    if (devs.length && C.chance(0.65)) {
      const d = C.pick(devs);
      cards = d.pair ? [C.cardForValue(d.pair === 'A' ? 11 : d.pair === 'T' ? 10 : Number(d.pair)), C.cardForValue(d.pair === 'A' ? 11 : d.pair === 'T' ? 10 : Number(d.pair))] : hardCards(Number(d.total));
      up = d.up;
      tc = d.tc + C.pick([-2, -1, 0, 0, 1, 2]);
    } else {
      // Any two cards except a blackjack, which has no decision to make.
      do cards = [C.cardForValue(2 + C.randInt(10)), C.cardForValue(2 + C.randInt(10))];
      while (S.isBlackjack(cards));
      up = 2 + C.randInt(10);
      tc = C.randInt(9) - 4;
    }
    const o = { canDouble: true, canSplit: S.isPair(cards), canSurrender: false };
    const res = S.correctAction(cards, up, o, tc, strat);
    return {
      type, cards: cards.map(plain), up: plain(C.cardForValue(up)), tc, canSplit: o.canSplit, answers,
      answer: res.action, explain: res.dev ? S.devNote(res.dev, strat) : 'Basic strategy',
    };
  }

  /** @implements {Game} */
  return class Battle {
    static kind = 'battle';

    /** @param {RoomLike} room @param {unknown} [settings] */
    constructor(room, settings) {
      this.room = room;
      this.settings = cleanSettings(settings);
      /** @type {Phase} */
      this.phase = 'waiting';
      /** @type {Map<string, Player>} */
      this.players = new Map();
      /** @type {Round[]} */
      this.rounds = [];
      this.i = -1;
      this.cardIndex = -1;
      this.deadline = 0;
      this.openedAt = 0;
      /** @type {NodeJS.Timeout | undefined} */
      this.timer = undefined;
      /** @type {NodeJS.Timeout | undefined} */
      this.autoTimer = undefined;
      this.autoAt = 0;
      /** @type {{ id: string, name: string, guest: boolean, score: number, correct: number, place: number, rating: { before: number, after: number } | null }[] | null} */
      this.final = null;
    }

    get capacity() { return MAX_PLAYERS; }
    /** The premade strategy this room plays (quick play matches on it). */
    get strategyId() { return this.settings.strategy; }
    get strat() { return P.strategyById(this.settings.strategy); }
    get playing() { return !['waiting', 'final'].includes(this.phase); }
    /** @returns {'playing' | 'waiting'} */
    status() { return this.playing ? 'playing' : 'waiting'; }
    seatCount() { return this.players.size; }
    hasRoom() { return !this.playing && this.room.members.size < MAX_PLAYERS; }
    summary() { return `${this.strat.name} · ${this.settings.rounds} rounds · ${this.settings.types.map((t) => ({ rc: 'running count', play: 'play the hand' })[t]).join(', ')}`; }

    /** Run fn after delay ms, replacing whatever was scheduled. @param {number} delay @param {() => void} fn */
    after(delay, fn) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = undefined; fn(); }, delay);
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
    /** @param {Member} m */
    onLeave(m) {
      this.checkAutoStart();
      if (this.playing && ![...this.players.keys()].some((id) => this.room.members.has(id))) this.abort();
      else if (this.phase === 'answer' && this.players.has(m.id)) this.maybeEndEarly();
    }
    // A dropped connection (a page reload, a phone locking) keeps its place: the battle
    // only stops if every player actually leaves the room.
    /** @param {Member} m */
    onDisconnect(m) {
      this.checkAutoStart();
      if (this.phase === 'answer' && this.players.has(m.id)) this.maybeEndEarly();
    }
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
      const here = this.room.connectedMembers();
      if (!here.length) return;
      this.cancelAuto();
      this.players = new Map(here.slice(0, MAX_PLAYERS).map((m) => [m.id, { id: m.id, name: m.name, guest: m.guest, userId: m.userId, score: 0, correct: 0, answers: [] }]));
      /** @type {Partial<Record<RoundType, number>>} */
      const seen = {};
      this.rounds = Array.from({ length: this.settings.rounds }, (_, i) => {
        const type = this.settings.types[i % this.settings.types.length];
        seen[type] = (seen[type] || 0) + 1;
        return makeRound(type, Number(seen[type]) - 1, this.strat);
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
        const cards = /** @type {PlainCard[]} */ (r.cards);
        this.phase = 'show';
        this.cardIndex = -1;
        const step = () => {
          this.cardIndex++;
          if (this.cardIndex >= cards.length) return this.open();
          this.room.changed();
          this.after(ms(Number(r.pace)), step);
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
        const points = a && ok ? 100 + Math.round(100 * Math.max(0, 1 - a.ms / window)) : 0;
        p.score += points;
        if (ok) p.correct++;
        p.answers.push({ value: a?.value ?? null, ok, points, ms: a?.ms ?? null });
      }
      records.bump('battle_answers', r.answers.size);
      this.phase = 'reveal';
      this.deadline = Date.now() + ms(REVEAL);
      this.room.changed();
      this.after(ms(REVEAL), () => this.nextRound());
    }

    finish() {
      const list = [...this.players.values()].sort((a, b) => b.score - a.score);
      /** @type {Map<number, { before: number, after: number }>} */
      let changes = new Map();
      try {
        changes = records.saveBattle(list.map((p) => ({ userId: p.userId, score: p.score, rounds: this.rounds.length, correct: p.correct })));
      } catch (e) { require('../log').error('saving battle results failed', { err: e }); }
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
      if (w.length) this.room.system(w.length > 1 ? `Tie for first: ${w.map((x) => x.name).join(', ')}.` : `${w[0].name} wins with ${w[0].score} points.`);
      this.room.changed();
      this.checkAutoStart();
    }

    /** @param {Member} m @param {GameMessage} msg @returns {string | null} */
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
        const value = msg.value;
        if (r.type === 'play') {
          if (typeof value !== 'string' || !['H', 'S', 'D', 'P'].includes(value)) return null;
        } else if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 99) return null;
        r.answers.set(m.id, { value, ms: Date.now() - this.openedAt });
        this.room.changed();
        this.maybeEndEarly();
        return null;
      }
      return null;
    }

    /** What one member sees right now. @param {string} id */
    view(id) {
      const r = this.rounds[this.i];
      const now = Date.now();
      /** @type {Record<string, unknown> | null} */
      let round = null;
      /** @type {{ playing: boolean, answered?: boolean, answer?: Answer | null }} */
      const you = { playing: this.players.has(id) };
      if (r && ['show', 'answer', 'reveal'].includes(this.phase)) {
        /** @type {Record<string, unknown>} */
        const q = { i: this.i, n: this.rounds.length, type: r.type, window: ms(WINDOW[r.type]) };
        if (r.type === 'rc') {
          const cards = /** @type {PlainCard[]} */ (r.cards);
          q.total = cards.length;
          q.pace = ms(Number(r.pace));
          if (this.phase === 'show') { q.index = this.cardIndex; q.card = cards[this.cardIndex]; }
        } else {
          q.cards = r.cards; q.up = r.up; q.tc = r.tc; q.canSplit = r.canSplit; q.idx = S.indexName(this.strat);
        }
        if (this.phase === 'reveal') { q.answer = r.answer; q.explain = r.explain; }
        round = q;
        const mine = r.answers.get(id);
        you.answered = Boolean(mine);
        you.answer = mine ? mine.value : null;
      }
      return {
        kind: 'battle',
        phase: this.phase,
        settings: this.settings,
        roundCounts: ROUND_COUNTS,
        strategies: P.PRESETS.map((x) => ({ id: x.id, name: x.name })),
        strategyName: this.strat.name,
        autoStartIn: this.autoAt ? Math.max(0, this.autoAt - now) : null,
        deadlineIn: this.deadline ? Math.max(0, this.deadline - now) : null,
        you,
        players: [...this.players.values()].map((p) => ({
          id: p.id, name: p.name, guest: p.guest, score: p.score, correct: p.correct,
          connected: Boolean(this.room.members.get(p.id)?.connected),
          answered: this.phase === 'answer' && r ? r.answers.has(p.id) : false,
          last: this.phase === 'reveal' ? p.answers[p.answers.length - 1] : null,
        })),
        round,
        final: this.phase === 'final' ? this.final || [] : null,
      };
    }
  };
};
