import { SLOT, LOCK, STEPS, DT, Vol, computeBoard, stepBet } from './engine.js?v=13';
import { THEMES, ACHIEVEMENTS, MISSIONS, levelInfo, loadProfile, saveProfile, dailyCheck } from './progress.js?v=13';

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
let tension = 0, slow = 0, heartNext = 0, lossRun = 0, lastBig = null, lp = null, shareT = 0;
const comboMap = new Map();
const theme = () => THEMES.find((t) => t.id === prof.theme && levelInfo(prof.xp).level >= t.lvl) || THEMES[0];
const HIST_T = 10, HIST_MAX = 300;   // history compression: log scale, 5 minutes visible
let histGain = 1;                 // vertical exaggeration at the far (oldest) end
const now = () => Date.now() / 1000;

// ---------- sound (synthesized with Web Audio, no files) ----------
let actx = null, master = null, muted = localStorage.getItem('tl.mute') === '1';
function audio() {
  if (muted) return null;
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    actx = new AC(); master = actx.createGain(); master.gain.value = 0.55;
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
  error() { if (!audio()) return; const t = actx.currentTime; tone(150, t, 0.16, { type: 'square', gain: 0.06, slide: 0.7 }); },
};
const setSlowFilter = (on) => { if (lp && actx) lp.frequency.setTargetAtTime(on ? 700 : 20000, actx.currentTime, 0.07); };
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

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
function placeAssetMark() {
  const el = $('asset'); if (!el) return;
  const xn = Math.round(W * (W < 820 ? 0.22 : 0.28));
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
function renderLevel() { const li = levelInfo(prof.xp); $('lvlnum').textContent = 'NV ' + li.level; $('lvlbar').style.width = (100 * li.cur / li.need) + '%'; }
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
    <div class="row"><div><h2>NIVEL ${li.level}</h2><div class="sub">${li.cur} / ${li.need} XP · racha diaria de ${prof.dayStreak} día(s)</div></div><button class="btn" id="profclose">Cerrar</button></div>
    <div class="xpbar"><u style="width:${(100 * li.cur / li.need).toFixed(1)}%"></u></div>
    <h3>Misión de hoy</h3>
    <div class="tile ${mi && mi.done ? 'got' : ''}" style="opacity:1;border-color:rgba(44,245,210,.5)"><b>${def ? def.text : '—'}</b>${mi ? (mi.done ? 'Cumplida · +' + def.xp + ' XP' : (Number.isInteger(mi.prog) ? Math.min(mi.prog, def.target) : Math.min(mi.prog, def.target).toFixed(2)) + ' / ' + def.target + ' · recompensa ' + def.xp + ' XP') : ''}</div>
    <h3>Estadísticas</h3>
    <div class="stat4"><div class="tile"><b class="num">${st.bets}</b><span>apuestas</span></div><div class="tile"><b class="num">${pct}%</b><span>aciertos</span></div><div class="tile"><b class="num">×${st.bestStreak}</b><span>mejor racha</span></div><div class="tile"><b class="num">${fmt$(st.biggest)}</b><span>mayor premio</span></div></div>
    <h3>Estilo de la línea de precio</h3>
    <div class="themes">${THEMES.map((t) => `<button data-th="${t.id}" class="${t.id === theme().id ? 'on' : ''}" ${li.level < t.lvl ? 'disabled' : ''} style="color:${t.dot}">${t.name}${li.level < t.lvl ? ' · Nv ' + t.lvl : ''}</button>`).join('')}</div>
    <h3>Logros · ${Object.keys(prof.ach).length} / ${ACHIEVEMENTS.length}</h3>
    <div class="grid2">${ACHIEVEMENTS.map((a) => `<div class="tile ach ${prof.ach[a.id] ? 'got' : ''}"><span class="medal">${prof.ach[a.id] ? '★' : '?'}</span><div><b>${a.name}</b>${a.desc}</div></div>`).join('')}</div>
    <h3>Compartir</h3>
    <button class="btn pri" id="profshare">Compartir mi última victoria grande</button>`;
  $('profclose').onclick = closeProfile; $('profshare').onclick = shareCard;
  $('profbody').querySelectorAll('[data-th]').forEach((b) => { b.onclick = () => { prof.theme = b.dataset.th; persist(); renderProfile(); }; });
}
function openProfile() { renderProfile(); $('prof').classList.remove('hide'); }
function closeProfile() { $('prof').classList.add('hide'); }
$('lvl').onclick = openProfile; $('share').onclick = shareCard;
$('prof').addEventListener('pointerdown', (e) => { if (e.target === $('prof')) closeProfile(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProfile(); });

renderTabs(); renderStakes(); renderBal(); renderStats(); renderStreak(); renderMute(); renderLevel();
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
  histGain = 1;   hist = []; last = null; first = null; vol = new Vol(); board = new Map(); band = 1; center = 0;
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
  hist.push(cur);
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
    balance += b.stake * b.mult; wins++; pnl += profit; streak++; bestStreak = Math.max(bestStreak, streak); renderBal('up');
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
  if (bets.length === 0 && now() - lastRebalance > 4) {
    lastRebalance = now(); const nb = pickBand(last.p, vol.sigma), q = nb / band;
    if (q > 1.6 || q < 0.62) { band = nb; boardAt = 0; }
  }
  resolve(last, { t: now(), p: last.p });
  bets = bets.filter((b) => b.status === 'open' || now() - b.settledAt < 4);
  if (now() - lastTickAt > 8) setLive(false, 'SIN DATOS');
}, 500);

// ---------- geometry ----------
function layout() {
  const t = now();
  const xNow = Math.round(W * (W < 820 ? 0.22 : 0.28));
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
  board = computeBoard({
    S: last.p, sigma: vol.sigma, now: L.t,
    slotFrom: Math.ceil((L.t + LOCK) / SLOT),
    slotTo: Math.floor((L.t + STEPS * DT) / SLOT) - 1,
    rowFrom: cr - half, rowTo: cr + half, band,
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

function draw() {
  const L = layout(), th = theme();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (shakeMag > 0) ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
  if (!last) return;
  center += (last.p - center) * 0.08;
  if (L.t - boardAt > 1) recompute(L);

  const cw = L.cw, g = 1.5, rad = Math.min(7, RH / 5);
  const rowTop = Math.floor(priceAtY(0) / band) + 1, rowBot = Math.floor(priceAtY(H) / band) - 1;
  const k0 = Math.floor(L.t / SLOT - L.xNow / (cw)) - 1, k1 = Math.ceil((L.t + (W - L.xNow) / L.pps) / SLOT);
  const yLast = yOf(last.p);
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
  const betKeys = new Set(bets.map((b) => b.k + ':' + b.r));
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

  // ---- history zone (left of "now"): time is compressed (log scale) and height is exaggerated toward the past, then it fades out
  const Wh = Math.max(40, L.xNow - 24), lnMax = Math.log(1 + HIST_MAX / HIST_T);
  const hx = (age) => L.xNow - (Wh * Math.log(1 + age / HIST_T)) / lnMax;
  let mn = Infinity, mx = -Infinity;
  for (let i = hist.length - 1; i >= 0; i--) { const h = hist[i]; if (L.t - h.t > HIST_MAX) break; if (h.p < mn) mn = h.p; if (h.p > mx) mx = h.p; }
  if (mx > mn) {
    const rangePx = ((mx - mn) / band) * RH, playH = H - TOP - 60;
    const target = Math.min(20, Math.max(1, (0.5 * playH) / Math.max(rangePx, RH * 0.6)));
    histGain += (target - histGain) * 0.04;
  }
  const zg = ctx.createLinearGradient(0, 0, L.xNow, 0);
  zg.addColorStop(0, `rgba(${th.glow},0)`); zg.addColorStop(1, `rgba(${th.glow},0.035)`);
  ctx.fillStyle = zg; ctx.fillRect(0, TOP + 4, L.xNow, H - TOP - 4);
  if (L.xNow > 160) { // time marks and a label so the squeezed scale is honest
    ctx.textAlign = 'center'; ctx.font = '600 12px Rajdhani, system-ui, sans-serif';
    for (const [age, lab] of [[30, '−30s'], [60, '−1m'], [120, '−2m'], [240, '−4m']]) {
      const x = hx(age); ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, TOP + 22); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke();
      ctx.fillStyle = 'rgba(134,147,176,0.6)'; ctx.fillText(lab, x, TOP + 16);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(134,147,176,0.55)'; ctx.fillText('HISTORIAL · zoom ×' + histGain.toFixed(1), 14, TOP + 36);
  }
  if (hist.length > 1) {
    const lg = ctx.createLinearGradient(L.xNow - Wh, 0, L.xNow, 0);
    lg.addColorStop(0, `rgba(${th.line},0)`); lg.addColorStop(0.35, `rgba(${th.line},0.35)`); lg.addColorStop(0.8, `rgba(${th.line},0.92)`); lg.addColorStop(1, '#ffffff');
    ctx.beginPath(); ctx.moveTo(L.xNow, yLast); let px = L.xNow;
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i], age = L.t - h.t;
      if (age > HIST_MAX) break;
      const x = hx(age);
      if (px - x < 0.8 && i > 0) continue;           // skip sub-pixel points (keeps long histories cheap)
      const prog = (L.xNow - x) / Wh, gain = 1 + (histGain - 1) * Math.pow(prog, 1.15);
      const y = Math.min(H - 12, Math.max(TOP + 26, yLast + (yOf(h.p) - yLast) * gain));
      ctx.lineTo(x, y); px = x;
    }
    ctx.strokeStyle = lg; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = `rgba(${th.glow},0.55)`; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  }

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
  balance -= stake; renderBal('down');
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
  placeAssetMark();
}
addEventListener('resize', resize); addEventListener('load', resize); resize();
['700 16px Rajdhani', '600 12px Rajdhani', '400 20px Bungee', '900 16px Orbitron'].forEach((f) => document.fonts && document.fonts.load(f).catch(() => {}));
connect(); requestAnimationFrame(frame);
window.__tapline = { get state() { return { balance, bets, last, band, RH, cw: layout().cw, boardSize: board.size, offCells: [...board.values()].filter((c) => c.off).length, sigma: vol.sigma, wins, losses, streak, sounds: soundsPlayed, audio: actx ? actx.state : 'none', parts: parts.length, tension, slow, xp: prof.xp, level: levelInfo(prof.xp).level, ach: Object.keys(prof.ach).length, mission: prof.mission }; }, fx: { burst, ring, confetti, shake, showBanner, sfx, addXP, unlock, offerShare, shareCard, openProfile } };
