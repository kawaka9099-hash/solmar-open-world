// Solmar's game: the orchestrator. It owns the renderer, the camera, the
// player, the traffic, the pedestrians, the pickups and the enemies, and
// wires the subsystems together (world, vehicles, combat, wanted, missions,
// HUD, audio, save). One frame: read input, move the player or their car,
// update the city life, run the active mission, refresh the HUD.

import * as THREE from 'three';
import { CITY, PLACES, PLAYER, CAR, WANTED, CROWD, PICKUPS, ENEMY, MISSIONS, PALETTE } from './config.js';
import { clamp, lerp, dist2D, angleDiff, angleToward, makeRng, pick, rand, formatMoney } from './util.js';
import { SolmarAudio } from './audio.js';
import { SolmarInput } from './input.js';
import { buildCity, resolveCircle, pointBlocked } from './world.js';
import { Person } from './actors.js';
import { Car, TrafficCar } from './vehicles.js';
import { Combat } from './combat.js';
import { WantedSystem } from './wanted.js';
import { MissionRunner } from './missions.js';
import { SolmarHud } from './hud.js';
import { loadSave, writeSave, clearSave, saveSummary } from './save.js';
import { installShotHelpers } from './shots.js';

const SAVE_MISSION_DONE = 7; // nextMission value once all six are done

export class SolmarGame {
  constructor(host, opts = {}) {
    this.host = host;
    this.lowFx = !!opts.lowFx;
    this.time = 0;
    this.mode = 'menu'; // menu | playing | paused | busted | wasted | complete
    this.money = PLAYER.START_MONEY;
    this.ammoReserve = 48;
    this.mag = 12;
    this.magSize = 12;
    this.reloadTimer = 0;
    this.fireTimer = 0;
    this.invulnTimer = 0;
    this.lastMissionId = 0;
    this.autoTarget = null;
    this.autoStuckTimer = 0;
    this.autoImpact = 0;
    this.firstFrameDone = false;
    this.lastCrimeShotAt = -10;
    this.mapTimer = 0;
    this.hudTimer = 0;

    // Renderer.
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.lowFx, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.lowFx ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.lowFx;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(0, 80, 180);

    // Subsystems.
    this.audio = new SolmarAudio();
    this.input = new SolmarInput(this.renderer.domElement);
    this.hud = new SolmarHud();
    this.world = buildCity(this.scene);
    this.combat = new Combat(this.scene);
    this.wanted = new WantedSystem(this.scene, this.world);
    this.missions = new MissionRunner(this.scene);
    this.wanted.hooks.onBusted = () => this.busted();
    this.wanted.hooks.onRam = (s) => {
      this.audio.crash(s);
      this.shake = Math.max(this.shake || 0, s * 0.5);
      this.damagePlayer(3);
    };

    // Camera rig.
    this.camYaw = Math.PI * 0.15;
    this.camPitch = 0.32;
    this.camDistNear = true;
    this.shake = 0;
    this.menuOrbit = 0;

    // The player: Daz Ferran, teal shirt, pistol on his hip.
    this.player = new Person(this.scene, {
      role: 'player', shirt: 0x18a0a8, pants: 0x2c3136, skin: 0xe8b88a, gun: true,
      x: PLACES.spawn.x, z: PLACES.spawn.z, heading: Math.PI,
    });
    this.player.vy = 0;
    this.player.grounded = true;
    this.playerCar = null;

    // Dynamic city life (rebuilt on new game / continue).
    this.traffic = [];
    this.peds = [];
    this.parkedCars = [];
    this.missionCars = {};
    this.enemies = [];
    this.pickups = [];
    this.buildDynamic();

    // Menus.
    this.hud.bindMenu({
      onNewGame: () => this.startNewGame(),
      onContinue: () => this.continueGame(),
      onResume: () => this.togglePause(),
      onSave: () => {
        const ok = this.saveGame();
        this.hud.showPause(ok ? 'Game saved.' : 'Could not save in this browser.');
      },
      onRestartMission: () => {
        this.hud.hidePause();
        if (this.lastMissionId > 0 && !this.missions.completed.has(this.lastMissionId)) {
          this.startMission(this.lastMissionId);
          this.mode = 'playing';
        } else {
          this.mode = 'playing';
        }
      },
      onQuitToMenu: () => this.quitToMenu(),
      onRetry: () => this.retry(),
    });

    // Click the game to lock the mouse while playing.
    this.renderer.domElement.addEventListener('mousedown', () => {
      if (this.mode === 'playing') this.input.requestLock();
    });
    window.addEventListener('resize', () => this.onResize());

    installShotHelpers(this);
    this.hud.showMenu(saveSummary());
    this.hud.setMoney(this.money);
    this.hud.setHealth(this.player.health, PLAYER.HEALTH);
    this.hud.setAmmo(this.mag, this.ammoReserve);
    this.hud.setWanted(0);

    // Autostart for headless playtests: ?autostart=1 starts a new game.
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      setTimeout(() => this.startNewGame(), 300);
    }

    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---- lifecycle ------------------------------------------------------------

  startNewGame() {
    clearSave();
    this.money = PLAYER.START_MONEY;
    this.ammoReserve = 48;
    this.mag = this.magSize;
    this.lastMissionId = 0;
    this.missions.completed.clear();
    this.missions.abort();
    this.wanted.reset();
    this.buildDynamic();
    this.player.rise();
    this.player.place(PLACES.spawn.x, PLACES.spawn.z, Math.PI);
    this.player.vy = 0;
    this.playerCar = null;
    this.camYaw = Math.PI * 0.15;
    this.mode = 'playing';
    this.hud.hideMenu();
    this.hud.hideEnd();
    this.hud.showHud();
    this.audio.init();
    this.audio.resume();
    this.startMission(1);
  }

  continueGame() {
    const data = loadSave();
    if (!data) {
      this.startNewGame();
      return;
    }
    this.money = data.money ?? PLAYER.START_MONEY;
    this.ammoReserve = data.ammoReserve ?? 48;
    this.mag = data.mag ?? this.magSize;
    this.missions.completed = new Set(data.missionsDone ?? []);
    this.missions.abort();
    this.wanted.reset();
    this.buildDynamic();
    this.player.rise();
    this.player.health = data.health ?? PLAYER.HEALTH;
    this.player.place(data.playerX ?? PLACES.spawn.x, data.playerZ ?? PLACES.spawn.z, data.heading ?? Math.PI);
    this.player.vy = 0;
    this.playerCar = null;
    this.mode = 'playing';
    this.hud.hideMenu();
    this.hud.hideEnd();
    this.hud.showHud();
    this.audio.init();
    this.audio.resume();
    const next = data.nextMission ?? 1;
    if (next <= 6) this.startMission(next);
    else this.freeRoamObjective();
  }

  quitToMenu() {
    this.mode = 'menu';
    this.missions.abort();
    this.wanted.reset();
    this.exitCar(true);
    this.hud.hidePause();
    this.hud.hideEnd();
    this.hud.hideHud();
    this.input.releaseLock();
    this.audio.setEngine(false, 0);
    this.audio.setSiren(false);
    this.hud.showMenu(saveSummary());
  }

  togglePause() {
    if (this.mode === 'playing') {
      this.mode = 'paused';
      this.hud.showPause();
      this.input.releaseLock();
      this.audio.setEngine(false, 0);
      this.audio.setSiren(false);
    } else if (this.mode === 'paused') {
      this.mode = 'playing';
      this.hud.hidePause();
      this.audio.resume();
    }
  }

  // ---- missions ---------------------------------------------------------------

  startMission(id) {
    if (id < 1 || id > 6) {
      this.freeRoamObjective();
      return;
    }
    this.clearEnemies();
    this.lastMissionId = id;
    const def = this.missions.start(id, this);
    if (def) {
      this.hud.showMissionCard(def);
      this.audio.pickup();
      this.hud.toast(`Mission ${def.id}: ${def.title} — follow the golden beam`);
    }
  }

  freeRoamObjective() {
    this.hud.setObjectiveKicker('SOLMAR');
    this.hud.setObjectiveText('Explore the city — drive, walk, own it.');
    this.hud.setObjectiveDist(null);
  }

  onMissionPassed(def) {
    this.money += def.reward;
    this.audio.missionPass();
    this.hud.showBigCenter('MISSION PASSED', `+$${formatMoney(def.reward)}`, 'good');
    this.hud.toast(`Mission complete: ${def.title} — $${formatMoney(def.reward)}`);
    this.saveGame();
    if (def.id >= 6) {
      setTimeout(() => {
        if (this.missions.completed.size >= 6 && this.mode === 'playing') {
          this.mode = 'complete';
          this.audio.setEngine(false, 0);
          this.audio.setSiren(false);
          this.input.releaseLock();
          this.hud.showEnd('SOLMAR IS YOURS', `All six missions complete. Hale is finished and the city is yours, Daz. Final payout $${formatMoney(def.reward)} — keep playing in free roam.`, 'gold');
        }
      }, 3200);
      return;
    }
    const next = MISSIONS.find((m) => m.id === def.id + 1);
    setTimeout(() => {
      if (this.mode === 'playing' && !this.missions.active && next) {
        this.hud.toast(`Next mission: ${next.title}`);
        this.startMission(next.id);
      }
    }, 5000);
  }

  onMissionFailed(def, reason) {
    this.audio.missionFail();
    this.hud.showBigCenter('MISSION FAILED', reason, 'bad');
    this.hud.toast('Press P, then Restart Mission, to try again.');
  }

  // ---- busted / wasted ---------------------------------------------------------

  busted() {
    if (this.mode !== 'playing') return;
    this.mode = 'busted';
    this.money = Math.max(0, this.money - 100);
    this.missions.abort();
    this.wanted.reset();
    this.exitCar(true);
    this.audio.busted();
    this.audio.setEngine(false, 0);
    this.audio.setSiren(false);
    this.input.releaseLock();
    this.hud.showEnd('BUSTED', 'The Solmar PD caught you. Bail cost you $100 and the mission is blown — retry it and stay out of sight next time.', 'bad');
  }

  wasted() {
    if (this.mode !== 'playing') return;
    this.mode = 'wasted';
    this.money = Math.max(0, this.money - 100);
    this.missions.abort();
    this.wanted.reset();
    this.exitCar(true);
    this.audio.wasted();
    this.audio.setEngine(false, 0);
    this.audio.setSiren(false);
    this.input.releaseLock();
    this.hud.showEnd('WASTED', 'You ran out of health. The hospital patched you up for $100 and the mission is blown — retry it.', 'bad');
  }

  retry() {
    this.hud.hideEnd();
    this.player.rise();
    this.player.health = PLAYER.HEALTH;
    this.player.place(PLACES.hospital.x, PLACES.hospital.z, 0);
    this.player.vy = 0;
    this.playerCar = null;
    this.mode = 'playing';
    this.hud.showHud();
    this.audio.resume();
    if (this.lastMissionId > 0 && !this.missions.completed.has(this.lastMissionId)) {
      this.startMission(this.lastMissionId);
    } else {
      this.freeRoamObjective();
    }
  }

  // A Manhattan route along the road grid: first to the nearest road, then
  // intersection to intersection, then to the target. Short trips go direct.
  // Road lines only run -288..288: snapping must stay on the grid, or a
  // waypoint past the beach (x=360) can never be reached.
  computeRoute(fx, fz, tx, tz) {
    if (dist2D(fx, fz, tx, tz) < 30) return [{ x: tx, z: tz }];
    const R = (v) => Math.max(-288, Math.min(288, Math.round(v / 72) * 72));
    const wps = [];
    if (Math.abs(fz - R(fz)) <= Math.abs(fx - R(fx))) {
      const rz0 = R(fz);
      const ix0 = R(fx);
      const iz1 = R(tz);
      const ix1 = R(tx);
      wps.push({ x: fx, z: rz0 }, { x: ix0, z: rz0 }, { x: ix0, z: iz1 }, { x: ix1, z: iz1 });
    } else {
      const rx0 = R(fx);
      const iz0 = R(fz);
      const ix1 = R(tx);
      const iz1 = R(tz);
      wps.push({ x: rx0, z: fz }, { x: rx0, z: iz0 }, { x: ix1, z: iz0 }, { x: ix1, z: iz1 });
    }
    wps.push({ x: tx, z: tz });
    return wps;
  }

  // Test-harness driving: follow a road route to a point.
  setAutoDrive(x, z) {
    const px = this.playerCar ? this.playerCar.pos.x : this.player.pos.x;
    const pz = this.playerCar ? this.playerCar.pos.z : this.player.pos.z;
    this.autoTarget = { drive: true, wps: this.computeRoute(px, pz, x, z), wpIndex: 0 };
  }

  // Test-harness walking: follow a road route to a point on foot.
  setAutoWalk(x, z) {
    this.autoTarget = { drive: false, wps: this.computeRoute(this.player.pos.x, this.player.pos.z, x, z), wpIndex: 0 };
  }

  // ---- save ---------------------------------------------------------------------

  saveGame() {
    const next = [1, 2, 3, 4, 5, 6].find((id) => !this.missions.completed.has(id)) ?? SAVE_MISSION_DONE;
    return writeSave({
      money: this.money,
      ammoReserve: this.ammoReserve,
      mag: this.mag,
      health: Math.ceil(this.player.health),
      missionsDone: [...this.missions.completed].sort(),
      nextMission: next,
      // Save the car's position when driving: the person's position is
      // frozen at the spot they got in, and would respawn you there.
      playerX: this.playerCar ? this.playerCar.pos.x : this.player.pos.x,
      playerZ: this.playerCar ? this.playerCar.pos.z : this.player.pos.z,
      heading: this.player.heading,
      savedAt: Date.now(),
    });
  }

  // ---- cars ---------------------------------------------------------------------

  getMissionCar(id) {
    return this.missionCars[id] ?? null;
  }

  allCars() {
    return [
      ...this.parkedCars,
      ...Object.values(this.missionCars),
      ...this.traffic,
      ...this.wanted.copCars,
    ];
  }

  nearestCar(maxDist = 4.5) {
    // The mission's target car wins: the sedan you arrived in is often
    // parked closer than the car the mission wants, and the nearest-car
    // search is what the staging helpers use to enter a car.
    const target = this.missions.targetCar;
    if (target && !target.wrecked && dist2D(this.player.pos.x, this.player.pos.z, target.pos.x, target.pos.z) <= maxDist) {
      return target;
    }
    let best = null;
    let bestD = maxDist;
    for (const car of this.allCars()) {
      if (car.wrecked) continue;
      const d = dist2D(this.player.pos.x, this.player.pos.z, car.pos.x, car.pos.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  tryEnterCar() {
    if (this.playerCar || this.mode !== 'playing') return;
    // A mission step that names a car (steal the sport, take Lena's sedan)
    // always wins the E key: the car you just drove in is usually parked
    // right next to the target, and re-entering it instead of the marked
    // car leaves the step stuck.
    let car = null;
    const target = this.missions.targetCar;
    if (target && !target.wrecked && dist2D(this.player.pos.x, this.player.pos.z, target.pos.x, target.pos.z) <= 4.5) {
      car = target;
    } else {
      car = this.nearestCar();
    }
    if (!car) return;
    // A traffic car has a driver: they bail out and run.
    if (car.driver === 'traffic') {
      car.driver = null;
      this.spawnFleeingDriver(car.pos.x, car.pos.z);
    }
    car.driver = 'player';
    this.playerCar = car;
    this.player.group.visible = false;
    this.audio.click();
    // Stealing a car the city owns is a crime — unless it is Lena's sedan,
    // which she lent you, or a car you have already stolen once.
    const missionCarId = Object.keys(this.missionCars).find((k) => this.missionCars[k] === car);
    if (missionCarId !== 'lena' && !car.stolen) {
      car.stolen = true;
      this.addCrime(1, 'Grand theft auto');
    }
    this.hud.toast(car.kind === 'police' ? 'You took a police car!' : 'Car acquired');
  }

  exitCar(silent = false) {
    if (!this.playerCar) return;
    const car = this.playerCar;
    car.driver = null;
    car.speed *= 0.4;
    this.playerCar = null;
    const side = this.player.heading;
    const x = car.pos.x + Math.sin(side + Math.PI / 2) * 2.4;
    const z = car.pos.z + Math.cos(side + Math.PI / 2) * 2.4;
    this.player.place(x, z, car.heading);
    this.player.pos.y = 0;
    this.player.vy = 0;
    this.player.group.visible = true;
    if (!silent) this.audio.click();
  }

  // ---- combat -------------------------------------------------------------------

  shootTargets() {
    const targets = [
      ...this.enemies,
      ...this.peds,
      ...this.wanted.cops,
      ...this.allCars(),
    ];
    return targets;
  }

  tryShoot() {
    if (this.playerCar || this.fireTimer > 0 || this.reloadTimer > 0) return;
    if (this.mag <= 0) {
      this.startReload();
      return;
    }
    this.fireTimer = PLAYER.PISTOL_RATE;
    this.mag--;
    this.audio.shot();
    this.lastShot = { x: this.player.pos.x, z: this.player.pos.z, t: this.time };
    // Aim level from the player's chest along the camera's yaw. (A ray
    // from the camera dives under distant targets — see combat.shoot.)
    const origin = new THREE.Vector3(this.player.pos.x, 1.2, this.player.pos.z);
    const direction = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const { target } = this.combat.shoot(origin, direction, this.shootTargets());
    // Firing where the police can see it draws heat (throttled).
    if (this.wanted.stars > 0 && this.time - this.lastCrimeShotAt > 3) {
      let copNear = false;
      for (const c of this.wanted.cops) {
        if (dist2D(c.pos.x, c.pos.z, this.player.pos.x, this.player.pos.z) < 45) { copNear = true; break; }
      }
      if (!copNear) {
        for (const c of this.wanted.copCars) {
          if (dist2D(c.pos.x, c.pos.z, this.player.pos.x, this.player.pos.z) < 45) { copNear = true; break; }
        }
      }
      if (copNear) {
        this.lastCrimeShotAt = this.time;
        this.addCrime(1, 'Shots fired');
      }
    }
    if (!target) return;
    if (target instanceof Person) {
      const died = target.damage(PLAYER.PISTOL_DAMAGE);
      if (died) this.onPersonKilled(target);
    } else if (target instanceof Car) {
      const wrecked = target.damage(15);
      if (wrecked) this.onCarWrecked(target);
    }
  }

  tryPunch() {
    if (this.playerCar) return;
    this.audio.punch();
    const targets = [...this.enemies, ...this.peds, ...this.wanted.cops];
    const hit = this.combat.melee(this.player.pos, this.player.heading, targets);
    for (const t of hit) {
      const died = t.damage(PLAYER.PUNCH_DAMAGE);
      if (died) this.onPersonKilled(t);
    }
    // A punch can also dent a car.
    const car = this.nearestCar(2.6);
    if (car) car.damage(5);
  }

  onPersonKilled(person) {
    if (person.role === 'enemy') {
      this.killEnemy(person);
      return;
    }
    if (person.role === 'cop') {
      this.wanted.cops = this.wanted.cops.filter((c) => c !== person);
      this.addCrime(1, 'Officer down');
      this.hud.toast('You took down an officer — the heat is on');
      return;
    }
    if (person.role === 'ped') {
      this.addCrime(1, 'Pedestrian down');
    }
  }

  killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.damage(9999);
    this.missions.registerKill();
    this.audio.coin();
    // A fallen enemy sometimes drops a pickup.
    if (Math.random() < 0.35) {
      this.spawnPickup(Math.random() < 0.5 ? 'health' : 'ammo', enemy.pos.x + 1, enemy.pos.z + 1);
    }
  }

  onCarWrecked(car) {
    this.combat.spawnExplosion(car.pos.x, car.pos.z);
    this.audio.explosion();
    this.shake = Math.max(this.shake || 0, 0.8);
    if (car === this.playerCar) {
      this.damagePlayer(30);
      this.exitCar(true);
    }
    // A wrecked car hurts anyone standing close.
    const d = dist2D(this.player.pos.x, this.player.pos.z, car.pos.x, car.pos.z);
    if (d < 6 && !this.playerCar) this.damagePlayer(20);
  }

  damagePlayer(amount) {
    if (this.mode !== 'playing' || this.invulnTimer > 0) return;
    this.player.health -= amount;
    this.lastDamageAt = this.time;
    this.invulnTimer = 0.7;
    this.hud.flashDamage();
    if (this.player.health <= 0) {
      this.player.health = 0;
      this.wasted();
    }
  }

  addCrime(stars, reason) {
    this.wanted.addCrime(stars);
    this.hud.toast(`${reason} — wanted level ${this.wanted.stars}`);
  }

  startReload() {
    if (this.reloadTimer > 0 || this.mag >= this.magSize || this.ammoReserve <= 0) return;
    this.reloadTimer = 0.8;
    this.audio.click();
  }

  finishReload() {
    const need = this.magSize - this.mag;
    const take = Math.min(need, this.ammoReserve);
    this.mag += take;
    this.ammoReserve -= take;
  }

  // ---- dynamic city life ------------------------------------------------------

  buildDynamic() {
    // Clear the previous round's traffic, people, cars and pickups.
    for (const c of this.traffic) c.remove();
    for (const c of this.parkedCars) c.remove();
    for (const c of Object.values(this.missionCars)) c.remove();
    for (const p of this.peds) p.remove();
    for (const e of this.enemies) e.remove();
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.traffic = [];
    this.parkedCars = [];
    this.missionCars = {};
    this.peds = [];
    this.enemies = [];
    this.pickups = [];
    this.wanted.reset();

    const rng = makeRng(777);
    const carColors = [0xc23b2e, 0x2e6fc2, 0xe8c832, 0x3aa655, 0xe8e8e8, 0x22262c, 0x8a5fc2, 0xe07a28, 0x18a0a8, 0xb03060];

    // Mission cars: Lena's sedan at the garage, the red sport at the lot.
    const lena = new Car(this.scene, 'sedan', 0x18a0a8, -24, 156, Math.PI / 2);
    const sport = new Car(this.scene, 'sport', 0xc23b2e, 112, -238, 0);
    // Mission cars have to survive a police chase: the sport in particular
    // is rammed for the whole drive to the chop shop.
    lena.health = 150;
    // The sport is the getaway car for a five-minute police chase: it
    // has to survive repeated cop-car rams while the player outruns them.
    sport.health = 300;
    Combat.tag(lena);
    Combat.tag(sport);
    this.missionCars = { lena, sport };

    // Parked cars on the lots, away from the mission cars.
    const spots = [...this.world.parkingSpots].sort(() => rng() - 0.5);
    let placed = 0;
    for (const s of spots) {
      if (placed >= 12) break;
      if (dist2D(s.x, s.z, -24, 156) < 7 || dist2D(s.x, s.z, 112, -238) < 7) continue;
      const kinds = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'sport'];
      const car = new Car(this.scene, pick(rng, kinds), pick(rng, carColors), s.x, s.z, s.heading);
      Combat.tag(car);
      this.parkedCars.push(car);
      placed++;
    }

    // Traffic on the road grid.
    for (let i = 0; i < CROWD.TRAFFIC_CARS; i++) {
      const axis = rng() < 0.5 ? 'x' : 'z';
      const line = Math.floor(rng() * 9) * 72 - 288;
      const along = rand(rng, -280, 280);
      const kinds = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'truck', 'sport'];
      const car = new TrafficCar(
        this.scene, pick(rng, kinds), pick(rng, carColors),
        axis === 'x' ? along : line, axis === 'x' ? line : along,
        axis === 'x' ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI),
      );
      Combat.tag(car);
      this.traffic.push(car);
    }

    // Pedestrians on the sidewalks.
    const shirts = [0xd84a4a, 0x4a90d8, 0x7ac74f, 0xe8c832, 0x9a6ad8, 0xe07840, 0x40c8b8, 0xd8d8d8, 0x5a5a6a, 0xc25a8a];
    for (let i = 0; i < CROWD.PEDESTRIANS; i++) {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 12; tries++) {
        x = rand(rng, -290, 290);
        z = rand(rng, -290, 290);
        if (!pointBlocked(x, z, this.world.colliders) && dist2D(x, z, PLACES.spawn.x, PLACES.spawn.z) > 12) break;
      }
      const ped = new Person(this.scene, {
        role: 'ped',
        shirt: pick(rng, shirts),
        pants: pick(rng, [0x2c3136, 0x4a3a2a, 0x3a4a5a, 0x6a6a7a]),
        skin: pick(rng, [0xe8b88a, 0xc98e5f, 0x8a5a34, 0xf0c8a0]),
        x, z, heading: rng() * Math.PI * 2,
      });
      Combat.tag(ped);
      ped.target = { x: rand(rng, -280, 280), z: rand(rng, -280, 280) };
      ped.state = 'walk';
      this.peds.push(ped);
    }

    // Health and ammo pickups around the city.
    for (let i = 0; i < PICKUPS.HEALTH_COUNT; i++) this.spawnPickup('health');
    for (let i = 0; i < PICKUPS.AMMO_COUNT; i++) this.spawnPickup('ammo');
  }

  spawnPickup(kind, x = null, z = null) {
    const rng = makeRng((Math.random() * 1e9) | 0);
    if (x === null || z === null) {
      for (let tries = 0; tries < 12; tries++) {
        x = rand(rng, -290, 290);
        z = rand(rng, -290, 290);
        if (!pointBlocked(x, z, this.world.colliders)) break;
      }
    }
    const mesh = new THREE.Group();
    const color = kind === 'health' ? 0x2fd67a : 0xffd24a;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshBasicMaterial({ color }),
    );
    box.position.y = 0.9;
    mesh.add(box);
    if (kind === 'health') {
      const crossMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.1), crossMat);
      h.position.set(0, 0.9, 0.46);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.1), crossMat);
      v.position.set(0, 0.9, 0.46);
      mesh.add(h, v);
    }
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.pickups.push({ kind, mesh, x, z, active: true, respawnAt: 0 });
  }

  spawnFleeingDriver(x, z) {
    const ped = new Person(this.scene, {
      role: 'ped',
      shirt: 0xd8d8d8,
      pants: 0x2c3136,
      skin: 0xc98e5f,
      x: x + 2, z: z + 2, heading: Math.random() * Math.PI * 2,
    });
    Combat.tag(ped);
    ped.target = { x: x + (Math.random() < 0.5 ? -60 : 60), z: z + (Math.random() < 0.5 ? -60 : 60) };
    ped.state = 'flee';
    ped.fleeUntil = this.time + 4;
    this.peds.push(ped);
  }

  spawnEnemies(x, z, count, boss) {
    const rng = makeRng((Math.random() * 1e9) | 0);
    for (let i = 0; i < count; i++) {
      let ex = x;
      let ez = z;
      for (let tries = 0; tries < 10; tries++) {
        const a = rng() * Math.PI * 2;
        const r = 5 + rng() * 12;
        ex = x + Math.sin(a) * r;
        ez = z + Math.cos(a) * r;
        if (!pointBlocked(ex, ez, this.world.colliders)) break;
      }
      const isBoss = boss && i === count - 1;
      const enemy = new Person(this.scene, {
        role: 'enemy',
        shirt: isBoss ? 0x14141a : PALETTE.thug,
        pants: 0x1a2230,
        skin: pick(rng, [0xe8b88a, 0xc98e5f, 0x8a5a34]),
        hat: isBoss ? 0xd8b93a : 0x8a1a1a,
        scale: isBoss ? 1.12 : 1,
        health: isBoss ? ENEMY.HALE_HEALTH : ENEMY.HEALTH,
        x: ex, z: ez, heading: rng() * Math.PI * 2,
      });
      Combat.tag(enemy);
      enemy.shootTimer = 1 + i * 0.4;
      enemy.isBoss = isBoss;
      this.enemies.push(enemy);
    }
  }

  clearEnemies() {
    for (const e of this.enemies) e.remove();
    this.enemies = [];
  }

  // ---- frame loop ---------------------------------------------------------------

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.08);
    this.time += dt;
    this.world.update(this.time);
    if (this.mode === 'menu') this.updateMenu(dt);
    else if (this.mode === 'playing') this.updatePlaying(dt);
    // paused / busted / wasted / complete: frozen frame, still rendered.
    this.renderer.render(this.scene, this.camera);
    if (!this.firstFrameDone) this.firstFrameDone = true;
    this.input.endFrame();
  }

  updateMenu(dt) {
    this.menuOrbit += dt * 0.035;
    const r = 175;
    this.camera.position.set(
      Math.sin(this.menuOrbit) * r,
      62,
      Math.cos(this.menuOrbit) * r,
    );
    this.camera.lookAt(0, 18, 0);
    this.updateTrafficPeds(dt);
  }

  updatePlaying(dt) {
    const input = this.input;
    const player = this.player;

    // Camera orbit from the mouse.
    const mouse = input.takeMouse();
    this.camYaw += mouse.dx * 0.0032;
    this.camPitch = clamp(this.camPitch + mouse.dy * 0.0028, -0.05, 1.05);

    if (input.wasPressed('KeyP')) { this.togglePause(); return; }
    if (input.wasPressed('KeyM')) {
      this.audio.setMusic(!this.audio.musicOn);
      this.hud.toast(this.audio.musicOn ? 'Music on' : 'Music off');
    }
    if (input.wasPressed('KeyC')) this.camDistNear = !this.camDistNear;
    if (input.wasPressed('KeyR')) this.startReload();
    if (input.wasPressed('KeyF')) this.tryPunch();
    if (input.wasPressed('KeyE')) {
      if (this.playerCar) this.exitCar();
      else this.tryEnterCar();
    }

    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    // Health comes back slowly once the player has been out of trouble for
    // a while — a long chase should not be a slow death by a thousand taps.
    if (this.player.health > 0 && this.player.health < PLAYER.HEALTH && this.time - (this.lastDamageAt || 0) > 6) {
      this.player.health = Math.min(PLAYER.HEALTH, this.player.health + 3 * dt);
    }
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }

    // ---- auto-drive / auto-walk (test harness) --------------------------------
    let autoMove = null;
    if (this.autoTarget) {
      const t = this.autoTarget;
      const px = this.playerCar ? this.playerCar.pos.x : player.pos.x;
      const pz = this.playerCar ? this.playerCar.pos.z : player.pos.z;
      let wp = t.wps[t.wpIndex];
      let d = dist2D(px, pz, wp.x, wp.z);
      let last = t.wpIndex === t.wps.length - 1;
      // Stall: no progress toward this waypoint for 5s means it cannot be
      // reached (a building, a wall) — skip it and carry on.
      if (t.bestD === undefined || d < t.bestD - 0.5) {
        t.bestD = d;
        t.stall = 0;
      } else {
        t.stall = (t.stall || 0) + dt;
        if (t.stall > 5) {
          if (last) {
            this.autoTarget = null;
          } else {
            t.wpIndex++;
            t.bestD = undefined;
            t.stall = 0;
            wp = t.wps[t.wpIndex];
            d = dist2D(px, pz, wp.x, wp.z);
            last = t.wpIndex === t.wps.length - 1;
          }
        }
      }
      if (!this.autoTarget) {
        // Route abandoned.
      } else if (d < (last ? 4 : 7)) {
        if (last) this.autoTarget = null;
        else {
          t.wpIndex++;
          t.bestD = undefined;
          t.stall = 0;
        }
      } else if (t.drive && this.playerCar) {
        const desired = Math.atan2(wp.x - px, wp.z - pz);
        const diff = angleDiff(this.playerCar.heading, desired);
        const steer = clamp(diff * 1.6, -1, 1);
        const throttle = d > 10 ? 1 : 0.4;
        let impact = this.playerCar.drive(dt, throttle, steer, false, this.world.colliders);
        this.autoStuckTimer += dt;
        if (Math.abs(this.playerCar.speed) < 1 && this.autoStuckTimer > 2.5) {
          impact = Math.max(impact, this.playerCar.drive(dt, -0.8, -steer, false, this.world.colliders));
          if (this.autoStuckTimer > 3.4) this.autoStuckTimer = 0;
        } else if (Math.abs(this.playerCar.speed) > 2) {
          this.autoStuckTimer = 0;
        }
        this.autoImpact = impact;
      } else {
        // On foot (or driving somewhere without a car yet): walk there.
        autoMove = { x: wp.x - player.pos.x, z: wp.z - player.pos.z };
      }
    }

    // ---- on foot ------------------------------------------------------------------
    if (!this.playerCar) {
      let mx = 0;
      let mz = 0;
      if (autoMove) {
        const len = Math.hypot(autoMove.x, autoMove.z) || 1;
        mx = autoMove.x / len;
        mz = autoMove.z / len;
      } else {
        const fwd = input.isDown('KeyW') ? 1 : input.isDown('KeyS') ? -1 : 0;
        const strafe = input.isDown('KeyD') ? 1 : input.isDown('KeyA') ? -1 : 0;
        const fx = Math.sin(this.camYaw);
        const fz = Math.cos(this.camYaw);
        const rx = -Math.cos(this.camYaw);
        const rz = Math.sin(this.camYaw);
        mx = fx * fwd + rx * strafe;
        mz = fz * fwd + rz * strafe;
      }
      const moving = Math.hypot(mx, mz) > 0.01;
      const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      const speed = sprint ? PLAYER.SPRINT_SPEED : PLAYER.WALK_SPEED;
      if (moving) {
        const len = Math.hypot(mx, mz);
        mx /= len;
        mz /= len;
        const targetHeading = Math.atan2(mx, mz);
        player.heading = angleToward(player.heading, targetHeading, dt * 12);
        player.group.rotation.y = player.heading;
        const before = player.pos.clone();
        player.pos.x += mx * speed * dt;
        player.pos.z += mz * speed * dt;
        resolveCircle(player.pos, PLAYER.RADIUS, this.world.colliders);
        // Push out of cars.
        for (const car of this.allCars()) {
          const d = dist2D(player.pos.x, player.pos.z, car.pos.x, car.pos.z);
          if (d < CAR.RADIUS + 0.5 && d > 0.01) {
            const push = (CAR.RADIUS + 0.5 - d) / d;
            player.pos.x += (player.pos.x - car.pos.x) * push;
            player.pos.z += (player.pos.z - car.pos.z) * push;
          }
        }
        const moved = Math.hypot(player.pos.x - before.x, player.pos.z - before.z);
        player.walkPhase += moved * 2.4;
        player.group.position.copy(player.pos);
      } else {
        player.idle(dt);
      }
      // Animate the walk cycle from the distance actually covered.
      const { parts } = player;
      const swing = Math.sin(player.walkPhase) * 0.62 * (moving ? 1 : 0);
      parts.leftLeg.rotation.x = swing;
      parts.rightLeg.rotation.x = -swing;
      parts.leftArm.rotation.x = -swing * 0.9;
      parts.rightArm.rotation.x = swing * 0.9;
      // Jump and gravity.
      if (input.wasPressed('Space') && player.grounded) {
        player.vy = PLAYER.JUMP_SPEED;
        player.grounded = false;
      }
      if (!player.grounded) {
        player.vy -= 24 * dt;
        player.pos.y += player.vy * dt;
        if (player.pos.y <= 0) {
          player.pos.y = 0;
          player.vy = 0;
          player.grounded = true;
        }
        player.group.position.y = player.pos.y;
      }
      // Keep inside the world (sand at the east, city edge elsewhere).
      player.pos.x = clamp(player.pos.x, -CITY.WORLD_EDGE, CITY.WORLD_EDGE);
      player.pos.z = clamp(player.pos.z, -CITY.WORLD_EDGE, CITY.WORLD_EDGE);
      player.group.position.copy(player.pos);

      // Shooting with the mouse.
      if (input.consumeClick()) this.tryShoot();
    } else {
      // ---- driving ----------------------------------------------------------------
      const car = this.playerCar;
      let impact = 0;
      if (this.autoTarget) {
        // The auto-driver above already drove the car this frame.
        impact = this.autoImpact || 0;
      } else {
        const throttle = input.isDown('KeyW') ? 1 : input.isDown('KeyS') ? -1 : 0;
        let steer = input.isDown('KeyA') ? -1 : input.isDown('KeyD') ? 1 : 0;
        // Steering is relative to the camera, so flip it when reversing.
        if (car.speed < -0.5) steer = -steer;
        const handbrake = input.isDown('Space');
        impact = car.drive(dt, throttle, steer, handbrake, this.world.colliders);
      }
      if (impact > 0.25) {
        this.audio.crash(impact);
        this.shake = Math.max(this.shake, impact * 0.7);
        this.damagePlayer(impact * 5);
      }
      if (car.wrecked) this.onCarWrecked(car);
      this.audio.setEngine(true, Math.abs(car.speed) / (car.kind === 'sport' ? 47 : 36));
      // Run over pedestrians.
      for (const ped of this.peds) {
        if (ped.down || ped.dead) continue;
        const d = dist2D(car.pos.x, car.pos.z, ped.pos.x, ped.pos.z);
        if (d < 2.4 && Math.abs(car.speed) > 4) {
          ped.fall();
          ped.downUntil = this.time + 4;
          this.addCrime(1, 'Pedestrian run over');
          this.audio.crash(0.4);
        }
      }
    }

    // Traffic cars can run the player over on foot.
    if (!this.playerCar) {
      for (const car of this.traffic) {
        if (car.wrecked) continue;
        const d = dist2D(car.pos.x, car.pos.z, player.pos.x, player.pos.z);
        if (d < 2.6 && Math.abs(car.speed) > 5) {
          this.damagePlayer(15);
          const a = Math.atan2(player.pos.x - car.pos.x, player.pos.z - car.pos.z);
          player.pos.x += Math.sin(a) * 2;
          player.pos.z += Math.cos(a) * 2;
          car.speed *= 0.4;
        }
      }
    }

    this.updateTrafficPeds(dt);
    this.updateEnemies(dt);
    this.updatePickups(dt);
    this.combat.update(dt);
    this.wanted.update(dt, { pos: this.playerCar ? this.playerCar.pos : this.player.pos, car: this.playerCar });
    this.missions.update(dt, this);
    this.audio.setSiren(this.wanted.stars > 0);
    if (!this.playerCar) this.audio.setEngine(false, 0);
    this.updateCamera(dt);
    this.refreshHud(dt);
  }

  updateTrafficPeds(dt) {
    const cars = this.allCars();
    for (const car of this.traffic) {
      car.update(dt, this.world.colliders, cars, this.player.pos);
      // Traffic can knock a pedestrian down too.
      for (const ped of this.peds) {
        if (ped.down || ped.dead) continue;
        const d = dist2D(car.pos.x, car.pos.z, ped.pos.x, ped.pos.z);
        if (d < 2.4 && Math.abs(car.speed) > 4) {
          ped.fall();
          ped.downUntil = this.time + 4;
          car.speed *= 0.5;
        }
      }
    }
    for (const ped of this.peds) {
      if (ped.dead) continue;
      if (ped.down) {
        if (this.time > (ped.downUntil || 0)) ped.rise();
        continue;
      }
      // Danger: a fast car close by, or a recent gunshot.
      let fleeX = 0;
      let fleeZ = 0;
      let fleeing = false;
      if (ped.state === 'flee' && this.time < (ped.fleeUntil || 0)) fleeing = true;
      for (const car of cars) {
        if (car.driver === 'player' && Math.abs(car.speed) > 5) {
          const d = dist2D(car.pos.x, car.pos.z, ped.pos.x, ped.pos.z);
          if (d < 10) {
            fleeX = ped.pos.x - car.pos.x;
            fleeZ = ped.pos.z - car.pos.z;
            fleeing = true;
          }
        }
      }
      if (this.lastShot && this.time - this.lastShot.t < 2) {
        const d = dist2D(this.lastShot.x, this.lastShot.z, ped.pos.x, ped.pos.z);
        if (d < 16) {
          fleeX = ped.pos.x - this.lastShot.x;
          fleeZ = ped.pos.z - this.lastShot.z;
          fleeing = true;
        }
      }
      if (fleeing) {
        const len = Math.hypot(fleeX, fleeZ) || 1;
        ped.heading = Math.atan2(fleeX / len, fleeZ / len);
        ped.step(dt, 5.2, this.world.colliders);
        ped.state = 'flee';
        ped.fleeUntil = this.time + 1.5;
        continue;
      }
      if (ped.state === 'flee' && this.time > (ped.fleeUntil || 0)) ped.state = 'walk';
      // Wander toward the current target; pick a new one on arrival.
      const t = ped.target;
      const d = dist2D(ped.pos.x, ped.pos.z, t.x, t.z);
      if (d < 3) {
        ped.target = { x: (Math.random() - 0.5) * 560, z: (Math.random() - 0.5) * 560 };
        if (Math.random() < 0.3) {
          ped.idle(dt);
          continue;
        }
      }
      ped.faceToward(ped.target.x, ped.target.z);
      ped.step(dt, CROWD.PED_SPEED, this.world.colliders);
    }
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist2D(e.pos.x, e.pos.z, this.player.pos.x, this.player.pos.z);
      if (d > 46) {
        e.idle(dt);
        continue;
      }
      e.faceToward(this.player.pos.x, this.player.pos.z);
      if (d > 16) e.step(dt, ENEMY.MOVE_SPEED, this.world.colliders);
      else e.idle(dt);
      e.shootTimer -= dt;
      if (e.shootTimer <= 0 && d < ENEMY.SHOOT_RANGE && this.mode === 'playing') {
        e.shootTimer = ENEMY.SHOOT_INTERVAL + Math.random() * 0.7;
        const from = new THREE.Vector3(e.pos.x, 1.5, e.pos.z);
        const to = new THREE.Vector3(this.player.pos.x, 1.2, this.player.pos.z);
        this.combat.spawnTracer(from, to);
        this.audio.shot();
        if (Math.random() < ENEMY.HIT_CHANCE) {
          if (this.playerCar) {
            this.playerCar.damage(4);
            if (this.playerCar.wrecked) this.onCarWrecked(this.playerCar);
          } else {
            this.damagePlayer(ENEMY.DAMAGE);
          }
        }
      }
    }
  }

  updatePickups(dt) {
    const reach = this.playerCar ? 3.4 : 2.4;
    for (const p of this.pickups) {
      if (!p.active) {
        if (this.time > p.respawnAt) {
          p.active = true;
          p.mesh.visible = true;
        }
        continue;
      }
      p.mesh.rotation.y += dt * 1.2;
      p.mesh.position.y = Math.sin(this.time * 2 + p.x) * 0.15;
      const d = dist2D(this.player.pos.x, this.player.pos.z, p.x, p.z);
      if (d < reach) {
        p.active = false;
        p.mesh.visible = false;
        p.respawnAt = this.time + PICKUPS.RESPAWN_SECONDS;
        if (p.kind === 'health') {
          this.player.health = Math.min(PLAYER.HEALTH, this.player.health + PICKUPS.HEALTH_VALUE);
          this.hud.toast(`Health +${PICKUPS.HEALTH_VALUE}`);
        } else {
          this.ammoReserve += PICKUPS.AMMO_VALUE;
          this.hud.toast(`Ammo +${PICKUPS.AMMO_VALUE}`);
        }
        this.audio.pickup();
      }
    }
  }

  updateCamera(dt) {
    const target = new THREE.Vector3();
    let dist;
    if (this.playerCar) {
      target.set(this.playerCar.pos.x, 2.2, this.playerCar.pos.z);
      dist = this.camDistNear ? PLAYER.CAMERA_DIST_CAR : 17;
    } else {
      target.set(this.player.pos.x, 1.7, this.player.pos.z);
      dist = this.camDistNear ? PLAYER.CAMERA_DIST_FOOT : 12;
    }
    const horiz = dist * Math.cos(this.camPitch);
    const desired = new THREE.Vector3(
      target.x - Math.sin(this.camYaw) * horiz,
      target.y + dist * Math.sin(this.camPitch) + 0.6,
      target.z - Math.cos(this.camYaw) * horiz,
    );
    const k = 1 - Math.exp(-dt * 9);
    this.camera.position.lerp(desired, k);
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    this.camera.lookAt(target.x, target.y, target.z);
  }

  refreshHud(dt) {
    this.hud.setMoney(this.money);
    this.hud.setHealth(this.player.health, PLAYER.HEALTH);
    this.hud.setAmmo(this.mag, this.ammoReserve);
    this.hud.setWanted(this.wanted.stars);
    this.hud.setCrosshair(!this.playerCar);
    this.hud.showSpeed(this.playerCar ? Math.abs(this.playerCar.speed) * 3.6 : null);

    // Contextual prompt.
    if (!this.playerCar) {
      const car = this.nearestCar(4.5);
      if (car) {
        const missionCarId = Object.keys(this.missionCars).find((k) => this.missionCars[k] === car);
        const label = missionCarId === 'lena' ? "Lena's sedan" : missionCarId === 'sport' ? 'the red sports car' : `the ${car.kind}`;
        this.hud.showPrompt(`<b>E</b> — Get in ${label}`);
      } else if (!this.input.locked) {
        this.hud.showPrompt('Click the game to lock the mouse');
      } else {
        this.hud.showPrompt(null);
      }
    } else if (Math.abs(this.playerCar.speed) < 2) {
      this.hud.showPrompt('<b>E</b> — Get out of the car');
    } else {
      this.hud.showPrompt(null);
    }

    // Objective and minimap, throttled.
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.15;
      const text = this.missions.objectiveText();
      if (text) {
        const def = this.missions.active.def;
        this.hud.setObjectiveKicker(`MISSION ${def.id} — ${def.title.toUpperCase()}`);
        this.hud.setObjectiveText(text);
        const dist = this.missions.distanceTo(this.playerCar ? this.playerCar.pos : this.player.pos);
        const timeLeft = this.missions.active.timer > 0 ? this.missions.active.timer : null;
        this.hud.setObjectiveDist(dist, timeLeft);
      }
      this.hud.setAmmo(this.mag, this.ammoReserve);
    }
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.12;
      this.hud.drawMinimap(this);
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
