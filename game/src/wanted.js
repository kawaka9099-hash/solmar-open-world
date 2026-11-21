// Solmar — game/src/wanted.js
// Wanted level and police response for Solmar.
//
// Stars come from crime points: stealing a car, hurting pedestrians and
// gunfire add points; points bleed away while the player stays quiet and
// unseen. Police cruisers spawn on the roads (never on top of the player),
// chase the player, ram cars, and bust an on-foot player they corner.
//
// Steering note, verified against the engine: positive steer DECREASES a
// car's heading, and angleDiff(a, b) returns the normalised (b - a). So to
// turn a heading toward a target: diff = angleDiff(heading, desired) and
// steer = -clamp(diff * 2.2). The bust clock is judged ONCE per frame from
// whether ANY cruiser has the player cornered — never once per cruiser,
// or far cruisers cancel the near one and the bust can never trigger.

import { clamp, angleDiff, makeRng } from './util.js';
import { createCar, updateCar } from './vehicles.js';

export const CRIME = {
  stealCar: 40,
  hurtPed: 30,
  killPed: 60,
  shootPed: 45,
  gunfire: 8,
};

const STAR_STEPS = [25, 50, 90, 140, 200]; // points needed for 1..5 stars
const DECAY_PER_SECOND = 3;
const QUIET_BEFORE_DECAY = 8; // seconds without a crime before points bleed
const BUST_TIME = 2.5; // seconds cornered on foot before a bust
const BUST_RANGE = 7; // metres: a cruiser this close counts as cornering
const BUST_MAX_SPEED = 4; // the cornering cruiser must be near-stopped
const MAX_POLICE = 4;
const SPAWN_MIN_DIST = 40;
const SPAWN_MAX_DIST = 90;

// Steer a car toward a world target. Returns the controls object for
// updateCar. Throttle is full ahead unless the caller says otherwise.
export function driveToward(car, tx, tz, throttle = 1) {
  const dx = tx - car.group.position.x;
  const dz = tz - car.group.position.z;
  const desired = Math.atan2(dx, dz);
  const diff = angleDiff(car.heading, desired);
  return {
    throttle,
    steer: clamp(-diff * 2.2, -1, 1),
    brake: false,
    handbrake: false,
  };
}

export class Wanted {
  constructor(scene, THREE, city, sfx) {
    this.scene = scene;
    this.THREE = THREE;
    this.city = city;
    this.sfx = sfx || null;
    this.points = 0;
    this.stars = 0;
    this.police = []; // [{ car, stuck, reverse }]
    this.bustTimer = 0;
    this.sinceCrime = 99;
    this.spawnTimer = 0;
    this.rng = makeRng(987654);
  }

  reset() {
    for (const p of this.police) this.scene.remove(p.car.group);
    this.police = [];
    this.points = 0;
    this.stars = 0;
    this.bustTimer = 0;
    this.sinceCrime = 99;
    if (this.sfx) this.sfx.siren(false);
  }

  addCrime(kind, x, z) {
    const pts = CRIME[kind] || 10;
    this.points = Math.min(260, this.points + pts);
    this.sinceCrime = 0;
    this._recomputeStars();
  }

  // Test and staging helper: set the wanted level directly.
  setStars(n) {
    this.points = n <= 0 ? 0 : STAR_STEPS[clamp(n, 1, STAR_STEPS.length) - 1];
    this.sinceCrime = 0;
    this._recomputeStars();
    // Drop surplus cruisers at once so the fleet matches the new level
    // even when the level is set twice in one frame (the per-frame sync
    // in update() would otherwise leave stale cruisers filling the cap
    // and blocking fresh spawns near the player).
    while (this.police.length > this.stars) this._removeCruiser(this.police.length - 1);
  }

  // Add raw points (alarms, scripted heat). Same star recompute as a crime.
  addPoints(n) {
    this.points = Math.min(260, this.points + n);
    this.sinceCrime = 0;
    this._recomputeStars();
  }

  _recomputeStars() {
    let s = 0;
    for (let i = 0; i < STAR_STEPS.length; i++) {
      if (this.points >= STAR_STEPS[i]) s = i + 1;
    }
    if (s !== this.stars) {
      this.stars = s;
      if (this.sfx) this.sfx.siren(s > 0);
    }
  }

  // A point on a road strip, picked with the seeded rng.
  _roadPoint() {
    const roads = this.city.roads;
    if (!roads || roads.length === 0) return { x: 0, z: 0 };
    const road = roads[Math.floor(this.rng() * roads.length)];
    const half = road.length / 2 - 6;
    if (road.axis === 'x') {
      return { x: road.x + (this.rng() * 2 - 1) * half, z: road.z };
    }
    return { x: road.x, z: road.z + (this.rng() * 2 - 1) * half };
  }

  _spawnCruiser(px, pz) {
    // Spawn on a road that runs past the player, 40–90 m along it, so the
    // cruiser has a clear road to drive down. Spawning on a random road
    // point and driving straight at the player usually crosses a building
    // block, and the cruiser wedges against a wall and never arrives.
    const lines = this.city.roadLines;
    const nearestX = lines.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a));
    const nearestZ = lines.reduce((a, b) => (Math.abs(b - pz) < Math.abs(a - pz) ? b : a));
    const half = 176; // road half-length
    let spot;
    let heading;
    let dir = this.rng() < 0.5 ? 1 : -1;
    const d = SPAWN_MIN_DIST + this.rng() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
    if (this.rng() < 0.5) {
      // The 'x' road at the nearest z line: face back along it.
      let x = px + dir * d;
      if (Math.abs(x) > half) {
        dir = -dir;
        x = px + dir * d;
      }
      x = Math.max(-half, Math.min(half, x));
      spot = { x, z: nearestZ };
      heading = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      // The 'z' road at the nearest x line: face back along it.
      let z = pz + dir * d;
      if (Math.abs(z) > half) {
        dir = -dir;
        z = pz + dir * d;
      }
      z = Math.max(-half, Math.min(half, z));
      spot = { x: nearestX, z };
      heading = dir > 0 ? Math.PI : 0;
    }
    const car = createCar(this.scene, this.THREE, 'police', spot.x, spot.z, heading);
    car.driver = 'police';
    this.police.push({ car, stuck: 0, reverse: 0 });
  }

  _removeCruiser(i) {
    const p = this.police[i];
    this.scene.remove(p.car.group);
    this.police.splice(i, 1);
  }

  // dt seconds. player = { x, z, onFoot, car } — car is the player's car
  // object or null. Returns 'busted' when the player is arrested, else null.
  // onHitPlayer(damage) is called for contact damage while on foot.
  update(dt, player, onHitPlayer) {
    this.sinceCrime += dt;

    // Points bleed away once the player has been quiet a while.
    const nearest = this.police.length
      ? Math.min(...this.police.map((p) => Math.hypot(p.car.group.position.x - player.x, p.car.group.position.z - player.z)))
      : Infinity;
    if (this.sinceCrime > QUIET_BEFORE_DECAY && nearest > 40) {
      this.points = Math.max(0, this.points - DECAY_PER_SECOND * dt);
      this._recomputeStars();
    }

    // Fleet size follows the wanted level.
    const want = Math.min(MAX_POLICE, this.stars);
    this.spawnTimer -= dt;
    if (this.police.length < want && this.spawnTimer <= 0) {
      this._spawnCruiser(player.x, player.z);
      this.spawnTimer = 1.5;
    }
    // Drop surplus cruisers once the heat is off.
    while (this.police.length > want) this._removeCruiser(this.police.length - 1);

    let cornered = false;
    for (let i = this.police.length - 1; i >= 0; i--) {
      const p = this.police[i];
      const car = p.car;
      if (car.wrecked) {
        // Wrecked cruisers leave the pursuit so a fresh one can top up.
        this._removeCruiser(i);
        continue;
      }
      const cx = car.group.position.x;
      const cz = car.group.position.z;
      const dist = Math.hypot(cx - player.x, cz - player.z);
      const speed = Math.abs(car.speed || 0);

      let controls;
      if (p.reverse > 0) {
        p.reverse -= dt;
        const diff = angleDiff(car.heading, Math.atan2(player.x - cx, player.z - cz));
        controls = { throttle: -0.8, steer: clamp(diff * 2.2, -1, 1), brake: false, handbrake: false };
      } else if (player.onFoot) {
        // Controlled approach: target speed scales with distance, so the
        // cruiser arrives slowly enough to stop on the player. A flat full
        // throttle slingshots past at 30 m/s and never gets slow and close
        // enough for a bust; a flat crawl throttle cannot shed the speed
        // it arrives with either.
        const desired = clamp(dist * 0.5, 2, 30);
        const err = desired - speed;
        controls = driveToward(car, player.x, player.z, clamp(err / 8, 0, 1));
        if (speed > desired + 1) {
          controls.throttle = 0;
          controls.brake = true;
        }
        if (dist < 4) {
          controls.throttle = 0;
          controls.brake = true;
          controls.handbrake = true;
        }
      } else {
        controls = driveToward(car, player.x, player.z, 1);
      }
      // Un-wedge: pushing hard but barely moving means stuck on a wall.
      // Gated on throttle so a cruiser that has stopped to corner the
      // player is not mistaken for a wedged one and told to reverse away.
      // The speed cut is 2 m/s: a wedged cruiser grinds along the wall at
      // ~1 m/s, not a full stop.
      if (speed < 2 && dist > BUST_RANGE && controls.throttle > 0.5) {
        p.stuck += dt;
      } else {
        p.stuck = 0;
      }
      if (p.stuck > 1 && p.reverse <= 0) p.reverse = 0.8;
      // updateCar is imported through the vehicle module's own binding.
      updateCar(car, controls, dt, this.city);

      // Ram: contact with the player's car damages it; contact on foot hurts.
      if (dist < BUST_RANGE) {
        if (player.onFoot) {
          if (speed < BUST_MAX_SPEED) cornered = true;
          if (onHitPlayer && speed > 1) onHitPlayer(10 * dt);
        } else if (player.car) {
          player.car.damage = Math.min(100, (player.car.damage || 0) + 6 * dt);
        }
      }
    }

    // The bust clock is judged once per frame, from any cruiser.
    if (player.onFoot && cornered) {
      this.bustTimer += dt;
      if (this.bustTimer >= BUST_TIME) {
        this.bustTimer = 0;
        return 'busted';
      }
    } else {
      this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
    }
    return null;
  }
}
