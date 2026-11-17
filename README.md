# Tapline (practice mode)

Tap-trading game: tap a grid cell; if the live price touches that price band during that time column, you win stake × multiplier. Play money only, real prices (Coinbase WebSocket).

- `engine.js`  pricing (Monte Carlo touch probabilities, 8% house edge) and bet resolution
- `main.js`    canvas UI (4:3 cells), price feed, bets, game feel (particles, synthesized sound, streaks)
- `progress.js`  XP, levels, achievements, daily mission and streak, cosmetic themes (localStorage)
- `engine.test.js`  `node --test engine.test.js` (includes a ~45 s simulation check that expected return ≈ 92%)

Run: `python3 -m http.server 8137`, then open http://localhost:8137

Next (phase 2): server-side resolution, Pyth oracle, Solana program + vault, session keys. Needs legal review and an audit before real money.
