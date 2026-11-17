// Replays the game's pricing engine over REAL historical trades and measures what a player betting on random cells would get back.
//   node tools/replay.mjs trades.json [env: SYMBOL=sol EDGE=0.04 CAL=1 FROM=0 TO=1 STEP=6 SAMPLES=out.json]
// Virtual $1 bets are placed on random offered cells and resolved with the game's own stepBet, so this tests the shipped code path.
import { readFileSync, writeFileSync } from 'node:fs';
import { computeBoard, stepBet, Vol, SLOT, LOCK, STEPS, DT, EDGE } from '../engine.js';
import { knotsFor } from '../calibration.js';
import { pushTick } from '../indicators.js';
import { marketContext } from '../context.js';

const SYMBOL = process.env.SYMBOL || 'sol', EDGE_USE = +(process.env.EDGE || EDGE), USE_CAL = process.env.CAL === '1', STEP = +(process.env.STEP || 6);
const FROM = +(process.env.FROM || 0), TO = +(process.env.TO || 1), PER_STEP = 6, WARM = 90;
let ticks = JSON.parse(readFileSync(process.argv[2], 'utf8')).map(([t, p]) => ({ t, p }));
ticks = ticks.slice(Math.floor(ticks.length * FROM), Math.floor(ticks.length * TO));
// ODDS=odds.json applies a tuner file (knots + context factors) instead of the built-in tables. MINP lowers the offer threshold (training only).
const MINP = +(process.env.MINP || 0.0101); let cal = USE_CAL ? knotsFor(SYMBOL) : null, adj = null;
if (process.env.ODDS) { const o = JSON.parse(readFileSync(process.env.ODDS, 'utf8')).assets?.[SYMBOL]; if (o) { cal = o.knots; adj = o.ctx || null; } }

const NICE = [1, 2, 5, 10];
function pickBand(S, sigma, H = 800, TOP = 68, RH = 44) {   // same rule as the game: ~80% of the screen covered by reachable cells
  const reach = 2.4 * sigma * S * Math.sqrt(60), rows = Math.max(8, (H - TOP) / RH) * 0.8, target = Math.max((2 * reach) / rows, S * 1e-6);
  const e = Math.floor(Math.log10(target)); let best = 1, bd = Infinity;
  for (const c of NICE) { const d = Math.abs(Math.log((c * 10 ** e) / target)); if (d < bd) { bd = d; best = c * 10 ** e; } }
  return best;
}
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const bars = [], vol = new Vol(); let idx = 0, last = null, band = null, bandAt = -1e9;
const open = [], done = [], t0 = ticks[0].t + WARM, tEnd = ticks[ticks.length - 1].t - 120;
const resolve = (a, b) => { for (let i = open.length - 1; i >= 0; i--) { const s = stepBet(open[i], a, b); if (s !== 'open') { open[i].status = s; done.push(open[i]); open.splice(i, 1); } } };
const feedUntil = (t) => { while (idx < ticks.length && ticks[idx].t <= t) { const cur = ticks[idx++], prev = last || cur; last = cur; vol.add(cur.t, cur.p); pushTick(bars, cur.t, cur.p, 1, 400); resolve(prev, cur); } };
for (let t = t0 - WARM; t < t0; t += 1) feedUntil(t);
for (let t = t0; t < tEnd; t += STEP) {
  feedUntil(t); resolve(last, { t, p: last.p }); pushTick(bars, t, last.p, 1, 400);
  if (t - bandAt > 60) { const nb = pickBand(last.p, vol.sigma); if (!band || nb / band > 1.6 || nb / band < 0.62) band = nb; bandAt = t; }
  const cr = Math.floor(last.p / band), k0 = Math.ceil((t + LOCK) / SLOT), ctx = marketContext(bars.map((b) => b.c), vol.sigma);
  const board = computeBoard({ S: last.p, sigma: vol.sigma, now: t, slotFrom: k0, slotTo: Math.floor((t + STEPS * DT) / SLOT) - 1, rowFrom: cr - 14, rowTo: cr + 14, band, edge: EDGE_USE, cal, adj, ctx, minP: MINP });
  const cells = [...board].filter(([key, c]) => !c.off && +key.split(':')[0] <= k0 + 11);
  for (let n = 0; n < PER_STEP && cells.length; n++) {
    const [key, c] = cells[Math.floor(rnd() * cells.length)], [k, r] = key.split(':').map(Number);
    if (open.some((b) => b.k === k && b.r === r)) continue;
    open.push({ k, r, start: k * SLOT, end: (k + 1) * SLOT, lo: r * band, hi: (r + 1) * band, mult: c.m, p: c.p, status: 'open', t, dir: Math.sign(r - cr), mz: ctx.mz, vr: ctx.vr });
  }
}
feedUntil(tEnd + 100); resolve(last, { t: tEnd + 100, p: last.p });

if (process.env.SAMPLES) { writeFileSync(process.env.SAMPLES, JSON.stringify(done.map((b) => [+b.p.toFixed(5), b.status === 'won' ? 1 : 0, b.mult, Math.round(b.t), +(b.start - b.t).toFixed(1), b.dir, +b.mz.toFixed(3), +b.vr.toFixed(3)]))); console.log('saved', done.length, 'samples'); process.exit(0); }
const pct = (x) => (x * 100).toFixed(1).padStart(6) + '%';
const row = (name, xs) => { if (!xs.length) return name.padEnd(8) + ' n=0'; const w = xs.filter((b) => b.status === 'won'); return `${name.padEnd(8)} n=${String(xs.length).padStart(6)}  hit ${pct(w.length / xs.length)}  return ${pct(w.reduce((s, b) => s + b.mult, 0) / xs.length)}`; };
console.log(`${SYMBOL}  edge ${EDGE_USE * 100}%  calibration ${cal ? 'on' : 'off'}  target return ${((1 - EDGE_USE) * 100).toFixed(0)}%  | ${((tEnd - t0) / 3600).toFixed(1)} h, ${done.length} bets`);
console.log(row('ALL', done));
for (const [n, lo, hi] of [['<2x', 0, 2], ['2-3.5x', 2, 3.5], ['3.5-8x', 3.5, 8], ['8-20x', 8, 20], ['20x+', 20, 1e9]]) console.log(row(n, done.filter((b) => b.mult >= lo && b.mult < hi)));
