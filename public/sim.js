// Game simulation (authoritative). Runs on the Node server for co-op, or inside the browser for solo play.
(function (root) {
'use strict';
const S = typeof module !== 'undefined' && module.exports ? require('./shared.js') : root.SHARED;
const TICK_HZ = 30, DT = 1 / TICK_HZ, SEND_EVERY = 2; // sim 30 Hz, snapshots 15 Hz
const MAX_PLAYERS = 8, MAX_ENEMIES = 360, MAX_BULLETS = 800, MAX_PICKUPS = 30;
const { MAP, PLAYER_R, BASE_SPEED } = S;
const COLORS = ['#4fc3f7', '#ffb74d', '#aed581', '#f06292', '#ba68c8', '#fff176', '#4db6ac', '#e57373'];
const BI = Object.fromEntries(S.BONUSES.map((b, i) => [b.key, i]));
const REVIVE_TIME = 2.5;
const PERK_TIMEOUT = 20;

let nextId = 1;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const R = Math.round;

function weighted(items, weights) {
  let sum = 0; for (const w of weights) sum += w;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

class Room {
  constructor(code, { autoTick = true } = {}) {
    this.code = code;
    this.players = new Map();
    this.tickN = 0;
    this.reset();
    if (autoTick) this.iv = setInterval(() => { try { this.tick(); } catch (e) { console.error(e); } }, 1000 / TICK_HZ);
  }
  destroy() { clearInterval(this.iv); }

  reset() {
    this.enemies = []; this.bullets = []; this.ebullets = []; this.pickups = [];
    this.t = 0; this.spawnAcc = 0; this.nextBoss = 75; this.nextSwarm = 40;
    this.freezeT = 0; this.over = false; this.ev = []; this.hitEv = 0; this.round = (this.round || 0) + 1;
    let i = 0; for (const p of this.players.values()) this.spawnPlayer(p, i++);
  }

  spawnPlayer(p, i, near) {
    const a = i * 1.7, d = i ? 45 : 0;
    const cx = near ? near.x : MAP / 2, cy = near ? near.y : MAP / 2;
    Object.assign(p, {
      x: clamp(cx + Math.cos(a) * d, 40, MAP - 40), y: clamp(cy + Math.sin(a) * d, 40, MAP - 40),
      aim: 0, hp: 100, maxHp: 100, downed: false, weapon: 0, ammo: S.WEAPONS[0].clip, reloadT: 0, fireCd: 0,
      xp: 0, level: 1, pending: 0, choices: null, perks: {}, kills: 0, speedT: 0, shieldT: 2, rev: 0,
      firing: false, wantReload: false, lastIn: Date.now(), budget: 0, epoch: (p.epoch || 0) + 1,
    });
  }

  addPlayer(ws, name) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const id = nextId++;
    const p = { id, ws, name, color: COLORS.find((c) => !used.has(c)) || COLORS[id % COLORS.length] };
    const others = [...this.players.values()];
    const anchor = others.find((o) => !o.downed);
    this.spawnPlayer(p, others.length, anchor);
    if (others.length && !this.over && this.t > 20) {
      // catch-up so late joiners aren't useless
      const avg = others.reduce((s, o) => s + o.level, 0) / others.length;
      p.level = Math.max(1, Math.floor(avg * 0.75));
      p.pending = p.level - 1;
      if (p.pending) p.choices = this.rollPerks(p);
    }
    this.players.set(id, p);
    this.sendTo(p, { t: 'welcome', id, room: this.code, map: MAP });
    this.broadcastRoster();
    return p;
  }

  summary() {
    return { code: this.code, n: this.players.size, names: [...this.players.values()].map((p) => p.name), t: Math.floor(this.t), over: this.over };
  }

  removePlayer(p) { if (!this.over) this.reportRuns([p]); this.players.delete(p.id); this.broadcastRoster(); }

  // Hand finished runs to the leaderboard (host sets room.leaderboard = { submit, rankOf }). Once per player per round.
  // All runs are submitted first, then ranks are read, so teammates finishing together get correct places.
  reportRuns(list) {
    const lb = this.leaderboard;
    if (!lb || this.t < 5) return;
    const placed = [];
    for (const p of list) {
      if (p.reportedRound === this.round) continue;
      p.reportedRound = this.round;
      const run = { name: p.name, kills: p.kills, level: p.level, time: Math.floor(this.t), team: this.players.size, weapon: S.WEAPONS[p.weapon].name, date: Date.now() };
      if (lb.submit(run)) placed.push([p, run]);
    }
    for (const [p, run] of placed) { const rank = lb.rankOf(run); if (rank > 0 && rank <= 10) this.ev.push(['lb', p.id, rank]); }
  }

  broadcastRoster() {
    const list = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color }));
    for (const p of this.players.values()) this.sendTo(p, { t: 'roster', list });
  }

  sendTo(p, m) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); }

  stats(p) {
    const k = p.perks;
    return {
      rateMul: 1 + 0.15 * (k.fastshot || 0),
      dmgMul: 1 + 0.2 * (k.bloody || 0),
      reloadMul: Math.pow(0.7, k.fastload || 0),
      clipMul: 1 + 0.4 * (k.ammo || 0),
      spreadMul: k.sharp ? 0.5 : 1,
      bulletSpd: k.sharp ? 1.25 : 1,
      pierce: k.uranium || 0,
      speedMul: (1 + 0.12 * (k.runner || 0)) * (p.speedT > 0 ? 1.45 : 1),
      xpMul: 1 + 0.3 * (k.learner || 0),
      regen: 2 * (k.regen || 0),
      vamp: 2 * (k.vampire || 0),
      radio: k.radio || 0,
      magnet: k.magnet || 0,
    };
  }

  // ---------------- input ----------------
  onMessage(p, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'i') {
      if (Number.isFinite(m.a)) p.aim = m.a;
      p.firing = !!m.f;
      if (m.r) p.wantReload = true;
      const now = Date.now();
      const el = Math.min(0.5, (now - p.lastIn) / 1000);
      p.lastIn = now;
      const spd = BASE_SPEED * this.stats(p).speedMul;
      p.budget = Math.min(spd * 0.6, p.budget + spd * el * 1.3 + 2);
      if (!p.downed && !this.over && !this.paused && !this.perkPause && m.ep === p.epoch && Number.isFinite(m.x) && Number.isFinite(m.y)) {
        let dx = m.x - p.x, dy = m.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > p.budget) {
          if (d > p.budget + 120) p.epoch++; // badly out of sync -> force client to snap
          const s = p.budget / d; dx *= s; dy *= s;
        }
        p.budget -= Math.min(d, p.budget);
        p.x = clamp(p.x + dx, PLAYER_R, MAP - PLAYER_R);
        p.y = clamp(p.y + dy, PLAYER_R, MAP - PLAYER_R);
      }
    } else if (m.t === 'perk') {
      this.choosePerk(p, m.i | 0);
    } else if (m.t === 'restart') {
      if (this.over) this.reset();
    }
  }

  // ---------------- simulation ----------------
  tick() {
    this.tickN++;
    this.updatePerkPause();
    if (!this.over && this.players.size && !this.paused && !this.perkPause) this.step();
    if (this.tickN % (this.sendEvery || SEND_EVERY) === 0) this.send();
  }

  step() {
    const dt = DT;
    const all = [...this.players.values()];
    const alive = all.filter((p) => !p.downed);
    if (!alive.length) { this.over = true; this.ev.push(['o']); this.reportRuns(all); return; }
    this.t += dt;
    if (this.freezeT > 0) this.freezeT -= dt;
    for (const p of all) this.updatePlayer(p, dt);
    this.spawn(dt, alive);
    this.updateEnemies(dt, alive);
    this.updateBullets(dt);
    this.updateEBullets(dt, alive);
    this.updatePickups(dt, alive);
    this.updateRevives(dt, alive);
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  updatePlayer(p, dt) {
    const st = this.stats(p), w = S.WEAPONS[p.weapon];
    if (p.speedT > 0) p.speedT -= dt;
    if (p.shieldT > 0) p.shieldT -= dt;
    if (p.downed) { p.firing = false; return; }
    if (st.regen && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + st.regen * dt);
    const clip = R(w.clip * st.clipMul);
    p.fireCd -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) { p.reloadT = 0; p.ammo = clip; }
    } else if (p.wantReload && p.ammo < clip) {
      p.reloadT = w.reload * st.reloadMul;
    }
    p.wantReload = false;
    if (p.firing && p.reloadT <= 0) {
      let n = 0;
      while (p.fireCd <= 0 && p.ammo > 0 && n < 4) {
        this.fire(p, w, st); p.ammo--; p.fireCd += 1 / (w.rate * st.rateMul); n++;
      }
      if (p.ammo <= 0) p.reloadT = w.reload * st.reloadMul;
    }
    if (p.fireCd < 0) p.fireCd = 0;
    if (st.radio) {
      const rr = 80;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x, dy = e.y - p.y;
        if (dx * dx + dy * dy < (rr + e.r) ** 2) this.damage(e, 30 * st.radio * dt, p.id, Math.atan2(dy, dx), true);
      }
    }
  }

  fire(p, w, st) {
    const a0 = p.aim, mx = p.x + Math.cos(a0) * 22, my = p.y + Math.sin(a0) * 22;
    for (let i = 0; i < w.pellets; i++) {
      if (this.bullets.length >= MAX_BULLETS) break;
      const a = a0 + (Math.random() - 0.5) * 2 * w.spread * st.spreadMul;
      const multi = w.pellets > 1;
      const sp = w.speed * st.bulletSpd * (multi ? rnd(0.85, 1.1) : 1);
      this.bullets.push({
        x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: w.dmg * st.dmgMul,
        life: w.life * (multi ? rnd(0.8, 1.15) : 1), pierce: w.pierce + st.pierce, kind: w.kind,
        owner: p.id, hit: null, splash: w.splash || 0, splashDmg: (w.splashDmg || 0) * st.dmgMul,
      });
    }
    this.ev.push(['f', p.id, p.weapon]);
  }

  pickType() {
    const t = this.t;
    return weighted([0, 1, 2, 3], [
      5,
      t > 20 ? 2 + t / 60 : 0,
      t > 45 ? 1.5 + t / 90 : 0,
      t > 90 ? 0.8 + t / 160 : 0,
    ]);
  }

  spawn(dt, alive) {
    const n = this.players.size, t = this.t;
    const rate = (0.8 + t * 0.018) * (0.55 + 0.45 * n);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc--;
      if (this.enemies.length >= MAX_ENEMIES) { this.spawnAcc = 0; break; }
      this.spawnEnemy(this.pickType(), alive);
    }
    if (t >= this.nextSwarm) {
      this.nextSwarm += rnd(30, 45);
      const at = this.spawnPoint(alive);
      const cnt = R((8 + t / 20) * (0.6 + 0.4 * n));
      for (let i = 0; i < cnt && this.enemies.length < MAX_ENEMIES; i++) this.spawnEnemy(1, alive, at);
    }
    if (t >= this.nextBoss) {
      this.nextBoss += Math.max(45, 90 - t * 0.05);
      const cnt = 1 + Math.floor(t / 300) + Math.floor((n - 1) / 3);
      for (let i = 0; i < cnt; i++) this.spawnEnemy(4, alive);
      this.ev.push(['boss']);
    }
  }

  spawnPoint(alive) {
    let x = MAP / 2, y = MAP / 2;
    for (let tries = 0; tries < 10; tries++) {
      const p = alive[(Math.random() * alive.length) | 0];
      const a = rnd(0, Math.PI * 2), d = rnd(650, 850);
      x = clamp(p.x + Math.cos(a) * d, 30, MAP - 30);
      y = clamp(p.y + Math.sin(a) * d, 30, MAP - 30);
      if (alive.every((q) => (q.x - x) ** 2 + (q.y - y) ** 2 > 480 * 480)) break;
    }
    return { x, y };
  }

  spawnEnemy(ti, alive, at) {
    const T = S.ENEMIES[ti];
    const pt = at ? { x: clamp(at.x + rnd(-50, 50), 20, MAP - 20), y: clamp(at.y + rnd(-50, 50), 20, MAP - 20) } : this.spawnPoint(alive);
    const hpMul = (1 + this.t / 240) * (ti === 4 ? 0.6 + 0.4 * this.players.size : 1);
    this.enemies.push({
      id: nextId++, ti, x: pt.x, y: pt.y, a: 0, hp: T.hp * hpMul, mhp: T.hp * hpMul,
      spd: T.spd * rnd(0.9, 1.12) * (1 + Math.min(0.35, this.t / 1200)), r: T.r,
      cd: rnd(1, T.cd || 1), kx: 0, ky: 0, dead: false, wob: rnd(0, 6),
    });
  }

  updateEnemies(dt, alive) {
    const frozen = this.freezeT > 0;
    const CELL = 48, grid = new Map();
    for (const e of this.enemies) {
      const k = ((e.x / CELL) | 0) * 1024 + ((e.y / CELL) | 0);
      let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(e);
    }
    const dmgScale = 1 + this.t / 600;
    const kd = Math.exp(-8 * dt);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const T = S.ENEMIES[e.ti];
      let tgt = null, bd = Infinity;
      for (const p of alive) { const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2; if (d < bd) { bd = d; tgt = p; } }
      if (!tgt) continue;
      const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.sqrt(bd) || 1;
      e.x += e.kx * dt; e.y += e.ky * dt; e.kx *= kd; e.ky *= kd;
      if (!frozen) {
        let mx = dx / d, my = dy / d;
        if (T.range) {
          if (d < T.range * 0.55) { mx = -mx; my = -my; }
          else if (d < T.range) { const s = Math.sin(e.wob + this.t * 0.7) > 0 ? 1 : -1; mx = -dy / d * s * 0.7; my = dx / d * s * 0.7; }
          e.cd -= dt;
          if (e.cd <= 0 && d < T.range + 60) {
            e.cd = T.cd * rnd(0.8, 1.25);
            const a = Math.atan2(dy, dx);
            this.ebullets.push({ x: e.x + Math.cos(a) * 18, y: e.y + Math.sin(a) * 18, vx: Math.cos(a) * T.pspd, vy: Math.sin(a) * T.pspd, life: 2.5, dmg: T.pdmg * dmgScale });
          }
        } else if (e.ti === 0) {
          const w = Math.sin(this.t * 2 + e.wob) * 0.35; // zombies shamble
          const c = Math.cos(w), s = Math.sin(w); const nx = mx * c - my * s; my = mx * s + my * c; mx = nx;
        }
        e.x += mx * e.spd * dt; e.y += my * e.spd * dt;
        e.a = Math.atan2(dy, dx);
      }
      // separation
      const cx = (e.x / CELL) | 0, cy = (e.y / CELL) | 0;
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const c = grid.get(ix * 1024 + iy); if (!c) continue;
        for (const o of c) {
          if (o === e || o.dead) continue;
          const ox = e.x - o.x, oy = e.y - o.y, rr = e.r + o.r, dd = ox * ox + oy * oy;
          if (dd < rr * rr && dd > 0.01) {
            const dl = Math.sqrt(dd), push = (rr - dl) * 0.5 * (o.r / rr) * 2;
            e.x += (ox / dl) * push * 0.5; e.y += (oy / dl) * push * 0.5;
          }
        }
      }
      e.x = clamp(e.x, 10, MAP - 10); e.y = clamp(e.y, 10, MAP - 10);
      if (frozen) continue;
      for (const p of alive) {
        if (p.downed) continue;
        const rr = e.r + PLAYER_R;
        if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < rr * rr && p.shieldT <= 0) {
          p.hp -= T.dmg * dmgScale * dt;
          if (p.hp <= 0) this.down(p);
        }
      }
    }
  }

  updateBullets(dt) {
    const out = [];
    for (const b of this.bullets) {
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      b.life -= dt;
      const sx = nx - b.x, sy = ny - b.y, len2 = sx * sx + sy * sy || 1;
      const minX = Math.min(b.x, nx), maxX = Math.max(b.x, nx), minY = Math.min(b.y, ny), maxY = Math.max(b.y, ny);
      for (const e of this.enemies) {
        if (e.dead) continue;
        const rr = e.r + 4;
        if (e.x < minX - rr || e.x > maxX + rr || e.y < minY - rr || e.y > maxY + rr) continue;
        const tt = clamp(((e.x - b.x) * sx + (e.y - b.y) * sy) / len2, 0, 1);
        const px = b.x + sx * tt, py = b.y + sy * tt;
        if ((e.x - px) ** 2 + (e.y - py) ** 2 > rr * rr) continue;
        if (b.hit && b.hit.has(e.id)) continue;
        if (b.splash) { this.explode(px, py, b.splash, b.splashDmg, b.owner); b.life = 0; b.boom = true; break; }
        const ang = Math.atan2(b.vy, b.vx);
        this.damage(e, b.dmg, b.owner, ang);
        if (this.hitEv < 50) { this.hitEv++; this.ev.push(['h', R(px), R(py), +ang.toFixed(2)]); }
        if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = new Set())).add(e.id); }
        else { b.life = 0; break; }
      }
      b.x = nx; b.y = ny;
      if (b.x < 0 || b.y < 0 || b.x > MAP || b.y > MAP) b.life = 0;
      if (b.life > 0) out.push(b);
      else if (b.splash && !b.boom) this.explode(b.x, b.y, b.splash, b.splashDmg, b.owner);
    }
    this.bullets = out;
  }

  updateEBullets(dt, alive) {
    this.ebullets = this.ebullets.filter((b) => {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (this.freezeT > 0) { b.x -= b.vx * dt; b.y -= b.vy * dt; }
      for (const p of alive) {
        if (p.downed) continue;
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (PLAYER_R + 6) ** 2) {
          if (p.shieldT <= 0) { p.hp -= b.dmg; if (p.hp <= 0) this.down(p); }
          return false;
        }
      }
      return b.life > 0;
    });
  }

  explode(x, y, r, dmg, owner) {
    this.ev.push(['x', R(x), R(y), r]);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy);
      if (d < r + e.r) this.damage(e, dmg * (1 - (d / (r + e.r)) * 0.5), owner, Math.atan2(dy, dx));
    }
  }

  damage(e, dmg, owner, ang, noKnock) {
    if (e.dead) return;
    e.hp -= dmg;
    if (!noKnock) {
      const kb = Math.min(260, dmg * 6) * (14 / e.r) * (e.ti === 4 ? 0.15 : 1);
      e.kx += Math.cos(ang) * kb; e.ky += Math.sin(ang) * kb;
    }
    if (e.hp <= 0) this.kill(e, this.players.get(owner), ang);
  }

  kill(e, p, ang) {
    e.dead = true;
    const T = S.ENEMIES[e.ti];
    this.ev.push(['d', R(e.x), R(e.y), e.ti, +ang.toFixed(2)]);
    if (p) {
      p.kills++;
      this.giveXp(p, T.xp);
      const st = this.stats(p);
      if (st.vamp && !p.downed) p.hp = Math.min(p.maxHp, p.hp + st.vamp);
    }
    for (const o of this.players.values()) if (o !== p) this.giveXp(o, T.xp * 0.3);
    const mag = [...this.players.values()].some((q) => q.perks.magnet) ? 1.5 : 1;
    if (e.ti === 4) {
      this.dropPickup(e.x - 15, e.y, BI.weapon);
      this.dropPickup(e.x + 15, e.y, this.randomBonus());
    } else {
      const r = Math.random();
      if (r < 0.02 * mag) this.dropPickup(e.x, e.y, BI.weapon);
      else if (r < 0.065 * mag) this.dropPickup(e.x, e.y, this.randomBonus());
    }
  }

  randomBonus() {
    const opts = S.BONUSES.map((_, i) => i).filter((i) => i !== BI.weapon);
    return weighted(opts, opts.map((i) => S.BONUSES[i].w));
  }

  dropPickup(x, y, bi) {
    if (this.pickups.length >= MAX_PICKUPS) return;
    let w = -1;
    if (bi === BI.weapon) {
      const maxTier = 1 + this.t / 90;
      const opts = S.WEAPONS.map((_, i) => i).filter((i) => i > 0 && S.WEAPONS[i].tier <= maxTier);
      w = opts[(Math.random() * opts.length) | 0];
    }
    this.pickups.push({ id: nextId++, bi, w, x: clamp(x, 20, MAP - 20), y: clamp(y, 20, MAP - 20), t: 14 });
  }

  updatePickups(dt, alive) {
    for (const k of this.pickups) {
      k.t -= dt;
      for (const p of alive) {
        const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy);
        if (p.perks.magnet && d < 230 && d > 1) { k.x += (dx / d) * 320 * dt; k.y += (dy / d) * 320 * dt; }
        if (d < 28) { this.collect(p, k); k.t = 0; break; }
      }
    }
    this.pickups = this.pickups.filter((k) => k.t > 0);
  }

  collect(p, k) {
    const B = S.BONUSES[k.bi], st = this.stats(p);
    this.ev.push(['p', p.id, k.bi, k.w, R(k.x), R(k.y)]);
    switch (B.key) {
      case 'med': p.hp = Math.min(p.maxHp, p.hp + 40); break;
      case 'nuke': {
        this.ev.push(['n', R(k.x), R(k.y)]);
        for (const e of this.enemies) {
          const dx = e.x - k.x, dy = e.y - k.y;
          if (dx * dx + dy * dy < 540 * 540) this.damage(e, 1000 * (1 + this.t / 240), p.id, Math.atan2(dy, dx));
        }
        this.ebullets = this.ebullets.filter((b) => (b.x - k.x) ** 2 + (b.y - k.y) ** 2 > 540 * 540);
        break;
      }
      case 'fire':
        for (let i = 0; i < 40; i++) {
          const a = (i / 40) * Math.PI * 2;
          this.bullets.push({ x: k.x, y: k.y, vx: Math.cos(a) * 650, vy: Math.sin(a) * 650, dmg: 45 * st.dmgMul, life: 1.1, pierce: 3, kind: 1, owner: p.id, hit: null, splash: 0, splashDmg: 0 });
        }
        break;
      case 'speed': p.speedT = 10; break;
      case 'freeze': this.freezeT = 7; break;
      case 'shield': p.shieldT = 9; break;
      case 'weapon': {
        const w = S.WEAPONS[k.w];
        p.weapon = k.w; p.ammo = R(w.clip * st.clipMul); p.reloadT = 0; p.fireCd = 0;
        break;
      }
    }
  }

  giveXp(p, amt) {
    p.xp += amt * this.stats(p).xpMul;
    let need = S.xpNeed(p.level);
    while (p.xp >= need) {
      p.xp -= need; p.level++; p.pending++;
      this.ev.push(['l', p.id, p.level]);
      need = S.xpNeed(p.level);
    }
    if (p.pending > 0 && !p.choices) p.choices = this.rollPerks(p);
  }

  // Any player choosing a perk pauses the whole room. After PERK_TIMEOUT s a random perk is taken
  // so one AFK player can't freeze everyone forever.
  updatePerkPause() {
    let any = false;
    for (const p of this.players.values()) {
      if (!p.choices || this.over) { p.choiceT = 0; continue; }
      any = true;
      if (!p.choiceT) p.choiceT = PERK_TIMEOUT;
      if (!this.noPerkTimeout) p.choiceT -= DT;
      if (p.choiceT <= 0) { p.choiceT = 0; this.choosePerk(p, (Math.random() * p.choices.length) | 0); if (p.choices) any = true; }
    }
    this.perkPause = any;
  }

  rollPerks(p) {
    const avail = S.PERKS.filter((k) => (p.perks[k.key] || 0) < k.max).map((k) => k.key);
    for (let i = avail.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [avail[i], avail[j]] = [avail[j], avail[i]]; }
    if (!avail.length) { p.pending = 0; return null; }
    return avail.slice(0, 3);
  }

  choosePerk(p, i) {
    if (!p.choices || !p.choices[i]) return;
    const key = p.choices[i];
    p.perks[key] = (p.perks[key] || 0) + 1;
    if (key === 'thick') { p.maxHp += 30; if (!p.downed) p.hp += 30; }
    if (key === 'ammo' && p.reloadT <= 0) p.ammo = R(S.WEAPONS[p.weapon].clip * this.stats(p).clipMul);
    p.pending--;
    p.choices = p.pending > 0 ? this.rollPerks(p) : null;
    p.choiceT = p.choices ? PERK_TIMEOUT : 0;
    this.ev.push(['pk', p.id, key]);
  }

  down(p) {
    if (p.downed) return;
    p.downed = true; p.hp = 0; p.rev = 0; p.firing = false; p.reloadT = 0;
    this.ev.push(['dn', p.id]);
  }

  updateRevives(dt, alive) {
    for (const p of this.players.values()) {
      if (!p.downed) continue;
      const helped = alive.some((q) => !q.downed && q !== p && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 55 * 55);
      p.rev = helped ? p.rev + dt : Math.max(0, p.rev - dt * 0.5);
      if (p.rev >= REVIVE_TIME) {
        p.downed = false; p.hp = p.maxHp * 0.5; p.shieldT = 2.5; p.rev = 0;
        this.ev.push(['rv', p.id]);
      }
    }
  }

  // ---------------- networking ----------------
  send() {
    const P = [], E = [], B = [], EB = [], K = [];
    for (const p of this.players.values())
      P.push([p.id, R(p.x), R(p.y), R(p.aim * 100), R((Math.max(0, p.hp) / p.maxHp) * 100), p.downed ? 1 : 0, p.weapon, p.level, p.shieldT > 0 ? 1 : 0, R((p.rev / REVIVE_TIME) * 100), p.kills]);
    for (const e of this.enemies) if (!e.dead) E.push([e.id, e.ti, R(e.x), R(e.y), R(e.a * 100), R((Math.max(0, e.hp) / e.mhp) * 100)]);
    for (const b of this.bullets) B.push([R(b.x), R(b.y), R(b.vx), R(b.vy), b.kind]);
    for (const b of this.ebullets) EB.push([R(b.x), R(b.y), R(b.vx), R(b.vy)]);
    for (const k of this.pickups) K.push([k.id, k.bi, R(k.x), R(k.y), k.w, +k.t.toFixed(1)]);
    const PZ = [];
    for (const p of this.players.values()) if (p.choices) PZ.push([p.id, this.noPerkTimeout ? 0 : Math.ceil(p.choiceT || PERK_TIMEOUT)]);
    const shared = JSON.stringify({ pz: PZ, tm: +this.t.toFixed(3), rd: this.round, fz: this.freezeT > 0 ? 1 : 0, ov: this.over ? 1 : 0, p: P, e: E, b: B, eb: EB, k: K, ev: this.ev });
    this.ev = []; this.hitEv = 0;
    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== 1) continue;
      if (p.ws.bufferedAmount > 512 * 1024) continue; // slow client: skip a frame
      const st = this.stats(p), w = S.WEAPONS[p.weapon];
      const me = {
        x: R(p.x), y: R(p.y), ep: p.epoch, hp: Math.ceil(Math.max(0, p.hp)), mhp: p.maxHp, w: p.weapon, am: p.ammo,
        cl: R(w.clip * st.clipMul), rl: p.reloadT > 0 ? +(1 - p.reloadT / (w.reload * st.reloadMul)).toFixed(2) : 0,
        lv: p.level, xp: Math.floor(p.xp), nx: S.xpNeed(p.level), ch: p.choices, pd: p.pending, pr: p.perks,
        sp: +st.speedMul.toFixed(3), fr: +(w.rate * st.rateMul).toFixed(2), dn: p.downed ? 1 : 0,
        sh: +Math.max(0, p.shieldT).toFixed(1), spd: +Math.max(0, p.speedT).toFixed(1),
      };
      p.ws.send('{"t":"s","me":' + JSON.stringify(me) + ',' + shared.slice(1));
    }
  }
}

const api = { Room, TICK_HZ, MAX_PLAYERS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.SIM = api;
})(this);
