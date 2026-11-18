# Odds: house edge, probabilities and how they were validated

## What the player gets
For every cell the game shows a multiplier `m = (1 - edge) / p`, where `p` is the probability that the price touches that cell
during its 5 s column. If `p` is right, every cell returns `1 - edge` on average, whatever you tap. The house edge is a setting:

| Difficulty | House edge | Expected return |
|---|---|---|
| Relajado | 2 % | 98 % |
| **Normal (default)** | **4 %** | **96 %** |
| Realista | 8 % | 92 % |

It is an average over many bets. A short session can end far above or below it.

## What was wrong before (measured, not assumed)
The nominal edge was 8 %, but the *probability model* was off. Replaying the old engine over **11.7 h of real SOL trades (73,624 virtual bets)**:

| | model said | reality |
|---|---|---|
| average return to the player | 90.6 % | **86.0 %** (95 % interval 81.4 - 91.4) |
| cells paying < 8x (what most people tap) | ~92 % | **72 - 79 %** |
| cells paying 20x+ | 92 % / 75 % | 119 - 134 % |
| hit rate | 18.9 % | 15.5 % |

1. **Near cells were over-priced in probability** (model p was 11 - 26 % too high between 6 % and 70 %), independent of how far ahead the column
   was. Real trades are stickier around the price and wilder far from it than the smooth random walk the Monte Carlo assumes.
2. **The 50x cap leaked return.** Any cell with p below 1.84 % was capped at 50x, so it returned `50 * p` (67 - 82 % on 5 - 8 % of the cells).
   Now `MIN_P` guarantees the cap never binds (tested).

## The fix
- `calibration.js`: per-asset tables (model p -> frequency observed in real trades), piecewise linear in logit space, monotone.
  Fitted on 99 h of SOL, 56 h of ETH and 35 h of BTC trades from Coinbase.
- `computeBoard({ edge, cal })` applies the table before pricing, so multipliers and the `p` used for gifts are calibrated.
- `MAX_MULT` 100, `MIN_P` 1.01 % (the cap never binds). Tables are learned including cells down to 0.2 % so the far tail is not extrapolated.
- Long-shot margin: extra house edge of up to 4 % on cells below ~5 % probability (0 at 5 %, full at 1.5 %).

## Validation (data NOT used to fit; target return 96 %)
Fit on the first 70 % of each series, tested on the last 30 % (random virtual $1 bets resolved with the game's own `stepBet`):

| Asset | held-out hours | total | <2x | 2-3.5x | 3.5-8x | 8-20x | 20x+ |
|---|---|---|---|---|---|---|---|
| SOL | 29.8 | 97.4 % | 92.9 | 91.2 | 95.3 | 95.3 | 108.2 |
| ETH | 16.8 | 97.4 % | 95.5 | 94.6 | 97.5 | 100.0 | 97.2 |
| BTC | 10.6 | **89.0 %** | 96.2 | 95.3 | 90.7 | 84.4 | 87.3 |

Same data with the **old** engine: near cells (<8x) returned 66 - 84 %. The shipped tables are fitted on all the data, so re-running on
the same period is no longer a fair test.

## Limits (read these)
- Calibrated on 1 - 4 days of history. Volatility regimes change; BTC drifted the most (held-out 89 % vs 96 % target).
  Re-run the tools below when behaviour changes, or if a month of play shows a different return.
- It is a model of Coinbase's trade feed as the game sees it (a touch counts on the straight segment between consecutive trades).
- Random virtual bets; a real player is not random, and any systematic skill (or timing around feed gaps) would shift the result.
- This is a practice game. If real money is ever involved, edge, calibration and disclosure are legal/product decisions, and the practice
  mode should not be easier than the real one.

## Reproduce
```
python3 tools/fetch_trades.py SOL-USD 800 sol.json 0.3          # ~1000 trades per page, newest first
SYMBOL=sol CAL=0 FROM=0 TO=0.7 SAMPLES=a.json node tools/replay.mjs sol.json
SYMBOL=sol CAL=0 FROM=0.7 TO=1 SAMPLES=b.json node tools/replay.mjs sol.json
python3 tools/calibrate.py 0.04 sol=a.json:b.json               # prints knots + held-out return by bucket
SYMBOL=sol CAL=1 EDGE=0.04 FROM=0.7 node tools/replay.mjs sol.json   # end-to-end with the shipped tables
```

## Do the indicators give players an edge? (measured)
`tools/strategies.mjs` plays 14 strategies on the same boards over real trades (99 h SOL, 56 h ETH, 35 h BTC; edge 4 %, target return 96 %;
95 % intervals from 30-minute blocks): trend following with EMA9/SMA21, RSI following and fading, 5-second momentum and fade, volatility
filters, and bucket-only strategies.

| Strategy (return, 95 % CI) | built-in tables, before | with the tuner running (walk-forward) |
|---|---|---|
| BTC trend following (EMA9 > SMA21) | **110.4 %** (103-118) | 89.5 % (81-96) |
| BTC RSI following | **110.3 %** (102-119) | 92.3 % (82-104) |
| BTC 5 s momentum | **113.0 %** (106-118) | 91.2 % (85-96) |
| SOL trend following | 99.2 % (96-103) | 101.0 % (97-104) |
| SOL / ETH RSI following | 102 / 105 % (96-109 / 98-113) | 102 / 107 % (95-111 / 97-117) |
| betting only 20x+ cells, SOL | **106.3 %** (101-112) | 104.5 % (98-111) |

So: on BTC, momentum is real (the price tends to keep going for a few seconds) and the first tables let indicator users win. The tuner removes it.
On SOL and ETH no indicator strategy was significantly profitable. The 20x+ leak was a calibration problem, not an indicator problem.

## The tuner
`tools/tuner.mjs` learns, from recent real trades, per asset: calibration knots and context factors (direction of the last 5 s x recent
volatility x probability band, see `context.js`). `tools/run_tuner.sh [hours=48] [out]` runs the whole cycle: download trades (incremental when `CACHE_DIR` is kept) -> simulate virtual bets
with the game's engine -> fit -> validate on the newest 25 % of the window -> publish `odds.json` only if the guard passes.

Guard (confidence-interval based, because a short holdout is noisy): refuse if the window has fewer than 20,000 samples, if overall return is
clearly above target, or if "with momentum", "against momentum", "20x+", "hot volatility far cells" or "calm near cells" show a player advantage
(lower CI bound above 100 %). It warns when the house keeps far more than promised.

The game loads `odds.json` every 10 minutes, validates it (`odds.js`: monotone knots, ratios 0.4-10x, factors 0.5-2x) and falls back to the built-in
tables on anything odd. Suggested cadence: every 6 hours on the previous 18-24 hours (that is what the walk-forward results above simulate).
On a VPS use `deploy/` (systemd timer every 6 h, incremental download, publishes to the `odds-data` branch that the game reads): see `deploy/DEPLOY.md`.

Walk-forward result of that cadence (fit on 18 h, test on the next 6 h; target 96 %): ETH 98.7 % overall (near cells 94-95 %), BTC 92.9-94.7 %.
Without retuning BTC returned 110.9 %.

## Known residual risks
- Volatility spikes: betting far cells only while the last 15 s are unusually wild returned 110-125 % on all three assets in the walk-forward
  run, with few bets (362-4,597) and wide intervals. Not closed. SOL/ETH get more far-cell hits in hot volatility, BTC fewer.
- BTC shifts regime fastest. A single fit drifted to 80-85 % on newer data; only the rolling tuner kept it near target.
- The shipped `odds.json` is a snapshot (see `data_until`) and ages; without the tuner running it is only as good as that window.
- Everything is priced in the browser. Anyone can edit their own client and change multipliers. That is fine for a practice game. With real money
  pricing, settlement and balances must live on a server, with this tuner feeding it, and the odds/edge become legal and product decisions.

## How often to retune (measured)
`tools/cadence.mjs` replays a running tuner: at each refit time the tables are re-fitted on the previous 24 h and judged only on bets placed afterwards.
`gap` = realised minus intended return in percentage points, weighted over multiplier buckets (0 = perfectly priced; it has a noise floor of a
few points because the bets of one market stretch are correlated). SOL 95 h judged, ETH 52 h, BTC 32 h.

| Policy | SOL gap (retunes/day) | ETH gap | BTC gap |
|---|---|---|---|
| never (fit once) | 13.3 (0.3) | 10.4 (0.5) | 7.9 (0.8) |
| every 6 h | **4.4** (4.0) | **4.3** (4.1) | **2.6** (4.6) |
| every 12 h | 5.1 (2.0) | 4.7 (2.3) | 3.3 (2.3) |
| every 24 h | 5.8 (1.0) | 5.9 (1.4) | 5.7 (1.5) |
| every 48 h | 10.5 (0.5) | 9.6 (0.9) | 7.9 (0.8) |
| ATR(100 x 1 min) trigger, abs(ln ratio) > 0.40 | 5.0 (3.3) | 4.4 (4.6) | 2.8 (4.6) |
| monitor: recent gap > 8 pp | 4.5 (9.8) | 3.5 (9.2) | 1.9 (9.9) |

- Every 12 h costs under 1 point versus every 6 h on SOL/ETH. BTC needs 6 h: 24 h already costs 3 points. 48 h or "once" is clearly worse everywhere.
- An ATR regime trigger did **not** beat a plain calendar: at the same number of retunes it gives the same gap. The performance monitor gets a
  slightly lower gap on ETH/BTC but triggers 3x as often, because three hours of bets are a noisy sample.
- A cycle is cheap (incremental download plus about a minute of CPU per asset), so the default stays at every 6 h for all assets.
  If you must cut work, run SOL/ETH every 12 h and BTC every 6 h.
- Limits: BTC was judged on only 32 h; the thresholds tried (0.15-0.40 for ATR, 6-10 pp for the monitor) were not tuned further.
