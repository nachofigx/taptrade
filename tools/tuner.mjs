// Odds tuner. Learns, from real trades, how far the pricing model is from reality and writes odds.json:
//   per asset: calibration knots (model p -> observed p) + context factors (direction of the last 5 s x recent volatility x probability band).
//   node tools/tuner.mjs fit  [--edge 0.04] [--out odds.json] sol=a.json[,more.json] eth=... btc=...
//   node tools/tuner.mjs eval [--edge 0.04] --odds odds.json sol=b.json ...        (held-out report; samples come from tools/replay.mjs)
// Samples: [rawP, hit, mult, t, ahead, dir, mz, vr].
import { readFileSync, writeFileSync } from 'node:fs';
import { calibrate } from '../calibration.js';
import { adjustP, alignIndex, momBucket, volBucket, pBand } from '../context.js';
import { MIN_P, MIN_MULT, priceMult } from '../engine.js';

const EDGES = [0.002, 0.004, 0.006, 0.0085, 0.0101, 0.0125, 0.015, 0.02, 0.03, 0.045, 0.065, 0.09, 0.13, 0.18, 0.25, 0.35, 0.45, 0.55, 0.65, 0.8, 1.0001];
const LAMBDA = +(process.env.LAMBDA || 60), F_MIN = 0.5, F_MAX = 2, MIN_BIN = 150;   // LAMBDA = shrinkage pseudo-count toward factor 1

export function fitKnots(rows) {
  const ks = [];
  for (let i = 0; i + 1 < EDGES.length; i++) { const g = rows.filter((r) => r[0] >= EDGES[i] && r[0] < EDGES[i + 1]); if (g.length < MIN_BIN) continue; ks.push([g.reduce((s, r) => s + r[0], 0) / g.length, g.reduce((s, r) => s + r[1], 0) / g.length, g.length]); }
  for (let i = 0; i < ks.length - 1;) {            // pool adjacent violators: observed probability must not fall as model probability rises
    if (ks[i][1] > ks[i + 1][1]) { const a = ks[i], b = ks[i + 1], n = a[2] + b[2]; ks.splice(i, 2, [(a[0] * a[2] + b[0] * b[2]) / n, (a[1] * a[2] + b[1] * b[2]) / n, n]); i = Math.max(i - 1, 0); } else i++;
  }
  return ks.map((k) => [+k[0].toFixed(5), +k[1].toFixed(5)]);
}
export function fitContext(rows, knots) {          // f[align][vol][band]: shrunk ratio observed / expected, on offered cells
  const H = {}, E = {};
  for (const [p, hit, , , , dir, mz, vr] of rows) {
    const pc = calibrate(p, knots); if (pc < MIN_P) continue;
    const k = alignIndex(dir, momBucket(mz)) * 12 + volBucket(vr) * 4 + pBand(pc); H[k] = (H[k] || 0) + hit; E[k] = (E[k] || 0) + pc;
  }
  return Array.from({ length: 3 }, (_, a) => Array.from({ length: 3 }, (_, v) => Array.from({ length: 4 }, (_, b) => { const k = a * 12 + v * 4 + b; return +Math.min(F_MAX, Math.max(F_MIN, ((H[k] || 0) + LAMBDA) / ((E[k] || 0) + LAMBDA))).toFixed(4); })));
}
// What a player would get on these samples with a given odds table (same pricing as the engine).
export function evaluate(rows, { edge, knots, adj }, filter = () => true) {
  let n = 0, pay = 0; const blocks = new Map();
  for (const [p, hit, , t, , dir, mz, vr] of rows) {
    let pc = knots ? calibrate(p, knots) : p; if (adj) pc = adjustP(pc, { adj, mz, vr, dir }); if (pc < MIN_P) continue;
    const m = priceMult(pc, edge); if (m < MIN_MULT) continue;
    const row = { m, p: pc, dir, mz, vr, mb: momBucket(mz), vb: volBucket(vr) }; if (!filter(row)) continue;
    const b = Math.floor(t / 1800), x = blocks.get(b) || [0, 0]; x[0] += hit ? m : 0; x[1]++; blocks.set(b, x); n++; if (hit) pay += m;
  }
  const bl = [...blocks.values()]; let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const bs = []; for (let r = 0; r < 300 && bl.length; r++) { let w = 0, c = 0; for (let i = 0; i < bl.length; i++) { const x = bl[Math.floor(rnd() * bl.length)]; w += x[0]; c += x[1]; } bs.push(w / c); } bs.sort((a, b) => a - b);
  return { n, pay, blocks: bl, ret: n ? pay / n : NaN, lo: bs[7] ?? NaN, hi: bs[292] ?? NaN };
}
export const SLICES = {
  all: () => true, '<2x': (r) => r.m < 2, '2-3.5x': (r) => r.m >= 2 && r.m < 3.5, '3.5-8x': (r) => r.m >= 3.5 && r.m < 8, '8-20x': (r) => r.m >= 8 && r.m < 20, '20x+': (r) => r.m >= 20,
  'with momentum': (r) => r.dir !== 0 && r.mb !== 0 && r.dir * r.mb > 0, 'against momentum': (r) => r.dir !== 0 && r.mb !== 0 && r.dir * r.mb < 0,
  'hot vol, far cells': (r) => r.vb === 2 && r.p < 0.12, 'calm vol, near cells': (r) => r.vb === 0 && r.p > 0.25,
};
const pct = (x) => (x * 100).toFixed(1).padStart(6);
export function report(name, rows, odds, edge) {
  console.log(`\n${name}  (target ${((1 - edge) * 100).toFixed(0)}%)   slice                   bets   return   95% CI`);
  for (const [s, f] of Object.entries(SLICES)) { const a = evaluate(rows, { edge, knots: odds.knots, adj: odds.ctx }, f); console.log(`  ${s.padEnd(22)} ${String(a.n).padStart(7)}  ${pct(a.ret)}%  ${pct(a.lo)} .. ${pct(a.hi)}`); }
}

// Walk-forward: fit on the previous `train` hours, test on the next `test` hours, repeat. This is how a running tuner would have performed.
export function walkForward(rows, { edge, train, test }) {
  rows = rows.slice().sort((a, b) => a[3] - b[3]); const t0 = rows[0][3], t1 = rows[rows.length - 1][3], H = 3600, variants = ['none', 'knots', 'knots+context'];
  const acc = Object.fromEntries(variants.map((v) => [v, Object.fromEntries(Object.keys(SLICES).map((s) => [s, { n: 0, pay: 0, blocks: [] }]))])); let folds = 0;
  for (let T = t0 + train * H; T + test * H <= t1; T += test * H) {
    const tr = rows.filter((r) => r[3] >= T - train * H && r[3] < T), te = rows.filter((r) => r[3] >= T && r[3] < T + test * H); if (tr.length < 3000 || te.length < 300) continue;
    const knots = fitKnots(tr), odds = { none: {}, knots: { knots }, 'knots+context': { knots, adj: { f: fitContext(tr, knots) } } }; folds++;
    for (const v of variants) for (const [s, f] of Object.entries(SLICES)) { const r = evaluate(te, { edge, knots: odds[v].knots, adj: odds[v].adj }, f), a = acc[v][s]; a.n += r.n; a.pay += r.pay; a.blocks.push(...r.blocks); }
  }
  return { acc, folds };
}
export function reportWalk(name, res, edge) {
  console.log(`\n${name}: ${res.folds} folds   target ${((1 - edge) * 100).toFixed(0)}%      (return, 95% CI)`);
  console.log('  slice                    ' + Object.keys(res.acc).map((v) => v.padEnd(26)).join(''));
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (const s of Object.keys(SLICES)) {
    let line = '  ' + s.padEnd(24);
    for (const v of Object.keys(res.acc)) { const a = res.acc[v][s], bl = a.blocks, bs = []; for (let r = 0; r < 250 && bl.length; r++) { let w = 0, c = 0; for (let i = 0; i < bl.length; i++) { const x = bl[Math.floor(rnd() * bl.length)]; w += x[0]; c += x[1]; } bs.push(w / c); } bs.sort((x, y) => x - y); line += `${pct(a.pay / a.n)}% (${pct(bs[6]).trim()}..${pct(bs[243]).trim()})`.padEnd(26); }
    console.log(line);
  }
}
if (process.argv[1] && process.argv[1].endsWith('tuner.mjs')) {
  const args = process.argv.slice(3), opt = {}, sets = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { opt[args[i].slice(2)] = args[++i]; } else sets.push(args[i]); }
  const edge = +(opt.edge || 0.04), load = (files) => files.split(',').flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
  if (process.argv[2] === 'fit') {
    // --last H: only the most recent H hours (the market of today). --holdout F: fit on the older part, check on the newest F, refuse to publish on failure.
    const out = { version: 1, updated: new Date().toISOString(), edge, window_hours: +(opt.last || 0) || null, assets: {} }; let failed = false, dataUntil = 0;
    for (const s of sets) {
      const [name, files] = s.split('='); let rows = load(files).sort((a, b) => a[3] - b[3]);
      if (opt.last) { const tmax = rows[rows.length - 1][3]; rows = rows.filter((r) => r[3] >= tmax - +opt.last * 3600); }
      dataUntil = Math.max(dataUntil, rows[rows.length - 1][3]);
      const guard = { ok: true, notes: [] };
      if (rows.length < +(opt.minSamples || 20000)) { guard.ok = false; guard.notes.push(`only ${rows.length} samples (need ${opt.minSamples || 20000}): window too short to publish`); }
      if (opt.holdout) {
        const cut = Math.floor(rows.length * (1 - +opt.holdout)), tr = rows.slice(0, cut), te = rows.slice(cut), kn = fitKnots(tr), od = { knots: kn, ctx: { f: fitContext(tr, kn) } };
        const target = 1 - edge, g = (f) => evaluate(te, { edge, knots: od.knots, adj: od.ctx }, f), all = g(SLICES.all);
        guard.holdout = { n: all.n, ret: +all.ret.toFixed(3) };
        // Decide with confidence intervals (a short holdout is noisy): refuse only on clear evidence.
        if (all.lo > target + 0.05) { guard.ok = false; guard.notes.push(`overall return clearly above target: ${pct(all.lo).trim()}..${pct(all.hi).trim()}%`); }
        if (all.hi < target - 0.12) guard.notes.push(`warning: house kept far more than promised (${pct(all.lo).trim()}..${pct(all.hi).trim()}%)`);
        for (const sl of ['with momentum', 'against momentum', '20x+', 'hot vol, far cells', 'calm vol, near cells']) { const r = g(SLICES[sl]); if (r.n > 300 && r.lo > 1.0) { guard.ok = false; guard.notes.push(`${sl}: ${pct(r.lo).trim()}..${pct(r.hi).trim()}% (player advantage)`); } }
      }
      const knots = fitKnots(rows), ctx = { f: fitContext(rows, knots) }; out.assets[name] = { knots, ctx, samples: rows.length, guard };
      console.log(name.padEnd(4), String(rows.length).padStart(7), 'samples', knots.length, 'knots', guard.holdout ? `holdout ${guard.holdout.ret * 100}%` : '', guard.ok ? "OK" + (guard.notes.length ? " (" + guard.notes.join("; ") + ")" : "") : "REFUSED: " + guard.notes.join("; ")); if (!guard.ok) failed = true;
    }
    if (failed && !opt.force) { console.error('guard failed: odds.json NOT written (use --force to override)'); process.exit(2); }
    out.data_until = new Date(dataUntil * 1000).toISOString();   // newest market data the odds were learned from (updated = when the file was made)
    writeFileSync(opt.out || 'odds.json', JSON.stringify(out)); console.log('wrote', opt.out || 'odds.json', '| data until', out.data_until);
  } else if (process.argv[2] === 'schedule') {   // the odds a running tuner would have published: refit every `test` hours on the previous `train` hours
    const [name, files] = sets[0].split('='), rows = load(files).sort((a, b) => a[3] - b[3]), train = +(opt.train || 18), test = +(opt.test || 6), H = 3600, folds = [];
    for (let T = rows[0][3] + train * H; T + 60 <= rows[rows.length - 1][3]; T += test * H) { const tr = rows.filter((r) => r[3] >= T - train * H && r[3] < T); if (tr.length < 3000) continue; const knots = fitKnots(tr); folds.push({ from: T, to: T + test * H, knots, ctx: { f: fitContext(tr, knots) } }); }
    writeFileSync(opt.out, JSON.stringify({ asset: name, train, test, folds })); console.log(name, folds.length, 'folds ->', opt.out);
  } else if (process.argv[2] === 'walk') {
    for (const s of sets) { const [name, files] = s.split('='); reportWalk(name, walkForward(load(files), { edge, train: +(opt.train || 18), test: +(opt.test || 6) }), edge); }
  } else if (process.argv[2] === 'eval') {
    const odds = JSON.parse(readFileSync(opt.odds, 'utf8'));
    for (const s of sets) { const [name, files] = s.split('='), rows = load(files); report(name + ' · NO tuning', rows, {}, edge); report(name + ' · knots only', rows, { knots: odds.assets[name].knots }, edge); report(name + ' · knots + context', rows, odds.assets[name], edge); }
  }
}
