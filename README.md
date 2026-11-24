# Count Trainer

A blackjack card-counting trainer for one strategy:

- **Game:** 6 decks, S17, DAS, 3:2, no surrender, 75% penetration, $25 minimum.
- **Count:** Hi-Lo. True count = running count ÷ decks remaining, with decks estimated to the nearest half deck and the result rounded down.
- **Deviations:** insurance at +3, 16v10 stand at 0, 15v10 stand at +4, 12v3 stand at +2, 12v2 stand at +3, 10v10 double at +4, 10vA double at +4, 9v2 double at +1.
- **Bet ramp:** $25 at TC ≤ +1, $50 at +2/+3, $75 at +4 and up.
- **Bankroll:** $3,000 with a $500 session buy-in. The stop-loss is the buy-in.

**Live:** http://boward:3040. It's reachable only over Tailscale: the server binds to the Optiplex's Tailscale IP, 100.85.72.107.

## Modes
1. **Countdown:** single deck at an adjustable speed (or tap/Space). The goal is to finish at 0 in under 30s. You can optionally remove a card so the answer can't be guessed.
2. **Distraction:** the same countdown with synthesized casino audio, spoken numbers, a chatter ticker, and pop-up questions.
3. **True Count:** a running count plus a discard tray (or a decks-remaining number) → enter the true count. Mistakes are classified, e.g. rounding, dividing by decks played, or a bad deck estimate.
4. **Basic Strategy:** random hands, instant feedback, a mistake heatmap, and an optional focus on weak spots.
5. **Deviations:** a hand plus a true count within ±3 of the index → choose basic strategy or the deviation.
6. **Bet Sizing:** given the true count (or the running count plus the tray), pick $25, $50, or $75.
7. **Table:** a full 6-deck shoe with other players. It grades your play, deviations, and bets against the ramp, and gives random count checks. The count is hidden, and C reveals it. Sessions use the $500 buy-in and stop-loss.
8. **Sessions:** simulator sessions log themselves, and you add real casino sessions by hand. The page charts results and counting accuracy over time.

**Stats** shows accuracy, speed, error types, and progress by day for each mode. **Strategy** is the reference chart.

Progress is saved in localStorage and synced to `data/state.json` on the server, so your phone and PC share it.

## Develop
```
node server.js        # http://127.0.0.1:3040
```
It's vanilla JS with ES modules: no build step and no dependencies.

## Deploy
```
git push
```
`origin` is the bare repo `boward@boward:blackjack.git`. Its `post-receive` hook resets `~/blackjack` to the pushed `main`, installs `deploy/count-trainer.service`, and restarts the systemd user service. `data/` is untracked, so it survives deploys.

On the server: `systemctl --user status count-trainer` and `journalctl --user -u count-trainer`.
