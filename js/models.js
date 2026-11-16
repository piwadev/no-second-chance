// Characters (rigged + animated soldier), weapon models and first-person view models.
// Soldier: Quaternius Universal Base Character + Universal Animation Library (CC0), dressed in a
// procedural uniform (shader regions by bone weight), helmet and plate carrier; arms are placed on the
// weapon with two-bone IK every frame, so the same rig is used for third person and the first-person arms.
import * as THREE from './vendor/three.module.js';
import * as SkeletonUtils from './vendor/jsm/utils/SkeletonUtils.js';
import { A, pbrMat } from './assets.js';
import { COLORS } from './config.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const tv = [V(), V(), V(), V(), V(), V(), V(), V()], tq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()], tm = new THREE.Matrix4();
const UP = V(0, 1, 0);

// ---------------------------------------------------------------- weapons
// native model coords: muzzle towards -z, up +y. Points: grip (right hand), fore (left hand), butt, muzzle.
const GUNS = {
  ak: { key: 'ak', grip: [0, -0.085, 0.29], fore: [0, -0.035, 0.04], butt: [0, -0.06, 0.56], muzzle: [0, 0.02, -0.32], scale: 1 },
  m4: { key: 'm4', grip: [0, -0.085, 0.075], fore: [0, -0.02, -0.2], butt: [0, -0.04, 0.32], muzzle: [0, 0.03, -0.54], scale: 1 },
  pistol: { key: 'pistol', grip: [0, -0.035, 0.03], fore: [0, -0.045, 0.01], butt: [0, -0.03, 0.06], muzzle: [0, 0.05, -0.18], scale: 1, rotY: Math.PI / 2, hide: /(_b$|_b_|magazine|bullet)/ },
  heavy: { key: 'pistol', grip: [0, -0.035, 0.03], fore: [0, -0.045, 0.01], butt: [0, -0.03, 0.06], muzzle: [0, 0.05, -0.18], scale: 1.18, rotY: Math.PI / 2, hide: /(_b$|_b_|magazine|bullet)/, tint: 0x9a9fa6 },
};
const gunCache = {};
function gunTemplate(id) {
  if (gunCache[id]) return gunCache[id];
  const d = GUNS[id], src = A.gltf[d.key].scene.clone(true); const inner = new THREE.Group(); inner.add(src);
  if (d.rotY) src.rotation.y = d.rotY;
  src.traverse(o => { if (o.isMesh) { if (d.hide && d.hide.test(o.name)) o.visible = false; o.castShadow = true; if (d.tint) { o.material = o.material.clone(); o.material.color.setHex(d.tint); o.material.metalness = 0.9; } } });
  inner.scale.setScalar(d.scale); const g = V(...d.grip).multiplyScalar(d.scale); inner.position.copy(g).negate();
  const root = new THREE.Group(); root.add(inner);
  const rel = k => V(...d[k]).multiplyScalar(d.scale).sub(g);
  root.userData = { fore: rel('fore'), butt: rel('butt'), muzzle: rel('muzzle') };
  return (gunCache[id] = root);
}
export function buildGun(id) { const t = gunTemplate(id); const g = t.clone(true); g.userData = { ...t.userData }; return g; }

// ---------------------------------------------------------------- soldier template
const REG = { skin: 0, shirt: 1, pants: 2, boot: 3, glove: 4, sleeve: 5 };
function regionOf(name) {
  if (/^(Head|neck_01)/.test(name)) return REG.skin;
  if (/hand|thumb|index|middle|ring|pinky/.test(name)) return REG.glove;
  if (/foot|ball/.test(name)) return REG.boot;
  if (/thigh|calf|pelvis|root/.test(name)) return REG.pants;
  if (/upperarm|lowerarm/.test(name)) return REG.sleeve;
  return REG.shirt;
}
const TEAM_LOOK = {
  atk: { a: 0x6f5f45, b: 0x8d7b5a, c: 0x4a3f2f, pants: 0x5a5040, vest: 0x7a6440, helmet: 0x6b5d42, band: COLORS.atk },
  def: { a: 0x2c3a4c, b: 0x3e4f63, c: 0x1c2430, pants: 0x2a323d, vest: 0x1f2a36, helmet: 0x2a333d, band: COLORS.def },
};
function uniformMaterial(base, team, skinMap) {
  const L = TEAM_LOOK[team]; const m = base.clone(); if (skinMap) m.map = skinMap; m.normalScale = new THREE.Vector2(0.8, 0.8);
  m.envMapIntensity = 0.7;
  const U = { uA: { value: new THREE.Color(L.a) }, uB: { value: new THREE.Color(L.b) }, uC: { value: new THREE.Color(L.c) }, uPants: { value: new THREE.Color(L.pants) }, uArmsOnly: { value: 0 } };
  m.userData.U = U;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRegion; attribute float aSkinW; attribute float aHandW; flat varying float vRegion; varying float vSkinW; varying float vHandW; varying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = aRegion; vSkinW = aSkinW; vHandW = aHandW; vBind = position;\nfloat infl = (1.0 - smoothstep(0.35, 0.75, aSkinW)) * (aRegion > 0.5 ? (aRegion > 2.5 && aRegion < 3.5 ? 0.012 : aRegion > 3.5 && aRegion < 4.5 ? 0.003 : 0.014) : 0.0); transformed += normalize(objectNormal) * infl;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
flat varying float vRegion; varying float vSkinW; varying float vHandW; varying vec3 vBind; uniform vec3 uA, uB, uC, uPants; uniform float uArmsOnly;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
if (uArmsOnly > 0.5 && vRegion < 3.5 && vHandW < 0.5) discard;
float isCloth = smoothstep(0.75, 0.35, vSkinW); float glove = smoothstep(0.3, 0.7, vHandW);
vec3 skinCol = diffuseColor.rgb;
{
  float n = vn(vBind * 7.0) * 0.6 + vn(vBind * 17.0) * 0.4;
  vec3 camo = n < 0.42 ? uC : (n < 0.58 ? uA : uB);
  vec3 col = vRegion > 1.5 && vRegion < 2.5 ? mix(uPants, camo, 0.55) : camo;
  if (vRegion > 2.5 && vRegion < 3.5) col = vec3(0.045, 0.04, 0.035);
  col = mix(col, vec3(0.05, 0.048, 0.045), glove);
  float weave = 0.92 + 0.08 * sin(vBind.x * 900.0) * sin(vBind.y * 900.0 + vBind.z * 600.0);
  float grime = 0.85 + 0.15 * vn(vBind * 31.0);
  diffuseColor.rgb = mix(skinCol, col * weave * grime, isCloth);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, mix(0.95, 0.8, glove), isCloth);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - isCloth;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, isCloth * 0.75));');
  };
  m.customProgramCacheKey = () => 'nsc-uniform';
  return m;
}

let TPL = null;
function boneMap(root) { const m = {}; root.traverse(o => { if (o.isBone) m[o.name] = o; }); return m; }
function sampleQuat(clip, bone) { const t = clip.tracks.find(t => t.name === bone + '.quaternion'); return t ? new THREE.Quaternion().fromArray(t.values, 0) : null; }
function templ() {
  if (TPL) return TPL;
  const scene = SkeletonUtils.clone(A.gltf.soldier.scene);
  scene.traverse(o => {
    if (o.isMesh && /Icosphere/i.test(o.name)) o.visible = false;
    if (o.isSkinnedMesh) {
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
      const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, reg = new Float32Array(si.count);
      for (let i = 0; i < si.count; i++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } } reg[i] = regionOf(o.skeleton.bones[best].name); }
      g.setAttribute('aRegion', new THREE.BufferAttribute(reg, 1));
      const skw = new Float32Array(si.count); for (let i = 0; i < si.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (/^(Head|neck_01)/.test(o.skeleton.bones[si.getComponent(i, k)].name)) w += sw.getComponent(i, k); skw[i] = w; }
      g.setAttribute('aSkinW', new THREE.BufferAttribute(skw, 1));
      const hw = new Float32Array(si.count); for (let i = 0; i < si.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (/hand|thumb|index|middle|ring|pinky/.test(o.skeleton.bones[si.getComponent(i, k)].name)) w += sw.getComponent(i, k); hw[i] = w; }
      g.setAttribute('aHandW', new THREE.BufferAttribute(hw, 1));
    }
  });
  scene.updateMatrixWorld(true);
  const B = boneMap(scene);
  // bind-pose hand orientation relative to model root
  const bindQ = {}; for (const n of ['hand_l', 'hand_r', 'Head']) bindQ[n] = B[n].getWorldQuaternion(new THREE.Quaternion());
  const clips = {}; for (const g of [A.gltf.ual1, A.gltf.ual2]) for (const c of g.animations) clips[c.name] = c;
  // finger grip pose from the pistol clip
  const grip = {}; const rx = a => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), a);
  for (const n of Object.keys(B)) { const m = /^(thumb|index|middle|ring|pinky)_0([123])_([lr])$/.exec(n); if (!m) continue;
    const seg = +m[2]; let a = [0, 0.8, 1.05, 0.75][seg]; if (m[1] === 'thumb') a = [0, 0.15, 0.35, 0.3][seg]; if (m[1] === 'index' && m[3] === 'r') a *= 0.55;
    grip[n] = B[n].quaternion.clone().multiply(rx(a)); }
  // gear (attached at bind pose so it follows the bones)
  const gearMat = (c, r = 0.85, set = 'denim_fabric') => { const m = pbrMat(set, { color: c, roughness: r, metalness: 0, normal: 0.8 }); m.map = null; m.metalnessMap = null; return m; };
  const helmetGeo = new THREE.SphereGeometry(0.128, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.55); helmetGeo.scale(1.02, 0.9, 1.12);
  const rimGeo = new THREE.TorusGeometry(0.124, 0.009, 8, 32); rimGeo.rotateX(Math.PI / 2); rimGeo.scale(1, 1, 1.1);
  const plateGeo = new THREE.BoxGeometry(0.3, 0.3, 0.045, 2, 2, 1), cumGeo = new THREE.BoxGeometry(0.36, 0.11, 0.27), pouchGeo = new THREE.BoxGeometry(0.075, 0.12, 0.05), strapGeo = new THREE.BoxGeometry(0.06, 0.03, 0.3);
  const bandGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.06, 16, 1, true); bandGeo.rotateZ(Math.PI / 2);
  TPL = { scene, bindQ, clips, grip, gearMat, helmetGeo, rimGeo, plateGeo, cumGeo, pouchGeo, strapGeo, bandGeo, base: null };
  scene.traverse(o => { if (o.isSkinnedMesh && /Superhero/i.test(o.material.name)) TPL.base = o.material; });
  return TPL;
}

function attachAtBind(bone, obj, x, y, z) { // obj given in model space at the rest pose, parented to the bone keeping that placement
  obj.position.set(x, y, z); obj.updateMatrix(); bone.updateMatrixWorld(true);
  obj.applyMatrix4(new THREE.Matrix4().copy(bone.matrixWorld).invert()); bone.add(obj);
}

const LOWER = /^(root|pelvis|thigh|calf|foot|ball)/;
const clipCache = {};
function subClip(name, filter, tag) {
  const k = name + tag; if (clipCache[k]) return clipCache[k];
  const c = TPL.clips[name]; if (!c) return null;
  const tracks = c.tracks.filter(t => filter(t.name.split('.')[0]) && !(t.name.endsWith('.position') && !/pelvis|root/.test(t.name)) && !t.name.endsWith('.scale'));
  return (clipCache[k] = new THREE.AnimationClip(name + tag, c.duration, tracks));
}

export function buildCharacter(team, opts = {}) {
  const T = templ(); const L = TEAM_LOOK[team];
  const scene = SkeletonUtils.clone(T.scene); const B = boneMap(scene);
  const skin = !opts.arms && Math.random() < 0.5 ? A.skinLight : null;
  scene.traverse(o => { if (o.isSkinnedMesh && T.base && o.material.name === T.base.name) o.material = uniformMaterial(T.base, team, skin); if (o.isMesh) { o.castShadow = !opts.arms; o.receiveShadow = true; } });
  scene.updateMatrixWorld(true);
  const gear = {}; let skel = null; scene.traverse(o => { if (o.isSkinnedMesh && o.skeleton.bones.includes(B.spine_03) && (!skel || o.geometry.attributes.position.count > skel.geometry.attributes.position.count)) skel = o; });
  if (!opts.arms) {
    const hm = T.gearMat(L.helmet, 0.75, 'concrete_wall_006'); hm.normalScale.set(0.35, 0.35); hm.metalness = 0.05;
    const helmet = new THREE.Group(); const shell = new THREE.Mesh(T.helmetGeo, hm), rim = new THREE.Mesh(T.rimGeo, hm); rim.position.y = 0.005; helmet.add(shell, rim);
    const nvg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.025), T.gearMat(0x15171a, 0.5, 'metal_plate')); nvg.position.set(0, 0.04, 0.135); helmet.add(nvg);
    helmet.traverse(o => { if (o.isMesh) o.castShadow = true; }); attachAtBind(B.Head, helmet, 0, 1.735, -0.01, skel); gear.helmet = helmet;
    const vm = T.gearMat(L.vest, 0.9); const vest = new THREE.Group();
    const front = new THREE.Mesh(T.plateGeo, vm); front.position.set(0, 1.3, 0.115); const back = new THREE.Mesh(T.plateGeo, vm); back.position.set(0, 1.32, -0.128);
    const cum = new THREE.Mesh(T.cumGeo, vm); cum.position.set(0, 1.16, -0.015); vest.add(front, back, cum);
    for (const sx of [-1, 1]) { const st = new THREE.Mesh(T.strapGeo, vm); st.position.set(sx * 0.11, 1.475, -0.02); vest.add(st); }
    const pm = T.gearMat(new THREE.Color(L.vest).multiplyScalar(0.8).getHex(), 0.9); for (let i = -1; i <= 1; i++) { const p = new THREE.Mesh(T.pouchGeo, pm); p.position.set(i * 0.08, 1.21, 0.16); vest.add(p); }
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.01), new THREE.MeshStandardMaterial({ color: L.band, emissive: L.band, emissiveIntensity: 0.6, roughness: 0.6 })); patch.position.set(0, 1.4, 0.14); vest.add(patch);
    vest.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const vw = new THREE.Group(); attachAtBind(B.spine_03, vw, 0, 0, 0, skel); vw.add(vest); gear.vest = vest;
    const bm = new THREE.MeshStandardMaterial({ color: L.band, emissive: L.band, emissiveIntensity: 0.5, roughness: 0.7 });
    for (const [bn, x] of [['upperarm_l', 0.33], ['upperarm_r', -0.33]]) { const band = new THREE.Mesh(T.bandGeo, bm); attachAtBind(B[bn], band, x, 1.455, -0.068, skel); }
  }
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body); body.add(scene);
  const mixer = new THREE.AnimationMixer(scene); const actions = {};
  const act = (name, filterTag = 'full') => {
    const k = name + filterTag; if (actions[k]) return actions[k];
    const clip = filterTag === 'full' ? subClip(name, () => true, ':f') : filterTag === 'lower' ? subClip(name, n => LOWER.test(n), ':l') : subClip(name, n => !LOWER.test(n), ':u');
    const a = mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(0); a.play(); return (actions[k] = a);
  };
  const LOCO = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop'];
  for (const n of LOCO) act(n);
  for (const n of ['Fixing_Kneeling', 'Walk_Carry_Loop']) act(n);
  const death = mixer.clipAction(subClip('Death01', () => true, ':f')); death.setLoop(THREE.LoopOnce); death.clampWhenFinished = true;
  const lay = mixer.clipAction(subClip('LayToIdle', () => true, ':f')); lay.play(); lay.paused = true; lay.time = 0.02; lay.setEffectiveWeight(0);
  const gunHolder = new THREE.Group(); root.add(gunHolder);
  root.userData = { scene, body, B, mixer, actions, act, LOCO, death, lay, gunHolder, guns: {}, gunId: null, gear, w: {}, phase: 0, arms: !!opts.arms, recoil: 0, wasDead: false, state: '' };
  return root;
}

function gunFor(u, id) {
  if (u.gunId === id) return u.guns[id];
  for (const g of Object.values(u.guns)) g.visible = false;
  if (!id) { u.gunId = null; return null; }
  if (!u.guns[id]) { u.guns[id] = buildGun(id); u.gunHolder.add(u.guns[id]); if (u.arms) u.guns[id].traverse(o => { if (o.isMesh) o.castShadow = false; }); }
  u.guns[id].visible = true; u.gunId = id; return u.guns[id];
}

// rotate bone so that its child direction `from` (world) turns to `to` (world)
function rotateBoneWorld(bone, from, to) {
  const q = tq[0].setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  const wq = bone.getWorldQuaternion(tq[1]); const pq = bone.parent.getWorldQuaternion(tq[2]);
  bone.quaternion.copy(pq.invert().multiply(q.multiply(wq))); bone.updateMatrixWorld(true);
}
function setBoneWorldQuat(bone, q) { const pq = bone.parent.getWorldQuaternion(tq[2]); bone.quaternion.copy(pq.invert().multiply(q)); bone.updateMatrixWorld(true); }
function ik2(up, lo, hand, target, pole) {
  const a = up.getWorldPosition(V()), b = lo.getWorldPosition(V()), c = hand.getWorldPosition(V());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c); const at = target.clone().sub(a); let d = at.length(); d = Math.min(Math.max(d, 0.05), (l1 + l2) * 0.999);
  const dir = at.normalize(); const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pp = pole.clone().sub(a); pp.sub(dir.clone().multiplyScalar(pp.dot(dir))).normalize();
  const elbow = a.clone().add(dir.clone().multiplyScalar(cosA * l1)).add(pp.multiplyScalar(sinA * l1));
  rotateBoneWorld(up, b.clone().sub(a), elbow.clone().sub(a));
  const b2 = lo.getWorldPosition(V()), c2 = hand.getWorldPosition(V()); const tgt = a.clone().add(dir.multiplyScalar(d));
  rotateBoneWorld(lo, c2.sub(b2), tgt.sub(b2));
}
// orientation for a hand: along = where fingers point, palm = palm normal (world). Bind: right along -x palm -y, left along +x palm -y.
const basisQ = (along, palm) => { const x = along.clone().normalize(), y = palm.clone().normalize(); const z = V().crossVectors(x, y).normalize(); y.crossVectors(z, x); return new THREE.Quaternion().setFromRotationMatrix(tm.makeBasis(x, y, z)); };
const BIND_BASIS = { r: basisQ(V(-1, 0, 0), V(0, -1, 0)), l: basisQ(V(1, 0, 0), V(0, -1, 0)) };
function orientHand(u, side, along, palm) {
  const T = TPL, bone = u.B['hand_' + side];
  const q = basisQ(along, palm).multiply(BIND_BASIS[side].clone().invert()).multiply(T.bindQ['hand_' + side]);
  setBoneWorldQuat(bone, q); // along/palm are world vectors, so q is already the world orientation
}

// s: {speed, crouch, downed, dead, pitch, helmet, armor, weapon, shotAge, reload, kneel, dragging, sprint, dt}
export function poseCharacter(root, dt, s) {
  const u = root.userData; const w = u.w;
  if (u.gear.helmet) u.gear.helmet.visible = !!s.helmet; if (u.gear.vest) u.gear.vest.visible = !!s.armor;
  let mode = s.dead ? 'dead' : s.downed ? 'downed' : s.kneel ? 'kneel' : s.dragging ? 'drag' : 'loco';
  // target weights
  const tgt = {}; for (const n of u.LOCO) tgt[n] = 0; tgt.Fixing_Kneeling = 0; tgt.Walk_Carry_Loop = 0;
  if (mode === 'loco') {
    const sp = s.speed, c = s.crouch > 0.5;
    if (c) { const k = Math.min(1, sp / 1.4); tgt.Crouch_Idle_Loop = 1 - k; tgt.Crouch_Fwd_Loop = k; }
    else if (s.sprint && sp > 3) tgt.Sprint_Loop = 1;
    else if (sp < 0.3) tgt.Idle_Loop = 1;
    else if (sp < 2.4) { const k = Math.min(1, sp / 1.6); tgt.Idle_Loop = 1 - k; tgt.Walk_Loop = k; }
    else { const k = Math.min(1, (sp - 2.4) / 1.4); tgt.Walk_Loop = 1 - k; tgt.Jog_Fwd_Loop = k; }
    // scale playback so feet roughly match ground speed
    const ts = c ? Math.max(0.6, sp / 1.2) : sp < 2.4 ? Math.max(0.8, sp / 1.4) : Math.max(0.85, sp / 4.2);
    for (const n of u.LOCO) u.act(n).timeScale = ts;
  } else if (mode === 'kneel') tgt.Fixing_Kneeling = 1; else if (mode === 'drag') tgt.Walk_Carry_Loop = 1;
  const k = Math.min(1, dt * 10);
  for (const [n, t] of Object.entries(tgt)) { const a = u.act(n); w[n] = (w[n] ?? 0) + (t - (w[n] ?? 0)) * k; a.setEffectiveWeight(mode === 'dead' || mode === 'downed' ? 0 : w[n]); }
  if (mode === 'dead') { if (!u.wasDead) { u.death.reset(); u.death.setEffectiveWeight(1); u.death.play(); u.wasDead = true; } u.lay.setEffectiveWeight(0); }
  else { if (u.wasDead) { u.death.stop(); u.wasDead = false; } u.lay.setEffectiveWeight(mode === 'downed' ? 1 : 0); }
  u.mixer.update(dt);
  u.body.position.set(0, 0, 0); u.body.rotation.set(0, 0, 0);
  if (mode === 'downed') { // lying on the back, head behind the feet (matches the downed hitboxes), crawling = small kicks
    u.phase += dt * Math.max(0.3, s.speed) * 5; const sw = Math.sin(u.phase) * Math.min(1, s.speed * 1.5);
    u.body.rotation.x = 0; u.body.position.z = 0;
    const B = u.B; B.thigh_l.rotateX(sw * 0.25); B.thigh_r.rotateX(-sw * 0.25); B.spine_02.rotateY(sw * 0.05);
  }
  root.updateMatrixWorld(true);
  const armed = mode === 'loco' && s.weapon && !s.noGun;
  const gun = gunFor(u, armed || u.arms ? s.weapon : null);
  if (!armed || !gun) return;
  // pitch: bend the spine and head
  const B = u.B, pitch = s.pitch || 0;
  const side = V(1, 0, 0).applyQuaternion(root.getWorldQuaternion(tq[0])).normalize();
  for (const [bn, f] of [['spine_02', 0.25], ['spine_03', 0.3], ['neck_01', 0.2], ['Head', 0.25]]) { const b = B[bn]; const q = new THREE.Quaternion().setFromAxisAngle(side, -pitch * f); const wq = b.getWorldQuaternion(new THREE.Quaternion()); setBoneWorldQuat(b, q.multiply(wq)); }
  root.updateMatrixWorld(true);
  placeGunAndArms(u, root, gun, s, pitch);
}

function placeGunAndArms(u, root, gun, s, pitch) {
  const B = u.B, rifle = s.weapon === 'ak' || s.weapon === 'm4';
  const rq = root.getWorldQuaternion(new THREE.Quaternion());
  const fwd = V(0, Math.sin(pitch), Math.cos(pitch)).applyQuaternion(rq), up = V(0, Math.cos(pitch), -Math.sin(pitch)).applyQuaternion(rq), left = V(1, 0, 0).applyQuaternion(rq);
  let aim = fwd.clone(), aup = up.clone();
  if (s.sprint && s.speed > 3) { aim.add(up.clone().multiplyScalar(-0.9)).add(left.clone().multiplyScalar(0.5)).normalize(); aup = up.clone().add(fwd.clone().multiplyScalar(0.6)).normalize(); }
  u.recoil = Math.max(0, (u.recoil || 0) - (s.dt || 0.016) * 8); if (s.shotAge !== undefined && s.shotAge < 0.02) u.recoil = Math.min(1, u.recoil + 0.6);
  const reload = s.reload || 0;
  let gp;
  if (u.arms) { gp = V(0, 0, 0); gun.position.set(0, 0, 0); gun.quaternion.identity(); }
  else {
    const sh = B.upperarm_r.getWorldPosition(V()), neck = B.neck_01.getWorldPosition(V());
    if (rifle) {
      // butt in the right shoulder pocket, gun along the aim
      const pocket = sh.clone().add(left.clone().multiplyScalar(0.07)).add(up.clone().multiplyScalar(-0.03)).add(fwd.clone().multiplyScalar(0.05));
      const m = tm.makeBasis(V().crossVectors(aup, aim.clone().negate()).normalize(), aup, aim.clone().negate()); const gq = new THREE.Quaternion().setFromRotationMatrix(m);
      gp = pocket.clone().sub(gun.userData.butt.clone().applyQuaternion(gq)).add(aim.clone().multiplyScalar(-u.recoil * 0.04));
      setWorld(gun, gp, gq);
    } else {
      const m = tm.makeBasis(V().crossVectors(aup, aim.clone().negate()).normalize(), aup, aim.clone().negate()); const gq = new THREE.Quaternion().setFromRotationMatrix(m);
      gp = neck.clone().add(aim.clone().multiplyScalar(0.42 - u.recoil * 0.05)).add(up.clone().multiplyScalar(-0.14)).add(left.clone().multiplyScalar(0.02));
      setWorld(gun, gp, gq);
    }
    if (reload > 0) { gun.rotateZ(0.6 * Math.min(1, reload * 4)); gun.rotateX(-0.25 * Math.min(1, reload * 4)); }
  }
  gun.updateMatrixWorld(true);
  const gq = gun.getWorldQuaternion(new THREE.Quaternion()), gpos = gun.getWorldPosition(V());
  const gF = V(0, 0, -1).applyQuaternion(gq), gU = V(0, 1, 0).applyQuaternion(gq), gL = V(-1, 0, 0).applyQuaternion(gq); // gun-left = character left
  // right hand: wrist behind/below the grip, fingers forward-down around the grip, palm to the left
  const rAlong = gF.clone().multiplyScalar(0.55).add(gU.clone().multiplyScalar(-0.83)).normalize();
  const rWrist = gpos.clone().add(rAlong.clone().multiplyScalar(-0.075)).add(gL.clone().multiplyScalar(-0.028));
  const ePoleR = gpos.clone().add(gL.clone().multiplyScalar(-0.6)).add(gU.clone().multiplyScalar(-0.5));
  ik2(B.upperarm_r, B.lowerarm_r, B.hand_r, rWrist, ePoleR);
  orientHand(u, 'r', rAlong, gL);
  // left hand
  let fore = gun.userData.fore.clone().applyQuaternion(gq).add(gpos), lAlong, lPalm;
  if (rifle) { lAlong = gF.clone().multiplyScalar(0.8).add(gL.clone().multiplyScalar(-0.45)).add(gU.clone().multiplyScalar(-0.25)).normalize(); lPalm = gU.clone().multiplyScalar(0.85).add(gL.clone().multiplyScalar(-0.5)).normalize(); fore.add(gU.clone().multiplyScalar(-0.025)); }
  else { lAlong = gF.clone().multiplyScalar(0.5).add(gU.clone().multiplyScalar(-0.6)).add(gL.clone().multiplyScalar(-0.3)).normalize(); lPalm = gL.clone().multiplyScalar(-1).add(gU.clone().multiplyScalar(0.2)).normalize(); fore.add(gL.clone().multiplyScalar(0.03)); }
  if (reload > 0) { const r = Math.min(1, reload * 3); fore = fore.lerp(gpos.clone().add(gU.clone().multiplyScalar(-0.25)).add(gF.clone().multiplyScalar(-0.1)), Math.sin(r * Math.PI)); }
  const lWrist = fore.clone().add(lAlong.clone().multiplyScalar(-0.07)).add(lPalm.clone().multiplyScalar(-0.03));
  const ePoleL = gpos.clone().add(gL.clone().multiplyScalar(0.6)).add(gU.clone().multiplyScalar(-0.6));
  ik2(B.upperarm_l, B.lowerarm_l, B.hand_l, lWrist, ePoleL);
  orientHand(u, 'l', lAlong, lPalm);
  // finger grip
  for (const [n, q] of Object.entries(TPL.grip)) { const b = B[n]; if (b) b.quaternion.copy(q); }
}
function setWorld(obj, p, q) { const parent = obj.parent; parent.updateMatrixWorld(true); const inv = tm.copy(parent.matrixWorld).invert(); obj.position.copy(p).applyMatrix4(inv); const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert(); obj.quaternion.copy(pq.multiply(q)); }

// ---------------------------------------------------------------- first-person view models
// The gun sits at the group origin (grip), the arms are the soldier rig with everything but sleeves/gloves discarded.
export const VM_OFFSET = { rifle: [0.135, -0.145, -0.42], pistol: [0.12, -0.15, -0.5] }; // view model grip position in camera space
export function buildViewModel(id, team = 'atk') {
  const g = new THREE.Group(); const rig = buildCharacter(team, { arms: true }); const u = rig.userData;
  rig.traverse(o => { if (o.isSkinnedMesh && o.material.userData && o.material.userData.U) { o.material.userData.U.uArmsOnly.value = 1; } if (o.isMesh && !o.isSkinnedMesh) o.visible = false; });
  u.scene.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && !o.parent?.isBone) o.visible = false; if (o.name === 'Eyes' || o.name === 'Eyebrows') o.visible = false; });
  const rifle = id === 'ak' || id === 'm4';
  // eye of the rig must end up at the camera: camera is at (-x0,-y0,-z0) relative to the grip (see player.js base offsets)
  const o = VM_OFFSET[rifle ? 'rifle' : 'pistol'], eye = V(-o[0], -o[1], -o[2]);
  u.act('Idle_Loop').setEffectiveWeight(1); u.mixer.update(0.01);
  rig.rotation.y = Math.PI - (rifle ? 0.55 : 0.15); rig.scale.setScalar(1.1); g.add(rig); rig.updateMatrixWorld(true);
  const shR = u.B.upperarm_r.getWorldPosition(V()); rig.position.add(V(eye.x + (rifle ? 0.17 : 0.2), eye.y - 0.27, eye.z + (rifle ? 0.0 : -0.05)).sub(shR));
  const gun = gunFor(u, id); gun.removeFromParent(); g.add(gun); u.gunHolder = g; if (!rifle) { gun.scale.setScalar(1.3); gun.userData.fore.multiplyScalar(1.3); gun.userData.muzzle = gun.userData.muzzle.clone().multiplyScalar(1.3); }
  g.userData = { gun, muzzleZ: gun.userData.muzzle.z, rig, id, rifle };
  g.userData.pose = (dt, s) => { g.updateWorldMatrix(true, true); u.mixer.update(0); placeGunAndArms(u, rig, gun, { weapon: id, dt, reload: s.reload, shotAge: 1 }, 0); };
  return g;
}
export function buildNadeModel(kind) {
  const g = new THREE.Group(); const col = kind === 'frag' ? 0x4a5a3a : kind === 'smoke' ? 0x7a7f86 : 0x9aa0a8;
  const m = new THREE.Mesh(kind === 'frag' ? new THREE.SphereGeometry(0.045, 16, 12) : new THREE.CylinderGeometry(0.035, 0.035, 0.12, 16), new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.4 })); g.add(m);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0xa5abb2, metalness: 0.9, roughness: 0.35 })); lever.position.set(0.02, 0.06, 0); g.add(lever);
  g.userData = { gun: g, muzzleZ: 0 }; return g;
}
export function buildBombModel() {
  const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.18), pbrMat('painted_metal_shutter', { color: 0x6a6f52, roughness: 0.9, metalness: 0.3 })); g.add(body);
  for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0xb8a77a, roughness: 0.8 })); st.rotation.z = Math.PI / 2; st.position.set(0, 0.07, -0.05 + i * 0.05); g.add(st); }
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.07), new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.4 })); pad.position.set(0.05, 0.1, 0); g.add(pad);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 })); led.position.set(-0.08, 0.1, 0.05); g.add(led);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); g.userData = { led }; return g;
}
export const NADE_MESH = kind => { const m = new THREE.Mesh(kind === 'frag' ? new THREE.SphereGeometry(0.06, 14, 10) : new THREE.CylinderGeometry(0.045, 0.045, 0.14, 14), new THREE.MeshStandardMaterial({ color: kind === 'frag' ? 0x4a5a3a : kind === 'smoke' ? 0x7a7f86 : 0xc5cad0, roughness: 0.55, metalness: 0.35 })); m.castShadow = true; return m; };
