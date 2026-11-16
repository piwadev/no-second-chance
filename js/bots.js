// Bot AI: navigation on the nav grid, perception (FOV + line of sight + smoke + flash), reaction delay,
// imperfect aim with tracking error, bursts/taps, cover, objective play, rotation, rescues and self-treatment.
import * as THREE from './vendor/three.module.js';
import { HOLDS, ROUTES, SITES } from './map.js';
import { MATCH, MOVE } from './config.js';

const DIFF = {
  easy: { react: [0.5, 0.8], err: 1.6, head: 0.08, turn: 4.5, comp: 0.35 },
  normal: { react: [0.3, 0.5], err: 1.0, head: 0.18, turn: 7, comp: 0.55 },
  hard: { react: [0.18, 0.3], err: 0.62, head: 0.32, turn: 11, comp: 0.75 },
};
const ROTATE = { A: [[-8.5, -31], [-8, -25.5], [-15.5, -29.5]], B: [[8.5, -31], [8, -25.5], [15.5, -29.5]] }; // safe spots covering the CT door
const ENTRIES = { A: [[-40.5, -12], [-19.3, -12], [-12, -29.2]], B: [[40.5, -12], [19.3, -12], [12, -29.2]], mid: [[0, -12]] };
const rand = (a, b) => a + Math.random() * (b - a);
const fwd = (yaw, pitch = 0, o = new THREE.Vector3()) => o.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const tv = new THREE.Vector3(), tv2 = new THREE.Vector3();

export class Brain {
  constructor(game, a) { this.g = game; this.a = a; this.reset(); }
  get d() { return DIFF[this.g.settings.difficulty] || DIFF.normal; }
  reset() {
    this.path = null; this.goal = null; this.repathT = 0; this.target = null; this.perceiveT = Math.random() * 0.2; this.visible = [];
    this.lastSeen = null; this.lastSeenT = -99; this.heard = null; this.heardT = -99; this.look = null; this.stuckT = 0; this.mode = 'objective';
    this.rescue = null; this.rescueKind = null; this.dragDest = null; this.aimYaw = this.a.yaw; this.aimPitch = 0; this.burst = 0; this.burstCd = 0; this.react = 0; this.trackT = 0;
    this.err = new THREE.Vector3(); this.errT = 0; this.cover = null; this.coverT = 0; this.strafeT = 0; this.strafeDir = 1; this.holdCrouch = Math.random() < 0.4; this.stage = 0; this.via = []; this.scanT = 0; this.wantHead = false;
    this.medT = 0; this.lastEnemyT = -99; this.damagedT = -99; this.siteSpot = null; this.flashed = false; this.nadeCd = 0; this.seekRoll = new Map(); this.finishRoll = new Map(); this.finishWait = 0; this.plantOff = 0; this.postSpot = null; this.draggedOnce = false; this.dragDest = null; this.holdSpot = null; this.rotated = false;
  }
  // ---------------------------------------------------------------- economy
  buy() {
    const a = this.a, g = this.g, side = a.team, streak = g.lossStreak[a.squad] || 0; const B = it => g.buy(a, it).ok;
    const mates = g.actors.filter(x => x.squad === a.squad && x.brain); const medic = mates.indexOf(a) % 2 === 0; // two medics per bot squad
    if (medic && !a.medkit && a.money >= 700 && (a.primary || a.money < 3350 || a.money >= 4400)) B('medkit');
    const rifle = side === 'atk' ? (Math.random() < 0.85 ? 'ak' : 'm4') : (Math.random() < 0.85 ? 'm4' : 'ak');
    const full = (a.primary ? 0 : (rifle === 'ak' ? 2700 : 3100)) + (a.armor < 100 ? 650 : 0);
    if (a.money >= full || a.primary) {
      if (!a.primary) B(rifle); if (a.armor < 50) B('armor'); if (!a.helmet && a.money >= 350) B('helmet');
      if (a.primary && a.primary.reserve.length < 2 && a.money >= 200) B('resupply');
      if (a.money >= 900 && Math.random() < 0.6) B('medkit'); if (a.money >= 150) B('bandage');
      if (a.money >= 300 && Math.random() < 0.55) B('smoke'); if (a.money >= 350 && Math.random() < 0.5) B('frag'); if (a.money >= 200 && Math.random() < 0.5) B('flash');
      if (a.money >= 250 && Math.random() < 0.4) B('tourniquet');
    } else if (streak >= 2 && a.money >= 1500) { // force buy
      B('heavy'); B('armor'); if (a.money >= 350) B('frag'); if (a.money >= 150) B('bandage');
    } else if (g.roundNo === 1 || g.roundNo === MATCH.HALF_ROUNDS + 1) { // pistol round
      const r = Math.random(); if (r < 0.45) B('armor'); else if (r < 0.75) { B('heavy'); } else { B('flash'); B('bandage'); B('smoke'); }
    } else { if (a.money >= 2300 && Math.random() < 0.3) B('armor'); if (a.money >= 1900) B('bandage'); }
  }
  // ---------------------------------------------------------------- round plan
  planRound() {
    const g = this.g, a = this.a, team = g.teamActors(a.team).filter(x => x.brain); const idx = team.indexOf(a);
    if (a.team === 'atk') {
      const site = g.strategy.site; this.site = site; const routes = ROUTES[site];
      let r = g.strategy.split ? (idx < 2 ? 2 : idx % 2) : (idx % 3 === 2 ? 1 : 0); if (a.hasBomb) r = g.strategy.split ? 0 : r;
      this.via = routes[r].map(p => [p[0] + rand(-1.2, 1.2), p[1] + rand(-1, 1)]); this.stage = 0; this.role = 'push';
    } else {
      const order = ['A', 'A', 'B', 'B', 'mid']; const k = order[(idx + g.roundNo) % 5]; this.site = k === 'mid' ? (Math.random() < 0.5 ? 'A' : 'B') : k; this.role = k === 'mid' ? 'mid' : 'hold';
      const holds = k === 'mid' ? HOLDS.mid : HOLDS[k]; const taken = team.filter(x => x !== a && x.brain.holdSpot).map(x => x.brain.holdSpot);
      this.holdSpot = holds.find(h => !taken.includes(h)) || holds[Math.floor(Math.random() * holds.length)]; this.holdKey = k; this.rotated = false;
    }
  }
  onPlanted() { this.path = null; this.goal = null; this.mode = 'objective'; if (this.a.team === 'atk') { const hs = HOLDS[this.g.bomb.site]; this.postSpot = hs[Math.floor(Math.random() * hs.length)]; } }
  onDamaged(att) { this.damagedT = this.g.time; if (att && att.team !== this.a.team) { this.lastSeen = att.pos.clone(); this.lastSeenT = this.g.time; if (!this.target) this.look = att.eye(); } }
  onTeammateDown(v) {
    const a = this.a; if (v.team !== a.team || v === a || a.state !== 'alive' || this.rescue) return; if (v.rescuer && v.rescuer !== a) return;
    const d = a.pos.distanceTo(v.pos); if (d > 26) return; const chance = a.medkit ? 0.8 : 0.35; if (Math.random() > chance) return;
    // the closest willing bot takes it
    const others = this.g.actors.filter(x => x.brain && x !== a && x.team === a.team && x.state === 'alive' && x.brain.rescue === v); if (others.length) return;
    this.rescue = v; v.rescuer = a; this.rescueKind = a.medkit ? 'revive' : 'drag'; this.path = null;
  }
  throwAt(kind, x, y, z, lob) {
    const g = this.g, a = this.a; if (!a.nades[kind] || a.state !== 'alive') return false; const e = a.eye(); const dx = x - e.x, dz = z - e.z, d = Math.hypot(dx, dz);
    const v = lob ? 7 : 15, gr = 12; const th = 0.5 * Math.asin(Math.min(1, d * gr / (v * v))); a.yaw = yawTo(dx, dz); a.pitch = th - (lob ? 0.25 : 0.12) + (y - e.y) / Math.max(d, 1) * 0.5;
    this.aimYaw = a.yaw; this.aimPitch = a.pitch; return g.throwNade(a, kind, !lob);
  }
  utility(dt) {
    const g = this.g, a = this.a; if (g.phase !== 'live' || !a.canAct()) return false; this.nadeCd = (this.nadeCd || 0) - dt; if (this.nadeCd > 0) return false;
    // frag a recently seen enemy who went behind cover
    if (a.nades.frag && this.lastSeen && g.time - this.lastSeenT > 0.8 && g.time - this.lastSeenT < 4) {
      const d = this.lastSeen.distanceTo(a.pos); if (d > 7 && d < 18 && !this.target) { this.nadeCd = 6; if (Math.random() < 0.6) return this.throwAt('frag', this.lastSeen.x, 0.5, this.lastSeen.z, false); }
    }
    // attackers smoke off the defenders' rotation door when the execute starts
    if (a.team === 'atk' && a.nades.smoke && g.strategy.exec && this.site && !g.strategy['smoked' + this.site]) {
      const sp = this.site === 'A' ? [-15.5, -29] : [15.5, -29]; const d = Math.hypot(sp[0] - a.pos.x, sp[1] - a.pos.z);
      if (d < 18 && d > 6) { g.strategy['smoked' + this.site] = true; this.nadeCd = 3; return this.throwAt('smoke', sp[0], 0.5, sp[1], false); }
    }
    // flash before stepping onto the site
    if (a.team === 'atk' && a.nades.flash && g.strategy.exec && this.site && !this.flashed && !this.target) {
      const S = SITES[this.site]; const d = Math.hypot(S.cx - a.pos.x, S.cz - a.pos.z); if (d < 16 && d > 8) { this.flashed = true; this.nadeCd = 2; return this.throwAt('flash', S.cx, 2.5, S.cz, true); }
    }
    return false;
  }
  seekRescue() { // re-evaluate downed teammates when the area is quiet (rescuers die, fights end)
    const g = this.g, a = this.a; if (this.rescue || a.state !== 'alive' || g.phase !== 'live' || g.time - this.lastEnemyT < 1.5) return;
    if (a.hasBomb && g.bomb.state === 'carried') return; if (a.defuseT > 0 || a.plantT > 0) return;
    for (const v of g.actors) {
      if (v.team !== a.team || v.state !== 'downed' || v.revived || (v.rescuer && v.rescuer.state === 'alive' && v.rescuer !== a)) continue;
      const d = a.pos.distanceTo(v.pos); if (d > 32) continue; const need = d / 4.5 + (a.medkit ? MATCH.REVIVE_TIME : 0) + 0.5; if (v.bleedout < need) continue;
      const roll = this.seekRoll || (this.seekRoll = new Map()); if (!roll.has(v)) roll.set(v, Math.random() < (a.medkit ? 0.85 : 0.3)); if (!roll.get(v)) continue;
      this.rescue = v; v.rescuer = a; this.rescueKind = a.medkit ? 'revive' : 'drag'; this.path = null; return;
    }
  }
  onPing(from, pos) {
    const a = this.a; if (from === a || a.state !== 'alive') return;
    if (from.state === 'downed' && !this.rescue && a.medkit && a.pos.distanceTo(from.pos) < 45 && !from.rescuer) { this.rescue = from; from.rescuer = a; this.rescueKind = 'revive'; this.path = null; }
    else if (!this.target) this.look = pos.clone().setY(1.4);
  }
  // ---------------------------------------------------------------- perception
  canSee(e) {
    const a = this.a; if (a.blind > 0.6) return false; const eye = a.eye(tv), tgt = e.state === 'downed' ? e.chestPos(tv2) : e.headPos(tv2);
    const dx = tgt.x - eye.x, dz = tgt.z - eye.z, dist = Math.hypot(dx, dz); if (dist > 70) return false;
    const f = fwd(a.yaw); const cos = (f.x * dx + f.z * dz) / (dist || 1); const recentlyHit = this.g.time - this.damagedT < 1.5;
    if (cos < -0.15 && dist > 2.5 && !recentlyHit) return false;
    if (!this.g.map.segmentClear(eye, tgt)) { const c = e.chestPos(tv2); if (!this.g.map.segmentClear(eye, c)) return false; }
    if (this.g.fx.smokeBlocks(eye, tgt)) return false; return true;
  }
  perceive() {
    const g = this.g, a = this.a; this.visible = [];
    for (const e of g.actors) { if (e.team === a.team || e.state === 'dead') continue; if (this.canSee(e)) this.visible.push(e); }
    const alive = this.visible.filter(e => e.state === 'alive'); let pick = null, bd = 1e9;
    // finishing downed enemies is a choice, not a reflex: only when nothing else is visible for a moment, and not always
    let pool = alive;
    if (!alive.length) { this.finishWait = (this.finishWait || 0) + 0.15; pool = this.finishWait > 1.4 ? this.visible.filter(e => (this.finishRoll ||= new Map()).get(e) ?? this.finishRoll.set(e, Math.random() < 0.55).get(e)) : []; } else this.finishWait = 0;
    for (const e of pool) { const d = e.pos.distanceTo(a.pos) - (e === this.target ? 6 : 0); if (d < bd) { bd = d; pick = e; } }
    if (pick && pick !== this.target) { // new target: reaction time
      const dy = Math.abs(angDiff(a.yaw, yawTo(pick.pos.x - a.pos.x, pick.pos.z - a.pos.z))); this.react = (rand(...this.d.react) + dy * 0.12) * (dy < 0.35 && a.speed < 1 ? 0.65 : 1) + (a.blind > 0 ? 0.4 : 0);
      this.trackT = 0; this.wantHead = Math.random() < this.d.head + (a.speed < 0.6 ? 0.1 : 0); this.newErr(pick);
    }
    this.target = pick; if (pick) { this.lastSeen = pick.pos.clone(); this.lastSeenT = g.time; this.lastEnemyT = g.time; this.alertSite(pick); }
    // hearing
    for (const s of g.sounds) { if (s.team === a.team || s.src.state === 'dead') continue; const d = s.pos.distanceTo(a.pos); if (d < s.radius && g.time - this.heardT > 0.8) { this.heard = s.pos.clone(); this.heardT = g.time; if (a.team === 'def' && s.kind === 'plant') { const st = g.siteAt(s.pos.x, s.pos.z); if (st) g.alert[st] = g.time; } else if (a.team === 'def') this.alertSite(s.src); } }
  }
  alertSite(e) { if (this.a.team !== 'def') return; const g = this.g; for (const k of ['A', 'B']) { const S = SITES[k]; if (e.pos.x > S.x0 - 10 && e.pos.x < S.x1 + 10 && e.pos.z > S.z0 - 4 && e.pos.z < S.z1 + 16) g.alert[k] = g.time; } }
  newErr(t) { const d = t ? t.pos.distanceTo(this.a.pos) : 10; const m = (0.3 + d * 0.02) * this.d.err * (this.a.speed < 0.6 ? 0.6 : 1.2); this.err.set(rand(-1, 1), rand(-0.6, 0.6), rand(-1, 1)).normalize().multiplyScalar(m); this.errT = rand(0.3, 0.6); }

  // ---------------------------------------------------------------- navigation
  goTo(x, z, force) {
    const g = this.g, a = this.a; if (!force && this.goal && Math.hypot(this.goal[0] - x, this.goal[1] - z) < 1.5 && this.path && g.time < this.repathT) return;
    this.goal = [x, z]; this.path = g.map.findPath(a.pos.x, a.pos.z, x, z); this.pathI = 0; this.repathT = g.time + 4;
  }
  follow(speed) { // returns wish dir; null if arrived
    const a = this.a; if (!this.path || this.pathI >= this.path.length) return null; let p = this.path[this.pathI];
    let dx = p[0] - a.pos.x, dz = p[1] - a.pos.z, d = Math.hypot(dx, dz);
    while (d < (this.pathI === this.path.length - 1 ? 0.5 : 0.7)) { this.pathI++; if (this.pathI >= this.path.length) return null; p = this.path[this.pathI]; dx = p[0] - a.pos.x; dz = p[1] - a.pos.z; d = Math.hypot(dx, dz); }
    return { x: dx / d, z: dz / d, speed, dist: d };
  }
  arrived(x, z, r = 1.0) { return Math.hypot(this.a.pos.x - x, this.a.pos.z - z) < r; }
  findCover(from) {
    const g = this.g, a = this.a; let best = null, bd = 1e9; const fe = from.clone(); fe.y = 1.5;
    for (let k = 0; k < 28; k++) {
      const ang = (k / 28) * Math.PI * 2, r = 2 + (k % 4) * 2.2; const x = a.pos.x + Math.cos(ang) * r, z = a.pos.z + Math.sin(ang) * r;
      if (!g.map.walkableAt(x, z)) continue; const p = new THREE.Vector3(x, 1.2, z); if (g.map.segmentClear(fe, p)) continue;
      const d = r + (p.distanceTo(from) < a.pos.distanceTo(from) ? 4 : 0); if (d < bd) { bd = d; best = [x, z]; }
    }
    return best;
  }

  // ---------------------------------------------------------------- main update
  update(dt) {
    const g = this.g, a = this.a;
    if (a.state === 'downed') return this.updateDowned(dt);
    if (g.phase === 'buy') { this.face(dt, null); g.move(a, 0, 0, 0, false, dt); return; }
    this.perceiveT -= dt; if (this.perceiveT <= 0) { this.perceiveT = 0.15; this.perceive(); }
    if (this.target && (this.target.state === 'dead' || (this.target.state === 'downed' && this.targetWasAlive))) { this.target = null; this.burst = 0; this.burstCd = rand(0.5, 1.0); }
    this.targetWasAlive = !!this.target && this.target.state === 'alive';
    let wish = null; a.sprinting = false; a.crouchWanted = false; const w = a.weapon;
    if (this.target && this.target.state === 'downed' && (this.rescue || a.reviving || a.dragging || a.defuseT > 0 || a.plantT > 0)) this.target = null; // jobs beat finishing a downed enemy
    if (this.target && g.phase !== 'post') {
      // rescue/defuse commitment: keep going if nearly done
      if (a.reviving && (a.reviveT > MATCH.REVIVE_TIME * 0.7 || (a.reviveT > MATCH.REVIVE_TIME * 0.35 && this.target.pos.distanceTo(a.pos) > 20))) { this.face(dt, this.target.eye()); g.move(a, 0, 0, 0, false, dt); return; }
      if (a.defuseT > MATCH.DEFUSE_TIME * 0.75 && g.aliveCount('atk') <= 1) { g.move(a, 0, 0, 0, false, dt); return; }
      g.cancelRevive(a); a.defuseT = 0; a.plantT = a.plantT > MATCH.PLANT_TIME * 0.8 ? a.plantT : 0; g.stopDrag(a); a.action = null;
      wish = this.combat(dt);
    } else {
      this.burst = 0; if (w && w.mag < w.def.mag * 0.35 && g.time - this.lastEnemyT > 1.2) a.startReload();
      if (a.slot !== 1 && a.primary && a.slot !== 3) a.switchTo(1);
      this.seekT = (this.seekT || 0) - dt; if (this.seekT <= 0) { this.seekT = 0.5; this.seekRescue(); }
      if (this.utility(dt)) wish = 'stop'; else wish = this.medical(dt) || this.doRescue(dt) || this.objective(dt);
      if (wish === 'stop') wish = null;
      // looking: last seen / heard / hold direction / path direction
      let lookAt = null; if (g.time - this.lastSeenT < 3 && this.lastSeen) lookAt = this.lastSeen.clone().setY(1.4); else if (g.time - this.heardT < 2.5 && this.heard) lookAt = this.heard.clone().setY(1.4); else if (this.look) lookAt = this.look;
      if (!lookAt && wish) lookAt = new THREE.Vector3(a.pos.x + wish.x * 5, a.eye().y, a.pos.z + wish.z * 5);
      this.face(dt, lookAt);
    }
    // stuck detection
    if (wish && wish.speed > 1 && a.speed < 0.4) { this.stuckT += dt; if (this.stuckT > 0.9) { this.stuckT = 0; this.path = null; this.repathT = 0; if (this.goal) this.goTo(this.goal[0] + rand(-1, 1), this.goal[1] + rand(-1, 1), true); a.vel.x += rand(-2, 2); a.vel.z += rand(-2, 2); } } else this.stuckT = 0;
    // separation from teammates
    let sx = 0, sz = 0; for (const o of g.actors) { if (o === a || o.state !== 'alive') continue; const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d2 = dx * dx + dz * dz; if (d2 < 1.0 && d2 > 1e-4) { const d = Math.sqrt(d2); sx += dx / d * (1 - d); sz += dz / d * (1 - d); } }
    if (wish) { let x = wish.x + sx * 0.6, z = wish.z + sz * 0.6; const L = Math.hypot(x, z) || 1; g.move(a, x / L, z / L, wish.speed, false, dt); }
    else g.move(a, sx, sz, (sx || sz) ? 1.5 : 0, false, dt);
  }
  face(dt, p) {
    const a = this.a; let ty = a.yaw, tp = 0;
    if (p) { const e = a.eye(tv); const dx = p.x - e.x, dz = p.z - e.z; ty = yawTo(dx, dz); tp = Math.atan2(p.y - e.y, Math.hypot(dx, dz)); }
    else { this.scanT += dt; ty = a.yaw + Math.sin(this.scanT * 0.7) * 0.004; }
    const turn = Math.min(1, dt * 6); a.yaw += angDiff(a.yaw, ty) * turn; a.pitch += (tp - a.pitch) * turn; this.aimYaw = a.yaw; this.aimPitch = a.pitch;
  }
  combat(dt) {
    const g = this.g, a = this.a, t = this.target, D = this.d; let w = a.weapon;
    if (a.slot === 3 || !w) { a.switchTo(a.primary ? 1 : 2); w = a.weapon; }
    if (w && w.mag === 0 && !w.reserve.length) { if (a.slot === 1 && a.secondary) a.switchTo(2); }
    this.trackT += dt; this.react -= dt; this.errT -= dt; if (this.errT <= 0) this.newErr(t);
    const decay = Math.exp(-this.trackT / 0.75), dist = t.pos.distanceTo(a.pos);
    const aimP = (t.state === 'downed' ? t.chestPos() : this.wantHead ? t.headPos() : t.chestPos()).addScaledVector(this.err, decay + 0.12);
    const e = a.eye(tv); const dx = aimP.x - e.x, dz = aimP.z - e.z; const ty = yawTo(dx, dz), tp = Math.atan2(aimP.y - e.y, Math.hypot(dx, dz));
    const turn = D.turn * dt * (a.blind > 0 ? 0.3 : 1) * (a.armHurt ? 0.8 : 1); const dyaw = angDiff(this.aimYaw, ty), dp = tp - this.aimPitch;
    this.aimYaw += Math.sign(dyaw) * Math.min(Math.abs(dyaw), turn * Math.max(0.25, Math.abs(dyaw))); this.aimPitch += Math.sign(dp) * Math.min(Math.abs(dp), turn * Math.max(0.25, Math.abs(dp)));
    a.yaw = this.aimYaw; a.pitch = this.aimPitch;
    // low health / reloading -> cover
    const reloading = a.reloadT > 0;
    if ((reloading || (a.hp < 40 && a.state === 'alive')) && this.coverT <= 0 && !this.cover) { this.cover = this.findCover(t.eye()); this.coverT = 3.2; if (this.cover) this.goTo(this.cover[0], this.cover[1], true); }
    if (this.cover) { this.coverT -= dt; const wsh = this.follow(MOVE.run); if (!wsh || this.coverT <= 0) { this.cover = null; this.coverT = -1.5; } else { a.crouchWanted = false; if (!reloading) this.shootLogic(dt, dist, ty, tp); return wsh; } }
    if (this.coverT < 0) this.coverT += dt;
    // shooting with counter-strafe: stop while firing, strafe between bursts
    const firing = this.shootLogic(dt, dist, ty, tp);
    if (firing || this.burst > 0) { if (this.holdCrouch && dist > 12) { const ce = new THREE.Vector3(a.pos.x, a.pos.y + MOVE.eyeCrouch, a.pos.z); a.crouchWanted = g.map.segmentClear(ce, t.chestPos()); } return null; }
    this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(0.25, 0.6); this.strafeDir = Math.random() < 0.5 ? -1 : 1; }
    if (a.hasBomb || a.plantT > 0 || dist < 3) return null;
    const f = fwd(a.yaw); const sx = -f.z * this.strafeDir, sz = f.x * this.strafeDir; if (!g.map.walkableAt(a.pos.x + sx * 0.8, a.pos.z + sz * 0.8)) this.strafeDir *= -1;
    return { x: sx, z: sz, speed: MOVE.run * 0.85 };
  }
  shootLogic(dt, dist, ty, tp) {
    const g = this.g, a = this.a, w = a.weapon; if (!w || this.react > 0 || a.blind > 0.6) return false;
    const off = Math.abs(angDiff(this.aimYaw, ty)) + Math.abs(tp - this.aimPitch); const tol = Math.max(0.025, 0.5 / Math.max(dist, 1));
    if (this.burstCd > 0) { this.burstCd -= dt; return false; }
    if (this.friendlyInLine(dist)) { this.burst = 0; return false; }
    if (this.burst <= 0) { if (off > tol * 3) return a.speed > 2.2 && off < tol * 8; if (a.speed > 2.2 && dist > 8) return true; // stop first (counter-strafe), then shoot
      this.burst = w.def.auto ? (dist < 10 ? Math.floor(rand(6, 11)) : dist < 22 ? Math.floor(rand(3, 6)) : Math.floor(rand(1, 3))) : 1; }
    if (g.tryFire(a, this.aimYaw, this.aimPitch, this.d.comp)) { this.burst--; if (this.burst <= 0) this.burstCd = w.def.auto ? rand(0.18, 0.4) * (dist > 20 ? 1.6 : 1) : rand(0.18, 0.4) + w.def.interval; }
    else if (w.mag === 0) this.burst = 0;
    return true;
  }
  friendlyInLine(dist) {
    const g = this.g, a = this.a, o = a.eye(), d = fwd(this.aimYaw, this.aimPitch);
    for (const m of g.actors) { if (m === a || m.team !== a.team || m.state === 'dead') continue; if (m.pos.distanceTo(a.pos) > dist + 1) continue; if (g.rayActor(o, d, m, dist)) return true; }
    return false;
  }
  medical(dt) {
    const a = this.a, g = this.g; if (a.action) return 'stop'; if (g.time - this.lastEnemyT < 2 || g.phase === 'post' || g.phase === 'buy') return null;
    if (a.bleed === 2 && a.tourniquet) a.startAction('tourniquet'); else if (a.bleed === 1 && a.bandage) a.startAction('bandage'); else if ((a.bleed || a.hp < 45) && a.medkit && !this.rescue && Math.random() < 0.02) a.startAction('medkit');
    return a.action ? 'stop' : null;
  }
  doRescue(dt) {
    const g = this.g, a = this.a, v = this.rescue; if (!v) return null;
    if (v.state !== 'downed' || g.phase === 'post') { if (v.rescuer === a) v.rescuer = null; this.rescue = null; g.stopDrag(a); g.cancelRevive(a); return null; }
    if (a.reviving) { this.face(dt, v.chestPos()); a.crouchWanted = true; return 'stop'; }
    if (a.dragging) {
      if (!this.dragDest) { const from = this.lastSeen && g.time - this.lastSeenT < 10 ? this.lastSeen : null; this.dragDest = from ? this.findCover(from) : null; if (!this.dragDest) this.dragDest = [a.pos.x + rand(-3, 3), a.pos.z + rand(-3, 3)]; this.goTo(this.dragDest[0], this.dragDest[1], true); this.dragT = 4; }
      this.dragT -= dt; const wsh = this.follow(MOVE.drag); if (!wsh || this.dragT <= 0) { g.stopDrag(a); this.dragDest = null; if (a.medkit) this.rescueKind = 'revive'; else { v.rescuer = null; this.rescue = null; } return 'stop'; } return wsh;
    }
    if (this.arrived(v.pos.x, v.pos.z, 1.5)) {
      const danger = g.time - this.lastEnemyT < 3;
      if (this.rescueKind === 'drag' || (danger && Math.random() < 0.5 && !this.draggedOnce)) { this.draggedOnce = true; g.startDrag(a, v); return 'stop'; }
      if (!g.startRevive(a, v)) { v.rescuer = null; this.rescue = null; } return 'stop';
    }
    this.goTo(v.pos.x, v.pos.z); return this.follow(MOVE.run);
  }
  objective(dt) {
    const g = this.g, a = this.a, b = g.bomb;
    if (g.phase === 'post') return null;
    if (a.team === 'atk') {
      if (b.state === 'planted') { const p = this.postSpot || [b.pos.x, b.pos.z]; if (!this.arrived(p[0], p[1], 1.2)) { this.goTo(p[0], p[1]); return this.follow(MOVE.run); } this.look = new THREE.Vector3(b.pos.x, 1.2, b.pos.z + 4); return null; }
      if (b.state === 'dropped') { const atks = g.teamActors('atk').filter(x => x.state === 'alive' && x.brain); const near = atks.sort((p, q) => p.pos.distanceTo(b.pos) - q.pos.distanceTo(b.pos))[0]; if (near === a) { this.goTo(b.pos.x, b.pos.z); return this.follow(MOVE.run); } }
      if (g.phase === 'prep') return null;
      if (this.stage < this.via.length) {
        const v = this.via[this.stage]; if (this.arrived(v[0], v[1], 1.6)) { this.stage++; this.path = null; }
        else { const last = this.stage === this.via.length - 1; this.goTo(v[0], v[1]); const wsh = this.follow(last ? MOVE.run : MOVE.run); if (wsh && !last && Math.random() < 0.002) this.holdCrouch = !this.holdCrouch; return wsh; }
      }
      // staging: wait for the team (or time pressure), then execute
      const exec = g.strategy.exec || (g.timer < MATCH.ROUND_TIME - 40) || g.teamActors('atk').filter(x => x.brain && x.state === 'alive' && x.brain.stage >= x.brain.via.length).length >= Math.max(1, g.aliveCount('atk') - 2);
      if (!exec) { this.look = new THREE.Vector3(SITES[this.site].cx, 1.4, SITES[this.site].cz); return null; } g.strategy.exec = true;
      const S = SITES[this.site];
      if (a.hasBomb) { const sx = S.cx + (this.plantOff ||= rand(-3, 3)), sz = S.cz + rand(-0.5, 0.5) * 0; if (g.siteAt(a.pos.x, a.pos.z) && this.arrived(sx, sz, 3.5)) { if (g.startPlant(a)) { a.crouchWanted = true; return 'stop'; } } this.goTo(sx, sz); return this.follow(MOVE.run); }
      const spot = this.siteSpot || (this.siteSpot = HOLDS[this.site][Math.floor(Math.random() * 3)]); if (!this.arrived(spot[0], spot[1], 1.2)) { this.goTo(spot[0], spot[1]); return this.follow(MOVE.run); }
      this.look = new THREE.Vector3(0, 1.4, -30); return null;
    }
    // defenders
    if (b.state === 'planted') {
      const atkAlive = g.aliveCount('atk'), near = this.arrived(b.pos.x, b.pos.z, 1.4);
      if (near && (g.time - this.lastEnemyT > 1.5 || atkAlive === 0 || b.timer < MATCH.DEFUSE_TIME + 1)) { const otherDefusing = g.actors.some(x => x !== a && x.defuseT > 0); if (!otherDefusing) { g.startDefuse(a); a.crouchWanted = true; return 'stop'; } }
      if (!near) { this.goTo(b.pos.x, b.pos.z); return this.follow(b.timer < 12 ? MOVE.sprint : MOVE.run); } this.look = new THREE.Vector3(b.pos.x, 1.4, b.pos.z + 6); return null;
    }
    // rotation on alert
    for (const k of ['A', 'B']) if (g.time - g.alert[k] < 6 && this.holdKey !== k && !this.rotated && Math.random() < (this.role === 'mid' ? 0.1 : 0.05)) { this.rotated = true; this.holdKey = k; const hs = ROTATE[k]; this.holdSpot = hs[Math.floor(Math.random() * hs.length)]; this.path = null; }
    const h = this.holdSpot; if (!h) return null;
    if (!this.arrived(h[0], h[1], 0.9)) { this.goTo(h[0], h[1]); return this.follow(this.rotated ? MOVE.sprint * 0.95 : MOVE.run); }
    const ents = ENTRIES[this.holdKey] || ENTRIES.mid; let best = ents[0], bd = 1e9; for (const e of ents) { const d = Math.hypot(e[0] - h[0], e[1] - h[1]); const vis = g.map.segmentClear(a.eye(), new THREE.Vector3(e[0], 1.4, e[1])); const score = d - (vis ? 50 : 0); if (score < bd) { bd = score; best = e; } }
    this.look = new THREE.Vector3(best[0], 1.4, best[1]);
    if (this.holdCrouch && g.phase === 'live') { const ce = new THREE.Vector3(a.pos.x, a.pos.y + MOVE.eyeCrouch, a.pos.z); a.crouchWanted = g.map.segmentClear(ce, this.look); }
    return null;
  }
  updateDowned(dt) {
    const g = this.g, a = this.a; if (a.draggedBy) { g.move(a, 0, 0, 0, false, dt); return; }
    // crawl toward the nearest standing teammate, or stay still if one is close / reviving
    let mate = null, md = 1e9; for (const o of g.actors) { if (o.team !== a.team || o.state !== 'alive') continue; const d = o.pos.distanceTo(a.pos); if (d < md) { md = d; mate = o; } }
    if (mate && md > 3 && !a.revivedBy && g.phase === 'live') { this.goTo(mate.pos.x, mate.pos.z); const wsh = this.follow(MOVE.crawl); if (wsh) { a.yaw += angDiff(a.yaw, yawTo(wsh.x, wsh.z)) * Math.min(1, dt * 3); g.move(a, wsh.x, wsh.z, MOVE.crawl, false, dt); return; } }
    g.move(a, 0, 0, 0, false, dt);
  }
}
