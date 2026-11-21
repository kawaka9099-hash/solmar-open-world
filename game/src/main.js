// Solmar — game/src/main.js
// BOOT STUB (part 1 of 3): boots the scene, builds the city, spawns the
// player, one parked car and a few pedestrians, and runs a playable
// free-roam loop (walk, drive, enter/exit cars, minimap, HUD, pause).
// The gameplay session (part 2) replaces/extends this file with missions,
// wanted/police, combat, traffic AI and saving. The engine modules it
// stands on (config, util, input, audio, world, vehicles, actors) are
// final and their APIs are the contract for that session.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, formatMoney, formatSpeed } from './util.js';
import { Input } from './input.js';
import { SoundEngine } from './audio.js';
import { buildCity } from './world.js';
import { createCar, updateCar, nearestCar } from './vehicles.js';
import { createPlayer, updatePlayer, createPedestrian, updatePedestrian } from './actors.js';

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.sky.background);
scene.fog = new THREE.Fog(CONFIG.sky.fog, CONFIG.sky.fogNear, CONFIG.sky.fogFar);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

const sun = new THREE.DirectionalLight(CONFIG.sky.sunColor, CONFIG.sky.sunIntensity);
sun.position.set(...CONFIG.sky.sunPosition);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -220;
sun.shadow.camera.right = 220;
sun.shadow.camera.top = 220;
sun.shadow.camera.bottom = -220;
sun.shadow.camera.far = 600;
scene.add(sun);
scene.add(new THREE.AmbientLight(CONFIG.sky.ambientColor, CONFIG.sky.ambientIntensity));
scene.add(new THREE.HemisphereLight(CONFIG.sky.hemiSky, CONFIG.sky.hemiGround, CONFIG.sky.hemiIntensity));

// ---- World, player, cars, peds --------------------------------------------
const city = buildCity(scene, THREE);
const input = new Input(canvas);
const sfx = new SoundEngine();

const state = {
  mode: 'menu',           // 'menu' | 'playing' | 'paused'
  money: CONFIG.money.startCash,
  health: CONFIG.player.health,
  wanted: 0,
  ammoMag: CONFIG.combat.pistolMag,
  ammoReserve: CONFIG.combat.pistolReserve,
  camYaw: 0,
  camPitch: 0.32,
  time: 0,
};

const player = createPlayer(scene, THREE, city.landmarks.spawn.x, city.landmarks.spawn.z);
player.heading = Math.PI; // face down the road

const cars = [];
const parked = createCar(scene, THREE, 'sedan', city.landmarks.spawn.x + 6, city.landmarks.spawn.z + 2, Math.PI / 2);
cars.push(parked);
// A couple of cars cruising the grid so the streets feel alive.
const cruiserA = createCar(scene, THREE, 'taxi', -42, -112, 0);
const cruiserB = createCar(scene, THREE, 'sport', 98, 28, Math.PI);
cars.push(cruiserA, cruiserB);

const peds = [];
const laneDefs = [
  { axis: 'x', line: -42, offset: 9 },
  { axis: 'x', line: 28, offset: -9 },
  { axis: 'z', line: -112, offset: 9 },
  { axis: 'z', line: 98, offset: -9 },
];
for (let i = 0; i < 10; i++) {
  const lane = laneDefs[i % laneDefs.length];
  const x = lane.axis === 'x' ? -150 + i * 34 : lane.line + lane.offset;
  const z = lane.axis === 'x' ? lane.line + lane.offset : -150 + i * 34;
  const ped = createPedestrian(scene, THREE, x, z, { lane });
  peds.push(ped);
}

let currentCar = null;

// ---- HUD ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const minimapCtx = $('minimap').getContext('2d');

function showToast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.style.display = 'none'; }, ms);
}

function updateHUD() {
  $('hud-money').textContent = formatMoney(state.money);
  $('hud-health-num').textContent = Math.max(0, Math.round(state.health));
  $('hud-health-bar').style.width = clamp(state.health, 0, 100) + '%';
  $('hud-ammo').textContent = `PISTOL — ${state.ammoMag} IN MAG · ${state.ammoReserve} RESERVE`;
  const stars = $('wanted-stars').children;
  for (let i = 0; i < stars.length; i++) stars[i].className = i < state.wanted ? 'lit' : '';
  const speed = currentCar ? Math.abs(currentCar.speed) : player.speed;
  $('hud-speed').textContent = formatSpeed(speed);
  $('crosshair').style.display = currentCar ? 'none' : 'block';
}

function drawMinimap() {
  const size = 190;
  const range = 460; // metres across the map
  const toMap = (x, z) => [
    size / 2 + (x / range) * size,
    size / 2 + (z / range) * size,
  ];
  const g = minimapCtx;
  g.clearRect(0, 0, size, size);
  g.fillStyle = '#20242c';
  g.fillRect(0, 0, size, size);
  // Water at the south edge.
  const [, waterY] = toMap(0, 190);
  g.fillStyle = '#2f7fb8';
  g.fillRect(0, waterY, size, size - waterY);
  // Roads.
  g.strokeStyle = '#5a5e66';
  g.lineWidth = 5;
  for (const line of city.roadLines) {
    const [x] = toMap(line, 0);
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke();
    const [, z] = toMap(0, line);
    g.beginPath(); g.moveTo(0, z); g.lineTo(size, z); g.stroke();
  }
  // Landmarks: bank gold, hospital red, safehouse green, marina blue.
  const marks = [
    [city.landmarks.bank, '#ffd23e'],
    [city.landmarks.hospital, '#ff5040'],
    [city.landmarks.safehouse, '#37d67a'],
    [city.landmarks.marina, '#2ad4c4'],
  ];
  for (const [lm, color] of marks) {
    const [mx, mz] = toMap(lm.x, lm.z);
    g.fillStyle = color;
    g.beginPath(); g.arc(mx, mz, 3, 0, Math.PI * 2); g.fill();
  }
  // Cars.
  g.fillStyle = '#ffd23e';
  for (const car of cars) {
    const [cx, cz] = toMap(car.group.position.x, car.group.position.z);
    g.fillRect(cx - 1.5, cz - 1.5, 3, 3);
  }
  // Player: white dot with a dark ring.
  const [px, pz] = toMap(player.pos.x, player.pos.z);
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(px, pz, 4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#111';
  g.lineWidth = 1.5;
  g.stroke();
}

// ---- Flow -----------------------------------------------------------------
function startGame() {
  sfx.ensure();
  sfx.setMusic(true);
  sfx.click();
  $('start-screen').style.display = 'none';
  $('busted-screen').style.display = 'none';
  $('wasted-screen').style.display = 'none';
  state.mode = 'playing';
  input.requestLock();
  showToast('Welcome to Solmar — find a car with E, or just walk.');
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  $('pause-screen').style.display = 'flex';
  input.releaseLock();
  sfx.setEngine(0, 0);
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  $('pause-screen').style.display = 'none';
  sfx.click();
  input.requestLock();
}

$('start-button').addEventListener('click', startGame);
$('resume-button').addEventListener('click', resumeGame);
$('busted-button').addEventListener('click', () => { location.reload(); });
$('wasted-button').addEventListener('click', () => { location.reload(); });
canvas.addEventListener('click', () => {
  if (state.mode === 'playing') input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Per-frame update ------------------------------------------------------
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;

  if (state.mode === 'playing') {
    // Camera look.
    state.camYaw -= input.mouseDX * 0.0026;
    state.camPitch = clamp(state.camPitch + input.mouseDY * 0.0022, -0.15, 0.9);

    if (input.pause) pauseGame();
    if (input.mute) sfx.setMuted(!sfx.muted);

    if (currentCar) {
      const axis = input.moveAxis();
      updateCar(currentCar, {
        throttle: axis.y,
        steer: -axis.x,
        brake: input.isDown('Space'),
        handbrake: input.isDown('Space'),
      }, dt, city);
      if (currentCar.crashed) sfx.crash(Math.abs(currentCar.speed) / 20);
      sfx.setEngine(Math.abs(currentCar.speed) / currentCar.def.topSpeed, Math.abs(axis.y));
      if (input.interact) {
        // Step out beside the car.
        const carHeading = currentCar.heading;
        currentCar.driver = null;
        player.pos.set(
          currentCar.group.position.x + Math.cos(currentCar.heading) * 2.5,
          0,
          currentCar.group.position.z - Math.sin(currentCar.heading) * 2.5,
        );
        player.group.visible = true;
        currentCar = null;
        state.camYaw = carHeading; // keep looking the way the car faced
        sfx.click();
      }
    } else {
      const axis = input.moveAxis();
      updatePlayer(player, {
        forward: axis.y,
        strafe: axis.x,
        heading: state.camYaw,
        sprint: input.sprint,
        jump: input.jump,
      }, dt, city);
      sfx.setEngine(0, 0);
      if (input.interact) {
        const car = nearestCar(cars, player.pos.x, player.pos.z, CONFIG.cars.enterRadius + 1.5);
        if (car) {
          currentCar = car;
          car.driver = 'player';
          player.group.visible = false;
          sfx.click();
          showToast(`You took the ${car.def.name}. The owner will not be pleased.`);
        }
      }
    }

    // Pedestrians stroll; they shy away from the player and from cars.
    const threats = [{ x: player.pos.x, z: player.pos.z, radius: 6 }];
    if (currentCar) threats.push({ x: currentCar.group.position.x, z: currentCar.group.position.z, radius: 7 });
    for (const ped of peds) updatePedestrian(ped, dt, city, threats);

    // Cruisers: drive their road line and turn around at the city edge.
    for (const cruiser of [cruiserA, cruiserB]) {
      if (cruiser === currentCar) continue;
      const p = cruiser.group.position;
      const forward = Math.abs(Math.sin(cruiser.heading)) > 0.5 ? 'x' : 'z';
      const edge = forward === 'x' ? Math.abs(p.x) > 175 : Math.abs(p.z) > 175;
      updateCar(cruiser, {
        throttle: edge ? -0.4 : 0.45,
        steer: 0,
        brake: false,
        handbrake: false,
      }, dt, city);
      if (edge && Math.abs(cruiser.speed) < 1) cruiser.heading += Math.PI;
    }

    sfx.update(dt);
    updateHUD();
    drawMinimap();
  }

  // Third-person camera: sits behind the focus along its heading and
  // looks forward past it. forward = (sin h, cos h) in world (x, z).
  const focus = currentCar ? currentCar.group.position : player.pos;
  const focusHeading = currentCar ? currentCar.heading : state.camYaw;
  const dist = currentCar ? 10 : 7.5;
  const back = dist * Math.cos(state.camPitch);
  const height = 2.6 + Math.sin(state.camPitch) * 5;
  const fx = Math.sin(focusHeading);
  const fz = Math.cos(focusHeading);
  camera.position.set(focus.x - fx * back, focus.y + height, focus.z - fz * back);
  camTarget.set(focus.x + fx * 2, focus.y + 1.6, focus.z + fz * 2);
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
  input.endFrame();
}

updateHUD();
drawMinimap();
animate();

// Handle for the gameplay session (part 2) and for debugging: the live
// scene graph, city API and state it will extend.
window.solmar = { THREE, scene, camera, renderer, city, cars, peds, player, state, input, sfx, showToast, updateHUD };
