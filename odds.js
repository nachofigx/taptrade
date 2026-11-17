// Odds published by the tuner (odds.json), validated before they can touch pricing. Anything out of range is rejected and the
// built-in calibration (calibration.js) is used instead, so a bad or tampered file can never set absurd multipliers.
import { knotsFor } from './calibration.js';

const num = (x) => typeof x === 'number' && Number.isFinite(x);
function cleanKnots(k) {
  if (!Array.isArray(k) || k.length < 4 || k.length > 40) return null;
  let pp = 0, pq = 0;
  for (const row of k) {
    if (!Array.isArray(row) || row.length < 2 || !num(row[0]) || !num(row[1])) return null;
    const [p, q] = row; if (!(p > 0 && p < 1 && q > 0 && q < 1) || p <= pp || q < pq || q / p < 0.4 || q / p > 10) return null;
    pp = p; pq = q;
  }
  return k.map(([p, q]) => [p, q]);
}
function cleanCtx(c) {
  const f = c && c.f; if (!Array.isArray(f) || f.length !== 3) return null;
  for (const a of f) { if (!Array.isArray(a) || a.length !== 3) return null; for (const v of a) { if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => num(x) && x >= 0.5 && x <= 2)) return null; } }
  return { f: f.map((a) => a.map((v) => v.slice())) };
}
// Returns { updated, window_hours, assets: { sol: { knots, ctx } } } or null.
export function validateOdds(doc) {
  if (!doc || typeof doc !== 'object' || !doc.assets || typeof doc.assets !== 'object') return null;
  const assets = {};
  for (const [name, a] of Object.entries(doc.assets)) {
    if (!/^[a-z0-9]{2,8}$/.test(name) || !a) continue;
    const knots = cleanKnots(a.knots); if (!knots) continue;
    assets[name] = { knots, ctx: cleanCtx(a.ctx), samples: num(a.samples) ? a.samples : null };
  }
  return Object.keys(assets).length ? { updated: typeof doc.updated === 'string' ? doc.updated.slice(0, 32) : null, data_until: typeof doc.data_until === 'string' ? doc.data_until.slice(0, 32) : null, window_hours: num(doc.window_hours) ? doc.window_hours : null, assets } : null;
}
// Table for an asset symbol such as 'SOL-USD': tuner file first, then the built-in calibration (no context factors).
export function oddsFor(doc, symbol) {
  const k = String(symbol || '').split('-')[0].toLowerCase(), a = doc && doc.assets[k];
  return a ? { knots: a.knots, adj: a.ctx, source: 'tuner' } : { knots: knotsFor(symbol), adj: null, source: 'built-in' };
}
export async function fetchOdds(url = 'odds.json') {
  try { const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Math.floor(Date.now() / 60000), { cache: 'no-cache' }); return r.ok ? validateOdds(await r.json()) : null; } catch { return null; }
}
