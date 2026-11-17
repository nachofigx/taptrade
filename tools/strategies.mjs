// Can a player beat the house with the indicators we ship? Paired backtest on real trades: every strategy sees the same board each step.
//   node tools/strategies.mjs trades.json [env: SYMBOL=sol EDGE=0.04 STEP=8 FROM=0 TO=1]
import { readFileSync } from 'node:fs';
import { computeBoard, stepBet, Vol, SLOT, LOCK, STEPS, DT, EDGE } from '../engine.js';
import { knotsFor } from '../calibration.js';
import { ema, sma, rsi, pushTick } from '../indicators.js';
import { marketContext } from '../context.js';

const SYMBOL = process.env.SYMBOL || 'sol', EDGE_USE = +(process.env.EDGE || EDGE), STEP = +(process.env.STEP || 8), FROM = +(process.env.FROM || 0), TO = +(process.env.TO || 1), PER_STEP = 6, WARM = 120;
let ticks = JSON.parse(readFileSync(process.argv[2], 'utf8')).map(([t, p]) => ({ t, p })); ticks = ticks.slice(Math.floor(ticks.length * FROM), Math.floor(ticks.length * TO));
// SCHEDULE=sched.json (from `tuner.mjs schedule`) swaps the odds over time like a running tuner would; otherwise the built-in tables are used.
const SCHED = process.env.SCHEDULE ? JSON.parse(readFileSync(process.env.SCHEDULE, 'utf8')).folds : null, builtIn = knotsFor(SYMBOL), NICE = [1, 2, 5, 10];
const oddsAt = (t) => { const f = SCHED && SCHED.find((x) => t >= x.from && t < x.to); return f ? { cal: f.knots, adj: f.ctx } : { cal: builtIn, adj: null }; };
function pickBand(S, sigma) { const reach = 2.4 * sigma * S * Math.sqrt(60), rows = Math.max(8, 732 / 44) * 0.8, target = Math.max((2 * reach) / rows, S * 1e-6), e = Math.floor(Math.log10(target)); let best = 1, bd = Infinity; for (const c of NICE) { const d = Math.abs(Math.log((c * 10 ** e) / target)); if (d < bd) { bd = d; best = c * 10 ** e; } } return best; }
let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// strategies: given the signal state and a cell, return true to bet. `dir` = +1 above price, -1 below, 0 same row.
const S = {
  random:        () => true,
  trend_follow:  (s, c) => s.trend !== 0 && c.dir === s.trend,
  trend_fade:    (s, c) => s.trend !== 0 && c.dir === -s.trend,
  rsi_revert:    (s, c) => s.rsi != null && ((s.rsi < 30 && c.dir > 0) || (s.rsi > 70 && c.dir < 0)),
  rsi_follow:    (s, c) => s.rsi != null && ((s.rsi > 70 && c.dir > 0) || (s.rsi < 30 && c.dir < 0)),
  momentum_5s:   (s, c) => s.mom !== 0 && c.dir === s.mom,
  fade_5s:       (s, c) => s.mom !== 0 && c.dir === -s.mom,
  vol_spike_far: (s, c) => s.vr > 1.6 && c.p < 0.12,
  vol_calm_near: (s, c) => s.vr < 0.6 && c.p > 0.25,
  'only_<2x': (s, c) => c.m < 2, 'only_2-3.5x': (s, c) => c.m >= 2 && c.m < 3.5, 'only_3.5-8x': (s, c) => c.m >= 3.5 && c.m < 8, 'only_8-20x': (s, c) => c.m >= 8 && c.m < 20, 'only_20x+': (s, c) => c.m >= 20,
};
const names = Object.keys(S), book = Object.fromEntries(names.map((n) => [n, { open: [], done: [] }]));
const vol = new Vol(); let idx = 0, last = null, band = null, bandAt = -1e9; const bars = [], t0 = ticks[0].t + WARM, tEnd = ticks[ticks.length - 1].t - 120;
const resolve = (a, b) => { for (const n of names) { const bk = book[n]; for (let i = bk.open.length - 1; i >= 0; i--) { const s = stepBet(bk.open[i], a, b); if (s !== 'open') { bk.open[i].status = s; bk.done.push(bk.open[i]); bk.open.splice(i, 1); } } } };
const feedUntil = (t) => { while (idx < ticks.length && ticks[idx].t <= t) { const cur = ticks[idx++], prev = last || cur; last = cur; vol.add(cur.t, cur.p); pushTick(bars, cur.t, cur.p, 1, 400); resolve(prev, cur); } };
for (let t = t0 - WARM; t < t0; t += 1) feedUntil(t);
for (let t = t0; t < tEnd; t += STEP) {
  feedUntil(t); resolve(last, { t, p: last.p }); pushTick(bars, t, last.p, 1, 400);
  if (t - bandAt > 60) { const nb = pickBand(last.p, vol.sigma); if (!band || nb / band > 1.6 || nb / band < 0.62) band = nb; bandAt = t; }
  const cl = bars.map((b) => b.c), n = cl.length, e9 = ema(cl, 9)[n - 1], s21 = sma(cl, 21)[n - 1], rs = rsi(cl, 14)[n - 1];
  let rv = 0; if (n > 16) { let ss = 0; for (let i = n - 15; i < n; i++) ss += Math.log(cl[i] / cl[i - 1]) ** 2; rv = Math.sqrt(ss / 15); }
  const dm = n > 6 ? cl[n - 1] - cl[n - 6] : 0, sig = { trend: s21 == null ? 0 : e9 > s21 ? 1 : e9 < s21 ? -1 : 0, rsi: rs, mom: dm > 0 ? 1 : dm < 0 ? -1 : 0, vr: vol.sigma > 0 ? rv / vol.sigma : 1 };
  const cr = Math.floor(last.p / band), k0 = Math.ceil((t + LOCK) / SLOT), od = oddsAt(t), mc = marketContext(cl, vol.sigma);
  const board = computeBoard({ S: last.p, sigma: vol.sigma, now: t, slotFrom: k0, slotTo: Math.floor((t + STEPS * DT) / SLOT) - 1, rowFrom: cr - 14, rowTo: cr + 14, band, edge: EDGE_USE, cal: od.cal, adj: od.adj, ctx: mc.ready ? mc : null });
  const cells = [...board].filter(([key, c]) => !c.off && +key.split(':')[0] <= k0 + 11).map(([key, c]) => { const [k, r] = key.split(':').map(Number); return { k, r, m: c.m, p: c.p, dir: Math.sign(r - cr) }; });
  for (const nme of names) { const pool = cells.filter((c) => S[nme](sig, c)); for (let q = 0; q < PER_STEP && pool.length; q++) { const c = pool[Math.floor(rnd() * pool.length)], bk = book[nme]; if (bk.open.some((b) => b.k === c.k && b.r === c.r)) continue; bk.open.push({ k: c.k, r: c.r, start: c.k * SLOT, end: (c.k + 1) * SLOT, lo: c.r * band, hi: (c.r + 1) * band, mult: c.m, p: c.p, status: 'open', t }); } }
}
feedUntil(tEnd + 100); resolve(last, { t: tEnd + 100, p: last.p });
// block bootstrap (30 min blocks) for the return of each strategy
const tFrom = SCHED && SCHED.length ? SCHED[0].from : t0, HB = 1800, nb = Math.floor((tEnd - tFrom) / HB);
if (SCHED) for (const n of names) book[n].done = book[n].done.filter((b) => b.t >= tFrom);
const ret = (xs) => xs.length ? xs.filter((b) => b.status === 'won').reduce((s, b) => s + b.mult, 0) / xs.length : NaN;
console.log(`${SYMBOL}  edge ${EDGE_USE * 100}% (target ${(100 - EDGE_USE * 100).toFixed(0)}%)  ${SCHED ? 'TUNER schedule (refit every ' + (JSON.parse(readFileSync(process.env.SCHEDULE, 'utf8')).test) + ' h on the previous ' + (JSON.parse(readFileSync(process.env.SCHEDULE, 'utf8')).train) + ' h)' : 'built-in tables'}  ${((tEnd - tFrom) / 3600).toFixed(1)} h judged`);
console.log('strategy        bets    return   95% CI (30-min blocks)    verdict');
for (const n of names) {
  const d = book[n].done, per = Array.from({ length: nb }, (_, i) => d.filter((b) => b.t >= tFrom + i * HB && b.t < tFrom + (i + 1) * HB)).filter((x) => x.length);
  const bs = []; for (let r = 0; r < 300; r++) { let w = 0, c = 0; for (let i = 0; i < per.length; i++) { const blk = per[Math.floor(rnd() * per.length)]; c += blk.length; w += blk.filter((b) => b.status === 'won').reduce((s, b) => s + b.mult, 0); } bs.push(w / c); }
  bs.sort((a, b) => a - b); const lo = bs[7], hi = bs[292], r = ret(d), target = 1 - EDGE_USE;
  const verdict = lo > 1 ? 'PLAYER WINS (>100%)' : lo > target + 0.03 ? 'leaks above target' : hi < target - 0.05 ? 'house over-earns' : 'ok';
  console.log(`${n.padEnd(15)} ${String(d.length).padStart(6)}  ${(r * 100).toFixed(1).padStart(6)}%  ${(lo * 100).toFixed(1).padStart(6)} .. ${(hi * 100).toFixed(1).padStart(6)}    ${verdict}`);
}
