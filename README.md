# Crimson Horde

Online co-op top-down survival shooter in the spirit of Crimsonland. Up to 8 players per room, played in the browser. No install for your friends — they just open a link.

## Run it

Needs Node.js 18+.

```
npm install
npm start
```

Open http://localhost:3000, enter a name, press ENTER, then "Copy invite link" and send it to friends.

## Let friends join over the internet

`localhost` only works on your machine. Pick one:

**Quickest (no account): Cloudflare quick tunnel** — keep `npm start` running, then in a second terminal:
```
cloudflared tunnel --url http://localhost:3000
```
It prints an `https://….trycloudflare.com` address. Share that. Install cloudflared from Cloudflare's site or `winget install Cloudflare.cloudflared` / `brew install cloudflared`. The address changes every time you restart it.

**Always-on: Render / Railway / Fly.io** — push this folder to a GitHub repo and create a *Web Service*:
- Build command: `npm install`
- Start command: `npm start`
- The server reads `PORT` from the environment, WebSockets work out of the box.
- Render's free tier sleeps after ~15 min idle; the first visit takes ~30 s to wake.
- A `Dockerfile` is included for anything container-based.

Server location matters: everyone's shots and positions go through it. Pick a region near your group (e.g. Frankfurt for Lithuania).

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move |
| Mouse | Aim |
| Left click | Shoot |
| R / right click | Reload |
| 1 2 3 | Pick a perk on level-up |
| R (on game-over screen) | Restart |

Stand next to a downed teammate for 2.5 s to revive them. When everyone is down, the run ends.

## What's in it

- **Weapons (drops):** Pistol, SMG, Shotgun, Assault Rifle, Flamethrower, Rocket Launcher, Plasma Rifle, Gauss Gun. Stronger ones unlock as the run goes on.
- **Bonuses (drops):** Medikit, Nuke, Fireblast, Speed, Freeze, Shield.
- **13 perks** with stacking (Fast Shot, Bloody Mess, Uranium Rounds, Radioactive, Vampire, Regeneration…).
- **Enemies:** zombies, spider swarms, lizards, ranged spitters, brute bosses (~every 75 s).
- Difficulty ramps continuously and scales with player count. Late joiners get catch-up levels.
- Blood and corpses stay on the ground for the whole run.

## How it works

- `server.js` — authoritative simulation at 30 Hz, snapshots at 15 Hz, rooms keyed by code (`?room=ABCD`).
- `public/game.js` — canvas renderer, interpolation for other entities, client-side prediction for your own movement and gunfire feedback, synthesized sound.
- `public/shared.js` — all balance numbers (weapons, enemies, perks, XP curve). Edit this to tune the game; restart the server and refresh.

Movement is client-predicted and speed-checked by the server; everything else (damage, kills, drops, XP) is server-side. Good enough to stop casual cheating among friends, not hardened for public matchmaking.

Bandwidth is ~15–30 KB/s per player at peak.
