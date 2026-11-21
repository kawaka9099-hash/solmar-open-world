// Solmar — game/src/main.js
// Boot for Solmar: renderer, sky and lights, the procedural city, input,
// procedural sound, then the Game itself. Owns the animation loop and the
// window.solmar handle the tests and the screenshot stagings use.
//
// The game is built from the engine (config / world / vehicles / actors /
// input / audio, written by the engine session) and the gameplay layer
// (game / missions / wanted / combat / hud / save / shots, this session).

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildCity } from './world.js';
import { Input } from './input.js';
import { SoundEngine } from './audio.js';
import { Game } from './game.js';
import { SHOT_SETUPS } from './shots.js';
import { loadSave, writeSave } from './save.js';

const canvas = document.getElementById('game-canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.sky.background);
scene.fog = new THREE.Fog(CONFIG.sky.fog, CONFIG.sky.fogNear, CONFIG.sky.fogFar);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 30, 40);

const sun = new THREE.DirectionalLight(CONFIG.sky.sunColor, CONFIG.sky.sunIntensity);
sun.position.set(...CONFIG.sky.sunPosition);
scene.add(sun);
scene.add(new THREE.AmbientLight(CONFIG.sky.ambientColor, CONFIG.sky.ambientIntensity));
scene.add(new THREE.HemisphereLight(CONFIG.sky.hemiSky, CONFIG.sky.hemiGround, CONFIG.sky.hemiIntensity));

const city = buildCity(scene, THREE);
const input = new Input(canvas);
const sfx = new SoundEngine();

const game = new Game({ THREE, scene, camera, renderer, input, sfx, canvas });
game.init(city);

// Menu buttons.
const startButton = document.getElementById('start-button');
if (startButton) startButton.addEventListener('click', () => game.beginPlaying());
const resumeButton = document.getElementById('resume-button');
if (resumeButton) resumeButton.addEventListener('click', () => game.resumeGame());
const bustedButton = document.getElementById('busted-button');
if (bustedButton) bustedButton.addEventListener('click', () => game.respawnAfterBusted());
const wastedButton = document.getElementById('wasted-button');
if (wastedButton) wastedButton.addEventListener('click', () => game.respawnAfterWasted());

// Clicking the canvas while playing re-locks the mouse.
canvas.addEventListener('click', () => {
  if (game.state.mode === 'playing' && !input.locked && canvas.requestPointerLock) {
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_e) { /* headless */ }
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Screenshot staging (?shot=street|mission|drive|chase|start) for the
// dossier captures. Anything else starts on the title screen.
const shot = new URLSearchParams(window.location.search).get('shot');
if (shot && SHOT_SETUPS.includes(shot)) {
  game.shots.applySetup(shot);
}

// The handle tests and tooling use. Everything the game owns is reachable.
window.solmar = {
  THREE,
  scene,
  camera,
  renderer,
  city,
  cars: game.cars,
  peds: game.peds,
  player: game.player,
  state: game.state,
  input,
  sfx,
  showToast: (text) => game.hud.toast(text),
  updateHUD: () => game.refreshHUD(),
  game,
  missions: game.missions,
  wanted: game.wanted,
  combat: game.combat,
  hud: game.hud,
  save: { load: loadSave, write: writeSave },
  shots: game.shots,
  takeShot: () => game.shots.takeShot(),
};

// Main loop: fixed-clamp delta, game first, render, then any queued capture.
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  game.update(dt);
  renderer.render(scene, camera);
  game.shots.afterRender();
}
frame();
