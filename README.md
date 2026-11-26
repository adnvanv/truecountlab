# TrueCountLab

A blackjack card-counting trainer for one strategy, live at **[truecountlab.com](https://truecountlab.com)**:

- **Game:** 6 decks, S17, DAS, 3:2, no surrender, 75% penetration, $25 minimum.
- **Count:** Hi-Lo. True count = running count ÷ decks remaining, with decks estimated to the nearest half deck and the result rounded down.
- **Deviations:** core: insurance +3, 16v10 stand 0, 15v10 stand +4, 12v3 stand +2, 12v2 stand +3, 10v10 double +4, 10vA double +4, 9v2 double +1. Low-count hits: 12v4 below 0, 12v5 below −2, 12v6 below −1, 13v2 at −1 or lower, 13v3 at −2 or lower. Extras: 11vA double +1, 9v7 double +3, 8v6 double +2, 8v5 double +4, 16v9 stand +5. With the surrender toggle on (off by default): 15v10 0, 14v10 +3, 15v9 +2, 15vA +1.
- **Bet ramp:** $25 at TC ≤ +1, $50 at +2/+3, $75 at +4 and up.
- **Bankroll:** $3,000 with a $500 session buy-in. The stop-loss is the buy-in.

## Home
The home screen has a **ready-to-play checklist** that unlocks once all four gates are met at the same time:
- 5 countdowns in a row with the right count at deck pace (≤ 0.58s per card)
- 98%+ basic strategy over the last 200 hands
- 95%+ true count over the last 100 drills
- 95%+ deviations over the last 100 hands

## Modes
1. **Countdown:** a random 15–20 cards from a fresh deck (other lengths are selectable), then you enter the running count. Misses show a card-by-card review. The goal is the right count at deck pace (≤ 0.58s per card).
2. **True Count:** a running count plus a discard tray (or a decks-remaining number) → enter the true count. Mistakes are classified, e.g. rounding, dividing by decks played, or a bad deck estimate.
3. **Basic Strategy:** random hands, instant feedback, a mistake heatmap, and an optional focus on weak spots.
4. **Deviations:** each hand shows its true count. Your pick is graded as basic strategy, the deviation, or a wrong play. Practice is weighted toward the deviations you miss, and there's a threshold drill at index −1/0/+1.
5. **Table:** a full 6-deck shoe with other players. It grades your play, deviations, and bets against the ramp, and gives random count checks. The count is hidden, and C reveals it. Sessions use the $500 buy-in and stop-loss.
6. **Sessions:** simulator sessions log themselves, and you add real casino sessions by hand. The page charts results and counting accuracy over time.

- **Training:** the table with practice chips, nothing logged, and a cheat toggle (X). The cheat panel shows the running count, decks left, true count, correct bet, and correct play, and highlights the right button.
- **Bankroll Calc:** hourly EV, SD, and risk of ruin from bankroll, unit, and spread. It uses a true-count frequency table simulated for this game.

**Stats** shows accuracy, speed, error types, and progress by day for each mode. **Strategy** is the reference chart.

## Accounts
Guests can play everything; their progress stays in the browser. Accounts save progress to the server so it follows you to any device:
- **Sign-in:** email + password (scrypt-hashed), or Google / Discord (OAuth). A Google/Discord login is never auto-merged into an existing password account with the same email; you connect it from the Account page while signed in.
- **Sessions:** random tokens in `HttpOnly`, `SameSite=Lax` cookies (`Secure` on https). Only a SHA-256 of each token is stored.
- **Sync:** one JSON document per account with a revision number. A stale save gets `409` plus the newer copy; the app merges (drill history is unioned, counters take the larger value) and retries.
- **Guest → account:** signing up uploads the browser's guest progress. Signing in to an account that already has progress asks before adding it.
- **Protection:** per-IP and per-account rate limits on sign-in, an origin check on every request that changes data, a Content-Security-Policy, and HSTS on the public site.
- **Your data:** export as JSON or delete the account (and all progress) from the Account page. See `/privacy`.

Data lives in `data/truecountlab.db` (Node's built-in SQLite, no npm dependencies).

### Optional sign-in providers and email
They switch on when their keys are in the server's `.env` (never in git):
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
RESEND_API_KEY=...            # password-reset emails
MAIL_FROM=TrueCountLab <no-reply@truecountlab.com>
```
OAuth redirect URIs: `https://truecountlab.com/auth/google/callback` and `https://truecountlab.com/auth/discord/callback`. Google and Discord sign-in is offered only on the public address, since that's where the providers send people back.

`scripts/set-keys.sh google|discord|email` asks for the keys (secrets typed hidden), writes them to `.env`, restarts the app, and prints which sign-in options are on:
```
ssh -t <server> "bash ~/blackjack/scripts/set-keys.sh google"
```

`scripts/import-legacy.js` moves the old pre-accounts save file (`data/state.json`) into one account.

## Develop
```
node --disable-warning=ExperimentalWarning server.js   # http://127.0.0.1:3040
```
It's vanilla JS with ES modules: no build step and no dependencies. `HOST` and `PORT` environment variables change where it listens.

Scripts and stylesheets are served from `/v/<build>/…`, where the build id is a hash of everything in `public/`. Each deploy changes every asset URL, so browsers and Cloudflare never keep running old code; with `NODE_ENV=production` those URLs are cached for a year.

## Deploy
```
git push
```
`git push` sends `main` to GitHub and to a bare repo on the server. The server's `post-receive` hook resets the live checkout to the pushed `main`, installs `deploy/count-trainer.service`, and restarts the systemd user service.

The public site reaches the server through a **Cloudflare Tunnel**: `cloudflared` runs on the server as the `cloudflared` user service (`deploy/cloudflared.service`) and forwards `truecountlab.com` to the app on `127.0.0.1:3040`. No ports are opened on the network. Requests that come through Cloudflare are redirected to the one canonical address, `https://truecountlab.com`.

Server-only files stay out of git and survive deploys:
- `.env` sets `HOST`/`PORT` (the service reads it; default `127.0.0.1:3040`).
- `data/` holds saved progress.

On the server: `systemctl --user status count-trainer` and `journalctl --user -u count-trainer`.

## Credits
Card and chip sounds: [Casino Audio](https://kenney.nl/assets/casino-audio) by Kenney (CC0).
