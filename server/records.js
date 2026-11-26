// Results and usage: battle ratings and shared-table accuracy for signed-in players, the
// public leaderboards built from them, and site-wide usage counters (hands dealt, plays
// graded, battles played) that count everyone, guests included, as plain totals.
'use strict';
const { db, tx, one, all } = require('./db');
const U = require('./util');

/** @typedef {import('./types').Req} Req */
/** @typedef {import('./types').Res} Res */
/** @typedef {import('./types').UserRow} UserRow */
/** @typedef {import('./types').TableCounters} TableCounters */
/**
 * @typedef {object} BattleRow
 * @property {number} user_id @property {number} rating @property {number} rated_games @property {number} wins
 * @property {number} games @property {number} rounds @property {number} rounds_correct
 */
/**
 * @typedef {object} TableRow
 * @property {number} hands @property {number} decisions @property {number} correct @property {number} bets
 * @property {number} bets_correct @property {number} checks @property {number} checks_correct
 */
/** @typedef {{ name: string, value: number, games: number }} BoardRow */

const START_RATING = 1200;
const K = 32;
const MIN_RATED = 3; // rated battles before a player shows on the rating board
const MIN_ROUNDS = 30;
const MIN_DECISIONS = 100;
const MIN_CHECKS = 10;

const ensureBattle = db.prepare(`INSERT INTO battle_stats (user_id, rating, updated_at) VALUES (?, ${START_RATING}, ?)
                                 ON CONFLICT(user_id) DO NOTHING`);
const ensureTable = db.prepare('INSERT INTO table_stats (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING');

/** @param {number} userId */
const battleRow = (userId) => /** @type {BattleRow | undefined} */ (one('SELECT * FROM battle_stats WHERE user_id = ?', userId));
/** @param {number} userId */
const ratingOf = (userId) => battleRow(userId)?.rating ?? START_RATING;

/**
 * One finished battle. Ratings move only between signed-in players, and only when at least
 * two took part: each pair is scored as a win, loss or draw (Elo), split over the field.
 * @param {{ userId: number | null, score: number, rounds: number, correct: number }[]} players
 * @returns {Map<number, { before: number, after: number }>} rating changes by user id
 */
function saveBattle(players) {
  const users = /** @type {{ userId: number, score: number, rounds: number, correct: number }[]} */ (players.filter((p) => p.userId));
  bump('battles_played');
  if (!users.length) return new Map();
  const now = Date.now();
  /** @type {Map<number, { before: number, after: number }>} */
  const changes = new Map();
  tx(() => {
    for (const p of users) ensureBattle.run(p.userId, now);
    const before = new Map(users.map((p) => [p.userId, ratingOf(p.userId)]));
    const rated = users.length >= 2;
    const top = Math.max(...players.map((p) => p.score));
    const soleTop = players.filter((p) => p.score === top).length === 1; // a tie for first is nobody's win
    for (const p of users) {
      const mine = Number(before.get(p.userId));
      let delta = 0;
      if (rated) {
        for (const q of users) {
          if (q === p) continue;
          const expected = 1 / (1 + 10 ** ((Number(before.get(q.userId)) - mine) / 400));
          const actual = p.score > q.score ? 1 : p.score === q.score ? 0.5 : 0;
          delta += (K * (actual - expected)) / (users.length - 1);
        }
      }
      const win = rated && soleTop && p.score === top && p.score > 0 ? 1 : 0;
      db.prepare(`UPDATE battle_stats SET rating = rating + ?, rated_games = rated_games + ?, wins = wins + ?,
                    games = games + 1, rounds = rounds + ?, rounds_correct = rounds_correct + ?, updated_at = ?
                  WHERE user_id = ?`).run(delta, rated ? 1 : 0, win, p.rounds, p.correct, now, p.userId);
      if (rated) changes.set(p.userId, { before: mine, after: mine + delta });
    }
  });
  return changes;
}

/**
 * Add one round's worth of shared-table counters for a signed-in player.
 * @param {number} userId
 * @param {TableCounters} d
 */
function addTableStats(userId, d) {
  const now = Date.now();
  ensureTable.run(userId, now);
  db.prepare(`UPDATE table_stats SET hands = hands + ?, decisions = decisions + ?, correct = correct + ?,
                bets = bets + ?, bets_correct = bets_correct + ?, checks = checks + ?, checks_correct = checks_correct + ?,
                updated_at = ? WHERE user_id = ?`)
    .run(d.hands || 0, d.decisions || 0, d.correct || 0, d.bets || 0, d.betsCorrect || 0, d.checks || 0, d.checksCorrect || 0, now, userId);
}

function leaderboards() {
  /** @param {string} sql @param {...number} args @returns {BoardRow[]} */
  const q = (sql, ...args) => all(sql, ...args);
  return {
    rating: q(`SELECT u.display_name AS name, round(b.rating) AS value, b.rated_games AS games
               FROM battle_stats b JOIN users u ON u.id = b.user_id
               WHERE b.rated_games >= ? ORDER BY b.rating DESC LIMIT 25`, MIN_RATED),
    wins: q(`SELECT u.display_name AS name, b.wins AS value, b.rated_games AS games
             FROM battle_stats b JOIN users u ON u.id = b.user_id
             WHERE b.wins > 0 ORDER BY b.wins DESC, b.rated_games ASC LIMIT 25`),
    battleAccuracy: q(`SELECT u.display_name AS name, round(100.0 * b.rounds_correct / b.rounds, 1) AS value, b.rounds AS games
                       FROM battle_stats b JOIN users u ON u.id = b.user_id
                       WHERE b.rounds >= ? ORDER BY 1.0 * b.rounds_correct / b.rounds DESC, b.rounds DESC LIMIT 25`, MIN_ROUNDS),
    tablePlay: q(`SELECT u.display_name AS name, round(100.0 * t.correct / t.decisions, 1) AS value, t.decisions AS games
                  FROM table_stats t JOIN users u ON u.id = t.user_id
                  WHERE t.decisions >= ? ORDER BY 1.0 * t.correct / t.decisions DESC, t.decisions DESC LIMIT 25`, MIN_DECISIONS),
    tableChecks: q(`SELECT u.display_name AS name, round(100.0 * t.checks_correct / t.checks, 1) AS value, t.checks AS games
                    FROM table_stats t JOIN users u ON u.id = t.user_id
                    WHERE t.checks >= ? ORDER BY 1.0 * t.checks_correct / t.checks DESC, t.checks DESC LIMIT 25`, MIN_CHECKS),
    minimums: { rated: MIN_RATED, rounds: MIN_ROUNDS, decisions: MIN_DECISIONS, checks: MIN_CHECKS },
  };
}

/** Your own online numbers, for the lobby. @param {number} userId */
function mine(userId) {
  const b = battleRow(userId);
  /** @type {TableRow | undefined} */
  const t = one('SELECT * FROM table_stats WHERE user_id = ?', userId);
  return {
    battle: b ? { rating: Math.round(b.rating), ratedGames: b.rated_games, wins: b.wins, games: b.games, rounds: b.rounds, roundsCorrect: b.rounds_correct } : null,
    table: t ? { hands: t.hands, decisions: t.decisions, correct: t.correct, bets: t.bets, betsCorrect: t.bets_correct, checks: t.checks, checksCorrect: t.checks_correct } : null,
  };
}

// ---- usage counters ---------------------------------------------------------------------
// Plain site-wide totals: no user, IP or time of day is stored with them.
const COUNTERS = /** @type {const} */ ([
  'hands_dealt', // player hands dealt at shared tables
  'plays_graded', // bets, plays, insurance and count checks graded at shared tables
  'battles_played',
  'battle_answers', // answers graded in count battles
  'rooms_opened',
  'solo_hands', // hands played at the solo and training tables (reported by browsers)
  'solo_plays', // plays graded at the solo and training tables
  'drills', // countdown, true count, basic strategy and deviation attempts
]);
/** @typedef {typeof COUNTERS[number]} Counter */
const bumpStmt = db.prepare(`INSERT INTO counters (key, value, updated_at) VALUES (?, ?, ?)
                             ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`);

// Counts are added up in memory and written every few seconds (and on shutdown), so a
// busy table doesn't turn every graded play into a database write.
/** @type {Map<Counter, number>} */
const unsaved = new Map();
/** @param {Counter} key @param {number} [n] */
function bump(key, n = 1) {
  if (n > 0) unsaved.set(key, (unsaved.get(key) || 0) + Math.floor(n));
}
function flush() {
  if (!unsaved.size) return;
  const now = Date.now();
  const batch = [...unsaved];
  unsaved.clear();
  tx(() => { for (const [k, n] of batch) bumpStmt.run(k, n, now); });
}
setInterval(() => {
  try { flush(); } catch (e) { require('./log').error('saving usage counters failed', { err: e }); }
}, 5000).unref();

/** @returns {Record<string, number>} */
function usage() {
  /** @type {{ key: string, value: number }[]} */
  const rows = all('SELECT key, value FROM counters');
  /** @type {Record<string, number>} */
  const out = Object.fromEntries(COUNTERS.map((k) => [k, 0]));
  for (const r of rows) out[r.key] = r.value;
  for (const [k, n] of unsaved) out[k] = (out[k] || 0) + n;
  out.accounts = Number(one('SELECT count(*) AS n FROM users')?.n ?? 0);
  out.hands = out.hands_dealt + out.solo_hands;
  out.graded = out.plays_graded + out.solo_plays + out.drills + out.battle_answers;
  return out;
}

// Browsers report solo practice as small batches of counts (sent when the page is hidden).
const TALLY = /** @type {Record<string, Counter>} */ ({ hand: 'solo_hands', play: 'solo_plays', drill: 'drills' });
const tallyLimit = U.rateLimiter(30, 60 * 1000);

/** @param {Req} req @param {Res} res */
async function tally(req, res) {
  if (tallyLimit(U.clientIp(req))) return U.send(res, 204, '');
  const b = await U.readJson(req, 2048);
  for (const [kind, key] of Object.entries(TALLY)) {
    const n = Number(b[kind]);
    if (Number.isInteger(n) && n > 0) bump(key, Math.min(n, 500)); // a page can't add more than 500 at once
  }
  U.send(res, 204, '');
}

// shields.io "endpoint" badges for the README, e.g. hands dealt and played.
const BADGES = {
  hands: { label: 'hands played', key: 'hands' },
  graded: { label: 'plays graded', key: 'graded' },
  battles: { label: 'count battles', key: 'battles_played' },
  accounts: { label: 'accounts', key: 'accounts' },
};
/** @param {number} n */
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US'));

/** @type {{ boards: ReturnType<typeof leaderboards>, at: number } | null} */
let boardCache = null;
/** @type {{ usage: Record<string, number>, at: number } | null} */
let usageCache = null;
const cachedUsage = () => {
  if (!usageCache || Date.now() - usageCache.at > 30000) usageCache = { usage: usage(), at: Date.now() };
  return usageCache.usage;
};

/**
 * @param {Req} req @param {Res} res @param {URL} url
 * @param {(req: Req) => UserRow | null} currentUser
 * @returns {Promise<boolean>}
 */
async function handle(req, res, url, currentUser) {
  const p = url.pathname;
  if (p === '/api/leaderboards' && req.method === 'GET') {
    if (!boardCache || Date.now() - boardCache.at > 15000) boardCache = { boards: leaderboards(), at: Date.now() };
    const u = currentUser(req);
    U.json(res, 200, { ...boardCache.boards, you: u ? { name: u.display_name, ...mine(u.id) } : null });
    return true;
  }
  if (p === '/api/stats' && req.method === 'GET') {
    U.json(res, 200, cachedUsage(), { 'cache-control': 'public, max-age=60' });
    return true;
  }
  const badge = p.match(/^\/api\/badge\/([a-z]+)$/);
  if (badge && req.method === 'GET') {
    const b = BADGES[/** @type {keyof typeof BADGES} */ (badge[1])];
    if (!b) { U.fail(res, 404, 'No such badge.'); return true; }
    U.json(res, 200, { schemaVersion: 1, label: b.label, message: compact(cachedUsage()[b.key] || 0), color: 'e3bc5f' }, { 'cache-control': 'public, max-age=300' });
    return true;
  }
  if (p === '/api/tally' && req.method === 'POST') { await tally(req, res); return true; }
  return false;
}

module.exports = { saveBattle, addTableStats, leaderboards, mine, ratingOf, bump, flush, usage, handle, START_RATING };
