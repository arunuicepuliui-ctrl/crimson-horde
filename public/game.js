(() => {
'use strict';
const S = window.SHARED, MAP = S.MAP, TAU = Math.PI * 2;
const SOLO = !!window.SOLO_MODE;
const INTERP_DELAY = SOLO ? 0.045 : 0.11; // seconds behind the simulation for remote entities
let soloRoom = null, userPaused = false;

// ---------- canvas ----------
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, ZOOM = 1, dprCap = 2, vignette = null;
function resize() {
  DPR = Math.min(dprCap, window.devicePixelRatio || 1);
  vignette = null;
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ZOOM = Math.max(0.6, Math.min(1.2, Math.sqrt(W * H) / 1050));
}
addEventListener('resize', resize); resize();

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAng(a, b, t) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * t; }
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * f, g = ((n >> 8) & 255) * f, b = (n & 255) * f;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ---------- ground (persistent blood & corpses) ----------
const ground = document.createElement('canvas');
ground.width = ground.height = MAP;
const g = ground.getContext('2d');
function genGround() {
  g.globalAlpha = 1; g.fillStyle = '#3a3124'; g.fillRect(0, 0, MAP, MAP);
  for (let i = 0; i < 240; i++) {
    const x = rnd(0, MAP), y = rnd(0, MAP), r = rnd(80, 300);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.6;
    gr.addColorStop(0, dark ? 'rgba(20,15,8,.22)' : 'rgba(90,75,50,.16)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const specks = ['#2e271c', '#463b2b', '#3f3526', '#51452f', '#2a2318', '#5a4c35'];
  for (let i = 0; i < 30000; i++) {
    g.globalAlpha = rnd(0.25, 0.8); g.fillStyle = pick(specks);
    g.fillRect(rnd(0, MAP), rnd(0, MAP), rnd(1, 3), rnd(1, 3));
  }
  for (let i = 0; i < 900; i++) {
    const x = rnd(0, MAP), y = rnd(0, MAP), r = rnd(1.5, 4.5);
    g.globalAlpha = 0.7; g.fillStyle = '#5f5546'; g.beginPath(); g.ellipse(x, y, r, r * 0.75, rnd(0, 3), 0, TAU); g.fill();
    g.globalAlpha = 0.35; g.fillStyle = '#8a7d66'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, TAU); g.fill();
  }
  g.lineCap = 'round';
  for (let i = 0; i < 700; i++) {
    const x = rnd(0, MAP), y = rnd(0, MAP);
    g.globalAlpha = rnd(0.3, 0.6); g.strokeStyle = pick(['#4e5230', '#5b5a33', '#3f432a']); g.lineWidth = 1.2;
    for (let j = 0; j < 5; j++) { const a = -Math.PI / 2 + rnd(-0.8, 0.8); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * rnd(4, 9), y + Math.sin(a) * rnd(4, 9)); g.stroke(); }
  }
  g.globalAlpha = 1;
  const edge = g.createLinearGradient(0, 0, 60, 0);
  for (const [x, y, w, h, gx0, gy0, gx1, gy1] of [[0, 0, 60, MAP, 0, 0, 60, 0], [MAP - 60, 0, 60, MAP, MAP, 0, MAP - 60, 0], [0, 0, MAP, 60, 0, 0, 0, 60], [0, MAP - 60, MAP, 60, 0, MAP, 0, MAP - 60]]) {
    const gr = g.createLinearGradient(gx0, gy0, gx1, gy1);
    gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  }
  void edge;
}
genGround();

const BLOOD = ['#5e0b07', '#3d4a12', '#640e09', '#4a1450', '#5a0806'];
function bloodSplat(x, y, ti, ang, size = 1) {
  const col = BLOOD[ti] || BLOOD[0];
  g.fillStyle = col;
  const n = (8 + Math.random() * 8) * size;
  for (let i = 0; i < n; i++) {
    const a = ang + rnd(-0.9, 0.9) + (Math.random() < 0.3 ? Math.PI : 0);
    const d = Math.pow(Math.random(), 1.6) * 34 * size;
    g.globalAlpha = rnd(0.35, 0.85);
    g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rnd(1.5, 6) * (1 - d / (40 * size)) + 1, 0, TAU); g.fill();
  }
  g.globalAlpha = 0.5; g.beginPath(); g.ellipse(x, y, 12 * size, 9 * size, ang, 0, TAU); g.fill();
  g.globalAlpha = 1;
}
function scorch(x, y, r) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, 'rgba(10,8,5,.75)'); gr.addColorStop(0.6, 'rgba(20,14,8,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---------- sprites ----------
const PAL = [
  { c1: '#55703a', c2: '#4a6132', c3: '#7b9858', o: '#1d2614' },
  { c1: '#2b2622', c2: '#1a1714', c3: '#3c3530', o: '#0b0a09' },
  { c1: '#7d6237', c2: '#5e4827', c3: '#96784a', o: '#2a1f10' },
  { c1: '#6e3a80', c2: '#4f2a5c', c3: '#9a5cb0', o: '#24102b' },
  { c1: '#7a2a22', c2: '#5d1d18', c3: '#99402f', o: '#2a0b08' },
];
const DARK = PAL.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, shade(v, 0.32)])));

function ell(c, x, y, rx, ry, fill, stroke, lw = 2) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}

function drawEnemy(c, ti, x, y, a, t, o = {}) {
  const P = o.dead ? DARK[ti] : PAL[ti];
  const ph = o.dead ? 0 : o.ph !== undefined ? o.ph : t + (x * 0.013 + y * 0.007);
  c.save(); c.translate(x, y); c.rotate(a);
  if (!o.dead) ell(c, 3, 4, S.ENEMIES[ti].r * 1.05, S.ENEMIES[ti].r * 0.9, 'rgba(0,0,0,.28)');
  switch (ti) {
    case 0: { // zombie
      const sw = Math.sin(ph * 6) * 4;
      c.fillStyle = P.c2; c.strokeStyle = P.o; c.lineWidth = 1.5;
      c.beginPath(); c.rect(-2 + sw, -15, 20, 6); c.fill(); c.stroke();
      c.beginPath(); c.rect(-2 - sw, 9, 20, 6); c.fill(); c.stroke();
      ell(c, 19 + sw, -12, 3.5, 3.5, P.c3); ell(c, 19 - sw, 12, 3.5, 3.5, P.c3);
      ell(c, -3, 0, 10, 15, P.c1, P.o);
      ell(c, 4, 0, 8, 8, P.c3, P.o);
      if (!o.dead) { ell(c, 8, -3, 1.4, 1.4, '#c33'); ell(c, 8, 3, 1.4, 1.4, '#c33'); }
      break;
    }
    case 1: { // spider
      c.strokeStyle = P.c3; c.lineWidth = 2; c.lineCap = 'round';
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
        const w = Math.sin(ph * 20 + i * 1.7 + (s > 0 ? 0 : 1.6)) * 3;
        c.beginPath(); c.moveTo(4 - i * 3, 0); c.lineTo(7 - i * 5 + w, s * 10); c.lineTo(11 - i * 8 + w * 1.4, s * 16); c.stroke();
      }
      ell(c, -7, 0, 9, 7, P.c1, P.o, 1.5);
      ell(c, 4, 0, 5, 5, P.c2, P.o, 1.5);
      if (!o.dead) { ell(c, 7.5, -2, 1.3, 1.3, '#ff3b2f'); ell(c, 7.5, 2, 1.3, 1.3, '#ff3b2f'); }
      break;
    }
    case 2: { // lizard
      const w = Math.sin(ph * 9);
      c.strokeStyle = P.c2; c.lineCap = 'round';
      c.lineWidth = 6; c.beginPath(); c.moveTo(-8, 0); c.quadraticCurveTo(-18, w * 6, -24, w * 10); c.stroke();
      c.lineWidth = 3; c.beginPath(); c.moveTo(-23, w * 9); c.lineTo(-31, w * 14); c.stroke();
      c.fillStyle = P.c2;
      for (const s of [-1, 1]) { c.fillRect(4 + w * 3 * s, s * 7 - 2, 4, s * 7); c.fillRect(-7 - w * 3 * s, s * 7 - 2, 4, s * 7); }
      ell(c, 0, 0, 13, 7, P.c1, P.o, 1.5);
      c.strokeStyle = P.o; c.lineWidth = 1.5;
      for (let i = -6; i <= 6; i += 4) { c.beginPath(); c.moveTo(i, -5); c.lineTo(i - 2, 5); c.stroke(); }
      ell(c, 13, 0, 7, 5, P.c3, P.o, 1.5);
      if (!o.dead) { ell(c, 15, -3, 1.3, 1.3, '#ffd23f'); ell(c, 15, 3, 1.3, 1.3, '#ffd23f'); }
      break;
    }
    case 3: { // spitter
      const pu = 1 + Math.sin(ph * 5) * 0.08;
      ell(c, -2, 0, 15 * pu, 14 * pu, P.c1, P.o);
      for (let i = 0; i < 4; i++) { const aa = i * 1.57 + 0.6 + ph * 1.25; ell(c, Math.cos(aa) * 8 - 2, Math.sin(aa) * 8, 5 * pu, 5 * pu, P.c3); }
      ell(c, 11, 0, 5, 4, o.dead ? P.c2 : '#9fe34a', P.o, 1.5);
      if (!o.dead) { c.globalAlpha = 0.35; ell(c, 13, 0, 8, 6, '#b7ff5a'); c.globalAlpha = 1; }
      break;
    }
    case 4: { // brute
      const sw = Math.sin(ph * 3) * 5;
      ell(c, 6 + sw, -27, 12, 10, P.c2, P.o); ell(c, 6 - sw, 27, 12, 10, P.c2, P.o);
      ell(c, -5, 0, 25, 31, P.c1, P.o, 3);
      c.strokeStyle = P.o; c.lineWidth = 2;
      for (let i = -14; i <= 6; i += 10) { c.beginPath(); c.arc(i, 0, 20, -0.6, 0.6); c.stroke(); }
      c.fillStyle = '#d8c7a0';
      c.beginPath(); c.moveTo(18, -10); c.lineTo(34, -20); c.lineTo(22, -4); c.fill();
      c.beginPath(); c.moveTo(18, 10); c.lineTo(34, 20); c.lineTo(22, 4); c.fill();
      ell(c, 16, 0, 13, 12, P.c3, P.o, 2);
      if (!o.dead) { ell(c, 23, -5, 2.5, 2.5, '#ffe14a'); ell(c, 23, 5, 2.5, 2.5, '#ffe14a'); }
      break;
    }
  }
  if (o.frozen) { c.globalAlpha = 0.45; ell(c, 0, 0, S.ENEMIES[ti].r + 3, S.ENEMIES[ti].r + 3, '#bfe9ff', '#e8f8ff', 1.5); c.globalAlpha = 1; }
  if (o.flash) { c.globalAlpha = 0.5; ell(c, 0, 0, S.ENEMIES[ti].r, S.ENEMIES[ti].r, '#fff'); c.globalAlpha = 1; }
  c.restore();
}

// Pre-rendered enemy animation frames. Drawing vector shapes for hundreds of enemies every frame
// is what made crowds laggy; stamping cached bitmaps is many times cheaper.
const ANIM_W = [6, 20, 9, 5, 3];          // animation angular speed per enemy type (matches drawEnemy)
const SPR_HALF = [32, 28, 42, 28, 62];    // half-size of each sprite box in world units
const SPR_FRAMES = 12;
let sprites = null, spriteScale = 0;
function buildSprites(scale) {
  spriteScale = scale;
  sprites = SPR_HALF.map((half, ti) => [{}, { flash: true }, { frozen: true }].map((variant) => {
    const out = [];
    for (let k = 0; k < SPR_FRAMES; k++) {
      const c = document.createElement('canvas');
      c.width = c.height = Math.ceil(half * 2 * scale);
      const x = c.getContext('2d');
      x.setTransform(scale, 0, 0, scale, half * scale, half * scale);
      drawEnemy(x, ti, 0, 0, 0, 0, Object.assign({ ph: (k / SPR_FRAMES) * TAU / ANIM_W[ti] }, variant));
      out.push(c);
    }
    return out;
  }));
}
// draws one enemy sprite; Z = world->device scale, (ox, oy) = camera top-left in world units
function stampEnemy(ti, x, y, a, t, variant, Z, ox, oy) {
  const ph = t + (x * 0.013 + y * 0.007);
  let f = ((ph * ANIM_W[ti]) / TAU) % 1; if (f < 0) f += 1;
  const img = sprites[ti][variant][(f * SPR_FRAMES) | 0];
  const cs = Math.cos(a), sn = Math.sin(a), h = SPR_HALF[ti] * spriteScale;
  ctx.setTransform(cs, sn, -sn, cs, (x - ox) * Z, (y - oy) * Z);
  ctx.drawImage(img, -h, -h);
}

const GUNLEN = [16, 17, 20, 24, 22, 26, 24, 20];
function drawPlayer(c, x, y, a, color, o) {
  c.save(); c.translate(x, y);
  if (o.down) {
    c.rotate(a + 1.2); c.globalAlpha = 0.85;
    ell(c, 0, 0, 16, 9, shade(color, 0.5), '#111');
    ell(c, 12, 0, 6, 6, '#6d5a48', '#111');
    c.restore(); return;
  }
  ell(c, 3, 4, 16, 14, 'rgba(0,0,0,.3)');
  c.rotate(a);
  c.fillStyle = '#222'; c.fillRect(4, 1, GUNLEN[o.w] || 18, 5);
  c.fillStyle = '#444'; c.fillRect(4, 1, 6, 5);
  if (o.flash) {
    c.fillStyle = '#ffe9a8'; c.globalAlpha = 0.9;
    c.beginPath(); const L = (GUNLEN[o.w] || 18) + 4; c.moveTo(L, 3.5); c.lineTo(L + 14, 0); c.lineTo(L + 18, 3.5); c.lineTo(L + 14, 7); c.closePath(); c.fill();
    c.globalAlpha = 1;
  }
  ell(c, 8, 7, 3.5, 3.5, '#c9a586', '#222', 1);
  ell(c, 0, 0, 10, 14, shade(color, 0.55), '#111', 2);
  ell(c, -1, 0, 7, 11, color);
  ell(c, 1, 0, 6.5, 6.5, '#3b3027', '#111', 1.5);
  c.restore();
  if (o.shield) {
    c.globalAlpha = 0.35 + Math.sin(performance.now() / 90) * 0.1;
    ell(c, x, y, 24, 24, null, '#7cff8a', 3); c.globalAlpha = 1;
  }
}

// ---------- audio ----------
let AC = null, master = null, noiseBuf = null, sndBudget = 0;
function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.35; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { AC = null; }
}
function noise(dur, freq, vol, type = 'bandpass', q = 1) {
  if (!AC || sndBudget <= 0) return; sndBudget--;
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), gn = AC.createGain();
  s.buffer = noiseBuf; s.playbackRate.value = rnd(0.9, 1.1);
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(gn); gn.connect(master); s.start(t, Math.random() * 0.5, dur + 0.05);
}
function tone(f0, f1, dur, vol, type = 'square') {
  if (!AC || sndBudget <= 0) return; sndBudget--;
  const t = AC.currentTime, o = AC.createOscillator(), gn = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const SFX = {
  shot(w, v = 1) {
    switch (w) {
      case 0: noise(0.09, 1700, 0.5 * v); tone(400, 120, 0.05, 0.08 * v); break;
      case 1: noise(0.06, 2300, 0.35 * v); break;
      case 2: noise(0.22, 900, 0.8 * v, 'lowpass'); tone(160, 50, 0.12, 0.2 * v, 'sine'); break;
      case 3: noise(0.08, 1400, 0.45 * v); tone(300, 90, 0.05, 0.08 * v); break;
      case 4: tone(1100, 220, 0.13, 0.12 * v, 'square'); break;
      case 5: tone(2400, 90, 0.3, 0.16 * v, 'sawtooth'); noise(0.15, 3000, 0.25 * v); break;
      case 6: noise(0.3, 500, 0.5 * v, 'lowpass'); break;
      case 7: noise(0.08, 500, 0.18 * v, 'lowpass'); break;
    }
  },
  splat(v = 1) { noise(0.12, 380, 0.35 * v, 'lowpass'); },
  boom(v = 1) { noise(0.7, 260, 0.9 * v, 'lowpass'); tone(90, 30, 0.5, 0.35 * v, 'sine'); },
  pickup() { tone(600, 1300, 0.14, 0.12, 'triangle'); },
  level() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, f, 0.12, 0.1, 'triangle'), i * 70)); },
  hurt() { tone(220, 80, 0.15, 0.15, 'sawtooth'); },
  reload() { tone(900, 900, 0.03, 0.06, 'square'); setTimeout(() => tone(1300, 1300, 0.03, 0.06, 'square'), 120); },
  down() { tone(400, 60, 0.6, 0.18, 'sawtooth'); },
  boss() { tone(70, 50, 1.2, 0.3, 'sawtooth'); noise(1.0, 150, 0.3, 'lowpass'); },
};

// ---------- particles & floating text ----------
const parts = [], texts = [];
function addPart(p) { if (parts.length < 900) parts.push(p); }
function bloodSpray(x, y, ang, ti, n, spd = 160) {
  const col = BLOOD[ti] || BLOOD[0];
  for (let i = 0; i < n; i++) {
    const a = ang + rnd(-0.6, 0.6), s = rnd(0.3, 1) * spd;
    addPart({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.2, 0.45), max: 0.45, size: rnd(1.5, 3.5), color: col, kind: 'blood', drag: 4 });
  }
}
function shell(x, y, a) {
  const sa = a + Math.PI / 2 + rnd(-0.3, 0.3), s = rnd(60, 120);
  addPart({ x, y, vx: Math.cos(sa) * s, vy: Math.sin(sa) * s, life: 0.35, max: 0.35, size: 2, color: '#c9a23a', kind: 'shell', drag: 6, rot: rnd(0, 3) });
}
function explosionFx(x, y, r) {
  for (let i = 0; i < 30; i++) { const a = rnd(0, TAU), s = rnd(40, r * 3); addPart({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.25, 0.6), max: 0.6, size: rnd(6, 16), color: pick(['#ffb347', '#ff7a1f', '#ffd27a']), kind: 'fire', drag: 3 }); }
  for (let i = 0; i < 14; i++) { const a = rnd(0, TAU), s = rnd(10, 60); addPart({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.8, 1.6), max: 1.6, size: rnd(14, 26), color: '#2a2622', kind: 'smoke', drag: 1 }); }
  addPart({ x, y, vx: 0, vy: 0, life: 0.18, max: 0.18, size: r, color: '#fff3c4', kind: 'flash', drag: 0 });
}
function floatText(x, y, s, color = '#fff', big = false) { texts.push({ x, y, s, color, life: big ? 2 : 1.3, max: big ? 2 : 1.3, big }); }

// ---------- network state ----------
let ws = null, myId = 0, roomCode = '', roster = new Map();
let snaps = [], me = null, clockOff = null, lastRound = 0, overShown = false;
const local = { x: MAP / 2, y: MAP / 2, ep: -1, aim: 0 };
const keys = {}, mouse = { x: 0, y: 0, down: false };
let reloadReq = false, shake = 0, hurtFlash = 0, nukeFlash = 0, prevHp = null, lastShotFx = new Map();
let predAmmo = 0, lastSrvAmmo = -1, lastSrvW = -1, localCd = 0, lastReloadUi = 0;
const enemyFlash = new Map();

function connect(name, room) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`);
  ws.onmessage = (ev) => handleMsg(ev.data);
  ws.onclose = () => { if (myId) showJoin('Disconnected from server.'); myId = 0; };
  ws.onerror = () => showJoin('Could not connect.');
}

// Solo: run the same simulation in this page and talk to it through a fake socket.
function connectSolo(name) {
  const room = new window.SIM.Room('SOLO');
  room.sendEvery = 1; room.noPerkTimeout = true;
  soloRoom = room; userPaused = false;
  const sock = { readyState: 1, bufferedAmount: 0, send: (data) => handleMsg(data) };
  const p = room.addPlayer(sock, name);
  ws = { readyState: 1, send: (data) => room.onMessage(p, data), close() { room.destroy(); soloRoom = null; } };
}
function soloPaused() { return !!soloRoom && soloRoom.paused; }
function syncPause() { if (soloRoom) soloRoom.paused = userPaused; }
// true while the simulation is frozen: someone in the room is picking a perk, or solo pause
function isPaused() { const s = latestSnap(); return soloPaused() || !!(s && s.pz && s.pz.length && !s.ov); }
document.addEventListener('visibilitychange', () => { if (document.hidden && soloRoom && !soloRoom.over) { userPaused = true; syncPause(); } });

function handleMsg(data) {
  {
    const m = JSON.parse(data);
    if (m.t === 's') onSnap(m);
    else if (m.t === 'welcome') { myId = m.id; roomCode = m.room; document.getElementById('roomCode').textContent = roomCode; }
    else if (m.t === 'roster') { roster = new Map(m.list.map((p) => [p.id, p])); }
    else if (m.t === 'full') { showJoin('That room is full (8 players).'); }
  }
}

function onSnap(m) {
  const now = performance.now() / 1000;
  if (m.rd !== lastRound) { // new round: wipe state
    if (lastRound) { genGround(); parts.length = 0; texts.length = 0; }
    lastRound = m.rd; snaps = []; clockOff = null; overShown = false;
    document.getElementById('over').classList.add('hidden');
  }
  const target = m.tm - now;
  if (clockOff === null || Math.abs(target - clockOff) > 1) clockOff = target;
  else clockOff += (target - clockOff) * 0.06;
  m.rt = now; m.done = false;
  m.Pm = new Map(m.p.map((a) => [a[0], a]));
  m.Em = new Map(m.e.map((a) => [a[0], a]));
  snaps.push(m); if (snaps.length > 40) snaps.shift();

  const prev = me; me = m.me;
  if (me.ep !== local.ep || me.dn) { local.x = me.x; local.y = me.y; local.ep = me.ep; }
  if (prevHp !== null && me.hp < prevHp - 0.5 && !me.dn) { hurtFlash = Math.min(0.45, hurtFlash + 0.18); SFX.hurt(); }
  prevHp = me.hp;
  if (me.w !== lastSrvW || me.am > lastSrvAmmo) predAmmo = me.am; else predAmmo = Math.min(predAmmo, me.am);
  lastSrvW = me.w; lastSrvAmmo = me.am;
  if (prev && !prev.rl && me.rl) SFX.reload();
  updatePerkUI();
  const mine = m.pz && m.pz.find((z) => z[0] === myId), pt = document.getElementById('perkT');
  if (pt) pt.textContent = mine && mine[1] ? ` · auto-pick in ${mine[1]}s` : '';
  if (m.ov && !overShown) showOver(m);
}

function processEvents(ev) {
  const mx = local.x, my = local.y;
  const vol = (x, y) => clamp(1 - Math.hypot(x - mx, y - my) / 1100, 0.05, 1);
  for (const e of ev) {
    switch (e[0]) {
      case 'd': {
        const [, x, y, ti, ang] = e;
        bloodSplat(x, y, ti, ang, ti === 4 ? 2.2 : 1);
        g.globalAlpha = 0.7; drawEnemy(g, ti, x + Math.cos(ang) * 6, y + Math.sin(ang) * 6, ang + rnd(-0.6, 0.6), 0, { dead: true }); g.globalAlpha = 1;
        bloodSpray(x, y, ang, ti, ti === 4 ? 40 : 10, 220);
        SFX.splat(vol(x, y));
        break;
      }
      case 'h': bloodSpray(e[1], e[2], e[3], 0, 3, 140); break;
      case 'x': explosionFx(e[1], e[2], e[3]); scorch(e[1], e[2], e[3] * 0.7); shake = Math.max(shake, 10 * vol(e[1], e[2])); SFX.boom(vol(e[1], e[2])); break;
      case 'n': nukeFlash = 1; shake = 28; scorch(e[1], e[2], 300); SFX.boom(1); setTimeout(() => SFX.boom(0.7), 120); break;
      case 'f': {
        if (e[1] === myId) break;
        const s = latestSnap(); const p = s && s.Pm.get(e[1]);
        lastShotFx.set(e[1], performance.now());
        if (p) { SFX.shot(e[2], vol(p[1], p[2]) * 0.6); if (e[2] !== 7 && e[2] !== 4) shell(p[1], p[2], p[3] / 100); }
        break;
      }
      case 'p': {
        const [, pid, bi, w, x, y] = e;
        const B = S.BONUSES[bi];
        floatText(x, y - 20, B.key === 'weapon' ? S.WEAPONS[w].name : B.name, B.color);
        if (pid === myId) SFX.pickup();
        break;
      }
      case 'l': { if (e[1] === myId) { SFX.level(); floatText(local.x, local.y - 40, 'LEVEL UP!', '#ffd54f', true); } break; }
      case 'pk': { const s = latestSnap(), p = s && s.Pm.get(e[1]); const pk = S.PERKS.find((k) => k.key === e[2]); if (p && pk) floatText(p[1], p[2] - 34, pk.name, '#ffe082'); break; }
      case 'dn': { const s = latestSnap(), p = s && s.Pm.get(e[1]); if (p) floatText(p[1], p[2] - 30, 'DOWN!', '#ff5252', true); SFX.down(); break; }
      case 'rv': { const s = latestSnap(), p = s && s.Pm.get(e[1]); if (p) floatText(p[1], p[2] - 30, 'REVIVED', '#69f0ae', true); SFX.pickup(); break; }
      case 'boss': floatText(local.x, local.y - 70, 'SOMETHING BIG IS COMING', '#ff7043', true); SFX.boss(); break;
    }
  }
}
const latestSnap = () => snaps[snaps.length - 1];

// ---------- input ----------
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'KeyR') { if (latestSnap() && latestSnap().ov) restart(); else reloadReq = true; }
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') choosePerk(+e.code.slice(5) - 1);
  if (e.code === 'Space') e.preventDefault();
  if (SOLO && (e.code === 'Escape' || e.code === 'KeyP') && soloRoom && !soloRoom.over) { userPaused = !userPaused; syncPause(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });
cv.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', (e) => { if (e.button === 0) mouse.down = true; if (e.button === 2) reloadReq = true; initAudio(); });
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());

function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
setInterval(() => {
  if (!me) return;
  send({ t: 'i', x: +local.x.toFixed(1), y: +local.y.toFixed(1), a: +local.aim.toFixed(3), f: mouse.down ? 1 : 0, r: reloadReq ? 1 : 0, ep: local.ep });
  reloadReq = false;
}, 1000 / 30);

function choosePerk(i) { if (me && me.ch && me.ch[i]) send({ t: 'perk', i }); }
function restart() { send({ t: 'restart' }); }

// ---------- UI panels ----------
const perksEl = document.getElementById('perks');
let perkKey = '';
function updatePerkUI() {
  const k = me && me.ch ? me.ch.join(',') + '|' + me.pd : '';
  if (k === perkKey) return; perkKey = k;
  if (!k) { perksEl.classList.add('hidden'); return; }
  perksEl.innerHTML = `<h2>LEVEL UP — PICK A PERK${me.pd > 1 ? ` (${me.pd})` : ''}<span id="perkT"></span></h2><div class="row">` +
    me.ch.map((key, i) => {
      const p = S.PERKS.find((x) => x.key === key), have = (me.pr && me.pr[key]) || 0;
      return `<button class="perk" data-i="${i}"><div class="k">[${i + 1}]${have ? ` · owned ${have}/${p.max}` : ''}</div><div class="n">${p.name}</div><div class="d">${p.desc}</div></button>`;
    }).join('') + '</div>';
  perksEl.classList.remove('hidden');
  perksEl.querySelectorAll('.perk').forEach((b) => b.addEventListener('mousedown', (e) => { e.stopPropagation(); choosePerk(+b.dataset.i); }));
}

const overEl = document.getElementById('over');
function fmtTime(t) { t = Math.floor(t); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function showOver(m) {
  overShown = true;
  let best = '';
  if (SOLO) {
    const mine = m.p.find((p) => p[0] === myId) || [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
    let hs = {}; try { hs = JSON.parse(localStorage.getItem('ch_best') || '{}'); } catch {}
    const isNew = !hs.time || m.tm > hs.time;
    if (isNew) { hs = { time: m.tm, kills: mine[10], level: mine[7] }; try { localStorage.setItem('ch_best', JSON.stringify(hs)); } catch {} }
    best = isNew ? '<div style="color:#ffd54f;margin:-8px 0 16px">NEW BEST!</div>' : `<div style="color:#8d7c63;margin:-8px 0 16px">Best: ${fmtTime(hs.time)} · ${hs.kills} kills · level ${hs.level}</div>`;
  }
  const rows = m.p.slice().sort((a, b) => b[10] - a[10]).map((p) => {
    const r = roster.get(p[0]) || { name: '?', color: '#fff' };
    return `<tr><td style="color:${r.color}">${esc(r.name)}</td><td>${p[10]}</td><td>${p[7]}</td><td>${S.WEAPONS[p[6]].name}</td></tr>`;
  }).join('');
  overEl.innerHTML = `<div class="panel"><h2>${SOLO ? 'YOU DIED' : 'WIPED OUT'}</h2><div class="time">Survived ${fmtTime(m.tm)}</div>${best}
    <table><tr><th>PLAYER</th><th>KILLS</th><th>LEVEL</th><th>WEAPON</th></tr>${rows}</table>
    <button id="again">PLAY AGAIN</button><div style="margin-top:10px;font-size:12px;color:#7d6d58">or press R</div></div>`;
  overEl.classList.remove('hidden');
  document.getElementById('again').onclick = restart;
}

const joinEl = document.getElementById('join'), roombar = document.getElementById('roombar');
function showJoin(msg) {
  joinEl.classList.remove('hidden'); roombar.classList.add('hidden'); perksEl.classList.add('hidden'); overEl.classList.add('hidden');
  document.getElementById('joinMsg').textContent = msg || '';
  me = null; snaps = []; perkKey = '';
  if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
}
const nameIn = document.getElementById('name'), roomIn = document.getElementById('room');
const qs = new URLSearchParams(location.search);
nameIn.value = localStorage.getItem('ch_name') || '';
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const newCode = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const invite = cleanCode(qs.get('room'));
function join(code) {
  const name = nameIn.value.trim() || 'Player' + ((Math.random() * 99) | 0);
  const room = cleanCode(code) || newCode();
  localStorage.setItem('ch_name', name);
  if (!SOLO) history.replaceState(null, '', '?room=' + room);
  initAudio(); if (AC && AC.state === 'suspended') AC.resume();
  joinEl.classList.add('hidden');
  lastRound = 0;
  if (SOLO) { myId = 0; connectSolo(name); return; }
  roombar.classList.remove('hidden');
  connect(name, room);
}
const playBtn = document.getElementById('play');
playBtn.onclick = () => join(SOLO ? '' : invite || newCode());
if (!SOLO) {
  if (invite) { playBtn.textContent = `JOIN ROOM ${invite}`; document.getElementById('newRoom').classList.remove('hidden'); }
  else playBtn.textContent = 'CREATE NEW ROOM';
  document.getElementById('newRoom').onclick = () => join(newCode());
  document.getElementById('joinCode').onclick = () => { const c = cleanCode(roomIn.value); if (c) join(c); else roomIn.focus(); };
  roomIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); document.getElementById('joinCode').click(); } });
  const listEl = document.getElementById('roomList');
  listEl.addEventListener('click', (e) => { const b = e.target.closest('[data-code]'); if (b && !b.disabled) join(b.dataset.code); });
  async function refreshRooms() {
    if (joinEl.classList.contains('hidden')) return;
    try {
      const r = await (await fetch('rooms', { cache: 'no-store' })).json();
      if (!r.rooms.length) { listEl.innerHTML = '<div class="empty">No games running. Create one and send the link.</div>'; return; }
      listEl.innerHTML = r.rooms.map((rm) => {
        const full = rm.n >= r.max;
        const status = rm.over ? 'game over' : rm.t > 0 ? `${fmtTime(rm.t)} in` : 'starting';
        return `<div class="roomRow${rm.code === invite ? ' invited' : ''}"><div class="rInfo"><b>${esc(rm.code)}</b> <span class="rCount">${rm.n}/${r.max}</span> <span class="rStatus">${status}</span>` +
          `<div class="rNames">${rm.names.map(esc).join(', ')}</div></div><button data-code="${esc(rm.code)}"${full ? ' disabled' : ''}>${full ? 'FULL' : 'JOIN'}</button></div>`;
      }).join('');
    } catch { listEl.innerHTML = '<div class="empty">Could not load rooms.</div>'; }
  }
  refreshRooms(); setInterval(refreshRooms, 3000);
}
if (SOLO) {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('play').textContent = 'START';
  document.querySelector('#join .tag').textContent = 'Survive the horde. Pick perks. Beat your best time.';
  document.querySelector('#join .help').innerHTML = '<b>WASD</b> move · <b>Mouse</b> aim · <b>LMB</b> shoot · <b>R</b> reload · <b>1 2 3</b> pick perk · <b>Esc</b> pause<br>The game pauses while you choose a perk.';
  try { const hs = JSON.parse(localStorage.getItem('ch_best') || 'null'); if (hs) document.getElementById('joinMsg').innerHTML = `<span style="color:#ffd54f">Best: ${fmtTime(hs.time)} · ${hs.kills} kills · level ${hs.level}</span>`; } catch {}
}
nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') playBtn.click(); });
document.getElementById('copy').onclick = (e) => {
  const link = location.origin + location.pathname + '?room=' + roomCode;
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
    () => { e.target.textContent = 'Copied!'; setTimeout(() => (e.target.textContent = 'Copy invite link'), 1500); },
    () => prompt('Send this link to your friends:', link));
};

// ---------- main loop ----------
let lastT = performance.now();
let slowEma = 16, slowFor = 0;
function frame(nowMs) {
  const raw = nowMs - lastT;
  const dt = Math.min(0.05, raw / 1000); lastT = nowMs;
  if (me && raw < 200) {
    slowEma += (raw - slowEma) * 0.05;
    slowFor = slowEma > 24 ? slowFor + raw : 0;
    if (slowFor > 3000 && DPR > 1) { dprCap = 1; resize(); slowFor = 0; }
  }
  sndBudget = 10;
  if (me) update(dt);
  render(dt, nowMs / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function update(dt) {
  const s = latestSnap(); const over = (s && s.ov) || isPaused();
  if (!me.dn && !over) {
    let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    const m = Math.hypot(mx, my);
    if (m) { const sp = S.BASE_SPEED * me.sp * dt / m; local.x = clamp(local.x + mx * sp, S.PLAYER_R, MAP - S.PLAYER_R); local.y = clamp(local.y + my * sp, S.PLAYER_R, MAP - S.PLAYER_R); }
  }
  // aim from player's screen position
  const sx = W / 2 + (local.x - cam.x) * ZOOM, sy = H / 2 + (local.y - cam.y) * ZOOM;
  local.aim = Math.atan2(mouse.y - sy, mouse.x - sx);
  // predicted local shooting feedback (sound, flash, shells)
  if (mouse.down && !me.dn && !over && !me.rl && predAmmo > 0) {
    localCd -= dt;
    let n = 0;
    while (localCd <= 0 && predAmmo > 0 && n < 4) {
      SFX.shot(me.w, 1); lastShotFx.set(myId, performance.now()); predAmmo--; n++;
      if (me.w !== 7 && me.w !== 4) shell(local.x, local.y, local.aim);
      if (me.w === 2) shake = Math.max(shake, 4); else if (me.w === 5 || me.w === 6) shake = Math.max(shake, 5);
      localCd += 1 / me.fr;
    }
  } else localCd = Math.max(0, localCd - dt);
}

const cam = { x: MAP / 2, y: MAP / 2 };
function renderTime() { return performance.now() / 1000 + (clockOff || 0) - INTERP_DELAY; }

function render(dt, t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0d0a07'; ctx.fillRect(0, 0, W, H);
  if (!me || !snaps.length) { drawAttract(t); return; }

  // camera with slight lead toward the cursor
  const lead = 0.18;
  const tx = local.x + (mouse.x - W / 2) / ZOOM * lead, ty = local.y + (mouse.y - H / 2) / ZOOM * lead;
  cam.x = lerp(cam.x, tx, Math.min(1, dt * 10)); cam.y = lerp(cam.y, ty, Math.min(1, dt * 10));
  if (Math.hypot(cam.x - local.x, cam.y - local.y) > 900) { cam.x = local.x; cam.y = local.y; }
  shake *= Math.exp(-dt * 9);
  const shx = (Math.random() - 0.5) * shake, shy = (Math.random() - 0.5) * shake;

  // interpolation pair
  const rt = renderTime();
  let ia = 0;
  for (let i = 0; i < snaps.length; i++) if (snaps[i].tm <= rt) ia = i;
  const a = snaps[ia], b = snaps[ia + 1] && snaps[0].tm <= rt ? snaps[ia + 1] : a;
  const span = b.tm - a.tm, al = span > 0 ? clamp((rt - a.tm) / span, 0, 1) : 1;
  for (const s of snaps) { if (s.done) continue; if (s.tm <= b.tm) { s.done = true; processEvents(s.ev); } }
  const L = latestSnap();
  const frozen = !!b.fz;

  const vw = W / ZOOM, vh = H / ZOOM;
  const left = cam.x - vw / 2 + shx, top = cam.y - vh / 2 + shy;
  ctx.setTransform(DPR * ZOOM, 0, 0, DPR * ZOOM, -left * DPR * ZOOM, -top * DPR * ZOOM);

  // ground
  const gx = clamp(Math.floor(left), 0, MAP), gy = clamp(Math.floor(top), 0, MAP);
  const gw = clamp(Math.ceil(vw) + 2, 0, MAP - gx), gh = clamp(Math.ceil(vh) + 2, 0, MAP - gy);
  if (gw > 0 && gh > 0) ctx.drawImage(ground, gx, gy, gw, gh, gx, gy, gw, gh);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeRect(-3, -3, MAP + 6, MAP + 6);

  const inView = (x, y, m = 60) => x > left - m && x < left + vw + m && y > top - m && y < top + vh + m;

  // pickups (latest state, no interpolation needed)
  for (const k of L.k) {
    const [, bi, x, y, w, ttl] = k;
    if (!inView(x, y)) continue;
    if (ttl < 3 && Math.floor(t * 8) % 2) continue;
    drawPickup(x, y, bi, w, t);
  }

  // downed players under everything else
  const Pa = a.Pm, Pb = b.Pm;
  const players = [];
  for (const [id, pb] of Pb) {
    const pa = Pa.get(id) || pb;
    const isMe = id === myId;
    players.push({
      id, isMe, x: isMe ? local.x : lerp(pa[1], pb[1], al), y: isMe ? local.y : lerp(pa[2], pb[2], al),
      a: isMe ? local.aim : lerpAng(pa[3] / 100, pb[3] / 100, al), hp: pb[4], down: !!pb[5], w: pb[6], lv: pb[7], shield: !!pb[8], rev: pb[9],
    });
  }
  for (const p of players) if (p.down) {
    const r = roster.get(p.id) || { color: '#fff' };
    drawPlayer(ctx, p.x, p.y, p.a, r.color, { down: true });
  }

  // enemies
  const Ea = a.Em;
  let bossBars = [];
  const Z = DPR * ZOOM;
  if (!sprites || spriteScale !== Z) buildSprites(Z);
  const variant = frozen ? 2 : 0;
  for (const [id, eb] of b.Em) {
    const ea = Ea.get(id) || eb;
    const x = lerp(ea[2], eb[2], al), y = lerp(ea[3], eb[3], al);
    if (!inView(x, y, 80)) continue;
    const ang = lerpAng(ea[4] / 100, eb[4] / 100, al);
    const prevHp = enemyFlash.get(id);
    const flash = prevHp !== undefined && eb[5] < prevHp;
    enemyFlash.set(id, eb[5]);
    stampEnemy(eb[1], x, y, ang, t, flash ? 1 : variant, Z, left, top);
    if (eb[1] === 4) bossBars.push([x, y, eb[5]]);
  }
  if (enemyFlash.size > 3000) enemyFlash.clear();
  ctx.setTransform(Z, 0, 0, Z, -left * Z, -top * Z);
  for (const [x, y, hp] of bossBars) {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 32, y - 50, 64, 6);
    ctx.fillStyle = '#e53935'; ctx.fillRect(x - 32, y - 50, 64 * hp / 100, 6);
  }

  // live players
  const nowMs = performance.now();
  for (const p of players) if (!p.down) {
    const r = roster.get(p.id) || { color: '#fff', name: '?' };
    drawPlayer(ctx, p.x, p.y, p.a, r.color, { w: p.w, shield: p.shield, flash: nowMs - (lastShotFx.get(p.id) || 0) < 45 });
    if (!p.isMe) {
      ctx.font = '12px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = r.color;
      ctx.fillText(`${r.name} · ${p.lv}`, p.x, p.y - 30);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(p.x - 18, p.y - 25, 36, 4);
      ctx.fillStyle = p.hp > 35 ? '#66bb6a' : '#e53935'; ctx.fillRect(p.x - 18, p.y - 25, 36 * p.hp / 100, 4);
    }
  }

  // revive markers on top of the horde
  for (const p of players) if (p.down) {
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, TAU); ctx.stroke();
    if (p.rev > 0) { ctx.strokeStyle = '#69f0ae'; ctx.beginPath(); ctx.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + TAU * p.rev / 100); ctx.stroke(); }
    if (!p.isMe) { ctx.fillStyle = '#69f0ae'; ctx.font = 'bold 12px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText('REVIVE', p.x, p.y - 36); }
  }

  // bullets: extrapolate from newest snapshot
  const bdt = isPaused() ? 0 : clamp(performance.now() / 1000 - L.rt, 0, 0.15);
  ctx.lineCap = 'round';
  for (const bl of L.b) {
    const x = bl[0] + bl[2] * bdt, y = bl[1] + bl[3] * bdt, vx = bl[2], vy = bl[3];
    if (!inView(x, y)) continue;
    switch (bl[4]) {
      case 0: ctx.strokeStyle = 'rgba(255,230,140,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - vx * 0.025, y - vy * 0.025); ctx.lineTo(x, y); ctx.stroke(); break;
      case 1: ctx.globalAlpha = 0.35; ell(ctx, x, y, 9, 9, '#4dd0ff'); ctx.globalAlpha = 1; ell(ctx, x, y, 4, 4, '#e0f7ff'); break;
      case 2: ctx.strokeStyle = 'rgba(120,180,255,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - vx * 0.04, y - vy * 0.04); ctx.lineTo(x, y); ctx.stroke(); break;
      case 3: {
        const an = Math.atan2(vy, vx);
        ctx.save(); ctx.translate(x, y); ctx.rotate(an); ctx.fillStyle = '#9e9e9e'; ctx.fillRect(-8, -3, 14, 6); ctx.fillStyle = '#d32f2f'; ctx.fillRect(4, -3, 4, 6); ctx.restore();
        if (Math.random() < 0.6) addPart({ x: x - Math.cos(an) * 10, y: y - Math.sin(an) * 10, vx: rnd(-15, 15), vy: rnd(-15, 15), life: 0.6, max: 0.6, size: rnd(4, 7), color: '#6b6560', kind: 'smoke', drag: 1 });
        break;
      }
      case 4: ctx.globalAlpha = 0.55; ell(ctx, x, y, rnd(5, 10), rnd(5, 10), pick(['#ff9800', '#ffb74d', '#ff5722', '#ffeb3b'])); ctx.globalAlpha = 1; break;
    }
  }
  for (const eb of L.eb) {
    const x = eb[0] + eb[2] * (frozen ? 0 : bdt), y = eb[1] + eb[3] * (frozen ? 0 : bdt);
    ctx.globalAlpha = 0.4; ell(ctx, x, y, 9, 9, '#a5ff4a'); ctx.globalAlpha = 1; ell(ctx, x, y, 4.5, 4.5, '#e6ffb0');
  }

  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life <= 0) {
      if (p.kind === 'blood') { g.globalAlpha = 0.7; g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill(); g.globalAlpha = 1; }
      else if (p.kind === 'shell') { g.globalAlpha = 0.8; g.fillStyle = '#8a6d24'; g.fillRect(p.x, p.y, 3, 1.5); g.globalAlpha = 1; }
      parts[i] = parts[parts.length - 1]; parts.pop(); continue;
    }
    const f = p.life / p.max;
    if (p.kind === 'smoke') { ctx.globalAlpha = f * 0.5; ell(ctx, p.x, p.y, p.size * (2 - f), p.size * (2 - f), p.color); }
    else if (p.kind === 'fire') { ctx.globalAlpha = f; ell(ctx, p.x, p.y, p.size * f + 1, p.size * f + 1, p.color); }
    else if (p.kind === 'flash') { ctx.globalAlpha = f * 0.8; ell(ctx, p.x, p.y, p.size, p.size, p.color); }
    else if (p.kind === 'shell') { ctx.globalAlpha = 1; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 1.5); }
    else { ctx.globalAlpha = 0.9; ell(ctx, p.x, p.y, p.size, p.size, p.color); }
  }
  ctx.globalAlpha = 1;

  // radioactive aura on me
  if (me.pr && me.pr.radio && !me.dn) { ctx.globalAlpha = 0.12 + Math.sin(t * 6) * 0.04; ell(ctx, local.x, local.y, 80, 80, '#76ff03'); ctx.globalAlpha = 1; }

  // floating texts
  ctx.textAlign = 'center';
  for (let i = texts.length - 1; i >= 0; i--) {
    const tx2 = texts[i]; tx2.life -= dt; tx2.y -= dt * 22;
    if (tx2.life <= 0) { texts.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, tx2.life / tx2.max * 2);
    ctx.font = tx2.big ? 'bold 20px Oswald, sans-serif' : '14px Oswald, sans-serif';
    ctx.fillStyle = '#000'; ctx.fillText(tx2.s, tx2.x + 1, tx2.y + 1);
    ctx.fillStyle = tx2.color; ctx.fillText(tx2.s, tx2.x, tx2.y);
  }
  ctx.globalAlpha = 1;

  // ---- screen space ----
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!vignette) {
    vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.6)');
  }
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  if (frozen) { ctx.fillStyle = 'rgba(120,200,255,.10)'; ctx.fillRect(0, 0, W, H); }
  hurtFlash = Math.max(0, hurtFlash - dt * 1.5);
  if (hurtFlash > 0) { ctx.fillStyle = `rgba(160,0,0,${hurtFlash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  nukeFlash = Math.max(0, nukeFlash - dt * 1.8);
  if (nukeFlash > 0) { ctx.fillStyle = `rgba(255,250,220,${nukeFlash * 0.85})`; ctx.fillRect(0, 0, W, H); }
  drawHUD(L, players, t);
}

function drawPickup(x, y, bi, w, t) {
  const B = S.BONUSES[bi];
  const bob = Math.sin(t * 4 + x) * 2;
  ctx.save(); ctx.translate(x, y + bob);
  ctx.globalAlpha = 0.25 + Math.sin(t * 5) * 0.08; ell(ctx, 0, 0, 20, 20, B.color); ctx.globalAlpha = 1;
  ell(ctx, 0, 0, 13, 13, '#16110c', B.color, 2);
  ctx.fillStyle = B.color; ctx.strokeStyle = B.color; ctx.lineWidth = 2;
  switch (B.key) {
    case 'med': ctx.fillRect(-2.5, -7, 5, 14); ctx.fillRect(-7, -2.5, 14, 5); break;
    case 'nuke': for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 9, i * TAU / 3 - 0.5, i * TAU / 3 + 0.5); ctx.fill(); } ell(ctx, 0, 0, 2.5, 2.5, '#16110c'); break;
    case 'fire': for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.stroke(); } break;
    case 'speed': ctx.beginPath(); ctx.moveTo(2, -9); ctx.lineTo(-5, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 9); ctx.lineTo(5, -1); ctx.lineTo(0, -1); ctx.closePath(); ctx.fill(); break;
    case 'freeze': for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * -9, Math.sin(a) * -9); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.stroke(); } break;
    case 'shield': ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, -5); ctx.lineTo(6, 3); ctx.lineTo(0, 9); ctx.lineTo(-6, 3); ctx.lineTo(-7, -5); ctx.closePath(); ctx.stroke(); break;
    case 'weapon': ctx.fillStyle = '#ddd'; ctx.fillRect(-9, -2, 16, 4); ctx.fillRect(-6, 1, 4, 6); break;
  }
  ctx.restore();
  ctx.font = '10px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = B.color;
  ctx.fillText(B.key === 'weapon' ? S.WEAPONS[w].name.toUpperCase() : B.name.toUpperCase(), x, y + 28);
}

function bar(x, y, w, h, f, col, bg = 'rgba(0,0,0,.55)') {
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(f, 0, 1), h);
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawHUD(L, players, t) {
  const x0 = 18, y0 = 18;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  // HP
  bar(x0, y0, 240, 18, me.hp / me.mhp, me.hp / me.mhp > 0.35 ? '#c62828' : (Math.floor(t * 4) % 2 ? '#ff1744' : '#7f0000'));
  ctx.fillStyle = '#fff'; ctx.font = '13px "Share Tech Mono", ui-monospace, monospace'; ctx.fillText(`HP ${me.hp}/${me.mhp}`, x0 + 8, y0 + 14);
  // XP
  bar(x0, y0 + 24, 240, 8, me.xp / me.nx, '#cddc39');
  ctx.font = 'bold 15px Oswald, sans-serif'; ctx.fillStyle = '#e6ee9c'; ctx.fillText(`LEVEL ${me.lv}`, x0, y0 + 52);
  // weapon
  const w = S.WEAPONS[me.w];
  ctx.fillStyle = '#f3e9d6'; ctx.font = 'bold 18px Oswald, sans-serif'; ctx.fillText(w.name.toUpperCase(), x0, y0 + 78);
  if (me.rl) { bar(x0, y0 + 86, 240, 10, me.rl, '#90a4ae'); ctx.fillStyle = '#cfd8dc'; ctx.font = '11px "Share Tech Mono", ui-monospace, monospace'; ctx.fillText('RELOADING', x0 + 4, y0 + 95); }
  else {
    const n = Math.min(me.cl, 60), pw = Math.max(2, Math.min(8, 240 / n - 2));
    for (let i = 0; i < n; i++) { const filled = i < Math.round(me.am / me.cl * n); ctx.fillStyle = filled ? '#ffca28' : 'rgba(255,255,255,.12)'; ctx.fillRect(x0 + i * (pw + 2), y0 + 86, pw, 10); }
    ctx.fillStyle = '#b9a98e'; ctx.font = '12px "Share Tech Mono", ui-monospace, monospace'; ctx.fillText(`${me.am}/${me.cl}`, x0 + Math.min(240, n * (pw + 2)) + 6, y0 + 95);
  }
  let yy = y0 + 118;
  ctx.font = '12px "Share Tech Mono", ui-monospace, monospace';
  if (me.spd > 0) { ctx.fillStyle = '#29b6f6'; ctx.fillText(`SPEED ${me.spd.toFixed(0)}s`, x0, yy); yy += 16; }
  if (me.sh > 0) { ctx.fillStyle = '#66bb6a'; ctx.fillText(`SHIELD ${me.sh.toFixed(0)}s`, x0, yy); yy += 16; }
  const owned = Object.entries(me.pr || {});
  if (owned.length) {
    ctx.fillStyle = '#8d7c63';
    for (const [k, n] of owned) { const p = S.PERKS.find((x) => x.key === k); ctx.fillText(`${p.name}${n > 1 ? ' x' + n : ''}`, x0, yy); yy += 14; }
  }

  // timer + kills
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px Oswald, sans-serif'; ctx.fillStyle = '#f3e9d6'; ctx.fillText(fmtTime(L.tm), W / 2, 40);
  const totalKills = L.p.reduce((s, p) => s + p[10], 0);
  ctx.font = '13px "Share Tech Mono", ui-monospace, monospace'; ctx.fillStyle = '#b9a98e'; ctx.fillText(`${totalKills} kills · ${L.e.length} hostiles`, W / 2, 60);
  if (L.fz) { ctx.fillStyle = '#b3e5fc'; ctx.font = 'bold 16px Oswald, sans-serif'; ctx.fillText('FROZEN', W / 2, 82); }

  // team list
  ctx.textAlign = 'right';
  let ty = 26;
  for (const p of SOLO ? [] : L.p) {
    const r = roster.get(p[0]) || { name: '?', color: '#fff' };
    ctx.font = (p[0] === myId ? 'bold ' : '') + '13px "Share Tech Mono", ui-monospace, monospace';
    ctx.fillStyle = p[5] ? '#ff5252' : r.color;
    ctx.fillText(`${r.name}  L${p[7]}  ${p[10]} kills${p[5] ? '  DOWN' : ''}`, W - 18, ty);
    bar(W - 118, ty + 4, 100, 3, p[4] / 100, p[5] ? '#555' : '#66bb6a');
    ty += 24;
  }

  // minimap
  const mm = 140, mx0 = W - mm - 16, my0 = H - mm - 16, sc = mm / MAP;
  ctx.fillStyle = 'rgba(10,8,6,.7)'; ctx.fillRect(mx0, my0, mm, mm);
  ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.strokeRect(mx0 + 0.5, my0 + 0.5, mm - 1, mm - 1);
  ctx.fillStyle = '#c62828';
  for (const e of L.e) ctx.fillRect(mx0 + e[2] * sc - (e[1] === 4 ? 2 : 0.75), my0 + e[3] * sc - (e[1] === 4 ? 2 : 0.75), e[1] === 4 ? 4 : 1.5, e[1] === 4 ? 4 : 1.5);
  for (const k of L.k) { ctx.fillStyle = S.BONUSES[k[1]].color; ctx.fillRect(mx0 + k[2] * sc - 1.5, my0 + k[3] * sc - 1.5, 3, 3); }
  for (const p of L.p) {
    const r = roster.get(p[0]) || { color: '#fff' };
    const px = p[0] === myId ? local.x : p[1], py = p[0] === myId ? local.y : p[2];
    ctx.fillStyle = p[5] ? '#ff5252' : r.color; ctx.beginPath(); ctx.arc(mx0 + px * sc, my0 + py * sc, p[0] === myId ? 3.5 : 2.5, 0, TAU); ctx.fill();
  }

  // edge arrows pointing to downed teammates that are off-screen
  for (const p of players) {
    if (!p.down || p.isMe) continue;
    const sx = W / 2 + (p.x - cam.x) * ZOOM, sy = H / 2 + (p.y - cam.y) * ZOOM;
    if (sx > 20 && sx < W - 20 && sy > 20 && sy < H - 20) continue;
    const an = Math.atan2(sy - H / 2, sx - W / 2);
    const ex = clamp(sx, 40, W - 40), ey = clamp(sy, 120, H - 60);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(an);
    ctx.fillStyle = Math.floor(t * 3) % 2 ? '#69f0ae' : '#ff5252';
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  if (!SOLO && L.pz && L.pz.length && !L.ov) {
    const others = L.pz.filter((z) => z[0] !== myId);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px Oswald, sans-serif'; ctx.fillStyle = '#f3e9d6'; ctx.fillText('PAUSED', W / 2, H / 2 - 110);
    if (others.length) {
      const names = others.map((z) => (roster.get(z[0]) || { name: '?' }).name);
      const secs = Math.max(...others.map((z) => z[1]));
      ctx.font = '15px "Share Tech Mono", ui-monospace, monospace'; ctx.fillStyle = '#ffd54f';
      ctx.fillText(`${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} picking a perk · ${secs}s`, W / 2, H / 2 - 84);
    }
  }
  if (soloRoom && userPaused && !L.ov) {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.font = 'bold 44px Oswald, sans-serif'; ctx.fillStyle = '#f3e9d6'; ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.font = '14px "Share Tech Mono", ui-monospace, monospace'; ctx.fillStyle = '#b9a98e'; ctx.fillText('Press Esc to resume', W / 2, H / 2 + 28);
  }

  // downed message
  if (me.dn && !L.ov) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px Oswald, sans-serif'; ctx.fillStyle = '#ff5252'; ctx.fillText('YOU ARE DOWN', W / 2, H / 2 - 70);
    ctx.font = '14px "Share Tech Mono", ui-monospace, monospace'; ctx.fillStyle = '#e0d4c0'; ctx.fillText('A teammate must stand next to you to revive', W / 2, H / 2 - 46);
  }

  // crosshair
  if (!me.dn) {
    const cx = mouse.x, cy = mouse.y, spread = 8 + w.spread * 60;
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, spread, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - spread - 5, cy); ctx.lineTo(cx - spread + 3, cy); ctx.moveTo(cx + spread - 3, cy); ctx.lineTo(cx + spread + 5, cy);
    ctx.moveTo(cx, cy - spread - 5); ctx.lineTo(cx, cy - spread + 3); ctx.moveTo(cx, cy + spread - 3); ctx.lineTo(cx, cy + spread + 5); ctx.stroke();
    if (me.rl) { ctx.strokeStyle = '#ffca28'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, spread + 6, -Math.PI / 2, -Math.PI / 2 + TAU * me.rl); ctx.stroke(); }
  }
}

// title-screen backdrop
const attract = [];
function drawAttract(t) {
  ctx.drawImage(ground, 900 + Math.sin(t * 0.05) * 200, 900, W / 1.4, H / 1.4, 0, 0, W, H);
  if (attract.length < 26) attract.push({ ti: (Math.random() * 4) | 0, x: rnd(0, W), y: H + 40, a: -Math.PI / 2 + rnd(-0.4, 0.4), s: rnd(25, 70) });
  for (const z of attract) {
    z.x += Math.cos(z.a) * z.s * 0.016; z.y += Math.sin(z.a) * z.s * 0.016;
    if (z.y < -60) { z.y = H + 40; z.x = rnd(0, W); }
    drawEnemy(ctx, z.ti, z.x, z.y, z.a, t, {});
  }
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H);
}
})();
