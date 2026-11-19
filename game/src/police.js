// The wanted system and the Solmar PD. Stars rise on crimes and fall when the player
// stays quiet and out of sight; police cars spawn on the roads, chase, ram, and at
// high wanted levels set up ahead of the player. On foot, a cop who catches the
// player fills the bust meter.
import { CAR, WANTED, WORLD } from './config.js';
import { makeCar, stepCarPhysics } from './entities.js';

export function createPolice(city, random) {
  const police = [];
  let quietTimer = 0;
  let decayTimer = 0;
  let bustTimer = 0;

  function wantedCount(state) {
    return WANTED.policePerStar[state.wanted] || 0;
  }

  function spawnPoliceCar(state) {
    const p = city.randomRoadPoint(random, state.player.x, state.player.y, 420);
    const car = makeCar(random, p.x, p.y, 0, { kind: 'police', occupied: true, color: '#f5f5f5' });
    car.sirenPhase = random() * Math.PI * 2;
    police.push(car);
    return car;
  }

  function nearestPolice(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const car of police) {
      const d = Math.hypot(car.x - x, car.y - y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best ? { car: best, dist: bestD } : null;
  }

  function addWanted(state, amount, reason) {
    const before = state.wanted;
    state.wanted = Math.min(WANTED.maxStars, state.wanted + amount);
    quietTimer = 0;
    decayTimer = 0;
    if (state.wanted > before) {
      state.message = reason;
      state.messageTimer = 2.5;
    }
    return state.wanted;
  }

  function update(state, dt) {
    const player = state.player;
    const target = wantedCount(state);
    // Spawn or retire police to match the wanted level.
    while (police.length < target) spawnPoliceCar(state);
    while (police.length > target) police.pop();

    // Wanted decay: quiet + unseen for a while, then one star at a time.
    const near = nearestPolice(player.x, player.y);
    const seen = near && near.dist < 420;
    if (state.wanted > 0 && !seen) {
      quietTimer += dt;
      if (quietTimer > WANTED.decayQuietSeconds) {
        decayTimer += dt;
        if (decayTimer > WANTED.decayStepSeconds) {
          decayTimer = 0;
          state.wanted -= 1;
          if (state.wanted === 0) {
            state.message = 'You lost them. The heat is off.';
            state.messageTimer = 3;
          }
        }
      }
    } else {
      quietTimer = 0;
      decayTimer = 0;
    }

    // Chase: steer toward the player, ram on contact, brake-check when close.
    for (const car of police) {
      car.sirenPhase = (car.sirenPhase || 0) + dt * 6;
      const dx = player.x - car.x;
      const dy = player.y - car.y;
      const dist = Math.hypot(dx, dy) || 1;
      const targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - car.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = Math.max(-1, Math.min(1, diff * 2.2));
      const throttle = dist > 90 ? 1 : 0.4;
      stepCarPhysics(car, throttle, steer, false, dt);
      city.resolveCircle(car, CAR.radius);
      // Ram: shove the player's car, or hurt the player on foot. The speed cut
      // only lands on impact (cooldown-gated) so a cop glued to the bumper
      // cannot pin the player's speed to zero.
      if (dist < 52) {
        // Keep the police car from sitting inside the player's car.
        const overlap = 52 - dist;
        car.x -= (dx / dist) * overlap * 0.5;
        car.y -= (dy / dist) * overlap * 0.5;
        car.ramCooldown = (car.ramCooldown || 0) - dt;
        if (player.car) {
          const push = 260 * dt;
          player.car.x += (dx / dist) * push * 0.4;
          player.car.y += (dy / dist) * push * 0.4;
          if (car.ramCooldown <= 0) {
            car.ramCooldown = 0.6;
            player.car.speed *= 0.82;
            player.car.health -= 4;
          }
          player.car.health -= 6 * dt;
          if (player.car.health <= 0 && player.car.smoke === 0) {
            player.car.smoke = 1;
            state.message = 'Your car is wrecked — get out!';
            state.messageTimer = 3;
          }
        } else {
          player.health -= 14 * dt;
          player.lastDamage = state.elapsed;
          player.x += (dx / dist) * 60 * dt;
          player.y += (dy / dist) * 60 * dt;
          city.resolveCircle(player, 11);
        }
      }
      // Bust: on foot and a cop sits on top of the player for 3 seconds.
      if (!player.car && dist < 46) {
        bustTimer += dt;
        state.bustProgress = Math.min(1, bustTimer / WANTED.bustSeconds);
        if (bustTimer >= WANTED.bustSeconds) {
          bustTimer = 0;
          state.bustProgress = 0;
          return 'busted';
        }
      }
    }
    if (!near || near.dist > 60) {
      bustTimer = Math.max(0, bustTimer - dt * 2);
      state.bustProgress = Math.min(1, bustTimer / WANTED.bustSeconds);
    }
    return null;
  }

  function clearAll() {
    police.length = 0;
    bustTimer = 0;
  }

  return { police, addWanted, update, nearestPolice, clearAll };
}
