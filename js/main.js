// NO SECOND CHANCE — bootstrap: renderer, menus, settings, main loop.
import * as THREE from './vendor/three.module.js';
import { MATCH } from './config.js';
import { WarehouseMap } from './map.js';
import { FX } from './fx.js';
import { Game } from './game.js';
import { PlayerController } from './player.js';
import { HUD } from './hud.js';
import { audio } from './audio.js';
import { loadSave, writeSave } from './save.js';
import { loadAssets, A } from './assets.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from './vendor/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from './vendor/jsm/postprocessing/FXAAPass.js';

const $ = id => document.getElementById(id);
const save = loadSave(); const settings = save.settings;
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.autoClear = false;
if (!['low', 'medium', 'high'].includes(settings.quality)) settings.quality = 'high';
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0e1012); scene.fog = new THREE.FogExp2(0x2a2e33, 0.008);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300); camera.rotation.order = 'YXZ'; scene.add(camera);
// assets first (models, PBR textures, HDR environment)
await loadAssets(renderer, f => { $('loading').textContent = `LOADING ${Math.round(f * 100)}%`; });
scene.environment = A.env; scene.environmentIntensity = 0.45;
const map = new WarehouseMap(scene), fx = new FX(scene), hud = new HUD();
const game = new Game(scene, map, fx, hud, settings);
const player = new PlayerController(game, camera, canvas, settings); hud.bindGame(game, player);
player.vmScene.environment = A.env; player.vmScene.environmentIntensity = 0.6;

// ---------------------------------------------------------------- rendering pipeline + quality presets
// low: direct render, no shadows. medium: soft shadows, bloom, FXAA. high: + GTAO ambient occlusion, SMAA, 2x pixel ratio.
let composer = null, P = {};
function buildPipeline() {
  const q = settings.quality; if (composer) { composer.dispose(); composer = null; }
  renderer.shadowMap.enabled = q !== 'low'; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.needsUpdate = true;
  if (map.sun) { map.sun.shadow.mapSize.setScalar(q === 'high' ? 4096 : 2048); if (map.sun.shadow.map) { map.sun.shadow.map.dispose(); map.sun.shadow.map = null; } }
  scene.traverse(o => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  renderer.setPixelRatio(q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'medium' ? Math.min(devicePixelRatio, 1.5) : 1);
  if (q === 'low') return;
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  P.world = new RenderPass(scene, camera); composer.addPass(P.world);
  if (q === 'high') { P.ao = new GTAOPass(scene, camera, 1, 1); P.ao.output = GTAOPass.OUTPUT.Default; P.ao.blendIntensity = 0.85; P.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: 12 }); composer.addPass(P.ao); } else P.ao = null;
  P.vm = new RenderPass(player.vmScene, player.vmCam); P.vm.clear = false; P.vm.clearDepth = true; composer.addPass(P.vm);
  P.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.92); composer.addPass(P.bloom);
  composer.addPass(new OutputPass());
  composer.addPass(q === 'high' ? new SMAAPass() : new FXAAPass());
}
function applyQuality() { buildPipeline(); }

let state = 'menu', menuT = 0;

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); } camera.aspect = w / h; const hf = settings.fov * Math.PI / 180; camera.fov = 2 * Math.atan(Math.tan(hf / 2) / Math.max(1, camera.aspect) * 1) * 180 / Math.PI; camera.updateProjectionMatrix(); player.vmCam.aspect = w / h; player.vmCam.updateProjectionMatrix(); }
addEventListener('resize', resize); applyQuality(); resize();
const persist = () => writeSave(save);
persist(); // make sure a save exists (in the launcher this also migrates an old browser save)
if (window.nscNative) { $('btnQuit').hidden = false; $('btnQuit').onclick = () => window.close(); }
audio.vol = settings.volume;

// ---------------------------------------------------------------- menus
function showScreen(id) { for (const s of ['menu', 'pause', 'controls', 'settings', 'matchOver']) $(s).hidden = s !== id; }
let returnTo = 'menu';
function careerText() { const c = save.career; $('career').innerHTML = c.matches ? `Career · ${c.matches} matches · ${c.wins} wins · ${c.kills} kills · ${c.rescues} rescues` : 'First deployment. Gun skill wins fights. Teamwork saves lives.'; }
careerText();
$('btnPlay').onclick = () => { audio.init(); $('mainBtns').hidden = true; $('sidePick').hidden = false; $('diffSel').value = settings.difficulty; };
$('btnBack').onclick = () => { $('mainBtns').hidden = false; $('sidePick').hidden = true; };
for (const b of document.querySelectorAll('.side')) b.onclick = () => { settings.difficulty = $('diffSel').value; persist(); startMatch(b.dataset.side); };
$('btnControls').onclick = () => { returnTo = 'menu'; showScreen('controls'); };
$('btnSettings').onclick = () => { returnTo = 'menu'; openSettings(); };
$('btnPControls').onclick = () => { returnTo = 'pause'; showScreen('controls'); };
$('btnPSettings').onclick = () => { returnTo = 'pause'; openSettings(); };
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => { showScreen(returnTo); if (returnTo === 'menu') { $('mainBtns').hidden = false; $('sidePick').hidden = true; } };
$('btnResume').onclick = () => resume();
$('btnLeave').onclick = () => toMenu();
$('btnAgain').onclick = () => startMatch(game.startSide);
$('btnMenu').onclick = () => toMenu();
$('bleedSecs').textContent = MATCH.BLEEDOUT;
function openSettings() {
  showScreen('settings'); const bindR = (id, key, fmt, after) => { const el = $(id); el.value = settings[key]; $(id + 'V').textContent = fmt(settings[key]); el.oninput = () => { settings[key] = +el.value; $(id + 'V').textContent = fmt(settings[key]); after && after(); persist(); }; };
  bindR('sSens', 'sens', v => (+v).toFixed(2)); bindR('sFov', 'fov', v => v + '°', resize); bindR('sVol', 'volume', v => Math.round(v * 100) + '%', () => audio.setVolume(settings.volume));
  $('sInv').checked = !!settings.invert; $('sInv').onchange = () => { settings.invert = $('sInv').checked; persist(); };
  $('sQual').value = settings.quality; $('sQual').onchange = () => { settings.quality = $('sQual').value; applyQuality(); resize(); persist(); };
  $('sRounds').textContent = MATCH.ROUNDS_TO_WIN; $('sHalf').textContent = MATCH.HALF_ROUNDS;
}
function startMatch(side) {
  audio.init(); audio.setVolume(settings.volume); showScreen(null); $('hud').hidden = false; state = 'playing'; player.enabled = true;
  game.newMatch(side); hud.setBuy(false); $('clickToPlay').hidden = false; player.lock(); careerText();
}
function toMenu() { state = 'menu'; player.enabled = false; hud.setBuy(false); $('hud').hidden = true; $('clickToPlay').hidden = true; if (document.pointerLockElement) document.exitPointerLock(); showScreen('menu'); $('mainBtns').hidden = false; $('sidePick').hidden = true; careerText(); }
function resume() { showScreen(null); state = 'playing'; $('clickToPlay').hidden = true; player.lock(); }
$('clickToPlay').onclick = () => { audio.init(); player.lock(); };
let expectUnlock = false;
player.onLockChange = locked => {
  if (locked) { $('clickToPlay').hidden = true; if (state === 'paused') resume(); return; }
  if (expectUnlock) { expectUnlock = false; return; }
  if (state === 'playing' && game.phase !== 'over' && !hud.buyOpen) { state = 'paused'; showScreen('pause'); }
};
hud.onMatchOver = won => { state = 'over'; player.enabled = false; const c = save.career, me = game.player; c.matches++; if (won) c.wins++; c.kills += me.stats.k; c.deaths += me.stats.d; c.rescues += me.stats.rescues; c.rounds += game.roundNo; persist(); showScreen('matchOver'); };
function toggleBuy(open) {
  if (open && !((game.phase === 'buy' || game.phase === 'prep') && game.player.state === 'alive')) { hud.toast('You can only buy during the buy phase'); return; }
  hud.setBuy(open); if (open) { expectUnlock = true; if (document.pointerLockElement) document.exitPointerLock(); else expectUnlock = false; } else player.lock();
}
addEventListener('keydown', e => {
  if (state !== 'playing') return;
  if (e.code === 'KeyB') { e.preventDefault(); toggleBuy(!hud.buyOpen); }
  else if (e.code === 'Escape' && hud.buyOpen) { toggleBuy(false); }
  else if (e.code === 'Enter') { game.skipPhase(); }
});

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame); let dt = Math.min(0.05, (now - last) / 1000); last = now; tick(dt);
}
function tick(dt) {
  if (state === 'menu') {
    menuT += dt * 0.05; const r = 30; camera.position.set(Math.sin(menuT) * r, 6 + Math.sin(menuT * 0.7) * 1.2, Math.cos(menuT) * r * 0.9); camera.lookAt(0, 1.5, -6); fx.update(dt);
  } else if (state === 'playing' || state === 'over') {
    if (state === 'playing') { player.update(dt); game.update(dt); }
    fx.update(dt); hud.update(dt);
    if (hud.buyOpen && !(game.phase === 'buy' || game.phase === 'prep')) { hud.setBuy(false); $('clickToPlay').hidden = !!document.pointerLockElement; }
  } else if (state === 'paused') { hud.update(0); }
  const vm = state !== 'menu' && game.player && game.player.state === 'alive'; if (vm) { player.vmCam.fov = 56; player.vmCam.updateProjectionMatrix(); }
  if (composer) { P.vm.enabled = vm; composer.render(dt); }
  else { renderer.clear(); renderer.render(scene, camera); if (vm) { renderer.clearDepth(); renderer.render(player.vmScene, player.vmCam); } }
}
$('loading').hidden = true; requestAnimationFrame(frame);
// debug/test hook
window.__nsc = { game, player, hud, map, startMatch, tick, settings, renderer, get state() { return state; }, set state(v) { state = v; } };
