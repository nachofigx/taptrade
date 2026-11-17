import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBoard, stepBet, EDGE, SLOT, LOCK, Vol, MAX_MULT, MIN_P, DIFFICULTY, LONGSHOT_EDGE, longshotEdge } from './engine.js';
import { calibrate } from './calibration.js';

test('stepBet: wins on touch inside window, loses after window', () => {
  const bet = { status: 'open', start: 100, end: 105, lo: 10, hi: 11 };
  assert.equal(stepBet(bet, { t: 98, p: 9 }, { t: 99, p: 9.5 }), 'open');
  assert.equal(stepBet(bet, { t: 101, p: 9 }, { t: 102, p: 10.5 }), 'won');
  assert.equal(stepBet(bet, { t: 101, p: 9 }, { t: 102, p: 12 }), 'won'); // crosses the band
  assert.equal(stepBet(bet, { t: 104, p: 9 }, { t: 106, p: 9.2 }), 'lost');
  assert.equal(stepBet({ ...bet, status: 'won' }, { t: 1, p: 1 }, { t: 2, p: 2 }), 'won');
});

test('multipliers grow with distance from price', () => {
  const S = 100, band = 0.05, now = 1000.3;
  const k = Math.ceil((now + LOCK) / SLOT) + 1;
  const r0 = Math.floor(S / band);
  const b = computeBoard({ S, sigma: 0.0004, now, slotFrom: k, slotTo: k, rowFrom: r0 - 20, rowTo: r0 + 20, band });
  const m = (d) => b.get(k + ':' + (r0 + d))?.m ?? Infinity;
  assert.ok(m(0) < m(2) && m(2) < m(4) && m(4) < m(7));
  assert.ok(Math.abs(m(3) - m(-4)) / m(3) < 0.15, 'symmetric around the price');
});

// Simulate the real process on a fine grid and check the player's expected return ~ 1 - EDGE.
test('expected return is about 1 - EDGE', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const S = 100, sigma = 0.0003, band = 0.05, now = 1000.3, h = 0.05;
  const adj = 0.5826 * sigma * Math.sqrt(h) * S; // makes the fine grid behave like continuous monitoring
  const kA = Math.ceil((now + LOCK) / SLOT), kB = kA + 3; // columns up to ~25s ahead
  const r0 = Math.floor(S / band);
  const board = computeBoard({ S, sigma, now, slotFrom: kA, slotTo: kB, rowFrom: r0 - 25, rowTo: r0 + 25, band });
  const N = 6000, wins = new Map();
  for (let n = 0; n < N; n++) {
    let p = S, prev = { t: now, p };
    const done = new Set();
    for (let t = now + h; t <= (kB + 1) * SLOT; t += h) {
      p *= Math.exp(sigma * Math.sqrt(h) * gauss());
      const cur = { t, p };
      for (const [key] of board) {
        if (done.has(key)) continue;
        const [k, r] = key.split(':').map(Number);
        if (stepBet({ status: 'open', start: k * SLOT, end: (k + 1) * SLOT, lo: r * band - adj, hi: (r + 1) * band + adj }, prev, cur) === 'won') {
          done.add(key); wins.set(key, (wins.get(key) ?? 0) + 1);
        }
      }
      prev = cur;
    }
  }
  let ret = 0, cells = 0, ret10 = 0, c10 = 0;
  for (const [key, { m }] of board) {
    const x = ((wins.get(key) ?? 0) / N) * m;
    ret += x; cells++;
    if (m >= 2 && m <= 20) { ret10 += x; c10++; }
  }
  const avg = ret / cells, avgMid = ret10 / c10;
  console.log(`cells=${cells} avgReturn=${avg.toFixed(3)} mid(2-20x)=${avgMid.toFixed(3)} target=${(1 - EDGE).toFixed(2)}`);
  assert.ok(Math.abs(avgMid - (1 - EDGE)) < 0.06, 'mid-range return off target');
});

test('Vol estimator reacts to movement', () => {
  const v = new Vol(0.0001);
  let p = 100;
  for (let t = 0; t < 200; t++) { p *= 1 + (t % 2 ? 0.001 : -0.001); v.add(t, p); }
  assert.ok(v.sigma > 0.0005);
});

const board = (extra = {}) => { const S = 100, band = 0.05, now = 1000.3, k = Math.ceil((now + LOCK) / SLOT) + 1, r0 = Math.floor(S / band);
  return computeBoard({ S, sigma: 0.0004, now, slotFrom: k, slotTo: k + 6, rowFrom: r0 - 30, rowTo: r0 + 30, band, ...extra }); };

test('edge parameter: a lower house edge pays more on every cell, and every cell returns (1 - edge)', () => {
  const hi = board({ edge: DIFFICULTY.real.edge }), lo = board({ edge: DIFFICULTY.relaxed.edge });
  assert.ok(DIFFICULTY.relaxed.edge < DIFFICULTY.normal.edge && DIFFICULTY.normal.edge < DIFFICULTY.real.edge);
  let compared = 0;
  for (const [key, c] of lo) { const d = hi.get(key); if (!d || c.off || d.off) continue; assert.ok(c.m >= d.m, key); compared++; }
  assert.ok(compared > 20);
  for (const edge of [0, 0.02, 0.04, 0.08]) for (const [key, c] of board({ edge })) {
    if (c.off) continue; const want = 1 - edge - longshotEdge(c.p); assert.ok(Math.abs(c.m * c.p - want) < 0.011, `${key} edge ${edge}: return ${(c.m * c.p).toFixed(3)} vs ${want.toFixed(3)}`); assert.ok(c.m < MAX_MULT + 1e-9);
  }
});
test('the multiplier cap never lowers the return (the old 50x cap quietly cost the player up to 40% on far cells)', () => {
  assert.ok((1 - 0) / MIN_P < MAX_MULT, 'cap would bind even at zero edge');
  const far = [...board({ edge: 0.04 })].filter(([, c]) => !c.off && c.p < 0.03);
  assert.ok(far.length > 5, 'far cells exist in the test board'); for (const [, c] of far) assert.ok(c.m * c.p > 0.96 - LONGSHOT_EDGE - 0.011 && c.m * c.p < 0.96 + 0.011);
});
test('calibration is applied to the probability and to the price', () => {
  const K = [[0.02, 0.03], [0.2, 0.15], [0.6, 0.45]], raw = board({ edge: 0.04 }), cal = board({ edge: 0.04, cal: K });
  let seen = 0; for (const [key, c] of cal) { const r = raw.get(key); if (!r || r.off || c.off) continue; if (Math.abs(c.p - calibrate(r.p, K)) < 1e-9) seen++; assert.ok(Math.abs(c.m * c.p - (0.96 - longshotEdge(c.p))) < 0.011); }
  assert.ok(seen > 15, 'calibrated p matches calibrate(rawP) for most cells');
});

test('longshot margin: zero above 5%, full at or below 1.5%, monotone in between, and the cap still never binds', () => {
  assert.equal(longshotEdge(0.2), 0); assert.equal(longshotEdge(0.05), 0); assert.ok(Math.abs(longshotEdge(0.015) - LONGSHOT_EDGE) < 1e-12); assert.ok(Math.abs(longshotEdge(0.0101) - LONGSHOT_EDGE) < 1e-12);
  let prev = LONGSHOT_EDGE + 1; for (let p = 0.0101; p < 0.06; p += 0.001) { const x = longshotEdge(p); assert.ok(x <= prev + 1e-12); prev = x; }
  for (const edge of [0, 0.02, 0.08]) assert.ok((1 - edge) / MIN_P < MAX_MULT);
});
