import { SLOT as SLOT0, LOCK as LOCK0, STEPS, DT, Vol, computeBoard, stepBet, DIFFICULTY, EDGE } from './engine.js?v=22';
import { oddsFor, fetchOdds } from './odds.js?v=22';
import { marketContext } from './context.js?v=22';
import { THEMES, ACHIEVEMENTS, MISSIONS, levelInfo, loadProfile, saveProfile, dailyCheck, AVATAR_SEEDS, pixelAvatarSVG, makeAddr, shortAddr, addLedger } from './progress.js?v=19';
import { FRAMES, TRAILS, TUNES, KINDS, KIND_LABEL, itemKey, owns, equip, itemName, SEASON_REWARDS, SEASON_LEVELS, seasonInfo, seasonSync, addSeasonXP, seasonClaimable, seasonClaim, rollChest, GOLD, goldGap, goldTier, FLASH, flashGap, flashXP, flashResult, pickLine, buildClip, clipPriceAt, grant } from './extras.js?v=17';
import { DEFAULT_IND, sma, ema, rsi, pushTick, holdResample, gaussSmooth } from './indicators.js?v=19';

const $ = (id) => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const ASSETS = ['SOL-USD', 'BTC-USD', 'ETH-USD'];
const STAKES = [0.5, 1, 5, 10, 25, 50];
const START_BAL = 1000;
const ASPECT = 4 / 3;            // cell width : cell height
const fmtStake = (s) => (s < 1 ? s.toFixed(2) : String(s));
const fmt$ = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- state ----------
let asset = localStorage.getItem('tl.asset');
if (!ASSETS.includes(asset)) asset = 'SOL-USD';
let balance = Number(localStorage.getItem('tl.bal')) || START_BAL;
let stake = Number(localStorage.getItem('tl.stake')) || 5;
if (!STAKES.includes(stake)) stake = 5;
let bets = [], hist = [];
let last = null, first = null, vol = new Vol(), band = 1, board = new Map(), boardAt = 0, center = 0;
let TOP = 68;                    // height of the top bar; the playfield starts below it
let hover = null, ws = null, wsTimer = null, W = 0, H = 0, dpr = 1, nextId = 1, RH = 40;
let wins = 0, losses = 0, pnl = 0, lastTickAt = 0;
let streak = 0, bestStreak = 0, lastFrameAt = performance.now();
const parts = []; let banner = null, shakeMag = 0;
let prof = loadProfile();
let oddsDoc = null, closes1 = [];     // odds published by the tuner (odds.json) and 1-second closes used for the pricing context
const houseEdge = () => (DIFFICULTY[prof.settings.difficulty] || DIFFICULTY.normal).edge;
(() => { const d = DEFAULT_IND, i = prof.settings.ind || {}; prof.settings.ind = { ...d, ...i, ma1: { ...d.ma1, ...i.ma1 }, ma2: { ...d.ma2, ...i.ma2 }, rsi: { ...d.rsi, ...i.rsi } }; })();
let dispP = 0, lastDrawAt = 0;   // price shown by the "now" dot/line: eases toward the real last price
let bars = [];             // price bars for the indicators: one close per prof.settings.ind.bar seconds
const RSI_H = 104;         // height of the RSI panel
let tension = 0, slow = 0, heartNext = 0, lossRun = 0, lastBig = null, lp = null, shareT = 0;
const comboMap = new Map();
const TURBO = { slot: 2, lock: 2 };    // turbo mode: 2 s columns, bets close 2 s before
let SLOT = SLOT0, LOCK = LOCK0;
const gifts = []; let nextGift = 0;   // special gift boxes: touch them with the price to earn XP
const theme = () => THEMES.find((t) => t.id === prof.theme && levelInfo(prof.xp).level >= t.lvl) || THEMES[0];
const HIST_T = 10, HIST_MAX = 300;   // history compression: log scale, 5 minutes visible
let histGain = 1;                 // vertical exaggeration at the far (oldest) end
const now = () => Date.now() / 1000;

// ---------- sound (synthesized with Web Audio, no files) ----------
let actx = null, master = null, muted = localStorage.getItem('tl.mute') === '1';
function audio() { return muted ? null : ensureCtx(); }
function ensureCtx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    actx = new AC(); master = actx.createGain(); master.gain.value = 0.55 * prof.settings.sfxVol;
    lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; master.connect(lp); lp.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
let soundsPlayed = 0;
function tone(freq, t0, dur, { type = 'sine', gain = 0.18, slide = 1, attack = 0.006 } = {}) {
  soundsPlayed++;
  const a = actx, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(t0, dur, gain, f0, f1) {
  const a = actx, n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = a.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0);
}
const semi = (root, n) => root * Math.pow(2, n / 12);
const sfx = {
  tap(m) { // higher multiplier = higher, brighter pop
    if (!audio()) return; const t = actx.currentTime, f = 330 + Math.min(Math.log(m) * 150, 650);
    tone(f, t, 0.12, { type: 'triangle', gain: 0.24, slide: 1.6 }); tone(f * 2, t + 0.015, 0.07, { gain: 0.07 }); noise(t, 0.04, 0.08, 4000, 1500);
  },
  win(m, streakN) { // pentatonic arpeggio that climbs with the streak
    if (!audio()) return; const t = actx.currentTime, root = semi(523.25, Math.min(streakN - 1, 8));
    [0, 4, 7, 12].forEach((n, i) => { tone(semi(root, n), t + i * 0.065, 0.26, { type: 'triangle', gain: 0.2 }); tone(semi(root, n) * 2, t + i * 0.065, 0.14, { gain: 0.05 }); });
    noise(t, 0.18, 0.1, 6000, 9000);
    if (m >= 8) { // big win: fanfare + sub boom
      [16, 19, 24, 28].forEach((n, i) => tone(semi(root, n), t + 0.28 + i * 0.07, 0.4, { type: 'square', gain: 0.07 }));
      tone(90, t, 0.6, { gain: 0.35, slide: 0.45 }); noise(t + 0.05, 0.7, 0.12, 400, 8000);
    }
    if (m >= 25) [0, 7, 12, 19, 24].forEach((n, i) => tone(semi(root * 2, n), t + 0.7 + i * 0.08, 0.5, { type: 'triangle', gain: 0.1 }));
  },
  lose(near) {
    if (!audio()) return; const t = actx.currentTime;
    tone(near ? 330 : 240, t, 0.28, { type: 'sawtooth', gain: 0.07, slide: 0.55 }); tone(near ? 262 : 180, t + 0.1, 0.3, { type: 'sine', gain: 0.1, slide: 0.6 });
    noise(t, 0.12, 0.04, 800, 200);
  },
  streak(n) {
    if (!audio()) return; const t = actx.currentTime, root = semi(660, Math.min(n, 10));
    [0, 7, 12, 16, 19].forEach((x, i) => tone(semi(root, x), t + i * 0.05, 0.3, { type: 'triangle', gain: 0.09 }));
  },
  beat(i) { // heartbeat: faster and higher as the price closes in on your cell
    if (!audio()) return; const t = actx.currentTime, f = 52 + 38 * i;
    tone(f, t, 0.14, { gain: 0.10 + 0.22 * i, slide: 0.6 }); tone(f * 1.45, t + 0.14, 0.11, { gain: 0.06 + 0.13 * i, slide: 0.6 });
  },
  tick(n) { if (!audio()) return; tone(880 * (1 + (3 - n) * 0.26), actx.currentTime, 0.07, { type: 'square', gain: 0.045 }); },
  combo(n) { if (!audio()) return; const t = actx.currentTime, root = semi(660, Math.min(n, 6) * 2); [0, 4, 7, 12, 16, 19].forEach((x, i) => tone(semi(root, x), t + i * 0.045, 0.22, { type: 'triangle', gain: 0.11 })); noise(t, 0.2, 0.08, 3000, 9000); },
  level() { if (!audio()) return; const t = actx.currentTime; [0, 4, 7, 12, 16, 19, 24].forEach((x, i) => { tone(semi(392, x), t + i * 0.08, 0.5, { type: 'triangle', gain: 0.12 }); tone(semi(392, x) / 2, t + i * 0.08, 0.5, { gain: 0.05 }); }); noise(t + 0.3, 0.9, 0.08, 500, 9000); },
  ach() { if (!audio()) return; const t = actx.currentTime; [0, 7, 12].forEach((x, i) => tone(semi(988, x), t + i * 0.09, 0.35, { type: 'sine', gain: 0.12 })); tone(semi(988, 24), t + 0.3, 0.5, { gain: 0.06 }); },
  giftSpawn() { if (!audio()) return; const t = actx.currentTime; [0, 7, 12, 19].forEach((x, i) => tone(semi(1318, x), t + i * 0.05, 0.25, { gain: 0.06 })); },
  gift(tier) {
    if (!audio()) return; const t = actx.currentTime, root = tier === 'gold' ? 784 : tier === 'silver' ? 659 : 523, notes = tier === 'gold' ? [0, 4, 7, 12, 16, 19, 24] : tier === 'silver' ? [0, 4, 7, 12, 16] : [0, 4, 7, 12];
    notes.forEach((x, i) => { tone(semi(root, x), t + i * 0.06, 0.42, { type: 'triangle', gain: 0.14 }); tone(semi(root, x) * 2, t + i * 0.06, 0.26, { gain: 0.05 }); });
    noise(t, 0.4, 0.09, 5000, 11000); if (tier === 'gold') { tone(70, t, 0.55, { gain: 0.3, slide: 0.5 }); noise(t + 0.1, 0.7, 0.1, 400, 9000); }
  },
  error() { if (!audio()) return; const t = actx.currentTime; tone(150, t, 0.16, { type: 'square', gain: 0.06, slide: 0.7 }); },
};
const setSlowFilter = (on) => { if (lp && actx) lp.frequency.setTargetAtTime(on ? 700 : 20000, actx.currentTime, 0.07); };
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

// ---------- background music: generated live (synthwave-style loop), no audio files ----------
const BPM = 104, MSTEP = 60 / BPM / 4;       // 16th-note step in seconds
const CHORDS = [{ r: 110, t: [0, 3, 7] }, { r: 87.31, t: [0, 4, 7] }, { r: 130.81, t: [0, 4, 7] }, { r: 98, t: [0, 4, 7] }]; // Am F C G
const ARP = [0, 1, 2, 1, 2, 1, 0, 2];
let musicOn = prof.settings.music, musicGain = null, musicTimer = 0, mStep = 0, mNext = 0, musicNotes = 0;
function musicBus() {
  if (!ensureCtx()) return null;
  if (!musicGain) { musicGain = actx.createGain(); musicGain.gain.value = 0; musicGain.connect(lp); } // via lowpass => slow-mo muffles the music too
  return musicGain;
}
function setMusicVol() { if (musicGain) musicGain.gain.setTargetAtTime(musicOn ? 0.42 * prof.settings.musicVol : 0, actx.currentTime, 0.2); }
function mTone(f, t, dur, type, g, cutoff, attack = 0.004) {
  musicNotes++;
  const o = actx.createOscillator(), a = actx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  a.gain.setValueAtTime(0.0001, t); a.gain.linearRampToValueAtTime(g, t + attack); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = o; if (cutoff) { const fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff; o.connect(fl); out = fl; }
  out.connect(a); a.connect(musicGain); o.start(t); o.stop(t + dur + 0.03);
}
function mNoise(t, dur, g, f, type) {
  musicNotes++;
  const n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = actx.createBufferSource(); s.buffer = buf; const fl = actx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const a = actx.createGain();
  a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(fl); fl.connect(a); a.connect(musicGain); s.start(t);
}
function musicStep(i, t) {
  const bar = Math.floor(i / 8) % 4, k = i % 8, ch = CHORDS[bar], hot = tension > 0.3;
  if (i % 4 === 0) { // kick, four on the floor
    musicNotes++; const o = actx.createOscillator(), a = actx.createGain(); o.frequency.setValueAtTime(135, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    a.gain.setValueAtTime(0.55, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(a); a.connect(musicGain); o.start(t); o.stop(t + 0.22);
  }
  if (k === 4) { mNoise(t, 0.16, 0.16, 1700, 'bandpass'); mTone(190, t, 0.1, 'triangle', 0.12); }               // snare
  if (k % 4 === 2 || (hot && k % 2 === 1)) mNoise(t, 0.05, k % 4 === 2 ? 0.075 : 0.04, 8500, 'highpass');       // hats
  if (k === 0 || k === 3 || k === 6) mTone(ch.r, t, MSTEP * 2.3, 'sawtooth', 0.2, 430);                          // bass
  const arpHz = ch.r * 4 * Math.pow(2, ch.t[ARP[k] % 3] / 12) * (hot && k % 2 ? 2 : 1);
  mTone(arpHz, t, MSTEP * 0.95, 'square', hot ? 0.05 : 0.036, 2600);                                              // arpeggio
  if (k === 0) for (const semi of ch.t) for (const det of [-6, 6]) { const f = ch.r * 2 * Math.pow(2, semi / 12), d = f * Math.pow(2, det / 1200); mTone(d, t, MSTEP * 8.2, 'sawtooth', 0.02, 900, 0.5); } // pad
}
function musicTick() {
  if (!musicOn || !actx || document.hidden) return;
  const now0 = actx.currentTime; if (mNext < now0 - 0.3) mNext = now0 + 0.05;
  while (mNext < now0 + 0.2) { musicStep(mStep, mNext); mStep = (mStep + 1) % 32; mNext += MSTEP; }
}
function startMusic() {
  if (!musicOn || !musicBus()) return; setMusicVol();
  if (!musicTimer) { mNext = actx.currentTime + 0.1; musicTimer = setInterval(musicTick, 40); }
}
function stopMusic() { clearInterval(musicTimer); musicTimer = 0; setMusicVol(); }
function setMusic(on) { musicOn = on; prof.settings.music = on; saveProfile(prof); renderMusic(); if (on) startMusic(); else stopMusic(); }
const NOTE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="17" cy="16" r="3" fill="currentColor"/>';
function renderMusic() { $('music').className = 'icon' + (musicOn ? '' : ' off'); $('music').innerHTML = NOTE + (musicOn ? '</svg>' : '<path d="M3 3l18 18"/></svg>'); }
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { if (musicOn) startMusic(); }, { passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && musicOn && musicTimer) mNext = 0; });

// ---------- gifts: special boxes that appear now and then; touch one with the price to earn XP (no stake needed) ----------
const GIFT_TIERS = {
  bronze: { xp: 25,  pMin: 0.30,  pMax: 0.65, hue: 28,  c1: '#ffb15c', c2: '#a8500c', glow: 'rgba(255,154,61,0.95)',  ribbon: '#ffe6bf', name: 'REGALO' },
  silver: { xp: 75,  pMin: 0.10,  pMax: 0.30, hue: 205, c1: '#dcebff', c2: '#6384c4', glow: 'rgba(170,205,255,0.95)', ribbon: '#ffffff', name: 'REGALO PLATA' },
  gold:   { xp: 200, pMin: 0.025, pMax: 0.10, hue: 48,  c1: '#ffe680', c2: '#d29200', glow: 'rgba(255,210,74,1)',     ribbon: '#fff7cf', name: 'REGALO DORADO' },
};
function spawnGift(force, range) {
  const t = now(), k0 = Math.ceil((t + 8) / SLOT), k1 = k0 + 6, roll = Math.random();
  const tier = force || (roll < 0.6 ? 'bronze' : roll < 0.9 ? 'silver' : 'gold'), T = GIFT_TIERS[tier], [pMin, pMax] = range || [T.pMin, T.pMax];
  const taken = new Set(gifts.filter((g) => g.status === 'open').map((g) => g.k + ':' + g.r)), cands = [];
  for (const [key, c] of board) {
    if (c.off || taken.has(key)) continue; const [k, r] = key.split(':').map(Number);
    if (k >= k0 && k <= k1 && c.p >= pMin && c.p <= pMax) cands.push([k, r]);
  }
  if (!cands.length) return false;
  const [k, r] = cands[Math.floor(Math.random() * cands.length)];
  const g = { id: nextId++, p0: board.get(k + ':' + r).p, k, r, start: k * SLOT, end: (k + 1) * SLOT, lo: r * band, hi: (r + 1) * band, tier, xp: T.xp, status: 'open', spawnedAt: t, near: 0 };
  gifts.push(g);
  const L = layout(), cx = xOf(L, g.start) + L.cw / 2, cy = yOf(g.hi) + RH / 2;
  ring(cx, cy, T.hue, 1.2); burst(cx, cy, { n: 18, hue: T.hue, speed: 160, life: 0.7, grav: -40, size: 2.6, light: 78 }); sfx.giftSpawn();
  return true;
}
function claimGift(g) {
  g.status = 'won'; g.doneAt = now();
  const L = layout(), cx = xOf(L, g.start) + L.cw / 2, cy = yOf(g.hi) + RH / 2, T = GIFT_TIERS[g.tier];
  burst(cx, cy, { n: 50, hue: T.hue, speed: 380, life: 1, size: 3.8 }); burst(cx, cy, { n: 20, hue: 50, speed: 240, light: 80 }); ring(cx, cy, T.hue, 1.6);
  if (g.tier !== 'bronze') confetti(cx, cy, g.tier === 'gold' ? 100 : 45);
  shake(g.tier === 'gold' ? 11 : g.tier === 'silver' ? 6 : 4); sfx.gift(g.tier); buzz([20, 30, 60]);
  prof.stats.gifts = (prof.stats.gifts || 0) + 1;
  showBanner(g.tier === 'gold' ? '¡REGALO DORADO!' : '¡REGALO!', '+' + g.xp + ' XP', T.hue, g.tier === 'gold');
  addXP(g.xp); unlock('gift_1'); if (prof.stats.gifts >= 10) unlock('gift_10'); if (g.tier === 'gold') unlock('gift_gold'); persist();
}
function drawGift(g, L, th, hasBet) {
  const cw = L.cw, x0 = xOf(L, g.start), y = yOf(g.hi), age = g.doneAt ? L.t - g.doneAt : 0, T = GIFT_TIERS[g.tier];
  if (x0 > W || x0 + cw < 0) return;
  const cx = x0 + cw / 2, cy = y + RH / 2, pulse = 0.5 + 0.5 * Math.sin(L.t * 5 + g.id), grow = Math.min(1, (L.t - g.spawnedAt) / 0.45);
  const alpha = g.status === 'open' ? 1 : Math.max(0, 1 - age / 1.1), gl = 12 + 14 * pulse + 26 * (g.near || 0);
  if (g.status === 'open' && Math.random() < 0.18) parts.push({ k: 'dot', x: x0 + Math.random() * cw, y: y + Math.random() * RH, vx: 0, vy: -26, t: 0, max: 0.7, size: 1.9, h: T.hue, light: 85, grav: -20 });
  ctx.save(); ctx.globalAlpha = alpha;
  if (hasBet) { // compact corner badge when you also have a bet on this cell
    ctx.translate(x0 + cw - 11, y + 11); ctx.scale(0.9 + 0.1 * pulse, 0.9 + 0.1 * pulse);
    ctx.shadowColor = T.glow; ctx.shadowBlur = 10; ctx.fillStyle = T.c1; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = T.ribbon; ctx.fillRect(-1.5, -6, 3, 12); ctx.fillRect(-6, -1.5, 12, 3); ctx.restore(); return;
  }
  const sc = (0.55 + 0.45 * Math.min(1.25, grow * 1.25)) * (1 + 0.025 * pulse + 0.05 * (g.near || 0)) * (g.status === 'won' ? 1 + age * 0.9 : 1);
  ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
  const g0 = 1.5, rad = Math.min(8, RH / 5);
  ctx.shadowColor = T.glow; ctx.shadowBlur = gl; rr(x0 + g0, y + g0, cw - 2 * g0, RH - 2 * g0, rad);
  const fg = ctx.createLinearGradient(0, y, 0, y + RH); fg.addColorStop(0, T.c1 + 'cc'); fg.addColorStop(1, T.c2 + 'cc'); ctx.fillStyle = fg; ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = g.tier === 'gold' ? `hsl(${(L.t * 140) % 360},95%,68%)` : T.c1; ctx.lineWidth = 2; ctx.stroke();
  // gift box: lid, body, ribbon, bow
  const bw = Math.min(24, cw * 0.4), bx = cx - bw / 2, by = cy - 13;
  ctx.fillStyle = T.c2; ctx.fillRect(bx + 1, by + 8, bw - 2, 12); ctx.fillStyle = T.c1; ctx.fillRect(bx - 1, by + 3, bw + 2, 6);
  ctx.fillStyle = T.ribbon; ctx.fillRect(cx - 2, by + 3, 4, 17); ctx.beginPath(); ctx.ellipse(cx - 4.5, by + 1.5, 4.5, 3, -0.5, 0, 7); ctx.ellipse(cx + 4.5, by + 1.5, 4.5, 3, 0.5, 0, 7); ctx.fill();
  ctx.textAlign = 'center'; ctx.font = '900 12px Orbitron, system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4; ctx.fillText('+' + g.xp, cx, cy + 14); ctx.shadowBlur = 0;
  if (g.status === 'won' && age < 1.4) { ctx.globalAlpha = Math.max(0, 1 - age / 1.4); ctx.font = '900 17px Orbitron, system-ui, sans-serif'; ctx.fillStyle = '#fff3a8'; ctx.shadowColor = T.glow; ctx.shadowBlur = 14; ctx.fillText('+' + g.xp + ' XP', cx, y - 6 - age * 40); }
  ctx.restore();
}
// ---------- visual effects ----------
function burst(x, y, o = {}) {
  const { n = 16, hue = 170, speed = 240, life = 0.7, grav = 360, size = 3, light = 66, spread = Math.PI * 2, angle = 0 } = o;
  for (let i = 0; i < n; i++) {
    const a = angle + (Math.random() - 0.5) * spread, v = speed * (0.35 + Math.random() * 0.85);
    parts.push({ k: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, max: life * (0.6 + Math.random() * 0.8), size: size * (0.6 + Math.random()), h: hue + (Math.random() - 0.5) * 36, light, grav });
  }
}
function ring(x, y, hue, big = 1) { parts.push({ k: 'ring', x, y, t: 0, max: 0.55, h: hue, big }); }
function confetti(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 260 + Math.random() * 520;
    parts.push({ k: 'conf', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, max: 1.6 + Math.random() * 1.2, w: 5 + Math.random() * 6, h: Math.random() * 360, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16, grav: 620 });
  }
}
function shake(mag) { shakeMag = Math.max(shakeMag, mag); }
function showBanner(text, sub, hue, big) { banner = { text, sub, hue, big, t: 0 }; }
function stepFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt;
    if (p.t >= p.max) { parts.splice(i, 1); continue; }
    if (p.k !== 'ring') { p.vy += p.grav * dt; p.vx *= Math.pow(0.18, dt); p.x += p.vx * dt; p.y += p.vy * dt; if (p.k === 'conf') p.rot += p.vr * dt; }
  }
  shakeMag = shakeMag > 0.4 ? shakeMag * Math.exp(-dt * 8) : 0;
  if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }
}
function drawFx() {
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    const a = 1 - p.t / p.max;
    if (p.k === 'dot') { ctx.fillStyle = `hsla(${p.h},95%,${p.light}%,${a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, 7); ctx.fill(); }
    else if (p.k === 'ring') { const r = 8 + (1 - a) * 90 * p.big; ctx.strokeStyle = `hsla(${p.h},95%,70%,${a * 0.9})`; ctx.lineWidth = 1 + 4 * a; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke(); }
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const p of parts) {
    if (p.k !== 'conf') continue;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 1.7)); ctx.fillStyle = `hsla(${p.h},90%,62%,${Math.min(1, (1 - p.t / p.max) * 1.6)})`;
    ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2); ctx.restore();
  }
  if (banner) {
    const b = banner, fade = b.t > 1.6 ? 1 - (b.t - 1.6) / 0.6 : 1, pop = 1 + 0.45 * Math.max(0, 1 - b.t / 0.28) ** 2;
    const fs = (W < 600 ? 0.62 : 1) * (b.big ? 54 : 34), cx = W / 2, cy = TOP + (H - TOP) * 0.24 - b.t * 10;
    ctx.save(); ctx.globalAlpha = Math.max(0, fade); ctx.translate(cx, cy); ctx.scale(pop, pop); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `400 ${fs * 0.86}px Bungee, system-ui, sans-serif`; ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(5,8,16,0.85)'; ctx.strokeText(b.text, 0, 0);
    const g = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2); g.addColorStop(0, `hsl(${b.hue},95%,80%)`); g.addColorStop(1, `hsl(${b.hue + 40},95%,58%)`);
    ctx.shadowColor = `hsl(${b.hue},95%,60%)`; ctx.shadowBlur = 26; ctx.fillStyle = g; ctx.fillText(b.text, 0, 0); ctx.shadowBlur = 0;
    if (b.sub) { ctx.font = `700 ${fs * 0.5}px Rajdhani, system-ui, sans-serif`; ctx.fillStyle = '#eef2fb'; ctx.fillText(b.sub, 0, fs * 0.82); }
    ctx.restore();
  }
}
function nearMiss(b) {
  let best = Infinity;
  for (const h of hist) {
    if (h.t < b.start - 1 || h.t > b.end + 0.5) continue;
    const d = h.p < b.lo ? b.lo - h.p : h.p >= b.hi ? h.p - b.hi : 0;
    if (d < best) best = d;
  }
  return best <= band * 0.6;
}
const FLAME = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 1.5c.4 3-1.3 4.6-2.8 6.3C9 9.6 7.5 11.2 7.5 14a4.5 4.5 0 0 0 9 0c0-1.5-.6-2.6-1.4-3.6.1 1.2-.4 2-1.1 2.3.5-3.3-.6-6.7-.5-11.2z"/><path d="M12 22a6 6 0 0 1-6-6c0-1.7.8-3.1 1.7-4.2C8.4 14.5 10 16 12 16s3.6-1.5 4.3-4.2C17.2 12.9 18 14.3 18 16a6 6 0 0 1-6 6z" opacity=".55"/></svg>';
function renderStreak(popIt) {
  const el = $('streak'); el.className = 'streak' + (streak >= 2 ? ' on' : '');
  el.innerHTML = FLAME + '<span>RACHA ×' + streak + '</span>'; el.title = 'Mejor racha: ' + bestStreak;
  if (popIt && streak >= 2) { void el.offsetWidth; el.classList.add('pop'); }
}
const SPK = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/>';
function renderMute() { $('mute').className = 'icon' + (muted ? ' muted' : ''); $('mute').innerHTML = SPK + (muted ? '<path d="m22 9-6 6M16 9l6 6"/></svg>' : '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>'); }

// ---------- asset mark (coin logo + symbol) shown in the history zone ----------
const COINS = {
  BTC: { name: 'Bitcoin', c: '#f7931a', svg: '<svg viewBox="0 0 48 48"><defs><linearGradient id="gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc15a"/><stop offset="1" stop-color="#f7931a"/></linearGradient></defs><circle cx="24" cy="24" r="22" fill="url(#gb)"/><path d="M20.5 9.5v4.5M26.5 9.5v4.5M20.5 34v4.5M26.5 34v4.5" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M16.5 14h11a5.2 5.2 0 0 1 0 10.4h-11zM16.5 24.4h12.5a5.3 5.3 0 0 1 0 10.6H16.5z" fill="#fff"/><path d="M21 18h6a1.4 1.4 0 0 1 0 2.8h-6zM21 28.6h7.2a1.5 1.5 0 0 1 0 3H21z" fill="#f7931a"/></svg>' },
  SOL: { name: 'Solana', c: '#9945ff', svg: '<svg viewBox="0 0 48 48"><defs><linearGradient id="gs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9945ff"/><stop offset="1" stop-color="#14f195"/></linearGradient></defs><circle cx="24" cy="24" r="22" fill="#12081f" stroke="url(#gs)" stroke-width="2.5"/><path d="M15 15.5h20.5l-3.5 4.5H11.5zM15 28h20.5l-3.5 4.5H11.5zM32 21.8H11.5l3.5 4.5H35.5z" fill="url(#gs)" transform="translate(0 -1)"/></svg>' },
  ETH: { name: 'Ethereum', c: '#627eea', svg: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#1b2350" stroke="#627eea" stroke-width="2.5"/><path d="M24 8l9.5 15.5L24 29z" fill="#a9b8ff"/><path d="M24 8l-9.5 15.5L24 29z" fill="#fff"/><path d="M24 31.5l9.5-6.2L24 40z" fill="#a9b8ff"/><path d="M24 31.5l-9.5-6.2L24 40z" fill="#fff"/></svg>' },
};
function renderAssetMark() {
  const el = $('asset'), sym = asset.split('-')[0], co = COINS[sym]; if (!el || !co) return;
  el.style.setProperty('--ac', co.c);
  el.innerHTML = co.svg + '<div><b>' + sym + '</b><small>' + co.name + ' · ' + asset.replace('-', ' / ') + '</small></div>';
}
const nowX = () => Math.round(W * (W < 820 ? 0.22 : 0.40));
function placeAssetMark() {
  const el = $('asset'); if (!el) return;
  const xn = nowX();
  el.style.left = xn / 2 + 'px'; el.style.top = TOP + 52 + 'px'; el.style.display = xn < 170 ? 'none' : 'flex';
}
// ---------- UI ----------
function renderTabs() {
  $('tabs').innerHTML = '';
  for (const a of ASSETS) {
    const b = document.createElement('button');
    b.textContent = a.split('-')[0]; b.className = a === asset ? 'on' : '';
    b.onclick = () => {
      if (a === asset) return;
      if (bets.some((x) => x.status === 'open')) return toast('Espera a que terminen tus apuestas abiertas', 'l');
      asset = a; localStorage.setItem('tl.asset', a); renderTabs(); connect();
    };
    $('tabs').append(b);
  }
  renderAssetMark();
}
function renderStakes() {
  $('stakes').innerHTML = '';
  for (const s of STAKES) {
    const b = document.createElement('button');
    b.textContent = '$' + fmtStake(s); b.className = s === stake ? 'on' : '';
    b.onclick = () => { stake = s; localStorage.setItem('tl.stake', s); renderStakes(); };
    $('stakes').append(b);
  }
}
let flashT;
function renderBal(dir) {
  $('bal').textContent = fmt$(balance); localStorage.setItem('tl.bal', balance);
  if ($('wal') && !$('wal').classList.contains('hide')) renderWallet();
  if (dir) {
    const bx = $('balbox'); bx.className = 'bal ' + dir; clearTimeout(flashT);
    flashT = setTimeout(() => { bx.className = 'bal'; }, 700);
  }
}
let toastT;
function toast(text, kind) {
  const t = $('toast'); t.textContent = text; t.style.color = kind === 'l' ? 'var(--loss)' : 'var(--text)';
  t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}
const form = [];   // last results, newest last: 'w' | 'l'
function renderStats() {
  const p = $('pnl'); p.textContent = (pnl >= 0 ? '+' : '−') + fmt$(Math.abs(pnl)); p.className = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
  const tot = wins + losses; $('wl').textContent = wins + ' / ' + tot;
  $('wrbar').style.width = (tot ? (100 * wins) / tot : 0) + '%';
  $('strk').textContent = streak >= 2 ? 'RACHA ×' + streak : '';
  $('form').innerHTML = Array.from({ length: 10 }, (_, i) => { const r = form[form.length - 10 + i]; return '<i class="' + (r || '') + '"></i>'; }).join('');
}
function logResult(bet) {
  form.push(bet.status === 'won' ? 'w' : 'l'); if (form.length > 30) form.shift(); renderStats();
  const won = bet.status === 'won', profit = won ? bet.stake * (bet.mult - 1) : -bet.stake, big = won && bet.mult >= 8;
  const d = document.createElement('div'); d.className = won ? (big ? 'w big' : 'w') : 'l';
  d.innerHTML = `<span class="ico">${won ? '✓' : '✗'}</span><span class="m">${bet.mult >= 10 ? bet.mult.toFixed(1) : bet.mult.toFixed(2)}x</span><span class="t">${big ? 'Jackpot' : won ? 'Acierto' : 'Fallo'}</span><b class="p">${profit >= 0 ? '+' : '−'}${fmt$(Math.abs(profit))}</b>`;
  $('log').prepend(d);
  while ($('log').children.length > 6) $('log').lastChild.remove();
}
// ---------- progression: XP, levels, achievements, daily mission, share ----------
const persist = () => saveProfile(prof);
function renderLevel() { $('lvlav').innerHTML = avatarInner(prof.avatar, 32); const li = levelInfo(prof.xp); $('lvlnum').textContent = 'NV ' + li.level; $('lvlbar').style.width = (100 * li.cur / li.need) + '%'; }
function addXP(n) {
  const before = levelInfo(prof.xp).level; prof.xp += n; const after = levelInfo(prof.xp).level; persist(); renderLevel();
  if (after > before) {
    const unlocked = THEMES.filter((t) => t.lvl > before && t.lvl <= after).map((t) => 'Tema ' + t.name + ' desbloqueado');
    showBanner('NIVEL ' + after, unlocked[0] || 'sigue subiendo', 48, true); sfx.level(); confetti(W / 2, H * 0.4, 90); buzz([20, 30, 20, 30, 60]);
  }
}
function achToast(title, text, xp) {
  const d = document.createElement('div'); d.innerHTML = '<b>★ ' + title + '</b>' + (xp ? '<em>+' + xp + ' XP</em>' : '') + text;
  $('ach').append(d); setTimeout(() => d.remove(), 4200); while ($('ach').children.length > 3) $('ach').firstChild.remove();
}
function unlock(id) {
  if (prof.ach[id]) return; const a = ACHIEVEMENTS.find((x) => x.id === id); if (!a) return;
  prof.ach[id] = Date.now(); persist(); achToast('Logro desbloqueado', a.name + ' — ' + a.desc, a.xp); sfx.ach(); addXP(a.xp);
}
function missionEvent(type, val) {
  const mi = prof.mission; if (!mi || mi.done) return;
  const def = MISSIONS.find((x) => x.id === mi.id); if (!def) return;
  if (mi.id === 'taps15' && type === 'bet') mi.prog++;
  else if (mi.id === 'win3x3' && type === 'win' && val >= 3) mi.prog++;
  else if (mi.id === 'streak3' && type === 'streak' && val >= 3) mi.prog = 1;
  else if (mi.id === 'big10' && type === 'win' && val >= 10) mi.prog = 1;
  else if (mi.id === 'profit20' && type === 'pnl') mi.prog = Math.max(mi.prog, val);
  else return;
  if (mi.prog >= def.target) { mi.done = true; achToast('Misión diaria cumplida', def.text, def.xp); sfx.ach(); addXP(def.xp); }
  persist();
}
function offerShare(profit, mult) {
  lastBig = { profit, mult, asset }; const s = $('share'); s.classList.add('on');
  clearTimeout(shareT); shareT = setTimeout(() => s.classList.remove('on'), 10000);
}
async function shareCard() {
  const d = lastBig; if (!d) return toast('Aún no tienes una victoria grande para compartir');
  const th = theme(), c = document.createElement('canvas'); c.width = 1200; c.height = 630; const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 1200, 630); bg.addColorStop(0, '#0a0f1c'); bg.addColorStop(1, '#070a12'); g.fillStyle = bg; g.fillRect(0, 0, 1200, 630);
  const glow = g.createRadialGradient(600, 300, 0, 600, 300, 520); glow.addColorStop(0, `rgba(${th.glow},0.28)`); glow.addColorStop(1, `rgba(${th.glow},0)`); g.fillStyle = glow; g.fillRect(0, 0, 1200, 630);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '400 38px Bungee, system-ui, sans-serif'; g.fillStyle = th.dot; g.fillText('T A P L I N E', 600, 70);
  g.font = '900 150px Orbitron, system-ui, sans-serif'; g.shadowColor = `rgba(${th.glow},0.9)`; g.shadowBlur = 40; g.fillStyle = '#ffffff'; g.fillText('+' + fmt$(d.profit), 600, 280); g.shadowBlur = 0;
  g.font = '700 74px Rajdhani, system-ui, sans-serif'; g.fillStyle = '#3dff8a'; g.fillText(d.mult.toFixed(1) + 'x  ·  ' + d.asset, 600, 410);
  g.font = '600 32px Rajdhani, system-ui, sans-serif'; g.fillStyle = '#8693b0'; g.fillText('Nivel ' + levelInfo(prof.xp).level + '  ·  racha máx. ' + prof.stats.bestStreak, 600, 480);
  g.font = '500 26px Rajdhani, system-ui, sans-serif'; g.fillText('Modo práctica · sin dinero real · ' + location.host + location.pathname, 600, 565);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png')), file = new File([blob], 'tapline-win.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Tapline', text: '+' + fmt$(d.profit) + ' (' + d.mult.toFixed(1) + 'x) en Tapline' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tapline-win.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Imagen descargada');
}
function renderProfile() {
  const li = levelInfo(prof.xp), st = prof.stats, mi = prof.mission, def = mi && MISSIONS.find((x) => x.id === mi.id);
  const pct = st.bets ? Math.round((100 * st.wins) / Math.max(1, st.wins + st.losses)) : 0;
  $('profbody').innerHTML = `
    <div class="row"><div class="who"><span class="av big">${avatarInner(prof.avatar, 84)}</span><div><input class="nameinp" id="nameInp" maxlength="14" value="${esc(prof.name)}" aria-label="Nombre"><h2 style="font-size:22px">NIVEL ${li.level}</h2><div class="sub">${li.cur} / ${li.need} XP · racha diaria de ${prof.dayStreak} día(s)</div></div></div><button class="btn" id="profclose">Cerrar</button></div>
    <div class="xpbar"><u style="width:${(100 * li.cur / li.need).toFixed(1)}%"></u></div>
    <h3>Avatar</h3>
    <div class="avgrid">${AVATAR_SEEDS.map((sd) => `<button class="avb ${prof.avatar.type === 'pixel' && prof.avatar.seed === sd ? 'on' : ''}" data-seed="${sd}" title="${sd}">${pixelAvatarSVG(sd, 54)}</button>`).join('')}
      <button class="btn" id="avrand">Aleatorio</button><button class="btn" id="avup">Subir foto</button><input type="file" id="avfile" accept="image/*" hidden></div>
    <div class="sub" style="margin-top:6px">Tu foto se reduce a 96×96 y se queda solo en este navegador.</div>
    <h3>Dificultad</h3>
    <div class="themes">${Object.entries(DIFFICULTY).map(([id, d]) => `<button data-diff="${id}" class="${(DIFFICULTY[prof.settings.difficulty] ? prof.settings.difficulty : 'normal') === id ? 'on' : ''}" style="color:#e8ebf1">${d.name} · casa ${Math.round(d.edge * 100)} %</button>`).join('')}</div>
    <div class="sub" style="margin-top:8px">Retorno esperado: <b style="color:var(--text)">${Math.round((1 - houseEdge()) * 100)} %</b> de lo apostado (la casa se queda ${Math.round(houseEdge() * 100)} %). Es un promedio de muchas apuestas: en una sesión corta puedes ganar o perder bastante más. Las probabilidades se ajustan con precios reales de Coinbase${oddsDoc ? ' (cuotas del tuner con datos hasta ' + (oddsDoc.data_until || oddsDoc.updated || '').slice(0, 16).replace('T', ' ') + ' UTC)' : ' (calibración integrada)'}.</div>
    <h3>Sonido</h3>
    <div class="setrow"><label><input type="checkbox" id="setMusic" ${musicOn ? 'checked' : ''}> Música de fondo</label><input type="range" id="volMusic" min="0" max="100" value="${Math.round(prof.settings.musicVol * 100)}"></div>
    <div class="setrow"><label><input type="checkbox" id="setSfx" ${muted ? '' : 'checked'}> Efectos de sonido</label><input type="range" id="volSfx" min="0" max="100" value="${Math.round(prof.settings.sfxVol * 100)}"></div>
    <h3>Misión de hoy</h3>
    <div class="tile ${mi && mi.done ? 'got' : ''}" style="opacity:1;border-color:rgba(44,245,210,.5)"><b>${def ? def.text : '—'}</b>${mi ? (mi.done ? 'Cumplida · +' + def.xp + ' XP' : (Number.isInteger(mi.prog) ? Math.min(mi.prog, def.target) : Math.min(mi.prog, def.target).toFixed(2)) + ' / ' + def.target + ' · recompensa ' + def.xp + ' XP') : ''}</div>
    <h3>Estadísticas</h3>
    <div class="stat4"><div class="tile"><b class="num">${st.bets}</b><span>apuestas</span></div><div class="tile"><b class="num">${st.gifts || 0}</b><span>regalos</span></div><div class="tile"><b class="num">${pct}%</b><span>aciertos</span></div><div class="tile"><b class="num">×${st.bestStreak}</b><span>mejor racha</span></div><div class="tile"><b class="num">${fmt$(st.biggest)}</b><span>mayor premio</span></div></div>
    <h3>Estilo de la línea de precio</h3>
    <div class="themes">${THEMES.map((t) => `<button data-th="${t.id}" class="${t.id === theme().id ? 'on' : ''}" ${li.level < t.lvl ? 'disabled' : ''} style="color:${t.dot}">${t.name}${li.level < t.lvl ? ' · Nv ' + t.lvl : ''}</button>`).join('')}</div>
    <h3>Logros · ${Object.keys(prof.ach).length} / ${ACHIEVEMENTS.length}</h3>
    <div class="grid2">${ACHIEVEMENTS.map((a) => `<div class="tile ach ${prof.ach[a.id] ? 'got' : ''}"><span class="medal">${prof.ach[a.id] ? '★' : '?'}</span><div><b>${a.name}</b>${a.desc}</div></div>`).join('')}</div>
    <h3>Compartir</h3>
    <button class="btn pri" id="profshare">Compartir mi última victoria grande</button>`;
  $('profclose').onclick = closeProfile; $('profshare').onclick = shareCard; bindProfileExtras();
  $('profbody').querySelectorAll('[data-th]').forEach((b) => { b.onclick = () => { prof.theme = b.dataset.th; persist(); renderProfile(); }; });
}
function openProfile() { renderProfile(); $('prof').classList.remove('hide'); }
function closeProfile() { $('prof').classList.add('hide'); }
// ---- avatar, name
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function avatarInner(av, size) { return av && av.type === 'img' ? '<img alt="" src="' + av.data + '">' : pixelAvatarSVG(av ? av.seed : 'ace', size); }
function setAvatar(av) { prof.avatar = av; persist(); renderLevel(); if (!$('prof').classList.contains('hide')) renderProfile(); if (!$('wal').classList.contains('hide')) renderWallet(); }
function uploadAvatar(file) {
  if (!file || !/^image\//.test(file.type)) return toast('Elige un archivo de imagen', 'l');
  if (file.size > 6e6) return toast('La imagen pesa más de 6 MB', 'l');
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'), s = Math.min(img.width, img.height);
    g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96); URL.revokeObjectURL(url);
    setAvatar({ type: 'img', data: c.toDataURL('image/jpeg', 0.85) }); toast('Avatar actualizado');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('No pude leer esa imagen', 'l'); };
  img.src = url;
}
// ---- fake wallet (simulated: no keys, no network, no real funds)
if (!prof.wallet.addr) { prof.wallet.addr = makeAddr(); persist(); }
const WTYPES = { deposit: ['dep', '↓', 'Depósito'], withdraw: ['wd', '↑', 'Retiro'], bet: ['bet', '−', 'Apuesta'], payout: ['payout', '+', 'Premio'] };
function renderWallet() {
  const rows = prof.wallet.ledger.slice(-14).reverse().map((e) => {
    const [cls, ico, label] = WTYPES[e.type] || ['bet', '·', e.type], d = new Date(e.t);
    return `<div class="${cls}"><i>${ico}</i><span>${label}<small>${e.sig}… · ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</small></span><b>${e.amount >= 0 ? '+' : '−'}${fmt$(Math.abs(e.amount))}</b></div>`;
  }).join('');
  $('walbody').innerHTML = `
    <div class="row"><div class="who"><span class="av big">${avatarInner(prof.avatar, 84)}</span><div><h2>WALLET</h2><div class="sub">${esc(prof.name)} · Solana Devnet (simulada)</div></div></div><button class="btn" id="walclose">Cerrar</button></div>
    <div class="walcard" style="margin-top:14px"><small>Saldo disponible</small><b class="big">${fmt$(balance)} <i>USDC ficticio</i></b>
      <div class="addr"><code title="${prof.wallet.addr}">${shortAddr(prof.wallet.addr)}</code><button class="btn" id="walcopy">Copiar dirección</button></div>
      <div class="warn">Wallet de práctica: la dirección y los fondos son ficticios. No guarda claves y no se conecta a ninguna red. No envíes dinero real aquí.</div></div>
    <h3>Depositar (ficticio)</h3><div class="chips">${[100, 500, 1000, 5000].map((n) => `<button class="btn" data-dep="${n}">+${fmt$(n).replace('.00', '')}</button>`).join('')}</div>
    <h3>Retirar (ficticio)</h3><div class="chips">${[100, 500, 1000].map((n) => `<button class="btn" data-wd="${n}">−${fmt$(n).replace('.00', '')}</button>`).join('')}<button class="btn" data-wd="all">Todo</button></div>
    <h3>Actividad</h3><div class="ledger">${rows || '<div class="empty">Sin movimientos todavía.</div>'}</div>`;
  $('walclose').onclick = closeWallet;
  $('walcopy').onclick = async () => { try { await navigator.clipboard.writeText(prof.wallet.addr); toast('Dirección copiada (ficticia)'); } catch { toast('No pude copiar en este navegador', 'l'); } };
  $('walbody').querySelectorAll('[data-dep]').forEach((b) => { b.onclick = () => walletMove(+b.dataset.dep); });
  $('walbody').querySelectorAll('[data-wd]').forEach((b) => { b.onclick = () => walletMove(-(b.dataset.wd === 'all' ? balance : +b.dataset.wd)); });
}
function walletMove(amt) {
  if (amt > 0 && balance + amt > 1e6) return toast('Límite de saldo ficticio: $1,000,000', 'l');
  if (amt < 0 && -amt > balance + 1e-9) return toast('Saldo insuficiente', 'l');
  if (Math.abs(amt) < 0.01) return;
  balance = Math.max(0, balance + amt); addLedger(prof, amt > 0 ? 'deposit' : 'withdraw', amt); persist();
  renderBal(amt > 0 ? 'up' : 'down'); renderWallet(); sfx.tap(3); toast((amt > 0 ? 'Depósito' : 'Retiro') + ' ficticio: ' + fmt$(Math.abs(amt)));
}
function openWallet() { renderWallet(); $('wal').classList.remove('hide'); }
function closeWallet() { $('wal').classList.add('hide'); }
$('balbox').onclick = openWallet;
$('wal').addEventListener('pointerdown', (e) => { if (e.target === $('wal')) closeWallet(); });
// ---- profile extras: name, avatar picker, sound settings
function bindProfileExtras() {
  const ni = $('nameInp');
  ni.oninput = () => { const v = ni.value.replace(/[^\p{L}\p{N} _-]/gu, '').toUpperCase().slice(0, 14); ni.value = v; prof.name = v.trim() || 'JUGADOR'; persist(); };
  $('profbody').querySelectorAll('[data-seed]').forEach((b) => { b.onclick = () => setAvatar({ type: 'pixel', seed: b.dataset.seed }); });
  $('avrand').onclick = () => setAvatar({ type: 'pixel', seed: 'r' + Math.random().toString(36).slice(2, 8) });
  $('avfile').onchange = () => uploadAvatar($('avfile').files[0]);
  $('avup').onclick = () => $('avfile').click();
  $('setMusic').onchange = (e) => setMusic(e.target.checked);
  $('volMusic').oninput = (e) => { prof.settings.musicVol = e.target.value / 100; persist(); if (!musicOn && prof.settings.musicVol > 0) { setMusic(true); $('setMusic').checked = true; } setMusicVol(); };
  $('setSfx').onchange = (e) => { muted = !e.target.checked; localStorage.setItem('tl.mute', muted ? '1' : '0'); renderMute(); if (!muted) sfx.tap(3); };
  $('volSfx').oninput = (e) => { prof.settings.sfxVol = e.target.value / 100; persist(); if (master) master.gain.setTargetAtTime(0.55 * prof.settings.sfxVol, actx.currentTime, 0.03); };
  $('volSfx').onchange = () => sfx.tap(4);
  $('profbody').querySelectorAll('[data-diff]').forEach((b) => { b.onclick = () => { prof.settings.difficulty = b.dataset.diff; persist(); boardAt = 0; renderProfile(); toast('Dificultad: ' + DIFFICULTY[b.dataset.diff].name + ' (casa ' + Math.round(DIFFICULTY[b.dataset.diff].edge * 100) + ' %)'); }; });
}
$('lvl').onclick = openProfile; $('share').onclick = shareCard; $('music').onclick = () => { setMusic(!musicOn); };
$('prof').addEventListener('pointerdown', (e) => { if (e.target === $('prof')) closeProfile(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeProfile(); closeWallet(); $('indpop').classList.add('hide'); } });

renderTabs(); renderStakes(); renderBal(); renderStats(); renderStreak(); renderMute(); renderMusic(); renderLevel();
const dc = dailyCheck(prof); persist();
if (dc) setTimeout(() => { achToast('Racha diaria · día ' + dc.streak, 'Vuelve mañana para seguir sumando', dc.xp); addXP(dc.xp); }, 1800);
$('mute').onclick = () => { muted = !muted; localStorage.setItem('tl.mute', muted ? '1' : '0'); renderMute(); if (!muted) { audio(); sfx.tap(3); } };
$('reset').onclick = () => {
  if (bets.some((b) => b.status === 'open')) return toast('Espera a que terminen tus apuestas abiertas', 'l');
  balance = START_BAL; wins = losses = pnl = 0; renderBal(); renderStats(); toast('Saldo reiniciado a $1,000');
};
const helpSeen = localStorage.getItem('tl.help');
if (helpSeen) $('help').classList.add('hide');
$('helpok').onclick = () => { $('help').classList.add('hide'); localStorage.setItem('tl.help', '1'); };
$('helpbtn').onclick = () => $('help').classList.toggle('hide');

function setLive(ok, text) { $('live').className = 'live' + (ok ? ' ok' : ''); $('livetxt').textContent = text; }

// ---------- price feed ----------
function connect() {
  clearTimeout(wsTimer);
  if (ws) { ws.onclose = null; ws.close(); }
  gifts.length = 0; nextGift = now() + 10;
  dispP = 0; bars = []; closes1 = []; histGain = 1;   hist = []; last = null; first = null; vol = new Vol(); board = new Map(); band = 1; center = 0;
  $('price').textContent = '—'; $('price').className = ''; $('chg').textContent = '';
  $('msg').style.display = 'block'; $('msg').textContent = 'Conectando al precio en vivo…'; setLive(false, 'CONECTANDO');
  ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', product_ids: [asset], channels: ['ticker'] }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'ticker' && m.price) onTick(now(), +m.price);
  };
  ws.onclose = () => { wsTimer = setTimeout(connect, 2000); setLive(false, 'RECONECTANDO'); };
}
// Row height in price units, chosen so the cells the price can realistically reach (~60 s out) fill most of the screen.
function pickBand(S, sigma) {
  const reach = 2.4 * sigma * S * Math.sqrt(60);              // price distance reachable with ~1% probability
  const rows = Math.max(8, (H - TOP) / RH) * 0.8;
  const target = Math.max((2 * reach) / rows, S * 1e-6);
  const e = Math.floor(Math.log10(target));
  let best = 1, bd = Infinity;
  for (const c of [1, 2, 5, 10]) { const d = Math.abs(Math.log((c * 10 ** e) / target)); if (d < bd) { bd = d; best = c * 10 ** e; } }
  return best;
}
function onTick(t, p) {
  const cur = { t, p };
  if (!last) { band = pickBand(p, vol.sigma); center = p; first = p; $('msg').style.display = 'none'; setLive(true, 'EN VIVO'); }
  const prev = last || cur;
  hist.push(cur); pushTick(bars, t, p, prof.settings.ind.bar); pushTick(closes1, t, p, 1, 400);
  while (hist.length > 4000 || (hist.length && t - hist[0].t > 600)) hist.shift();
  vol.add(t, p); last = cur; lastTickAt = t;
  const el = $('price'), d = p > prev.p ? 'up' : p < prev.p ? 'down' : null;
  el.textContent = p.toLocaleString('en-US', { minimumFractionDigits: p > 1000 ? 2 : 3, maximumFractionDigits: p > 1000 ? 2 : 3 });
  if (d) el.className = d;
  const ch = ((p - first) / first) * 100;
  $('chg').textContent = (ch >= 0 ? '▲ ' : '▼ ') + Math.abs(ch).toFixed(2) + '%'; $('chg').style.color = ch >= 0 ? 'var(--win)' : 'var(--loss)';
  resolve(prev, cur);
}
function resolve(prev, cur) {
  for (const g of gifts) {
    if (g.status !== 'open') continue;
    const s = stepBet(g, prev, cur);
    if (s === 'won') claimGift(g); else if (s === 'lost') { g.status = 'lost'; g.doneAt = now(); }
  }
  for (const b of bets) {
    if (b.status !== 'open') continue;
    const s = stepBet(b, prev, cur);
    if (s !== 'open') settle(b, s, cur.t);
  }
}
function settle(b, s, tt) {
  b.status = s; b.settledAt = now();
  const L = layout(), cx = xOf(L, b.start) + L.cw / 2, cy = yOf(b.hi) + RH / 2, profit = b.stake * (b.mult - 1);
  if (s === 'won') {
    balance += b.stake * b.mult; addLedger(prof, 'payout', b.stake * b.mult); wins++; pnl += profit; streak++; bestStreak = Math.max(bestStreak, streak); renderBal('up');
    const big = b.mult >= 8, mega = b.mult >= 25;
    burst(cx, cy, { n: big ? 70 : 34, hue: 140, speed: big ? 420 : 300, life: 0.9, size: big ? 4 : 3 }); burst(cx, cy, { n: 18, hue: 50, speed: 220, light: 75 });
    ring(cx, cy, 140, big ? 1.8 : 1);
    if (big) { confetti(cx, cy, mega ? 160 : 90); shake(mega ? 16 : 9); showBanner(mega ? 'MEGA WIN!' : 'BIG WIN!', '+' + fmt$(profit) + '  ·  ' + b.mult.toFixed(1) + 'x', mega ? 300 : 140, true); }
    else shake(3 + Math.min(b.mult, 6));
    sfx.win(b.mult, streak); buzz(big ? [30, 40, 80] : 25);
    if ([3, 5, 7, 10, 15, 20].includes(streak)) { setTimeout(() => sfx.streak(streak), 380); if (!big) showBanner('RACHA ×' + streak, 'sigue así', 28, false); }
    renderStreak(true);
    const hadLoss = lossRun; lossRun = 0; prof.stats.wins++; prof.stats.biggest = Math.max(prof.stats.biggest, profit); prof.stats.bestStreak = Math.max(prof.stats.bestStreak, streak);
    addXP(10 + Math.round(9 * Math.log(b.mult + 1)) + (big ? 40 : 0));
    unlock('first_win'); if (b.mult >= 10) unlock('win_10x'); if (b.mult >= 25) unlock('win_25x');
    if (streak >= 3) unlock('streak_3'); if (streak >= 5) unlock('streak_5'); if (streak >= 10) unlock('streak_10');
    if (tt && tt > b.end - 0.6) unlock('last_second');
    if (hadLoss >= 3) unlock('comeback');
    if (balance >= 1500) unlock('rich');
    const cm = comboMap.get(b.k), cn = cm && now() - cm.t < 8 ? cm.n + 1 : 1; comboMap.set(b.k, { n: cn, t: now() });
    if (cn >= 2) { unlock('combo_2'); sfx.combo(cn); shake(7); burst(cx, cy, { n: 40, hue: 300, speed: 380, life: 0.9 }); if (!big) showBanner('COMBO ×' + cn, 'misma columna', 300, false); }
    missionEvent('win', b.mult); if (streak >= 3) missionEvent('streak', streak); missionEvent('pnl', pnl);
    if (big) offerShare(profit, b.mult);
    persist();
  } else {
    losses++; pnl -= b.stake; const near = nearMiss(b), had = streak; streak = 0; lossRun++; prof.stats.losses++; addXP(2);
    if (near) { prof.stats.near++; if (prof.stats.near >= 5) unlock('near_5'); persist(); }
    burst(cx, cy, { n: 16, hue: 350, speed: 140, life: 0.8, grav: 520, size: 2.6, light: 60 });
    if (near) showBanner('¡POR POCO!', null, 38, false);
    else if (had >= 3) showBanner('Racha perdida', null, 350, false);
    sfx.lose(near); buzz(near ? [20, 30, 20] : 15); renderStreak(false);
  }
  renderStats(); logResult(b);
}
let lastRebalance = 0;
setInterval(() => {
  if (!last) return;
  // re-fit the row height to volatility, but only when no bet is on screen (bets are anchored to the row grid)
  if (last && now() >= nextGift && board.size && gifts.filter((g) => g.status === 'open').length < 2) { if (spawnGift()) nextGift = now() + 18 + Math.random() * 24; else nextGift = now() + 4; }
  if (bets.length === 0 && gifts.length === 0 && now() - lastRebalance > 4) {
    lastRebalance = now(); const nb = pickBand(last.p, vol.sigma), q = nb / band;
    if (q > 1.6 || q < 0.62) { band = nb; boardAt = 0; }
  }
  resolve(last, { t: now(), p: last.p });
  bets = bets.filter((b) => b.status === 'open' || now() - b.settledAt < 4);
  for (let i = gifts.length - 1; i >= 0; i--) if (gifts[i].status !== 'open' && now() - gifts[i].doneAt > 1.6) gifts.splice(i, 1);
  if (now() - lastTickAt > 8) setLive(false, 'SIN DATOS');
}, 500);

// ---------- geometry ----------
function layout() {
  const t = now();
  const xNow = nowX();
  const pps = (RH * ASPECT) / SLOT;       // a SLOT-second column is exactly ASPECT x as wide as a row is tall
  return { t, xNow, pps, cw: RH * ASPECT };
}
const xOf = (L, t) => L.xNow + (t - L.t) * L.pps;
const midY = () => (H + TOP) / 2;
const yOf = (p) => midY() - ((p - center) / band) * RH;
const priceAtY = (y) => center + ((midY() - y) / RH) * band;

function recompute(L) {
  if (!last) return;
  const half = Math.ceil(H / 2 / RH) + 3, cr = Math.floor(center / band);
  pushTick(closes1, L.t, last.p, 1, 400); const mctx = marketContext(closes1.map((b) => b.c), vol.sigma), od = oddsFor(oddsDoc, asset);
  board = computeBoard({
    S: last.p, sigma: vol.sigma, now: L.t,
    slotFrom: Math.ceil((L.t + LOCK) / SLOT),
    slotTo: Math.floor((L.t + STEPS * DT) / SLOT) - 1, slot: SLOT,
    rowFrom: cr - half, rowTo: cr + half, band,
    edge: houseEdge(), cal: od.knots, adj: od.adj, ctx: mctx.ready ? mctx : null,
  });
  boardAt = L.t;
}

// ---------- drawing ----------
const hue = (m) => { // low = green/cyan, mid = blue/violet, high = pink, jackpot = orange/gold
  const t = Math.min(1, Math.log(Math.max(m, 1)) / Math.log(40));
  return t < 0.78 ? 150 + (t / 0.78) * 180 : 330 + ((t - 0.78) / 0.22) * 72;
};
function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const fmtMult = (m) => (m >= 10 ? m.toFixed(1) : m.toFixed(2)) + 'x';
const fmtPrice = (v) => v.toFixed(band < 0.01 ? 3 : band < 1 ? 2 : 0);

// Draws a smooth curve through pts ([[x,y],...]) using quadratic segments between midpoints (caller does beginPath/stroke).
function smoothPath(pts) {
  if (!pts.length) return; ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}
// ---------- technical indicators (basic): two moving averages and RSI ----------
const IND_RGB = { ma1: '44,245,210', ma2: '255,94,242' };
function drawIndicators(L, hx, hy, Wh, reach, indOn, rsiOn) {
  const ind = prof.settings.ind; if (!indOn || !bars.length) return;
  pushTick(bars, L.t, last.p, ind.bar);   // keep the forming bar current even when no trade printed this second
  const closes = bars.map((b) => b.c), step = ind.bar, ageOf = (i) => Math.max(0, L.t - Math.min(bars[i].t0 + step, L.t)), dec = last.p > 1000 ? 2 : 3;
  let ly = TOP + 128; ctx.font = '700 12.5px Rajdhani, system-ui, sans-serif'; ctx.textAlign = 'left';
  for (const key of ['ma1', 'ma2']) {
    const sp = ind[key]; if (!sp.on) continue;
    const s = sp.type === 'ema' ? ema(closes, sp.n) : sma(closes, sp.n), rgb = IND_RGB[key];
    const pts = []; let lastV = null;
    for (let i = bars.length - 1; i >= 0; i--) {
      if (s[i] == null) continue; if (lastV == null) lastV = s[i];
      const age = ageOf(i); if (age > reach) break; const x = hx(age); pts.push([x, hy(s[i], x)]);
    }
    const started = pts.length > 1; ctx.beginPath(); smoothPath(pts);
    const g = ctx.createLinearGradient(L.xNow - Wh, 0, L.xNow, 0); g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.45, `rgba(${rgb},0.6)`); g.addColorStop(1, `rgba(${rgb},1)`);
    if (started) { ctx.strokeStyle = g; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.shadowColor = `rgba(${rgb},0.6)`; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0; }
    ctx.fillStyle = `rgb(${rgb})`; ctx.fillRect(14, ly - 4, 14, 3);
    ctx.fillStyle = 'rgba(230,225,250,0.88)'; ctx.fillText(sp.type.toUpperCase() + ' ' + sp.n + (lastV != null ? '  ' + lastV.toFixed(dec) : '  …'), 34, ly); ly += 17;
  }
  if (!rsiOn) return;
  const n = ind.rsi.n, rv = rsi(closes, n), pX0 = 14, pX1 = L.xNow - 8, pTop = H - 16 - RSI_H, pw = pX1 - pX0;
  const yv = (v) => pTop + 24 + ((100 - v) / 100) * (RSI_H - 32);
  rr(pX0, pTop, pw, RSI_H, 10); ctx.fillStyle = 'rgba(12,6,28,0.80)'; ctx.fill(); ctx.strokeStyle = 'rgba(184,107,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); rr(pX0, pTop, pw, RSI_H, 10); ctx.clip();
  ctx.fillStyle = 'rgba(255,77,109,0.09)'; ctx.fillRect(pX0, yv(100), pw, yv(70) - yv(100)); ctx.fillStyle = 'rgba(61,255,138,0.09)'; ctx.fillRect(pX0, yv(30), pw, yv(0) - yv(30));
  ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
  for (const [lv, c] of [[70, 'rgba(255,77,109,0.55)'], [50, 'rgba(255,255,255,0.12)'], [30, 'rgba(61,255,138,0.55)']]) { ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(pX0, yv(lv)); ctx.lineTo(pX1, yv(lv)); ctx.stroke(); }
  ctx.setLineDash([]); ctx.font = '600 10.5px Rajdhani, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(154,143,194,0.8)';
  ctx.fillText('70', pX1 - 5, yv(70) - 4); ctx.fillText('30', pX1 - 5, yv(30) - 4);
  let prevPt = null, lastR = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (rv[i] == null) continue; if (lastR == null) lastR = rv[i];
    const age = ageOf(i); if (age > reach) break; const x = Math.min(pX1 - 2, hx(age)), y = yv(rv[i]);
    if (prevPt && prevPt.x - x >= 0.6) {
      const v = prevPt.v; ctx.strokeStyle = v >= 70 ? '#ff4d6d' : v <= 30 ? '#3dff8a' : '#ffd24a';
      ctx.globalAlpha = Math.max(0.12, Math.min(1, (x - pX0) / (pw * 0.5))); ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(prevPt.x, prevPt.y); ctx.lineTo(x, y); ctx.stroke(); prevPt = { x, y, v: rv[i] };
    } else if (!prevPt) prevPt = { x, y, v: rv[i] };
  }
  ctx.globalAlpha = 1; ctx.restore();
  ctx.textAlign = 'left'; ctx.font = '700 12.5px Rajdhani, system-ui, sans-serif'; ctx.fillStyle = 'rgba(230,225,250,0.9)';
  if (lastR == null) { ctx.fillText('RSI ' + n + ' · calentando ' + Math.min(bars.length - 1, n) + '/' + n, pX0 + 10, pTop + 16); return; }
  ctx.fillText('RSI ' + n, pX0 + 10, pTop + 16);
  const col = lastR >= 70 ? '#ff4d6d' : lastR <= 30 ? '#3dff8a' : '#ffd24a';
  ctx.textAlign = 'right'; ctx.font = '900 16px Orbitron, system-ui, sans-serif'; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.fillText(lastR.toFixed(1), pX1 - 10, pTop + 17); ctx.shadowBlur = 0;
  if (lastR >= 70 || lastR <= 30) { ctx.font = '700 11px Rajdhani, system-ui, sans-serif'; ctx.fillText(lastR >= 70 ? 'SOBRECOMPRA' : 'SOBREVENTA', pX1 - 70, pTop + 16); }
}
function indActive() { return nowX() >= 260 && W >= 820 && prof.settings.ind.rsi.on; }
function applyIndLayout() { const s = $('side'), on = indActive(); s.style.bottom = (on ? 16 + RSI_H + 14 : 16) + 'px'; s.classList.toggle('compact', on); }
function rebuildBars() { bars = []; for (const h of hist) pushTick(bars, h.t, h.p, prof.settings.ind.bar); }
function renderIndPop() {
  const ind = prof.settings.ind, ma = (k, label) => `<div class="irow"><label><input type="checkbox" data-ind="${k}.on" ${ind[k].on ? 'checked' : ''}> <span class="sw" style="background:rgb(${IND_RGB[k]})"></span>${label}</label>
    <select data-ind="${k}.type"><option value="ema" ${ind[k].type === 'ema' ? 'selected' : ''}>EMA</option><option value="sma" ${ind[k].type === 'sma' ? 'selected' : ''}>SMA</option></select>
    <input type="number" min="2" max="100" value="${ind[k].n}" data-ind="${k}.n"></div>`;
  $('indpop').innerHTML = `<h4>Indicadores</h4>${ma('ma1', 'Media móvil 1')}${ma('ma2', 'Media móvil 2')}
    <div class="irow"><label><input type="checkbox" data-ind="rsi.on" ${ind.rsi.on ? 'checked' : ''}> <span class="sw" style="background:#ffd24a"></span>RSI</label><span class="hint">período</span><input type="number" min="2" max="50" value="${ind.rsi.n}" data-ind="rsi.n"></div>
    <div class="irow"><label>Barras de</label><select data-ind="bar">${[1, 2, 5].map((s) => `<option value="${s}" ${ind.bar === s ? 'selected' : ''}>${s} s</option>`).join('')}</select></div>
    <div class="irow"><label>Curva de precio</label><select data-ind="smooth"><option value="1" ${ind.smooth ? 'selected' : ''}>Suave</option><option value="0" ${ind.smooth ? '' : 'selected'}>Exacta</option></select></div>
    <div class="irow"><label>Vista del historial</label><select data-ind="view"><option value="arcade" ${ind.view === 'arcade' ? 'selected' : ''}>Arcade</option><option value="real" ${ind.view === 'real' ? 'selected' : ''}>Real</option></select></div>
    <div class="irow"><label>Ventana (vista real)</label><select data-ind="span">${[60, 120, 300].map((s) => `<option value="${s}" ${ind.span === s ? 'selected' : ''}>${s / 60} min</option>`).join('')}</select></div>
    <div class="hint2">«Suave» solo cambia el dibujo; las apuestas se resuelven siempre con el precio exacto. Los indicadores se calculan con el precio en vivo, una barra por intervalo. El RSI necesita período + 1 barras para empezar. «Real» usa tiempo lineal y la misma escala de precio que la cuadrícula.</div>`;
  $('indpop').querySelectorAll('[data-ind]').forEach((el) => {
    el.onchange = () => {
      const path = el.dataset.ind.split('.'); let o = prof.settings.ind; for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      const k = path[path.length - 1]; let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number') v = Math.max(+el.min, Math.min(+el.max, Math.round(+el.value) || +el.min));
      else if (k === 'bar' || k === 'span') v = +el.value;
      else if (k === 'smooth') v = el.value === '1';
      else v = el.value;
      o[k] = v; if (el.type === 'number') el.value = v;
      saveProfile(prof); if (k === 'bar') rebuildBars(); applyIndLayout();
    };
  });
}
function toggleIndPop() {
  const pop = $('indpop'); if (!pop.classList.contains('hide')) return pop.classList.add('hide');
  renderIndPop(); const r = $('indbtn').getBoundingClientRect(); pop.style.top = r.bottom + 8 + 'px'; pop.style.right = Math.max(8, innerWidth - r.right - 4) + 'px'; pop.classList.remove('hide');
}
$('indbtn').onclick = (e) => { e.stopPropagation(); toggleIndPop(); };
addEventListener('pointerdown', (e) => { const p = $('indpop'); if (!p.classList.contains('hide') && !p.contains(e.target) && e.target !== $('indbtn') && !$('indbtn').contains(e.target)) p.classList.add('hide'); });

function draw() {
  const L = layout(), th = theme();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (shakeMag > 0) ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
  if (!last) return;
  const nowMs = performance.now(), dtd = lastDrawAt ? Math.min(0.1, (nowMs - lastDrawAt) / 1000) : 0.016; lastDrawAt = nowMs;
  if (!dispP) dispP = last.p;
  dispP += (last.p - dispP) * (1 - Math.exp(-dtd / 0.09));
  center += (dispP - center) * (1 - Math.exp(-dtd / 0.22));
  if (L.t - boardAt > 1) recompute(L);

  const cw = L.cw, g = 1.5, rad = Math.min(7, RH / 5);
  const rowTop = Math.floor(priceAtY(0) / band) + 1, rowBot = Math.floor(priceAtY(H) / band) - 1;
  const k0 = Math.floor(L.t / SLOT - L.xNow / (cw)) - 1, k1 = Math.ceil((L.t + (W - L.xNow) / L.pps) / SLOT);
  const yLast = yOf(dispP);
  ctx.textBaseline = 'middle';

  // soft glow around "now"
  const glow = ctx.createRadialGradient(L.xNow, yLast, 0, L.xNow, yLast, 260);
  glow.addColorStop(0, `rgba(${th.glow},0.10)`); glow.addColorStop(1, `rgba(${th.glow},0)`);
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // faint horizontal rules
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
  for (let r = rowBot; r <= rowTop + 1; r++) { const y = Math.round(yOf(r * band)) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // locked band between now and the first open column
  const xOpen = xOf(L, Math.ceil((L.t + LOCK) / SLOT) * SLOT);
  if (xOpen > L.xNow) {
    const lg = ctx.createLinearGradient(L.xNow, 0, xOpen, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0.00)'); lg.addColorStop(1, 'rgba(255,255,255,0.045)');
    ctx.fillStyle = lg; ctx.fillRect(L.xNow, TOP + 4, xOpen - L.xNow, H - TOP - 4);
  }

  // cells
  const betKeys = new Set(bets.map((b) => b.k + ':' + b.r)), giftKeys = new Set(gifts.filter((g) => g.status === 'open').map((g) => g.k + ':' + g.r));
  ctx.textAlign = 'center';
  ctx.font = '700 ' + Math.max(16, Math.min(25, cw / 2.9)) + 'px Rajdhani, system-ui, sans-serif';
  let canBet = false;
  for (let k = k0; k <= k1; k++) {
    const x0 = xOf(L, k * SLOT), x1 = x0 + cw;
    if (x1 < 0 || x0 > W || k * SLOT < L.t + LOCK) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, TOP + 4); ctx.lineTo(Math.round(x0) + 0.5, H); ctx.stroke();
    // column header: seconds until it starts
    ctx.fillStyle = 'rgba(134,147,176,0.75)'; ctx.font = '600 12px Rajdhani, system-ui, sans-serif';
    ctx.fillText('+' + Math.max(0, Math.round(k * SLOT - L.t)) + 's', x0 + cw / 2, TOP + 16);
    ctx.font = '700 ' + Math.max(16, Math.min(25, cw / 2.9)) + 'px Rajdhani, system-ui, sans-serif';
    for (let r = rowBot; r <= rowTop; r++) {
      const key = k + ':' + r, c = board.get(key);
      if (!c || betKeys.has(key)) continue;
      if (giftKeys.has(key)) { if (hover && hover.k === k && hover.r === r && !c.off) canBet = true; continue; }
      const y = yOf((r + 1) * band);
      if (y < TOP + 28) continue;
      if (c.off) { // almost-certain cell: visible but not tappable
        rr(x0 + g, y + g, cw - 2 * g, RH - 2 * g, rad); ctx.fillStyle = 'rgba(255,255,255,0.022)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = 'rgba(134,147,176,0.4)'; ctx.fillText('—', x0 + cw / 2, y + RH / 2 + 0.5); continue;
      }
      const hh = hue(c.m), isHover = hover && hover.k === k && hover.r === r;
      if (isHover) { canBet = true; ctx.shadowColor = `hsla(${hh},90%,60%,0.7)`; ctx.shadowBlur = 16; }
      rr(x0 + g, y + g, cw - 2 * g, RH - 2 * g, rad);
      const fg = ctx.createLinearGradient(0, y, 0, y + RH);
      fg.addColorStop(0, `hsla(${hh},85%,60%,${isHover ? 0.48 : 0.19})`); fg.addColorStop(1, `hsla(${hh},85%,46%,${isHover ? 0.34 : 0.08})`);
      ctx.fillStyle = fg; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = `hsla(${hh},85%,68%,${isHover ? 1 : 0.30})`; ctx.lineWidth = isHover ? 1.5 : 1; ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${isHover ? 0.4 : 0.11})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0 + g + rad, y + g + 1.6); ctx.lineTo(x0 + cw - g - rad, y + g + 1.6); ctx.stroke(); // bevel highlight
      ctx.fillStyle = `hsla(${hh},95%,${isHover ? 94 : 80}%,${isHover ? 1 : 0.95})`; ctx.shadowColor = `hsla(${hh},95%,60%,0.8)`; ctx.shadowBlur = isHover ? 10 : 4;
      ctx.fillText(fmtMult(c.m), x0 + cw / 2, y + RH / 2 + 0.5); ctx.shadowBlur = 0;
    }
  }

  // bets
  for (const b of bets) {
    const x0 = xOf(L, b.start), y = yOf(b.hi), age = b.settledAt ? L.t - b.settledAt : 0;
    const col = b.status === 'won' ? '#3dff8a' : b.status === 'lost' ? '#ff4d6d' : '#ffd24a';
    const alpha = b.status === 'open' ? 1 : Math.max(0, 1 - age / 4);
    const popK = b.placedAt ? Math.max(0, 1 - (L.t - b.placedAt) / 0.32) : 0, sc = 1 + 0.3 * popK * popK + (b.int ? 0.07 * b.int * (0.5 + 0.5 * Math.sin(L.t * (7 + 18 * b.int))) : 0);
    ctx.save(); ctx.translate(x0 + cw / 2, y + RH / 2); ctx.scale(sc, sc); ctx.translate(-(x0 + cw / 2), -(y + RH / 2));
    ctx.globalAlpha = alpha;
    ctx.shadowColor = b.int > 0.55 ? '#ff5470' : col; ctx.shadowBlur = (b.status === 'open' ? 12 : 18) + 30 * (b.int || 0);
    rr(x0 + g + 0.5, y + g + 0.5, cw - 2 * g - 1, RH - 2 * g - 1, rad);
    ctx.fillStyle = b.status === 'open' ? 'rgba(255,210,74,0.20)' : b.status === 'won' ? 'rgba(61,255,138,0.30)' : 'rgba(255,77,109,0.22)';
    ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.font = '700 ' + Math.max(12, Math.min(16, cw / 4.3)) + 'px Rajdhani, system-ui, sans-serif';
    ctx.fillText(b.status === 'open' ? '$' + fmtStake(b.stake) + '·' + fmtMult(b.mult) : b.status === 'won' ? '✓' : '✗', x0 + cw / 2, y + RH / 2 + 0.5);
    if (b.status === 'open' && L.t >= b.start && L.t <= b.end) { // countdown bar: how much of the 5 s window is left
      const f = Math.max(0, (b.end - L.t) / SLOT); ctx.fillStyle = f < 0.4 ? '#ff4d6d' : '#3dff8a'; ctx.fillRect(x0 + g + 5, y + RH - g - 7, (cw - 2 * g - 10) * f, 3);
    }
    ctx.restore();
    ctx.globalAlpha = alpha;
    if (b.status === 'won' && age < 1.4) { // expanding ring + floating payout
      ctx.globalAlpha = 1 - age / 1.4; ctx.lineWidth = 2; ctx.strokeStyle = '#3dff8a';
      ctx.beginPath(); ctx.arc(x0 + cw / 2, y + RH / 2, 10 + age * 55, 0, 7); ctx.stroke();
      ctx.font = '800 16px Rajdhani, system-ui, sans-serif'; ctx.fillStyle = '#3dff8a';
      ctx.fillText('+' + fmt$(b.stake * (b.mult - 1)), x0 + cw / 2, y - 8 - age * 34);
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  for (const g of gifts) drawGift(g, L, th, g.status === 'open' && betKeys.has(g.k + ':' + g.r));
  // hover tooltip: what this tap would pay
  if (hover && canBet) {
    const c = board.get(hover.k + ':' + hover.r);
    if (c && !c.off) {
      const x = xOf(L, hover.k * SLOT) + cw / 2, y = yOf((hover.r + 1) * band) - 6;
      const txt = `$${fmtStake(stake)} → ${fmt$(stake * c.m)}`;
      ctx.font = '700 12px Rajdhani, system-ui, sans-serif';
      const tw = ctx.measureText(txt).width + 18;
      rr(x - tw / 2, y - 24, tw, 22, 11); ctx.fillStyle = 'rgba(8,12,22,0.92)'; ctx.fill();
      ctx.strokeStyle = 'rgba(94,242,208,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#eafff9'; ctx.fillText(txt, x, y - 13);
    }
  }
  cv.style.cursor = canBet ? 'pointer' : 'default';

  // ---- history zone (left of "now"). 'arcade': log-compressed time + exaggerated height. 'real': linear time + true price scale.
  const ind = prof.settings.ind, real = ind.view === 'real', SPAN = ind.span, indOn = L.xNow >= 260 && W >= 820, rsiOn = indOn && ind.rsi.on;
  const botY = rsiOn ? H - 16 - RSI_H - 12 : H - 12, Wh = Math.max(40, L.xNow - 24), lnMax = Math.log(1 + HIST_MAX / HIST_T), reach = real ? SPAN : HIST_MAX;
  const hx = real ? (age) => L.xNow - (Wh * age) / SPAN : (age) => L.xNow - (Wh * Math.log(1 + age / HIST_T)) / lnMax;
  const hy = (p, x) => {
    if (real) return Math.min(botY, Math.max(TOP + 26, yOf(p)));
    const prog = (L.xNow - x) / Wh, gain = 1 + (histGain - 1) * Math.pow(prog, 1.15);
    return Math.min(botY, Math.max(TOP + 26, yLast + (yOf(p) - yLast) * gain));
  };
  if (!real) {
    let mn = Infinity, mx = -Infinity;
    for (let i = hist.length - 1; i >= 0; i--) { const h = hist[i]; if (L.t - h.t > HIST_MAX) break; if (h.p < mn) mn = h.p; if (h.p > mx) mx = h.p; }
    if (mx > mn) {
      const rangePx = ((mx - mn) / band) * RH, playH = botY - TOP - 60;
      const target = Math.min(20, Math.max(1, (0.5 * playH) / Math.max(rangePx, RH * 0.6)));
      histGain += (target - histGain) * 0.04;
    }
  }
  const zg = ctx.createLinearGradient(0, 0, L.xNow, 0);
  zg.addColorStop(0, `rgba(${th.glow},0)`); zg.addColorStop(1, `rgba(${th.glow},0.035)`);
  ctx.fillStyle = zg; ctx.fillRect(0, TOP + 4, L.xNow, H - TOP - 4);
  if (L.xNow > 160) { // time marks and a label so the scale is honest
    const marks = real ? (SPAN <= 60 ? [15, 30, 45, 60] : SPAN <= 120 ? [30, 60, 90, 120] : [60, 120, 180, 240, 300]) : [30, 60, 120, 240];
    ctx.textAlign = 'center'; ctx.font = '600 12px Rajdhani, system-ui, sans-serif';
    for (const age of marks) {
      const x = hx(age); ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, TOP + 22); ctx.lineTo(Math.round(x) + 0.5, botY); ctx.stroke();
      ctx.fillStyle = 'rgba(134,147,176,0.6)'; ctx.fillText(age < 60 ? '−' + age + 's' : '−' + age / 60 + 'm', x, TOP + 16);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(134,147,176,0.55)';
    ctx.fillText(real ? 'HISTORIAL · escala real · ' + SPAN / 60 + ' min' : 'HISTORIAL · zoom ×' + histGain.toFixed(1), 14, TOP + 36);
    if (real) { // true price scale, shared with the grid
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(134,147,176,0.55)';
      for (let r = rowBot; r <= rowTop + 1; r += 2) { const y = yOf(r * band); if (y > TOP + 176 && y < botY - 6) ctx.fillText(fmtPrice(r * band), 14, y); }
    }
  }
  if (hist.length > 1) {
    const lg = ctx.createLinearGradient(L.xNow - Wh, 0, L.xNow, 0);
    lg.addColorStop(0, `rgba(${th.line},0)`); lg.addColorStop(0.35, `rgba(${th.line},0.35)`); lg.addColorStop(0.8, `rgba(${th.line},0.92)`); lg.addColorStop(1, '#ffffff');
    const pts = [[L.xNow, yLast]]; let px = L.xNow;
    if (ind.smooth) { // display-only smoothing: 0.2 s grid, linear slide into each tick, Gaussian sigma 1.0 s
      const STEP = 0.2, n = Math.max(2, Math.floor(reach / STEP)), { vals, from } = holdResample(hist, L.t - reach, STEP, n, 1.5), sm = gaussSmooth(vals, from, 5);
      for (let k = n - 1; k >= from; k--) { const age = reach - k * STEP, x = hx(age); if (px - x < 1.2) continue; pts.push([x, hy(sm[k], x)]); px = x; }
    } else {         // exact ticks
      for (let k = hist.length - 1; k >= 0; k--) { const h = hist[k], age = L.t - h.t; if (age > reach) break; const x = hx(age); if (px - x < 0.8 && k > 0) continue; pts.push([x, hy(h.p, x)]); px = x; }
    }
    ctx.beginPath(); smoothPath(pts);
    ctx.strokeStyle = lg; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = `rgba(${th.glow},0.55)`; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  }
  drawIndicators(L, hx, hy, Wh, reach, indOn, rsiOn);

  // "now" marker + dashed price guide
  ctx.strokeStyle = `rgba(${th.glow},0.28)`; ctx.setLineDash([3, 6]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L.xNow + 0.5, TOP + 4); ctx.lineTo(L.xNow + 0.5, H); ctx.moveTo(L.xNow, yLast); ctx.lineTo(W, yLast); ctx.stroke(); ctx.setLineDash([]);
  const pulse = 10 + 3 * Math.sin(L.t * 4);
  ctx.fillStyle = `rgba(${th.glow},0.18)`; ctx.beginPath(); ctx.arc(L.xNow, yLast, pulse, 0, 7); ctx.fill();
  ctx.fillStyle = th.dot; ctx.shadowColor = th.dot; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(L.xNow, yLast, 5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;

  // price axis (right) with a live tag
  ctx.textAlign = 'right'; ctx.font = '600 12px Rajdhani, system-ui, sans-serif';
  for (let r = rowBot; r <= rowTop + 1; r++) {
    const y = yOf(r * band);
    if (y < TOP + 32 || Math.abs(y - yLast) < 26 || r % 2) continue;
    ctx.fillStyle = 'rgba(134,147,176,0.7)'; ctx.fillText(fmtPrice(r * band), W - 10, y);
  }
  const dec = band < 0.01 ? 3 : band < 1 ? 2 : 0, tag = last.p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const small = W < 600; ctx.font = (small ? '900 14px' : '900 17px') + ' Orbitron, system-ui, sans-serif'; const tagW = ctx.measureText(tag).width + (small ? 18 : 26), tagH = small ? 26 : 32;
  ctx.shadowColor = th.dot; ctx.shadowBlur = 18; rr(W - tagW - 6, yLast - tagH / 2, tagW, tagH, 8); ctx.fillStyle = th.dot; ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#04120e'; ctx.textAlign = 'right'; ctx.fillText(tag, W - (small ? 15 : 19), yLast + 1);
  if (tension > 0.12) { // pulsing vignette that tightens as the price closes in
    const a = Math.min(0.5, tension * 0.42) * (0.65 + 0.35 * Math.sin(L.t * (6 + 14 * tension))), vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(${tension > 0.6 ? '255,60,90' : th.glow},${a})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }
  if (slow > 0.05) { ctx.fillStyle = `rgba(0,0,0,${0.55 * slow})`; ctx.fillRect(0, H - 18 * slow, W, 18 * slow); }
  drawFx();
}
// Tension: how close the price is to each open bet's band. Drives heartbeat, pulsing, vignette and slow-mo.
function updateTension(t, dt) {
  let ten = 0, trig = false;
  if (last) for (const b of bets) {
    if (b.status !== 'open') { b.int = 0; continue; }
    const active = t >= b.start && t <= b.end, soon = t >= b.start - 1.2 && t < b.start;
    const p = last.p, d = p < b.lo ? b.lo - p : p >= b.hi ? p - b.hi : 0, dRows = d / band;
    b.int = active || soon ? Math.max(0, 1 - dRows / 2.5) * (active ? 1 : 0.5) : 0;
    ten = Math.max(ten, b.int);
    if (active && dRows < 0.45) trig = true;
    if (active) { const rem = b.end - t; for (const n of [3, 2, 1]) if (rem <= n && b.lastTick > n) { b.lastTick = n; if (rem > n - 0.6) sfx.tick(n); } }
  }
  for (const g of gifts) { // gifts glow harder when the price is closing in (no heartbeat: they're free)
    if (g.status !== 'open' || !last) { g.near = 0; continue; }
    const active = t >= g.start - 1 && t <= g.end, p = last.p, d = p < g.lo ? g.lo - p : p >= g.hi ? p - g.hi : 0;
    g.near = active ? Math.max(0, 1 - d / band / 3) : 0;
    if (t >= g.start && t <= g.end) g.minD = Math.min(g.minD ?? Infinity, d / band); // closest approach (in rows) during its window
  }
  tension += (ten - tension) * Math.min(1, dt * 6);
  const was = slow > 0.5; slow += ((trig ? 1 : 0) - slow) * Math.min(1, dt * 5);
  if (was !== slow > 0.5) setSlowFilter(slow > 0.5);
  if (tension > 0.12 && t >= heartNext) { sfx.beat(tension); if (tension > 0.7) buzz(8); heartNext = t + 1 / (1.3 + 5 * tension); }
}
function frame(ts) { const dt = Math.min(0.05, ((ts || performance.now()) - lastFrameAt) / 1000); lastFrameAt = ts || performance.now(); updateTension(now(), dt); stepFx(dt * (1 - 0.7 * slow)); draw(); requestAnimationFrame(frame); }

// ---------- input ----------
function cellAt(x, y) {
  if (!last) return null;
  const L = layout();
  return { k: Math.floor((L.t + (x - L.xNow) / L.pps) / SLOT), r: Math.floor(priceAtY(y) / band) };
}
cv.addEventListener('pointermove', (e) => { hover = cellAt(e.clientX, e.clientY); });
cv.addEventListener('pointerleave', () => { hover = null; });
cv.addEventListener('pointerdown', (e) => {
  const c = cellAt(e.clientX, e.clientY); hover = c;
  if (!c || e.clientY < TOP + 28) return;
  const cell = board.get(c.k + ':' + c.r), t = now();
  if (!cell || cell.off || c.k * SLOT < t + LOCK) return;
  audio();
  if (balance < stake) { sfx.error(); return toast('Saldo insuficiente para $' + fmtStake(stake), 'l'); }
  if (bets.some((b) => b.status === 'open' && b.k === c.k && b.r === c.r)) return;
  balance -= stake; addLedger(prof, 'bet', -stake); renderBal('down');
  bets.push({ id: nextId++, k: c.k, r: c.r, start: c.k * SLOT, end: (c.k + 1) * SLOT, lo: c.r * band, hi: (c.r + 1) * band, stake, mult: cell.m, status: 'open', placedAt: t, lastTick: 99, int: 0 });
  const L = layout(), px = xOf(L, c.k * SLOT) + L.cw / 2, py = yOf((c.r + 1) * band) + RH / 2, h = hue(cell.m);
  burst(px, py, { n: 14 + Math.min(14, Math.round(cell.m)), hue: h, speed: 200, life: 0.55, size: 2.6 }); ring(px, py, h, 0.8);
  sfx.tap(cell.m); buzz(10); if (cell.m >= 15) shake(2.5);
  prof.stats.bets++; addXP(2); missionEvent('bet'); if (prof.stats.bets >= 10) unlock('tap_10'); if (prof.stats.bets >= 100) unlock('veteran'); persist();
});
function resize() {
  dpr = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  TOP = document.querySelector('.bar').offsetHeight;
  RH = Math.max(40, Math.ceil(W / 32));   // keeps the 120 s pricing horizon on screen at any width
  cv.width = W * dpr; cv.height = H * dpr;
  placeAssetMark(); applyIndLayout();
}
addEventListener('resize', resize); addEventListener('load', resize); resize();
['700 16px Rajdhani', '600 12px Rajdhani', '400 20px Bungee', '900 16px Orbitron'].forEach((f) => document.fonts && document.fonts.load(f).catch(() => {}));
const refreshOdds = () => fetchOdds('odds.json').then((d) => { if (d) { oddsDoc = d; boardAt = 0; } });
refreshOdds(); setInterval(refreshOdds, 10 * 60 * 1000);
connect(); requestAnimationFrame(frame);
window.__tapline = { get state() { return { balance, bets, last, band, RH, cw: layout().cw, boardSize: board.size, odds: oddsFor(oddsDoc, asset).source, oddsAt: oddsDoc && oddsDoc.updated, offCells: [...board.values()].filter((c) => c.off).length, sigma: vol.sigma, wins, losses, streak, sounds: soundsPlayed, audio: actx ? actx.state : 'none', parts: parts.length, tension, slow, xp: prof.xp, level: levelInfo(prof.xp).level, ach: Object.keys(prof.ach).length, mission: prof.mission, bars: bars.length, nowX: nowX(), ind: prof.settings.ind, gifts: gifts.map((g) => ({ id: g.id, p0: g.p0, tier: g.tier, status: g.status, xp: g.xp, start: g.start, end: g.end, minD: g.minD ?? null })), giftCount: prof.stats.gifts || 0, music: { on: musicOn, notes: musicNotes, running: !!musicTimer, gain: musicGain ? +musicGain.gain.value.toFixed(3) : null }, avatar: prof.avatar.type, name: prof.name, addr: prof.wallet.addr, ledger: prof.wallet.ledger.length }; }, fx: { burst, ring, confetti, shake, showBanner, sfx, addXP, unlock, offerShare, shareCard, openProfile, openWallet, uploadAvatar, startMusic, walletMove, spawnGift, bench: (n = 60) => { const t0 = performance.now(); for (let i = 0; i < n; i++) draw(); return (performance.now() - t0) / n; }, setInd: (patch) => { Object.assign(prof.settings.ind, patch); rebuildBars(); applyIndLayout(); } } };
