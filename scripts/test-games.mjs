// Rules tests for the online games, run in-process with stacked shoes and a fast clock:
// shared-table payouts (blackjack, insurance, doubles, splits, split aces, busts, S17),
// timers (bets, turns, insurance, count checks), seats, count keeping; count battle
// scoring, round generation and disconnects; battle ratings.
// Usage: node scripts/test-games.mjs
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.LIVE_TIME_SCALE = '0.01';
const dataDir = mkdtempSync(path.join(tmpdir(), 'tcl-games-'));
process.env.DATA_DIR = dataDir;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const C = await import(pathToFileURL(`${ROOT}public/js/cards.js`).href);
const S = await import(pathToFileURL(`${ROOT}public/js/strategy.js`).href);
const savedBattles = [];
const tableStats = [];
const bumps = {};
const fakeRecords = {
  saveBattle: (list) => { savedBattles.push(list); return new Map(); },
  addTableStats: (userId, d) => tableStats.push({ userId, ...d }),
  bump: (key, n = 1) => { bumps[key] = (bumps[key] || 0) + n; },
};
const Table = require(`${ROOT}server/games/table.js`)({ cards: C, strategy: S }, fakeRecords);
const Battle = require(`${ROOT}server/games/battle.js`)({ cards: C, strategy: S }, fakeRecords);

let pass = 0; let fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra); } };
const sleep = (n) => new Promise((r) => setTimeout(r, n));
async function until(fn, ms = 4000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(1); }
  throw new Error(`timed out: ${label}`);
}

function fakeRoom(visibility = 'private') {
  const room = {
    visibility, members: new Map(), told: [], said: [],
    changed() {}, lobbyChanged() {},
    system(t) { room.said.push(t); },
    tell(id, t) { room.told.push({ id, t }); },
    isHost: (id) => id === 'p1',
    connectedMembers: () => [...room.members.values()].filter((m) => m.connected),
    add(id, userId = null) { const m = { id, name: id.toUpperCase(), guest: !userId, userId, connected: true }; room.members.set(id, m); return m; },
  };
  return room;
}

// Card helpers: '10' etc. Suits don't matter.
const card = (r) => ({ rank: r, suit: '♠' });
// Stack the shoe: the deal goes player(s) first card, dealer up, player(s) second, dealer hole, then draws.
function stack(t, ranks) {
  t.shoe.cards = [...ranks.map(card), ...C.makeDecks(6)];
  t.shoe.dealt = 0;
  t.shoe.cutIndex = 300;
  t.fresh = false;
}

// Seat players, rig the shoe, and play one hand with scripted choices. plan(view, member) → message or null.
/**
 * @param {object} o
 * @param {string[]} o.ranks the shoe, top first
 * @param {[string, number][]} [o.seats] member id and seat
 * @param {(view: any, member: any, table: any) => object | null} [o.plan]
 * @param {Record<string, number>} [o.bets]
 * @param {(table: any, room: any) => void} [o.setup]
 * @param {boolean} [o.keepGoing] let the table carry on after the hand
 */
async function playHand({ ranks, seats = [['p1', 0]], plan, bets = {}, setup, keepGoing = false }) {
  const room = fakeRoom();
  const t = new Table(room);
  const members = seats.map(([id]) => room.add(id));
  stack(t, ranks);
  if (setup) setup(t, room);
  // Catch the table right after the hand is paid (before the next hand resets it).
  let snapshot = null;
  const afterRound = t.afterRound.bind(t);
  t.afterRound = async (players) => {
    snapshot = members.map((m) => structuredClone(t.seats[t.seatOf(m.id)]));
    snapshot.dealer = structuredClone(t.dealer);
    if (keepGoing) return afterRound(players);
    t.dead = true;
    return undefined;
  };
  seats.forEach(([id, seat]) => t.sit(room.members.get(id), seat));
  while (!snapshot) {
    for (const m of members) {
      const v = t.view(m.id);
      const y = v.you;
      if (!y) continue;
      if (y.bet) t.action(m, { a: 'bet', amount: bets[m.id] ?? 25 });
      const msg = plan ? plan(v, m, t) : null;
      if (msg) t.action(m, msg);
    }
    await sleep(1);
  }
  return { t, room, members, seats: snapshot, dealer: snapshot.dealer };
}
const stand = (v) => (v.you.moves ? { a: 'act', move: 'S' } : null);
const moves = (list) => { const q = [...list]; return (v) => (v.you.moves && q.length ? { a: 'act', move: q.shift() } : null); };

try {
  console.log('Shared table payouts');
  {
    const { seats, t, dealer } = await playHand({ ranks: ['A', '10', 'K', '7'], plan: stand });
    const s = seats[0];
    ok(s.hands[0].result.text === 'Blackjack!' && s.net === 37.5 && s.stack === 537.5, 'blackjack pays 3:2 ($25 → +$37.50)');
    ok(s.notes.some((n) => n.text === 'Round: +$37.50'), 'the round result reads +$37.50', JSON.stringify(s.notes.map((n) => n.text)));
    ok(dealer.length === 2, 'dealer doesn’t draw against a lone blackjack');
    t.destroy();
  }
  {
    let asked = false;
    const { seats, t } = await playHand({
      ranks: ['10', 'A', '9', 'K'],
      plan: (v) => { if (v.you.insurance) { asked = true; return { a: 'insurance', take: true }; } return null; },
    });
    const s = seats[0];
    ok(asked, 'an ace up offers insurance');
    ok(s.insurance === 12.5 && s.hands[0].result.text === 'Lose' && s.net === 0, 'insurance pays 2:1 against dealer blackjack (net $0)', `net ${s.net}`);
    t.destroy();
  }
  {
    const { seats, t, dealer } = await playHand({ ranks: ['10', 'A', '10', '6'], plan: (v) => (v.you.insurance ? { a: 'insurance', take: false } : stand(v)) });
    ok(seats[0].net === 25 && dealer.length === 2, 'dealer stands on soft 17 (20 beats A6)');
    t.destroy();
  }
  {
    const { seats, t } = await playHand({ ranks: ['6', '6', '5', '10', '9', '10'], plan: moves(['D']) });
    const s = seats[0];
    ok(s.hands[0].bet === 50 && s.hands[0].cards.length === 3 && s.net === 50, 'double takes one card and doubles the bet (dealer 16 hits and busts)');
    t.destroy();
  }
  {
    // 8,8 vs 10 (hole 7): split; first hand 8+3=11 doubles to 20, second 8+10=18 stands; dealer 17.
    const { seats, t } = await playHand({ ranks: ['8', '10', '8', '7', '3', '10', '9'], plan: moves(['P', 'D', 'S']) });
    const s = seats[0];
    ok(s.hands.length === 2 && s.hands[0].bet === 50 && s.hands[1].bet === 25, 'split, then double after split');
    ok(s.hands.every((x) => x.result.text === 'Win') && s.net === 75, 'both split hands beat dealer 17 (net +$75)', `net ${s.net}`);
    t.destroy();
  }
  {
    // A,A vs 6 (hole 10): split aces get one card each (10, 9); dealer 16 draws 5 → 21.
    const { seats, t } = await playHand({ ranks: ['A', '6', 'A', '10', '10', '9', '5'], plan: moves(['P']) });
    const s = seats[0];
    ok(s.hands.length === 2 && s.hands.every((x) => x.cards.length === 2), 'split aces get exactly one card each');
    ok(s.hands[0].result.text === 'Push' && s.hands[1].result.text === 'Lose', 'A+10 after a split is 21, not blackjack (pushes dealer 21)');
    t.destroy();
  }
  {
    const { seats, t, dealer } = await playHand({ ranks: ['10', '9', '6', '8', '10'], plan: moves(['H']) });
    ok(seats[0].hands[0].result.text === 'Bust' && dealer.length === 2, 'bust loses, and the dealer doesn’t draw for a busted table');
    t.destroy();
  }
  {
    const { seats, t } = await playHand({ ranks: ['5', '10', '6', '7', '10'], plan: moves(['H']) });
    ok(seats[0].hands[0].cards.length === 3 && seats[0].hands[0].result.text === 'Win', 'hitting to 21 ends the hand by itself');
    t.destroy();
  }
  {
    // Two players: seat 0 (first base) plays first, then seat 3.
    const order = [];
    const { seats, t } = await playHand({
      ranks: ['10', '10', '9', '9', '6', '8'], seats: [['p1', 0], ['p2', 3]],
      plan: (v, m) => (v.you.moves ? (order.push(m.id), { a: 'act', move: 'S' }) : null),
    });
    ok(order.join() === 'p1,p2', 'seat 0 acts before seat 3', order.join());
    ok(seats[0].net === 25 && seats[1].net === -25, 'each seat is settled on its own hand');
    t.destroy();
  }
  {
    // Count keeping: everything face up after the hand counts, the hole card only once shown.
    const { t } = await playHand({ ranks: ['2', '3', '4', '5', '10'], plan: moves(['H', 'S']) });
    const shown = t.shoe.cards.slice(0, t.shoe.dealt);
    ok(t.rc === shown.reduce((a, c) => a + C.hiLo(c), 0), `running count matches the cards dealt (${t.rc})`);
    t.destroy();
  }

  {
    let extra = 0;
    const { seats, t } = await playHand({
      ranks: ['8', '10', '8', '7', '3', '10', '9'],
      plan: (() => { const q = ['P', 'D', 'S']; return (v, m, tbl) => {
        if (tbl.phase === 'play' && tbl.turn && !tbl.seats[0].awaiting && tbl.seats[0].choice == null && q.length < 3) {
          extra++; return { a: 'act', move: 'H' }; // clicking while a card is still coming
        }
        return v.you.moves && q.length ? { a: 'act', move: q.shift() } : null;
      }; })(),
    });
    ok(extra > 0 && seats[0].stats.decisions === 3 && seats[0].net === 75, `clicks while cards are being dealt are ignored (${extra} ignored)`);
    t.destroy();
  }

  console.log('Grading');
  {
    const { seats, t } = await playHand({ ranks: ['10', '10', '6', '7'], plan: moves(['H']), bets: { p1: 75 } });
    const s = seats[0];
    ok(s.stats.bets === 1 && !s.stats.betsCorrect, 'betting $75 at a neutral count is graded off the ramp');
    ok(s.notes.some((n) => /^✗ Hit on Hard 16 vs 10|^✗ Hit on/.test(n.text) || /^✓/.test(n.text)), 'the play gets a graded note');
    t.destroy();
  }
  {
    // 12 vs 4, no action: the clock stands it, and that's graded as standing.
    const { seats, t } = await playHand({ ranks: ['10', '4', '2', '10', '10'], plan: () => null });
    const s = seats[0];
    ok(s.notes.some((n) => n.text === 'Time ran out: your hand stood.') && s.stats.decisions === 1, 'a turn that times out stands and is graded');
    t.destroy();
  }
  {
    const { seats, t } = await playHand({ ranks: ['10', 'A', '9', '6'], plan: (v) => (v.you.moves ? { a: 'act', move: 'S' } : null) });
    const s = seats[0];
    ok(s.notes.some((n) => n.text === 'Time ran out: no insurance.') && s.notes.some((n) => /Declined insurance/.test(n.text)), 'letting insurance time out declines it, graded');
    t.destroy();
  }

  console.log('Seats and timers');
  {
    const room = fakeRoom();
    const t = new Table(room);
    const m = room.add('p1');
    stack(t, []);
    t.sit(m, 2);
    await until(() => room.told.length, 3000, 'kick');
    ok(!t.seats[2] && /didn’t bet in time/.test(room.told[0].t), 'no bet before the timer: you leave the seat');
    t.destroy();
  }
  {
    const room = fakeRoom();
    const t = new Table(room);
    const a = room.add('p1'); const b = room.add('p2');
    stack(t, []);
    t.sit(a, 0);
    await until(() => t.phase === 'betting', 1000, 'betting');
    t.sit(b, 1); // sits down with the timer already running
    t.action(a, { a: 'bet', amount: 25 });
    await until(() => t.phase !== 'betting', 2000, 'deal');
    ok(t.seats[1] && t.seats[1].out, 'sitting down mid-bet sits that hand out instead of losing the seat');
    t.destroy();
  }
  {
    const room = fakeRoom();
    const t = new Table(room);
    const a = room.add('p1');
    stack(t, []);
    t.sit(a, 0);
    a.connected = false;
    await until(() => !t.seats[0], 4000, 'offline seat dropped');
    ok(room.said.some((x) => /offline for 3 hands/.test(x)), 'an offline player keeps the seat for 3 hands, then loses it');
    t.destroy();
  }
  {
    const room = fakeRoom();
    const t = new Table(room);
    const a = room.add('p1');
    stack(t, ['10', '10', '6', '7']);
    t.sit(a, 0);
    await until(() => t.phase === 'betting', 1000, 'betting');
    t.action(a, { a: 'bet', amount: 25 });
    await until(() => t.phase === 'play', 2000, 'play');
    ok(/once this hand is over/.test(t.action(a, { a: 'stand' }) || ''), 'you can’t leave your seat mid-hand');
    t.destroy();
  }
  {
    const room = fakeRoom();
    const t = new Table(room);
    const a = room.add('p1');
    stack(t, []);
    t.sit(a, 0);
    t.seats[0].stack = 10;
    t.action(a, { a: 'sitout' });
    await until(() => t.seats[0]?.buyIns === 2, 2000, 'rebuy');
    ok(t.seats[0].stack === 510, 'out of chips: rebuys $500 before the next bet');
    await until(() => t.phase === 'betting', 1000, 'betting');
    ok(/\$25–\$200/.test(t.action(a, { a: 'bet', amount: 30 }) || ''), 'bets must be $25 steps');
    t.destroy();
  }
  {
    // Count check: answering scores, missing it counts as wrong.
    const room = fakeRoom();
    const t = new Table(room);
    const a = room.add('p1'); const b = room.add('p2');
    stack(t, ['10', '10', '9', '7', '7', '8']);
    t.sinceCheck = 99;
    t.sit(a, 0); t.sit(b, 1);
    let answered = false;
    while (!t.seats[0]?.check || t.seats[0].check.pending !== false || !t.seats[1]?.check || t.seats[1].check.pending !== false) {
      for (const m of [a, b]) {
        const y = t.view(m.id).you;
        if (!y) continue;
        if (y.bet) t.action(m, { a: 'bet', amount: 25 });
        if (y.moves) t.action(m, { a: 'act', move: 'S' });
        if (m === a && y.check?.pending && !answered) { answered = true; t.action(m, { a: 'check', rc: t.rc, tc: C.tcFromCards(t.rc, t.shoe.remaining) }); }
      }
      await sleep(1);
    }
    ok(t.seats[0].check.rcOk && t.seats[0].stats.checksCorrect === 1, 'a right count check is graded right');
    ok(t.seats[1].check.missed && t.seats[1].stats.checks === 1 && !t.seats[1].stats.checksCorrect, 'a missed count check counts as wrong');
    t.destroy();
  }
  {
    const { t } = await playHand({ ranks: ['10', '10', '9', '7'], plan: stand, keepGoing: true, setup: (x) => { x.shoe.cutIndex = 2; } });
    await until(() => t.fresh, 3000, 'reshuffle');
    ok(t.rc === 0 && t.shoe.dealt === 0, 'past the cut card: a new shoe and the count resets');
    t.destroy();
  }

  console.log('Count battle');
  {
    // Round generation: every type, many times.
    let bad = 0; let bj = 0;
    for (let n = 0; n < 150; n++) {
      const room = fakeRoom();
      room.add('p1');
      const b = new Battle(room, { rounds: 12, types: ['rc', 'tc', 'play'] });
      b.start();
      for (const r of b.rounds) {
        if (r.type === 'rc' && r.answer !== r.cards.reduce((a, c) => a + C.hiLo(c), 0)) bad++;
        if (r.type === 'tc' && r.answer !== C.trueCount(r.rc, C.decksEstimate(312 - r.dealt))) bad++;
        if (r.type === 'play') {
          if (S.isBlackjack(r.cards)) bj++;
          if (!['H', 'S', 'D', 'P'].includes(r.answer) || (r.answer === 'P' && !r.canSplit)) bad++;
        }
      }
      b.destroy();
    }
    ok(bad === 0, 'every generated round has a valid answer');
    ok(bj === 0, 'play-the-hand rounds never deal a blackjack');
  }
  {
    const room = fakeRoom();
    const p1 = room.add('p1'); const p2 = room.add('p2'); const p3 = room.add('p3');
    const b = new Battle(room, { rounds: 6, types: ['tc'] });
    b.start();
    await until(() => b.phase === 'answer', 2000, 'answer');
    const r = b.rounds[b.i];
    ok(b.action(p1, { a: 'answer', value: null }) === null && !r.answers.has('p1'), 'a missing answer isn’t taken as 0');
    b.action(p1, { a: 'answer', value: r.answer });
    b.action(p2, { a: 'answer', value: r.answer + 1 });
    p3.connected = false; b.onDisconnect(p3);
    await until(() => b.phase === 'reveal', 2000, 'reveal');
    const pl = b.players;
    ok(pl.get('p1').score >= 100 && pl.get('p2').score === 0 && pl.get('p3').score === 0, 'right scores 100+, wrong and missing score 0');
    ok(b.phase === 'reveal', 'a player dropping offline ends the round early without stopping the battle');
    room.members.delete('p1'); b.onLeave(p1);
    room.members.delete('p2'); b.onLeave(p2);
    ok(b.playing, 'the battle goes on while anyone is still in the room');
    room.members.delete('p3'); b.onLeave(p3);
    ok(!b.playing, 'it stops once every player has left');
    b.destroy();
  }
  {
    const room = fakeRoom();
    const p1 = room.add('p1', 1); const p2 = room.add('p2', 2);
    const b = new Battle(room, { rounds: 6, types: ['rc'] });
    b.start();
    while (b.phase !== 'final') {
      if (b.phase === 'answer') {
        const r = b.rounds[b.i];
        if (!r.answers.has('p1')) b.action(p1, { a: 'answer', value: r.answer });
      }
      await sleep(1);
    }
    const saved = savedBattles.at(-1);
    ok(b.final[0].id === 'p1' && b.final[0].correct === 6 && saved.length === 2 && saved.every((x) => x.rounds === 6), 'final standings and saved results');
  }

  console.log('Ratings');
  {
    const records = require(`${ROOT}server/records.js`);
    const { db } = require(`${ROOT}server/db.js`);
    for (const [i, n] of ['Ana', 'Ben', 'Cy'].entries()) db.prepare('INSERT INTO users (email, display_name, created_at) VALUES (?, ?, ?)').run(`${n}@example.test`, n, Date.now() + i);
    const c2 = records.saveBattle([{ userId: 1, score: 900, rounds: 9, correct: 7 }, { userId: 2, score: 400, rounds: 9, correct: 3 }]);
    const d1 = c2.get(1).after - c2.get(1).before; const d2 = c2.get(2).after - c2.get(2).before;
    ok(Math.abs(d1 + d2) < 1e-9 && d1 > 0, `two players: the winner gains what the loser drops (${d1.toFixed(1)})`);
    const c3 = records.saveBattle([{ userId: 1, score: 500, rounds: 9, correct: 5 }, { userId: 2, score: 500, rounds: 9, correct: 5 }, { userId: 3, score: 100, rounds: 9, correct: 1 }]);
    const sum = [1, 2, 3].reduce((a, id) => a + c3.get(id).after - c3.get(id).before, 0);
    ok(Math.abs(sum) < 1e-9 && c3.get(3).after < c3.get(3).before, 'three players: ratings still balance, last place drops');
    const solo = records.saveBattle([{ userId: 1, score: 500, rounds: 9, correct: 5 }, { userId: null, score: 900, rounds: 9, correct: 8 }]);
    ok(solo.size === 0, 'one signed-in player with a guest: no rating change');
    const lb = records.leaderboards();
    ok(lb.wins.length === 1 && lb.wins[0].name === 'Ana' && lb.wins[0].value === 1, 'tied first place isn’t counted as a win; outright first is', JSON.stringify(lb.wins));
    db.close();
  }
} catch (e) {
  fail++;
  console.log('FAILED:', e.stack || e);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* still open */ }
  process.exit(fail ? 1 : 0);
}
