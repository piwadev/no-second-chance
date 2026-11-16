// NO SECOND CHANCE — tuning constants. Everything that defines a match lives here.
export const MATCH = {
  ROUNDS_TO_WIN: 7,      // first to 7 wins the match (short format; the full competitive spec is 13)
  HALF_ROUNDS: 6,        // teams swap sides after this many rounds
  BUY_TIME: 20,          // seconds, frozen in spawn, buy menu open
  PREP_TIME: 10,         // seconds, defenders may move, attackers held at spawn barrier
  ROUND_TIME: 120,       // live round
  BOMB_TIMER: 40,
  PLANT_TIME: 4,
  DEFUSE_TIME: 7,
  END_TIME: 7,           // round summary
  BLEEDOUT: 20,          // downed bleed-out timer
  REVIVE_TIME: 6,
  REVIVE_HP: 35,
  DOWNED_HP: 45,         // damage a downed player can absorb before being finished
  CATASTROPHIC: 55,      // overkill beyond 0 HP in a single hit = instant elimination
  START_MONEY: 800, MAX_MONEY: 16000,
  WIN_REWARD: 3000, LOSS_BASE: 1400, LOSS_STEP: 500, LOSS_MAX: 3400,
  PLANT_BONUS: 300, KILL_REWARD: 300, RESCUE_REWARD: 200, DEFUSE_BONUS: 300,
};

export const COLORS = {
  graphite: 0x171a1d, slate: 0x252b32, gold: 0xd5a64a, light: 0xe7e9eb,
  injury: 0xd8433b, def: 0x3f8fe0, atk: 0xe58a2e,
};

export const TEAM_NAME = { atk: 'ATTACKERS', def: 'DEFENDERS' };

// Spray patterns are fixed per weapon (deterministic, learnable). Each entry is the cumulative
// [yaw, pitch] offset in degrees for shot i of a spray. Pitch is upward kick, yaw is sideways drift.
function pattern(n, pitchMax, k, yawFn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([+yawFn(i).toFixed(3), +(pitchMax * (1 - Math.exp(-i / k))).toFixed(3)]);
  return out;
}
const AK_PATTERN = pattern(30, 6.6, 5.2, i => i < 6 ? (i % 2 ? 0.06 : -0.04) * i
  : i < 15 ? -0.35 * (i - 5) : i < 22 ? -3.15 + 0.72 * (i - 14) : 1.9 - 0.55 * (i - 21));
const M4_PATTERN = pattern(30, 5.0, 5.8, i => i < 7 ? 0.03 * i * (i % 2 ? 1 : -1)
  : i < 14 ? 0.26 * (i - 6) : i < 22 ? 1.82 - 0.5 * (i - 13) : -2.18 + 0.4 * (i - 21));
const PISTOL_PATTERN = pattern(12, 4.2, 4, i => [0, .1, -.12, .18, -.2, .25, -.15, .3, -.3, .2, -.25, .3][i]);
const HEAVY_PATTERN = pattern(7, 6.5, 2.2, i => [0, .25, -.3, .45, -.4, .5, -.45][i]);

export const WEAPONS = {
  ak: { id: 'ak', name: 'AK-74 RIFLE', short: 'AK', slot: 1, price: 2700, dmg: 36, pen: 0.775, headMult: 4, interval: 0.1, auto: true,
    mag: 30, mags: 3, reload: 2.5, emptyReload: 2.9, draw: 1.0, speed: 0.88, spread: 0.0016, moveSpread: 0.09, recover: 11,
    punch: 0.42, pattern: AK_PATTERN, kill: 300, color: 0x6b4a2b, sound: { f: 140, n: 0.42, d: 0.22 } },
  m4: { id: 'm4', name: 'M4 CARBINE', short: 'M4', slot: 1, price: 3100, dmg: 33, pen: 0.70, headMult: 4, interval: 0.09, auto: true,
    mag: 30, mags: 3, reload: 3.1, emptyReload: 3.4, draw: 1.0, speed: 0.9, spread: 0.0012, moveSpread: 0.08, recover: 12,
    punch: 0.4, pattern: M4_PATTERN, kill: 300, color: 0x2a2d31, sound: { f: 175, n: 0.36, d: 0.18 } },
  pistol: { id: 'pistol', name: 'P9 SERVICE PISTOL', short: 'P9', slot: 2, price: 0, dmg: 28, pen: 0.5, headMult: 4, interval: 0.15, auto: false,
    mag: 12, mags: 3, reload: 2.2, emptyReload: 2.4, draw: 0.6, speed: 1.0, spread: 0.0025, moveSpread: 0.045, recover: 9,
    punch: 0.5, pattern: PISTOL_PATTERN, kill: 300, color: 0x1d1f22, sound: { f: 260, n: 0.28, d: 0.12 } },
  heavy: { id: 'heavy', name: 'R50 HEAVY PISTOL', short: 'R50', slot: 2, price: 700, dmg: 53, pen: 0.9, headMult: 4, interval: 0.3, auto: false,
    mag: 7, mags: 4, reload: 2.4, emptyReload: 2.6, draw: 0.7, speed: 0.95, spread: 0.002, moveSpread: 0.11, recover: 5,
    punch: 0.55, pattern: HEAVY_PATTERN, kill: 300, color: 0x8a8f96, sound: { f: 95, n: 0.5, d: 0.3 } },
};

export const ZONE_MULT = { head: 1, chest: 1, larm: 0.75, rarm: 0.75, lleg: 0.6, rleg: 0.6 }; // head uses weapon headMult

export const EQUIPMENT = {
  armor: { name: 'Body armor', price: 650 },
  helmet: { name: 'Helmet', price: 350 },
  medkit: { name: 'Medical kit', price: 700, max: 1 },
  bandage: { name: 'Bandage', price: 150, max: 2 },
  tourniquet: { name: 'Tourniquet', price: 250, max: 1 },
  smoke: { name: 'Smoke grenade', price: 300, max: 1 },
  flash: { name: 'Flashbang', price: 200, max: 2 },
  frag: { name: 'Frag grenade', price: 350, max: 1 },
  resupply: { name: 'Resupply magazines', price: 200 },
};

export const MOVE = {
  run: 5.0, sprint: 6.4, crouch: 2.3, crawl: 0.65, drag: 1.7, accel: 48, friction: 9, air: 6,
  jump: 4.6, gravity: 15, eye: 1.62, eyeCrouch: 1.15, eyeDowned: 0.38, radius: 0.34, step: 0.5,
  legSlow: 0.78,
};

export const BOT_NAMES = {
  atk: ['Vex', 'Rook', 'Kade', 'Moss', 'Ivo', 'Sable'],
  def: ['Hale', 'Juno', 'Brask', 'Orin', 'Tamsin', 'Pike'],
};
