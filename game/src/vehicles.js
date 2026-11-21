// Solmar — game/src/vehicles.js
// Cars: arcade driving physics plus simple boxy car models built from
// three.js primitives. No external assets.
//
// API:
//   CAR_TYPES — { sedan, sport, truck, taxi, police }: each { name,
//     color, topSpeed, accel, steer, seats } (tuned in config.js spirit)
//   createCar(scene, THREE, type, x, z, heading) -> car
//     car = { group, type, def, heading, speed, steer, damage, wrecked,
//             driver: null | 'player' | ped, wheels: [mesh x4],
//             headlights: [mesh x2], brakeLights: [mesh x2] }
//   updateCar(car, controls, dt, world) — arcade physics:
//     controls = { throttle: -1..1, steer: -1..1, brake: bool, handbrake: bool }
//     integrates speed/heading, damps sideways slide, collides with the
//     city's colliders and the world bounds, spins the wheels and flashes
//     brake lights. Sets car.crashed=true on a hard hit that frame.
//   carWorldPos(car) -> { x, z } convenience for the HUD / minimap.
//   nearestCar(cars, x, z, maxDist) -> closest drivable car or null.
//
// A car is driven by the player when car.driver === 'player'; traffic
// cars are driven by the traffic system (later session) through the same
// updateCar with scripted controls.

import { CONFIG } from './config.js';
import { clamp, damp, angleLerp } from './util.js';

export const CAR_TYPES = {
  sedan: { name: 'Solmar Sedan', color: 0x3a7a8a, topSpeed: 32, accel: 1.0, steer: 1.0, seats: 4 },
  sport: { name: 'Vortex GT', color: 0xc03028, topSpeed: 46, accel: 1.35, steer: 1.25, seats: 2 },
  truck: { name: 'Hauler Truck', color: 0x8a6a2a, topSpeed: 24, accel: 0.7, steer: 0.7, seats: 2 },
  taxi: { name: 'Solmar Cab', color: 0xe8b820, topSpeed: 30, accel: 0.95, steer: 1.0, seats: 4 },
  police: { name: 'SPD Cruiser', color: 0x20344a, topSpeed: 38, accel: 1.2, steer: 1.1, seats: 4 },
};

function box(THREE, w, h, d, color, roughness = 0.55, metalness = 0.35) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness, metalness }),
  );
}

function makeCarModel(THREE, def, type) {
  const g = new THREE.Group();
  const isTruck = type === 'truck';
  const bodyLen = isTruck ? 5.6 : 4.4;
  const bodyW = isTruck ? 2.2 : 1.9;
  const bodyH = isTruck ? 1.1 : 0.62;

  const body = box(THREE, bodyLen, bodyH, bodyW, def.color);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);

  if (isTruck) {
    const cab = box(THREE, 1.4, 1.0, 2.0, def.color);
    cab.position.set(1.9, 1.55, 0);
    cab.castShadow = true;
    g.add(cab);
    const bed = box(THREE, 3.2, 0.5, 2.0, 0x5a4a30);
    bed.position.set(-0.9, 1.25, 0);
    g.add(bed);
  } else {
    const cabin = box(THREE, 2.2, 0.62, 1.7, 0x1c222c);
    cabin.position.set(-0.2, 1.12, 0);
    cabin.castShadow = true;
    g.add(cabin);
    // Windshield band.
    const glass = box(THREE, 0.1, 0.5, 1.6, 0x9fd0e8);
    glass.position.set(0.95, 1.05, 0);
    g.add(glass);
  }

  // Wheels.
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.4, metalness: 0.6 });
  for (const [wx, wz] of [[1.45, 0.95], [1.45, -0.95], [-1.45, 0.95], [-1.45, -0.95]]) {
    const wheel = new THREE.Group();
    const tyre = new THREE.Mesh(wheelGeo, wheelMat);
    tyre.rotation.x = Math.PI / 2;
    tyre.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8), hubMat);
    hub.rotation.x = Math.PI / 2;
    wheel.add(tyre);
    wheel.add(hub);
    wheel.position.set(wx, 0.36, wz);
    g.add(wheel);
    wheels.push(wheel);
  }

  // Headlights and brake lights.
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe9a0, emissiveIntensity: 0.7 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0xc02020, emissive: 0x801010, emissiveIntensity: 0.4 });
  const headlights = [];
  const brakeLights = [];
  for (const wz of [0.6, -0.6]) {
    const h = box(THREE, 0.08, 0.18, 0.3, 0xfff2b0);
    h.material = headMat;
    h.position.set(bodyLen / 2 + 0.01, 0.62, wz);
    g.add(h);
    headlights.push(h);
    const b = box(THREE, 0.08, 0.18, 0.3, 0xc02020);
    b.material = brakeMat;
    b.position.set(-bodyLen / 2 - 0.01, 0.62, wz);
    g.add(b);
    brakeLights.push(b);
  }

  // Taxi sign / police light bar.
  if (type === 'taxi') {
    const sign = box(THREE, 0.9, 0.22, 0.5, 0xf2c230);
    sign.position.set(-0.2, 1.55, 0);
    g.add(sign);
  }
  if (type === 'police') {
    const bar = box(THREE, 0.5, 0.18, 1.2, 0x101418);
    bar.position.set(-0.2, 1.5, 0);
    g.add(bar);
    const red = box(THREE, 0.5, 0.2, 0.5, 0xd02020);
    red.material = new THREE.MeshStandardMaterial({ color: 0xd02020, emissive: 0xd02020, emissiveIntensity: 0.9 });
    red.position.set(-0.2, 1.52, 0.32);
    g.add(red);
    const blue = box(THREE, 0.5, 0.2, 0.5, 0x2050d0);
    blue.material = new THREE.MeshStandardMaterial({ color: 0x2050d0, emissive: 0x2050d0, emissiveIntensity: 0.9 });
    blue.position.set(-0.2, 1.52, -0.32);
    g.add(blue);
  }
  return { group: g, wheels, headlights, brakeLights };
}

export function createCar(scene, THREE, type, x, z, heading = 0) {
  const def = CAR_TYPES[type] || CAR_TYPES.sedan;
  const { group, wheels, headlights, brakeLights } = makeCarModel(THREE, def, type);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  return {
    group,
    type,
    def,
    heading,
    speed: 0,
    steer: 0,
    damage: 0,
    wrecked: false,
    crashed: false,
    driver: null,
    wheels,
    headlights,
    brakeLights,
    // Velocity kept in world space for slide damping.
    vx: 0,
    vz: 0,
  };
}

export function carWorldPos(car) {
  return { x: car.group.position.x, z: car.group.position.z };
}

export function nearestCar(cars, x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of cars) {
    if (car.wrecked) continue;
    const dx = car.group.position.x - x;
    const dz = car.group.position.z - z;
    const d = Math.hypot(dx, dz);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

export function updateCar(car, controls, dt, world) {
  const cfg = CONFIG.cars;
  const def = car.def;
  car.crashed = false;
  if (car.wrecked) {
    car.speed = damp(car.speed, 0, 4, dt);
    return;
  }

  const throttle = clamp(controls.throttle || 0, -1, 1);
  const steerIn = clamp(controls.steer || 0, -1, 1);

  // Steering eases off at speed so the car stays controllable.
  const speedFactor = 1 / (1 + Math.abs(car.speed) * 0.045);
  const steerTarget = steerIn * cfg.steerMax * def.steer * speedFactor;
  car.steer = damp(car.steer, steerTarget, cfg.steerSpeed, dt);

  // Longitudinal acceleration.
  let accel = 0;
  if (throttle > 0) accel = cfg.accel * def.accel * throttle;
  else if (throttle < 0) {
    accel = car.speed > 0.5 ? -cfg.brake : cfg.reverseAccel * throttle;
  }
  if (controls.brake) accel = car.speed > 0.5 ? -cfg.brake : (car.speed < -0.5 ? cfg.brake : 0);
  car.speed += accel * dt;

  // Drag and rolling resistance.
  car.speed -= car.speed * cfg.drag * dt * 0.4;
  if (Math.abs(throttle) < 0.05 && !controls.brake) {
    car.speed = damp(car.speed, 0, cfg.rollDrag, dt);
  }
  const top = def.topSpeed;
  car.speed = clamp(car.speed, -cfg.maxReverse, top);
  if (Math.abs(car.speed) < 0.03 && Math.abs(throttle) < 0.05) car.speed = 0;

  // Heading follows steering, scaled by speed.
  car.heading += (car.steer * car.speed * dt) / 2.6;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);

  // Velocity along the car's forward axis, with lateral slide damped
  // (arcade grip; the handbrake loosens it for drifting).
  const grip = controls.handbrake ? cfg.handbrakeGrip : cfg.grip;
  const forwardSpeed = car.vx * fx + car.vz * fz;
  const sideX = car.vx - fx * forwardSpeed;
  const sideZ = car.vz - fz * forwardSpeed;
  const keep = Math.exp(-grip * dt);
  car.vx = fx * forwardSpeed + sideX * keep;
  car.vz = fz * forwardSpeed + sideZ * keep;
  // Blend velocity toward the new forward speed.
  car.vx = damp(car.vx, fx * car.speed, 8, dt);
  car.vz = damp(car.vz, fz * car.speed, 8, dt);

  const p = car.group.position;
  p.x += car.vx * dt;
  p.z += car.vz * dt;

  // Collide with buildings: resolve the car's circle and lose speed.
  const r = 1.6;
  const beforeX = p.x;
  const beforeZ = p.z;
  world.resolveCircle(p, r);
  if (p.x !== beforeX || p.z !== beforeZ) {
    const impact = Math.abs(car.speed);
    if (impact > 4) {
      car.crashed = true;
      car.damage += Math.min(30, impact * 1.2);
      if (car.damage >= cfg.wreckAt) {
        car.wrecked = true;
        car.speed = 0;
      }
    }
    car.speed *= 0.35;
    car.vx *= 0.35;
    car.vz *= 0.35;
  }

  // Stay inside the world bounds.
  const b = world.bounds;
  const cx = clamp(p.x, b.minX + 2, b.maxX - 2);
  const cz = clamp(p.z, b.minZ + 2, b.maxZ - 2);
  if (cx !== p.x) { p.x = cx; car.vx = 0; car.speed *= 0.5; }
  if (cz !== p.z) { p.z = cz; car.vz = 0; car.speed *= 0.5; }

  car.group.rotation.y = car.heading - Math.PI / 2; // local +x (the bonnet) -> physics forward
  // Wheels spin with speed; front wheels yaw with steering.
  const spin = car.speed * dt * 2.4;
  for (let i = 0; i < car.wheels.length; i++) {
    const w = car.wheels[i];
    w.rotation.z += spin;
    if (i < 2) w.rotation.y = car.steer * 0.9;
  }
  // Brake lights flare while braking.
  const braking = controls.brake || throttle < -0.1;
  for (const bLight of car.brakeLights) {
    bLight.material.emissiveIntensity = braking ? 1.6 : 0.4;
  }
}
