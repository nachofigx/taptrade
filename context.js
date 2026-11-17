// Market context: the few things a player can read off the screen (recent direction, how wild the last seconds were).
// Shared by the game, the backtests and the tuner so the pricing context means exactly the same everywhere.
// closes = 1-second closes (forward filled), sigma = the engine's volatility estimate per sqrt(second).

// mz: log return of the last 5 s in units of its expected size (z-score). vr: realised vol of the last 15 s relative to sigma.
export function marketContext(closes, sigma) {
  const n = closes.length;
  if (n < 16 || !(sigma > 0)) return { mz: 0, vr: 1, ready: false };
  const mz = Math.log(closes[n - 1] / closes[n - 6]) / (sigma * Math.sqrt(5));
  let ss = 0; for (let i = n - 15; i < n; i++) ss += Math.log(closes[i] / closes[i - 1]) ** 2;
  return { mz, vr: Math.sqrt(ss / 15) / sigma, ready: true };
}
export const momBucket = (mz) => (mz < -0.7 ? -1 : mz > 0.7 ? 1 : 0);          // -1 falling, 0 flat, +1 rising
export const volBucket = (vr) => (vr < 0.7 ? 0 : vr <= 1.2 ? 1 : 2);           // calm, normal, hot (hot = roughly the top 20% of seconds)
// Is the cell in the direction the price has been moving? 0 = against, 1 = neutral (flat market or same row), 2 = with the move.
export const alignIndex = (dir, mb) => (dir === 0 || mb === 0 ? 1 : dir * mb > 0 ? 2 : 0);
export const P_BANDS = [0.04, 0.15, 0.5];                                         // upper edges of the first three probability bands (4 bands)
export const pBand = (p) => (p < P_BANDS[0] ? 0 : p < P_BANDS[1] ? 1 : p < P_BANDS[2] ? 2 : 3);

// adj = { f: [align][vol][band] } multiplicative factors on the (already calibrated) probability.
export function adjustP(p, { adj, mz, vr, dir }) {
  if (!adj || !adj.f) return p;
  const f = adj.f[alignIndex(dir, momBucket(mz))]?.[volBucket(vr)]?.[pBand(p)];
  return f ? Math.min(0.999, p * f) : p;
}
