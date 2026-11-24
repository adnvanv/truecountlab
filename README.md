# Count Trainer

A blackjack card-counting trainer. It's vanilla JS with no build step and no dependencies, served by a small Node server.

**Live:** http://100.85.72.107:3040 (or http://boward:3040). It's reachable only over Tailscale.

## Modes
- **Table**: play a 6-deck shoe against the dealer with 0–5 other players. Every decision is graded against basic strategy plus Hi-Lo index plays (Illustrious 18 + Fab 4). The trainer also checks your bet against a TC−1 ramp and gives random count checks.
- **Speed Count**: cards flash at a pace you set. Enter the running count at the end, then review it card by card.
- **Deck Countdown**: count down one deck against the clock. One card is optionally hidden, and you deduce it from your final count.
- **True Count**: convert a running count by estimating the decks left from the discard tray.
- **Strategy**: flash-card drill for basic strategy and index plays.
- **Charts / Stats / Settings**: reference charts for your rules, progress tracking, and options for system and rules. The supported systems are Hi-Lo, KO, Hi-Opt I/II, Omega II, and Zen. You can also set S17/H17, DAS, surrender, and penetration.

Progress is saved to `data/state.json` on the server, so it follows you between devices. It's also cached in localStorage.

## Run locally
```
node server.js        # http://127.0.0.1:3040
```

## Deploy
```
.\deploy.ps1
```
The script packs `server.js`, `public/`, and `deploy/`, then copies them to `boward:~/blackjack`. It installs `deploy/count-trainer.service` as a systemd **user** service, which binds to 100.85.72.107:3040. The `data/` folder on the server is left alone.

Useful on the server: `systemctl --user status count-trainer` and `journalctl --user -u count-trainer`.
