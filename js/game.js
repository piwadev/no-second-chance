// Core simulation: actors, hit zones, damage + injuries, downed/rescue, weapons, grenades, bomb, rounds and economy.
import * as THREE from './vendor/three.module.js';
import { MATCH, WEAPONS, ZONE_MULT, EQUIPMENT, MOVE, BOT_NAMES, TEAM_NAME } from './config.js';
import { SITES, SPAWNS, areaName } from './map.js';
import { buildCharacter, poseCharacter, NADE_MESH, buildBombModel } from './models.js';
import { audio } from './audio.js';
import { Brain } from './bots.js';

const UP = new THREE.Vector3(0, 1, 0); const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const DEG = Math.PI / 180;
export const forwardOf = (yaw, pitch = 0, out = new THREE.Vector3()) => out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

// Hit zones in model-local space (x right, y up, z forward), standing pose.
const ZONES = [
  ['head', [-0.13, 1.5, -0.14], [0.13, 1.8, 0.15]],
  ['chest', [-0.25, 0.93, -0.17], [0.25, 1.5, 0.18]],
  ['larm', [-0.38, 0.98, -0.12], [-0.25, 1.5, 0.5]],
  ['rarm', [0.25, 0.98, -0.12], [0.38, 1.5, 0.5]],
  ['lleg', [-0.22, 0, -0.13], [0, 0.93, 0.13]],
  ['rleg', [0, 0, -0.13], [0.22, 0.93, 0.13]],
];
const ZONES_DOWNED = [['head', [-0.14, 0.02, 0.55], [0.14, 0.34, 0.88]], ['chest', [-0.3, 0, -0.95], [0.3, 0.34, 0.55]]];

function slab(o, d, mn, mx, maxT) {
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z, da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    if (Math.abs(da) < 1e-9) { if (oa < mn[a] || oa > mx[a]) return -1; continue; }
    let ta = (mn[a] - oa) / da, tb = (mx[a] - oa) / da; if (ta > tb) { const q = ta; ta = tb; tb = q; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return -1;
  }
  return t0;
}

export class WeaponInst {
  constructor(id) { this.def = WEAPONS[id]; this.id = id; this.mag = this.def.mag; this.reserve = Array(this.def.mags).fill(this.def.mag); }
  get reserveRounds() { return this.reserve.reduce((a, b) => a + b, 0); }
}

let ACTOR_ID = 0;
export class Actor {
  constructor(game, squad, name, isPlayer) {
    this.game = game; this.id = ++ACTOR_ID; this.squad = squad; this.name = name; this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.crouch = 0; this.onGround = true;
    this.money = MATCH.START_MONEY; this.stats = { k: 0, d: 0, a: 0, rescues: 0, dmg: 0, hs: 0, downs: 0 };
    this.primary = null; this.secondary = new WeaponInst('pistol'); this.armor = 0; this.helmet = false;
    this.nades = { frag: 0, smoke: 0, flash: 0 }; this.medkit = 0; this.bandage = 0; this.tourniquet = 0; this.state = 'dead';
    this.brain = isPlayer ? null : new Brain(game, this);
  }
  get team() { return this.game.sideOf(this.squad); }
  get alive() { return this.state === 'alive'; }
  get weapon() { return this.slot === 1 ? this.primary : this.slot === 2 ? this.secondary : null; }
  get eyeHeight() { return this.state === 'downed' ? MOVE.eyeDowned : MOVE.eye - (MOVE.eye - MOVE.eyeCrouch) * this.crouch; }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z); }
  chestPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + (this.state === 'downed' ? 0.2 : 1.2 - 0.35 * this.crouch), this.pos.z); }
  headPos(out = new THREE.Vector3()) { if (this.state === 'downed') { const f = forwardOf(this.yaw, 0, tmpV2); return out.set(this.pos.x - f.x * 0.7, this.pos.y + 0.2, this.pos.z - f.z * 0.7); } return out.set(this.pos.x, this.pos.y + 1.64 - 0.46 * this.crouch, this.pos.z); }
  get legHurt() { return this.inj.lleg || this.inj.rleg; }
  get armHurt() { return this.inj.larm || this.inj.rarm; }
  get condition() { if (this.state === 'dead') return 'Eliminated'; if (this.state === 'downed') return 'Downed'; if (this.hp < 35) return 'Critical'; if (this.hp < 70 || this.bleed || this.legHurt || this.armHurt) return 'Wounded'; return 'Healthy'; }
  get bleedRate() { return this.bleed === 2 ? 2.6 : this.bleed === 1 ? 1.0 : 0; }

  spawn(x, z, yaw, keepGear) {
    if (!keepGear) { this.primary = null; this.secondary = new WeaponInst('pistol'); this.armor = 0; this.helmet = false; this.nades = { frag: 0, smoke: 0, flash: 0 }; this.medkit = 0; this.bandage = 0; this.tourniquet = 0; }
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.crouch = 0; this.crouchWanted = false; this.onGround = true;
    this.state = 'alive'; this.hp = 100; this.bleed = 0; this.bleedLimb = null; this.inj = { head: 0, chest: 0, larm: 0, rarm: 0, lleg: 0, rleg: 0 }; this.tq = false;
    this.revived = false; this.bleedout = 0; this.downedHP = 0; this.downedBy = null; this.lastAttacker = null; this.damagedBy = new Map();
    this.slot = this.primary ? 1 : 2; this.prevSlot = 2; this.nadeKind = null; this.fireCd = 0; this.reloadT = 0; this.drawT = 0.3; this.shotIdx = 0; this.lastShot = -10;
    this.action = null; this.actionT = 0; this.dragging = null; this.draggedBy = null; this.reviving = null; this.reviveT = 0; this.revivedBy = null;
    this.plantT = 0; this.defuseT = 0; this.hasBomb = false; this.blind = 0; this.blindMax = 1; this.sprinting = false; this.stepT = 0; this.ping = 0; this.speed = 0;
    this.round = { k: 0, rescues: 0, dmg: 0, earned: 0 }; this.punch = { x: 0, y: 0 }; this.flinch = 0; this.dmgDirs = [];
    if (this.brain) this.brain.reset();
    if (!this.mesh) { this.mesh = buildCharacter(this.team); this.game.scene.add(this.mesh); }
    this.mesh.visible = !this.isPlayer;
  }
  rebuildMesh() { if (this.mesh) this.game.scene.remove(this.mesh); this.mesh = buildCharacter(this.team); this.game.scene.add(this.mesh); this.mesh.visible = !this.isPlayer; }

  canAct() { return this.state === 'alive' && !this.action && !this.dragging && !this.reviving && this.plantT <= 0 && this.defuseT <= 0; }
  switchTo(slot, kind) {
    if (this.state !== 'alive' || this.action) return false;
    if (slot === 1 && !this.primary) return false; if (slot === 3) { const k = kind || this.nextNade(); if (!k) return false; this.nadeKind = k; }
    if (this.slot === slot && slot !== 3) return false; if (this.slot !== 3) this.prevSlot = this.slot;
    this.slot = slot; this.reloadT = 0; const w = this.weapon; this.drawT = w ? w.def.draw * 0.6 : 0.35; this.shotIdx = 0; if (this.isPlayer) audio.click(); return true;
  }
  nextNade(after) { const order = ['frag', 'smoke', 'flash']; let i = after ? order.indexOf(after) : -1; for (let k = 1; k <= 3; k++) { const n = order[(i + k) % 3]; if (this.nades[n] > 0) return n; } return null; }
  startReload() {
    const w = this.weapon; if (!w || this.reloadT > 0 || this.drawT > 0 || !w.reserve.length || w.mag >= w.def.mag) return false;
    const best = Math.max(...w.reserve); if (best <= w.mag) return false; // nothing better to load
    this.reloadT = w.mag === 0 ? w.def.emptyReload : w.def.reload; if (this.armHurt) this.reloadT *= 1.2; this.reloadEmpty = w.mag === 0; audio.reload(this.pos, this.isPlayer); return true;
  }
  finishReload() {
    // Magazine memory: the partial magazine goes back into the pouch, the fullest one goes in.
    const w = this.weapon; if (!w) return; let bi = 0; for (let i = 1; i < w.reserve.length; i++) if (w.reserve[i] > w.reserve[bi]) bi = i;
    const next = w.reserve.splice(bi, 1)[0]; if (w.mag > 0) w.reserve.push(w.mag); w.reserve.sort((a, b) => b - a); w.mag = next;
  }
  startAction(kind) {
    if (this.state !== 'alive' || this.action || this.reviving || this.dragging) return false;
    if (kind === 'bandage') { if (this.bandage <= 0) return this.say('No bandage'); if (this.bleed === 0) return this.say('Not bleeding'); if (this.bleed === 2) return this.say('Heavy bleeding — use a tourniquet [V]'); }
    if (kind === 'tourniquet') { if (this.tourniquet <= 0) return this.say('No tourniquet'); if (this.bleed !== 2) return this.say(this.bleed ? 'Light bleeding — a bandage is enough [X]' : 'Not bleeding'); }
    if (kind === 'medkit') { if (this.medkit <= 0) return this.say('No medical kit'); if (this.hp >= 100 && !this.bleed) return this.say('Already at full health'); }
    this.action = kind; this.actionT = { bandage: 2.5, tourniquet: 2.0, medkit: 4.0 }[kind]; this.reloadT = 0; return true;
  }
  finishAction() {
    const k = this.action; this.action = null;
    if (k === 'bandage') { this.bandage--; this.bleed = 0; this.say('Bleeding stopped'); }
    if (k === 'tourniquet') { this.tourniquet--; this.bleed = 0; this.tq = true; this.say('Tourniquet applied'); }
    if (k === 'medkit') { this.medkit--; this.hp = Math.min(100, this.hp + 45); this.bleed = 0; this.say('+45 HP, bleeding stopped'); }
  }
  say(msg) { if (this.isPlayer) this.game.hud.toast(msg); return false; }
}

export class Game {
  constructor(scene, map, fx, hud, settings) {
    this.scene = scene; this.map = map; this.fx = fx; this.hud = hud; this.settings = settings; this.actors = []; this.projectiles = []; this.sounds = []; this.time = 0;
    this.bombMesh = buildBombModel(); this.bombMesh.scale.setScalar(1.6); this.bombMesh.visible = false; scene.add(this.bombMesh);
    this.pingMesh = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.6, 24), new THREE.MeshBasicMaterial({ color: 0xd5a64a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false })); this.pingMesh.rotation.x = -Math.PI / 2; this.pingMesh.visible = false; this.pingMesh.renderOrder = 9; scene.add(this.pingMesh);
  }
  // ------------------------------------------------------------------ match lifecycle
  newMatch(playerSide) {
    for (const a of this.actors) if (a.mesh) this.scene.remove(a.mesh);
    this.actors = []; this.startSide = playerSide; this.half = 0; this.score = [0, 0]; this.roundNo = 0; this.lossStreak = [0, 0]; this.feed = []; this.over = false; this.history = [];
    const myNames = BOT_NAMES[playerSide].slice(0, 4), enemyNames = BOT_NAMES[playerSide === 'atk' ? 'def' : 'atk'].slice(0, 5);
    this.player = new Actor(this, 0, 'You', true); this.actors.push(this.player);
    for (const n of myNames) this.actors.push(new Actor(this, 0, n, false));
    for (const n of enemyNames) this.actors.push(new Actor(this, 1, n, false));
    this.startRound();
  }
  sideOf(squad) { const s0 = this.half === 0 ? this.startSide : (this.startSide === 'atk' ? 'def' : 'atk'); return squad === 0 ? s0 : (s0 === 'atk' ? 'def' : 'atk'); }
  squadOf(side) { return this.sideOf(0) === side ? 0 : 1; }
  teamActors(side) { return this.actors.filter(a => a.team === side); }
  aliveCount(side) { return this.actors.reduce((n, a) => n + (a.team === side && a.state === 'alive' ? 1 : 0), 0); }

  startRound() {
    this.roundNo++; this.phase = 'buy'; this.timer = MATCH.BUY_TIME; this.result = null; this.projectiles.forEach(p => this.scene.remove(p.mesh)); this.projectiles = [];
    this.fx.clearRound(); this.bomb = { state: 'carried', carrier: null, pos: new THREE.Vector3(), timer: 0, site: null, beepT: 0 }; this.bombMesh.visible = false;
    this.alert = { A: 0, B: 0 }; this.sounds = []; this.killer = null;
    const sp = { atk: SPAWNS.atk.slice(), def: SPAWNS.def.slice() };
    for (const a of this.actors) {
      const keep = a.state === 'alive' && this.roundNo > 1 && !a.halfReset; a.halfReset = false;
      const s = sp[a.team].shift(); const yaw = a.team === 'atk' ? 0 : Math.PI; a.spawn(s[0] + (Math.random() - 0.5) * 0.6, s[1], yaw, keep);
    }
    const atks = this.teamActors('atk'); const carrier = atks[Math.floor(Math.random() * atks.length)]; carrier.hasBomb = true; this.bomb.carrier = carrier;
    if (carrier.isPlayer) this.hud.toast('You are carrying the explosive. Plant it at A or B (hold E).', 4);
    // bot buys + team strategy
    this.strategy = { site: Math.random() < 0.5 ? 'A' : 'B', split: Math.random() < 0.35 };
    for (const a of this.actors) if (a.brain) a.brain.buy();
    for (const a of this.actors) if (a.brain) a.brain.planRound();
    this.map.barrierMesh.visible = true; this.hud.roundStart(this);
  }
  skipPhase() { if (this.phase === 'buy' || this.phase === 'prep') this.timer = Math.min(this.timer, this.phase === 'buy' ? 1.5 : 1); }

  // ------------------------------------------------------------------ main step
  update(dt) {
    this.time += dt; this.timer -= dt;
    if (this.phase === 'buy' && this.timer <= 0) { this.phase = 'prep'; this.timer = MATCH.PREP_TIME; this.hud.center('PREPARATION', 'Defenders: take your positions', 2); }
    else if (this.phase === 'prep' && this.timer <= 0) { this.phase = 'live'; this.timer = MATCH.ROUND_TIME; this.map.barrierMesh.visible = false; audio.roundStart(); this.hud.center('GO', this.player.team === 'atk' ? 'Push a site and plant the explosive' : 'Hold the sites. Stop the plant.', 1.6); }
    else if (this.phase === 'live' && this.timer <= 0 && this.bomb.state !== 'planted') this.endRound('def', 'Time expired — explosive not planted');
    else if (this.phase === 'post' && this.timer <= 0) this.nextRound();

    for (const a of this.actors) this.updateActor(a, dt);
    for (const a of this.actors) if (a.brain && a.state !== 'dead') a.brain.update(dt);
    this.updateProjectiles(dt); this.updateBomb(dt);
    if (this.phase === 'live') this.checkWin();
    this.sounds = this.sounds.filter(s => this.time - s.t < 0.6);
    if (this.pingT > 0) { this.pingT -= dt; this.pingMesh.visible = this.pingT > 0; this.pingMesh.scale.setScalar(1 + Math.sin(this.time * 8) * 0.15); }
  }
  frozen(a) { return this.phase === 'buy' || (this.phase === 'prep' && a.team === 'atk' && false); }

  // movement shared by player and bots. wish = {x,z} world dir (unit or 0), speed target
  move(a, wishX, wishZ, wishSpeed, jump, dt) {
    const onG = a.onGround; const v = a.vel;
    if (this.phase === 'buy') { wishSpeed = 0; jump = false; }
    if (onG) {
      const sp = Math.hypot(v.x, v.z); if (sp > 0) { const drop = Math.max(sp, 1.2) * MOVE.friction * dt; const ns = Math.max(0, sp - drop) / sp; v.x *= ns; v.z *= ns; }
      const cur = v.x * wishX + v.z * wishZ, add = wishSpeed - cur; if (add > 0) { const acc = Math.min(add, MOVE.accel * wishSpeed * dt * 0.25); v.x += acc * wishX; v.z += acc * wishZ; }
      if (jump && a.state === 'alive' && a.crouch < 0.5) { v.y = MOVE.jump * (a.legHurt ? 0.7 : 1); a.onGround = false; }
    } else { const cur = v.x * wishX + v.z * wishZ, add = Math.min(wishSpeed, 1.2) - cur; if (add > 0) { const acc = Math.min(add, MOVE.air * dt); v.x += acc * wishX; v.z += acc * wishZ; } }
    v.y -= MOVE.gravity * dt;
    a.pos.x += v.x * dt; a.pos.z += v.z * dt; a.pos.y += v.y * dt;
    const barrier = a.team === 'atk' && (this.phase === 'buy' || this.phase === 'prep');
    const h = a.state === 'downed' ? 0.5 : 1.8 - 0.6 * a.crouch;
    const g = this.map.collide(a.pos, MOVE.radius, h, barrier);
    if (a.pos.y <= g + 0.001) { a.pos.y = g; if (v.y < 0) v.y = 0; a.onGround = true; } else if (a.pos.y > g + 0.05) a.onGround = false;
    if (a.onGround && a.pos.y > g && a.pos.y - g < 0.6) a.pos.y = g;
    a.speed = Math.hypot(v.x, v.z);
  }
  maxSpeed(a, sprint, walk) {
    if (a.state === 'downed') return a.draggedBy ? 0 : MOVE.crawl;
    let s = MOVE.run * (a.weapon ? a.weapon.def.speed : 1);
    if (sprint && !a.legHurt && a.crouch < 0.2 && !a.action && !a.dragging) s = MOVE.sprint;
    if (a.crouch > 0.5) s = MOVE.crouch; if (walk) s *= 0.55;
    if (a.legHurt) s *= MOVE.legSlow; if (a.dragging) s = MOVE.drag; if (a.action) s *= 0.5; if (a.reviving || a.plantT > 0 || a.defuseT > 0) s = 0;
    if (a.hp < 35 && a.state === 'alive') s *= 0.92; return s;
  }

  updateActor(a, dt) {
    if (a.state === 'dead') { if (a.mesh) poseCharacter(a.mesh, dt, { dead: true, helmet: a.helmet, armor: a.armor > 0 }); return; }
    a.crouch += ((a.crouchWanted && a.state === 'alive' ? 1 : 0) - a.crouch) * Math.min(1, dt * 12);
    a.fireCd -= dt; if (a.drawT > 0) a.drawT -= dt; a.blind = Math.max(0, a.blind - dt); a.flinch = Math.max(0, a.flinch - dt * 3);
    if (a.reloadT > 0) { a.reloadT -= dt; if (a.reloadT <= 0) a.finishReload(); }
    if (a.action) { a.actionT -= dt; if (a.actionT <= 0) a.finishAction(); }
    // recoil recovery (spray index decays when not firing)
    const w = a.weapon; if (w && this.time - a.lastShot > w.def.interval * 1.4) a.shotIdx = Math.max(0, a.shotIdx - dt * w.def.recover);
    if (w) { const p = this.patternAt(w.def, a.shotIdx); a.punch.x = p[0] * w.def.punch; a.punch.y = p[1] * w.def.punch; } else { a.punch.x *= 0.8; a.punch.y *= 0.8; }
    if (a.state === 'alive') {
      if (a.bleed && this.phase !== 'post') { a.hp -= a.bleedRate * dt; a.bleedTick = (a.bleedTick || 0) + dt; if (a.bleedTick > 1.2) { a.bleedTick = 0; this.fx.decal(new THREE.Vector3(a.pos.x + (Math.random() - .5) * .4, a.pos.y + 0.01, a.pos.z + (Math.random() - .5) * .4), [0, 1, 0], true); } if (a.hp <= 0) { a.hp = 0; this.goDown(a, a.lastAttacker, null, 'bled'); } }
      if (a.hasBomb && !a.isPlayer && a.slot === 3) a.slot = a.primary ? 1 : 2;
      // footsteps
      if (a.onGround && a.speed > 2.6) { a.stepT -= dt * a.speed; if (a.stepT <= 0) { a.stepT = 1.9; audio.step(a.pos, a.isPlayer, a.crouch > 0.5); if (a.speed > 3.4 && a.crouch < 0.5) this.emitSound(a, a.pos, 14, 'step'); } }
    }
    if (a.state === 'downed') {
      if (this.phase !== 'post') a.bleedout -= dt;
      if (a.draggedBy) { const d = a.draggedBy; if (d.state !== 'alive' || d.dragging !== a) { a.draggedBy = null; } else { const f = forwardOf(d.yaw, 0, tmpV); const tx = d.pos.x - f.x * 0.9, tz = d.pos.z - f.z * 0.9; a.pos.x += (tx - a.pos.x) * Math.min(1, dt * 8); a.pos.z += (tz - a.pos.z) * Math.min(1, dt * 8); this.map.collide(a.pos, 0.25, 0.4, false); a.yaw = Math.atan2(-(d.pos.x - a.pos.x), -(d.pos.z - a.pos.z)) + Math.PI; } }
      if (a.bleedout <= 0) this.eliminate(a, a.downedBy, null, 'bledout');
    }
    // revive progress
    if (a.reviving) { const t = a.reviving; if (a.state !== 'alive' || t.state !== 'downed' || a.pos.distanceTo(t.pos) > 2.2) { this.cancelRevive(a); } else { a.reviveT += dt; if (a.reviveT >= MATCH.REVIVE_TIME) this.completeRevive(a, t); } }
    if (a.dragging && (a.dragging.state !== 'downed' || a.state !== 'alive')) this.stopDrag(a);
    if (a.mesh) {
      a.mesh.position.copy(a.pos); a.mesh.rotation.y = a.yaw + Math.PI;
      poseCharacter(a.mesh, dt, { speed: a.state === 'downed' ? (a.draggedBy ? 0.6 : a.speed) : a.speed, crouch: a.crouch, downed: a.state === 'downed', pitch: a.pitch, helmet: a.helmet, armor: a.armor > 0,
        weapon: a.weapon ? a.weapon.id : 'pistol', noGun: a.slot === 3 || !!a.action, sprint: !!a.sprinting, shotAge: this.time - a.lastShot, reload: a.reloadT > 0, kneel: !!a.reviving || a.plantT > 0 || a.defuseT > 0, dragging: !!a.dragging });
    }
  }

  // ------------------------------------------------------------------ shooting
  patternAt(def, idx) { const p = def.pattern, i = Math.floor(idx), f = idx - i; if (i >= p.length - 1) return p[p.length - 1]; const a = p[i], b = p[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
  inaccuracy(a) {
    const w = a.weapon; if (!w) return 0; const d = w.def; let s = d.spread;
    const moveFrac = Math.min(1, Math.max(0, (a.speed - 0.9) / (MOVE.run * d.speed - 0.9))); s += d.moveSpread * moveFrac;
    if (!a.onGround) s += 0.16; if (a.crouch > 0.5) s *= 0.7; if (a.armHurt) s *= 1.25; if (a.hp < 35) s *= 1.15;
    s += Math.min(a.shotIdx, 12) * 0.0008; return s;
  }
  tryFire(a, aimYaw, aimPitch, comp = 0) {
    const w = a.weapon; if (!w || a.state !== 'alive' || this.phase === 'buy' || this.phase === 'prep') return false;
    if (a.fireCd > 0 || a.reloadT > 0 || a.drawT > 0 || a.action || a.dragging || a.reviving || a.plantT > 0 || a.defuseT > 0 || a.sprinting) return false;
    if (w.mag <= 0) { if (a.isPlayer) audio.empty(); a.fireCd = 0.25; if (!a.startReload() && a.isPlayer) this.hud.toast('Out of ammunition'); return false; }
    w.mag--; a.fireCd = w.def.interval; a.lastShot = this.time;
    const p = this.patternAt(w.def, a.shotIdx), rm = (a.armHurt ? 1.35 : 1) * (1 - comp); a.shotIdx += 1;
    const sway = a.armHurt ? Math.sin(this.time * 1.7) * 0.25 * DEG : 0;
    const yaw = aimYaw - p[0] * DEG * rm + sway, pitch = aimPitch + p[1] * DEG * rm;
    const dir = forwardOf(yaw, pitch); const sp = this.inaccuracy(a);
    // deterministic-feeling cone: uniform disc
    const r = sp * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2; const right = new THREE.Vector3().crossVectors(dir, UP).normalize(), up = new THREE.Vector3().crossVectors(right, dir);
    dir.addScaledVector(right, Math.cos(th) * r).addScaledVector(up, Math.sin(th) * r).normalize();
    const origin = a.eye(); this.shoot(a, origin, dir, w.def);
    audio.gun(w.def.sound, origin, a.isPlayer); this.emitSound(a, origin, 40, 'shot');
    if (w.mag === 0 && w.reserve.length) setTimeout(() => { if (a.weapon === w && a.state === 'alive') a.startReload(); }, 250);
    return true;
  }
  shoot(a, origin, dir, def) {
    const wallHit = this.map.raycast(origin, dir, 200); let maxT = wallHit ? wallHit.t : 200;
    let best = null;
    for (const v of this.actors) {
      if (v === a || v.state === 'dead') continue; if (v.pos.distanceToSquared(origin) > (maxT + 2) ** 2) continue;
      const hit = this.rayActor(origin, dir, v, maxT); if (hit && (!best || hit.t < best.t)) best = hit;
    }
    const end = origin.clone().addScaledVector(dir, best ? best.t : maxT);
    const muzzle = a.isPlayer ? this.viewMuzzle || origin.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.12, 0)) : a.chestPos().addScaledVector(forwardOf(a.yaw, a.pitch), 0.7).add(new THREE.Vector3(0, 0.15, 0));
    if (Math.random() < (a.isPlayer ? 0.55 : 0.8)) this.fx.tracer(muzzle, end); this.fx.muzzle(muzzle);
    if (best) {
      const v = best.actor; this.fx.blood(end, dir); audio.impact(end, true);
      if (Math.random() < 0.4) { const back = this.map.raycast(end, dir, 2.2); if (back) this.fx.decal(end.clone().addScaledVector(dir, back.t), back.n, true); }
      const dist = best.t; const fall = Math.pow(0.985, dist / 10); this.damage(v, a, def.dmg * fall, best.zone, def);
    } else if (wallHit) { this.fx.decal(end, wallHit.n); this.fx.sparks(end, wallHit.n); if (Math.random() < 0.5) audio.impact(end, false); }
  }
  rayActor(o, d, v, maxT) {
    const rot = -(v.yaw + Math.PI); const lo = tmpV.set(o.x - v.pos.x, o.y - v.pos.y, o.z - v.pos.z).applyAxisAngle(UP, rot); const ld = tmpV2.copy(d).applyAxisAngle(UP, rot);
    const zones = v.state === 'downed' ? ZONES_DOWNED : ZONES; const k = v.state === 'downed' ? 1 : 1 - 0.3 * v.crouch; let best = null;
    // quick reject with bounding box
    if (v.state !== 'downed' && slab(lo, ld, [-0.45, 0, -0.5], [0.45, 1.85 * k, 0.6], maxT) < 0) return null;
    for (const [zone, mn, mx] of zones) {
      const a = v.state === 'downed' ? mn : [mn[0], mn[1] * k, mn[2]], b = v.state === 'downed' ? mx : [mx[0], mx[1] * k, mx[2]];
      const t = slab(lo, ld, a, b, maxT); if (t >= 0 && (!best || t < best.t)) best = { t, zone, actor: v };
    }
    return best;
  }

  // ------------------------------------------------------------------ damage, injuries, downed
  damage(v, att, base, zone, def, explosive = false) {
    if (v.state === 'dead' || this.phase === 'buy') return;
    const friendly = att && att !== v && att.team === v.team; if (friendly) base *= 0.33; // reduced friendly fire
    let dmg = base * (zone === 'head' ? (def ? def.headMult : 1) : ZONE_MULT[zone] || 1);
    const armored = zone === 'head' ? v.helmet : (zone === 'chest' || zone === 'larm' || zone === 'rarm') && v.armor > 0;
    if (armored) { const pen = explosive ? 0.55 : def ? def.pen : 0.6; const absorbed = dmg * (1 - pen); dmg *= pen; if (zone !== 'head') v.armor = Math.max(0, v.armor - absorbed * 0.8); }
    dmg = Math.round(dmg);
    if (att && att !== v && !friendly) { att.stats.dmg += Math.min(dmg, v.state === 'downed' ? v.downedHP : v.hp); att.round.dmg += dmg; v.damagedBy.set(att, (v.damagedBy.get(att) || 0) + dmg); }
    if (att) v.lastAttacker = att;
    const headshot = zone === 'head';
    if (att && att.isPlayer && att !== v) { this.hud.hitmarker(headshot, v.state === 'downed'); audio.hitmarker(headshot); }
    if (v.isPlayer) { audio.hurt(); if (att) this.hud.damageFrom(att.pos); v.flinch = 1; }
    v.punch.y += 0.6; if (v.brain) v.brain.onDamaged(att);
    if (v.state === 'downed') { v.downedHP -= dmg; if (v.downedHP <= 0) this.eliminate(v, att, def, headshot ? 'finished-hs' : 'finished'); return; }
    v.hp -= dmg;
    // injuries + bleeding
    if (!explosive) {
      if (zone !== 'head') { v.inj[zone] = 1; }
      if (zone === 'chest' && Math.random() < 0.45 && !v.bleed) v.bleed = 1;
      if (zone !== 'head' && zone !== 'chest') { const r = Math.random(); if (r < 0.2 && !v.tq) { v.bleed = 2; v.bleedLimb = zone; } else if (r < 0.55 && !v.bleed) v.bleed = 1; }
      if (v.isPlayer && v.hp > 0) { if (zone === 'lleg' || zone === 'rleg') this.hud.toast('Leg hit — sprint disabled, slower movement'); else if (zone === 'larm' || zone === 'rarm') this.hud.toast('Arm hit — more recoil and sway'); }
    } else { v.inj.chest = 1; if (Math.random() < 0.5 && !v.bleed) v.bleed = 1; }
    if (v.hp <= 0) {
      const overkill = -v.hp;
      if (headshot || overkill > MATCH.CATASTROPHIC || v.revived) this.eliminate(v, att, def, headshot ? 'headshot' : v.revived ? 'second' : 'catastrophic');
      else this.goDown(v, att, def, 'shot');
    }
  }
  goDown(v, att, def, how) {
    if (v.state !== 'alive') return; if (v.revived) return this.eliminate(v, att, def, 'second');
    v.state = 'downed'; v.hp = 0; v.bleedout = MATCH.BLEEDOUT; v.downedHP = MATCH.DOWNED_HP; v.downedBy = att || v.lastAttacker; v.crouch = 0; v.crouchWanted = false;
    v.action = null; v.reloadT = 0; this.stopDrag(v); this.cancelRevive(v); v.plantT = 0; v.defuseT = 0; v.vel.set(0, 0, 0);
    if (v.hasBomb) this.dropBomb(v);
    if (v.brain && v.brain.rescue) { if (v.brain.rescue.rescuer === v) v.brain.rescue.rescuer = null; v.brain.rescue = null; }
    if (att && att !== v) att.stats.downs++;
    this.addFeed(att, v, def, 'down'); if (v.isPlayer) this.hud.toast('You are down. Crawl to cover. [F] call for help', 3);
    for (const b of this.actors) if (b.brain) b.brain.onTeammateDown(v);
  }
  eliminate(v, att, def, how) {
    if (v.state === 'dead') return; const wasDowned = v.state === 'downed';
    v.state = 'dead'; v.hp = 0; v.stats.d++; this.stopDrag(v); this.cancelRevive(v); if (v.draggedBy) { v.draggedBy.dragging = null; v.draggedBy = null; } if (v.hasBomb) this.dropBomb(v);
    let killer = att; if ((how === 'bledout' || how === 'roundend') && v.downedBy) killer = v.downedBy;
    if (killer && killer !== v && killer.team !== v.team) {
      killer.stats.k++; killer.round.k++; if (how === 'headshot' || how === 'finished-hs') killer.stats.hs++;
      const rew = def ? def.kill : MATCH.KILL_REWARD; if (how !== 'roundend') { killer.money = Math.min(MATCH.MAX_MONEY, killer.money + rew); killer.round.earned += rew; }
      for (const [x, d] of v.damagedBy) if (x !== killer && x.team !== v.team && d >= 40) x.stats.a++;
      if (wasDowned && v.downedBy && v.downedBy !== killer && v.downedBy.team !== v.team) v.downedBy.stats.a++;
    }
    if (how !== 'roundend') this.addFeed(killer, v, def, how);
    v.primary = null; v.secondary = new WeaponInst('pistol'); v.armor = 0; v.helmet = false; // gear lost
    if (v.isPlayer) { this.killer = killer && killer.team !== v.team ? killer : null; this.hud.onPlayerDeath(killer, how); }
  }
  addFeed(att, v, def, how) { this.hud.feed(att, v, def, how, this); }
  canRevive(r, t) { return r.state === 'alive' && t.state === 'downed' && r.team === t.team && !t.revived; }
  startRevive(r, t) {
    if (!this.canRevive(r, t)) return false; if (r.medkit <= 0) return r.say('You need a medical kit to revive');
    if (t.revivedBy && t.revivedBy !== r) return false; this.stopDrag(r); r.reviving = t; r.reviveT = 0; t.revivedBy = r; r.action = null; r.reloadT = 0; return true;
  }
  cancelRevive(r) { if (r.reviving) { r.reviving.revivedBy = null; r.reviving = null; r.reviveT = 0; } }
  completeRevive(r, t) {
    r.medkit--; this.cancelRevive(r); t.state = 'alive'; t.hp = MATCH.REVIVE_HP; t.bleed = 0; t.revived = true; t.downedBy = null; t.damagedBy = new Map(); t.slot = t.primary ? 1 : 2; t.drawT = 0.8; t.draggedBy = null;
    r.stats.rescues++; r.round.rescues++; r.money = Math.min(MATCH.MAX_MONEY, r.money + MATCH.RESCUE_REWARD); r.round.earned += MATCH.RESCUE_REWARD;
    this.hud.feed(r, t, null, 'rescue', this); if (t.isPlayer) this.hud.toast(`${r.name} revived you — ${MATCH.REVIVE_HP} HP. No second chance: the next lethal hit eliminates you.`, 4);
    if (r.isPlayer) this.hud.toast(`${t.name} is back up (+$${MATCH.RESCUE_REWARD})`);
  }
  startDrag(r, t) { if (r.state !== 'alive' || t.state !== 'downed' || t.team !== r.team || t.draggedBy) return false; this.cancelRevive(r); r.dragging = t; t.draggedBy = r; r.reloadT = 0; r.action = null; return true; }
  stopDrag(r) { if (r.dragging) { r.dragging.draggedBy = null; r.dragging = null; } }

  // ------------------------------------------------------------------ grenades
  throwNade(a, kind, strong = true) {
    if (a.nades[kind] <= 0 || a.state !== 'alive' || this.phase === 'buy' || this.phase === 'prep') return false; a.nades[kind]--;
    const dir = forwardOf(a.yaw, a.pitch + (strong ? 0.12 : 0.25)); const sp = strong ? 15 : 7;
    const p = { kind, owner: a, pos: a.eye().addScaledVector(dir, 0.5), vel: dir.multiplyScalar(sp).add(new THREE.Vector3(a.vel.x * 0.5, 0, a.vel.z * 0.5)), t: 0, fuse: kind === 'frag' ? 1.7 : kind === 'smoke' ? 1.6 : 1.4, mesh: NADE_MESH(kind), rest: false };
    this.scene.add(p.mesh); this.projectiles.push(p); audio.tone(400, 0.05, 'triangle', 0.08, a.pos);
    if (a.slot === 3) { const n = a.nextNade(kind) || (a.nades[kind] > 0 ? kind : null); if (n) a.nadeKind = n; else { a.slot = a.primary ? 1 : 2; a.drawT = 0.4; } }
    return true;
  }
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.t += dt;
      const steps = 4; for (let s = 0; s < steps && !p.rest; s++) {
        const h = dt / steps; p.vel.y -= 12 * h; const next = p.pos.clone().addScaledVector(p.vel, h);
        const d = p.vel.clone().normalize(), L = p.vel.length() * h, hit = this.map.raycast(p.pos, d, L + 0.06, true);
        if (hit) { const n = new THREE.Vector3(...hit.n); p.pos.addScaledVector(d, Math.max(0, hit.t - 0.07)); p.vel.reflect(n).multiplyScalar(0.42); if (n.y > 0.5 && p.vel.length() < 1.2) { p.rest = true; p.vel.set(0, 0, 0); } if (p.vel.length() > 2) audio.tone(700 + Math.random() * 300, 0.03, 'square', 0.05, p.pos); }
        else p.pos.copy(next);
      }
      p.mesh.position.copy(p.pos); p.mesh.rotation.x += dt * 8;
      if (p.t >= p.fuse) { this.detonate(p); this.scene.remove(p.mesh); this.projectiles.splice(i, 1); }
    }
  }
  detonate(p) {
    if (p.kind === 'smoke') { this.fx.smoke(p.pos, 15); audio.hiss(p.pos); return; }
    if (p.kind === 'frag') {
      this.fx.explosion(p.pos); audio.explosion(p.pos, false); const R = 7;
      for (const v of this.actors) { if (v.state === 'dead') continue; const c = v.chestPos(); const d = c.distanceTo(p.pos); if (d > R) continue; const o = p.pos.clone(); o.y += 0.25; if (!this.map.segmentClear(o, c)) continue; const dmg = 115 * Math.pow(1 - d / R, 1.4); if (dmg > 2) this.damage(v, p.owner, dmg, 'chest', null, true); }
      if (this.player.state !== 'dead') { const d = this.player.pos.distanceTo(p.pos); if (d < 16) this.hud.shake(1 - d / 16); }
      return;
    }
    if (p.kind === 'flash') {
      this.fx.explosion(p.pos); audio.tone(2600, 0.25, 'sawtooth', 0.4, p.pos);
      for (const v of this.actors) { if (v.state !== 'alive') continue; const e = v.eye(); const d = e.distanceTo(p.pos); if (d > 30) continue; if (!this.map.segmentClear(p.pos, e)) continue;
        const toF = p.pos.clone().sub(e).normalize(), f = forwardOf(v.yaw, v.pitch), dot = toF.dot(f); const amt = (dot > 0.5 ? 3.2 : dot > 0 ? 1.6 : 0.5) * Math.max(0.3, 1 - d / 30);
        v.blind = Math.max(v.blind, amt); v.blindMax = Math.max(v.blind, 0.01); if (v.isPlayer) { this.hud.flash(amt); if (amt > 1) audio.flashRing(); } }
    }
  }

  // ------------------------------------------------------------------ bomb
  siteAt(x, z) { for (const s of Object.values(SITES)) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s.name; return null; }
  dropBomb(a) { a.hasBomb = false; a.plantT = 0; this.bomb.state = 'dropped'; this.bomb.carrier = null; this.bomb.pos.set(a.pos.x, 0.08, a.pos.z); this.bombMesh.visible = true; this.bombMesh.position.copy(this.bomb.pos); if (a.isPlayer) this.hud.toast('Explosive dropped'); }
  updateBomb(dt) {
    const b = this.bomb;
    if (b.state === 'dropped') {
      this.bombMesh.rotation.y += dt;
      for (const a of this.actors) if (a.team === 'atk' && a.state === 'alive' && a.pos.distanceTo(b.pos) < 1.2) { a.hasBomb = true; b.state = 'carried'; b.carrier = a; this.bombMesh.visible = false; if (a.isPlayer) this.hud.toast('You picked up the explosive'); break; }
    }
    if (b.state === 'carried' && b.carrier) {
      const a = b.carrier;
      if (a.plantT > 0) { if (a.state !== 'alive' || !this.siteAt(a.pos.x, a.pos.z) || this.phase !== 'live') a.plantT = 0; else { a.plantT += dt; if (a.plantT >= MATCH.PLANT_TIME) this.plant(a); } }
    }
    if (b.state === 'planted') {
      b.timer -= dt; b.beepT -= dt; const iv = b.timer > 20 ? 1 : b.timer > 10 ? 0.5 : b.timer > 5 ? 0.25 : 0.12; if (b.beepT <= 0) { b.beepT = iv; audio.beep(b.pos); }
      this.bombMesh.userData.led.material.color.setHex(b.beepT > iv * 0.6 ? 0xff2020 : 0x330000);
      for (const a of this.actors) if (a.defuseT > 0) { if (a.state !== 'alive' || a.pos.distanceTo(b.pos) > 1.8) a.defuseT = 0; else { a.defuseT += dt; if (a.defuseT >= MATCH.DEFUSE_TIME) { this.defuse(a); break; } } }
      if (b.timer <= 0 && b.state === 'planted') this.explode();
    }
  }
  startPlant(a) { if (this.phase !== 'live' || !a.hasBomb || a.state !== 'alive' || !this.siteAt(a.pos.x, a.pos.z) || !a.onGround) return false; if (a.plantT <= 0) { a.plantT = 0.0001; a.reloadT = 0; this.emitSound(a, a.pos, 12, 'plant'); } return true; }
  plant(a) {
    const b = this.bomb; a.plantT = 0; a.hasBomb = false; b.state = 'planted'; b.carrier = null; b.timer = MATCH.BOMB_TIMER; b.site = this.siteAt(a.pos.x, a.pos.z); b.pos.set(a.pos.x, 0.08, a.pos.z); b.planter = a;
    this.bombMesh.visible = true; this.bombMesh.position.copy(b.pos); this.bombMesh.rotation.y = a.yaw;
    for (const x of this.teamActors('atk')) { x.money = Math.min(MATCH.MAX_MONEY, x.money + MATCH.PLANT_BONUS); x.round.earned += MATCH.PLANT_BONUS; }
    this.hud.center('EXPLOSIVE PLANTED', `Site ${b.site} · ${MATCH.BOMB_TIMER}s`, 2.4); audio.tone(880, 0.3, 'square', 0.3); this.hud.feed(a, null, null, 'plant', this);
    for (const x of this.actors) if (x.brain) x.brain.onPlanted();
  }
  startDefuse(a) { const b = this.bomb; if (b.state !== 'planted' || a.team !== 'def' || a.state !== 'alive' || a.pos.distanceTo(b.pos) > 1.8) return false; if (a.defuseT <= 0) { a.defuseT = 0.0001; this.emitSound(a, a.pos, 14, 'defuse'); audio.tone(600, 0.08, 'square', 0.2, b.pos); } return true; }
  defuse(a) { this.bomb.state = 'defused'; a.defuseT = 0; a.money = Math.min(MATCH.MAX_MONEY, a.money + MATCH.DEFUSE_BONUS); a.round.earned += MATCH.DEFUSE_BONUS; this.hud.feed(a, null, null, 'defuse', this); this.endRound('def', `${a.name === 'You' ? 'You' : a.name} defused the explosive`); }
  explode() {
    const b = this.bomb; b.state = 'exploded'; this.bombMesh.visible = false; this.fx.explosion(b.pos); this.fx.explosion(b.pos.clone().add(new THREE.Vector3(0, 1.5, 0))); audio.explosion(b.pos, true); this.hud.shake(1.5);
    for (const v of this.actors) { if (v.state === 'dead') continue; const d = v.pos.distanceTo(b.pos); if (d < 14) { v.revived = true; this.damage(v, b.planter, 600 * (1 - d / 14) + 40, 'chest', null, true); } }
    this.endRound('atk', 'Explosive detonated');
  }

  // ------------------------------------------------------------------ win conditions + economy
  checkWin() {
    if (this.result) return; const atk = this.aliveCount('atk'), def = this.aliveCount('def'), planted = this.bomb.state === 'planted';
    if (def === 0 && (atk > 0 || planted)) return this.endRound('atk', 'Defenders eliminated');
    if (atk === 0 && !planted) return this.endRound('def', 'Attackers eliminated');
  }
  endRound(winSide, reason) {
    if (this.result || this.phase === 'post') return;
    this.phase = 'post'; this.timer = MATCH.END_TIME; this.result = { winSide, reason, winSquad: this.squadOf(winSide) };
    for (const a of this.actors) { this.cancelRevive(a); this.stopDrag(a); a.plantT = 0; a.defuseT = 0; a.action = null; }
    for (const a of this.actors) if (a.state === 'downed') this.eliminate(a, a.downedBy, null, 'roundend');
    const ws = this.result.winSquad, ls = 1 - ws; this.score[ws]++; this.lossStreak[ws] = 0; this.lossStreak[ls]++;
    const lossRew = Math.min(MATCH.LOSS_MAX, MATCH.LOSS_BASE + MATCH.LOSS_STEP * (this.lossStreak[ls] - 1));
    for (const a of this.actors) { const r = a.squad === ws ? MATCH.WIN_REWARD : lossRew; a.money = Math.min(MATCH.MAX_MONEY, a.money + r); a.round.earned += r; a.round.income = r; }
    this.history.push({ round: this.roundNo, ws, reason, side: winSide });
    audio.roundEnd(ws === 0); this.hud.roundSummary(this);
    if (this.score[0] >= MATCH.ROUNDS_TO_WIN || this.score[1] >= MATCH.ROUNDS_TO_WIN) { this.over = true; this.timer = MATCH.END_TIME; }
  }
  nextRound() {
    if (this.over) { this.phase = 'over'; this.hud.matchOver(this); return; }
    if (this.roundNo === MATCH.HALF_ROUNDS) {
      this.half = 1; this.lossStreak = [0, 0];
      for (const a of this.actors) { a.money = MATCH.START_MONEY; a.state = 'dead'; a.halfReset = true; a.rebuildMesh(); }
      this.hud.center('HALF-TIME', `Sides switched — you are now ${TEAM_NAME[this.player.team]}`, 3);
    }
    this.startRound();
  }
  emitSound(src, pos, radius, kind) { this.sounds.push({ src, pos: pos.clone(), radius, kind, t: this.time, team: src.team }); }
  ping(a) { const s = a.state === 'downed' ? a.pos : a.eye(); this.pingMesh.position.set(s.x, 0.05, s.z); if (a.state !== 'downed') { const d = forwardOf(a.yaw, a.pitch); const h = this.map.raycast(a.eye(), d, 60); if (h) { const p = a.eye().addScaledVector(d, h.t); this.pingMesh.position.set(p.x, Math.max(0.05, p.y + 0.05), p.z); } } this.pingT = 4; audio.tone(1200, 0.12, 'sine', 0.2); this.hud.toast(a.state === 'downed' ? 'Called for help' : 'Location pinged'); for (const b of this.actors) if (b.brain && b.team === a.team) b.brain.onPing(a, this.pingMesh.position); }
  area(a) { return areaName(a.pos.x, a.pos.z); }

  // buying (also used by bots)
  buy(a, item) {
    if (this.phase !== 'buy' && this.phase !== 'prep') return { ok: false, msg: 'Buy phase is over' };
    const W = WEAPONS[item]; let price;
    if (W) {
      price = W.price; const slotW = W.slot === 1 ? a.primary : a.secondary; if (slotW && slotW.id === item) return { ok: false, msg: 'Already equipped' };
      if (a.money < price) return { ok: false, msg: 'Not enough money' }; a.money -= price; if (W.slot === 1) { a.primary = new WeaponInst(item); a.slot = 1; } else { a.secondary = new WeaponInst(item); if (a.slot === 2 || !a.primary) a.slot = 2; } a.drawT = 0.3;
    } else {
      const E = EQUIPMENT[item]; price = E.price; if (a.money < price) return { ok: false, msg: 'Not enough money' };
      if (item === 'armor') { if (a.armor >= 100) return { ok: false, msg: 'Armor is full' }; a.armor = 100; }
      else if (item === 'helmet') { if (a.helmet) return { ok: false, msg: 'Already have a helmet' }; a.helmet = true; }
      else if (item === 'resupply') { const ws = [a.primary, a.secondary].filter(Boolean); if (ws.every(w => w.mag === w.def.mag && w.reserve.length === w.def.mags && w.reserve.every(m => m === w.def.mag))) return { ok: false, msg: 'Magazines are full' }; for (const w of ws) { w.mag = w.def.mag; w.reserve = Array(w.def.mags).fill(w.def.mag); } }
      else if (['smoke', 'flash', 'frag'].includes(item)) { if (a.nades[item] >= E.max) return { ok: false, msg: 'Carrying the maximum' }; a.nades[item]++; }
      else { if (a[item] >= E.max) return { ok: false, msg: 'Carrying the maximum' }; a[item]++; }
      a.money -= price;
    }
    return { ok: true };
  }
}
