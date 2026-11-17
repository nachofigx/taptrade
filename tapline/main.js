import { SLOT, LOCK, STEPS, DT, Vol, computeBoard, stepBet, niceBand } from './engine.js';

const $ = (id) => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const STAKES = [1, 5, 10, 25, 100];
const START_BAL = 1000;
const fmt$ = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- state ----------
let asset = localStorage.getItem('tl.asset') || 'SOL-USD';
let balance = Number(localStorage.getItem('tl.bal')) || START_BAL;
let stake = Number(localStorage.getItem('tl.stake')) || 5;
let bets = [];                 // open + recently settled (for drawing)
let hist = [];                 // {t,p}
let last = null, vol = new Vol(), band = 1, board = new Map(), boardAt = 0, center = 0;
let hover = null, ws = null, wsTimer = null, W = 0, H = 0, dpr = 1, nextId = 1;
const RH = 34;                 // row height px
const now = () => Date.now() / 1000;

// ---------- UI ----------
$('asset').value = asset;
function renderStakes() {
  $('stakes').innerHTML = '';
  for (const s of STAKES) {
    const b = document.createElement('button');
    b.textContent = '$' + s; b.className = s === stake ? 'on' : '';
    b.onclick = () => { stake = s; localStorage.setItem('tl.stake', s); renderStakes(); };
    $('stakes').append(b);
  }
}
function renderBal() { $('bal').textContent = fmt$(balance); localStorage.setItem('tl.bal', balance); }
renderStakes(); renderBal();
$('reset').onclick = () => { if (!bets.some((b) => b.status === 'open')) { balance = START_BAL; renderBal(); } };
$('asset').onchange = (e) => {
  if (bets.some((b) => b.status === 'open')) { e.target.value = asset; return; }
  asset = e.target.value; localStorage.setItem('tl.asset', asset); connect();
};
function logResult(bet) {
  const d = document.createElement('div');
  d.className = bet.status === 'won' ? 'w' : 'l';
  const profit = bet.status === 'won' ? bet.stake * (bet.mult - 1) : -bet.stake;
  d.innerHTML = `<span>${bet.status === 'won' ? '✓' : '✗'} ${bet.mult.toFixed(2)}x</span><b>${profit >= 0 ? '+' : '−'}${fmt$(Math.abs(profit))}</b>`;
  $('log').prepend(d);
  while ($('log').children.length > 6) $('log').lastChild.remove();
}

// ---------- price feed ----------
function connect() {
  clearTimeout(wsTimer);
  if (ws) { ws.onclose = null; ws.close(); }
  hist = []; last = null; vol = new Vol(); board = new Map(); band = 1; center = 0;
  $('price').textContent = '—'; $('msg').style.display = 'block';
  ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', product_ids: [asset], channels: ['ticker'] }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'ticker' && m.price) onTick(now(), +m.price);
  };
  ws.onclose = () => { wsTimer = setTimeout(connect, 2000); $('msg').style.display = 'block'; $('msg').textContent = 'Reconectando…'; };
}
function onTick(t, p) {
  const cur = { t, p };
  if (!last) { band = niceBand(p); center = p; $('msg').style.display = 'none'; }
  const prev = last || cur;
  hist.push(cur);
  while (hist.length > 4000 || (hist.length && t - hist[0].t > 600)) hist.shift();
  vol.add(t, p);
  last = cur;
  $('price').textContent = p.toLocaleString('en-US', { maximumFractionDigits: 4 });
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
  if (s === 'won') { balance += b.stake * b.mult; renderBal(); }
  logResult(b);
}
setInterval(() => { // settle losses even when no ticks arrive
  if (!last) return;
  resolve(last, { t: now(), p: last.p });
  bets = bets.filter((b) => b.status === 'open' || now() - b.settledAt < 4);
}, 500);

// ---------- geometry ----------
function layout() {
  const t = now();
  const xNow = Math.round(W * 0.3);
  const pps = Math.max(14, Math.min(40, (W * 0.7) / 55));
  return { t, xNow, pps };
}
const xOf = (L, t) => L.xNow + (t - L.t) * L.pps;
const yOf = (p) => H / 2 - ((p - center) / band) * RH;
const priceAtY = (y) => center + ((H / 2 - y) / RH) * band;

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
const hue = (m) => 170 + Math.min(1, Math.log(m) / Math.log(30)) * 130;
function draw() {
  const L = layout();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!last) return;
  center += (last.p - center) * 0.08;
  if (L.t - boardAt > 1) recompute(L);

  const rowTop = Math.floor(priceAtY(0) / band) + 1, rowBot = Math.floor(priceAtY(H) / band) - 1;
  const k0 = Math.floor(((L.t) - L.xNow / L.pps) / SLOT), k1 = Math.ceil((L.t + (W - L.xNow) / L.pps) / SLOT);
  ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  // horizontal grid + price labels
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  for (let r = rowBot; r <= rowTop + 1; r++) {
    const y = Math.round(yOf(r * band)) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // cells
  const betKeys = new Set(bets.map((b) => b.k + ':' + b.r));
  for (let k = k0; k <= k1; k++) {
    const x0 = xOf(L, k * SLOT), x1 = xOf(L, (k + 1) * SLOT);
    const open = k * SLOT >= L.t + LOCK;
    ctx.strokeStyle = open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, 0); ctx.lineTo(Math.round(x0) + 0.5, H); ctx.stroke();
    if (!open) { if (x1 > 0 && x0 < L.xNow + 2000) { ctx.fillStyle = 'rgba(255,255,255,0.015)'; ctx.fillRect(x0, 0, x1 - x0, H); } continue; }
    if (x1 < 0 || x0 > W) continue;
    for (let r = rowBot; r <= rowTop; r++) {
      const c = board.get(k + ':' + r);
      if (!c || betKeys.has(k + ':' + r)) continue;
      const y = yOf((r + 1) * band), h = RH;
      const hh = hue(c.m), isHover = hover && hover.k === k && hover.r === r;
      ctx.fillStyle = `hsla(${hh},70%,50%,${isHover ? 0.38 : 0.09})`;
      ctx.fillRect(x0 + 1, y + 1, x1 - x0 - 2, h - 2);
      ctx.fillStyle = `hsla(${hh},85%,${isHover ? 88 : 72}%,${isHover ? 1 : 0.85})`;
      ctx.fillText(c.m >= 10 ? c.m.toFixed(1) + 'x' : c.m.toFixed(2) + 'x', (x0 + x1) / 2, y + h / 2);
    }
  }
  // bets
  for (const b of bets) {
    const x0 = xOf(L, b.start), x1 = xOf(L, b.end), y = yOf(b.hi / band * band), h = RH;
    const col = b.status === 'won' ? '#4ade80' : b.status === 'lost' ? '#fb7185' : '#ffffff';
    const fade = b.status === 'open' ? 1 : Math.max(0, 1 - (L.t - b.settledAt) / 4);
    ctx.globalAlpha = fade;
    ctx.fillStyle = b.status === 'open' ? 'rgba(255,255,255,0.16)' : col + '55';
    ctx.fillRect(x0 + 1, y + 1, x1 - x0 - 2, h - 2);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x0 + 2, y + 2, x1 - x0 - 4, h - 4);
    ctx.fillStyle = col;
    const label = b.status === 'won' ? '+' + fmt$(b.stake * (b.mult - 1)) : b.status === 'lost' ? '−' + fmt$(b.stake) : '$' + b.stake + ' · ' + b.mult.toFixed(2) + 'x';
    ctx.fillText(label, (x0 + x1) / 2, y + h / 2);
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }
  // price axis labels (right edge)
  ctx.textAlign = 'right'; ctx.fillStyle = '#7d8aa5'; ctx.font = '11px system-ui, sans-serif';
  for (let r = rowBot; r <= rowTop + 1; r += 2) ctx.fillText((r * band).toFixed(band < 0.01 ? 3 : band < 1 ? 2 : 0), W - 8, yOf(r * band));
  // price line
  ctx.beginPath(); let started = false;
  for (const h of hist) { const x = xOf(L, h.t), y = yOf(h.p); if (x < -10) continue; if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
  ctx.lineTo(L.xNow, yOf(last.p));
  ctx.strokeStyle = '#e8ecf5'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  // now marker
  ctx.strokeStyle = 'rgba(94,242,208,0.5)'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(L.xNow, 0); ctx.lineTo(L.xNow, H); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#5ef2d0'; ctx.beginPath(); ctx.arc(L.xNow, yOf(last.p), 5, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(94,242,208,0.18)'; ctx.beginPath(); ctx.arc(L.xNow, yOf(last.p), 11 + 3 * Math.sin(L.t * 4), 0, 7); ctx.fill();
}
function frame() { draw(); requestAnimationFrame(frame); }

// ---------- input ----------
function cellAt(x, y) {
  if (!last) return null;
  const L = layout();
  const k = Math.floor((L.t + (x - L.xNow) / L.pps) / SLOT), r = Math.floor(priceAtY(y) / band);
  return { k, r };
}
cv.addEventListener('pointermove', (e) => { hover = cellAt(e.clientX, e.clientY); });
cv.addEventListener('pointerleave', () => { hover = null; });
cv.addEventListener('pointerdown', (e) => {
  const c = cellAt(e.clientX, e.clientY); hover = c;
  if (!c) return;
  const cell = board.get(c.k + ':' + c.r), t = now();
  if (!cell || c.k * SLOT < t + LOCK || balance < stake) return;
  if (bets.some((b) => b.status === 'open' && b.k === c.k && b.r === c.r)) return;
  balance -= stake; renderBal();
  bets.push({ id: nextId++, k: c.k, r: c.r, start: c.k * SLOT, end: (c.k + 1) * SLOT, lo: c.r * band, hi: (c.r + 1) * band, stake, mult: cell.m, status: 'open' });
});
function resize() {
  dpr = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
}
addEventListener('resize', resize); resize();
connect(); frame();
window.__tapline = { get state() { return { balance, bets, last, band, boardSize: board.size, sigma: vol.sigma }; } };
