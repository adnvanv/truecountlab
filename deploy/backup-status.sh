#!/usr/bin/env bash
# Check that both backup layers are current, and write the answer to data/backup-status.json.
# /healthz reports it, and the Uptime workflow (.github/workflows/uptime.yml) alerts on it.
# Runs hourly from truecountlab-backup-status.timer.
#
#   local    when the newest snapshot in ~/backups/truecountlab was taken
#   replica  "ok"     every change made 2+ minutes ago is in R2
#            "behind" R2 is missing changes older than that (Litestream stuck or failing)
#            "error"  R2 couldn't be listed (keys, network, or Litestream not running)
#            "off"    no R2 keys saved
#
# The replica check compares transaction ids, not times: a quiet day with no writes
# uploads nothing, and that's fine. It reads the local position, waits 2 minutes (the
# sync interval is 1), then checks that R2 has reached it.
set -euo pipefail

main() {
  local app="${APP:-$HOME/blackjack}"
  local db="${DB_FILE:-$app/data/truecountlab.db}"
  local dir="${BACKUP_DIR:-$HOME/backups/truecountlab}"
  local out="${STATUS_FILE:-$(dirname "$db")/backup-status.json}"
  local wait="${WAIT_SECONDS:-120}"
  local ls="$HOME/.local/bin/litestream" cfg="$app/deploy/litestream.yml"

  local newest local_at=""
  newest="$(ls -1t "$dir"/*.db.gz 2>/dev/null | head -1 || true)"
  [[ -n "$newest" ]] && local_at="$(date -u -r "$newest" +%Y-%m-%dT%H:%M:%SZ)"

  local replica=off local_txid="" replica_txid="" detail=""
  if grep -q '^LITESTREAM_BUCKET=' "$app/.env" 2>/dev/null; then
    set -a; . "$app/.env"; set +a
    replica=error
    if ! systemctl --user is-active -q litestream; then
      detail="litestream service is not running"
    elif ! local_txid="$("$ls" status -config "$cfg" 2>&1 | awk -v db="$db" '$1 == db { print $3 }')" || [[ -z "$local_txid" ]]; then
      detail="litestream status failed"
    else
      sleep "$wait"
      local listing
      if ! listing="$("$ls" ltx -config "$cfg" -level all "$db" 2>&1)"; then
        # The raw error can name the endpoint, so it goes to the journal, not the public status.
        echo "backup-status: litestream ltx failed: $(tail -1 <<<"$listing")" >&2
        detail="couldn't list R2 (see journalctl --user -u truecountlab-backup-status)"
      else
        # Column 3 is max_txid: fixed-width hex, so text order is numeric order.
        replica_txid="$(awk 'NR > 1 { print $3 }' <<<"$listing" | sort | tail -1)"
        if [[ -z "$replica_txid" ]]; then detail="R2 has no backup files"
        elif [[ "$replica_txid" < "$local_txid" ]]; then replica=behind; detail="R2 is at $replica_txid, the database was at $local_txid ${wait}s ago"
        else replica=ok
        fi
      fi
    fi
  fi

  local tmp="$out.tmp"
  jq -n --arg checked "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg local "$local_at" --arg replica "$replica" \
    --arg localTxid "$local_txid" --arg replicaTxid "$replica_txid" --arg detail "$detail" \
    '{checked: $checked, local: $local, replica: $replica, localTxid: $localTxid,
      replicaTxid: $replicaTxid, detail: $detail} | with_entries(select(.value != ""))' >"$tmp"
  mv "$tmp" "$out"
  echo "backup-status: local=${local_at:-none} replica=$replica${detail:+ ($detail)}"
}

main "$@"
