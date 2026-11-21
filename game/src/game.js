// Solmar — game/src/game.js
// The Game: the state machine and the frame's conductor. It owns the
// phases (menu / playing / paused / busted / wasted), the player's money
// and health, the ambient traffic and pedestrians, and the four subsystems
// (missions, wanted, combat, HUD + save). The boot code in main.js builds
// the world, hands it over as `ctx`, and calls update(dt) every frame;
// this class decides what runs and what the HUD paints.
//
// The shared context `ctx` is one plain object:
//   { THREE, scene, camera, renderer, city, cars, peds, player,
//     driving: { car }, input, sfx, rng }
// Subsystems read it and reach back to the Game through ctx.game, which
// this constructor sets before it builds them.

import { CONFIG } from './config.js';
import { makeRng, pick, range, vec2 } from './util.js';
import { updateCar, carWorldPos } from './vehicles.js';
import { updatePedestrian } from './actors.js';
import { driveToward } from './wanted.js';
import { WantedSystem } from './wanted.js';
import { CombatSystem } from './combat.js';
import { MissionManager } from './missions.js';
import { HUD } from './hud.js';
import { SaveManager } from './save.js';

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.game = this;
    this.phase = 'menu';
    this.money = CONFIG.money.startCash;
    this.health = CONFIG.player.health;
    this.maxHealth = CONFIG.player.health;
    this.time = 0;
    this.muted = false;
    this.threats = []; // { x, z, radius, until } — gunshots and crimes scare peds
    this.traffic = []; // { car, route: [{x,z}], wp, cruise }
    this._trafficRng = makeRng(CONFIG.city.seed + 5);

    this.save = new SaveManager();
    this.hud = new HUD();
    this.wanted = new WantedSystem(ctx);
    this.combat = new CombatSystem(ctx);
    this.missions = new MissionManager(ctx);

    this.hud.setStartButtonLabel(this.save.hasSave() ? 'CONTINUE' : 'START');
    this.hud.showScreen('menu');
  }

  // ---- phases ----

  start() {
    if (this.save.hasSave()) this.loadSave();
    this.phase = 'playing';
    this.ctx.sfx.ensure();
    this.ctx.sfx.setMusic(true);
    this.hud.showScreen('playing');
    this.ctx.input.requestLock();
    if (!this.missions.active && this.missions.nextDef) {
      this.showToast('Lena has work for you — follow the yellow marker to the safehouse', 5000);
    }
  }

  pause() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.hud.showScreen('paused');
    this.ctx.input.releaseLock();
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.hud.showScreen('playing');
    this.ctx.input.requestLock();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.ctx.sfx.setMuted(this.muted);
    this.showToast(this.muted ? 'Sound off' : 'Sound on', 1500);
  }

  busted() {
    if (this.phase !== 'playing') return;
    this.phase = 'busted';
    this.missions.fail('the cops got you');
    this.wanted.clear();
    this.money = Math.max(0, this.money - 100);
    this.autosave();
    this.ctx.sfx.fail();
    this.hud.showScreen('busted');
    this.ctx.input.releaseLock();
  }

  wasted() {
    if (this.phase !== 'playing') return;
    this.phase = 'wasted';
    this.missions.fail('you got wasted');
    this.wanted.clear();
    this.money = Math.floor(this.money * 0.9);
    this.autosave();
    this.ctx.sfx.fail();
    this.hud.showScreen('wasted');
    this.ctx.input.releaseLock();
  }

  // Back on the streets after a bust or a hospital visit.
  respawn() {
    if (this.phase !== 'busted' && this.phase !== 'wasted') return;
    const wasWasted = this.phase === 'wasted';
    // Leave any car behind.
    if (this.ctx.driving.car) {
      this.ctx.driving.car.driver = null;
      this.ctx.driving.car = null;
    }
    const spot = wasWasted ? this.ctx.city.landmarks.hospital : this.ctx.city.landmarks.spawn;
    this.ctx.player.pos.set(spot.x, 0, spot.z);
    this.ctx.player.heading = 0;
    this.ctx.player.group.position.copy(this.ctx.player.pos);
    this.health = this.maxHealth;
    this.phase = 'playing';
    this.hud.showScreen('playing');
    this.ctx.input.requestLock();
    this.showToast(wasWasted ? 'Patched up. The city is still yours to take.' : 'Bail paid. Stay out of trouble — or don\'t.', 4000);
  }

  // ---- player state ----

  damagePlayer(amount) {
    if (this.phase !== 'playing') return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.wasted();
    }
  }

  addMoney(amount) {
    this.money += amount;
  }

  showToast(text, ms) {
    this.hud.showToast(text, ms);
  }

  registerThreat(x, z, radius, seconds) {
    this.threats.push({ x, z, radius, until: this.time + seconds });
  }

  autosave() {
    this.save.save({
      money: this.money,
      ammoMag: this.combat.ammoMag,
      ammoReserve: this.combat.ammoReserve,
      missionIndex: this.missions.index,
      completed: this.missions.completed,
      storyComplete: this.missions.storyComplete,
    });
  }

  loadSave() {
    const data = this.save.load();
    if (!data) return false;
    this.money = data.money;
    this.combat.ammoMag = data.ammoMag;
    this.combat.ammoReserve = data.ammoReserve;
    this.missions.index = Math.min(data.missionIndex, 6);
    this.missions.completed = data.completed;
    this.missions.storyComplete = data.storyComplete;
    return true;
  }

  // ---- traffic ----

  registerTraffic(car) {
    const pos = carWorldPos(car);
    this.traffic.push({
      car,
      route: this._makeRoute(pos.x, pos.z),
      wp: 0,
      cruise: range(this._trafficRng, CONFIG.traffic.cruiseSpeedMin, CONFIG.traffic.cruiseSpeedMax),
    });
  }

  _makeRoute(fromX, fromZ) {
    const city = this.ctx.city;
    const route = [];
    let x = fromX;
    let z = fromZ;
    for (let i = 0; i < 4; i++) {
      const line = pick(this._trafficRng, city.roadLines);
      const along = (this._trafficRng() - 0.5) * (city.bounds.maxX - city.bounds.minX) * 0.85;
      if (i % 2 === 0) {
        x = line;
        z = along;
      } else {
        x = along;
        z = line;
      }
      route.push({ x, z });
    }
    return route;
  }

  // ---- per-frame ----

  update(dt) {
    this.time += dt;
    this.hud.update(this.buildHudView(), dt);
    if (this.phase !== 'playing') return;

    this.threats = this.threats.filter((t) => t.until > this.time);

    // Combat input (edge-triggered keys are consumed here, once a frame).
    const input = this.ctx.input;
    if (input.shoot) this.combat.tryShoot();
    if (input.punch) this.combat.tryPunch();
    if (input.reload) this.combat.startReload();

    this.missions.update(dt);
    this.wanted.update(dt);
    this.combat.update(dt);
    this._updateTraffic(dt);
    this._updatePeds(dt);
  }

  _updateTraffic(dt) {
    const city = this.ctx.city;
    for (const t of this.traffic) {
      const car = t.car;
      if (car.wrecked || car.driver === 'player') continue;
      const target = t.route[t.wp];
      const pos = carWorldPos(car);
      if (vec2.dist(pos.x, pos.z, target.x, target.z) < 7) {
        t.wp += 1;
        if (t.wp >= t.route.length) {
          t.route = this._makeRoute(pos.x, pos.z);
          t.wp = 0;
        }
        continue;
      }
      const controls = driveToward(car, target.x, target.z);
      // Cruise, don't race: ease off once at cruising speed.
      if (car.speed > t.cruise) controls.throttle = 0;
      // Don't rear-end the car ahead.
      for (const other of this.ctx.cars) {
        if (other === car) continue;
        const op = carWorldPos(other);
        const dx = op.x - pos.x;
        const dz = op.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 9 || dist < 0.5) continue;
        const heading = Math.atan2(dx, dz);
        const diff = Math.abs(((heading - car.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff < 0.5) {
          controls.throttle = 0;
          controls.brake = dist < 6;
          break;
        }
      }
      updateCar(car, controls, dt, city);
    }
  }

  _updatePeds(dt) {
    const threats = this.threats.map((t) => ({ x: t.x, z: t.z, radius: t.radius }));
    // Peds also shy away from the player — and from their car.
    threats.push({ x: this.ctx.player.pos.x, z: this.ctx.player.pos.z, radius: 6 });
    if (this.ctx.driving.car) {
      const cp = carWorldPos(this.ctx.driving.car);
      threats.push({ x: cp.x, z: cp.z, radius: 7 });
    }
    for (const ped of this.ctx.peds) {
      if (ped._dead) continue;
      updatePedestrian(ped, dt, this.ctx.city, threats);
    }
  }

  // ---- HUD view ----

  buildHudView() {
    const ctx = this.ctx;
    const driving = ctx.driving.car;
    const mission = this.missions.active
      ? {
          title: this.missions.titleText,
          objective: this.missions.objectiveText,
          distance: this.missions.distanceToTarget(),
        }
      : null;
    return {
      money: this.money,
      health: this.health,
      maxHealth: this.maxHealth,
      ammoMag: this.combat.ammoMag,
      ammoReserve: this.combat.ammoReserve,
      reloading: this.combat.reloading,
      speedMs: driving ? driving.speed : ctx.player.speed || 0,
      wantedStars: this.wanted.stars,
      driving: !!driving,
      mission,
      freeRoamHint: this.missions.storyComplete
        ? 'Story complete — Solmar is yours. Free roam!'
        : this.missions.nextDef
          ? 'Work waits at the safehouse — follow the yellow marker'
          : 'Explore the city',
      player: { x: ctx.player.pos.x, z: ctx.player.pos.z, heading: ctx.player.heading },
      target: this.missions.target,
      police: this.wanted.policePositions(),
      enemies: this.combat.enemyPositions(),
      traffic: this.traffic.filter((t) => !t.car.wrecked).map((t) => carWorldPos(t.car)),
      city: ctx.city,
      crosshairVisible: this.phase === 'playing' && !driving,
    };
  }
}
