// Solmar — game/src/wanted.js
// The wanted level and the Solmar Police response. Stars are a float that
// crimes push up and quiet time wears down; each whole star brings more
// patrol cruisers, and cruisers chase, ram and — when they corner the
// player on foot — bust them.
//
// Two rules the previous build got wrong, fixed here by construction:
//  * the bust clock is judged ONCE per frame from whether ANY cruiser has
//    the player cornered. Per-cruiser add/subtract branches let far
//    cruisers cancel the near one and the clock could never fill.
//  * police spawn on a road line at least 50 m from the player, checked
//    AFTER clamping into the city bounds (clamping first used to drop
//    cruisers right on top of the player at the city edge).

import { CONFIG } from './config.js';
import { clamp, angleDiff, makeRng } from './util.js';
import { createCar, updateCar } from './vehicles.js';

export class WantedSystem {
  constructor(scene, THREE, city, hooks = {}) {
    this.scene = scene;
    this.THREE = THREE;
    this.city = city;
    this.sfx = hooks.sfx ?? null;
    this.onBusted = hooks.onBusted ?? (() => {});
    this.onStarsChange = hooks.onStarsChange ?? (() => {});
    this.rng = makeRng(0x5eed);
    this.points = 0; // float stars; whole stars = Math.floor(points)
    this.lastCrimeAt = -1e9;
    this.bustTimer = 0;
    this.police = []; // cruiser car objects (not in the traffic list)
    this.spawnTimer = 0;
    this._lastLevel = 0;
  }

  get stars() {
    return Math.max(0, Math.min(CONFIG.wanted.maxStars, Math.floor(this.points)));
  }

  get level() {
    return this.stars;
  }

  addCrime(kind, now = 0) {
    const table = CONFIG.wanted.crimePoints;
    const pts = table[kind] ?? 1;
    this.points = Math.min(CONFIG.wanted.maxStars, this.points + pts);
    this.lastCrimeAt = now;
    this._syncLevel();
  }

  // Test / scripted hook (the bank job jumps straight to 3 stars).
  setStars(n, now = 0) {
    this.points = clamp(n, 0, CONFIG.wanted.maxStars);
    this.lastCrimeAt = now;
    this._syncLevel();
  }

  clearAll() {
    this.points = 0;
    this.bustTimer = 0;
    this._removeAllPolice();
    this._syncLevel();
  }

  _syncLevel() {
    const level = this.stars;
    if (level !== this._lastLevel) {
      this._lastLevel = level;
      this.onStarsChange(level);
      if (this.sfx) this.sfx.siren(level > 0);
    }
  }

  _targetCruisers() {
    const table = CONFIG.wanted.policeResponse;
    return table[Math.min(this.stars, table.length - 1)] ?? 0;
  }

  _spawnPolice(playerPos) {
    const lines = this.city.roadLines;
    const bounds = this.city.bounds;
    for (let attempt = 0; attempt < 10; attempt++) {
      // Snap one axis to a road centre line so the cruiser starts on a road.
      const axisX = this.rng() < 0.5;
      const line = lines[Math.floor(this.rng() * lines.length)];
      const along = bounds.minX + this.rng() * (bounds.maxX - bounds.minX);
      const x = axisX ? line : clamp(along, bounds.minX, bounds.maxX);
      const z = axisX ? clamp(along, bounds.minZ, bounds.maxZ) : line;
      const dx = x - playerPos.x;
      const dz = z - playerPos.z;
      // Distance is checked AFTER clamping, so a clamp can never drop a
      // cruiser on the player's head at the city edge.
      if (Math.hypot(dx, dz) < 50) continue;
      // Face into the city, not out at the map edge: a cruiser spawned
      // pointing at the boundary pins itself there (it has no speed to
      // turn with) and never reaches the player.
      const heading = axisX ? (z > 0 ? Math.PI : 0) : (x > 0 ? -Math.PI / 2 : Math.PI / 2);
      const car = createCar(this.scene, this.THREE, 'police', x, z, heading);
      car.driver = 'police';
      this.scene.add(car.group);
      this.police.push(car);
      return car;
    }
    return null;
  }

  _removeAllPolice() {
    for (const car of this.police) this.scene.remove(car.group);
    this.police = [];
  }

  _removeCruiser(car) {
    const i = this.police.indexOf(car);
    if (i >= 0) this.police.splice(i, 1);
    this.scene.remove(car.group);
  }

  // Steer a car toward a point. Verified against the engine: positive steer
  // INCREASES heading, and forward is (sin h, cos h), so the desired
  // heading is atan2(dx, dz) and steer follows the signed angle gap.
  driveToward(car, tx, tz, dt, speedCap = 1) {
    const dx = tx - car.group.position.x;
    const dz = tz - car.group.position.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    // angleDiff(a, b) is b - a, so the gap must be (heading -> desired):
    // angleDiff(car.heading, desired) is positive exactly when the
    // heading has to INCREASE to face the target, which is the steer
    // direction (positive steer increases heading).
    const gap = angleDiff(car.heading, desired);
    const steer = clamp(gap * 2.2, -1, 1);
    const throttle = dist < 6 ? 0 : (Math.abs(gap) > 1.1 ? 0.35 : speedCap);
    // Un-wedge: a cruiser pinned against a building or the map edge has
    // no speed, and heading only follows speed, so it can never turn
    // around on its own — it would grind there forever. If it has been
    // nearly stopped for a second while it wants to move, back it up
    // for a beat (steer inverted, so the nose keeps turning the same
    // way) and it frees itself. Only while far from the target: up
    // close the cruiser is meant to sit still and bust the player.
    if (car._reverseT > 0) {
      car._reverseT -= dt;
      updateCar(car, { throttle: -0.7, steer: -steer, brake: false, handbrake: false }, dt, this.city);
      return dist;
    }
    if (dist > 8 && Math.abs(car.speed) < 1.5) {
      car._stuckT = (car._stuckT ?? 0) + dt;
      if (car._stuckT > 1) {
        car._reverseT = 0.8;
        car._stuckT = 0;
      }
    } else {
      car._stuckT = 0;
    }
    updateCar(car, { throttle, steer, brake: dist < 4, handbrake: false }, dt, this.city);
    return dist;
  }

  update(dt, ctx) {
    const now = ctx.time;
    const playerPos = ctx.playerPos;
    const inCar = !!ctx.inCar;
    const playerCar = ctx.car ?? null;

    // Decay: only while quiet (no crime for a while) and unseen (no
    // cruiser close by). A hot pursuit never cools off on its own.
    const nearestPolice = this.police.length
      ? Math.min(...this.police.map((c) => Math.hypot(c.group.position.x - playerPos.x, c.group.position.z - playerPos.z)))
      : Infinity;
    if (now - this.lastCrimeAt > 10 && nearestPolice > 60 && this.points > 0) {
      this.points = Math.max(0, this.points - CONFIG.wanted.decayPerSecond * dt);
      this._syncLevel();
    }

    // Keep the cruiser count matched to the star level.
    const want = this._targetCruisers();
    this.spawnTimer -= dt;
    if (this.police.length < want && this.spawnTimer <= 0) {
      if (this._spawnPolice(playerPos)) this.spawnTimer = 0.8;
    } else if (this.police.length > want) {
      // Shed the farthest cruisers first when the heat drops.
      this.police.sort((a, b) => {
        const da = Math.hypot(a.group.position.x - playerPos.x, a.group.position.z - playerPos.z);
        const db = Math.hypot(b.group.position.x - playerPos.x, b.group.position.z - playerPos.z);
        return db - da;
      });
      while (this.police.length > want) this._removeCruiser(this.police[0]);
    }

    // Chase + ram. On foot the cruisers close in; in a car they try to
    // cut the player off and shove the player's car.
    for (const cruiser of [...this.police]) {
      // A cruiser that wrecked itself on a building leaves the pursuit,
      // and the fleet top-up above spawns a fresh one in its place.
      if (cruiser.wrecked) {
        this._removeCruiser(cruiser);
        continue;
      }
      const target = playerCar
        ? { x: playerCar.group.position.x, z: playerCar.group.position.z }
        : { x: playerPos.x, z: playerPos.z };
      this.driveToward(cruiser, target.x, target.z, dt, 1);
      if (playerCar) {
        const d = Math.hypot(
          cruiser.group.position.x - playerCar.group.position.x,
          cruiser.group.position.z - playerCar.group.position.z,
        );
        if (d < 3.4) {
          // A ram: scrape speed off the player's car and dent it.
          playerCar.speed *= 1 - 1.6 * dt;
          playerCar.damage = Math.min(100, (playerCar.damage ?? 0) + 6 * dt);
          if (this.sfx && Math.abs(playerCar.speed) > 6 && this.rng() < dt * 2) this.sfx.crash(0.5);
        }
      }
    }

    // Busted: judged ONCE per frame. Any cruiser within bust radius of
    // the on-foot player fills the clock; otherwise it drains fast.
    if (!inCar && this.stars > 0) {
      const cornered = this.police.some((c) => {
        const d = Math.hypot(c.group.position.x - playerPos.x, c.group.position.z - playerPos.z);
        return d <= CONFIG.wanted.bustRadius;
      });
      if (cornered) {
        this.bustTimer += dt;
        if (this.bustTimer >= CONFIG.wanted.bustTime) {
          this.bustTimer = 0;
          this.onBusted();
        }
      } else {
        this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
      }
    } else {
      this.bustTimer = 0;
    }
  }
}
