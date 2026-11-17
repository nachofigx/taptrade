import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, pushTick, DEFAULT_IND } from './indicators.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + ' !~ ' + b);

test('sma', () => { assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]); assert.deepEqual(sma([5], 3), [null]); });
test('ema', () => {
  const e = ema([10, 20, 30], 3); // k = 0.5
  assert.equal(e[0], 10); assert.equal(e[1], 15); assert.equal(e[2], 22.5);
  assert.equal(ema([4, 4, 4, 4], 9).every((v) => v === 4), true);
});
test('rsi: hand-checked values (Wilder smoothing)', () => {
  const r = rsi([1, 2, 1, 2], 2);
  assert.deepEqual(r.slice(0, 2), [null, null]); close(r[2], 50); close(r[3], 75);
  assert.equal(rsi([1, 2, 3, 4, 5, 6], 3).filter((v) => v != null).every((v) => v === 100), true); // only gains
  assert.equal(rsi([6, 5, 4, 3, 2, 1], 3)[5], 0);                                                  // only losses
  assert.equal(rsi([3, 3, 3, 3, 3], 3)[4], 50);                                                    // flat
  assert.deepEqual(rsi([1, 2], 5), [null, null]);                                                  // not enough data
});
test('rsi stays within 0..100 on a noisy series', () => {
  let p = 100, s = 1; const c = []; for (let i = 0; i < 500; i++) { s = (s * 1103515245 + 12345) % 2147483648; p *= 1 + ((s / 2147483648) - 0.5) * 0.01; c.push(p); }
  const r = rsi(c, 14).filter((v) => v != null); assert.ok(r.length === 486 && r.every((v) => v >= 0 && v <= 100));
});
test('pushTick buckets by interval and caps length', () => {
  const bars = []; pushTick(bars, 10.1, 5, 1); pushTick(bars, 10.9, 6, 1); pushTick(bars, 11.2, 7, 1);
  assert.deepEqual(bars, [{ t0: 10, c: 6 }, { t0: 11, c: 7 }]);
  const b5 = []; pushTick(b5, 12, 1, 5); pushTick(b5, 14.9, 2, 5); pushTick(b5, 15, 3, 5); assert.deepEqual(b5, [{ t0: 10, c: 2 }, { t0: 15, c: 3 }]);
  const capped = []; for (let i = 0; i < 20; i++) pushTick(capped, i, i, 1, 10); assert.equal(capped.length, 10); assert.equal(capped[0].t0, 10);
});
test('pushTick forward-fills seconds without trades', () => {
  const b = []; pushTick(b, 10.2, 5, 1); pushTick(b, 13.4, 9, 1);
  assert.deepEqual(b, [{ t0: 10, c: 5 }, { t0: 11, c: 5 }, { t0: 12, c: 5 }, { t0: 13, c: 9 }]);
  const far = []; pushTick(far, 0, 1, 1, 50); pushTick(far, 10000, 2, 1, 50); assert.equal(far.length, 50); assert.equal(far[49].c, 2); assert.equal(far[48].c, 1);
});
test('defaults are sane', () => { assert.ok(DEFAULT_IND.ma1.n < DEFAULT_IND.ma2.n); assert.equal(DEFAULT_IND.rsi.n, 14); });
