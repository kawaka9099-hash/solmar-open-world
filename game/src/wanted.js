// Solmar's wanted system: stars 1–5, crimes that raise them, police cars
// and officers on foot that spawn and chase, arrests, and heat that cools
// off when the player stays clean and out of sight.

import { WANTED, PALETTE } from './config.js';
import { Person } from './actors.js';
import { Car, updatePoliceCar } from './vehicles.js';
import { Combat } from './combat.js';
import { dist2D, clamp } from './util.js';

export class WantedSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.stars = 0;
    this.quietTimer = 0;
    this.decayTimer = 0;
    this.spawnTimer = 0;
    this.copCars = [];
    this.cops = [];
    this.hooks = { onBusted: null, onRam: null };
  }

  reset() {
    this.stars = 0;
    this.quietTimer = 0;
    this.decayTimer = 0;
    for (const c of this.copCars) c.remove();
    for (const c of this.cops) c.remove();
    this.copCars = [];
    this.cops = [];
  }

  // A crime was committed: raise the heat and restart the quiet clock.
  addCrime(stars) {
    if (stars <= 0) return;
    this.stars = clamp(this.stars + stars, 0, WANTED.MAX_STARS);
    this.quietTimer = 0;
    this.decayTimer = 0;
  }

  setStars(n) {
    this.stars = clamp(n, 0, WANTED.MAX_STARS);
    this.quietTimer = 0;
    this.decayTimer = 0;
  }

  // Pick a spawn point on a road 130–180 units from the player.
  roadSpawnNear(playerPos, minDist = 120, maxDist = 180) {
    for (let tries = 0; tries < 12; tries++) {
      const road = this.world.roads[Math.floor(Math.random() * this.world.roads.length)];
      const along = (Math.random() - 0.5) * 560;
      const lateral = (Math.random() < 0.5 ? -1 : 1) * 4;
      const x = road.axis === 'x' ? along : road.at + lateral;
      const z = road.axis === 'x' ? road.at + lateral : along;
      const d = dist2D(x, z, playerPos.x, playerPos.z);
      if (d >= minDist && d <= maxDist) {
        const heading = road.axis === 'x' ? (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (Math.random() < 0.5 ? 0 : Math.PI);
        return { x, z, heading };
      }
    }
    return { x: playerPos.x + 140, z: playerPos.z, heading: Math.PI / 2 };
  }

  spawnCopCar(playerPos) {
    const spot = this.roadSpawnNear(playerPos);
    const car = new Car(this.scene, 'police', 0xf0f0f0, spot.x, spot.z, spot.heading);
    car.driver = 'police';
    car.stuckTimer = 0;
    car.unseenTimer = 0;
    Combat.tag(car);
    this.copCars.push(car);
    return car;
  }

  spawnCop(playerPos) {
    const angle = Math.random() * Math.PI * 2;
    const d = 26 + Math.random() * 14;
    const x = playerPos.x + Math.sin(angle) * d;
    const z = playerPos.z + Math.cos(angle) * d;
    const cop = new Person(this.scene, {
      role: 'cop',
      shirt: PALETTE.cop,
      pants: 0x1a2230,
      skin: 0xe8b88a,
      hat: 0x14263e,
      x: Math.max(-300, Math.min(300, x)),
      z: Math.max(-300, Math.min(300, z)),
    });
    cop.arrestTime = 0;
    cop.unseenTimer = 0;
    Combat.tag(cop);
    this.cops.push(cop);
    return cop;
  }

  update(dt, player) {
    const playerPos = player.pos;
    this.quietTimer += dt;
    this.spawnTimer -= dt;

    // A cop can only arrest a player who has stopped: if the player moved
    // since last frame (running away, driving off), the arrest clock resets.
    // Otherwise a foot cop that catches you on the way to your car would
    // bust you the moment you sit down, before you can drive away.
    const moved = this.lastPlayerPos
      ? dist2D(playerPos.x, playerPos.z, this.lastPlayerPos.x, this.lastPlayerPos.z)
      : 0;
    this.lastPlayerPos = { x: playerPos.x, z: playerPos.z };
    if (moved > 0.05) {
      for (const c of this.cops) c.arrestTime = 0;
    }

    // Spawn police while wanted.
    if (this.stars > 0) {
      const wantCars = WANTED.MAX_COP_CARS[this.stars];
      if (this.copCars.length < wantCars && this.spawnTimer <= 0) {
        this.spawnCopCar(playerPos);
        this.spawnTimer = WANTED.COP_SPAWN_INTERVAL;
      }
      const wantCops = WANTED.MAX_COP_FOOT[this.stars];
      if (this.cops.length < wantCops && this.spawnTimer <= -WANTED.COP_SPAWN_INTERVAL + 2) {
        this.spawnCop(playerPos);
      }
    }

    // Heat decay: quiet, and no police close by.
    if (this.stars > 0 && this.quietTimer > WANTED.DECAY_IDLE_SECONDS) {
      let policeNear = false;
      for (const c of this.copCars) {
        if (dist2D(c.pos.x, c.pos.z, playerPos.x, playerPos.z) < 60) { policeNear = true; break; }
      }
      if (!policeNear) {
        for (const c of this.cops) {
          if (dist2D(c.pos.x, c.pos.z, playerPos.x, playerPos.z) < 40) { policeNear = true; break; }
        }
      }
      if (!policeNear) {
        this.decayTimer += dt;
        if (this.decayTimer >= WANTED.DECAY_PER_STAR_SECONDS) {
          this.decayTimer = 0;
          this.stars = Math.max(0, this.stars - 1);
        }
      } else {
        this.decayTimer = 0;
      }
    }

    // Police cars chase and ram.
    for (let i = this.copCars.length - 1; i >= 0; i--) {
      const car = this.copCars[i];
      const dCar = dist2D(car.pos.x, car.pos.z, playerPos.x, playerPos.z);
      // A car that cannot see the player for a while gives up the chase.
      car.unseenTimer = dCar > 130 ? (car.unseenTimer || 0) + dt : 0;
      if (car.unseenTimer > 10) {
        car.remove();
        this.copCars.splice(i, 1);
        continue;
      }
      updatePoliceCar(car, dt, playerPos, this.world.colliders);
      // Ramming the player's car.
      if (player.car && !player.car.wrecked) {
        const d = dist2D(car.pos.x, car.pos.z, player.car.pos.x, player.car.pos.z);
        if (d < 4.2 && Math.abs(car.speed) > 6) {
          if (this.hooks.onRam) this.hooks.onRam(Math.abs(car.speed) / 30);
          player.car.damage(3);
          car.speed *= 0.4;
        }
      }
      // Heat is gone and the car is far away: it leaves.
      if (this.stars === 0 && dist2D(car.pos.x, car.pos.z, playerPos.x, playerPos.z) > 170) {
        car.remove();
        this.copCars.splice(i, 1);
      }
    }

    // Officers on foot run the player down and try to arrest them.
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      if (this.stars === 0) {
        cop.remove();
        this.cops.splice(i, 1);
        continue;
      }
      const d = dist2D(cop.pos.x, cop.pos.z, playerPos.x, playerPos.z);
      // An officer who loses the player for a while gives up.
      cop.unseenTimer = d > 90 ? (cop.unseenTimer || 0) + dt : 0;
      if (cop.unseenTimer > 8) {
        cop.remove();
        this.cops.splice(i, 1);
        continue;
      }
      cop.faceToward(playerPos.x, playerPos.z);
      const inCar = !!player.car;
      const playerSlow = inCar ? Math.abs(player.car.speed) < 3 : true;
      if (d > 2.4) {
        cop.step(dt, WANTED.COP_RUN_SPEED, this.world.colliders);
        cop.arrestTime = 0;
      } else if (playerSlow) {
        cop.idle(dt);
        // An officer only grabs you on foot: a car that is briefly stuck
        // against a wall is not an arrest — the police cars ramming it are
        // already the pressure while you are driving.
        if (!inCar) {
          cop.arrestTime = (cop.arrestTime || 0) + dt;
          if (cop.arrestTime >= WANTED.COP_ARREST_SECONDS) {
            if (this.hooks.onBusted) this.hooks.onBusted();
            return;
          }
        }
      } else {
        cop.step(dt, WANTED.COP_RUN_SPEED, this.world.colliders);
        cop.arrestTime = 0;
      }
    }
  }
}
