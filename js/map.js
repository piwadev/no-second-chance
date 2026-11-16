// Warehouse 01 — the prototype map. Gameplay geometry is a set of AABB colliders (cover, walls, nav grid);
// what you see is PBR-textured architecture plus real glTF props fitted into those boxes (see CREDITS.md).
import * as THREE from './vendor/three.module.js';
import { COLORS } from './config.js';
import { A, pbrMat, fitModel } from './assets.js';

export const BOUNDS = { x0: -44, x1: 44, z0: -40, z1: 40 };
export const SITES = {
  A: { name: 'A', x0: -34, x1: -20, z0: -34, z1: -18, cx: -27, cz: -26 },
  B: { name: 'B', x0: 20, x1: 34, z0: -34, z1: -18, cx: 27, cz: -26 },
};
export const SPAWNS = {
  atk: [[-6, 33], [-3, 35.5], [0, 33], [3, 35.5], [6, 33]],
  def: [[-6, -34], [-3, -36.5], [0, -34], [3, -36.5], [6, -34]],
};
export const HOLDS = {
  A: [[-16.5, -21], [-31, -36], [-23.5, -31], [-40, -21], [-15.5, -29.5]],
  B: [[16.5, -21], [31, -36], [23.5, -31], [40, -21], [15.5, -29.5]],
  mid: [[0, -17], [-9.5, -24], [9.5, -24]],
};
export const ROUTES = { // attacker approach via-points per site
  A: [[[-37, 20], [-37, -6]], [[-20, 18], [-19.5, -6]], [[0, 18], [0, -6], [0, -20], [-9, -29]]],
  B: [[[37, 20], [37, -6]], [[19.5, 18], [19.5, -6]], [[0, 18], [0, -6], [0, -20], [9, -29]]],
};
export const AREAS = [ // callouts for HUD/team status
  ['A Site', -44, -12, -40, -12], ['B Site', 12, 44, -40, -12], ['Defender Spawn', -12, 12, -40, -12],
  ['A Long', -44, -30, -12, 26], ['Shelving', -30, -8, -12, 26], ['Mid', -8, 8, -12, 26], ['Container Yard', 8, 30, -12, 26],
  ['B Long', 30, 44, -12, 26], ['Attacker Spawn', -44, 44, 26, 40],
];
export function areaName(x, z) { for (const a of AREAS) if (x >= a[1] && x <= a[2] && z >= a[3] && z <= a[4]) return a[0]; return 'Warehouse'; }

// ------------------------------------------------------------------ procedural textures
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; return t;
}
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function noise(g, s, n, a, col) { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${col},${rnd() * a})`; const w = 1 + rnd() * 3; g.fillRect(rnd() * s, rnd() * s, w, w); } }
const TEX = {};
function makeTextures() {
  TEX.hazard = canvasTex(128, (g, s) => { g.fillStyle = '#d5a64a'; g.fillRect(0, 0, s, s); g.fillStyle = '#171a1d'; for (let i = -s; i < s * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - s, s); g.lineTo(i - s, s); g.fill(); } });
}
// soft additive light shaft (skylight beams through dusty air)
const SHAFT_MAT = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uCol: { value: new THREE.Color(1.0, 0.93, 0.8) }, uI: { value: 0.012 } },
  vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: 'uniform vec3 uCol; uniform float uI; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float h = smoothstep(0.0, 0.35, vUv.y) * (0.35 + 0.65 * vUv.y); gl_FragColor = vec4(uCol * uI * edge * h, 1.0); }',
});

function siteTexture(letter) {
  return canvasTex(512, (g, s) => {
    g.clearRect(0, 0, s, s); g.strokeStyle = 'rgba(213,166,74,.85)'; g.lineWidth = 10; g.setLineDash([36, 18]); g.strokeRect(10, 10, s - 20, s - 20);
    g.setLineDash([]); g.fillStyle = 'rgba(213,166,74,.75)'; g.font = '900 260px "Barlow Condensed", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, s / 2, s / 2 + 10);
  }, false);
}
function signTexture(text) {
  return canvasTex(512, (g) => {
    g.fillStyle = '#171a1d'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#d5a64a'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 118, 512, 10);
    g.fillStyle = '#e7e9eb'; g.font = '800 64px "Barlow Condensed", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 66);
  }, false);
}

// box geometry with world-scaled UVs so textures tile instead of stretching
function boxGeo(sx, sy, sz, scale = 2) {
  const geo = new THREE.BoxGeometry(sx, sy, sz); const uv = geo.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / scale, uv.getY(i) * dims[f][1] / scale); }
  return geo;
}

export class WarehouseMap {
  constructor(scene) {
    this.scene = scene; this.colliders = []; this.meshes = []; this.lamps = [];
    makeTextures();
    const floor = pbrMat('concrete_floor_worn_001', { color: 0xb8b4ae, normal: 1 });
    this.mats = {
      floor,
      wall: pbrMat('concrete_wall_006', { color: 0xc9c6c0, normal: 0.8, metalness: 0 }),
      outer: pbrMat('corrugated_iron_02', { color: 0x9aa6b0, metalness: 0.6, roughness: 1 }),
      metal: pbrMat('metal_plate', { color: 0x8a9096, metalness: 0.8 }),
      shutter: pbrMat('painted_metal_shutter', { color: 0xd0d4d8 }),
      hazard: new THREE.MeshStandardMaterial({ map: TEX.hazard, roughness: 0.7 }),
      ceiling: pbrMat('box_profile_metal_sheet', { color: 0x4a5058, metalness: 0.7 }),
      beam: pbrMat('rusty_metal_02', { color: 0x9a8a7a, metalness: 0.7 }),
    };
    this.shelfLevels = [0.052, 0.292, 0.532, 0.768];
    this.containerTints = [0xffffff, 0x6fa0a6, 0x8a9098, 0xe0b060, 0x8fb070, 0xb06060];
    this.build(); this.buildNav();
  }

  // ---- primitives
  box(cx, cz, sx, sz, h, mat, y0 = 0, opts = {}) {
    const m = new THREE.Mesh(boxGeo(sx, h, sz, opts.uv || 2), mat); m.position.set(cx, y0 + h / 2, cz);
    m.castShadow = opts.shadow !== false; m.receiveShadow = true; this.scene.add(m); this.meshes.push(m);
    if (opts.collide !== false) this.colliders.push({ min: [cx - sx / 2, y0, cz - sz / 2], max: [cx + sx / 2, y0 + h, cz + sz / 2], kind: opts.kind || 'solid', barrier: !!opts.barrier });
    return m;
  }
  wallX(x, z0, z1, gaps = [], h = 5.5, t = 0.6) { this.wallRun('x', x, z0, z1, gaps, h, t); }
  wallZ(z, x0, x1, gaps = [], h = 5.5, t = 0.6) { this.wallRun('z', z, x0, x1, gaps, h, t); }
  wallRun(axis, c, a0, a1, gaps, h, t) {
    const segs = []; let s = a0; for (const [g0, g1] of gaps.sort((p, q) => p[0] - q[0])) { if (g0 > s) segs.push([s, g0]); s = g1; } if (s < a1) segs.push([s, a1]);
    const put = (p0, p1, y0, hh, mat, opts) => { const L = p1 - p0, m = (p0 + p1) / 2; if (axis === 'x') this.box(c, m, t, L, hh, mat, y0, opts); else this.box(m, c, L, t, hh, mat, y0, opts); };
    for (const [p0, p1] of segs) put(p0, p1, 0, h, this.mats.wall, {});
    for (const [g0, g1] of gaps) { put(g0, g1, 3.2, h - 3.2, this.mats.wall, {}); put(g0, g1, 3.0, 0.2, this.mats.hazard, { uv: 1 }); }
  }
  solid(cx, cz, sx, sz, h, y0 = 0) { this.colliders.push({ min: [cx - sx / 2, y0, cz - sz / 2], max: [cx + sx / 2, y0 + h, cz + sz / 2], kind: 'solid', barrier: false }); }
  put(obj, x, y, z, rotY = 0) { obj.position.set(x, y, z); obj.rotation.y = rotY; this.scene.add(obj); return obj; }
  container(cx, cz, alongZ, colorIdx, y0 = 0) {
    const sx = alongZ ? 2.44 : 6.1, sz = alongZ ? 6.1 : 2.44; this.solid(cx, cz, sx, sz, 2.6, y0);
    this.put(fitModel('container', sx, 2.6, sz, { rotY: alongZ ? 0 : Math.PI / 2, tint: this.containerTints[colorIdx % 6] }), cx, y0, cz);
  }
  // 1.2 m cover cube: a stack of real crates / boxes filling the collider
  crate(cx, cz, s = 1.2, stack = 1, y0 = 0) {
    this.solid(cx, cz, s, s, s * stack, y0);
    const H = s * stack; const kind = Math.floor(Math.abs(Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453)) % 3;
    const jit = () => (rnd() - 0.5) * 0.06;
    if (kind === 0) { // military crates, 2 per layer, crossing layers
      const n = Math.round(H / 0.4), lh = H / n;
      for (let i = 0; i < n; i++) for (const k of [-1, 1]) { const rot = i % 2 ? Math.PI / 2 : 0; const ox = i % 2 ? k * s / 4 : 0, oz = i % 2 ? 0 : k * s / 4;
        this.put(fitModel('milcrate', i % 2 ? s / 2 : s, lh, i % 2 ? s : s / 2, { rotY: rot }), cx + ox, y0 + i * lh, cz + oz, jit()); }
    } else if (kind === 1) { // long wooden crates
      const n = Math.round(H / 0.6), lh = H / n;
      for (let i = 0; i < n; i++) for (const k of [-1, 1]) { const alongX = i % 2 === 1; const ox = alongX ? 0 : k * s / 4, oz = alongX ? k * s / 4 : 0;
        this.put(fitModel('crate2', alongX ? s : s / 2, lh, alongX ? s / 2 : s, { rotY: alongX ? Math.PI / 2 : 0 }), cx + ox, y0 + i * lh, cz + oz, jit()); }
    } else { // pallet of cardboard boxes per 1.2 m level
      for (let lv = 0; lv < stack; lv++) { const by = y0 + lv * s; this.put(fitModel('pallet', s, 0.14, s), cx, by, cz);
        const n = 3, lh = (s - 0.14) / n; for (let i = 0; i < n; i++) for (const a of [-1, 1]) for (const b of [-1, 1]) this.put(fitModel('cardboard', s / 2 - 0.02, lh, s / 2 - 0.02, { rotY: (i + a + b) % 2 ? Math.PI / 2 : 0 }), cx + a * s / 4, by + 0.14 + i * lh, cz + b * s / 4, jit()); }
    }
  }
  pallet(cx, cz, sx, sz, h) { // wrapped pallet load: pallet + boxes
    this.solid(cx, cz, sx, sz, h); this.put(fitModel('pallet', sx, 0.15, sz), cx, 0, cz);
    const nx = Math.max(1, Math.round(sx / 0.55)), nz = Math.max(1, Math.round(sz / 0.45)), ny = Math.max(1, Math.round((h - 0.15) / 0.36));
    const bx = sx * 0.96 / nx, bz = sz * 0.96 / nz, by = (h - 0.15) / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) for (let k = 0; k < ny; k++) this.put(fitModel(k % 2 ? 'cardboard' : 'plcrate', bx - 0.02, by, bz - 0.02), cx - sx * 0.48 + bx * (i + 0.5), 0.15 + k * by, cz - sz * 0.48 + bz * (j + 0.5), (rnd() - 0.5) * 0.05);
  }
  rack(x, z0, z1) { // double-sided steel shelving, two tiers high, with stock
    const L = z1 - z0, w = 1.3, H = 3.8; this.colliders.push({ min: [x - w / 2, 0, z0], max: [x + w / 2, H, z1], kind: 'solid' });
    const n = Math.max(1, Math.round(L / 2.2)), ul = L / n, th = H / 2;
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) for (let t = 0; t < 2; t++) {
      const zc = z0 + ul * (i + 0.5); this.put(fitModel('shelves1', w / 2, th, ul, { rotY: Math.PI / 2 }), x + side * w / 4, t * th, zc);
      for (const lv of this.shelfLevels) { if (rnd() < 0.3) continue; const y = t * th + lv * th + 0.012; const key = rnd() < 0.5 ? 'cardboard' : rnd() < 0.5 ? 'plcrate' : 'milcrate';
        const bw = ul * (0.3 + rnd() * 0.25); this.put(fitModel(key, w / 2 - 0.12, th * 0.17, bw, { rotY: Math.PI / 2 }), x + side * w / 4, y, zc + (rnd() - 0.5) * (ul - bw) * 0.8, (rnd() - 0.5) * 0.1); }
    }
    const p = new THREE.Mesh(boxGeo(0.04, H, L, 2), this.mats.metal); p.position.set(x, H / 2, (z0 + z1) / 2); p.castShadow = p.receiveShadow = true; this.scene.add(p);
  }
  lamp(x, z, intensity = 22, withLight = true) {
    this.put(fitModel('lamp', 0.75, 1.25, 0.75, { uniform: true, shadow: false }), x, 9 - 1.25, z);
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), new THREE.MeshBasicMaterial({ color: withLight ? new THREE.Color(9, 7.6, 5.6) : new THREE.Color(0.25, 0.22, 0.18), fog: false }));
    b.rotation.x = Math.PI / 2; b.position.set(x, 9 - 1.2, z); this.scene.add(b);
    if (withLight) { const l = new THREE.PointLight(0xffe2b0, intensity, 32, 1.7); l.position.set(x, 9 - 1.45, z); this.scene.add(l); this.lamps.push(l); }
  }
  decor(key, x, z, sx, sy, sz, rotY = 0, collide = false, y0 = 0) { if (collide) this.solid(x, z, Math.max(sx, sz), Math.max(sx, sz), sy, y0); return this.put(fitModel(key, sx, sy, sz, { uniform: true }), x, y0, z, rotY); }
  sign(text, x, y, z, rotY) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: signTexture(text), transparent: false })); m.position.set(x, y, z); m.rotation.y = rotY; this.scene.add(m); }

  build() {
    const B = BOUNDS, W = B.x1 - B.x0, D = B.z1 - B.z0;
    // floor + ceiling
    const fl = new THREE.Mesh(boxGeo(W, 0.2, D, 4), this.mats.floor); fl.position.set(0, -0.1, 0); fl.receiveShadow = true; this.scene.add(fl);
    this.colliders.push({ min: [B.x0, -1, B.z0], max: [B.x1, 0, B.z1], kind: 'floor' });
    const ce = new THREE.Mesh(boxGeo(W, 0.1, D, 3), this.mats.ceiling); ce.position.y = 9.05; this.scene.add(ce);
    for (let x = -36; x <= 36; x += 12) { const beam = new THREE.Mesh(boxGeo(0.4, 0.6, D, 2), this.mats.beam); beam.position.set(x, 8.7, 0); beam.castShadow = true; this.scene.add(beam); }
    for (let z = -32; z <= 32; z += 16) { const beam = new THREE.Mesh(boxGeo(W, 0.35, 0.3, 2), this.mats.beam); beam.position.set(0, 8.55, z); this.scene.add(beam); }
    // outer walls
    const T = 1, H = 9;
    this.box(0, B.z0 - T / 2, W + 2 * T, T, H, this.mats.outer, 0, { uv: 3 }); this.box(0, B.z1 + T / 2, W + 2 * T, T, H, this.mats.outer, 0, { uv: 3 });
    this.box(B.x0 - T / 2, 0, T, D, H, this.mats.outer, 0, { uv: 3 }); this.box(B.x1 + T / 2, 0, T, D, H, this.mats.outer, 0, { uv: 3 });
    // interior walls (gaps are doorways)
    this.wallZ(-12, -44, -12, [[-43.6, -37.4], [-21, -17.6]]);
    this.wallZ(-12, -12, 12, [[-3, 3]]);
    this.wallZ(-12, 12, 44, [[17.6, 21], [37.4, 43.6]]);
    this.wallX(-12, -40, -12, [[-31.2, -27.2]]);
    this.wallX(12, -40, -12, [[-31.2, -27.2]]);
    this.wallX(-30, -12, 26, [[4, 7.6]]);
    this.wallX(30, -12, 26, [[4, 7.6]]);
    this.wallX(-8, -12, 26, [[10, 13.6]]);
    this.wallX(8, -12, 26, [[-2, 1.6]]);
    this.wallZ(26, -30, 30, [[-20, -16.4], [-3, 3], [16.4, 20]]);
    // attacker prep barrier (only blocks attackers during preparation)
    this.colliders.push({ min: [-44, 0, 25.4], max: [44, 4, 25.8], kind: 'barrier', barrier: true });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(88, 2.2, 0.05), new THREE.MeshBasicMaterial({ color: 0xd5a64a, transparent: true, opacity: 0.18, depthWrite: false })); bar.position.set(0, 1.1, 25.6); this.scene.add(bar); this.barrierMesh = bar;

    // ---- A site
    this.container(-37, -30, true, 0); this.container(-37, -30, true, 3, 2.6);
    this.crate(-26.5, -22, 1.2, 2); this.crate(-25.3, -22, 1.2, 1); this.pallet(-29.5, -31, 2.2, 1.4, 1.25);
    this.container(-21, -36.5, false, 2); this.crate(-16.5, -19.6, 1.2, 1); this.crate(-40.5, -16.5, 1.2, 1); this.crate(-15.3, -33, 1.2, 2);
    this.barrier(-32, -25);
    // ---- B site
    this.container(37, -30, true, 1); this.crate(36.6, -26, 1.2, 2);
    this.crate(26.5, -22, 1.2, 2); this.crate(27.7, -22.4, 1.2, 1); this.pallet(29.5, -31, 2.2, 1.4, 1.25);
    this.container(21, -36.5, false, 4); this.crate(16.5, -19.6, 1.2, 1); this.crate(40.5, -16.5, 1.2, 1); this.crate(15.3, -33, 1.2, 2);
    this.barrier(32, -25);
    // ---- defender spawn
    this.crate(-6, -20, 1.2, 1); this.crate(5, -22, 1.2, 2); this.box(0, -29, 2.2, 3.4, 1.7, this.mats.shutter, 0, { uv: 1.7 }); this.decor('medbox', -0.4, -28.2, 0.55, 0.12, 0.38, 0.3, false, 1.7); this.decor('ammobox', 0.5, -29.6, 0.1, 0.2, 0.28, 0.2, false, 1.7); this.decor('toolbox', 0.2, -30.3, 0.4, 0.3, 0.28, -0.4, false, 1.7); this.crate(-4.5, -26, 1.2, 1); this.crate(4.5, -16.5, 1.2, 1);
    // ---- mid
    this.container(-3.4, 6, true, 2); this.container(3.6, 15, true, 5); this.container(0, -4, false, 3); this.crate(5.6, -8.5, 1.2, 1); this.crate(-4.5, 19.5, 1.2, 1); this.crate(-5.8, -8, 1.2, 2);
    // ---- shelving
    this.rack(-25.8, -9, 1); this.rack(-25.8, 10.5, 22); this.rack(-14.2, -9, 1); this.rack(-14.2, 10.5, 22);
    this.crate(-20, -4, 1.2, 2); this.pallet(-18.5, 15, 2.2, 1.4, 1.25); this.crate(-21.5, 6, 1.2, 1); this.crate(-11, 5.5, 1.2, 1);
    // ---- container yard
    this.container(14, -6, false, 0); this.container(24, 0, true, 3); this.container(14, 10, true, 1); this.container(14, 10, true, 4, 2.6);
    this.container(22.5, 16.5, false, 5); this.crate(19.5, 5.5, 1.2, 1); this.crate(26.5, -8, 1.2, 1); this.crate(10, 22, 1.2, 2);
    // ---- longs
    this.container(-40.5, -2, true, 4); this.crate(-36.5, 10, 1.2, 1); this.crate(-34, 18, 1.2, 2); this.crate(-32.5, -8, 1.2, 1);
    this.container(39.5, 12, true, 2); this.crate(34.5, 0, 1.2, 1); this.crate(38, 21, 1.2, 2); this.crate(32.5, -8, 1.2, 1);
    // ---- attacker spawn
    this.crate(-12, 31, 1.2, 1); this.crate(12, 31, 1.2, 1); this.solid(0, 38.2, 9, 2.6, 3.2); this.put(fitModel('container', 9, 3.2, 2.6, { rotY: Math.PI / 2, tint: 0x8a9098 }), 0, 0, 38.2); this.crate(-24, 33, 1.2, 2); this.crate(24, 33, 1.2, 2);

    // site floor markings
    for (const s of Object.values(SITES)) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.x1 - s.x0, s.z1 - s.z0), new THREE.MeshBasicMaterial({ map: siteTexture(s.name), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.rotation.x = -Math.PI / 2; m.position.set(s.cx, 0.01, s.cz); this.scene.add(m);
    }
    this.sign('A SITE ←', -24, 4.4, -11.65, 0); this.sign('→ B SITE', 24, 4.4, -11.65, 0); this.sign('MID', 0, 4.4, 25.65, 0); this.sign('A LONG', -37, 4.4, 25.9, Math.PI); this.sign('B LONG', 37, 4.4, 25.9, Math.PI);
    this.sign('A', -12.35, 4.2, -29, -Math.PI / 2); this.sign('B', 12.35, 4.2, -29, Math.PI / 2);

    this.decorate();
    // lighting: soft sky fill + sun through the roof skylights (shadowed) + hanging sodium-ish lamps
    this.scene.add(new THREE.HemisphereLight(0xb8c6d4, 0x2a2622, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0dc, 3.2); sun.position.set(30, 60, 18); sun.target.position.set(0, 0, 0);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -50; sc.right = 50; sc.top = 46; sc.bottom = -46; sc.near = 1; sc.far = 140; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3; sun.shadow.blurSamples = 12;
    this.scene.add(sun, sun.target); this.sun = sun;
    for (const [x, z] of [[-27, -26], [27, -26], [0, -30], [-37, 6], [37, 6], [-20, 6], [20, 6], [0, 8], [0, 33], [-30, 33], [30, 33]]) this.lamp(x, z, 300, true);
    for (const [x, z] of [[-37, -6], [37, -6], [-20, -6], [20, -6], [0, -6], [-20, 18], [20, 18], [-37, 18], [37, 18], [-36, -34], [36, -34]]) this.lamp(x, z, 0, false);
    // skylights: glowing roof panels + dusty light shafts along the sun direction
    const sd = sun.position.clone().normalize(), skyM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 2.7), fog: false });
    for (const x of [-30, -18, -6, 6, 18, 30]) for (const z of [-24, 0, 24]) {
      const pan = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 7), skyM); pan.rotation.x = Math.PI / 2; pan.position.set(x, 8.99, z); this.scene.add(pan);
      const len = 9 / sd.y, shaft = new THREE.Mesh(new THREE.BoxGeometry(2.6, len, 6), SHAFT_MAT());
      shaft.geometry.translate(0, -len / 2, 0); const uv = shaft.geometry.attributes.uv, pos = shaft.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 + pos.getY(i) / len);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sd); shaft.position.set(x, 8.95, z); shaft.renderOrder = 5; this.scene.add(shaft);
    }
  }
  barrier(x, z) { this.solid(x, z, 0.4, 3, 1.0); for (const k of [-0.75, 0.75]) this.put(fitModel('barrier', 0.5, 1.0, 1.5, { rotY: Math.PI / 2 }), x, 0, z + k); }
  // non-gameplay set dressing hugging the walls (the ones with colliders sit where nobody needs to walk)
  decorate() {
    const d = (k, x, z, s, h, r = 0, c = false, y = 0) => this.decor(k, x, z, s, h, s, r, c, y);
    // attacker spawn
    d('palletTruck', -16, 38.6, 2.0, 1.4, 1.2, true); d('barrel1', -43.2, 39.2, 0.6, 0.9, 0, true); d('barrel3', -42.4, 39.3, 0.65, 0.95, 0.5, true); d('barrel1', -43.25, 38.4, 0.6, 0.9, 1, true);
    d('generator', 17, 39.2, 0.85, 0.6, 0.2, true); d('jerrycan', 18.1, 39.5, 0.36, 0.47, 0.3); d('handtruck', 30, 39.4, 0.7, 1.4, Math.PI, false); d('tyre', 43.5, 30.5, 0.62, 0.62, Math.PI / 2); d('tyre', 43.5, 31.2, 0.62, 0.62, Math.PI / 2);
    d('cart', 38, 39.1, 1.6, 1.4, Math.PI, true); d('propane', -30.5, 39.4, 0.35, 0.56); d('propane', -29.9, 39.45, 0.35, 0.56);
    // A site
    d('barrel3', -43.2, -39.2, 0.65, 0.95, 0, true); d('barrel1', -42.5, -39.3, 0.6, 0.9, 0.7, true); d('jerrycan', -41.8, -39.6, 0.36, 0.47, 0.2);
    d('propane', -34.6, -39.5, 0.35, 0.56); d('extinguisher', -12.9, -39.5, 0.3, 0.66, Math.PI); d('toolbox', -25.5, -39.6, 0.42, 0.3, 0.1);
    // B site
    d('barrel1', 43.2, -39.2, 0.6, 0.9, 0, true); d('barrel3', 42.5, -39.3, 0.65, 0.95, 0.4, true); d('generator', 34, -39.4, 0.85, 0.6, Math.PI, true);
    d('extinguisher', 12.9, -39.5, 0.3, 0.66, Math.PI); d('jerrycan', 33, -39.65, 0.36, 0.47, 0);
    // defender spawn
    d('extinguisher', -11.2, -12.55, 0.3, 0.66, Math.PI); d('cart', -10.6, -38.9, 1.6, 1.4, 0, true); d('handtruck', 10.9, -39.4, 0.7, 1.4, 0.4);
    // longs, mid, yard
    d('barrel1', -43.3, 25.2, 0.6, 0.9, 0, true); d('tyre', -43.6, 14, 0.62, 0.62, Math.PI / 2); d('jerrycan', -43.7, 14.8, 0.36, 0.47, Math.PI / 2);
    d('barrel3', 43.3, 25.2, 0.65, 0.95, 0, true); d('barrel1', 43.3, 24.4, 0.6, 0.9, 1, true); d('propane', 43.6, -10.5, 0.35, 0.56);
    d('extinguisher', 7.55, 20, 0.3, 0.66, -Math.PI / 2); d('extinguisher', -7.55, -6, 0.3, 0.66, Math.PI / 2);
    d('barrel1', 29.3, 24.8, 0.6, 0.9, 0, true); d('generator', 28.9, -11, 0.85, 0.6, 0, true);
  }

  // ------------------------------------------------------------------ physics queries
  // Slab ray vs every AABB. Returns nearest {t, n:[nx,ny,nz]} or null.
  raycast(o, d, maxT = 200, ignoreBarrier = true) {
    let best = maxT, bn = null;
    for (const c of this.colliders) {
      if (c.barrier && ignoreBarrier) continue;
      let t0 = 0, t1 = best, axis = -1, sign = 0;
      for (let a = 0; a < 3; a++) {
        const oa = a === 0 ? o.x : a === 1 ? o.y : o.z, da = a === 0 ? d.x : a === 1 ? d.y : d.z;
        if (Math.abs(da) < 1e-9) { if (oa < c.min[a] || oa > c.max[a]) { t0 = 1; t1 = 0; break; } continue; }
        let ta = (c.min[a] - oa) / da, tb = (c.max[a] - oa) / da, s = -1; if (ta > tb) { const q = ta; ta = tb; tb = q; s = 1; }
        if (ta > t0) { t0 = ta; axis = a; sign = s; } if (tb < t1) t1 = tb; if (t0 > t1) break;
      }
      if (t0 <= t1 && t0 < best && axis >= 0) { best = t0; bn = [0, 0, 0]; bn[axis] = sign * (axis === 0 ? Math.sign(d.x) || 1 : axis === 1 ? Math.sign(d.y) || 1 : Math.sign(d.z) || 1) * -1 * -1; bn[axis] = -(Math.sign(axis === 0 ? d.x : axis === 1 ? d.y : d.z)); }
    }
    return bn ? { t: best, n: bn } : null;
  }
  segmentClear(a, b) { const d = new THREE.Vector3().subVectors(b, a); const L = d.length(); if (L < 1e-4) return true; d.divideScalar(L); const h = this.raycast(a, d, L); return !h; }

  // Circle (XZ) collision with step-up. Mutates pos (feet). Returns ground height under feet.
  collide(pos, r, height, barrier) {
    for (let iter = 0; iter < 3; iter++) {
      for (const c of this.colliders) {
        if (c.kind === 'floor') continue; if (c.barrier && !barrier) continue;
        if (c.max[1] <= pos.y + 0.5 || c.min[1] >= pos.y + height) continue; // can step over / walk under
        const cx = Math.max(c.min[0], Math.min(pos.x, c.max[0])), cz = Math.max(c.min[2], Math.min(pos.z, c.max[2]));
        let dx = pos.x - cx, dz = pos.z - cz; const d2 = dx * dx + dz * dz; if (d2 >= r * r) continue;
        if (d2 < 1e-8) { // centre inside box: push out along smallest axis
          const px = [pos.x - c.min[0] + r, c.max[0] - pos.x + r], pz = [pos.z - c.min[2] + r, c.max[2] - pos.z + r]; const m = Math.min(...px, ...pz);
          if (m === px[0]) pos.x -= px[0]; else if (m === px[1]) pos.x += px[1]; else if (m === pz[0]) pos.z -= pz[0]; else pos.z += pz[1]; continue;
        }
        const d = Math.sqrt(d2), push = r - d; pos.x += (dx / d) * push; pos.z += (dz / d) * push;
      }
    }
    pos.x = Math.max(BOUNDS.x0 + r, Math.min(BOUNDS.x1 - r, pos.x)); pos.z = Math.max(BOUNDS.z0 + r, Math.min(BOUNDS.z1 - r, pos.z));
    return this.groundAt(pos.x, pos.z, pos.y, r * 0.7);
  }
  groundAt(x, z, feetY, r = 0.2) {
    let g = 0; for (const c of this.colliders) { if (c.kind === 'floor' || c.barrier) continue; if (x + r < c.min[0] || x - r > c.max[0] || z + r < c.min[2] || z - r > c.max[2]) continue; if (c.max[1] <= feetY + 0.5 && c.max[1] > g) g = c.max[1]; }
    return g;
  }

  // ------------------------------------------------------------------ navigation grid (0.5 m) + A*
  buildNav() {
    const S = 0.5, B = BOUNDS; this.nav = { S, w: Math.round((B.x1 - B.x0) / S), h: Math.round((B.z1 - B.z0) / S) };
    const N = this.nav; N.walk = new Uint8Array(N.w * N.h); const r = 0.5;
    for (let j = 0; j < N.h; j++) for (let i = 0; i < N.w; i++) {
      const x = B.x0 + (i + 0.5) * S, z = B.z0 + (j + 0.5) * S; let ok = x > B.x0 + r && x < B.x1 - r && z > B.z0 + r && z < B.z1 - r;
      if (ok) for (const c of this.colliders) { if (c.kind === 'floor' || c.barrier || c.max[1] <= 0.5 || c.min[1] > 1.8) continue; if (x > c.min[0] - r && x < c.max[0] + r && z > c.min[2] - r && z < c.max[2] + r) { ok = false; break; } }
      N.walk[j * N.w + i] = ok ? 1 : 0;
    }
  }
  cell(x, z) { const N = this.nav; return [Math.floor((x - BOUNDS.x0) / N.S), Math.floor((z - BOUNDS.z0) / N.S)]; }
  walkable(i, j) { const N = this.nav; return i >= 0 && j >= 0 && i < N.w && j < N.h && N.walk[j * N.w + i] === 1; }
  walkableAt(x, z) { const [i, j] = this.cell(x, z); return this.walkable(i, j); }
  center(i, j) { const N = this.nav; return [BOUNDS.x0 + (i + 0.5) * N.S, BOUNDS.z0 + (j + 0.5) * N.S]; }
  nearestWalkable(x, z) {
    let [i, j] = this.cell(x, z); if (this.walkable(i, j)) return [i, j];
    for (let rr = 1; rr < 30; rr++) for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== rr) continue; if (this.walkable(i + di, j + dj)) return [i + di, j + dj]; }
    return [i, j];
  }
  lineWalkable(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), n = Math.ceil(L / 0.25);
    for (let k = 0; k <= n; k++) { const t = n ? k / n : 0; if (!this.walkableAt(x0 + dx * t, z0 + dz * t)) return false; } return true;
  }
  findPath(x0, z0, x1, z1) {
    const N = this.nav, [si, sj] = this.nearestWalkable(x0, z0), [gi, gj] = this.nearestWalkable(x1, z1);
    const W = N.w, start = sj * W + si, goal = gj * W + gi; if (start === goal) return [[x1, z1]];
    const g = this._g || (this._g = new Float32Array(W * N.h)), came = this._came || (this._came = new Int32Array(W * N.h)), stamp = this._stamp || (this._stamp = new Uint32Array(W * N.h));
    this._run = (this._run || 0) + 1; const run = this._run, closed = this._closed || (this._closed = new Uint32Array(W * N.h));
    const heap = []; const push = (n, f) => { heap.push([f, n]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top[1]; };
    const hfn = (i, j) => { const dx = Math.abs(i - gi), dj = Math.abs(j - gj); return (dx + dj) + (1.414 - 2) * Math.min(dx, dj); };
    g[start] = 0; stamp[start] = run; came[start] = -1; push(start, hfn(si, sj)); let found = false, iters = 0;
    while (heap.length && iters++ < 40000) {
      const cur = pop(); if (cur === goal) { found = true; break; } if (closed[cur] === run) continue; closed[cur] = run;
      const ci = cur % W, cj = (cur / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = ci + di, nj = cj + dj; if (!this.walkable(ni, nj)) continue;
        if (di && dj && (!this.walkable(ci + di, cj) || !this.walkable(ci, cj + dj))) continue;
        const nb = nj * W + ni, ng = g[cur] + (di && dj ? 1.414 : 1);
        if (stamp[nb] !== run || ng < g[nb]) { stamp[nb] = run; g[nb] = ng; came[nb] = cur; push(nb, ng + hfn(ni, nj)); }
      }
    }
    if (!found) return null;
    const pts = []; for (let c = goal; c !== -1; c = came[c]) pts.push(this.center(c % W, (c / W) | 0)); pts.reverse();
    // string pulling
    const out = []; let a = 0; out.push(pts[0]);
    while (a < pts.length - 1) { let b = pts.length - 1; while (b > a + 1 && !this.lineWalkable(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--; out.push(pts[b]); a = b; }
    out.shift(); return out.length ? out : [[x1, z1]];
  }
}
