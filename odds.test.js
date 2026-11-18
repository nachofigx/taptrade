import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOdds, oddsFor, fetchOdds, oddsAgeHours } from './odds.js';
import { KNOTS } from './calibration.js';

const f = () => Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => [1, 1, 1, 1]));
const good = { updated: '2026-11-17T12:00:00Z', assets: { sol: { knots: KNOTS.sol, ctx: { f: f() }, samples: 5 } } };

test('accepts a well-formed tuner file and keeps only known-good fields', () => {
  const v = validateOdds({ ...good, evil: '<script>' }); assert.ok(v && v.assets.sol.knots.length === KNOTS.sol.length && v.assets.sol.ctx.f.length === 3); assert.equal(v.evil, undefined);
});
test('rejects out-of-range or malformed content instead of letting it price bets', () => {
  assert.equal(validateOdds(null), null); assert.equal(validateOdds({}), null); assert.equal(validateOdds({ assets: {} }), null);
  assert.equal(validateOdds({ assets: { sol: { knots: [[0.5, 0.01], [0.6, 0.5], [0.7, 0.6], [0.8, 0.7]] } } }), null, 'ratio 0.02 is absurd');
  assert.equal(validateOdds({ assets: { sol: { knots: [[0.1, 0.1], [0.05, 0.1], [0.3, 0.3], [0.4, 0.4]] } } }), null, 'not increasing');
  assert.equal(validateOdds({ assets: { 'S O L': { knots: KNOTS.sol } } }), null, 'bad asset name');
  const bad = f(); bad[1][1][2] = 9; assert.equal(validateOdds({ assets: { sol: { knots: KNOTS.sol, ctx: { f: bad } } } }).assets.sol.ctx, null, 'factor outside 0.5-2 drops the context, keeps knots');
  const nan = JSON.parse(JSON.stringify(KNOTS.sol)); nan[2][0] = null; assert.equal(validateOdds({ assets: { sol: { knots: nan } } }), null);
});
test('oddsFor: tuner first, built-in as fallback', () => {
  const v = validateOdds(good); assert.equal(oddsFor(v, 'SOL-USD').source, 'tuner'); assert.ok(oddsFor(v, 'SOL-USD').adj);
  const b = oddsFor(v, 'ETH-USD'); assert.equal(b.source, 'built-in'); assert.equal(b.knots, KNOTS.eth); assert.equal(b.adj, null);
  assert.equal(oddsFor(null, 'BTC-USD').knots, KNOTS.btc);
});

test('fetchOdds: first valid URL wins, bad or unreachable ones fall through, null when none work', async () => {
  const realFetch = globalThis.fetch, calls = [];
  const reply = (map) => async (url) => { calls.push(url.split('?')[0]); const r = map[url.split('?')[0]]; if (r instanceof Error) throw r; return r === undefined ? { ok: false } : { ok: true, json: async () => r }; };
  try {
    globalThis.fetch = reply({ 'https://a/odds.json': new Error('network'), 'https://b/odds.json': { assets: { sol: { knots: [[0.5, 0.01]] } } }, 'https://c/odds.json': good });
    const v = await fetchOdds(['https://a/odds.json', 'https://b/odds.json', 'https://c/odds.json']);
    assert.equal(v.url, 'https://c/odds.json'); assert.deepEqual(calls, ['https://a/odds.json', 'https://b/odds.json', 'https://c/odds.json']);
    assert.equal(await fetchOdds('https://nothing/odds.json'), null);
  } finally { globalThis.fetch = realFetch; }
});
test('oddsAgeHours uses the data cutoff when present', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(oddsAgeHours({ data_until: '2026-11-18T06:00:00Z', updated: '2026-11-18T11:00:00Z' }, now), 6);
  assert.equal(oddsAgeHours({ updated: '2026-11-18T10:00:00Z' }, now), 2); assert.equal(oddsAgeHours(null, now), Infinity);
});
