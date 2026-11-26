#!/usr/bin/env bash
# Save sign-in or email keys into the server's .env (never in git), then restart the app.
# Secrets are typed hidden, so they don't show on screen or end up in shell history.
#
# Usage, from your own computer:
#   ssh -t boward@boward "bash ~/blackjack/scripts/set-keys.sh google"
#   ssh -t boward@boward "bash ~/blackjack/scripts/set-keys.sh discord"
#   ssh -t boward@boward "bash ~/blackjack/scripts/set-keys.sh email"
# Run it again any time to replace a key.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP/.env"

case "${1:-}" in
  google)  KEYS=(GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET) ;;
  discord) KEYS=(DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET) ;;
  email)   KEYS=(RESEND_API_KEY MAIL_FROM) ;;
  *) echo "Usage: bash $0 google|discord|email" >&2; exit 1 ;;
esac

declare -A VALUES
for k in "${KEYS[@]}"; do
  if [[ $k == *SECRET* || $k == *API_KEY* ]]; then
    read -rsp "Paste $k (hidden), then Enter: " v; echo
  elif [[ $k == MAIL_FROM ]]; then
    read -rp "$k [TrueCountLab <no-reply@truecountlab.com>]: " v
    v="${v:-TrueCountLab <no-reply@truecountlab.com>}"
  else
    read -rp "Paste $k, then Enter: " v
  fi
  # Trim stray whitespace and line breaks from pasting.
  v="${v//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  if [[ -z $v ]]; then echo "Nothing entered for $k. Stopped; nothing was changed." >&2; exit 1; fi
  if [[ $v =~ [\"\'\\\$\`] ]]; then echo "$k has a character that can't be right (quote, backslash, \$ or backtick). Stopped; nothing was changed." >&2; exit 1; fi
  VALUES[$k]="$v"
done

umask 077
touch "$ENV_FILE"
tmp="$(mktemp "$APP/.env.XXXXXX")"
pattern="^($(IFS='|'; echo "${KEYS[*]}"))="
grep -Ev "$pattern" "$ENV_FILE" > "$tmp" || true
for k in "${KEYS[@]}"; do
  v="${VALUES[$k]}"
  if [[ $v == *' '* ]]; then printf '%s="%s"\n' "$k" "$v" >> "$tmp"; else printf '%s=%s\n' "$k" "$v" >> "$tmp"; fi
done
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
echo "Saved ${KEYS[*]} to $ENV_FILE"

systemctl --user restart count-trainer
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if config="$(curl -fsS -H 'Host: truecountlab.com' http://127.0.0.1:3040/api/auth/config 2>/dev/null)"; then
    echo "App restarted. Sign-in options now: $config"
    exit 0
  fi
  sleep 1
done
echo "The app didn't come back up. Check: journalctl --user -u count-trainer -n 30" >&2
exit 1
