// Basic technical indicators over closing prices. Pure functions, no DOM.

export const DEFAULT_IND = {
  ma1: { on: true, type: 'ema', n: 9 },
  ma2: { on: false, type: 'sma', n: 21 },
  rsi: { on: true, n: 14 },
  bar: 1,            // seconds per bar
  view: 'arcade',    // 'arcade' (compressed + exaggerated) | 'real' (linear time, true price scale)
  span: 120,         // seconds of history shown in 'real' view
  smooth: true,      // draw the price curve smoothed (bets still resolve on the exact price)
};

// Simple moving average; null until n closes exist.
export function sma(c, n) {
  const out = new Array(c.length).fill(null); let sum = 0;
  for (let i = 0; i < c.length; i++) { sum += c[i]; if (i >= n) sum -= c[i - n]; if (i >= n - 1) out[i] = sum / n; }
  return out;
}

// Exponential moving average seeded with the first close (shows from bar 0).
export function ema(c, n) {
  const out = new Array(c.length).fill(null), k = 2 / (n + 1);
  for (let i = 0; i < c.length; i++) out[i] = i === 0 ? c[0] : c[i] * k + out[i - 1] * (1 - k);
  return out;
}

// Wilder's RSI; null until n + 1 closes exist. 100 when there were only gains, 50 when completely flat.
export function rsi(c, n) {
  const out = new Array(c.length).fill(null); if (c.length <= n) return out;
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; ag += Math.max(d, 0); al += Math.max(-d, 0); }
  ag /= n; al /= n;
  const val = () => (al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
  out[n] = val();
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n; al = (al * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

// Keep one bar per `step` seconds holding the last price seen in it. bars = [{ t0, c }]
// Seconds with no trade are forward-filled with the previous close, like a real chart does.
export function pushTick(bars, t, p, step, maxBars = 800) {
  const t0 = Math.floor(t / step) * step, last = bars[bars.length - 1];
  if (last && last.t0 === t0) { last.c = p; return bars; }
  if (last && t0 > last.t0 + step) for (let x = Math.max(last.t0 + step, t0 - maxBars * step); x < t0; x += step) bars.push({ t0: x, c: last.c });
  bars.push({ t0, c: p }); while (bars.length > maxBars) bars.shift();
  return bars;
}

// ---------- curve smoothing (display only) ----------
// Resample ascending ticks [{t,p}] onto a uniform grid: time(i) = tStart + i*step.
// Sample-and-hold, except that during the last `ramp` seconds before each tick the value slides linearly to that tick's price,
// so a sparse feed (a price that sits still, then jumps) draws as a slope instead of a staircase.
// Returns { vals, from } where `from` is the first grid index that has data.
export function holdResample(ticks, tStart, step, n, ramp = 0) {
  const vals = new Float64Array(n + 1); if (!ticks.length) return { vals, from: n + 1 };
  let j = 0, from = n + 1;
  for (let i = 0; i <= n; i++) {
    const tg = tStart + i * step; if (tg < ticks[0].t) continue;
    if (from > n) from = i;
    while (j + 1 < ticks.length && ticks[j + 1].t <= tg) j++;
    let v = ticks[j].p;
    if (ramp > 0 && j + 1 < ticks.length) {
      const next = ticks[j + 1], span = Math.min(ramp, next.t - ticks[j].t), dt = next.t - tg;
      if (dt < span) v += (next.p - v) * (1 - dt / span);
    }
    vals[i] = v;
  }
  return { vals, from };
}
// Gaussian smoothing (sigma in samples) of vals[from..]. Zero lag in the interior; the ends use a truncated, renormalised kernel.
export function gaussSmooth(vals, from, sigma) {
  const n = vals.length, R = Math.max(1, Math.ceil(3 * sigma)), w = new Float64Array(2 * R + 1), out = new Float64Array(n);
  for (let k = -R; k <= R; k++) w[k + R] = Math.exp(-(k * k) / (2 * sigma * sigma));
  for (let i = from; i < n; i++) {
    let s = 0, ws = 0;
    for (let k = -R; k <= R; k++) { const idx = i + k; if (idx < from || idx >= n) continue; s += vals[idx] * w[k + R]; ws += w[k + R]; }
    out[i] = s / ws;
  }
  return out;
}
