// Solmar — game/src/main.js
// BOOT + LOOP (part 2 of 3): boots the scene, builds the city, spawns the
// player, parked cars, traffic and pedestrians, and runs the frame loop:
// player movement on foot and by car, the camera, the engine hum, and the
// Game's subsystems (missions, wanted, combat, HUD, save). The engine
// modules (config, util, input, audio, world, vehicles, actors) are the
// contract; the gameplay modules (game, missions, wanted, combat, hud,
// save, shots) are the rules.
//
// Controls: WASD move / drive, mouse look, Shift sprint, Space jump /
// handbrake, E enter or exit a car, click shoot, F punch, R reload,
// M mute, P pause, F9 save a screenshot.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, makeRng, pick, range, angleLerp } from './util.js';
import { Input } from './input.js';
import { SoundEngine } from './audio.js';
import { buildCity } from './world.js';
import { createCar, updateCar, nearestCar } from './vehicles.js';
import { createPlayer, updatePlayer, createPedestrian } from './actors.js';
import { Game } from './game.js';
import { ShotsHelper } from './shots.js';

// ---- renderer, scene, light ----

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
camera.position.set(0, 60, 120);

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

// ---- world ----

const city = buildCity(scene, THREE);
const rng = makeRng(CONFIG.city.seed);
const spawn = city.landmarks.spawn;

const player = createPlayer(scene, THREE, spawn.x, spawn.z);
player.heading = Math.PI; // face down the road

const input = new Input(canvas);
const sfx = new SoundEngine();

// Parked cars on the roads, one of them a short walk from the spawn so
// the first job never starts with a hike.
const cars = [];
function parkCar(type, x, z, heading) {
  const car = createCar(scene, THREE, type, x, z, heading);
  cars.push(car);
  return car;
}
function roadSpot(nearX, nearZ, minDist) {
  for (let tries = 0; tries < 40; tries++) {
    const line = pick(rng, city.roadLines);
    const along = (rng() - 0.5) * (city.bounds.maxX - city.bounds.minX) * 0.9;
    const onXRoad = rng() < 0.5;
    const x = onXRoad ? along : line + (rng() < 0.5 ? -4.5 : 4.5);
    const z = onXRoad ? line + (rng() < 0.5 ? -4.5 : 4.5) : along;
    if (nearX !== undefined && Math.hypot(x - nearX, z - nearZ) < minDist) continue;
    return { x, z, heading: onXRoad ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI) };
  }
  return { x: spawn.x + 20, z: spawn.z, heading: 0 };
}
{
  const first = roadSpot(spawn.x, spawn.z, 10);
  parkCar('sedan', first.x, first.z, first.heading);
  const types = ['sedan', 'sport', 'truck', 'taxi', 'sedan', 'sport'];
  for (const type of types) {
    const spot = roadSpot(spawn.x, spawn.z, 25);
    parkCar(type, spot.x, spot.z, spot.heading);
  }
}

// Rolling traffic on the roads.
const trafficCars = [];
const trafficTypes = ['sedan', 'taxi', 'sedan', 'truck', 'sport'];
for (let i = 0; i < CONFIG.traffic.count; i++) {
  const spot = roadSpot();
  const car = createCar(scene, THREE, trafficTypes[i % trafficTypes.length], spot.x, spot.z, spot.heading);
  cars.push(car);
  trafficCars.push(car);
}

// Pedestrians on the sidewalks.
const peds = [];
for (let i = 0; i < CONFIG.peds.count; i++) {
  const line = pick(rng, city.roadLines);
  const along = (rng() - 0.5) * (city.bounds.maxX - city.bounds.minX) * 0.9;
  const side = CONFIG.city.roadWidth / 2 + CONFIG.city.sidewalkWidth / 2 + range(rng, -1, 1);
  const onXRoad = rng() < 0.5;
  const x = onXRoad ? along : line + (rng() < 0.5 ? -side : side);
  const z = onXRoad ? line + (rng() < 0.5 ? -side : side) : along;
  peds.push(createPedestrian(scene, THREE, x, z));
}

// ---- game ----

const ctx = {
  THREE,
  scene,
  camera,
  renderer,
  city,
  cars,
  peds,
  player,
  driving: { car: null },
  input,
  sfx,
  rng,
};
const game = new Game(ctx);
const shots = new ShotsHelper(ctx);
for (const car of trafficCars) game.registerTraffic(car);
ctx.renderFrame = () => {
  updateCamera(0);
  renderer.render(scene, camera);
};

// ---- camera ----

let camYaw = 0;
let camPitch = 0.32;
let lastMouseMoveAt = -99;
let menuOrbit = 0;

function updateCamera(dt) {
  const driving = ctx.driving.car;
  if (game.phase === 'menu') {
    // A slow establishing orbit over the spawn for the title screen.
    menuOrbit += dt * 0.05;
    const cx = spawn.x + Math.sin(menuOrbit) * 90;
    const cz = spawn.z + Math.cos(menuOrbit) * 90;
    camera.position.set(cx, 55, cz);
    camera.lookAt(spawn.x, 0, spawn.z);
    return;
  }
  // Third-person: the camera sits behind the focus along its heading and
  // looks forward past it. forward = (sin h, cos h) in world (x, z).
  const focus = driving ? driving.group.position : player.pos;
  let focusHeading;
  if (driving) {
    // Ease the camera behind the car unless the mouse just moved.
    if (game.time - lastMouseMoveAt > 1.5) {
      camYaw = angleLerp(camYaw, driving.heading, 1 - Math.exp(-2.2 * dt));
    }
    focusHeading = camYaw;
  } else {
    focusHeading = camYaw;
  }
  const dist = driving ? 10 : 7.5;
  const back = dist * Math.cos(camPitch);
  const height = 2.6 + Math.sin(camPitch) * 5;
  const fx = Math.sin(focusHeading);
  const fz = Math.cos(focusHeading);
  const desired = new THREE.Vector3(focus.x - fx * back, focus.y + height, focus.z - fz * back);
  desired.y = Math.max(1.4, desired.y);
  if (dt === 0) {
    camera.position.copy(desired);
  } else {
    camera.position.lerp(desired, 1 - Math.exp(-10 * dt));
  }
  camera.lookAt(focus.x + fx * 2, focus.y + 1.6, focus.z + fz * 2);
}

// ---- entering and exiting cars ----

function enterCar(car) {
  if (!car || car.wrecked) return false;
  const gameRef = ctx.game;
  if (car.type === 'police') {
    gameRef.wanted.addCrime('stealCar');
    gameRef.wanted.addCrime('hitPolice');
    gameRef.showToast('You stole a police cruiser!', 3000);
  } else {
    gameRef.wanted.addCrime('stealCar');
    gameRef.showToast('You stole a car!', 2500);
  }
  // Yank a traffic driver out of their car.
  const trafficIndex = gameRef.traffic.findIndex((t) => t.car === car);
  if (trafficIndex !== -1) gameRef.traffic.splice(trafficIndex, 1);
  car.driver = 'player';
  ctx.driving.car = car;
  player.group.visible = false;
  player.pos.set(car.group.position.x, 0, car.group.position.z);
  return true;
}

function exitCar() {
  const car = ctx.driving.car;
  if (!car) return;
  car.driver = null;
  ctx.driving.car = null;
  player.pos.set(
    car.group.position.x + Math.cos(car.heading) * 2.5,
    0,
    car.group.position.z - Math.sin(car.heading) * 2.5,
  );
  city.resolveCircle(player.pos, 0.6);
  player.group.position.copy(player.pos);
  player.group.visible = true;
  player.heading = car.heading;
  camYaw = car.heading; // keep looking the way the car faced
}

ctx.enterCar = enterCar;

// ---- movement ----

function updateMovement(dt) {
  // Mouse look.
  if (input.mouseDX !== 0 || input.mouseDY !== 0) {
    camYaw -= input.mouseDX * 0.0026;
    camPitch = clamp(camPitch + input.mouseDY * 0.0022, -0.15, 0.9);
    lastMouseMoveAt = game.time;
  }

  const driving = ctx.driving.car;
  const axis = input.moveAxis();

  if (driving) {
    const controls = {
      throttle: axis.y,
      steer: axis.x,
      brake: axis.y < 0 && driving.speed > 1,
      handbrake: input.isDown('Space'),
    };
    updateCar(driving, controls, dt, city);
    player.pos.set(driving.group.position.x, 0, driving.group.position.z);
    player.heading = driving.heading;
    if (driving.crashed) sfx.crash(Math.abs(driving.speed) / 20);
    // Engine hum follows speed and throttle.
    const topSpeed = driving.def.topSpeed || 30;
    sfx.setEngine(clamp(Math.abs(driving.speed) / topSpeed, 0, 1), Math.abs(axis.y));
  } else {
    sfx.setEngine(0, 0);
    updatePlayer(player, {
      forward: axis.y,
      strafe: axis.x,
      heading: camYaw,
      sprint: input.sprint,
      jump: input.jump,
    }, dt, city);
    if (axis.y !== 0 || axis.x !== 0) {
      player.heading = camYaw;
    }
  }

  // Enter or exit a car.
  if (input.interact) {
    if (ctx.driving.car) {
      exitCar();
      sfx.click();
    } else {
      const car = nearestCar(cars, player.pos.x, player.pos.z, CONFIG.cars.enterRadius + 1.5);
      if (car) {
        enterCar(car);
        sfx.click();
      }
    }
  }
}

// ---- buttons and keys ----

function bindButton(id, fn) {
  const button = document.getElementById(id);
  if (button) button.addEventListener('click', fn);
}
bindButton('start-button', () => game.start());
bindButton('resume-button', () => game.resume());
bindButton('busted-button', () => game.respawn());
bindButton('wasted-button', () => game.respawn());
canvas.addEventListener('click', () => {
  if (game.phase === 'playing') input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- frame loop ----

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (input.pause) {
    if (game.phase === 'playing') game.pause();
    else if (game.phase === 'paused') game.resume();
  }
  if (input.mute) game.toggleMute();
  if (input.justPressed('F9')) shots.capture('solmar-shot');

  if (game.phase === 'playing') updateMovement(dt);
  game.update(dt);
  updateCamera(dt);
  sfx.update(dt);
  renderer.render(scene, camera);
  input.endFrame();
}

// ---- expose for debugging, tests and the playtest session ----

window.solmar = {
  THREE,
  scene,
  camera,
  renderer,
  city,
  cars,
  peds,
  player,
  state: game,
  input,
  sfx,
  showToast: (text, ms) => game.showToast(text, ms),
  updateHUD: () => game.hud.update(game.buildHudView(), 0.016),
  game,
  missions: game.missions,
  wanted: game.wanted,
  combat: game.combat,
  hud: game.hud,
  save: game.save,
  shots,
  takeShot: (name) => shots.capture(name),
};

updateCamera(0);
renderer.render(scene, camera);
animate();

// A staged screenshot setup (?shot=street|mission|drive|chase|start).
const shotParam = new URLSearchParams(window.location.search).get('shot');
if (shotParam) shots.stage(shotParam);
