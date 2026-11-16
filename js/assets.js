// Asset loading: glTF models (meshopt-compressed), PBR texture sets and the HDR environment.
// Everything lives in assets/ and is loaded once at startup. Sources and licences: CREDITS.md.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from './vendor/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from './vendor/jsm/libs/meshopt_decoder.module.js';

const MODELS = {
  soldier: 'soldier', ual1: 'anims_ual1', ual2: 'anims_ual2',
  ak: 'ak47', m4: 'm4a1', pistol: 'service_pistol',
  container: 'container', pallet: 'pallet', palletTruck: 'pallet_truck',
  crate1: 'wooden_crate_01', crate2: 'wooden_crate_02', milcrate: 'wooden_military_crate', cardboard: 'cardboard_box_01', plcrate: 'plastic_crate_03',
  barrel1: 'Barrel_01', barrel3: 'barrel_03', shelves1: 'steel_frame_shelves_01', shelves2: 'steel_frame_shelves_02',
  lamp: 'hanging_industrial_lamp', fluo: 'mounted_fluorescent_lights', barrier: 'concrete_road_barrier', generator: 'portable_generator',
  tyre: 'old_tyre', jerrycan: 'metal_jerrycan', propane: 'propane_tank', handtruck: 'hand_truck', medbox: 'medical_box',
  ammobox: 'ammo_box', toolbox: 'metal_toolbox', cart: 'industrial_storage_cart', extinguisher: 'korean_fire_extinguisher_01',
};
const TEXSETS = ['concrete_floor_worn_001', 'corrugated_iron_02', 'box_profile_metal_sheet', 'concrete_wall_006', 'metal_plate', 'painted_metal_shutter', 'denim_fabric', 'rusty_metal_02'];

export const A = { gltf: {}, sets: {}, env: null, skinLight: null, ready: false, maxAniso: 8 };

export async function loadAssets(renderer, onProgress = () => {}) {
  const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
  const tl = new THREE.TextureLoader(); A.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const jobs = []; let done = 0; const total = Object.keys(MODELS).length + TEXSETS.length * 3 + 2;
  const tick = () => onProgress(++done / total);
  for (const [k, f] of Object.entries(MODELS)) jobs.push(gl.loadAsync(`assets/models/${f}.glb`).then(g => { A.gltf[k] = g; tick(); }));
  const tex = (url, srgb) => tl.loadAsync(url).then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = A.maxAniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; tick(); return t; });
  for (const s of TEXSETS) jobs.push(Promise.all([tex(`assets/tex/${s}_diff.webp`, true), tex(`assets/tex/${s}_nor.webp`), tex(`assets/tex/${s}_arm.webp`)]).then(([d, n, a]) => { A.sets[s] = { d, n, a }; }));
  jobs.push(tex('assets/tex/skin_light.webp', true).then(t => { t.flipY = false; A.skinLight = t; }));
  jobs.push(new HDRLoader().loadAsync('assets/hdr/empty_warehouse_01_1k.hdr').then(h => {
    const pm = new THREE.PMREMGenerator(renderer); h.mapping = THREE.EquirectangularReflectionMapping; A.env = pm.fromEquirectangular(h).texture; h.dispose(); pm.dispose(); tick();
  }));
  await Promise.all(jobs); A.ready = true; return A;
}

// PBR material from a texture set (diffuse / normal / AO-roughness-metal packed).
export function pbrMat(set, o = {}) {
  const s = A.sets[set];
  const m = new THREE.MeshStandardMaterial({ map: s.d, normalMap: s.n, roughnessMap: s.a, metalnessMap: s.a, aoMap: s.a, aoMapIntensity: o.ao ?? 1,
    roughness: o.roughness ?? 1, metalness: o.metalness ?? 1, color: o.color ?? 0xffffff, normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1) });
  return m;
}

const tintCache = {};
// Clone a loaded model, fit it into a box (sx, sy, sz) with its base at y=0, centred on x/z.
export function fitModel(key, sx, sy, sz, o = {}) {
  const inner = A.gltf[key].scene.clone(true); if (o.rotY) inner.rotation.y = o.rotY;
  const wrap = new THREE.Group(); wrap.add(inner); wrap.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(wrap), size = bb.getSize(new THREE.Vector3());
  let kx = sx / size.x, ky = sy / size.y, kz = sz / size.z;
  if (o.uniform) { const k = Math.min(kx, ky, kz); kx = ky = kz = k; }
  wrap.scale.set(kx, ky, kz); wrap.position.set(-(bb.min.x + size.x / 2) * kx, -bb.min.y * ky, -(bb.min.z + size.z / 2) * kz);
  const g = new THREE.Group(); g.add(wrap);
  g.traverse(m => { if (m.isMesh) { m.castShadow = o.shadow !== false; m.receiveShadow = true; if (o.tint && m.material) { const ck = m.material.uuid + ':' + o.tint; m.material = tintCache[ck] || (tintCache[ck] = (() => { const c = m.material.clone(); c.color.multiply(new THREE.Color(o.tint)); return c; })()); } } });
  return g;
}
