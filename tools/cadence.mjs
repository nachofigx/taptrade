// How often must the odds be retuned, and can an ATR regime trigger replace a fixed schedule?
//   node tools/cadence.mjs ASSET samples.json trades.json [--train 24]
// Policies re-fit the tables on the previous `train` hours at each refit time and are judged only on bets placed AFTER that time,
// until the next refit. gap = realised - intended return (percentage points), weighted over multiplier buckets: 0 means perfectly priced.
import { readFileSync } from 'node:fs';
import { loadTrades } from './load_trades.mjs';
import { fitKnots, fitContext } from './tuner.mjs';
import { calibrate } from '../calibration.js';
import { adjustP } from '../context.js';
import { priceMult, MIN_P, MIN_MULT } from '../engine.js';

const [asset, samplesPath, tradesPath, ...rest] = process.argv.slice(2), TRAIN = +(rest[rest.indexOf('--train') + 1] || 24), EDGE = 0.04, H = 3600;
const rows = JSON.parse(readFileSync(samplesPath, 'utf8')).sort((a, b) => a[3] - b[3]), ts = rows.map((r) => r[3]);
const lowerBound = (t) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; } return lo; };

// ATR(100) of 1-minute bars, as a fraction of price, indexed by minute.
const TR = loadTrades(tradesPath), minutes = [], atrPct = []; { let cur = -1, h = 0, l = 0, c = 0, pc = null; const trs = [];
  for (let i = 0; i < TR.n; i++) { const m = Math.floor(TR.t[i] / 60), p = TR.p[i];
    if (m !== cur) { if (cur >= 0) { const tr = pc == null ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); trs.push(tr); if (trs.length > 100) trs.shift(); pc = c; if (trs.length === 100) { minutes.push(cur); atrPct.push(trs.reduce((a, x) => a + x, 0) / 100 / c); } } cur = m; h = l = c = p; }
    else { h = Math.max(h, p); l = Math.min(l, p); c = p; } } }
const atrAt = (t) => { const m = Math.floor(t / 60); let lo = 0, hi = minutes.length - 1, ans = -1; while (lo <= hi) { const k = (lo + hi) >> 1; if (minutes[k] <= m) { ans = k; lo = k + 1; } else hi = k - 1; } return ans < 0 ? null : atrPct[ans]; };

const B = [[0, 2], [2, 3.5], [3.5, 8], [8, 20], [20, 1e9]];
function fitAt(T) { const a = lowerBound(T - TRAIN * H), b = lowerBound(T); if (b - a < 3000) return null; const tr = rows.slice(a, b), knots = fitKnots(tr); return { knots, adj: { f: fitContext(tr, knots) } }; }
// Sequential simulation: every 15 minutes decide whether to refit (policy), then price the bets of the next 15 minutes with the current tables.
const price = (r, t) => { let p = calibrate(r[0], t.knots); p = adjustP(p, { adj: t.adj, mz: r[6], vr: r[7], dir: r[5] }); if (p < MIN_P) return null; const m = priceMult(p, EDGE); return m < MIN_MULT ? null : { m, p }; };
const bucket = (m) => B.findIndex(([lo, hi]) => m >= lo && m < hi);
function gapOver(a, b, t) { const acc = B.map(() => ({ n: 0, pay: 0, want: 0 })); for (let k = a; k < b; k++) { const r = rows[k], q = price(r, t); if (!q) continue; const x = acc[bucket(q.m)]; x.n++; x.want += q.m * q.p; if (r[1]) x.pay += q.m; } const n = acc.reduce((s, x) => s + x.n, 0); return { acc, n, gap: n ? acc.reduce((s, x) => s + Math.abs(x.pay - x.want), 0) / n * 100 : 0 }; }
function simulate(kind, arg, T0, T1) {
  const total = B.map(() => ({ n: 0, pay: 0, want: 0 })); let tables = fitAt(T0), last = T0, ref = atrAt(T0), refits = tables ? 1 : 0, triggers = 0;
  for (let T = T0; T < T1; T += 900) {
    const age = T - last; let go = false;
    if (kind === 'fixed') go = age >= arg * H;
    else if (kind === 'atr') { const a = atrAt(T); go = a != null && ref != null && age >= 2 * H && (Math.abs(Math.log(a / ref)) > arg || age >= 24 * H); }
    else if (kind === 'perf' && age >= 2 * H && tables) {                          // monitor the bets already settled in the last 3 h against what was promised
      const a = lowerBound(T - 3 * H), b = lowerBound(T - 120), g = gapOver(a, b, tables); go = g.n >= 1500 && g.gap > arg || age >= 24 * H; }
    if (go) { const nt = fitAt(T); if (nt) { tables = nt; refits++; last = T; ref = atrAt(T); } }
    if (!tables) continue;
    const a = lowerBound(T), b = lowerBound(T + 900), g = gapOver(a, b, tables); g.acc.forEach((x, i) => { total[i].n += x.n; total[i].pay += x.pay; total[i].want += x.want; });
  }
  const n = total.reduce((s, x) => s + x.n, 0);
  return { ret: total.reduce((s, x) => s + x.pay, 0) / n * 100, gap: total.reduce((s, x) => s + Math.abs(x.pay - x.want), 0) / n * 100, worst: Math.max(...total.filter((x) => x.n > 300).map((x) => Math.abs(x.pay - x.want) / x.n * 100)), refits };
}
const T0 = ts[0] + TRAIN * H, T1 = ts[ts.length - 1], days = (T1 - T0) / 86400;
console.log(`\n${asset.toUpperCase()}: judged over ${(days * 24).toFixed(0)} h after the first ${TRAIN} h training window; ATR(100) = 100 one-minute bars`);
console.log('policy'.padEnd(34), 'retunes/day', 'return', ' gap(pp)', ' worst bucket(pp)');
const P = [['never (fit once)', 'fixed', 1e9], ['every 6 h', 'fixed', 6], ['every 12 h', 'fixed', 12], ['every 24 h', 'fixed', 24], ['every 48 h', 'fixed', 48], ['ATR trigger  |ln ratio| > 0.25', 'atr', 0.25], ['ATR trigger  |ln ratio| > 0.40', 'atr', 0.40], ['monitor: recent gap > 6 pp', 'perf', 6], ['monitor: recent gap > 8 pp', 'perf', 8], ['monitor: recent gap > 10 pp', 'perf', 10]];
for (const [name, kind, arg] of P) { const r = simulate(kind, arg, T0, T1); console.log(name.padEnd(34), (r.refits / days).toFixed(1).padStart(11), (r.ret.toFixed(1) + '%').padStart(7), r.gap.toFixed(1).padStart(8), r.worst.toFixed(1).padStart(12)); }
