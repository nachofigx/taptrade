import test from 'node:test';
import assert from 'node:assert/strict';
import { levelInfo, dailyCheck, newProfile, missionFor, loadProfile, saveProfile, THEMES } from './progress.js';

test('levelInfo thresholds', () => {
  assert.deepEqual(levelInfo(0), { level: 1, cur: 0, need: 100 });
  assert.equal(levelInfo(99).level, 1);
  assert.equal(levelInfo(100).level, 2);
  assert.deepEqual(levelInfo(100 + 150), { level: 3, cur: 0, need: 200 });
  assert.ok(levelInfo(100000).level > 20);
});
test('daily streak: consecutive days grow, gaps reset, same day is a no-op', () => {
  const p = newProfile();
  assert.equal(dailyCheck(p, '2026-11-16').streak, 1);
  assert.equal(dailyCheck(p, '2026-11-16'), null);
  assert.equal(dailyCheck(p, '2026-11-17').streak, 2);
  assert.equal(dailyCheck(p, '2026-11-17'), null);
  assert.equal(dailyCheck(p, '2026-11-20').streak, 1);
  assert.equal(p.mission.day, '2026-11-20');
});
test('mission is deterministic per day and changes', () => {
  assert.equal(missionFor('2026-11-17').id, missionFor('2026-11-17').id);
  const ids = new Set(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map((d) => missionFor(d).id));
  assert.equal(ids.size, 5);
});
test('profile persists and themes unlock by level', () => {
  const mem = new Map(); const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const p = newProfile(); p.xp = 777; p.ach.first_win = 1; saveProfile(p, store);
  const q = loadProfile(store); assert.equal(q.xp, 777); assert.ok(q.ach.first_win); assert.equal(q.stats.bets, 0);
  assert.ok(THEMES.every((t, i) => i === 0 || t.lvl > THEMES[i - 1].lvl));
});
