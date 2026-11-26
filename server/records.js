// Multiplayer results for signed-in players: battle ratings and shared-table accuracy,
// plus the public leaderboards built from them. Guests are never stored.
'use strict';
const { db, tx } = require('./db');
const U = require('./util');

const START_RATING = 1200;
const K = 32;
const MIN_RATED = 3; // rated battles before a player shows on the rating board
const MIN_ROUNDS = 30;
const MIN_DECISIONS = 100;
const MIN_CHECKS = 10;

const getBattle = db.prepare('SELECT * FROM battle_stats WHERE user_id = ?');
const ensureBattle = db.prepare(`INSERT INTO battle_stats (user_id, rating, updated_at) VALUES (?, ${START_RATING}, ?)
                                 ON CONFLICT(user_id) DO NOTHING`);
const ensureTable = db.prepare('INSERT INTO table_stats (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING');

const ratingOf = (userId) => getBattle.get(userId)?.rating ?? START_RATING;

// One finished battle. players: [{ userId|null, score, rounds, correct }].
// Ratings move only between signed-in players, and only when at least two took part:
// each pair is scored as a win, loss or draw (Elo), split over the field.
function saveBattle(players) {
  const users = players.filter((p) => p.userId);
  if (!users.length) return new Map();
  const now = Date.now();
  const changes = new Map();
  tx(() => {
    for (const p of users) ensureBattle.run(p.userId, now);
    const before = new Map(users.map((p) => [p.userId, ratingOf(p.userId)]));
    const rated = users.length >= 2;
    const top = Math.max(...players.map((p) => p.score));
    for (const p of users) {
      let delta = 0;
      if (rated) {
        for (const q of users) {
          if (q === p) continue;
          const expected = 1 / (1 + 10 ** ((before.get(q.userId) - before.get(p.userId)) / 400));
          const actual = p.score > q.score ? 1 : p.score === q.score ? 0.5 : 0;
          delta += (K * (actual - expected)) / (users.length - 1);
        }
      }
      const win = rated && p.score === top && p.score > 0 ? 1 : 0;
      db.prepare(`UPDATE battle_stats SET rating = rating + ?, rated_games = rated_games + ?, wins = wins + ?,
                    games = games + 1, rounds = rounds + ?, rounds_correct = rounds_correct + ?, updated_at = ?
                  WHERE user_id = ?`).run(delta, rated ? 1 : 0, win, p.rounds, p.correct, now, p.userId);
      if (rated) changes.set(p.userId, { before: before.get(p.userId), after: before.get(p.userId) + delta });
    }
  });
  return changes;
}

// Add one round's worth of shared-table counters for a signed-in player.
function addTableStats(userId, d) {
  const now = Date.now();
  ensureTable.run(userId, now);
  db.prepare(`UPDATE table_stats SET hands = hands + ?, decisions = decisions + ?, correct = correct + ?,
                bets = bets + ?, bets_correct = bets_correct + ?, checks = checks + ?, checks_correct = checks_correct + ?,
                updated_at = ? WHERE user_id = ?`)
    .run(d.hands || 0, d.decisions || 0, d.correct || 0, d.bets || 0, d.betsCorrect || 0, d.checks || 0, d.checksCorrect || 0, now, userId);
}

function leaderboards() {
  const q = (sql, ...args) => db.prepare(sql).all(...args);
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

// Your own online numbers, for the lobby.
function mine(userId) {
  const b = getBattle.get(userId);
  const t = db.prepare('SELECT * FROM table_stats WHERE user_id = ?').get(userId);
  return {
    battle: b ? { rating: Math.round(b.rating), ratedGames: b.rated_games, wins: b.wins, games: b.games, rounds: b.rounds, roundsCorrect: b.rounds_correct } : null,
    table: t ? { hands: t.hands, decisions: t.decisions, correct: t.correct, bets: t.bets, betsCorrect: t.bets_correct, checks: t.checks, checksCorrect: t.checks_correct } : null,
  };
}

let cache = null;
let cacheAt = 0;
async function handle(req, res, url, currentUser) {
  if (url.pathname !== '/api/leaderboards' || req.method !== 'GET') return false;
  if (!cache || Date.now() - cacheAt > 15000) { cache = leaderboards(); cacheAt = Date.now(); }
  const u = currentUser(req);
  U.json(res, 200, { ...cache, you: u ? { name: u.display_name, ...mine(u.id) } : null });
  return true;
}

module.exports = { saveBattle, addTableStats, leaderboards, mine, ratingOf, handle, START_RATING };
