import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, loadProfile, saveProfile } from './progress.js';
import { FRAMES, TRAILS, TUNES, owns, grant, equip, itemName, seasonInfo, seasonSync, addSeasonXP, seasonClaimable, seasonClaim, SEASON_REWARDS, SEASON_LEVELS, SEASON_XP, seasonId,
  rollChest, flashResult, flashXP, goldTier, goldGap, GOLD, pickLine, LINES, buildClip, clipPriceAt } from './extras.js';

test('cosmetics: base items are free, others need a grant; equip only owned', () => {
  const p = newProfile();
  assert.ok(owns(p, 'frame', 'none') && owns(p, 'tune', 'synth'));
  assert.ok(!owns(p, 'frame', 'ember'));
  assert.equal(equip(p, 'frame', 'ember'), false);
  assert.ok(grant(p, 'frame:ember')); assert.equal(grant(p, 'frame:ember'), false); assert.equal(grant(p, 'frame:nope'), false);
  assert.ok(equip(p, 'frame', 'ember')); assert.equal(p.cosm.frame, 'ember');
  assert.match(itemName('trail:comet'), /Cometa/);
});
test('every season reward item exists and is a season item', () => {
  const items = SEASON_REWARDS.filter((r) => r.item);
  assert.ok(items.length >= 6);
  for (const r of items) { const [k, id] = r.item.split(':'); const d = { frame: FRAMES, trail: TRAILS, tune: TUNES }[k].find((x) => x.id === id); assert.ok(d && d.src === 'season', r.item); }
  assert.equal(SEASON_REWARDS.length, SEASON_LEVELS);
});
test('season levels, claim once, reset on a new month', () => {
  const p = newProfile(); seasonSync(p, '2026-11');
  assert.equal(seasonInfo(0).level, 0); assert.equal(seasonInfo(SEASON_XP * 3 - 1).level, 2); assert.ok(seasonInfo(1e9).maxed);
  assert.equal(addSeasonXP(p, SEASON_XP * 3), 3);
  assert.deepEqual(seasonClaimable(p).map((r) => r.lvl), [1, 2, 3]);
  assert.equal(seasonClaim(p, 4), null);                         // not reached
  const c = seasonClaim(p, 3); assert.equal(c.item, 'frame:royal'); assert.ok(owns(p, 'frame', 'royal'));
  assert.equal(seasonClaim(p, 3), null);                          // only once
  assert.deepEqual(seasonClaimable(p).map((r) => r.lvl), [1, 2]);
  seasonSync(p, '2026-12'); assert.equal(p.season.xp, 0); assert.deepEqual(p.season.claimed, []); assert.ok(owns(p, 'frame', 'royal')); // cosmetics persist
  assert.match(seasonId(new Date(2026, 10, 5)), /^2026-11$/);
});
test('daily chest: xp grows with the streak; guaranteed item on day 7; never repeats; bonus xp when everything is owned', () => {
  const p = newProfile();
  const a = rollChest(p, 1, () => 0.99), b = rollChest(p, 10, () => 0.99);
  assert.equal(a.item, null); assert.ok(b.xp > a.xp);
  const lucky = rollChest(p, 7, () => 0.5); assert.ok(lucky.item && lucky.item.length);
  grant(p, lucky.item);
  for (let i = 0; i < 50; i++) { const r = rollChest(p, 7, Math.random); if (r.item) { assert.ok(!p.cosm.owned.includes(r.item)); grant(p, r.item); } }
  const done = rollChest(p, 7, () => 0.5); assert.equal(done.item, null); assert.ok(done.bonus && done.xp > 100);
});
test('flash challenge result + xp', () => {
  assert.equal(flashResult(100, 101, 1), 'win'); assert.equal(flashResult(100, 101, -1), 'lose'); assert.equal(flashResult(100, 99, -1), 'win'); assert.equal(flashResult(100, 100, 1), 'push');
  assert.equal(flashXP(0), 40); assert.equal(flashXP(3), 70); assert.equal(flashXP(99), 90);
});
test('golden hour: gap and tier distribution', () => {
  assert.ok(goldGap(() => 0) === GOLD.gapMin && goldGap(() => 1) === GOLD.gapMax);
  const n = { bronze: 0, silver: 0, gold: 0 }; for (let i = 0; i < 4000; i++) n[goldTier()]++;
  assert.ok(n.gold > 600 && n.gold < 1000 && n.bronze > 1400);
});
test('announcer lines exist for every key', () => { for (const k of Object.keys(LINES)) assert.ok(pickLine(k, () => 0.99), k); assert.equal(pickLine('nope'), null); });
test('clip: window, thinning, interpolation', () => {
  const hist = Array.from({ length: 400 }, (_, i) => ({ t: 1000 + i * 0.05, p: 100 + Math.sin(i / 20) })); // 20 s of data
  const c = buildClip(hist, { asset: 'SOL-USD', mult: 12, profit: 55, stake: 5, start: 1010, end: 1015, tHit: 1012, lo: 100.4, hi: 100.5 });
  assert.equal(c.start, 3); assert.equal(c.hit, 5); assert.equal(c.len, 6); assert.ok(c.pts.length <= 160 && c.pts[0][0] >= 0 && c.pts.at(-1)[0] <= 6.01);
  const mid = clipPriceAt(c, 3), exact = 100 + Math.sin(Math.round(((1010 - 1000) / 0.05)) / 20); assert.ok(Math.abs(mid - exact) < 0.05);
  assert.equal(clipPriceAt(c, -5), c.pts[0][1]); assert.equal(clipPriceAt(c, 99), c.pts.at(-1)[1]);
  assert.equal(buildClip([], { start: 0, end: 5 }), null);
  assert.ok(JSON.stringify(c).length < 5000);
});
test('profile roundtrip keeps the new fields and fills defaults for old saves', () => {
  const mem = {}; const store = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  store.setItem('tl.prof.v1', JSON.stringify({ xp: 500, stats: { bets: 3 }, settings: { music: false } }));
  const p = loadProfile(store);
  assert.equal(p.xp, 500); assert.equal(p.settings.music, false); assert.equal(p.settings.voice, true); assert.equal(p.settings.turbo, false);
  assert.deepEqual(p.cosm.owned, []); assert.equal(p.season.xp, 0); assert.equal(p.stats.flashWins, 0);
  grant(p, 'tune:chill'); saveProfile(p, store); assert.ok(loadProfile(store).cosm.owned.includes('tune:chill'));
});
