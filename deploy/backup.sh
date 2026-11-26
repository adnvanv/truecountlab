#!/usr/bin/env bash
# Snapshot the SQLite database: a consistent copy made while the app keeps running
# (VACUUM INTO), checked with an integrity check, compressed, and rotated.
#   nightly    from truecountlab-backup.timer; keeps the last 14
#   pre-deploy before every deploy (deploy/autodeploy.sh); keeps the last 10
# Snapshots live in ~/backups/truecountlab, next to (not inside) the app checkout.
# Off-site, continuous backups are Litestream's job (deploy/litestream.yml).
#
# Restore: stop the app, gunzip a snapshot over data/truecountlab.db, start the app.
set -euo pipefail

main() {
  local kind="${1:-nightly}" keep
  case "$kind" in
    nightly) keep=14 ;;
    pre-deploy) keep=10 ;;
    *) echo "usage: backup.sh nightly|pre-deploy" >&2; return 2 ;;
  esac
  local app="${APP:-$HOME/blackjack}"
  local db="${DB_FILE:-$app/data/truecountlab.db}"
  local dir="${BACKUP_DIR:-$HOME/backups/truecountlab}"
  [[ -f "$db" ]] || { echo "backup: no database at $db (nothing to back up yet)"; return 0; }
  mkdir -p "$dir"
  chmod 700 "$dir"
  local out="$dir/$kind-$(date -u +%Y%m%dT%H%M%SZ).db"

  SRC="$db" DEST="$out" node --disable-warning=ExperimentalWarning --input-type=commonjs - <<'JS'
const { DatabaseSync } = require('node:sqlite');
const { SRC, DEST } = process.env;
const db = new DatabaseSync(SRC, { readOnly: true });
db.exec(`VACUUM INTO '${DEST.replace(/'/g, "''")}'`);
db.close();
const copy = new DatabaseSync(DEST, { readOnly: true });
const ok = copy.prepare('PRAGMA integrity_check').get().integrity_check;
copy.close();
if (ok !== 'ok') { console.error(`backup: integrity check failed: ${ok}`); process.exit(1); }
JS

  gzip -9 "$out"
  chmod 600 "$out.gz"
  echo "backup: $out.gz ($(du -h "$out.gz" | cut -f1))"

  # Keep the newest $keep of this kind.
  ls -1t "$dir"/"$kind"-*.db.gz 2>/dev/null | tail -n +"$((keep + 1))" | while read -r old; do rm -f -- "$old"; done
}

main "$@"
