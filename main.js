import { SLOT, LOCK, STEPS, DT, Vol, computeBoard, stepBet, niceBand } from './engine.js?v=3';

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
const now = () => Date.now() / 1000;

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
renderTabs(); renderStakes(); renderBal(); renderStats();
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
  hist = []; last = null; first = null; vol = new Vol(); board = new Map(); band = 1; center = 0;
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
  if (s === 'won') { balance += b.stake * b.mult; wins++; pnl += b.stake * (b.mult - 1); renderBal('up'); }
  else { losses++; pnl -= b.stake; }
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
    ctx.globalAlpha = alpha;
    ctx.shadowColor = col; ctx.shadowBlur = b.status === 'open' ? 12 : 18;
    rr(x0 + g + 0.5, y + g + 0.5, cw - 2 * g - 1, RH - 2 * g - 1, rad);
    ctx.fillStyle = b.status === 'open' ? 'rgba(255,255,255,0.15)' : b.status === 'won' ? 'rgba(74,222,128,0.30)' : 'rgba(251,113,133,0.22)';
    ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.font = '700 ' + Math.max(10.5, Math.min(13, cw / 5.2)) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(b.status === 'open' ? '$' + b.stake + '·' + fmtMult(b.mult) : b.status === 'won' ? '✓' : '✗', x0 + cw / 2, y + RH / 2 + 0.5);
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
    if (c) {
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

  // price line: fades out toward the past, soft glow
  if (hist.length > 1) {
    const x0 = Math.max(0, L.xNow - 360);
    const lg = ctx.createLinearGradient(x0, 0, L.xNow, 0);
    lg.addColorStop(0, 'rgba(238,242,251,0)'); lg.addColorStop(0.6, 'rgba(238,242,251,0.85)'); lg.addColorStop(1, '#ffffff');
    ctx.beginPath(); let started = false;
    for (const h of hist) { const x = xOf(L, h.t); if (x < x0 - 20) continue; const y = yOf(h.p); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
    ctx.lineTo(L.xNow, yLast);
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
}
function frame() { draw(); requestAnimationFrame(frame); }

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
  if (!cell || c.k * SLOT < t + LOCK) return;
  if (balance < stake) return toast('Saldo insuficiente para $' + stake, 'l');
  if (bets.some((b) => b.status === 'open' && b.k === c.k && b.r === c.r)) return;
  balance -= stake; renderBal('down');
  bets.push({ id: nextId++, k: c.k, r: c.r, start: c.k * SLOT, end: (c.k + 1) * SLOT, lo: c.r * band, hi: (c.r + 1) * band, stake, mult: cell.m, status: 'open' });
});
function resize() {
  dpr = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  TOP = document.querySelector('.bar').offsetHeight;
  RH = Math.max(40, Math.ceil(W / 32));   // keeps the 120 s pricing horizon on screen at any width
  cv.width = W * dpr; cv.height = H * dpr;
}
addEventListener('resize', resize); addEventListener('load', resize); resize();
connect(); frame();
window.__tapline = { get state() { return { balance, bets, last, band, RH, cw: layout().cw, boardSize: board.size, sigma: vol.sigma, wins, losses }; } };
