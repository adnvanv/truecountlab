#!/usr/bin/env bash
# Continuous deployment, pull-based: deploy the newest commit on GitHub's main branch, but
# only once every CI check on it has passed. Runs every minute from truecountlab-deploy.timer
# (a systemd user timer on the server).
#
# Nothing needs opening to the internet and GitHub holds no secrets: the repository is
# public, so fetching it and reading its check results need no token.
#
# Each deploy: back up the database, check out the commit, restart the app, and wait for
# /healthz to report the new commit. If it doesn't within 30s, roll back to the previous
# commit and skip this one until a newer commit arrives.
#
# Emergency use (GitHub Actions down): FORCE=1 bash ~/blackjack/deploy/autodeploy.sh
set -euo pipefail

# Everything runs inside main(), so bash has read the whole script before `git reset`
# replaces this file with the new version.
main() {
  local app="${APP:-$HOME/blackjack}"
  local repo="${REPO:-adnvanv/truecountlab}"
  local branch=main
  local state="${XDG_STATE_HOME:-$HOME/.local/state}/truecountlab"
  local port="${PORT:-3040}"
  mkdir -p "$state"
  cd "$app"

  git fetch --quiet github "$branch"
  local target current
  target="$(git rev-parse "github/$branch")"
  current="$(git rev-parse HEAD)"
  [[ "$target" == "$current" ]] && return 0
  if [[ "$(cat "$state/bad" 2>/dev/null)" == "$target" ]]; then return 0; fi # rolled back already

  if [[ "${FORCE:-}" != 1 ]]; then
    local runs total pending failed
    if ! runs="$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/$repo/commits/$target/check-runs?per_page=100")"; then
      echo "deploy: couldn't reach GitHub; trying again next minute"
      return 0
    fi
    total="$(jq '.total_count' <<<"$runs")"
    pending="$(jq '[.check_runs[] | select(.status != "completed")] | length' <<<"$runs")"
    failed="$(jq '[.check_runs[] | select(.status == "completed" and ((.conclusion | IN("success", "skipped", "neutral")) | not))] | length' <<<"$runs")"
    # CI hasn't started or finished yet: wait for it.
    if [[ "$total" -eq 0 || "$pending" -gt 0 ]]; then return 0; fi
    if [[ "$failed" -gt 0 ]]; then
      if [[ "$(cat "$state/failed" 2>/dev/null)" != "$target" ]]; then
        echo "deploy: not deploying ${target:0:8}: $failed CI check(s) failed"
        echo "$target" >"$state/failed"
      fi
      return 0
    fi
  fi

  echo "deploy: ${current:0:8} -> ${target:0:8} ($(git log -1 --format=%s "$target"))"
  if ! bash "$app/deploy/backup.sh" pre-deploy; then
    echo "deploy: database backup failed; not deploying"
    return 1
  fi
  switch_to "$app" "$state" "$target"
  for _ in $(seq 1 30); do
    local health
    if health="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/healthz" 2>/dev/null)" \
      && [[ "$(jq -r .commit <<<"$health")" == "$target" && "$(jq -r .status <<<"$health")" == ok ]]; then
      echo "deploy: ${target:0:8} is live"
      rm -f "$state/failed"
      return 0
    fi
    sleep 1
  done

  echo "deploy: ${target:0:8} failed its health check; rolling back to ${current:0:8}"
  echo "$target" >"$state/bad"
  switch_to "$app" "$state" "$current"
  return 1
}

# Check out a commit, install its systemd units, and restart the app on it.
switch_to() {
  local app="$1" state="$2" commit="$3"
  git -C "$app" reset --hard -q "$commit"
  mkdir -p "$HOME/.config/systemd/user"
  cp "$app"/deploy/*.service "$app"/deploy/*.timer "$HOME/.config/systemd/user/"
  echo "GIT_COMMIT=$commit" >"$state/build.env"
  systemctl --user daemon-reload
  systemctl --user enable -q count-trainer
  systemctl --user enable -q --now truecountlab-deploy.timer truecountlab-backup.timer
  systemctl --user restart count-trainer
  systemctl --user try-restart litestream || true
}

main "$@"
