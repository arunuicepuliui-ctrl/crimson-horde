'use strict';
// All-time top scores. Keeps each name's best run.
// Storage: Upstash Redis (free, survives restarts) when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set,
// otherwise a JSON file in ./data (fine on your own PC; wiped on Render's free plan whenever the server sleeps).
const fs = require('fs');
const path = require('path');

const KEEP = 50;
const URL_ = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEY = process.env.LEADERBOARD_KEY || 'crimson-horde:leaderboard';
const FILE = process.env.LEADERBOARD_FILE || path.join(__dirname, 'data', 'leaderboard.json');
const useRedis = !!(URL_ && TOKEN);

let entries = [];
let saveTimer = null;
let loaded = false; // never save before the stored board was read, or a failed load would overwrite it

const better = (a, b) => b.kills - a.kills || b.time - a.time || a.date - b.date; // sort comparator
const norm = (n) => n.trim().toLowerCase();

async function load() {
  try {
    let stored = [];
    if (useRedis) {
      const r = await fetch(`${URL_}/get/${encodeURIComponent(KEY)}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      stored = j.result ? JSON.parse(j.result) : [];
    } else if (fs.existsSync(FILE)) {
      stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    }
    if (!Array.isArray(stored)) throw new Error('stored leaderboard is not a list');
    const pending = entries; // runs finished while the board was unavailable
    entries = stored; loaded = true;
    for (const run of pending) submit(run);
    console.log(`Leaderboard: ${stored.length} entries loaded from ${useRedis ? 'Upstash Redis' : FILE}`);
  } catch (e) {
    console.error(`Leaderboard load failed (${e.message}); retrying in 30 s, nothing will be saved until it loads`);
    setTimeout(load, 30000);
  }
}

async function save() {
  if (!loaded) return;
  const data = JSON.stringify(entries);
  try {
    if (useRedis) {
      const r = await fetch(`${URL_}/set/${encodeURIComponent(KEY)}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: data });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
    } else {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE + '.tmp', data);
      fs.renameSync(FILE + '.tmp', FILE);
    }
  } catch (e) {
    console.error('Leaderboard save failed:', e.message);
  }
}

// Returns true if the run was stored (it's this name's new best and made the kept list).
function submit(run) {
  if (!run || !run.name || run.kills <= 0) return false;
  const i = entries.findIndex((e) => norm(e.name) === norm(run.name));
  if (i >= 0) {
    if (better(run, entries[i]) >= 0) return false; // not better than this name's best
    entries.splice(i, 1);
  }
  entries.push(run);
  entries.sort(better);
  entries.length = Math.min(entries.length, KEEP);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
  return entries.includes(run);
}

const rankOf = (run) => entries.indexOf(run) + 1;

const top = (n = 10) => entries.slice(0, n);

module.exports = { load, submit, rankOf, top, persistent: () => useRedis };
