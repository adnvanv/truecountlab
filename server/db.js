// SQLite database (Node's built-in node:sqlite). One file in data/, outside git.
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'truecountlab.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

// Each entry upgrades the schema by one version; PRAGMA user_version tracks progress.
const MIGRATIONS = [
  `CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     email         TEXT UNIQUE COLLATE NOCASE,
     email_verified INTEGER NOT NULL DEFAULT 0,
     display_name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT,
     created_at    INTEGER NOT NULL
   );
   CREATE TABLE identities (
     provider   TEXT NOT NULL,
     subject    TEXT NOT NULL,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     email      TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (provider, subject)
   );
   CREATE INDEX identities_user ON identities(user_id);
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE progress (
     user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     rev        INTEGER NOT NULL,
     data       TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE password_resets (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );`,
  // 2: multiplayer. Battle ratings and shared-table accuracy, for signed-in players.
  `CREATE TABLE battle_stats (
     user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     rating         REAL NOT NULL DEFAULT 1200,
     rated_games    INTEGER NOT NULL DEFAULT 0,
     wins           INTEGER NOT NULL DEFAULT 0,
     games          INTEGER NOT NULL DEFAULT 0,
     rounds         INTEGER NOT NULL DEFAULT 0,
     rounds_correct INTEGER NOT NULL DEFAULT 0,
     updated_at     INTEGER NOT NULL
   );
   CREATE TABLE table_stats (
     user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     hands          INTEGER NOT NULL DEFAULT 0,
     decisions      INTEGER NOT NULL DEFAULT 0,
     correct        INTEGER NOT NULL DEFAULT 0,
     bets           INTEGER NOT NULL DEFAULT 0,
     bets_correct   INTEGER NOT NULL DEFAULT 0,
     checks         INTEGER NOT NULL DEFAULT 0,
     checks_correct INTEGER NOT NULL DEFAULT 0,
     updated_at     INTEGER NOT NULL
   );`,
];

const version = db.prepare('PRAGMA user_version').get().user_version;
for (let v = version; v < MIGRATIONS.length; v++) {
  db.exec('BEGIN');
  try {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Run fn inside a transaction.
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Drop expired sessions and reset tokens now and then.
setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(now);
}, 60 * 60 * 1000).unref();

module.exports = { db, tx, DATA_DIR, DB_FILE };
