// Solmar — game/src/game.js
// The game itself: state machine, player and car control, traffic and
// pedestrians, shooting and punching, police and missions wired together,
// saving, and the third-person camera. The boot (renderer, city, input,
// sound) lives in main.js; this class owns everything that plays.
//
// Heading convention (engine): a heading h faces (sin h, cos h) in world
// x/z, and positive steer DECREASES heading. Mouse right turns the view
// right: camYaw decreases with positive mouseDX.

import { clamp, damp, angleLerp, angleDiff, makeRng, pick, range } from './util.js';
import { createCar, updateCar, nearestCar, carWorldPos } from './vehicles.js';
import { createPlayer, updatePlayer, createPedestrian, updatePedestrian, setPedFleeing } from './actors.js';
import { Wanted, driveToward, CRIME } from './wanted.js';
import { Combat, PISTOL, PUNCH } from './combat.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { Shots } from './shots.js';
import { loadSave, writeSave, defaultSave } from './save.js';

const SHIRTS = [0xd05040, 0x3a7a8a, 0x6a8a3a, 0xe8b820, 0x8a5aa0, 0xdddddd, 0x2a2c30, 0xc07030];
const PANTS = [0x2a344a, 0x3a3a3a, 0x5a4a3a, 0x243028];
const SKINS = [0xe8b88a, 0xc98a5a, 0x8a5a3a, 0xf0c8a0];
const TRAFFIC_TYPES = ['sedan', 'sedan', 'sport', 'truck', 'taxi'];

export class Game {
  // opts: { THREE, scene, camera, renderer, input, sfx, canvas }
  constructor(opts) {
    this.THREE = opts.THREE;
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.renderer = opts.renderer;
    this.input = opts.input;
    this.sfx = opts.sfx;
    this.canvas = opts.canvas;
    this.city = null;

    this.state = {
      mode: 'menu',
      money: 50,
      health: 100,
      ammo: PISTOL.magSize,
      reserve: PISTOL.reserveStart,
      missionIndex: 0,
      storyDone: false,
    };
    this.player = null;
    this.cars = []; // parked + traffic (police live in Wanted)
    this.peds = []; // { ped, alive }
    this.traffic = []; // { car, axis, dir, lane, targetSpeed }
    this.driving = null;
    this.camYaw = 0;
    this.camPitch = 0.32;
    this.lastMouseAt = -99;
    this.elapsed = 0;
    this.fireTimer = 0;
    this.punchTimer = 0;
    this.shotFlash = 0;
    this.saveTimer = 20;
    this.regenAt = 0;
    this.rng = makeRng(20261121);

    this.hud = new HUD();
    this.wanted = null;
    this.combat = null;
    this.missions = null;
    this.shots = null;
  }

  // ---- setup -----------------------------------------------------------

  init(city) {
    this.city = city;
    this.landmarks = city.landmarks;
    this.wanted = new Wanted(this.scene, this.THREE, city, this.sfx);
    this.combat = new Combat(this.scene, this.THREE, city, {
      onPlayerHit: (dmg) => this.damagePlayer(dmg),
      onPickup: (amount) => { this.addMoney(amount); this.hud.toast(`+$${amount}`); },
      onKill: () => { if (this.sfx) this.sfx.success(); },
    });
    this.missions = new Missions(this);
    this.shots = new Shots(this);

    const saved = loadSave();
    if (saved) {
      this.state.money = saved.money;
      this.state.ammo = saved.ammo;
      this.state.reserve = saved.reserve;
      this.state.missionIndex = saved.missionIndex;
      this.state.storyDone = saved.storyDone;
      this.missions.index = saved.missionIndex;
    }

    // Player at the spawn landmark.
    const sp = city.landmarks.spawn;
    this.player = createPlayer(this.scene, this.THREE, sp.x, sp.z);
    this.player.heading = 0;
    this.camYaw = 0;

    // Seven parked cars on the roads, facing along them, one of them by
    // the safehouse so the first job never strands the player without a
    // ride. A parked car facing a random heading drives straight into a
    // building on its first drive — the heading must follow the road.
    this._parkNearLandmark('sedan', city.landmarks.safehouse);
    const spots = this._roadSpots(6);
    const types = ['sedan', 'sport', 'sedan', 'taxi', 'truck', 'sedan'];
    spots.forEach((s, i) => this._parkCar(types[i % types.length], s.x, s.z, s.heading));

    // Ten traffic cars cruising the road lines.
    for (let i = 0; i < 10; i++) this._spawnTraffic();

    // Twenty-six pedestrians strolling the sidewalks.
    for (let i = 0; i < 26; i++) {
      const sw = city.sidewalks[Math.floor(this.rng() * city.sidewalks.length)];
      const x = sw.x + (this.rng() * 2 - 1) * (sw.w / 2);
      const z = sw.z + (this.rng() * 2 - 1) * (sw.d / 2);
      const ped = createPedestrian(this.scene, this.THREE, x, z, {
        shirt: pick(this.rng, SHIRTS),
        pants: pick(this.rng, PANTS),
        skin: pick(this.rng, SKINS),
        speed: range(this.rng, 0.8, 1.6),
      });
      const entry = { ped, alive: true };
      // Tag the meshes so the combat raycast can tell a ped from a wall.
      ped.group.traverse((m) => { m.userData.pedRef = entry; });
      this.peds.push(entry);
    }

    this.refreshHUD();
    this.hud.setMode('menu');
    this.hud.showScreen('start');
  }

  _nearestRoad(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const road of this.city.roads) {
      const d = road.axis === 'x' ? Math.abs(z - road.z) : Math.abs(x - road.x);
      if (d < bestD) { bestD = d; best = road; }
    }
    return best;
  }

  // Park a car on the road nearest a landmark, facing along the road.
  _parkNearLandmark(type, lm) {
    const road = this._nearestRoad(lm.x, lm.z);
    const half = road.length / 2 - 10;
    if (road.axis === 'x') {
      const along = clamp(lm.x - road.x, -half, half);
      return this._parkCar(type, road.x + along, road.z + 5.5, Math.PI / 2);
    }
    const along = clamp(lm.z - road.z, -half, half);
    return this._parkCar(type, road.x + 5.5, road.z + along, 0);
  }

  _roadSpots(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const road = this.city.roads[Math.floor(this.rng() * this.city.roads.length)];
      const half = road.length / 2 - 10;
      const along = (this.rng() * 2 - 1) * half;
      const side = (this.rng() < 0.5 ? -1 : 1) * 5.5;
      const dir = this.rng() < 0.5 ? 1 : -1;
      // Heading follows the road: forward is (sin h, cos h), so facing +X
      // is PI/2 and facing +Z is 0.
      if (road.axis === 'x') {
        out.push({ x: road.x + along, z: road.z + side, heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2 });
      } else {
        out.push({ x: road.x + side, z: road.z + along, heading: dir > 0 ? 0 : Math.PI });
      }
    }
    return out;
  }

  _parkCar(type, x, z, heading) {
    const car = createCar(this.scene, this.THREE, type, x, z, heading);
    car.driver = null;
    car.stolenByPlayer = false;
    this.cars.push(car);
    return car;
  }

  _spawnTraffic() {
    const road = this.city.roads[Math.floor(this.rng() * this.city.roads.length)];
    const half = road.length / 2 - 8;
    const along = (this.rng() * 2 - 1) * half;
    const lane = (this.rng() < 0.5 ? -1 : 1) * 3.5;
    const dir = this.rng() < 0.5 ? 1 : -1;
    const type = pick(this.rng, TRAFFIC_TYPES);
    let car;
    // Face along the road in the direction of travel, or the car starts
    // sideways across its own lane and swerves off the road.
    if (road.axis === 'x') {
      car = createCar(this.scene, this.THREE, type, road.x + along, road.z + lane, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    } else {
      car = createCar(this.scene, this.THREE, type, road.x + lane, road.z + along, dir > 0 ? 0 : Math.PI);
    }
    car.driver = 'traffic';
    this.cars.push(car);
    this.traffic.push({
      car,
      axis: road.axis,
      dir,
      lane: road.axis === 'x' ? road.z + lane : road.x + lane,
      targetSpeed: range(this.rng, 8, 14),
    });
    return car;
  }

  // ---- facade for missions / shots ------------------------------------

  playerPos() {
    if (!this.player) return null;
    return {
      x: this.player.pos.x,
      z: this.player.pos.z,
      heading: this.player.heading,
      onFoot: this.driving === null,
    };
  }

  currentCar() {
    return this.driving;
  }

  addMoney(n) {
    this.state.money = Math.max(0, this.state.money + n);
  }

  addWantedPoints(n) {
    this.wanted.addPoints(n);
  }

  teleport(x, z) {
    if (this.driving) this.exitCar();
    this.player.pos.set(x, 0, z);
    this.player.heading = this.camYaw;
  }

  enterNearestCar() {
    const p = this.playerPos();
    const car = nearestCar(this.cars, p.x, p.z, 5);
    if (!car || car.wrecked) return false;
    this._enterCar(car);
    return true;
  }

  // Make sure a car is within reach of the player (used by the ?shot=
  // stagings so a drive/chase setup never strands the player on foot).
  ensureCarNearPlayer() {
    const p = this.playerPos();
    if (nearestCar(this.cars, p.x, p.z, 5)) return;
    const x = p.x + Math.sin(this.player.heading) * 3;
    const z = p.z + Math.cos(this.player.heading) * 3;
    this._parkCar('sedan', x, z, this.player.heading);
  }

  onMissionDone(def, storyDone) {
    this.state.missionIndex = this.missions.index;
    this.state.storyDone = storyDone;
  }

  saveProgress() {
    writeSave({
      money: this.state.money,
      ammo: this.state.ammo,
      reserve: this.state.reserve,
      missionIndex: this.missions.index,
      completed: [],
      storyDone: this.state.storyDone,
    });
  }

  // ---- mode changes ----------------------------------------------------

  beginPlaying() {
    if (this.state.mode === 'playing') return;
    this.state.mode = 'playing';
    this.hud.showScreen(null);
    this.hud.setMode('playing');
    if (this.sfx) {
      this.sfx.ensure();
      this.sfx.setMusic(true);
    }
    this._lockPointer();
  }

  // Pointer lock needs a user gesture; on a staged load (?shot=...) there
  // is none, and Chrome reports the rejection as a page error unless the
  // promise is caught. The game plays fine without the lock.
  _lockPointer() {
    if (this.canvas && this.canvas.requestPointerLock) {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_e) { /* headless: no lock */ }
    }
  }

  showStart() {
    this.state.mode = 'menu';
    this.hud.setMode('menu');
    this.hud.showScreen('start');
  }

  pauseGame() {
    if (this.state.mode !== 'playing') return;
    this.state.mode = 'paused';
    this.hud.setMode('paused');
    this.hud.showScreen('pause');
    if (document.exitPointerLock) document.exitPointerLock();
  }

  resumeGame() {
    if (this.state.mode !== 'paused') return;
    this.state.mode = 'playing';
    this.hud.showScreen(null);
    this.hud.setMode('playing');
    this._lockPointer();
  }

  damagePlayer(dmg) {
    if (this.state.mode !== 'playing') return;
    this.state.health = Math.max(0, this.state.health - dmg);
    this.regenAt = this.elapsed + 5;
    if (this.state.health <= 0) this.waste();
  }

  bust() {
    const fine = Math.min(this.state.money, 100);
    this.state.money -= fine;
    if (this.driving) this.exitCar();
    this.wanted.reset();
    this.missions.failCurrent();
    this.state.mode = 'busted';
    this.hud.setMode('busted');
    this.hud.showScreen('busted');
    this.hud.toast(`Busted! Fine $${fine}`, 4000);
    if (document.exitPointerLock) document.exitPointerLock();
    this.saveProgress();
    this.refreshHUD();
  }

  waste() {
    this.state.money = Math.floor(this.state.money * 0.9);
    if (this.driving) this.exitCar();
    this.wanted.reset();
    this.missions.failCurrent();
    this.state.mode = 'wasted';
    this.hud.setMode('wasted');
    this.hud.showScreen('wasted');
    if (document.exitPointerLock) document.exitPointerLock();
    this.saveProgress();
    this.refreshHUD();
  }

  respawnAfterBusted() {
    const sh = this.city.landmarks.safehouse;
    this.teleport(sh.x, sh.z);
    this.state.health = 100;
    this.state.mode = 'playing';
    this.hud.showScreen(null);
    this.hud.setMode('playing');
  }

  respawnAfterWasted() {
    const ho = this.city.landmarks.hospital;
    this.teleport(ho.x, ho.z);
    this.state.health = 100;
    this.state.mode = 'playing';
    this.hud.showScreen(null);
    this.hud.setMode('playing');
  }

  // ---- cars ------------------------------------------------------------

  _enterCar(car) {
    const wasTraffic = car.driver === 'traffic';
    // A stolen traffic car leaves the traffic system: the player drives it
    // now. Without this the traffic loop keeps steering it at the same time
    // as the player and the two fight the car off the road.
    if (wasTraffic) this.traffic = this.traffic.filter((t) => t.car !== car);
    const firstTime = !car.stolenByPlayer;
    car.driver = 'player';
    car.stolenByPlayer = true;
    this.driving = car;
    this.player.group.visible = false;
    if (this.sfx) this.sfx.ensure();
    if (firstTime) {
      // Taking a car that is not yours is a crime, and it is loud.
      this.wanted.addCrime('stealCar');
      this.hud.toast(wasTraffic ? 'You stole the car!' : 'You took the car!', 3000);
    }
    this.missions.onEnterCar();
  }

  exitCar() {
    if (!this.driving) return;
    const car = this.driving;
    const side = car.heading + Math.PI / 2;
    const px = car.group.position.x + Math.sin(side) * 2.2;
    const pz = car.group.position.z + Math.cos(side) * 2.2;
    const p = { x: px, z: pz };
    this.city.resolveCircle(p, 0.7);
    this.player.pos.set(p.x, 0, p.z);
    this.player.heading = car.heading;
    this.player.group.visible = true;
    car.driver = null;
    this.driving = null;
  }

  // ---- per-frame -------------------------------------------------------

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    const input = this.input;

    // Pause toggles from anywhere it makes sense.
    if (input.pause) {
      if (this.state.mode === 'playing') this.pauseGame();
      else if (this.state.mode === 'paused') this.resumeGame();
    }
    if (input.mute && this.sfx) this.sfx.setMuted(!this.sfx.muted);

    if (this.state.mode === 'playing') this._updatePlaying(dt);

    // The camera follows in every mode so menus sit over the city.
    this._updateCamera(dt);
    input.endFrame();
  }

  _updatePlaying(dt) {
    const input = this.input;
    const p = this.playerPos();

    // Mouse look.
    if (input.mouseDX !== 0 || input.mouseDY !== 0) {
      this.camYaw -= input.mouseDX * 0.0028;
      this.camPitch = clamp(this.camPitch - input.mouseDY * 0.0022, -0.35, 0.6);
      this.lastMouseAt = this.elapsed;
    }

    // F9 captures a screenshot.
    if (input.justPressed('F9')) this.shots.takeShot();

    // Reload.
    if (input.reload) this._reload();

    // Enter / exit a car.
    if (input.interact) {
      if (this.driving) this.exitCar();
      else this.enterNearestCar();
    }

    if (this.driving) {
      this._updateDriving(dt);
    } else {
      this._updateOnFoot(dt);
    }

    // Combat timers.
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    this.shotFlash = Math.max(0, this.shotFlash - dt);

    // Wanted + police.
    const busted = this.wanted.update(dt, {
      x: p.x, z: p.z, onFoot: this.driving === null, car: this.driving,
    }, (dmg) => this.damagePlayer(dmg));
    if (busted === 'busted') {
      this.bust();
      return;
    }

    // Enemies and pickups.
    this.combat.update(dt, { x: p.x, z: p.z, heading: this.player.heading, onFoot: this.driving === null });

    // Traffic and pedestrians.
    this._updateTraffic(dt);
    this._updatePeds(dt);

    // Missions.
    this.missions.update(dt);

    // Health regen after 5 quiet seconds.
    if (this.state.health < 100 && this.elapsed > this.regenAt) {
      this.state.health = Math.min(100, this.state.health + 5 * dt);
    }

    // Autosave.
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 20;
      this.saveProgress();
    }

    // Engine hum + siren follow the drive.
    if (this.sfx) {
      const rpm = this.driving ? clamp(Math.abs(this.driving.speed) / 40, 0.1, 1) : 0;
      this.sfx.setEngine(rpm, this.driving ? 0.6 : 0);
      this.sfx.update(dt);
    }

    this.refreshHUD();
  }

  _updateOnFoot(dt) {
    const input = this.input;
    const axis = input.moveAxis();
    this.player.heading = this.camYaw;
    updatePlayer(this.player, {
      forward: axis.y,
      strafe: axis.x,
      heading: this.camYaw,
      sprint: input.sprint,
      jump: input.jump,
    }, dt, this.city);

    // Footsteps.
    if ((axis.x !== 0 || axis.y !== 0) && this.sfx && this.elapsed % 0.4 < dt) {
      this.sfx.footstep();
    }

    // Punch.
    if (input.punch && this.punchTimer <= 0) {
      this.punchTimer = PUNCH.cooldown;
      if (this.sfx) this.sfx.punch();
      const hit = this.combat.punch({ x: this.player.pos.x, z: this.player.pos.z, heading: this.player.heading });
      if (!hit) this._punchPed();
    }

    // Pistol: hold to fire.
    if (input.shoot && this.fireTimer <= 0) this._firePistol();
  }

  _punchPed() {
    const p = this.playerPos();
    for (const entry of this.peds) {
      if (!entry.alive) continue;
      const ped = entry.ped;
      const dx = ped.group.position.x - p.x;
      const dz = ped.group.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > PUNCH.range) continue;
      if (Math.abs(angleDiff(this.player.heading, Math.atan2(dx, dz))) > PUNCH.arc / 2) continue;
      setPedFleeing(ped, true);
      this.wanted.addCrime('hurtPed');
      this.hud.toast('Assault! The cops noticed.', 2500);
      return;
    }
  }

  _firePistol() {
    if (this.state.ammo <= 0) {
      if (this.sfx) this.sfx.click();
      this.fireTimer = 0.3;
      this._reload();
      return;
    }
    this.state.ammo--;
    this.fireTimer = PISTOL.fireInterval;
    this.shotFlash = 1.2;
    if (this.sfx) this.sfx.gunshot();

    const origin = new this.THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new this.THREE.Vector3();
    this.camera.getWorldDirection(dir);

    const targets = [];
    for (const e of this.combat.enemies) targets.push({ mesh: e.group, kind: 'enemy', ref: e });
    for (const entry of this.peds) {
      if (entry.alive) targets.push({ mesh: entry.ped.group, kind: 'ped', ref: entry });
    }
    const hit = this.combat.shoot(origin, dir, targets);
    if (hit && hit.kind === 'ped' && hit.ref) {
      // A bystander went down: a serious crime, and the street reacts.
      const entry = hit.ref;
      entry.alive = false;
      entry.ped.group.visible = false;
      this.wanted.addCrime('killPed');
      this.hud.toast('You shot a bystander!', 3000);
      for (const other of this.peds) {
        if (other.alive) setPedFleeing(other.ped, true);
      }
    } else if (hit && hit.kind === 'enemy') {
      // Mission target hit: no crime, the fight is the job.
    } else if (!hit) {
      this.wanted.addCrime('gunfire');
    }

    // Everyone nearby hears the shot.
    for (const entry of this.peds) {
      if (!entry.alive) continue;
      const ped = entry.ped;
      const d = Math.hypot(ped.group.position.x - this.player.pos.x, ped.group.position.z - this.player.pos.z);
      if (d < 25) setPedFleeing(ped, true);
    }
  }

  _reload() {
    if (this.state.ammo >= PISTOL.magSize || this.state.reserve <= 0) return;
    const need = PISTOL.magSize - this.state.ammo;
    const take = Math.min(need, this.state.reserve);
    this.state.ammo += take;
    this.state.reserve -= take;
    if (this.sfx) this.sfx.reload();
  }

  _updateDriving(dt) {
    const input = this.input;
    const axis = input.moveAxis();
    const car = this.driving;
    updateCar(car, {
      throttle: axis.y,
      steer: axis.x,
      brake: input.isDown('Space'),
      handbrake: input.isDown('Space'),
    }, dt, this.city);
    if (car.crashed && this.sfx) this.sfx.crash(0.5);
    if (car.wrecked) {
      this.hud.toast('Your car is wrecked!', 3000);
      this.exitCar();
    }
  }

  _updateTraffic(dt) {
    for (const t of this.traffic) {
      const car = t.car;
      if (car.wrecked) continue;
      const pos = carWorldPos(car);
      // Aim 20 m ahead along the lane, then brake for the car in front.
      const ahead = t.axis === 'x'
        ? { x: pos.x + t.dir * 20, z: t.lane }
        : { x: t.lane, z: pos.z + t.dir * 20 };
      let throttle = 1;
      let brake = false;
      for (const other of this.cars) {
        if (other === car || other.wrecked) continue;
        const op = carWorldPos(other);
        const along = t.axis === 'x' ? (op.x - pos.x) * t.dir : (op.z - pos.z) * t.dir;
        const side = t.axis === 'x' ? Math.abs(op.z - pos.z) : Math.abs(op.x - pos.x);
        if (along > 0 && along < 12 && side < 4) { throttle = 0; brake = true; break; }
      }
      const controls = driveToward(car, ahead.x, ahead.z, throttle);
      controls.brake = brake;
      updateCar(car, controls, dt, this.city);
      // Wrap around the city edge back onto the same road.
      const b = this.city.bounds;
      const p = car.group.position;
      if (t.axis === 'x' && (p.x < b.minX - 10 || p.x > b.maxX + 10)) {
        p.x = t.dir > 0 ? b.minX - 5 : b.maxX + 5;
      } else if (t.axis === 'z' && (p.z < b.minZ - 10 || p.z > b.maxZ + 10)) {
        p.z = t.dir > 0 ? b.minZ - 5 : b.maxZ + 5;
      }
    }
  }

  _updatePeds(dt) {
    const threats = [];
    if (this.shotFlash > 0) {
      threats.push({ x: this.player.pos.x, z: this.player.pos.z, radius: 25 });
    }
    for (const e of this.combat.enemies) threats.push({ x: e.x, z: e.z, radius: 6 });
    for (const entry of this.peds) {
      if (!entry.alive) continue;
      updatePedestrian(entry.ped, dt, this.city, threats);
    }
  }

  _updateCamera(dt) {
    const target = this.driving
      ? this.driving.group.position
      : this.player.pos;
    // While driving, ease the view back behind the car when the mouse rests.
    if (this.driving && this.elapsed - this.lastMouseAt > 1.2) {
      this.camYaw = angleLerp(this.camYaw, this.driving.heading, 1 - Math.exp(-1.5 * dt));
    }
    const dist = this.driving ? 10 : 7.5;
    const height = this.driving ? 4.2 : 3.2;
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const want = {
      x: target.x - fx * dist,
      y: (this.driving ? 0 : target.y) + height,
      z: target.z - fz * dist,
    };
    this.camera.position.x = damp(this.camera.position.x, want.x, 10, dt);
    this.camera.position.y = damp(this.camera.position.y, want.y, 10, dt);
    this.camera.position.z = damp(this.camera.position.z, want.z, 10, dt);
    this.camera.lookAt(target.x + fx * 4, (this.driving ? 0 : target.y) + 1.6, target.z + fz * 4);
  }

  refreshHUD() {
    const p = this.playerPos();
    this.hud.setMoney(this.state.money);
    this.hud.setHealth(this.state.health);
    this.hud.setAmmo(this.state.ammo, this.state.reserve);
    this.hud.setWanted(this.wanted ? this.wanted.stars : 0);
    this.hud.setSpeed(this.driving ? Math.abs(this.driving.speed || 0) : 0);
    if (this.missions) {
      this.hud.setMission(
        this.missions.titleText(),
        this.missions.objectiveText(),
        this.missions.distanceToTarget(),
      );
    }
    if (this.city && p) {
      this.hud.drawMinimap(this.city, {
        player: p,
        mission: this.missions ? this.missions.targetPos() : null,
        police: this.wanted ? this.wanted.police.map((pl) => ({ x: pl.car.group.position.x, z: pl.car.group.position.z })) : [],
        enemies: this.combat ? this.combat.enemies.map((e) => ({ x: e.x, z: e.z })) : [],
        traffic: this.traffic.map((t) => ({ x: t.car.group.position.x, z: t.car.group.position.z })),
      });
    }
  }
}
