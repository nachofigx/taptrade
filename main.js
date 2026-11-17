import { SLOT, LOCK, STEPS, DT, Vol, computeBoard, stepBet, niceBand } from './engine.js?v=6';

const $ = (id) => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const ASSETS = ['SOL-USD', 'BTC-USD', 'ETH-USD'];
const STAKES = [1, 5, 10, 25, 100];
const START_BAL = 1000;
const ASPECT = 4 / 3;            // cell width : cell height
const fmt$ = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- state ----------
let asset = localStorage.getItem('tl.asset');
if (!ASSETS.includes(asset)) asset = 'SOL-USD';
let balance = Number(localStorage.getItem('tl.bal')) || START_BAL;
let stake = Number(localStorage.getItem('tl.stake')) || 5;
let bets = [], hist = [];
let last = null, first = null, vol = new Vol(), band = 1, board = new Map(), boardAt = 0, center = 0;
let TOP = 68;                    // height of the top bar; the playfield starts below it
let hover = null, ws = null, wsTimer = null, W = 0, H = 0, dpr = 1, nextId = 1, RH = 40;
let wins = 0, losses = 0, pnl = 0, lastTickAt = 0;
let streak = 0, bestStreak = 0, lastFrameAt = performance.now();
const parts = []; let banner = null, shakeMag = 0;
const HIST_T = 10, HIST_MAX = 300;   // history compression: log scale, 5 minutes visible
let histGain = 1;                 // vertical exaggeration at the far (oldest) end
const now = () => Date.now() / 1000;

// ---------- sound (synthesized with Web Audio, no files) ----------
let actx = null, master = null, muted = localStorage.getItem('tl.mute') === '1';
function audio() {
  if (muted) return null;
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    actx = new AC(); master = actx.createGain(); master.gain.value = 0.55; master.connect(actx.destination);
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
  error() { if (!audio()) return; const t = actx.currentTime; tone(150, t, 0.16, { type: 'square', gain: 0.06, slide: 0.7 }); },
};
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
    ctx.font = `900 ${fs}px ui-sans-serif, system-ui, sans-serif`; ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(5,8,16,0.85)'; ctx.strokeText(b.text, 0, 0);
    const g = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2); g.addColorStop(0, `hsl(${b.hue},95%,80%)`); g.addColorStop(1, `hsl(${b.hue + 40},95%,58%)`);
    ctx.shadowColor = `hsl(${b.hue},95%,60%)`; ctx.shadowBlur = 26; ctx.fillStyle = g; ctx.fillText(b.text, 0, 0); ctx.shadowBlur = 0;
    if (b.sub) { ctx.font = `700 ${fs * 0.42}px ui-sans-serif, system-ui, sans-serif`; ctx.fillStyle = '#eef2fb'; ctx.fillText(b.sub, 0, fs * 0.82); }
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
}
function renderStakes() {
  $('stakes').innerHTML = '';
  for (const s of STAKES) {
    const b = document.createElement('button');
    b.textContent = '$' + s; b.className = s === stake ? 'on' : '';
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
function renderStats() {
  const p = $('pnl'); p.textContent = (pnl >= 0 ? '+' : '−') + fmt$(Math.abs(pnl)); p.className = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
  $('wl').textContent = wins + ' / ' + (wins + losses);
}
function logResult(bet) {
  const d = document.createElement('div');
  d.className = bet.status === 'won' ? 'w' : 'l';
  const profit = bet.status === 'won' ? bet.stake * (bet.mult - 1) : -bet.stake;
  d.innerHTML = `<span>${bet.status === 'won' ? '✓ Acierto' : '✗ Fallo'} · ${bet.mult.toFixed(2)}x</span><b>${profit >= 0 ? '+' : '−'}${fmt$(Math.abs(profit))}</b>`;
  $('log').prepend(d);
  while ($('log').children.length > 5) $('log').lastChild.remove();
}
renderTabs(); renderStakes(); renderBal(); renderStats(); renderStreak(); renderMute();
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
function onTick(t, p) {
  const cur = { t, p };
  if (!last) { band = niceBand(p); center = p; first = p; $('msg').style.display = 'none'; setLive(true, 'EN VIVO'); }
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
    if (s !== 'open') settle(b, s);
  }
}
function settle(b, s) {
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
  } else {
    losses++; pnl -= b.stake; const near = nearMiss(b), had = streak; streak = 0;
    burst(cx, cy, { n: 16, hue: 350, speed: 140, life: 0.8, grav: 520, size: 2.6, light: 60 });
    if (near) showBanner('¡POR POCO!', null, 38, false);
    else if (had >= 3) showBanner('Racha perdida', null, 350, false);
    sfx.lose(near); buzz(near ? [20, 30, 20] : 15); renderStreak(false);
  }
  renderStats(); logResult(b);
}
setInterval(() => {
  if (!last) return;
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
const hue = (m) => 172 + Math.min(1, Math.log(m) / Math.log(30)) * 128;
function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const fmtMult = (m) => (m >= 10 ? m.toFixed(1) : m.toFixed(2)) + 'x';
const fmtPrice = (v) => v.toFixed(band < 0.01 ? 3 : band < 1 ? 2 : 0);

function draw() {
  const L = layout();
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
  glow.addColorStop(0, 'rgba(94,242,208,0.10)'); glow.addColorStop(1, 'rgba(94,242,208,0)');
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
  ctx.font = '600 ' + Math.max(10.5, Math.min(13, cw / 5.2)) + 'px ui-sans-serif, system-ui, sans-serif';
  let canBet = false;
  for (let k = k0; k <= k1; k++) {
    const x0 = xOf(L, k * SLOT), x1 = x0 + cw;
    if (x1 < 0 || x0 > W || k * SLOT < L.t + LOCK) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, TOP + 4); ctx.lineTo(Math.round(x0) + 0.5, H); ctx.stroke();
    // column header: seconds until it starts
    ctx.fillStyle = 'rgba(134,147,176,0.75)'; ctx.font = '500 10.5px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('+' + Math.max(0, Math.round(k * SLOT - L.t)) + 's', x0 + cw / 2, TOP + 16);
    ctx.font = '600 ' + Math.max(10.5, Math.min(13, cw / 5.2)) + 'px ui-sans-serif, system-ui, sans-serif';
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
      fg.addColorStop(0, `hsla(${hh},70%,58%,${isHover ? 0.42 : 0.14})`); fg.addColorStop(1, `hsla(${hh},70%,45%,${isHover ? 0.30 : 0.07})`);
      ctx.fillStyle = fg; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = `hsla(${hh},80%,66%,${isHover ? 0.95 : 0.17})`; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = `hsla(${hh},90%,${isHover ? 92 : 76}%,${isHover ? 1 : 0.88})`;
      ctx.fillText(fmtMult(c.m), x0 + cw / 2, y + RH / 2 + 0.5);
    }
  }

  // bets
  for (const b of bets) {
    const x0 = xOf(L, b.start), y = yOf(b.hi), age = b.settledAt ? L.t - b.settledAt : 0;
    const col = b.status === 'won' ? '#4ade80' : b.status === 'lost' ? '#fb7185' : '#ffffff';
    const alpha = b.status === 'open' ? 1 : Math.max(0, 1 - age / 4);
    const popK = b.placedAt ? Math.max(0, 1 - (L.t - b.placedAt) / 0.32) : 0, sc = 1 + 0.3 * popK * popK;
    ctx.save(); ctx.translate(x0 + cw / 2, y + RH / 2); ctx.scale(sc, sc); ctx.translate(-(x0 + cw / 2), -(y + RH / 2));
    ctx.globalAlpha = alpha;
    ctx.shadowColor = col; ctx.shadowBlur = b.status === 'open' ? 12 : 18;
    rr(x0 + g + 0.5, y + g + 0.5, cw - 2 * g - 1, RH - 2 * g - 1, rad);
    ctx.fillStyle = b.status === 'open' ? 'rgba(255,255,255,0.15)' : b.status === 'won' ? 'rgba(74,222,128,0.30)' : 'rgba(251,113,133,0.22)';
    ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.font = '700 ' + Math.max(10.5, Math.min(13, cw / 5.2)) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(b.status === 'open' ? '$' + b.stake + '·' + fmtMult(b.mult) : b.status === 'won' ? '✓' : '✗', x0 + cw / 2, y + RH / 2 + 0.5);
    ctx.restore();
    ctx.globalAlpha = alpha;
    if (b.status === 'won' && age < 1.4) { // expanding ring + floating payout
      ctx.globalAlpha = 1 - age / 1.4; ctx.lineWidth = 2; ctx.strokeStyle = '#4ade80';
      ctx.beginPath(); ctx.arc(x0 + cw / 2, y + RH / 2, 10 + age * 55, 0, 7); ctx.stroke();
      ctx.font = '800 16px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#4ade80';
      ctx.fillText('+' + fmt$(b.stake * (b.mult - 1)), x0 + cw / 2, y - 8 - age * 34);
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  // hover tooltip: what this tap would pay
  if (hover && canBet) {
    const c = board.get(hover.k + ':' + hover.r);
    if (c && !c.off) {
      const x = xOf(L, hover.k * SLOT) + cw / 2, y = yOf((hover.r + 1) * band) - 6;
      const txt = `$${stake} → ${fmt$(stake * c.m)}`;
      ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
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
  zg.addColorStop(0, 'rgba(94,242,208,0)'); zg.addColorStop(1, 'rgba(94,242,208,0.035)');
  ctx.fillStyle = zg; ctx.fillRect(0, TOP + 4, L.xNow, H - TOP - 4);
  if (L.xNow > 160) { // time marks and a label so the squeezed scale is honest
    ctx.textAlign = 'center'; ctx.font = '500 10.5px ui-sans-serif, system-ui, sans-serif';
    for (const [age, lab] of [[30, '−30s'], [60, '−1m'], [120, '−2m'], [240, '−4m']]) {
      const x = hx(age); ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, TOP + 22); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke();
      ctx.fillStyle = 'rgba(134,147,176,0.6)'; ctx.fillText(lab, x, TOP + 16);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(134,147,176,0.55)'; ctx.fillText('HISTORIAL · zoom ×' + histGain.toFixed(1), 14, TOP + 36);
  }
  if (hist.length > 1) {
    const lg = ctx.createLinearGradient(L.xNow - Wh, 0, L.xNow, 0);
    lg.addColorStop(0, 'rgba(238,242,251,0)'); lg.addColorStop(0.35, 'rgba(238,242,251,0.35)'); lg.addColorStop(0.8, 'rgba(238,242,251,0.92)'); lg.addColorStop(1, '#ffffff');
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
    ctx.shadowColor = 'rgba(94,242,208,0.55)'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  }

  // "now" marker + dashed price guide
  ctx.strokeStyle = 'rgba(94,242,208,0.28)'; ctx.setLineDash([3, 6]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L.xNow + 0.5, TOP + 4); ctx.lineTo(L.xNow + 0.5, H); ctx.moveTo(L.xNow, yLast); ctx.lineTo(W, yLast); ctx.stroke(); ctx.setLineDash([]);
  const pulse = 10 + 3 * Math.sin(L.t * 4);
  ctx.fillStyle = 'rgba(94,242,208,0.18)'; ctx.beginPath(); ctx.arc(L.xNow, yLast, pulse, 0, 7); ctx.fill();
  ctx.fillStyle = '#5ef2d0'; ctx.shadowColor = '#5ef2d0'; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(L.xNow, yLast, 5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;

  // price axis (right) with a live tag
  ctx.textAlign = 'right'; ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
  for (let r = rowBot; r <= rowTop + 1; r++) {
    const y = yOf(r * band);
    if (y < TOP + 32 || Math.abs(y - yLast) < 16 || r % 2) continue;
    ctx.fillStyle = 'rgba(134,147,176,0.7)'; ctx.fillText(fmtPrice(r * band), W - 10, y);
  }
  const tag = fmtPrice(last.p), tagW = ctx.measureText(tag).width + 18;
  rr(W - tagW - 4, yLast - 11, tagW, 22, 6); ctx.fillStyle = '#5ef2d0'; ctx.fill();
  ctx.fillStyle = '#04120e'; ctx.font = '700 11.5px ui-sans-serif, system-ui, sans-serif'; ctx.fillText(tag, W - 13, yLast + 0.5);
  drawFx();
}
function frame(ts) { const dt = Math.min(0.05, ((ts || performance.now()) - lastFrameAt) / 1000); lastFrameAt = ts || performance.now(); stepFx(dt); draw(); requestAnimationFrame(frame); }

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
  if (balance < stake) { sfx.error(); return toast('Saldo insuficiente para $' + stake, 'l'); }
  if (bets.some((b) => b.status === 'open' && b.k === c.k && b.r === c.r)) return;
  balance -= stake; renderBal('down');
  bets.push({ id: nextId++, k: c.k, r: c.r, start: c.k * SLOT, end: (c.k + 1) * SLOT, lo: c.r * band, hi: (c.r + 1) * band, stake, mult: cell.m, status: 'open', placedAt: t });
  const L = layout(), px = xOf(L, c.k * SLOT) + L.cw / 2, py = yOf((c.r + 1) * band) + RH / 2, h = hue(cell.m);
  burst(px, py, { n: 14 + Math.min(14, Math.round(cell.m)), hue: h, speed: 200, life: 0.55, size: 2.6 }); ring(px, py, h, 0.8);
  sfx.tap(cell.m); buzz(10); if (cell.m >= 15) shake(2.5);
});
function resize() {
  dpr = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  TOP = document.querySelector('.bar').offsetHeight;
  RH = Math.max(40, Math.ceil(W / 32));   // keeps the 120 s pricing horizon on screen at any width
  cv.width = W * dpr; cv.height = H * dpr;
}
addEventListener('resize', resize); addEventListener('load', resize); resize();
connect(); requestAnimationFrame(frame);
window.__tapline = { get state() { return { balance, bets, last, band, RH, cw: layout().cw, boardSize: board.size, offCells: [...board.values()].filter((c) => c.off).length, sigma: vol.sigma, wins, losses, streak, sounds: soundsPlayed, audio: actx ? actx.state : 'none', parts: parts.length }; }, fx: { burst, ring, confetti, shake, showBanner, sfx } };
