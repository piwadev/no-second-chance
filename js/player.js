// Local player: input, movement, interactions, first-person camera, view model and spectating.
import * as THREE from './vendor/three.module.js';
import { MOVE, MATCH } from './config.js';
import { buildViewModel, buildNadeModel, buildBombModel, VM_OFFSET } from './models.js';
import { forwardOf } from './game.js';
import { audio } from './audio.js';

const DEG = Math.PI / 180;
export class PlayerController {
  constructor(game, camera, canvas, settings) {
    this.g = game; this.cam = camera; this.canvas = canvas; this.settings = settings; this.keys = new Set(); this.pressed = new Set(); this.mouse = [false, false, false]; this.mousePressed = [false, false, false];
    this.locked = false; this.bobT = 0; this.kick = 0; this.swayX = 0; this.swayY = 0; this.specIdx = 0; this.lastDx = 0; this.lastDy = 0; this.enabled = false;
    // view model scene
    this.vmScene = new THREE.Scene(); this.vmCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xd8e2ec, 0x3a3e44, 2.2)); const dl = new THREE.DirectionalLight(0xfff4e0, 2.2); dl.position.set(1, 2, 1); this.vmScene.add(dl);
    this.vmRoot = new THREE.Group(); this.vmScene.add(this.vmRoot); this.vmCache = {}; this.vmCur = null;
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ map: this.flashTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); this.flash.visible = false; this.vmRoot.add(this.flash);
    this.bind();
  }
  flashTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,200,90,.9)'); gr.addColorStop(1, 'rgba(255,120,0,0)'); g.fillStyle = gr; g.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 12 : 32; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.fill(); const t = new THREE.CanvasTexture(c); return t; }
  bind() {
    const block = ['Tab', 'Space', 'KeyB', 'ControlLeft', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyF', 'KeyG', 'KeyH', 'KeyX', 'KeyV', 'KeyQ', 'KeyE', 'KeyR', 'KeyC'];
    addEventListener('keydown', e => { if (!this.enabled) return; if (block.includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault(); if (!this.keys.has(e.code)) this.pressed.add(e.code); this.keys.add(e.code); });
    addEventListener('keyup', e => { this.keys.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse = [false, false, false]; });
    addEventListener('mousedown', e => { if (!this.enabled || !this.locked) return; this.mouse[e.button] = true; this.mousePressed[e.button] = true; });
    addEventListener('mouseup', e => { this.mouse[e.button] = false; });
    addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
    addEventListener('wheel', e => { if (!this.enabled || !this.locked) return; this.wheel = (this.wheel || 0) + Math.sign(e.deltaY); }, { passive: true });
    addEventListener('mousemove', e => { if (!this.locked || !this.enabled) return; this.look(e.movementX, e.movementY); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.canvas; if (this.onLockChange) this.onLockChange(this.locked); });
  }
  lock() { try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } }); } catch { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } } }
  look(dx, dy) {
    const a = this.g.player; if (this.g.phase === 'over') return; const s = this.settings.sens * 0.022 * DEG * (a.state === 'downed' ? 0.5 : 1);
    if (a.state === 'dead') return; a.yaw -= dx * s; a.pitch -= dy * s * (this.settings.invert ? -1 : 1);
    const lim = a.state === 'downed' ? [-0.3, 0.4] : [-89 * DEG, 89 * DEG]; a.pitch = Math.max(lim[0], Math.min(lim[1], a.pitch));
    this.swayX += dx * 0.00012; this.swayY += dy * 0.00012;
  }
  held(c) { return this.keys.has(c); }
  hit(c) { return this.pressed.has(c); }

  update(dt) {
    const g = this.g, a = g.player, k = c => this.held(c);
    if (g.phase === 'over') { this.pressed.clear(); return; }
    if (a.state === 'dead') { this.spectate(dt); this.endFrame(); return; }
    const inputOK = this.locked && !g.hud.buyOpen;
    // ---- movement
    let fx = 0, fz = 0; if (inputOK) { if (k('KeyW')) fz += 1; if (k('KeyS')) fz -= 1; if (k('KeyA')) fx -= 1; if (k('KeyD')) fx += 1; }
    const f = forwardOf(a.yaw), rx = -f.z, rz = f.x; let wx = f.x * fz + rx * fx, wz = f.z * fz + rz * fx; const L = Math.hypot(wx, wz); if (L > 0) { wx /= L; wz /= L; }
    const sprintKey = inputOK && k('ShiftLeft') && fz > 0;
    a.crouchWanted = inputOK && (k('KeyC') || k('ControlLeft')) && a.state === 'alive';
    a.sprinting = sprintKey && !a.legHurt && a.crouch < 0.2 && a.state === 'alive' && !a.action && !a.dragging && a.speed > 3;
    if (sprintKey && a.legHurt && this.hit('ShiftLeft')) g.hud.toast('Leg injury — cannot sprint');
    const walk = inputOK && k('AltLeft');
    const speed = L > 0 ? g.maxSpeed(a, sprintKey, walk) : 0; g.move(a, wx, wz, speed, inputOK && this.hit('Space') && a.state === 'alive', dt);
    if (a.state === 'downed') { this.downedInput(); this.camera(dt); this.endFrame(); return; }
    // ---- interaction (E / G)
    this.interact(inputOK);
    // ---- weapons
    if (inputOK && a.state === 'alive') {
      if (this.hit('Digit1')) a.switchTo(1); if (this.hit('Digit2')) a.switchTo(2);
      if (this.hit('Digit3') || this.hit('Digit4')) { if (a.slot === 3) { const n = a.nextNade(a.nadeKind); if (n) { a.nadeKind = n; audio.click(); } } else if (!a.switchTo(3)) g.hud.toast('No grenades'); }
      if (this.hit('Digit5') && a.hasBomb) g.hud.toast('Explosive: go to site A or B and hold E to plant');
      if (this.hit('KeyQ')) a.switchTo(a.prevSlot === 1 && a.primary ? 1 : a.prevSlot === 3 ? 3 : 2);
      if (this.wheel) { const order = [1, 2, 3].filter(s => s !== 1 || a.primary).filter(s => s !== 3 || a.nextNade()); let i = order.indexOf(a.slot); i = (i + (this.wheel > 0 ? 1 : -1) + order.length) % order.length; a.switchTo(order[i]); }
      if (this.hit('KeyR')) a.startReload();
      if (this.hit('KeyX')) a.startAction('bandage'); if (this.hit('KeyV')) a.startAction('tourniquet'); if (this.hit('KeyH')) a.startAction('medkit');
      if (this.hit('KeyF')) g.ping(a);
      if (a.slot === 3) { if (this.mousePressed[0] && a.canAct()) g.throwNade(a, a.nadeKind, true); else if (this.mousePressed[2] && a.canAct()) g.throwNade(a, a.nadeKind, false); }
      else if (a.weapon) { const auto = a.weapon.def.auto; if ((auto && this.mouse[0]) || (!auto && this.mousePressed[0])) { if (g.tryFire(a, a.yaw + a.punch.x * 0 , a.pitch)) this.kick = 1; } }
    }
    if (this.hit('KeyF') && a.state === 'downed') g.ping(a);
    this.camera(dt); this.endFrame();
  }
  endFrame() { this.pressed.clear(); this.mousePressed = [false, false, false]; this.wheel = 0; }
  downedInput() { const a = this.g.player; if (this.locked && this.hit('KeyF')) this.g.ping(a); }
  nearDowned(maxD = 2.2) { const a = this.g.player; let best = null, bd = maxD; for (const o of this.g.actors) { if (o === a || o.team !== a.team || o.state !== 'downed') continue; const d = o.pos.distanceTo(a.pos); if (d < bd) { bd = d; best = o; } } return best; }
  interact(ok) {
    const g = this.g, a = g.player, E = ok && this.held('KeyE'), G = ok && this.held('KeyG');
    const site = g.siteAt(a.pos.x, a.pos.z), b = g.bomb;
    if (E && a.hasBomb && site && g.phase === 'live') { g.startPlant(a); a.crouchWanted = true; } else if (a.plantT > 0 && !E) a.plantT = 0;
    const nearBomb = b.state === 'planted' && a.team === 'def' && a.pos.distanceTo(b.pos) < 1.8;
    if (E && nearBomb) g.startDefuse(a); else if (a.defuseT > 0 && !E) a.defuseT = 0;
    const mate = this.nearDowned();
    if (E && mate && !a.hasBomb && !nearBomb && !a.reviving && !a.dragging && this.hit('KeyE')) g.startRevive(a, mate);
    if (!E && a.reviving) g.cancelRevive(a);
    if (G && mate && !a.dragging && this.hit('KeyG')) { if (mate.revived) g.hud.toast(`${mate.name} was already rescued this round`); g.startDrag(a, mate); }
    if (!G && a.dragging) g.stopDrag(a);
  }
  prompt() {
    const g = this.g, a = g.player, b = g.bomb; if (a.state !== 'alive') return null;
    if (a.plantT > 0) return { label: 'PLANTING EXPLOSIVE', frac: a.plantT / MATCH.PLANT_TIME };
    if (a.defuseT > 0) return { label: 'DEFUSING', frac: a.defuseT / MATCH.DEFUSE_TIME };
    if (a.reviving) return { label: `REVIVING ${a.reviving.name.toUpperCase()}`, frac: a.reviveT / MATCH.REVIVE_TIME };
    if (a.action) { const tot = { bandage: 2.5, tourniquet: 2.0, medkit: 4.0 }[a.action]; return { label: { bandage: 'APPLYING BANDAGE', tourniquet: 'APPLYING TOURNIQUET', medkit: 'USING MEDICAL KIT' }[a.action], frac: 1 - a.actionT / tot }; }
    if (a.dragging) return { text: `Dragging ${a.dragging.name} — release [G] to drop` + (a.medkit ? ' · [E] revive' : '') };
    if (a.hasBomb && g.siteAt(a.pos.x, a.pos.z) && g.phase === 'live') return { text: 'Hold [E] to plant the explosive' };
    if (b.state === 'planted' && a.team === 'def' && a.pos.distanceTo(b.pos) < 1.8) return { text: 'Hold [E] to defuse' };
    const m = this.nearDowned(); if (m) return { text: m.revived ? `${m.name} is down again — already rescued this round. Hold [G] to drag` : `${m.name} is down · ${a.medkit ? 'Hold [E] revive (medkit)' : 'No medkit'} · Hold [G] drag` };
    return null;
  }
  spectate(dt) {
    const g = this.g, a = g.player; const mates = g.actors.filter(o => o.team === a.team && o !== a && o.state !== 'dead');
    if (this.locked && (this.mousePressed[0] || this.hit('Space'))) this.specIdx++;
    const t = mates.length ? mates[this.specIdx % mates.length] : null; this.specTarget = t;
    if (t) { const e = t.eye(); this.cam.position.lerp(e, Math.min(1, dt * 12)); this.cam.rotation.set(0, 0, 0, 'YXZ'); this.cam.rotation.y = t.yaw; this.cam.rotation.x = t.pitch; }
    else { const e = a.pos.clone().add(new THREE.Vector3(0, 1.0, 0)); this.cam.position.lerp(e, Math.min(1, dt * 4)); const k = this.g.killer; if (k && k.state !== 'dead') { const d = k.eye().sub(this.cam.position); this.cam.rotation.y = Math.atan2(-d.x, -d.z); this.cam.rotation.x = Math.atan2(d.y, Math.hypot(d.x, d.z)); } else this.cam.rotation.x = -0.2; }
    this.vmRoot.visible = false; audio.listener(this.cam.position, forwardOf(this.cam.rotation.y, this.cam.rotation.x));
  }
  camera(dt) {
    const g = this.g, a = g.player, cam = this.cam; const e = a.eye();
    const sp = a.onGround ? a.speed : 0; this.bobT += dt * sp * 1.8; const bob = a.state === 'alive' ? Math.sin(this.bobT) * 0.025 * Math.min(1, sp / 5) : 0;
    cam.position.set(e.x, e.y + bob, e.z); cam.rotation.order = 'YXZ';
    const sway = a.armHurt ? Math.sin(g.time * 1.7) * 0.25 * DEG : 0, breathe = a.armHurt ? Math.sin(g.time * 1.1) * 0.18 * DEG : 0;
    cam.rotation.y = a.yaw - a.punch.x * DEG + sway; cam.rotation.x = a.pitch + a.punch.y * DEG + breathe + a.flinch * 0.6 * DEG; cam.rotation.z = a.state === 'downed' ? 0.25 : 0;
    if (g.hud.shakeAmt > 0) { cam.position.x += (Math.random() - .5) * 0.08 * g.hud.shakeAmt; cam.position.y += (Math.random() - .5) * 0.08 * g.hud.shakeAmt; }
    audio.listener(cam.position, forwardOf(a.yaw, a.pitch));
    this.viewModel(dt);
  }
  viewModel(dt) {
    const a = this.g.player; this.vmRoot.visible = a.state === 'alive';
    if (!this.vmRoot.visible) return;
    const id = a.slot === 3 ? 'nade-' + a.nadeKind : a.weapon ? a.weapon.id : 'pistol';
    const ck = id + ':' + a.team; if (this.vmCur !== ck) { if (this.vmModel) this.vmRoot.remove(this.vmModel); this.vmModel = this.vmCache[ck] || (this.vmCache[ck] = id.startsWith('nade') ? buildNadeModel(id.slice(5)) : buildViewModel(id, a.team)); this.vmRoot.add(this.vmModel); this.vmCur = ck; }
    const rifle = id === 'ak' || id === 'm4';
    this.kick = Math.max(0, this.kick - dt * 12); this.swayX *= Math.pow(0.001, dt); this.swayY *= Math.pow(0.001, dt);
    const vo = VM_OFFSET[rifle ? 'rifle' : 'pistol']; let x = vo[0], y = vo[1], z = vo[2], rx = 0, ry = 0, rz = 0;
    const sp = a.onGround ? Math.min(1, a.speed / 5) : 0.3; x += Math.cos(this.bobT * 0.5) * 0.008 * sp; y += Math.abs(Math.sin(this.bobT * 0.5)) * 0.01 * sp;
    z += this.kick * 0.035; rx += this.kick * 0.05; x -= this.swayX; y += this.swayY;
    if (a.crouch > 0.5) { x -= 0.01; y += 0.005; }
    const w = a.weapon;
    if (a.reloadT > 0 && w) { const tot = a.reloadEmpty ? w.def.emptyReload : w.def.reload, p = 1 - a.reloadT / tot, s = Math.sin(Math.min(1, p) * Math.PI); y -= 0.08 * s; rx -= 0.5 * s; rz += 0.45 * s; }
    if (a.drawT > 0) { y -= Math.min(1, a.drawT / 0.6) * 0.25; rx -= a.drawT * 0.8; }
    if (a.sprinting) { ry += 0.7; rx -= 0.25; x -= 0.03; y -= 0.03; }
    if (a.action || a.reviving || a.dragging || a.plantT > 0 || a.defuseT > 0) { y -= 0.35; rx -= 0.8; }
    const t = Math.min(1, dt * 18); const p = this.vmRoot.position; p.x += (x - p.x) * t; p.y += (y - p.y) * t; p.z += (z - p.z) * t;
    this.vmRoot.rotation.x += (rx - this.vmRoot.rotation.x) * t; this.vmRoot.rotation.y += (ry - this.vmRoot.rotation.y) * t; this.vmRoot.rotation.z += (rz - this.vmRoot.rotation.z) * t;
    if (this.vmModel.userData.pose) this.vmModel.userData.pose(dt, { reload: a.reloadT > 0 });
    // muzzle flash + world muzzle position for tracers
    const mu = this.vmModel.userData.gun && this.vmModel.userData.gun.userData.muzzle; if (mu) this.flash.position.set(mu.x, mu.y, mu.z - 0.03); else this.flash.position.set(0, 0.01, -0.6); this.flash.visible = this.g.time - a.lastShot < 0.035 && a.slot !== 3; this.flash.rotation.z = Math.random() * 6;
    const f = forwardOf(a.yaw, a.pitch), r = new THREE.Vector3(-f.z, 0, f.x).normalize(); this.g.viewMuzzle = this.cam.position.clone().addScaledVector(f, 0.7).addScaledVector(r, 0.13).add(new THREE.Vector3(0, -0.12, 0));
  }
}
