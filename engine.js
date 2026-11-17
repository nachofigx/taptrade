// Tapline engine: pricing (Monte Carlo touch probabilities) + bet resolution.
// Pure functions, no DOM, so it can be tested in Node.
import { calibrate } from './calibration.js';
import { adjustP } from './context.js';

export const SLOT = 5;        // seconds per grid column
export const LOCK = 3;        // betting closes this many seconds before a column starts
export const EDGE = 0.04;     // default house edge: the player's expected return is 1 - EDGE. computeBoard takes `edge` (see DIFFICULTY)
export const MIN_P = 0.0101;  // cells less likely than this (after calibration) are not offered
export const MAX_MULT = 100;  // (1 - edge) / MIN_P < MAX_MULT for every edge >= 0, so the cap never lowers the return
export const MIN_MULT = 1.02; // below this the cell is shown but disabled (almost certain to hit)
// Difficulty = house edge: the share of every stake the house keeps on average, once probabilities are calibrated to real prices.
export const DIFFICULTY = { relaxed: { edge: 0.02, name: 'Relajado' }, normal: { edge: 0.04, name: 'Normal' }, real: { edge: 0.08, name: 'Realista' } };
// Long shots carry an extra margin: rare jumps are the hardest thing to price, and backtests showed that betting only on cells under ~5%
// could beat the house by a few points even after calibration. Extra edge = LONGSHOT_EDGE at p <= 1.5%, fading to 0 at p >= 5%.
export const LONGSHOT_EDGE = 0.04;
export const longshotEdge = (p) => (p >= 0.05 ? 0 : LONGSHOT_EDGE * Math.min(1, (0.05 - p) / 0.035));
export function priceMult(p, edge) { return Math.min(MAX_MULT, Math.floor(((1 - edge - longshotEdge(p)) / p) * 100) / 100); }
export const PATHS = 2500;
export const STEPS = 240;     // horizon = STEPS * DT = 120 seconds
export const DT = 0.5;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pre-generated standardized random walks (antithetic pairs), reused every recompute
// so multipliers change smoothly instead of flickering.
let WALK = null;
function walks() {
  if (WALK) return WALK;
  const rnd = mulberry32(12345);
  const sq = Math.sqrt(DT);
  const w = new Float32Array(PATHS * (STEPS + 1));
  for (let p = 0; p < PATHS; p += 2) {
    let acc = 0;
    const o = p * (STEPS + 1), o2 = o + STEPS + 1;
    for (let i = 1; i <= STEPS; i++) {
      const z = Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
      acc += z * sq;
      w[o + i] = acc;
      w[o2 + i] = -acc;
    }
  }
  return (WALK = w);
}

// EWMA estimate of volatility, per sqrt(second), in log-return terms.
export class Vol {
  constructor(init = 0.00015) { this.v = init * init; this.lastT = null; this.lastP = null; this.n = 0; }
  add(t, p) {
    if (this.lastT === null) { this.lastT = t; this.lastP = p; return; }
    const dt = t - this.lastT;
    if (dt < 1) return;
    const r = Math.log(p / this.lastP);
    this.n++;
    const a = Math.max(1 - Math.exp(-dt / 30), 1 / (this.n + 1)); // learn fast at first, then EWMA
    this.v = (1 - a) * this.v + a * (r * r) / dt;
    this.lastT = t; this.lastP = p;
  }
  get sigma() { return Math.max(Math.sqrt(this.v), 0.00005); }
}

// Row r covers prices [r*band, (r+1)*band). Slot k covers epoch seconds [k*SLOT, (k+1)*SLOT).
// Returns Map "k:r" -> { m: multiplier, p: win probability } for offered cells.
// `adj` + `ctx` = optional context factors (see context.js): the tuner learns them so that following momentum or the volatility
// does not beat the house. `minP` is for calibration runs only (the game always uses MIN_P).
// `cal` = optional calibration knots [[modelP, realisedP], ...] (see calibration.js) that correct the model's probabilities with real data.
export function computeBoard({ S, sigma, now, slotFrom, slotTo, rowFrom, rowTo, band, dt = DT, slot = SLOT, edge = EDGE, cal = null, adj = null, ctx = null, minP = MIN_P }) {
  const w = walks();
  const out = new Map();
  const counts = new Int32Array(rowTo - rowFrom + 1);
  // Broadie-Glasserman continuity correction for discrete monitoring.
  const bgc = 0.5826 * Math.sqrt(dt), cr = Math.floor(S / band);
  for (let k = slotFrom; k <= slotTo; k++) {
    const start = k * slot, end = start + slot;
    let a = Math.ceil((start - now) / dt), b = Math.floor((end - now) / dt);
    if (a < 0) a = 0;
    if (b > STEPS) b = STEPS;
    if (a > b) continue;
    counts.fill(0);
    for (let p = 0; p < PATHS; p++) {
      const o = p * (STEPS + 1);
      let mn = Infinity, mx = -Infinity;
      for (let i = a; i <= b; i++) { const x = w[o + i]; if (x < mn) mn = x; if (x > mx) mx = x; }
      let r0 = Math.floor((S * Math.exp(sigma * (mn - bgc))) / band);
      let r1 = Math.floor((S * Math.exp(sigma * (mx + bgc))) / band);
      if (r0 < rowFrom) r0 = rowFrom;
      if (r1 > rowTo) r1 = rowTo;
      for (let r = r0; r <= r1; r++) counts[r - rowFrom]++;
    }
    for (let r = rowFrom; r <= rowTo; r++) {
      let P = cal ? calibrate(counts[r - rowFrom] / PATHS, cal) : counts[r - rowFrom] / PATHS;
      if (adj && ctx) P = adjustP(P, { adj, mz: ctx.mz, vr: ctx.vr, dir: Math.sign(r - cr) });   // price what the player can see: direction and recent volatility
      if (P < minP) continue;
      const m = priceMult(P, edge);
      // Too likely to pay a meaningful multiplier: keep the cell on the board but not tappable.
      out.set(k + ':' + r, m < MIN_MULT ? { m: 0, p: P, off: true } : { m, p: P });
    }
  }
  return out;
}

// prev/cur are ticks {t, p}. Returns 'won' | 'lost' | 'open'.
export function stepBet(bet, prev, cur) {
  if (bet.status !== 'open') return bet.status;
  const lo = Math.min(prev.p, cur.p), hi = Math.max(prev.p, cur.p);
  if (cur.t >= bet.start && prev.t <= bet.end && hi >= bet.lo && lo < bet.hi) return 'won';
  if (cur.t > bet.end) return 'lost';
  return 'open';
}

const NICE = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
export function niceBand(price) {
  const target = price * 0.0005;
  return NICE.find((x) => x >= target) ?? NICE[NICE.length - 1];
}
