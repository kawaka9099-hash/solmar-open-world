// Everyone who moves in Solmar: the player on foot and behind the wheel, the traffic
// cars that follow the roads, the pedestrians on the sidewalks, and the arcade car
// physics (accelerate, steer, handbrake drift) they all share.
import { BEACH_X, CAR, CAR_COLORS, PEDS, PLAYER, TRAFFIC, WORLD } from './config.js';
import { pick, range } from './random.js';

export function makeCar(random, x, y, angle, opts = {}) {
  return {
    x, y, angle,
    speed: 0, // signed forward speed along the car's heading
    color: opts.color || pick(random, CAR_COLORS),
    kind: opts.kind || 'traffic', // 'traffic' | 'parked' | 'player' | 'police'
    occupied: opts.occupied !== false,
    health: CAR.health,
    smoke: 0,
    // Traffic AI: which road it is on and which way it is heading.
    road: opts.road || null, // { vertical: bool, line: number, dir: 1 | -1 }
    wait: 0,
    turnCooldown: 0,
    id: opts.id || 0,
  };
}

/** Arcade car physics: forward speed, steering that bites harder at speed, drift. */
export function stepCarPhysics(car, throttle, steer, handbrake, dt) {
  const maxSpeed = CAR.maxSpeed;
  if (throttle > 0) car.speed += CAR.accel * throttle * dt;
  else if (throttle < 0) {
    if (car.speed > 5) car.speed -= CAR.brake * dt; // brake first, then reverse
    else car.speed += CAR.reverseAccel * throttle * dt;
  }
  // Rolling drag and off-road drag (sand and grass slow a car down).
  car.speed -= car.speed * 0.55 * dt;
  if (car.speed > maxSpeed) car.speed = maxSpeed;
  if (car.speed < -CAR.maxReverse) car.speed = -CAR.maxReverse;
  if (Math.abs(car.speed) < 2 && throttle === 0) car.speed = 0;

  const grip = handbrake ? CAR.driftGrip : CAR.grip;
  const speedFactor = Math.min(1, Math.abs(car.speed) / 160);
  car.angle += steer * CAR.steer * speedFactor * (car.speed >= 0 ? 1 : -1) * dt * (handbrake ? 1.35 : 1);
  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  car.x += forwardX * car.speed * dt;
  car.y += forwardY * car.speed * dt;
  // Lateral slide: with the handbrake the car keeps some sideways velocity feel
  // by widening its turn; grip here only shapes the steering, kept simple on purpose.
  void grip;
}

/** Move a circle (the player on foot) with WASD, blocked by buildings and the sea. */
export function stepPlayerOnFoot(player, city, mx, my, run, dt) {
  const len = Math.hypot(mx, my);
  if (len < 0.01) return;
  const speed = run ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const nx = mx / len;
  const ny = my / len;
  player.x += nx * speed * dt;
  player.y += ny * speed * dt;
  player.angle = Math.atan2(ny, nx);
  player.moving = true;
  city.resolveCircle(player, PLAYER.radius);
}

export function createEntities(city, random) {
  const cars = [];
  const peds = [];
  let carId = 1;

  function spawnTrafficCar(x, y) {
    const vertical = random() < 0.5;
    const line = vertical ? pick(random, city.roadSet.avenues) : pick(random, city.roadSet.streets);
    const dir = random() < 0.5 ? 1 : -1;
    const px = x !== undefined ? x : (vertical ? line : range(random, 140, BEACH_X - 100));
    const py = y !== undefined ? y : (vertical ? range(random, 140, WORLD.height - 140) : line);
    const angle = vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    const car = makeCar(random, px, py, angle, {
      kind: 'traffic', occupied: true, id: carId += 1,
      road: { vertical, line, dir },
    });
    car.speed = TRAFFIC.speed + range(random, -TRAFFIC.speedJitter, TRAFFIC.speedJitter);
    cars.push(car);
    return car;
  }

  function spawnParkedCar() {
    for (let tries = 0; tries < 30; tries += 1) {
      const p = city.randomRoadPoint(random, 0, 0, 0);
      const vertical = random() < 0.5;
      const line = vertical ? p.x : p.y;
      const side = random() < 0.5 ? 1 : -1;
      const x = vertical ? line + side * 26 : p.x;
      const y = vertical ? p.y : line + side * 26;
      if (city.buildingAt(x, y, 26)) continue;
      const angle = vertical ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
      const car = makeCar(random, x, y, angle, { kind: 'parked', occupied: false, id: carId += 1 });
      cars.push(car);
      return car;
    }
    return null;
  }

  function spawnPed(x, y) {
    const p = x !== undefined ? { x, y } : city.randomSidewalkPoint(random);
    const ped = {
      x: p.x, y: p.y, angle: range(random, 0, Math.PI * 2),
      speed: PEDS.speed * range(random, 0.7, 1.3),
      target: city.randomSidewalkPoint(random),
      flee: 0, fleeX: 0, fleeY: 0,
      shirt: pick(random, ['#e07a5f', '#81b29a', '#f2c94c', '#e8e8e8', '#2f6df6', '#f4a261']),
      skin: pick(random, ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']),
      walkPhase: range(random, 0, Math.PI * 2),
    };
    peds.push(ped);
    return ped;
  }

  function nearestCar(x, y, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of cars) {
      const d = Math.hypot(car.x - x, car.y - y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function carAhead(car, gap) {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    for (const other of cars) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const along = dx * fx + dy * fy;
      const side = Math.abs(-dx * fy + dy * fx);
      if (along > 0 && along < gap && side < 30) return other;
    }
    return null;
  }

  /** Traffic: follow the road it is on; at an intersection, usually go straight, sometimes turn. */
  function stepTraffic(dt, playerPos) {
    for (const car of cars) {
      if (car.kind !== 'traffic' || !car.road) continue;
      if (car.wait > 0) { car.wait -= dt; continue; }
      car.turnCooldown -= dt;
      const { vertical, line, dir } = car.road;
      // Stay glued to the centre line of its road.
      if (vertical) {
        car.x += (line - car.x) * Math.min(1, 4 * dt);
        car.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.y += (line - car.y) * Math.min(1, 4 * dt);
        car.angle = dir > 0 ? 0 : Math.PI;
      }
      // Stop for the car ahead.
      const ahead = carAhead(car, TRAFFIC.followGap);
      const speed = ahead ? 0 : car.speed;
      car.x += Math.cos(car.angle) * speed * dt;
      car.y += Math.sin(car.angle) * speed * dt;
      // At an intersection, pick the next road.
      const nearCross = vertical
        ? city.roadSet.streets.some((sy) => Math.abs(car.y - sy) < 26)
        : city.roadSet.avenues.some((ax) => Math.abs(car.x - ax) < 26);
      if (nearCross && car.turnCooldown <= 0) {
        car.turnCooldown = 1.2;
        const roll = random();
        if (roll < 0.62) {
          // Straight on.
        } else if (roll < 0.81) {
          // Turn onto the crossing road.
          if (vertical) {
            const sy = city.roadSet.streets.reduce((a, b) => (Math.abs(b - car.y) < Math.abs(a - car.y) ? b : a));
            car.road = { vertical: false, line: sy, dir: random() < 0.5 ? 1 : -1 };
          } else {
            const ax = city.roadSet.avenues.reduce((a, b) => (Math.abs(b - car.x) < Math.abs(a - car.x) ? b : a));
            car.road = { vertical: true, line: ax, dir: random() < 0.5 ? 1 : -1 };
          }
        } else {
          car.wait = range(random, 0.5, 1.6); // hesitation at the junction
        }
      }
      // Wrap around the far edge so traffic never runs out.
      if (car.x < -80 || car.x > WORLD.width + 80 || car.y < -80 || car.y > WORLD.height + 80) {
        const p = city.randomRoadPoint(random, playerPos.x, playerPos.y, 700);
        const v = random() < 0.5;
        const ln = v ? pick(random, city.roadSet.avenues) : pick(random, city.roadSet.streets);
        const d = random() < 0.5 ? 1 : -1;
        car.x = v ? ln : p.x;
        car.y = v ? p.y : ln;
        car.road = { vertical: v, line: ln, dir: d };
        car.wait = 0;
      }
    }
  }

  /** Pedestrians: stroll between sidewalk points; flee from a scare point. */
  function stepPeds(dt, scare) {
    for (const ped of peds) {
      ped.walkPhase += dt * 7;
      if (ped.flee > 0) {
        ped.flee -= dt;
        const dx = ped.x - ped.fleeX;
        const dy = ped.y - ped.fleeY;
        const d = Math.hypot(dx, dy) || 1;
        ped.x += (dx / d) * ped.speed * 2.2 * dt;
        ped.y += (dy / d) * ped.speed * 2.2 * dt;
        ped.angle = Math.atan2(dy, dx);
        city.resolveCircle(ped, 9);
        continue;
      }
      if (scare) {
        const d = Math.hypot(ped.x - scare.x, ped.y - scare.y);
        if (d < 260) {
          ped.flee = 1.6;
          ped.fleeX = scare.x;
          ped.fleeY = scare.y;
          continue;
        }
      }
      const dx = ped.target.x - ped.x;
      const dy = ped.target.y - ped.y;
      const d = Math.hypot(dx, dy);
      if (d < 14) {
        ped.target = city.randomSidewalkPoint(random);
        continue;
      }
      // Sidestep: a pedestrian a car is bearing down on gets out of its
      // path, whether they are on the road or on the sidewalk. A car that
      // mounts the sidewalk at a corner should not mow down a pedestrian
      // who could have stepped aside — the player eats a wanted star for a
      // hit they could not have avoided, and the star makes the escape
      // that follows unwinnable. The ped steps directly away from the
      // car's line of travel (the component of their offset from the car
      // that is perpendicular to the car's heading).
      const threat = closeThreat(ped);
      if (threat) {
        const s = threat.speed >= 0 ? 1 : -1;
        const dirX = Math.cos(threat.angle) * s;
        const dirY = Math.sin(threat.angle) * s;
        const rx = ped.x - threat.x;
        const ry = ped.y - threat.y;
        const along = rx * dirX + ry * dirY;
        let px = rx - along * dirX;
        let py = ry - along * dirY;
        let plen = Math.hypot(px, py);
        if (plen < 1) {
          // Ped is on the car's line: pick either side.
          px = -dirY;
          py = dirX;
          plen = 1;
        }
        ped.x += (px / plen) * ped.speed * 4 * dt;
        ped.y += (py / plen) * ped.speed * 4 * dt;
        ped.angle = Math.atan2(py / plen, px / plen);
        city.resolveCircle(ped, 9);
        continue;
      }
      const nx = ped.x + (dx / d) * ped.speed * dt;
      const ny = ped.y + (dy / d) * ped.speed * dt;
      // Look both ways: a pedestrian about to step off the curb onto the road
      // waits if a car is coming. Otherwise they step out in front of a car
      // at full speed and the player eats a wanted star for a hit they could
      // not have avoided. Peds already on the road keep walking to clear it —
      // and hurry across if a car is bearing down on them, since a car that
      // accelerates after they commit can otherwise catch them mid-crossing.
      if (!city.onRoad(ped.x, ped.y) && city.onRoad(nx, ny) && carComing(ped)) {
        continue;
      }
      if (city.onRoad(ped.x, ped.y) && carComing(ped)) {
        ped.x += (dx / d) * ped.speed * 4 * dt;
        ped.y += (dy / d) * ped.speed * 4 * dt;
      } else {
        ped.x = nx;
        ped.y = ny;
      }
      ped.angle = Math.atan2(dy, dx);
      city.resolveCircle(ped, 9);
    }
  }

  /** Is a car about to reach this pedestrian's crossing? */
  function carComing(ped) {
    for (const car of cars) {
      const spd = Math.abs(car.speed);
      if (spd < 20) continue;
      const s = car.speed >= 0 ? 1 : -1;
      const dirX = Math.cos(car.angle) * s;
      const dirY = Math.sin(car.angle) * s;
      const rx = ped.x - car.x;
      const ry = ped.y - car.y;
      const along = rx * dirX + ry * dirY;
      if (along <= 0) continue; // moving away from the pedestrian
      const lateral = Math.abs(rx * dirY - ry * dirX);
      if (lateral > 70) continue; // will pass to the side
      // Reaches the crossing before the ped (52px/s over a 72px road, longer
      // on a diagonal) clears it. Judge by the car's top-end speed, not just
      // its current speed: a car that accelerates after the ped commits can
      // otherwise catch them mid-crossing.
      const judge = Math.max(spd, 300);
      if (along / judge < 3.0) return true;
    }
    return false;
  }

  /**
   * A car close enough that the pedestrian must sidestep now or be hit:
   * heading toward them, within 250px along its path, and close enough
   * laterally that it will not pass to the side. Returns the car, or null.
   */
  function closeThreat(ped) {
    for (const car of cars) {
      const spd = Math.abs(car.speed);
      if (spd < 20) continue;
      const s = car.speed >= 0 ? 1 : -1;
      const dirX = Math.cos(car.angle) * s;
      const dirY = Math.sin(car.angle) * s;
      const rx = ped.x - car.x;
      const ry = ped.y - car.y;
      const along = rx * dirX + ry * dirY;
      if (along <= 0 || along > 250) continue;
      const lateral = Math.abs(rx * dirY - ry * dirX);
      if (lateral > 70) continue;
      return car;
    }
    return null;
  }

  function scarePeds(x, y) {
    for (const ped of peds) {
      if (Math.hypot(ped.x - x, ped.y - y) < 300) {
        ped.flee = 1.8;
        ped.fleeX = x;
        ped.fleeY = y;
      }
    }
  }

  return {
    cars, peds,
    spawnTrafficCar, spawnParkedCar, spawnPed,
    nearestCar, stepTraffic, stepPeds, scarePeds,
  };
}
