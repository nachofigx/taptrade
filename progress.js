// Player progress: XP/levels, achievements, daily mission, daily streak, cosmetic themes.
// Pure logic + localStorage, no DOM, so it can be tested in Node.

const KEY = 'tl.prof.v1';

export const THEMES = [
  { id: 'aqua', name: 'Aqua',  lvl: 1, line: '238,242,251', glow: '94,242,208',  dot: '#5ef2d0', hue: 170 },
  { id: 'fire', name: 'Fuego', lvl: 3, line: '255,226,170', glow: '255,140,40',  dot: '#ffb347', hue: 28 },
  { id: 'neon', name: 'Neón',  lvl: 5, line: '255,200,255', glow: '255,70,230',  dot: '#ff5ef2', hue: 310 },
  { id: 'gold', name: 'Oro',   lvl: 8, line: '255,246,205', glow: '255,205,60',  dot: '#ffd24a', hue: 48 },
];

export const ACHIEVEMENTS = [
  { id: 'first_win',  name: 'Primera sangre',     desc: 'Gana tu primera apuesta',                xp: 40 },
  { id: 'tap_10',     name: 'Dedo caliente',      desc: 'Haz 10 apuestas',                        xp: 30 },
  { id: 'veteran',    name: 'Veterano',           desc: 'Haz 100 apuestas',                       xp: 120 },
  { id: 'win_10x',    name: 'Cazador de 10x',     desc: 'Gana una apuesta de 10x o más',          xp: 100 },
  { id: 'win_25x',    name: 'Francotirador',      desc: 'Gana una apuesta de 25x o más',          xp: 200 },
  { id: 'streak_3',   name: 'En racha',           desc: 'Acierta 3 seguidas',                     xp: 60 },
  { id: 'streak_5',   name: 'Imparable',          desc: 'Acierta 5 seguidas',                     xp: 120 },
  { id: 'streak_10',  name: 'Leyenda',            desc: 'Acierta 10 seguidas',                    xp: 300 },
  { id: 'last_second',name: 'Justo a tiempo',     desc: 'Gana tocando en el último segundo',      xp: 80 },
  { id: 'comeback',   name: 'Remontada',          desc: 'Gana después de 3 fallos seguidos',      xp: 70 },
  { id: 'combo_2',    name: 'Doble golpe',        desc: 'Gana 2 apuestas de la misma columna',    xp: 80 },
  { id: 'near_5',     name: 'Por un pelo',        desc: 'Vive 5 «¡por poco!»',                    xp: 50 },
  { id: 'rich',       name: 'Mil quinientos',     desc: 'Llega a $1,500 de saldo',                xp: 150 },
  { id: 'gift_1',     name: 'Cazador de regalos', desc: 'Atrapa tu primer regalo',                xp: 50 },
  { id: 'gift_10',    name: 'Coleccionista',      desc: 'Atrapa 10 regalos',                      xp: 150 },
  { id: 'gift_gold',  name: 'Tesoro dorado',      desc: 'Atrapa un regalo dorado',                xp: 200 },
];

export const MISSIONS = [
  { id: 'taps15',  text: 'Haz 15 apuestas',                        target: 15, xp: 120 },
  { id: 'win3x3',  text: 'Gana 3 apuestas de 3x o más',            target: 3,  xp: 150 },
  { id: 'streak3', text: 'Logra una racha de 3 aciertos',          target: 1,  xp: 130 },
  { id: 'big10',   text: 'Gana una apuesta de 10x o más',          target: 1,  xp: 200 },
  { id: 'profit20',text: 'Llega a +$20 de ganancia en la sesión',  target: 20, xp: 150 },
];

export const todayStr = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dayNum = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);

// level L needs 100 + 50 * (L - 1) xp to reach L + 1
export function levelInfo(xp) {
  let level = 1, rem = Math.max(0, Math.floor(xp)), need = 100;
  while (rem >= need) { rem -= need; level++; need = 100 + 50 * (level - 1); }
  return { level, cur: rem, need };
}

export function missionFor(day) { return MISSIONS[((dayNum(day) % MISSIONS.length) + MISSIONS.length) % MISSIONS.length]; }

export function newProfile() {
  return {
    xp: 0, ach: {}, stats: { bets: 0, wins: 0, losses: 0, near: 0, bestStreak: 0, biggest: 0, gifts: 0 }, theme: 'aqua', day: null, dayStreak: 0, mission: null,
    name: 'JUGADOR', avatar: { type: 'pixel', seed: 'ace' },
    wallet: { addr: null, ledger: [] },
    settings: { music: true, musicVol: 0.6, sfxVol: 1 },
  };
}

export function loadProfile(store = globalThis.localStorage) {
  let p = newProfile();
  try {
    const raw = store && store.getItem(KEY);
    if (raw) { const o = JSON.parse(raw); p = { ...p, ...o, stats: { ...p.stats, ...(o.stats || {}) }, wallet: { ...p.wallet, ...(o.wallet || {}) }, settings: { ...p.settings, ...(o.settings || {}) }, avatar: o.avatar || p.avatar }; }
  } catch {}
  return p;
}
export function saveProfile(p, store = globalThis.localStorage) { try { store && store.setItem(KEY, JSON.stringify(p)); } catch {} }

// Call once per page load. Returns { xp, streak, newDay } when a new day started.
export function dailyCheck(p, today = todayStr()) {
  const m = missionFor(today);
  if (p.day === today) { if (!p.mission || p.mission.day !== today) p.mission = { day: today, id: m.id, prog: 0, done: false }; return null; }
  const gap = p.day ? dayNum(today) - dayNum(p.day) : null;
  p.dayStreak = gap === 1 ? p.dayStreak + 1 : 1;
  p.day = today;
  p.mission = { day: today, id: m.id, prog: 0, done: false };
  return { xp: Math.min(200, 20 * p.dayStreak), streak: p.dayStreak, newDay: true };
}

// ---------- avatars (deterministic pixel avatars, no external assets) ----------
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function prng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const AVATAR_SEEDS = ['ace', 'nova', 'blitz', 'viper', 'pixel', 'storm', 'echo', 'rogue', 'zen', 'titan', 'luna', 'hex'];
// 5x5 grid, left-right mirrored (like a tiny creature), colours derived from the seed.
export function pixelAvatarSVG(seed, size = 64) {
  const h = fnv(String(seed)), rnd = prng(h), hue = h % 360;
  let grid, n;
  do {
    grid = []; n = 0;
    for (let y = 0; y < 5; y++) { const r = [rnd() < 0.58, rnd() < 0.58, rnd() < 0.58]; r[3] = r[1]; r[4] = r[0]; grid.push(r); n += r.filter(Boolean).length; }
  } while (n < 9 || n > 17);
  let cells = '';
  grid.forEach((row, y) => row.forEach((on, x) => { if (on) cells += `<rect x="${10 + x * 16}" y="${10 + y * 16}" width="14" height="14" rx="3" fill="hsl(${(hue + (y % 2 ? 45 : 0)) % 360},90%,${y < 2 ? 66 : 58}%)"/>`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" rx="26" fill="hsl(${hue},55%,13%)"/>${cells}</svg>`;
}

// ---------- fake wallet (simulated; no keys, no network) ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function randomB58(n, rnd = (k) => { const a = new Uint8Array(k); globalThis.crypto.getRandomValues(a); return a; }) {
  const a = rnd(n); let s = ''; for (let i = 0; i < n; i++) s += B58[a[i] % B58.length]; return s;
}
export const makeAddr = () => randomB58(44);
export const shortAddr = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '—');
export function addLedger(p, type, amount, now = Date.now()) {
  const e = { t: now, type, amount: Math.round(amount * 100) / 100, sig: randomB58(10) };
  p.wallet.ledger.push(e); if (p.wallet.ledger.length > 80) p.wallet.ledger.shift();
  return e;
}
