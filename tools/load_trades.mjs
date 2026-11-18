// Loads trades written by fetch_trades.py as two flat number arrays (cheap on memory) or, for old files, as [[t, p], ...].
import { readFileSync } from 'node:fs';
export function loadTrades(path, from = 0, to = 1) {
  const raw = JSON.parse(readFileSync(path, 'utf8')); let t, p;
  if (Array.isArray(raw)) { t = Float64Array.from(raw, (r) => r[0]); p = Float64Array.from(raw, (r) => r[1]); }
  else { t = Float64Array.from(raw.t); p = Float64Array.from(raw.p); }
  const a = Math.floor(t.length * from), b = Math.floor(t.length * to);
  return { n: b - a, t: t.subarray(a, b), p: p.subarray(a, b) };   // ascending in time
}
