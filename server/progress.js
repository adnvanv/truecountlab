// Saved progress per account (settings, drill stats, bankroll, sessions) as one JSON document.
// Saves carry the revision they were based on; a stale save gets 409 plus the newer copy,
// and the app merges and retries, so one device never silently overwrites another.
'use strict';
const { db, tx, one } = require('./db');
const U = require('./util');
const auth = require('./auth');

/** @typedef {import('./types').Req} Req */
/** @typedef {import('./types').Res} Res */
/** @typedef {import('./types').UserRow} UserRow */
/** @typedef {{ rev: number, data: string }} ProgressRow */

const MAX = 1024 * 1024; // 1 MB per account

/** @param {number} userId */
const load = (userId) => /** @type {ProgressRow | undefined} */ (one('SELECT rev, data FROM progress WHERE user_id = ?', userId));

/** @param {Res} res @param {UserRow} user */
function get(res, user) {
  const row = load(user.id);
  U.json(res, 200, row ? { rev: row.rev, data: JSON.parse(row.data) } : { rev: 0, data: null });
}

/** @param {Req} req @param {Res} res @param {UserRow} user */
async function put(req, res, user) {
  const b = await U.readJson(req, MAX + 64 * 1024);
  if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) return U.fail(res, 400, 'Expected progress data.');
  const text = JSON.stringify(b.data);
  if (text.length > MAX) return U.fail(res, 413, 'Progress is too large.');
  const baseRev = Number(b.baseRev) || 0;
  /** @type {{ conflict?: boolean, rev: number, data?: unknown }} */
  const result = tx(() => {
    const row = load(user.id);
    const current = row ? row.rev : 0;
    if (current !== baseRev) return { conflict: true, rev: current, data: row ? JSON.parse(row.data) : null };
    const rev = current + 1;
    db.prepare(`INSERT INTO progress (user_id, rev, data, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET rev = excluded.rev, data = excluded.data, updated_at = excluded.updated_at`)
      .run(user.id, rev, text, Date.now());
    return { rev };
  });
  if (result.conflict) return U.json(res, 409, { error: 'Progress changed on another device.', rev: result.rev, data: result.data });
  U.json(res, 200, { rev: result.rev });
}

/** @param {Req} req @param {Res} res @param {URL} url @returns {Promise<boolean>} */
async function handle(req, res, url) {
  if (url.pathname !== '/api/progress') return false;
  const user = auth.currentUser(req);
  if (!user) { U.fail(res, 401, 'Sign in to save progress to your account.'); return true; }
  if (req.method === 'GET') get(res, user);
  else if (req.method === 'PUT') await put(req, res, user);
  else U.fail(res, 405, 'Method not allowed');
  return true;
}

module.exports = { handle };
