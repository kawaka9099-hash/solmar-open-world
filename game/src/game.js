// Solmar — game/src/game.js
// The game itself: the menu / playing / paused / busted / wasted state
// machine, the per-frame loop (player and car movement, traffic AI,
// pedestrians, missions, wanted, combat, HUD, autosave), money and health.
//
// Steering, verified against the engine by a headless probe: forward is
// (sin h, cos h), and positive steer INCREASES heading — so turning right
// (heading decreases) takes a negative steer, and driving toward a point
// steers with the signed angle gap, steer = clamp(gap * 2.2).

import { CONFIG } from './config.js';
import { clamp, angleDiff, angleLerp, makeRng } from './util.js';
import { updateCar, nearestCar } from './vehicles.js';
import { updatePlayer, updatePedestrian } from './actors.js';
import { Hud } from './hud.js';
import { WantedSystem } from './wanted.js';
import { CombatSystem } from './combat.js';
import { MissionSystem } from './missions.js';
import { loadSave, writeSave } from './save.js';

function steerCarToward(car, tx, tz, dt, city, speedCap = 1) {
  const dx = tx - car.group.position.x;
  const dz = tz - car.group.position.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  // angleDiff(a, b) is b - a, so the gap must be (heading -> desired):
  // positive exactly when the heading has to INCREASE to face the
  // target, which is the steer direction (positive steer increases
  // heading). The arguments were the wrong way round once and the cars
  // turned away from their targets; the probe caught it.
  const gap = angleDiff(car.heading, desired);
  const steer = clamp(gap * 2.2, -1, 1);
  const throttle = dist < 6 ? 0 : (Math.abs(gap) > 1.1 ? 0.35 : speedCap);
  updateCar(car, { throttle, steer, brake: dist < 4, handbrake: false }, dt, city);
  return dist;
}

export class Game {
  constructor(world) {
    this.scene = world.scene;
    this.camera = world.camera;
    this.THREE = world.THREE;
    this.city = world.city;
    this.player = world.player;
    this.cars = world.cars; // parked + traffic + mission cars (shared array)
    this.traffic = world.traffic; // subset of cars driven by the traffic AI
    this.peds = world.peds;
    this.input = world.input;
    this.sfx = world.sfx;

    this.phase = 'menu';
    this.time = 0;
    this.money = CONFIG.money.startCash;
    this.health = CONFIG.player.health;
    this.camYaw = 0;
    this.ctx = { driving: { car: null } };
    this.muted = false;
    this._autosaveTimer = 0;
    this._stepTimer = 0;
    this._rng = makeRng(0x9a7b);

    this.hud = new Hud(this.city);
    this.wanted = new WantedSystem(this.scene, this.THREE, this.city, {
      sfx: this.sfx,
      onBusted: () => this.busted(),
      onStarsChange: (level) => this.hud.setStars(level),
    });
    this.combat = new CombatSystem(this.scene, this.camera, this.THREE, this.city, {
      sfx: this.sfx,
      onCrime: (kind) => this.addCrime(kind),
      onEnemyKilled: (enemy) => this.missions.onEnemyKilled(enemy),
      onPickup: (amount) => this.addMoney(amount),
    });
    this.combat.setPeds(this.peds);
    this.missions = new MissionSystem(this.scene, this.THREE, this.city, {
      combat: this.combat,
      wanted: this.wanted,
      sfx: this.sfx,
      game: this,
      cars: this.cars,
    });

    // Give every traffic car a route along the road it spawned on.
    for (const car of this.traffic) {
      const alongX = Math.abs(Math.sin(car.heading)) > Math.abs(Math.cos(car.heading));
      car.route = {
        axis: alongX ? 'x' : 'z',
        line: alongX ? car.group.position.z : car.group.position.x,
        dir: alongX ? Math.sign(Math.sin(car.heading)) || 1 : Math.sign(Math.cos(car.heading)) || 1,
        cooldown: 0,
      };
      car.cruise = CONFIG.traffic.cruiseSpeedMin + this._rng() * (CONFIG.traffic.cruiseSpeedMax - CONFIG.traffic.cruiseSpeedMin);
    }

    this._refreshHud();
  }

  // ---- public API used by menus, tests and the mission system ----

  start() {
    if (this.phase !== 'menu') return;
    this.phase = 'playing';
    this.sfx.ensure();
    this.sfx.setMusic(true);
    this.hud.showScreen(null);
    this.hud.setCrosshair(true);
    this.hud.toast('Lena has work — head to the yellow marker at the safehouse', 4200);
    this.sfx.click();
  }

  pause() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.hud.showScreen('pause');
    this.hud.setCrosshair(false);
    this.sfx.click();
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.hud.showScreen(null);
    this.hud.setCrosshair(true);
    this.sfx.click();
  }

  busted() {
    if (this.phase !== 'playing') return;
    const fine = Math.min(100, this.money);
    this.money -= fine;
    this._exitCar();
    this.wanted.clearAll();
    this.missions.fail('busted');
    this.phase = 'busted';
    this.hud.setCrosshair(false);
    this.hud.showScreen('busted');
    this.hud.toast(`Busted — fined $${fine}`, 3600);
    if (this.sfx) this.sfx.fail();
    this._refreshHud();
  }

  wasted() {
    if (this.phase !== 'playing') return;
    const cut = Math.floor(this.money * 0.1);
    this.money -= cut;
    this._exitCar();
    this.wanted.clearAll();
    this.missions.fail('wasted');
    this.phase = 'wasted';
    this.hud.setCrosshair(false);
    this.hud.showScreen('wasted');
    this.hud.toast(`Wasted — the hospital took $${cut}`, 3600);
    if (this.sfx) this.sfx.fail();
    this._refreshHud();
  }

  respawn(kind) {
    const spot = kind === 'wasted' ? this.city.landmarks.hospital : this.city.landmarks.safehouse;
    this.player.pos.set(spot.x, 0, spot.z);
    this.player.group.position.copy(this.player.pos);
    this.player.heading = 0;
    this.camYaw = 0;
    this.health = CONFIG.player.health;
    this.phase = 'playing';
    this.hud.showScreen(null);
    this.hud.setCrosshair(true);
    this._refreshHud();
  }

  addMoney(n) {
    this.money = Math.max(0, this.money + n);
    this.hud.setMoney(this.money);
  }

  addCrime(kind) {
    this.wanted.addCrime(kind, this.time);
    if (kind === 'stealCar') this.hud.toast('You stole the car — the cops are coming', 3000);
  }

  damagePlayer(dmg) {
    if (this.phase !== 'playing') return;
    this.health -= dmg;
    if (this.health <= 0) {
      this.health = 0;
      this.wasted();
    }
    this.hud.setHealth(this.health);
  }

  toast(text, ms) {
    this.hud.toast(text, ms);
  }

  showToast(text, ms) {
    this.hud.toast(text, ms);
  }

  updateHUD() {
    this._refreshHud();
  }

  autosave() {
    writeSave({
      money: this.money,
      ammoMag: this.combat.ammoMag,
      ammoReserve: this.combat.ammoReserve,
      health: this.health,
      missionIndex: this.missions.index,
      completed: this.missions.completed,
      storyDone: this.missions.storyDone,
    });
  }

  loadSave() {
    const data = loadSave();
    if (!data) return false;
    this.money = data.money;
    this.health = data.health;
    this.combat.ammoMag = data.ammoMag;
    this.combat.ammoReserve = data.ammoReserve;
    this.missions.index = data.missionIndex;
    this.missions.completed = data.completed ?? [];
    this.missions.storyDone = !!data.storyDone;
    this._refreshHud();
    return true;
  }

  // ---- per-frame ----

  update(dt) {
    // Keys only reach the game while playing or paused: on the start,
    // busted and wasted screens the buttons do the talking.
    this.input.enabled = this.phase === 'playing' || this.phase === 'paused';
    // Edge-triggered keys are consumed once per frame, whatever the phase,
    // or a press made on a menu would fire again after resuming.
    try {
      if (this.phase === 'playing') this._updatePlaying(dt);
      else if (this.phase === 'menu') this._updateMenu(dt);
    } finally {
      this.input.endFrame();
    }
  }

  _updateMenu(dt) {
    // The city idles behind the start screen: peds stroll, traffic rolls.
    this._updateTraffic(dt);
    this._updatePeds(dt, []);
  }

  _updatePlaying(dt) {
    this.time += dt;
    const input = this.input;

    if (input.pause) { this.pause(); return; }
    if (input.mute) {
      this.muted = !this.muted;
      this.sfx.setMuted(this.muted);
    }
    if (input.reload) this.combat.startReload();
    if (input.punch && !this.ctx.driving.car) this.combat.tryPunch();
    if (input.shoot && !this.ctx.driving.car) this.combat.tryShoot();
    if (input.interact) this._onInteract();

    // Mouse look: moving the mouse right turns the view right, which is
    // a decreasing heading under the (sin h, cos h) convention.
    this.camYaw -= input.mouseDX * 0.0032;
    // (mouseDY is accepted and ignored: fixed third-person pitch.)

    const car = this.ctx.driving.car;
    const axis = input.moveAxis();
    if (car) {
      const throttle = axis.y;
      // D turns right: heading decreases, so steer is negative axis.x.
      const steer = -axis.x;
      const brake = input.isDown('Space');
      const handbrake = brake && input.sprint;
      updateCar(car, { throttle, steer, brake, handbrake }, dt, this.city);
      // The camera recentres behind the car on its own; the mouse can
      // still look around, and the pull wins back gently.
      this.camYaw = angleLerp(this.camYaw, car.heading, 1 - Math.exp(-1.2 * dt));
      if (car.wrecked) {
        this.hud.toast('The car is wrecked — get out', 3000);
        this._exitCar();
      }
      this.sfx.setEngine(Math.min(1, Math.abs(car.speed) / 26), Math.abs(throttle));
    } else {
      this.sfx.setEngine(0, 0);
      const moving = Math.abs(axis.y) > 0 || Math.abs(axis.x) > 0;
      updatePlayer(this.player, {
        forward: axis.y,
        strafe: axis.x,
        heading: this.camYaw,
        sprint: input.sprint,
        jump: input.jump,
      }, dt, this.city);
      if (moving) {
        this._stepTimer -= dt;
        if (this._stepTimer <= 0) {
          this._stepTimer = input.sprint ? 0.28 : 0.42;
          if (this.sfx) this.sfx.footstep();
        }
      }
    }

    this._updateTraffic(dt);
    this._updatePeds(dt, this._threats());
    this.missions.update(dt, this._frameCtx());
    this.wanted.update(dt, this._frameCtx());
    this.combat.update(dt, this._frameCtx());
    this._refreshHud();

    this._autosaveTimer += dt;
    if (this._autosaveTimer > 20) {
      this._autosaveTimer = 0;
      this.autosave();
    }
  }

  _frameCtx() {
    const car = this.ctx.driving.car;
    return {
      time: this.time,
      playerPos: this.player.pos,
      playerHeading: this.camYaw,
      inCar: !!car,
      car,
      carSpeed: car ? car.speed : 0,
      damagePlayer: (dmg) => this.damagePlayer(dmg),
    };
  }

  _threats() {
    const threats = [];
    const car = this.ctx.driving.car;
    if (car && Math.abs(car.speed) > 6) {
      threats.push({ x: car.group.position.x, z: car.group.position.z, radius: 9 });
    }
    if (this.combat.fireTimer > 0.12) {
      threats.push({ x: this.player.pos.x, z: this.player.pos.z, radius: 12 });
    }
    return threats;
  }

  _onInteract() {
    const car = this.ctx.driving.car;
    if (car) {
      this._exitCar();
      return;
    }
    // At the safehouse with no job running, E starts the next job.
    if (!this.missions.active && this.missions.index < 6) {
      const sp = this.missions.startPoint;
      const d = Math.hypot(sp.x - this.player.pos.x, sp.z - this.player.pos.z);
      if (d < 6) {
        this.missions.startNext();
        return;
      }
    }
    const near = nearestCar(this.cars, this.player.pos.x, this.player.pos.z, CONFIG.cars.enterRadius);
    if (!near || near.wrecked) return;
    this.ctx.driving.car = near;
    near.driver = 'player';
    const ti = this.traffic.indexOf(near);
    if (ti >= 0) this.traffic.splice(ti, 1);
    this.player.group.visible = false;
    this.hud.setCrosshair(false);
    this.addCrime('stealCar');
    if (this.sfx) this.sfx.click();
  }

  _exitCar() {
    const car = this.ctx.driving.car;
    if (!car) return;
    this.ctx.driving.car = null;
    car.driver = null;
    // Step out to the car's left, clear of walls.
    const side = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
    this.player.pos.set(car.group.position.x + side.x * 2.2, 0, car.group.position.z + side.z * 2.2);
    this.city.resolveCircle(this.player.pos, 0.6);
    this.player.group.position.copy(this.player.pos);
    this.player.heading = car.heading;
    this.camYaw = car.heading;
    this.player.group.visible = true;
    this.hud.setCrosshair(true);
  }

  _updateTraffic(dt) {
    const bounds = this.city.bounds;
    const lines = this.city.roadLines;
    for (const car of [...this.traffic]) {
      const route = car.route;
      if (!route) continue;
      route.cooldown = Math.max(0, (route.cooldown ?? 0) - dt);
      const px = car.group.position.x;
      const pz = car.group.position.z;
      const pos = route.axis === 'x' ? px : pz;
      const limit = route.dir > 0
        ? (route.axis === 'x' ? bounds.maxX - 18 : bounds.maxZ - 18)
        : (route.axis === 'x' ? bounds.minX + 18 : bounds.minZ + 18);
      const nearEdge = route.dir > 0 ? pos > limit : pos < limit;
      if (nearEdge && route.cooldown <= 0) {
        // Turn onto a cross street at the end of this road.
        const cross = route.axis === 'x' ? 'z' : 'x';
        const near = lines.filter((l) => Math.abs(l - (cross === 'x' ? pz : px)) < 40);
        const line = near.length ? near[Math.floor(this._rng() * near.length)] : lines[Math.floor(this._rng() * lines.length)];
        route.axis = cross;
        route.line = line;
        route.dir = this._rng() < 0.5 ? 1 : -1;
        route.cooldown = 3;
      }
      // Target point ahead on the current road line.
      const ahead = 26;
      const tx = route.axis === 'x' ? px + route.dir * ahead : route.line;
      const tz = route.axis === 'x' ? route.line : pz + route.dir * ahead;
      // Brake for a car ahead on the same line (one physics step only).
      let braking = false;
      for (const other of this.cars) {
        if (other === car || other.wrecked) continue;
        const dx = other.group.position.x - px;
        const dz = other.group.position.z - pz;
        const fwd = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const lat = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
        if (fwd > 0 && fwd < 12 && lat < 3.2) { braking = true; break; }
      }
      if (braking) {
        updateCar(car, { throttle: 0, steer: 0, brake: true, handbrake: false }, dt, this.city);
      } else {
        steerCarToward(car, tx, tz, dt, this.city, car.cruise / 12);
      }
    }
  }

  _updatePeds(dt, threats) {
    for (const ped of this.peds) {
      updatePedestrian(ped, dt, this.city, threats);
    }
  }

  _refreshHud() {
    const hud = this.hud;
    hud.setMoney(this.money);
    hud.setHealth(this.health);
    hud.setAmmo(this.combat.ammoMag, this.combat.ammoReserve);
    const car = this.ctx.driving.car;
    hud.setSpeed(car ? car.speed : 0);
    hud.setStars(this.wanted.stars);
    const mission = this.missions.getHUD(this.player.pos);
    hud.setMission(mission.title, mission.objective, mission.distance);
    hud.drawMinimap({
      playerX: this.player.pos.x,
      playerZ: this.player.pos.z,
      heading: this.camYaw,
      time: this.time,
      mission: this.missions.getTarget(),
      police: this.wanted.police.map((c) => ({ x: c.group.position.x, z: c.group.position.z })),
      enemies: this.combat.enemies.map((e) => ({ x: e.actor.pos.x, z: e.actor.pos.z })),
      traffic: this.traffic.map((c) => ({ x: c.group.position.x, z: c.group.position.z })),
    });
  }
}
