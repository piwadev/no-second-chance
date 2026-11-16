// Visual effects: tracers, impact decals, sparks, blood, muzzle flashes, smoke clouds, explosions.
import * as THREE from './vendor/three.module.js';

function radialTex(inner, outer, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function holeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(5,5,5,1)'); gr.addColorStop(0.25, 'rgba(15,15,15,.95)'); gr.addColorStop(0.5, 'rgba(30,30,30,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); for (let i = 0; i < 8; i++) { g.strokeStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.moveTo(32, 32); const a = Math.random() * 7; g.lineTo(32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene; this.tracers = []; this.smokes = []; this.flashes = []; this.booms = [];
    this.decalMat = new THREE.MeshBasicMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.bloodDecalMat = new THREE.MeshBasicMaterial({ map: radialTex('rgba(110,10,8,.95)', 'rgba(80,0,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.decals = []; this.decalGeo = new THREE.PlaneGeometry(0.11, 0.11); this.bloodGeo = new THREE.PlaneGeometry(0.8, 0.8);
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.9 });
    // particles
    const N = 600; this.pN = N; this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pi = 0;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, depthWrite: false, map: radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)') }));
    this.points.frustumCulled = false; for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -100; scene.add(this.points);
    this.smokeTex = radialTex('rgba(200,204,208,.95)', 'rgba(170,175,180,0)', 128); this.fireTex = radialTex('rgba(255,230,160,1)', 'rgba(255,120,20,0)', 64);
    this.flashLight = new THREE.PointLight(0xffc870, 0, 10, 2); scene.add(this.flashLight); this.flashT = 0;
  }
  particle(p, v, col, life) {
    const i = this.pi = (this.pi + 1) % this.pN; this.pPos.set([p.x, p.y, p.z], i * 3); this.pVel.set([v.x, v.y, v.z], i * 3); this.pCol.set(col, i * 3); this.pLife[i] = life;
  }
  tracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]); const l = new THREE.Line(g, this.tracerMat.clone()); this.scene.add(l); this.tracers.push({ l, t: 0.07 });
  }
  muzzle(pos) { this.flashLight.position.copy(pos); this.flashLight.intensity = 6; this.flashT = 0.05; }
  decal(point, n, blood = false) {
    const m = new THREE.Mesh(blood ? this.bloodGeo : this.decalGeo, blood ? this.bloodDecalMat : this.decalMat);
    m.position.set(point.x + n[0] * 0.01, point.y + n[1] * 0.01, point.z + n[2] * 0.01); m.lookAt(m.position.x + n[0], m.position.y + n[1], m.position.z + n[2]); m.rotateZ(Math.random() * 6.28);
    if (blood) m.scale.setScalar(0.5 + Math.random() * 0.8);
    this.scene.add(m); this.decals.push(m); if (this.decals.length > 160) { const o = this.decals.shift(); this.scene.remove(o); }
  }
  sparks(point, n) {
    for (let k = 0; k < 6; k++) this.particle(point, { x: n[0] * 2 + (Math.random() - .5) * 3, y: n[1] * 2 + Math.random() * 2.5, z: n[2] * 2 + (Math.random() - .5) * 3 }, [1, 0.8, 0.4], 0.25 + Math.random() * 0.2);
    for (let k = 0; k < 4; k++) this.particle(point, { x: n[0] * 0.6 + (Math.random() - .5), y: Math.random() * 0.8, z: n[2] * 0.6 + (Math.random() - .5) }, [0.45, 0.45, 0.45], 0.5);
  }
  blood(point, dir) {
    for (let k = 0; k < 12; k++) this.particle(point, { x: dir.x * 2 + (Math.random() - .5) * 2.4, y: Math.random() * 2, z: dir.z * 2 + (Math.random() - .5) * 2.4 }, [0.6, 0.04, 0.03], 0.45 + Math.random() * 0.3);
  }
  smoke(pos, dur = 15) {
    const group = new THREE.Group(); const puffs = [];
    for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, opacity: 0, depthWrite: false, color: 0xb9bec4 })); const a = Math.random() * 6.28, r = Math.random() * 2.6; s.userData.off = new THREE.Vector3(Math.cos(a) * r, 0.6 + Math.random() * 2.6, Math.sin(a) * r); s.scale.setScalar(1); group.add(s); puffs.push(s); }
    group.position.copy(pos); group.position.y = 0; this.scene.add(group); const sm = { pos: new THREE.Vector3(pos.x, 1.6, pos.z), r: 0, maxR: 3.6, t: 0, dur, group, puffs }; this.smokes.push(sm); return sm;
  }
  explosion(pos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.position.copy(pos); s.position.y += 0.5; this.scene.add(s); this.booms.push({ s, t: 0 });
    const l = new THREE.PointLight(0xffa040, 40, 18, 2); l.position.copy(s.position); this.scene.add(l); this.booms.push({ l, t: 0 });
    for (let k = 0; k < 40; k++) this.particle(pos, { x: (Math.random() - .5) * 14, y: Math.random() * 9, z: (Math.random() - .5) * 14 }, [1, 0.6 + Math.random() * 0.3, 0.2], 0.4 + Math.random() * 0.4);
    for (let k = 0; k < 20; k++) this.particle(pos, { x: (Math.random() - .5) * 4, y: Math.random() * 4, z: (Math.random() - .5) * 4 }, [0.2, 0.2, 0.2], 1.2);
  }
  // Is the segment a->b blocked by any active smoke? (used for bot vision)
  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      if (s.r < 1) continue; const ab = new THREE.Vector3().subVectors(b, a), L = ab.length(); ab.divideScalar(L);
      const t = Math.max(0, Math.min(L, new THREE.Vector3().subVectors(s.pos, a).dot(ab))); const p = a.clone().addScaledVector(ab, t);
      const dy = (p.y - s.pos.y) * 0.6; if (p.distanceToSquared(s.pos) - (p.y - s.pos.y) ** 2 + dy * dy < s.r * s.r) return true;
    }
    return false;
  }
  clearRound() {
    for (const s of this.smokes) this.scene.remove(s.group); this.smokes = [];
    for (const d of this.decals) this.scene.remove(d); this.decals = [];
  }
  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) { const t = this.tracers[i]; t.t -= dt; t.l.material.opacity = Math.max(0, t.t / 0.07); if (t.t <= 0) { this.scene.remove(t.l); t.l.geometry.dispose(); t.l.material.dispose(); this.tracers.splice(i, 1); } }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flashLight.intensity = 0; }
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue; this.pLife[i] -= dt; const k = i * 3; this.pVel[k + 1] -= 9.8 * dt;
      this.pPos[k] += this.pVel[k] * dt; this.pPos[k + 1] += this.pVel[k + 1] * dt; this.pPos[k + 2] += this.pVel[k + 2] * dt;
      if (this.pPos[k + 1] < 0.02) { this.pPos[k + 1] = 0.02; this.pVel[k] *= 0.5; this.pVel[k + 2] *= 0.5; this.pVel[k + 1] = 0; }
      if (this.pLife[i] <= 0) this.pPos[k + 1] = -100;
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i]; s.t += dt; const grow = Math.min(1, s.t / 1.6), fade = s.t > s.dur - 2 ? Math.max(0, (s.dur - s.t) / 2) : 1; s.r = s.maxR * grow * (fade > 0.3 ? 1 : fade / 0.3);
      for (const p of s.puffs) { p.position.copy(p.userData.off).multiplyScalar(0.3 + 0.7 * grow); p.position.y = p.userData.off.y * (0.4 + 0.6 * grow); p.scale.setScalar(2.2 + 2.6 * grow); p.material.opacity = 0.85 * fade * Math.min(1, s.t * 2); p.material.rotation += dt * 0.05; }
      if (s.t >= s.dur) { this.scene.remove(s.group); this.smokes.splice(i, 1); }
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i]; b.t += dt;
      if (b.s) { b.s.scale.setScalar(1 + b.t * 14); b.s.material.opacity = Math.max(0, 1 - b.t / 0.35); if (b.t > 0.35) { this.scene.remove(b.s); this.booms.splice(i, 1); } }
      else { b.l.intensity = Math.max(0, 40 * (1 - b.t / 0.3)); if (b.t > 0.3) { this.scene.remove(b.l); this.booms.splice(i, 1); } }
    }
  }
}
