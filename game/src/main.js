// Solmar — game/src/main.js
// Boot: renderer, sun and fog, the city, the player, parked cars, traffic
// and pedestrians (all spawned from one seeded stream so the same city
// comes up every load), then the game loop and the third-person camera.
//
// Spawns are seeded (mulberry32) so a fresh load always deals the same
// streets, cars and crowds; the game logic itself reads the clock.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, makeRng, pick, range } from './util.js';
import { Input } from './input.js';
import { SoundEngine } from './audio.js';
import { buildCity } from './world.js';
import { createCar } from './vehicles.js';
import { createPlayer, createPedestrian } from './actors.js';
import { Game } from './game.js';
import { loadSave, writeSave, clearSave } from './save.js';
import { capture, applyShotStaging } from './shots.js';

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.sky.background);
scene.fog = new THREE.Fog(CONFIG.sky.fog, CONFIG.sky.fogNear, CONFIG.sky.fogFar);

const sun = new THREE.DirectionalLight(CONFIG.sky.sunColor, CONFIG.sky.sunIntensity);
sun.position.set(...CONFIG.sky.sunPosition);
scene.add(sun);
scene.add(new THREE.HemisphereLight(CONFIG.sky.hemiSky, CONFIG.sky.hemiGround, CONFIG.sky.hemiIntensity));
scene.add(new THREE.AmbientLight(CONFIG.sky.ambientColor, CONFIG.sky.ambientIntensity));

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

const city = buildCity(scene, THREE);
const rng = makeRng(CONFIG.city.seed);
const spawn = city.landmarks.spawn;

const player = createPlayer(scene, THREE, spawn.x, spawn.z);

// Parked cars: along road lines, nosed to the kerb, never near the spawn.
const cars = [];
const parkedTypes = ['sedan', 'sport', 'truck', 'taxi'];
for (let i = 0; i < 7; i++) {
  const line = pick(rng, city.roadLines);
  const alongX = rng() < 0.5;
  const along = city.bounds.minX + 14 + rng() * (city.bounds.maxX - city.bounds.minX - 28);
  const x = alongX ? clamp(along, city.bounds.minX + 10, city.bounds.maxX - 10) : line + (rng() < 0.5 ? 4.6 : -4.6);
  const z = alongX ? line + (rng() < 0.5 ? 4.6 : -4.6) : clamp(along, city.bounds.minZ + 10, city.bounds.maxZ - 10);
  if (Math.hypot(x - spawn.x, z - spawn.z) < 10) continue;
  const heading = alongX ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI);
  const car = createCar(scene, THREE, pick(rng, parkedTypes), x, z, heading);
  scene.add(car.group);
  cars.push(car);
}

// Traffic: cars cruising the road lines, each with its own cruise speed.
const traffic = [];
const trafficTypes = ['sedan', 'sedan', 'sport', 'truck', 'taxi'];
for (let i = 0; i < CONFIG.traffic.count; i++) {
  const line = pick(rng, city.roadLines);
  const alongX = rng() < 0.5;
  const along = city.bounds.minX + 10 + rng() * (city.bounds.maxX - city.bounds.minX - 20);
  const x = alongX ? clamp(along, city.bounds.minX + 8, city.bounds.maxX - 8) : line;
  const z = alongX ? line : clamp(along, city.bounds.minZ + 8, city.bounds.maxZ - 8);
  const heading = alongX ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI);
  const car = createCar(scene, THREE, pick(rng, trafficTypes), x, z, heading);
  scene.add(car.group);
  cars.push(car);
  traffic.push(car);
}

// Pedestrians: strolling the sidewalks, in workaday colours.
const peds = [];
const shirts = [0xd05040, 0x3a7a8a, 0x6a8a3a, 0xe8b820, 0x8a5aa0, 0xdddddd, 0x2a2c30, 0xc07030];
const pants = [0x2a2c30, 0x3a4a6a, 0x5a4a3a, 0x6a6a6a];
const skins = [0xd8a077, 0xc08a60, 0x8a5a3a, 0xe8b890];
for (let i = 0; i < CONFIG.peds.count; i++) {
  const walk = city.sidewalks[Math.floor(rng() * city.sidewalks.length)];
  const x = walk.x + (rng() - 0.5) * walk.w;
  const z = walk.z + (rng() - 0.5) * walk.d;
  const ped = createPedestrian(scene, THREE, x, z, {
    shirt: pick(rng, shirts),
    pants: pick(rng, pants),
    skin: pick(rng, skins),
    speed: range(rng, CONFIG.peds.walkSpeedMin, CONFIG.peds.walkSpeedMax),
  });
  scene.add(ped.group);
  peds.push(ped);
}

const input = new Input(canvas);
const sfx = new SoundEngine();

const game = new Game({ scene, camera, THREE, city, player, cars, peds, traffic, input, sfx });

// Menu buttons.
document.getElementById('start-button')?.addEventListener('click', () => game.start());
document.getElementById('resume-button')?.addEventListener('click', () => game.resume());
document.getElementById('busted-button')?.addEventListener('click', () => game.respawn('busted'));
document.getElementById('wasted-button')?.addEventListener('click', () => game.respawn('wasted'));

// F9 dumps a PNG of the canvas (the dossier screenshots).
window.addEventListener('keydown', (e) => {
  if (e.code === 'F9') {
    e.preventDefault();
    const params = new URLSearchParams(window.location.search);
    capture(renderer, params.get('shot') ?? 'solmar-shot');
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// What tests and the console see.
window.solmar = {
  THREE,
  scene,
  camera,
  renderer,
  city,
  cars,
  peds,
  traffic,
  player,
  state: game,
  game,
  missions: game.missions,
  wanted: game.wanted,
  combat: game.combat,
  hud: game.hud,
  save: { loadSave, writeSave, clearSave },
  shots: { capture: (name) => capture(renderer, name), applyShotStaging },
  takeShot: (name) => capture(renderer, name ?? 'solmar-shot'),
  input,
  sfx,
  showToast: (text, ms) => game.toast(text, ms),
  updateHUD: () => game.updateHUD(),
};

// ---- third-person camera ----
// The camera sits behind the player's facing direction and looks a little
// past them; while driving it pulls around behind the car on its own.
const camPos = new THREE.Vector3(spawn.x, 26, spawn.z + 46);
const camTarget = new THREE.Vector3();
let staged = false;

function updateCamera(dt) {
  if (game.phase === 'menu') {
    const t = performance.now() / 1000;
    const a = t * 0.06;
    camPos.set(spawn.x + Math.sin(a) * 62, 30, spawn.z + Math.cos(a) * 62);
    camera.position.copy(camPos);
    camera.lookAt(spawn.x, 0, spawn.z);
    return;
  }
  const driving = game.ctx.driving.car;
  const focus = driving ? driving.group.position : player.pos;
  const yaw = game.camYaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const dist = driving ? 9.5 : 6.5;
  const height = driving ? 4.2 : 3.0;
  const desired = new THREE.Vector3(focus.x - fx * dist, (driving ? 1.2 : 1.6) + height, focus.z - fz * dist);
  // Snap on teleports (respawn, staging, mission jumps); glide otherwise.
  if (camPos.distanceTo(desired) > 18) camPos.copy(desired);
  else camPos.lerp(desired, 1 - Math.exp(-9 * dt));
  camera.position.copy(camPos);
  camTarget.set(focus.x + fx * 3, (driving ? 1.2 : 1.5), focus.z + fz * 3);
  camera.lookAt(camTarget);
}

// ---- main loop ----
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  game.update(dt);
  if (!staged) {
    staged = true;
    const params = new URLSearchParams(window.location.search);
    const shot = params.get('shot');
    if (shot) {
      applyShotStaging(shot, { game, missions: game.missions, wanted: game.wanted, player, THREE });
      camPos.set(player.pos.x, 26, player.pos.z + 46);
    }
  }
  updateCamera(dt);
  renderer.render(scene, camera);
}
frame();
