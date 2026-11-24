# Count Trainer

A blackjack card-counting trainer for one strategy:

- **Game:** 6 decks, S17, DAS, 3:2, no surrender, 75% penetration, $25 minimum.
- **Count:** Hi-Lo. True count = running count ÷ decks remaining, with decks estimated to the nearest half deck and the result rounded down.
- **Deviations:** core: insurance +3, 16v10 stand 0, 15v10 stand +4, 12v3 stand +2, 12v2 stand +3, 10v10 double +4, 10vA double +4, 9v2 double +1. Low-count hits: 12v4 below 0, 12v5 below −2, 12v6 below −1, 13v2 at −1 or lower, 13v3 at −2 or lower. Extras: 11vA double +1, 9v7 double +3, 8v6 double +2, 8v5 double +4, 16v9 stand +5. With the surrender toggle on (off by default): 15v10 0, 14v10 +3, 15v9 +2, 15vA +1.
- **Bet ramp:** $25 at TC ≤ +1, $50 at +2/+3, $75 at +4 and up.
- **Bankroll:** $3,000 with a $500 session buy-in. The stop-loss is the buy-in.

**Live:** http://boward:3040. It's reachable only over Tailscale: the server binds to the Optiplex's Tailscale IP, 100.85.72.107.

## Home
The home screen has a **ready-to-play checklist** that unlocks once all four gates are met at the same time:
- 5 countdowns in a row ending at exactly 0, each under 30s
- 98%+ basic strategy over the last 200 hands
- 95%+ true count over the last 100 drills
- 95%+ deviations over the last 100 hands

## Modes
1. **Countdown:** single deck at an adjustable speed (or tap/Space). The goal is to finish at 0 in under 30s. You can optionally remove a card so the answer can't be guessed.
2. **Distraction:** the same countdown with synthesized casino audio, spoken numbers, a chatter ticker, and pop-up questions.
3. **True Count:** a running count plus a discard tray (or a decks-remaining number) → enter the true count. Mistakes are classified, e.g. rounding, dividing by decks played, or a bad deck estimate.
4. **Basic Strategy:** random hands, instant feedback, a mistake heatmap, and an optional focus on weak spots.
5. **Deviations:** each hand shows its true count. Your pick is graded as basic strategy, the deviation, or a wrong play. Practice is weighted toward the deviations you miss, and there's a threshold drill at index −1/0/+1.
6. **Bet Sizing:** given the true count (or the running count plus the tray), pick $25, $50, or $75.
7. **Table:** a full 6-deck shoe with other players. It grades your play, deviations, and bets against the ramp, and gives random count checks. The count is hidden, and C reveals it. Sessions use the $500 buy-in and stop-loss.
8. **Sessions:** simulator sessions log themselves, and you add real casino sessions by hand. The page charts results and counting accuracy over time.

- **Training:** the table with practice chips, nothing logged, and a cheat toggle (X). The cheat panel shows the running count, decks left, true count, correct bet, and correct play, and highlights the right button.
- **Bankroll Calc:** hourly EV, SD, and risk of ruin from bankroll, unit, and spread. It uses a true-count frequency table simulated for this game.

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
