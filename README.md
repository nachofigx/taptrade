# Tapline (practice mode)

Tap-trading game: tap a grid cell; if the live price touches that price band during that time column, you win stake × multiplier. Play money only, real prices (Coinbase WebSocket).

- `engine.js`  pricing (Monte Carlo touch probabilities, 8% house edge) and bet resolution
- `main.js`    canvas UI (4:3 cells), price feed, bets, game feel (particles, synthesized sound, streaks)
- `indicators.js`  SMA, EMA, RSI and bar resampling (pure, tested)
- `fonts/`      self-hosted Bungee, Orbitron, Rajdhani (SIL OFL)
- `progress.js`  XP, levels, achievements, daily mission and streak, themes, pixel avatars, fake-wallet ledger (localStorage)
- `odds.js` / `odds.json` / `context.js`  tuner output loader (validated), shipped baseline, market context used in pricing
- `deploy/`  VPS install (setup.sh, systemd timer, publish.sh) and DEPLOY.md; `config.js` says where the game reads odds from
- `tools/`  fetch_trades.py (incremental), load_trades.mjs, replay.mjs, strategies.mjs, tuner.mjs, run_tuner.sh (odds backtesting and tuning; see `ODDS.md`)
- `calibration.js`  probability calibration tables learned from real trades; see `ODDS.md` and `tools/`
- `extras.js`  cosmetics, season pass, daily chest, golden hour, flash challenge, announcer lines, replay clips (pure logic; XP and cosmetics only, never touches balance or odds)
- `engine.test.js`  `node --test engine.test.js` (includes a ~45 s simulation check that expected return ≈ 92%)

Tests: `node --test *.test.js`

Run: `python3 -m http.server 8137`, then open http://localhost:8137

Next (phase 2): server-side resolution, Pyth oracle, Solana program + vault, session keys. Needs legal review and an audit before real money.
