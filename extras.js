// Engagement extras: cosmetics, season pass, daily chest, golden hour, flash challenges, announcer lines, replay clips.
// Pure logic (no DOM, no storage) so it can be tested in Node. Everything here pays XP or cosmetics only: it never touches
// the balance or the multipliers.

// ---------- cosmetics ----------
// src: 'base' (everyone), 'chest' (random from the daily chest), 'season' (season pass reward)
export const FRAMES = [
  { id: 'none',    name: 'Sin marco',  src: 'base',   c: '#b86bff' },
  { id: 'ember',   name: 'Brasa',      src: 'chest',  c: '#ff8a3d' },
  { id: 'frost',   name: 'Escarcha',   src: 'chest',  c: '#8fd8ff' },
  { id: 'toxic',   name: 'Tóxico',     src: 'chest',  c: '#8dff3d' },
  { id: 'royal',   name: 'Real',       src: 'season', c: '#ffd24a' },
  { id: 'rainbow', name: 'Arcoíris',   src: 'season', c: '#ff5ef2' },
  { id: 'diamond', name: 'Diamante',   src: 'season', c: '#d6f6ff' },
];
export const TRAILS = [
  { id: 'none',    name: 'Sin estela',   src: 'base',   c: '#9a8fc2' },
  { id: 'spark',   name: 'Chispas',      src: 'chest',  c: '#ffd24a' },
  { id: 'ice',     name: 'Hielo',        src: 'chest',  c: '#8fd8ff' },
  { id: 'comet',   name: 'Cometa',       src: 'season', c: '#ff9a3d' },
  { id: 'rainbow', name: 'Arcoíris',     src: 'season', c: '#ff5ef2' },
];
export const TUNES = [
  { id: 'synth',  name: 'Synthwave',  src: 'base',   c: '#b86bff' },
  { id: 'chill',  name: 'Chill',      src: 'chest',  c: '#8fd8ff' },
  { id: 'arcade', name: 'Arcade',     src: 'season', c: '#ffd24a' },
  { id: 'night',  name: 'Noche',      src: 'season', c: '#6d7bff' },
];
export const KINDS = { frame: FRAMES, trail: TRAILS, tune: TUNES };
export const KIND_LABEL = { frame: 'Marco de avatar', trail: 'Estela del precio', tune: 'Música' };
export const itemKey = (kind, id) => kind + ':' + id;
export const parseKey = (key) => { const [kind, id] = String(key).split(':'); return { kind, id, def: (KINDS[kind] || []).find((x) => x.id === id) || null }; };
export const owns = (p, kind, id) => { const d = (KINDS[kind] || []).find((x) => x.id === id); return !!d && (d.src === 'base' || p.cosm.owned.includes(itemKey(kind, id))); };
export function grant(p, key) { const { def } = parseKey(key); if (!def || p.cosm.owned.includes(key)) return false; p.cosm.owned.push(key); return true; }
export function equip(p, kind, id) { if (!owns(p, kind, id)) return false; p.cosm[kind] = id; return true; }
export const itemName = (key) => { const { kind, def } = parseKey(key); return def ? KIND_LABEL[kind] + ' «' + def.name + '»' : key; };

// ---------- season pass: 30 levels, resets every calendar month, cosmetics stay ----------
export const SEASON_LEVELS = 30, SEASON_XP = 150;
export const seasonId = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const SEASON_ITEMS = { 3: 'frame:royal', 6: 'trail:comet', 9: 'tune:arcade', 12: 'frame:rainbow', 18: 'trail:rainbow', 24: 'tune:night', 30: 'frame:diamond' };
export const SEASON_REWARDS = Array.from({ length: SEASON_LEVELS }, (_, i) => {
  const lvl = i + 1; return { lvl, item: SEASON_ITEMS[lvl] || null, xp: lvl % 5 === 0 ? 200 : 60 };
});
export function seasonInfo(sxp) {
  const lvl = Math.min(SEASON_LEVELS, Math.floor(Math.max(0, sxp) / SEASON_XP));
  return { level: lvl, cur: lvl >= SEASON_LEVELS ? SEASON_XP : sxp - lvl * SEASON_XP, need: SEASON_XP, maxed: lvl >= SEASON_LEVELS };
}
export function seasonSync(p, id = seasonId()) { if (p.season.id !== id) p.season = { id, xp: 0, claimed: [] }; return p.season; }
export function addSeasonXP(p, n) { seasonSync(p); p.season.xp += n; return seasonInfo(p.season.xp).level; }
export const seasonClaimable = (p) => SEASON_REWARDS.filter((r) => r.lvl <= seasonInfo(p.season.xp).level && !p.season.claimed.includes(r.lvl));
export function seasonClaim(p, lvl) {
  const r = SEASON_REWARDS[lvl - 1];
  if (!r || p.season.claimed.includes(lvl) || lvl > seasonInfo(p.season.xp).level) return null;
  p.season.claimed.push(lvl);
  return { xp: r.xp, item: r.item && grant(p, r.item) ? r.item : null };
}

// ---------- daily chest ----------
export function rollChest(p, streak, rnd = Math.random) {
  const xp = 40 + 10 * Math.min(10, Math.max(1, streak)) + Math.floor(rnd() * 30);
  const pool = Object.entries(KINDS).flatMap(([kind, list]) => list.filter((d) => d.src === 'chest').map((d) => itemKey(kind, d.id))).filter((k) => !p.cosm.owned.includes(k));
  const lucky = streak > 0 && streak % 7 === 0 ? true : rnd() < 0.3;
  if (!lucky || !pool.length) return { xp: lucky ? xp * 2 : xp, item: null, bonus: lucky && !pool.length };
  return { xp, item: pool[Math.floor(rnd() * pool.length)], bonus: false };
}

// ---------- golden hour ----------
export const GOLD = { dur: 30, mult: 2, first: 120, gapMin: 240, gapMax: 420, giftEvery: [3, 6], maxGifts: 4, tiers: [0.4, 0.8] }; // tiers: cumulative bronze/silver cutoffs; rest is gold
export const goldGap = (rnd = Math.random) => GOLD.gapMin + rnd() * (GOLD.gapMax - GOLD.gapMin);
export const goldTier = (rnd = Math.random) => { const r = rnd(); return r < GOLD.tiers[0] ? 'bronze' : r < GOLD.tiers[1] ? 'silver' : 'gold'; };

// ---------- flash challenge: "up or down in 30 s?" ----------
export const FLASH = { choose: 12, dur: 30, first: 75, gapMin: 150, gapMax: 240, base: 40 };
export const flashGap = (rnd = Math.random) => FLASH.gapMin + rnd() * (FLASH.gapMax - FLASH.gapMin);
export const flashXP = (streak) => FLASH.base + 10 * Math.min(5, Math.max(0, streak));
export function flashResult(p0, p1, dir) { if (p1 === p0) return 'push'; return (p1 > p0 ? 1 : -1) === dir ? 'win' : 'lose'; }

// ---------- announcer ----------
export const LINES = {
  combo: ['¡Doble golpe!', '¡Combo!'],
  streak3: ['¡En racha!', '¡Tres seguidas!'],
  streak5: ['¡Imparable!', '¡Cinco seguidas!'],
  streak10: ['¡Leyenda!', '¡Diez seguidas, increíble!'],
  big: ['¡Qué golpe!', '¡Premio gordo!'],
  mega: ['¡Mega premio!', '¡Increíble!'],
  gold: ['¡Regalo dorado!'],
  golden: ['¡Hora dorada!', '¡Llueve oro!'],
  flashWin: ['¡Lo viste venir!', '¡Ojo de águila!'],
  flashLose: ['Casi. La próxima.'],
  level: ['¡Subes de nivel!'],
  near: ['¡Por un pelo!'],
  turbo: ['Modo turbo'],
  chest: ['¡Cofre abierto!'],
};
export const pickLine = (key, rnd = Math.random) => { const a = LINES[key]; return a ? a[Math.floor(rnd() * a.length) % a.length] : null; };

// ---------- replay clips ----------
// A clip stores the price path around a winning bet so it can be replayed in slow motion. Times are seconds since clip start.
const sig = (v) => Number(v.toPrecision(7));
export function buildClip(hist, b, { pre = 3, post = 1, max = 160 } = {}) {
  const t0 = b.start - pre, t1 = Math.max(b.tHit ?? b.end, b.start) + post;
  let pts = hist.filter((h) => h.t >= t0 && h.t <= t1);
  if (pts.length < 2) return null;
  if (pts.length > max) { const step = pts.length / max; pts = Array.from({ length: max }, (_, i) => pts[Math.min(pts.length - 1, Math.floor(i * step))]); }
  return {
    asset: b.asset, mult: b.mult, profit: b.profit, stake: b.stake, at: b.at ?? 0,
    lo: sig(b.lo), hi: sig(b.hi), start: +(b.start - t0).toFixed(2), end: +(b.end - t0).toFixed(2), hit: +((b.tHit ?? b.end) - t0).toFixed(2), len: +(t1 - t0).toFixed(2),
    pts: pts.map((h) => [+(h.t - t0).toFixed(2), sig(h.p)]),
  };
}
export function clipPriceAt(clip, t) {
  const a = clip.pts; if (!a.length) return null;
  if (t <= a[0][0]) return a[0][1]; if (t >= a[a.length - 1][0]) return a[a.length - 1][1];
  let i = 1; while (a[i][0] < t) i++;
  const [t0, p0] = a[i - 1], [t1, p1] = a[i]; return t1 === t0 ? p1 : p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
}
