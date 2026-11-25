// One-time import of the old shared save file (data/state.json, from before accounts)
// into one account's saved progress.
//
// Usage (on the server, from the app folder):
//   node --disable-warning=ExperimentalWarning scripts/import-legacy.js you@example.com
//
// Refuses if that account already has saved progress, so nothing gets overwritten.
// The old file is kept, renamed to state.json.imported-<date>.
'use strict';
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../server/db');

const who = String(process.argv[2] || '').trim();
if (!who) { console.error('Usage: node scripts/import-legacy.js <account email or display name>'); process.exit(1); }

const file = path.join(DATA_DIR, 'state.json');
if (!fs.existsSync(file)) { console.error(`No old save file at ${file}`); process.exit(1); }
const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));

const user = db.prepare('SELECT id, display_name, email FROM users WHERE email = ? OR display_name = ?').get(who.toLowerCase(), who);
if (!user) { console.error(`No account with email or display name "${who}". Create the account first.`); process.exit(1); }

const existing = db.prepare('SELECT rev, data FROM progress WHERE user_id = ?').get(user.id);
if (existing) {
  const s = JSON.parse(existing.data).stats || {};
  const runs = Object.values(s).reduce((n, b) => n + (b.runs?.length || 0), 0);
  if (runs > 0 || (s.table?.hands || 0) > 0) {
    console.error(`${user.display_name} already has saved progress (${runs} drill runs, ${s.table?.hands || 0} table hands). Not overwriting it.`);
    process.exit(1);
  }
}

const data = { savedAt: Date.now(), settings: legacy.settings, stats: legacy.stats, bankroll: legacy.bankroll, session: legacy.session, sessions: legacy.sessions };
const rev = (existing?.rev || 0) + 1;
db.prepare(`INSERT INTO progress (user_id, rev, data, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET rev = excluded.rev, data = excluded.data, updated_at = excluded.updated_at`)
  .run(user.id, rev, JSON.stringify(data), Date.now());

const stamp = new Date().toISOString().slice(0, 10);
fs.renameSync(file, `${file}.imported-${stamp}`);

const runs = Object.values(legacy.stats || {}).reduce((n, b) => n + (b.runs?.length || 0), 0);
console.log(`Imported into ${user.display_name}: ${runs} drill runs, ${legacy.stats?.table?.hands || 0} table hands, ${(legacy.sessions || []).length} logged sessions.`);
console.log(`Old file kept as ${path.basename(file)}.imported-${stamp}`);
