// Tapline engine: pricing (Monte Carlo touch probabilities) + bet resolution.
// Pure functions, no DOM, so it can be tested in Node.

export const SLOT = 5;        // seconds per grid column
export const LOCK = 3;        // betting closes this many seconds before a column starts
export const EDGE = 0.08;     // house edge (expected return for the player is 1 - EDGE)
export const MIN_P = 0.012;   // cells less likely than this are not offered
export const MAX_MULT = 50;
export const MIN_MULT = 1.1;
export const PATHS = 2500;
export const STEPS = 150;     // horizon = STEPS * DT seconds
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
  constructor(init = 0.00015) { this.v = init * init; this.lastT = null; this.lastP = null; }
  add(t, p) {
    if (this.lastT === null) { this.lastT = t; this.lastP = p; return; }
    const dt = t - this.lastT;
    if (dt < 1) return;
    const r = Math.log(p / this.lastP);
    const a = 1 - Math.exp(-dt / 30);
    this.v = (1 - a) * this.v + a * (r * r) / dt;
    this.lastT = t; this.lastP = p;
  }
  get sigma() { return Math.max(Math.sqrt(this.v), 0.00005); }
}

// Row r covers prices [r*band, (r+1)*band). Slot k covers epoch seconds [k*SLOT, (k+1)*SLOT).
// Returns Map "k:r" -> { m: multiplier, p: win probability } for offered cells.
export function computeBoard({ S, sigma, now, slotFrom, slotTo, rowFrom, rowTo, band, dt = DT }) {
  const w = walks();
  const out = new Map();
  const counts = new Int32Array(rowTo - rowFrom + 1);
  // Broadie-Glasserman continuity correction for discrete monitoring.
  const bgc = 0.5826 * Math.sqrt(dt);
  for (let k = slotFrom; k <= slotTo; k++) {
    const start = k * SLOT, end = start + SLOT;
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
      const P = counts[r - rowFrom] / PATHS;
      if (P < MIN_P) continue;
      const m = Math.min(MAX_MULT, Math.floor(((1 - EDGE) / P) * 100) / 100);
      if (m < MIN_MULT) continue;
      out.set(k + ':' + r, { m, p: P });
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
