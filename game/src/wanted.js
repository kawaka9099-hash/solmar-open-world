// Solmar — game/src/wanted.js
// The wanted level and the police who answer it. Crimes add points, the
// stars decay once the player has been quiet and unseen for a while, and
// the Solmar PD sends patrol cars in proportion to the heat: they chase,
// ram, and — when the player is on foot and cornered — make the bust.
//
// driveToward is also the steering helper the traffic in the main loop
// uses: given a car and a target point it returns the arcade controls
// (throttle / steer / brake) that point the car at the target.

import { CONFIG } from './config.js';
import { clamp, angleDiff, makeRng } from './util.js';
import { createCar, carWorldPos, updateCar } from './vehicles.js';

// Arcade controls that steer `car` toward the point (tx, tz). The car
// physics reads positive steer as a heading decrease (a right turn), so
// a target sitting at a larger heading than the car's needs negative
// steer: the sign here is the opposite of the raw heading difference.
export function driveToward(car, tx, tz) {
  const px = car.group.position.x;
  const pz = car.group.position.z;
  const dx = tx - px;
  const dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  const diff = angleDiff(car.heading, desired);
  const steer = clamp(-diff * 2.2, -1, 1);
  let throttle = 0;
  if (Math.abs(diff) < 0.6) throttle = 1;
  else if (Math.abs(diff) < 1.5) throttle = 0.35;
  if (dist < 12) throttle = Math.min(throttle, 0.4);
  const brake = dist < 4;
  return { throttle: brake ? 0 : throttle, steer, brake, handbrake: false };
}

export class WantedSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.stars = 0; // float, 0..5; the HUD rounds it
    this.police = []; // police cars currently on the hunt
    this.bustTimer = 0;
    this.lastCrimeAt = -999;
    this.time = 0;
    this._spawnCooldown = 0;
    this._rng = makeRng(CONFIG.city.seed + 77);
    this._bustWarned = false;
  }

  get level() {
    return Math.round(this.stars);
  }

  addCrime(type) {
    const points = CONFIG.wanted.crimePoints[type] ?? 1;
    this.stars = Math.min(CONFIG.wanted.maxStars, this.stars + points);
    this.lastCrimeAt = this.time;
  }

  setStars(n) {
    this.stars = clamp(n, 0, CONFIG.wanted.maxStars);
    this.lastCrimeAt = this.time;
  }

  clear() {
    this.stars = 0;
    this.bustTimer = 0;
    this._bustWarned = false;
    for (const car of this.police) this._removeCar(car);
    this.police = [];
  }

  policePositions() {
    return this.police.map((car) => carWorldPos(car));
  }

  update(dt) {
    this.time += dt;
    this._spawnCooldown = Math.max(0, this._spawnCooldown - dt);
    const ctx = this.ctx;
    const playerPos = ctx.player.pos;
    const driving = ctx.driving.car;

    // Heat fades when the player has been quiet and no cruiser is near.
    const nearestCop = this._nearestPoliceDistance(playerPos);
    if (this.stars > 0 && this.time - this.lastCrimeAt > 10 && nearestCop > 70) {
      this.stars = Math.max(0, this.stars - CONFIG.wanted.decayPerSecond * dt);
      if (this.stars < 0.05) this.stars = 0;
    }

    // Match the number of patrol cars to the heat.
    const wantedCount = CONFIG.wanted.policeResponse[clamp(Math.floor(this.stars), 0, 5)] || 0;
    if (this.police.length < wantedCount && this._spawnCooldown <= 0) {
      this._spawnPolice(playerPos);
      this._spawnCooldown = 1.5;
    } else if (this.police.length > wantedCount) {
      // The heat dropped: pull the farthest cruiser off the hunt.
      let farthest = null;
      let farthestDist = -1;
      for (const car of this.police) {
        const p = carWorldPos(car);
        const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
        if (d > farthestDist) {
          farthestDist = d;
          farthest = car;
        }
      }
      if (farthest) this._removeCar(farthest);
    }

    // Every cruiser chases the player.
    const target = driving ? carWorldPos(driving) : { x: playerPos.x, z: playerPos.z };
    for (const car of [...this.police]) {
      if (car.wrecked) {
        // A wrecked cruiser is out of the hunt; leave the wreck on the street.
        this.police.splice(this.police.indexOf(car), 1);
        continue;
      }
      const controls = driveToward(car, target.x, target.z);
      // The hunt never dawdles: full throttle once roughly on course.
      if (Math.abs(angleDiff(car.heading, Math.atan2(target.x - car.group.position.x, target.z - car.group.position.z))) < 0.4) {
        controls.throttle = 1;
      }
      updateCar(car, controls, dt, this.ctx.city);
      const p = carWorldPos(car);
      const distToPlayer = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);

      if (driving) {
        // Ramming the player's car: damage it on contact.
        const carPos = carWorldPos(driving);
        const gap = Math.hypot(p.x - carPos.x, p.z - carPos.z);
        if (gap < 3.4) {
          driving.damage = Math.min(CONFIG.cars.wreckAt, driving.damage + 30 * dt);
          if (Math.random() < dt * 2) this.ctx.sfx.crash(0.5);
        }
      } else if (distToPlayer < CONFIG.wanted.bustRadius) {
        // Cornered on foot: the bust clock runs.
        this.bustTimer += dt;
        if (!this._bustWarned) {
          this._bustWarned = true;
          this.ctx.game.showToast('The cops are on you — RUN!', 3000);
        }
        if (this.bustTimer >= CONFIG.wanted.bustTime) {
          this.bustTimer = 0;
          this._bustWarned = false;
          this.ctx.game.busted();
          return;
        }
      } else if (distToPlayer < 3.2 && car.speed > 3) {
        // Run down by a cruiser.
        if (this.time - (car._lastHitAt || -99) > 1) {
          car._lastHitAt = this.time;
          this.ctx.game.damagePlayer(12);
          this.ctx.sfx.crash(0.6);
        }
      } else {
        this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
        this._bustWarned = false;
      }
    }

    this.ctx.sfx.siren(this.stars >= 1);
  }

  _nearestPoliceDistance(playerPos) {
    let best = Infinity;
    for (const car of this.police) {
      const p = carWorldPos(car);
      best = Math.min(best, Math.hypot(p.x - playerPos.x, p.z - playerPos.z));
    }
    return best;
  }

  _spawnPolice(playerPos) {
    const ctx = this.ctx;
    const city = ctx.city;
    const lines = city.roadLines;
    const snapToRoad = (v) => {
      let best = lines[0];
      let bestD = Math.abs(v - lines[0]);
      for (const line of lines) {
        const d = Math.abs(v - line);
        if (d < bestD) {
          bestD = d;
          best = line;
        }
      }
      return best;
    };
    // Appear on a road 60-90 m from the player, already facing them.
    // Snap one axis onto a road line, then check the range again after
    // clamping: a clamped spawn must never land on the player's toes.
    for (let tries = 0; tries < 10; tries++) {
      const angle = this._rng() * Math.PI * 2;
      const dist = 60 + this._rng() * 30;
      let x = playerPos.x + Math.cos(angle) * dist;
      let z = playerPos.z + Math.sin(angle) * dist;
      if (this._rng() < 0.5) x = snapToRoad(x);
      else z = snapToRoad(z);
      x = clamp(x, city.bounds.minX + 4, city.bounds.maxX - 4);
      z = clamp(z, city.bounds.minZ + 4, city.bounds.maxZ - 4);
      if (Math.hypot(x - playerPos.x, z - playerPos.z) < 50) continue;
      const heading = Math.atan2(playerPos.x - x, playerPos.z - z);
      const car = createCar(ctx.scene, ctx.THREE, 'police', x, z, heading);
      car.driver = 'police';
      ctx.cars.push(car);
      this.police.push(car);
      return;
    }
    // No clear road in range this tick; the cooldown tries again.
  }

  _removeCar(car) {
    const ctx = this.ctx;
    const i = this.police.indexOf(car);
    if (i !== -1) this.police.splice(i, 1);
    const j = ctx.cars.indexOf(car);
    if (j !== -1) ctx.cars.splice(j, 1);
    ctx.scene.remove(car.group);
  }
}
