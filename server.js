'use strict';
// Crimson Horde — co-op server. Run: node server.js  (PORT env optional)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room, MAX_PLAYERS } = require('./public/sim.js');

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

// ---------------- HTTP + WS bootstrap ----------------
function start(port = PORT) {
  const rooms = new Map();
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
    if (p === '/health') { res.writeHead(200); return res.end('ok'); }
    if (p === '/rooms') {
      const list = [...rooms.values()].map((r) => r.summary()).sort((a, b) => b.n - a.n);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ max: MAX_PLAYERS, rooms: list }));
    }
    if (p === '/') p = '/index.html';
    const f = path.normalize(path.join(PUB, p));
    if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws, req) => {
    const u = new URL(req.url, 'http://x');
    const code = (u.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'LOBBY';
    const name = (u.searchParams.get('name') || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Player';
    let room = rooms.get(code);
    if (!room) { room = new Room(code); rooms.set(code, room); }
    if (room.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
    const p = room.addPlayer(ws, name);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (d) => room.onMessage(p, d.toString()));
    ws.on('close', () => {
      room.removePlayer(p);
      if (!room.players.size) { room.destroy(); rooms.delete(code); }
    });
    console.log(`[${code}] ${name} joined (${room.players.size} in room)`);
  });
  const hb = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  }, 10000);
  wss.on('close', () => clearInterval(hb));
  server.listen(port, () => console.log(`Crimson Horde running on http://localhost:${port}`));
  return { server, wss, rooms };
}

if (require.main === module) start();
module.exports = { Room, start };
