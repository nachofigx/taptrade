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
  return { xp: 0, ach: {}, stats: { bets: 0, wins: 0, losses: 0, near: 0, bestStreak: 0, biggest: 0 }, theme: 'aqua', day: null, dayStreak: 0, mission: null };
}

export function loadProfile(store = globalThis.localStorage) {
  let p = newProfile();
  try { const raw = store && store.getItem(KEY); if (raw) { const o = JSON.parse(raw); p = { ...p, ...o, stats: { ...p.stats, ...(o.stats || {}) } }; } } catch {}
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
