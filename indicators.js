// Basic technical indicators over closing prices. Pure functions, no DOM.

export const DEFAULT_IND = {
  ma1: { on: true, type: 'ema', n: 9 },
  ma2: { on: false, type: 'sma', n: 21 },
  rsi: { on: true, n: 14 },
  bar: 1,            // seconds per bar
  view: 'arcade',    // 'arcade' (compressed + exaggerated) | 'real' (linear time, true price scale)
  span: 120,         // seconds of history shown in 'real' view
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
