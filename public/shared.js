// Shared game definitions — loaded by both the Node server and the browser.
(function (root) {
  const MAP = 2400;
  const BASE_SPEED = 215;
  const PLAYER_R = 14;

  // spread = half-angle in radians; tier gates when the weapon can drop (tier <= 1 + t/90)
  const WEAPONS = [
    { key: 'pistol',  name: 'Pistol',          tier: 0, rate: 4,    dmg: 24,  spread: 0.04, pellets: 1, speed: 1000, clip: 12,  reload: 1.1, pierce: 0,  kind: 0, life: 1.0 },
    { key: 'smg',     name: 'SMG',             tier: 1, rate: 13,   dmg: 10,  spread: 0.13, pellets: 1, speed: 1000, clip: 40,  reload: 1.4, pierce: 0,  kind: 0, life: 0.9 },
    { key: 'shotgun', name: 'Shotgun',         tier: 1, rate: 1.4,  dmg: 13,  spread: 0.30, pellets: 8, speed: 900,  clip: 8,   reload: 1.9, pierce: 0,  kind: 0, life: 0.55 },
    { key: 'rifle',   name: 'Assault Rifle',   tier: 1, rate: 9,    dmg: 19,  spread: 0.06, pellets: 1, speed: 1150, clip: 30,  reload: 1.6, pierce: 0,  kind: 0, life: 1.0 },
    { key: 'plasma',  name: 'Plasma Rifle',    tier: 3, rate: 5,    dmg: 40,  spread: 0.03, pellets: 1, speed: 720,  clip: 24,  reload: 1.7, pierce: 2,  kind: 1, life: 1.3 },
    { key: 'gauss',   name: 'Gauss Gun',       tier: 3, rate: 1.7,  dmg: 130, spread: 0,    pellets: 1, speed: 1900, clip: 6,   reload: 1.7, pierce: 25, kind: 2, life: 0.8 },
    { key: 'rocket',  name: 'Rocket Launcher', tier: 2, rate: 1.25, dmg: 40,  spread: 0.02, pellets: 1, speed: 620,  clip: 5,   reload: 2.1, pierce: 0,  kind: 3, life: 1.6, splash: 120, splashDmg: 110 },
    { key: 'flamer',  name: 'Flamethrower',    tier: 2, rate: 22,   dmg: 5,   spread: 0.22, pellets: 1, speed: 430,  clip: 150, reload: 2.3, pierce: 4,  kind: 4, life: 0.5 },
    // hitscan: hits the first enemy along the aim within `range`, then arcs to the nearest unhit enemy within `jump`, `chain` times
    { key: 'shock',   name: 'Shock Chain',     tier: 2, rate: 3,    dmg: 48,  spread: 0,    pellets: 1, speed: 0,    clip: 18,  reload: 1.6, pierce: 0,  kind: 5, life: 0, range: 560, jump: 170, chain: 6, falloff: 0.85 },
  ];

  const ENEMIES = [
    { key: 'zombie',  hp: 60,   spd: 58,  r: 16, dmg: 22, xp: 3 },
    { key: 'spider',  hp: 22,   spd: 155, r: 11, dmg: 12, xp: 2 },
    { key: 'lizard',  hp: 48,   spd: 100, r: 14, dmg: 18, xp: 4 },
    { key: 'spitter', hp: 75,   spd: 70,  r: 16, dmg: 10, xp: 6, range: 400, cd: 2.4, pdmg: 12, pspd: 280 },
    { key: 'brute',   hp: 1600, spd: 62,  r: 34, dmg: 45, xp: 70 },
  ];

  const BONUSES = [
    { key: 'med',    name: 'Medikit',   w: 5,   color: '#e53935' },
    { key: 'nuke',   name: 'Nuke',      w: 1.2, color: '#fdd835' },
    { key: 'fire',   name: 'Fireblast', w: 2,   color: '#ff7043' },
    { key: 'speed',  name: 'Speed',     w: 2.5, color: '#29b6f6' },
    { key: 'freeze', name: 'Freeze',    w: 1.5, color: '#b3e5fc' },
    { key: 'shield', name: 'Shield',    w: 2,   color: '#66bb6a' },
    { key: 'weapon', name: 'Weapon',    w: 4,   color: '#bdbdbd' },
  ];

  const PERKS = [
    { key: 'fastshot', name: 'Fast Shot',             max: 3, desc: '+15% fire rate' },
    { key: 'bloody',   name: 'Bloody Mess',           max: 3, desc: '+20% damage' },
    { key: 'fastload', name: 'Fastloader',            max: 2, desc: 'Reload 30% faster' },
    { key: 'ammo',     name: 'Ammo Maniac',           max: 2, desc: '+40% clip size' },
    { key: 'thick',    name: 'Thick Skinned',         max: 3, desc: '+30 max HP' },
    { key: 'regen',    name: 'Regeneration',          max: 2, desc: 'Regenerate 2 HP/s' },
    { key: 'runner',   name: 'Long Distance Runner',  max: 3, desc: '+12% move speed' },
    { key: 'vampire',  name: 'Vampire',               max: 2, desc: 'Heal 2 HP per kill' },
    { key: 'uranium',  name: 'Uranium Rounds',        max: 2, desc: 'Bullets pierce +1 enemy' },
    { key: 'radio',    name: 'Radioactive',           max: 2, desc: 'Burn enemies near you (30 dps)' },
    { key: 'magnet',   name: 'Bonus Magnet',          max: 1, desc: 'Pull pickups, +50% drop chance' },
    { key: 'learner',  name: 'Instant Learner',       max: 2, desc: '+30% XP' },
    { key: 'sharp',    name: 'Sharpshooter',          max: 1, desc: 'Half spread, +25% bullet speed' },
    { key: 'tele',     name: 'Telekinetic',           max: 1, desc: 'Hold your crosshair on a pickup to grab it from afar' },
  ];

  const xpNeed = (lv) => Math.floor(25 * Math.pow(lv, 1.55));

  const api = { MAP, BASE_SPEED, PLAYER_R, WEAPONS, ENEMIES, BONUSES, PERKS, xpNeed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SHARED = api;
})(this);
