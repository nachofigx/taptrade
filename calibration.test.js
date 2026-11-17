import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, KNOTS, knotsFor } from './calibration.js';

test('calibrate: identity without knots, exact at knots, monotone and bounded in between', () => {
  assert.equal(calibrate(0.3, null), 0.3); assert.equal(calibrate(0.3, []), 0.3);
  const K = [[0.02, 0.03], [0.2, 0.15], [0.6, 0.5]];
  for (const [p, q] of K) assert.ok(Math.abs(calibrate(p, K) - q) < 1e-9, 'knot ' + p);
  let prev = 0; for (let p = 0.005; p <= 0.999; p += 0.004) { const q = calibrate(p, K); assert.ok(q >= prev - 1e-12 && q > 0 && q < 1, 'monotone/bounded at ' + p); prev = q; }
  assert.ok(Math.abs(calibrate(0.01, K) - 0.015) < 1e-9, 'below first knot keeps the ratio');
});
test('shipped tables are well formed (increasing, realised <= 1) and found by symbol', () => {
  for (const [name, K] of Object.entries(KNOTS)) {
    assert.ok(K.length >= 8, name);
    for (let i = 1; i < K.length; i++) { assert.ok(K[i][0] > K[i - 1][0] && K[i][1] >= K[i - 1][1], name + ' knot ' + i); }
    assert.ok(K.every(([p, q]) => p > 0 && p < 1 && q > 0 && q < 1));
  }
  assert.equal(knotsFor('SOL-USD'), KNOTS.sol); assert.equal(knotsFor('DOGE-USD'), null);
});
