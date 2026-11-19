// The game itself: one state object and one update() that runs it. main.js only
// boots, reads input and paints; shots.js stages scenes by building a game and
// stepping it with scripted input. Nothing here touches the DOM or the canvas.
import {
  CAR, CLOCK, COMBAT, PALETTE, PEDS, PLAYER, STEP, TRAFFIC, WORLD,
} from './config.js';
import { createRandom } from './random.js';
import { createCity } from './world.js';
import { createEntities, makeCar, stepCarPhysics, stepPlayerOnFoot } from './entities.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';

export function createGame(seed) {
  const random = createRandom(seed);
  const city = createCity(random);
  const entities = createEntities(city, random);
  const police = createPolice(city, random);
  const missions = createMissions();
  const combat = createCombat(city, random);

  const state = {
    seed,
    city, entities, police, missions, combat,
    elapsed: 0,
    clockMinutes: CLOCK.startMinutes,
    cash: 250,
    wanted: 0,
    bustProgress: 0,
    message: '',
    messageTimer: 0,
    audioCue: null,
    spawnThugs: false,
    wasted: false,
    busted: false,
    player: {
      x: 640, y: 700, angle: -Math.PI / 2, moving: false,
      health: PLAYER.health, lastDamage: -99,
      car: null, hasPistol: false, ammo: 0,
      shootCooldown: 0, meleeTimer: 0, meleeSwing: 0,
    },
    peds: entities.peds,
    stats: { carsStolen: 0, thugsDown: 0, missionsDone: 0 },
  };

  // Populate the city: traffic, parked cars, pedestrians, pickups.
  for (let i = 0; i < TRAFFIC.count; i += 1) entities.spawnTrafficCar();
  for (let i = 0; i < 10; i += 1) entities.spawnParkedCar();
  for (let i = 0; i < PEDS.count; i += 1) entities.spawnPed();
  combat.spawnPickups();
  missions.start(state);

  function nearestInteractable() {
    const p = state.player;
    const car = entities.nearestCar(p.x, p.y, 52);
    return car;
  }

  function enterCar(car) {
    const p = state.player;
    const wasOccupied = car.occupied && car.kind === 'traffic';
    if (wasOccupied) {
      // Carjacking: the driver bails out and runs.
      const driver = entities.spawnPed(car.x + 20, car.y + 20);
      driver.flee = 3;
      driver.fleeX = car.x;
      driver.fleeY = car.y;
      police.addWanted(state, 1, 'Carjacked in broad daylight!');
      state.stats.carsStolen += 1;
      state.audioCue = 'carjack';
      missions.onEvent(state, 'steal');
    }
    car.kind = 'player';
    car.occupied = true;
    p.car = car;
    p.x = car.x;
    p.y = car.y;
  }

  function exitCar() {
    const p = state.player;
    const car = p.car;
    if (!car) return;
    const side = car.angle + Math.PI / 2;
    p.x = car.x + Math.cos(side) * 30;
    p.y = car.y + Math.sin(side) * 30;
    p.angle = car.angle;
    city.resolveCircle(p, PLAYER.radius);
    car.kind = 'parked';
    car.occupied = false;
    car.speed = 0;
    p.car = null;
  }

  function tryInteract() {
    const p = state.player;
    if (p.car) { exitCar(); return; }
    const s = missions.currentStep();
    if (s && s.kind === 'pickup') {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < 70) {
        missions.onEvent(state, 'pickup');
        state.audioCue = 'pickup';
        return;
      }
    }
    const car = nearestInteractable();
    if (car) enterCar(car);
  }

  function hitByTraffic(dt) {
    const p = state.player;
    if (p.car) return;
    for (const car of entities.cars) {
      if (car.kind !== 'traffic') continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < 24) {
        p.health -= 8 * dt * 10;
        p.lastDamage = state.elapsed;
        const dx = p.x - car.x;
        const dy = p.y - car.y;
        const len = Math.hypot(dx, dy) || 1;
        p.x += (dx / len) * 90 * dt;
        p.y += (dy / len) * 90 * dt;
        city.resolveCircle(p, PLAYER.radius);
      }
    }
  }

  function carCollisions(dt) {
    const p = state.player;
    if (!p.car) return;
    const car = p.car;
    for (const other of entities.cars) {
      if (other === car || other.kind === 'police') continue;
      const d = Math.hypot(other.x - car.x, other.y - car.y);
      if (d < 38 && d > 0.01) {
        const overlap = 38 - d;
        const nx = (car.x - other.x) / d;
        const ny = (car.y - other.y) / d;
        // Shove the other car fully out of the way; the player keeps its line,
        // so a stopped car at a junction cannot pin the player's speed to zero.
        other.x -= nx * (overlap + 2);
        other.y -= ny * (overlap + 2);
        car.x += nx;
        car.y += ny;
        const impact = Math.abs(car.speed);
        car.crashCooldown = Math.max(0, (car.crashCooldown || 0) - dt);
        if (impact > 200 && car.crashCooldown <= 0) {
          car.crashCooldown = 0.5;
          car.speed *= 0.6;
          car.health -= (impact - 200) * 0.06;
          state.audioCue = 'hurt';
        }
        if (other.kind === 'traffic') other.speed *= 0.5;
      }
    }
    // Pedestrians in the way of a fast car get hit — and the law notices.
    for (let i = entities.peds.length - 1; i >= 0; i -= 1) {
      const ped = entities.peds[i];
      const d = Math.hypot(ped.x - car.x, ped.y - car.y);
      if (d < 24 && Math.abs(car.speed) > 120) {
        entities.peds.splice(i, 1);
        entities.spawnPed();
        police.addWanted(state, 1, 'You hit a pedestrian!');
        state.audioCue = 'hurt';
      } else if (d < 30) {
        ped.flee = 1.5;
        ped.fleeX = car.x;
        ped.fleeY = car.y;
      }
    }
    void dt;
  }

  function update(input, dt) {
    const p = state.player;
    state.elapsed += dt;
    state.clockMinutes = (state.clockMinutes + dt * CLOCK.minutesPerSecond) % (24 * 60);
    if (state.messageTimer > 0) state.messageTimer -= dt;

    // Driving or walking.
    if (p.car) {
      const car = p.car;
      const throttle = (input.up ? 1 : 0) + (input.down ? -1 : 0);
      const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      const before = { x: car.x, y: car.y };
      stepCarPhysics(car, throttle, steer, input.handbrake, dt);
      const scrape = city.resolveCircle(car, CAR.radius);
      if (scrape) {
        // Scraped a building: the push slides the car along the wall. The
        // speed cut is cooldown-gated, so a shallow scrape cannot pin the
        // car to a crawl the way a per-frame cut would.
        const hitSpeed = Math.abs(car.speed);
        car.scrapeCooldown = Math.max(0, (car.scrapeCooldown || 0) - dt);
        if (hitSpeed > 200 && car.scrapeCooldown <= 0) {
          car.scrapeCooldown = 0.5;
          car.speed *= 0.55;
          car.health -= (hitSpeed - 200) * 0.05;
          state.audioCue = 'hurt';
        }
        void before;
      }
      if (city.onSand(car.x, car.y)) car.speed *= (1 - 0.5 * dt);
      if (city.inWater(car.x, car.y)) {
        // Drove into the sea: the car is done, swim out.
        car.health = 0;
        car.speed = 0;
        car.x = 3460;
        exitCar();
        state.message = 'You drove into the sea. The car is gone.';
        state.messageTimer = 3;
      }
      if (car.health <= 0 && car.speed !== 0) car.speed *= (1 - 2 * dt);
      if (car.health <= 0 && Math.abs(car.speed) < 5 && p.car) {
        car.smoke = 1;
        exitCar();
        state.message = 'Your car is wrecked.';
        state.messageTimer = 3;
      }
      p.x = car.x;
      p.y = car.y;
      p.angle = car.angle;
      p.moving = Math.abs(car.speed) > 10;
      carCollisions(dt);
    } else {
      const mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      p.moving = false;
      stepPlayerOnFoot(p, city, mx, my, input.run, dt);
      hitByTraffic(dt);
    }

    // One-shot actions.
    if (input.interact) tryInteract();
    if (input.melee && !p.car) combat.playerMelee(state);
    if (input.shoot && input.shootX !== undefined) {
      combat.playerShoot(state, input.shootX, input.shootY);
    }

    // Mission arrival checks (drive-to steps complete by arriving).
    const s = missions.currentStep();
    if (s && (s.kind === 'goto' || s.kind === 'escape') && s.x !== undefined) {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < 95) missions.onEvent(state, 'arrive');
    }

    // The world keeps moving.
    entities.stepTraffic(dt, p);
    entities.stepPeds(dt, state.audioCue === 'shot' ? { x: p.x, y: p.y } : null);
    const bust = police.update(state, dt);
    if (bust === 'busted') {
      state.busted = true;
      state.audioCue = 'busted';
    }
    combat.update(state, dt);
    missions.update(state, dt);

    if (state.spawnThugs) {
      state.spawnThugs = false;
      combat.spawnThugs(420, 2500);
      state.message = 'The Rivas crew is here. Take them all out!';
      state.messageTimer = 4;
    }

    // Health regen after a quiet spell.
    if (p.health > 0 && p.health < PLAYER.health && state.elapsed - p.lastDamage > PLAYER.regenDelay) {
      p.health = Math.min(PLAYER.health, p.health + PLAYER.regenRate * dt);
    }
    if (p.health <= 0 && !state.wasted) {
      state.wasted = true;
      state.audioCue = 'wasted';
    }
    if (p.health > 0) state.wasted = false;
  }

  /** After WASTED or BUSTED: hospital, a bill, the heat off, mission restarts. */
  function respawn(busted) {
    const p = state.player;
    if (p.car) {
      p.car.kind = 'parked';
      p.car.occupied = false;
      p.car = null;
    }
    p.x = 1120;
    p.y = 1760;
    p.angle = -Math.PI / 2;
    p.health = PLAYER.health;
    p.lastDamage = state.elapsed;
    const bill = busted ? 150 : 200;
    state.cash = Math.max(0, state.cash - bill);
    state.wanted = 0;
    police.clearAll();
    combat.enemies.length = 0;
    state.wasted = false;
    state.busted = false;
    state.bustProgress = 0;
    missions.fail(state, '');
    missions.start(state);
    state.message = busted ? `Busted! The PD took $${bill} in fines.` : `Wasted! The hospital took $${bill}.`;
    state.messageTimer = 4;
  }

  function applySave(data) {
    state.cash = data.cash;
    state.wanted = data.wanted || 0;
    state.clockMinutes = data.clockMinutes || CLOCK.startMinutes;
    const p = state.player;
    p.x = data.player.x;
    p.y = data.player.y;
    p.angle = data.player.angle || 0;
    p.health = data.player.health;
    p.hasPistol = !!data.player.hasPistol;
    p.ammo = data.player.ammo || 0;
    missions.restore(data.mission);
    missions.start(state);
  }

  return { state, update, respawn, applySave, enterCar, exitCar, tryInteract };
}

export { STEP };
