import test from 'node:test';
import assert from 'node:assert/strict';
import { marketContext, momBucket, volBucket, alignIndex, pBand, adjustP } from './context.js';
import { computeBoard, LOCK, SLOT } from './engine.js';

test('marketContext: needs history, measures direction and recent volatility relative to sigma', () => {
  assert.equal(marketContext([1, 1, 1], 0.0001).ready, false);
  const flat = Array(40).fill(100); const c0 = marketContext(flat, 0.0001); assert.ok(c0.ready && c0.mz === 0 && c0.vr === 0);
  const up = Array.from({ length: 40 }, (_, i) => 100 * (1 + 0.0002 * i)); const cu = marketContext(up, 0.0001);
  assert.ok(cu.mz > 0.7 && momBucket(cu.mz) === 1); assert.ok(marketContext(up.slice().reverse(), 0.0001).mz < -0.7);
  const wild = Array.from({ length: 40 }, (_, i) => 100 * (1 + (i % 2 ? 0.0005 : -0.0005))); assert.ok(marketContext(wild, 0.0001).vr > 1.2);
});
test('buckets and alignment', () => {
  assert.deepEqual([-1, -0.7, 0, 0.7, 1].map(momBucket), [-1, 0, 0, 0, 1]); assert.deepEqual([0.1, 0.7, 1.2, 1.3].map(volBucket), [0, 1, 1, 2]);
  assert.equal(alignIndex(1, 1), 2); assert.equal(alignIndex(-1, 1), 0); assert.equal(alignIndex(1, 0), 1); assert.equal(alignIndex(0, 1), 1);
  assert.deepEqual([0.02, 0.1, 0.3, 0.8].map(pBand), [0, 1, 2, 3]);
});
test('adjustP only changes the probability through the table and stays bounded', () => {
  const f = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => [1, 1, 1, 1])); f[2][1][1] = 0.8;
  assert.equal(adjustP(0.1, { adj: null, mz: 2, vr: 1, dir: 1 }), 0.1);
  assert.ok(Math.abs(adjustP(0.1, { adj: { f }, mz: 2, vr: 1, dir: 1 }) - 0.08) < 1e-12);   // with momentum, normal vol, band 1
  assert.equal(adjustP(0.1, { adj: { f }, mz: 2, vr: 1, dir: -1 }), 0.1);                  // against the move: untouched
  assert.ok(adjustP(0.99, { adj: { f: f.map((a) => a.map((b) => b.map(() => 5))) }, mz: 0, vr: 1, dir: 1 }) <= 0.999);
});
test('computeBoard: with-momentum cells get cheaper probability (higher multiplier) when the table says so', () => {
  const S = 100, band = 0.05, now = 1000.3, k = Math.ceil((now + LOCK) / SLOT) + 1, r0 = Math.floor(S / band);
  const f = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => [1, 1, 1, 1])); for (const vb of [0, 1, 2]) for (let b = 0; b < 4; b++) f[2][vb][b] = 0.7;
  const args = { S, sigma: 0.0004, now, slotFrom: k, slotTo: k, rowFrom: r0 - 20, rowTo: r0 + 20, band };
  const base = computeBoard(args), tuned = computeBoard({ ...args, adj: { f }, ctx: { mz: 2, vr: 1 } });
  let up = 0, down = 0; for (const [key, c] of base) { const t = tuned.get(key); if (!t || c.off || t.off) continue; const r = +key.split(':')[1]; if (r > r0) { assert.ok(t.p < c.p && t.m > c.m); up++; } else if (r < r0) { assert.equal(t.p, c.p); down++; } }
  assert.ok(up > 3 && down > 3);
});
