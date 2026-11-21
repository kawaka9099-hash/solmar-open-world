// Solmar's cars: a box-built car factory, arcade driving physics, traffic
// that follows the road grid, and police cars that chase the player. A Car
// wraps its mesh and its state; game.js decides who drives which car.

import * as THREE from 'three';
import { CAR, PALETTE } from './config.js';
import { resolveCircle } from './world.js';
import { clamp, angleDiff, angleToward, dist2D } from './util.js';

const GLASS = new THREE.MeshLambertMaterial({ color: 0x1c2833 });
const TYRE = new THREE.MeshLambertMaterial({ color: 0x14161a });
const CHROME = new THREE.MeshLambertMaterial({ color: 0xc8ccd0 });
const TAIL_OFF = new THREE.MeshLambertMaterial({ color: 0x7a1a12 });
const TAIL_ON = new THREE.MeshLambertMaterial({ color: 0xff2a1a });
const HEAD_MAT = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });

// Build a car mesh. The car faces +Z; heading 0 faces +Z. Kinds: sedan,
// sport (lower, with a spoiler), taxi, van, truck, police.
export function buildCarMesh(kind, color) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const low = kind === 'sport';
  const big = kind === 'truck' || kind === 'van';

  const bodyLen = big ? 5.4 : low ? 4.5 : 4.2;
  const bodyH = low ? 0.5 : 0.62;
  const bodyY = low ? 0.5 : 0.56;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, bodyH, bodyLen), paint);
  body.position.set(0, bodyY, 0);
  body.castShadow = true;
  group.add(body);

  const cabinLen = big ? 2.0 : low ? 1.9 : 2.2;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.55, cabinLen), kind === 'van' ? paint : GLASS);
  cabin.position.set(0, bodyY + bodyH / 2 + 0.26, big ? 1.2 : -0.15);
  cabin.castShadow = true;
  group.add(cabin);

  if (kind === 'sport') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.4), CHROME);
    spoiler.position.set(0, 1.05, -2.1);
    group.add(spoiler);
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe14a }));
    sign.position.set(0, 1.42, -0.15);
    group.add(sign);
  }
  if (kind === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    bar.position.set(0, 1.42, -0.15);
    group.add(bar);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    bar2.position.set(-0.55, 1.42, -0.15);
    group.add(bar2);
  }
  if (kind === 'truck') {
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 2.6), new THREE.MeshLambertMaterial({ color: 0x8a8f94 }));
    cargo.position.set(0, 1.5, -1.2);
    cargo.castShadow = true;
    group.add(cargo);
  }

  // Headlights and taillights.
  for (const sx of [-0.62, 0.62]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), HEAD_MAT);
    head.position.set(sx, bodyY, bodyLen / 2 + 0.02);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), TAIL_OFF);
    tail.position.set(sx, bodyY, -bodyLen / 2 - 0.02);
    group.add(tail);
  }

  // Wheels: steer group (yaw) > spin group (roll) > tyre mesh.
  const wheels = {};
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  const spots = { fl: [-0.85, 1.35], fr: [0.85, 1.35], rl: [-0.85, -1.35], rr: [0.85, -1.35] };
  for (const [name, [wx, wz]] of Object.entries(spots)) {
    const steer = new THREE.Group();
    steer.position.set(wx, 0.38, wz);
    steer.rotation.order = 'YXZ';
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(wheelGeo, TYRE);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    spin.add(tyre);
    steer.add(spin);
    group.add(steer);
    wheels[name] = { steer, spin };
  }

  return { group, wheels, paint, bodyLen };
}

export class Car {
  constructor(scene, kind, color, x, z, heading = 0) {
    this.scene = scene;
    this.kind = kind;
    this.color = color;
    const built = buildCarMesh(kind, color);
    this.group = built.group;
    this.wheels = built.wheels;
    this.bodyLen = built.bodyLen;
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.health = CAR.HEALTH;
    this.wrecked = false;
    this.driver = null; // 'player' | 'traffic' | 'police' | null (parked)
    this.braking = false;
    this.stuckTimer = 0; // police chase: reversing out of a jam
    this.spinAngle = 0;
    this.group.position.copy(this.pos);
    this.group.rotation.y = heading;
    scene.add(this.group);
  }

  get x() { return this.pos.x; }
  get z() { return this.pos.z; }

  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.sync();
  }

  sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }

  // Arcade driving: throttle -1..1 (negative = brake/reverse),
  // steerInput -1..1, handbrake bool. Returns impact 0..1 from collisions.
  drive(dt, throttle, steerInput, handbrake, colliders) {
    if (this.wrecked) return 0;
    const maxSpeed = this.kind === 'sport' ? CAR.SPORT_MAX_SPEED : CAR.MAX_SPEED;
    const forward = this.speed >= 0 ? 1 : -1;
    if (throttle > 0) this.speed += CAR.ACCEL * throttle * dt;
    else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= CAR.BRAKE * dt;
      else this.speed -= CAR.ACCEL * 0.6 * dt;
    }
    if (handbrake) this.speed -= Math.sign(this.speed) * 22 * dt;
    // Drag and rolling resistance.
    this.speed -= this.speed * CAR.DRAG * dt;
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;
    this.speed = clamp(this.speed, -CAR.REVERSE_MAX, maxSpeed);
    // Steering bites harder at low speed, less at full speed.
    const steerTarget = steerInput * (handbrake ? 1.25 : 1);
    this.steer = angleToward(this.steer, steerTarget, dt * 3.2);
    const speedFactor = clamp(Math.abs(this.speed) / 12, 0, 1);
    this.heading += this.steer * CAR.STEER * speedFactor * forward * dt * (handbrake ? 1.5 : 1);
    this.braking = throttle < 0 && this.speed > 0.5;

    const before = this.pos.clone();
    const speedBefore = this.speed;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    // Stay out of the water and inside the world: the beach ends at x=340.
    const cx = clamp(this.pos.x, -340, 340);
    const cz = clamp(this.pos.z, -340, 340);
    if (cx !== this.pos.x || cz !== this.pos.z) {
      this.pos.x = cx;
      this.pos.z = cz;
      this.speed *= 0.5;
    }
    let impact = 0;
    if (resolveCircle(this.pos, CAR.RADIUS, colliders)) {
      const lost = Math.abs(speedBefore) - Math.abs(this.speed);
      impact = clamp(Math.abs(speedBefore) / 30, 0, 1);
      this.speed *= 0.45;
      if (Math.abs(speedBefore) > 14) this.damage(8);
    }
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.spinAngle += (moved / 0.38) * Math.sign(this.speed || 1);
    this.sync();
    this.updateVisual(dt);
    return impact;
  }

  // Visuals: wheel spin and steer, tail light when braking.
  updateVisual(dt) {
    const steerAngle = this.steer * 0.42;
    this.wheels.fl.steer.rotation.y = steerAngle;
    this.wheels.fr.steer.rotation.y = steerAngle;
    for (const w of Object.values(this.wheels)) {
      w.spin.rotation.x = this.spinAngle;
    }
    void dt;
  }

  damage(amount) {
    if (this.wrecked) return true;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.wrecked = true;
      this.speed = 0;
      return true;
    }
    return false;
  }

  remove() {
    this.scene.remove(this.group);
  }
}

// ---- traffic --------------------------------------------------------------

// One traffic car: drives its road, turns at intersections, stops for the
// car ahead, and respawns near the player when it drifts too far away.
export class TrafficCar extends Car {
  constructor(scene, kind, color, x, z, heading) {
    super(scene, kind, color, x, z, heading);
    this.driver = 'traffic';
    this.axis = Math.abs(Math.sin(heading)) > 0.5 ? 'x' : 'z';
    this.line = this.axis === 'x' ? Math.round(z / 72) * 72 : Math.round(x / 72) * 72;
    this.dir = this.axis === 'x' ? Math.sign(Math.sin(heading)) || 1 : Math.sign(Math.cos(heading)) || 1;
    this.lane = (Math.random() < 0.5 ? -1 : 1) * 4;
    this.cruise = 10 + Math.random() * 4;
  }

  update(dt, colliders, allCars, playerPos) {
    if (this.wrecked) return;
    // Stay on the road: snap the lateral position to the lane.
    if (this.axis === 'x') this.pos.z = this.line + this.lane;
    else this.pos.x = this.line + this.lane;
    // Car ahead on the same road?
    let blocked = false;
    for (const other of allCars) {
      if (other === this || other.wrecked) continue;
      const dx = other.pos.x - this.pos.x;
      const dz = other.pos.z - this.pos.z;
      const along = this.axis === 'x' ? dx * this.dir : dz * this.dir;
      const lateral = this.axis === 'x' ? Math.abs(dz) : Math.abs(dx);
      if (along > 0 && along < 11 && lateral < 3.4) {
        blocked = true;
        break;
      }
    }
    const target = blocked ? 0 : this.cruise;
    this.speed += (target - this.speed) * Math.min(1, dt * 1.6);
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    resolveCircle(this.pos, CAR.RADIUS, colliders);
    // At an intersection, sometimes turn onto the crossing road.
    const alongCoord = this.axis === 'x' ? this.pos.x : this.pos.z;
    const nearest = Math.round(alongCoord / 72) * 72;
    if (Math.abs(alongCoord - nearest) < 1.2 && Math.abs(this.speed) > 2) {
      if (Math.random() < 0.22) {
        const turn = Math.random() < 0.5 ? 1 : -1;
        if (this.axis === 'x') {
          this.axis = 'z';
          this.line = nearest;
          this.dir = turn * this.dir;
          this.heading = this.dir > 0 ? 0 : Math.PI;
        } else {
          this.axis = 'x';
          this.line = nearest;
          this.dir = turn * this.dir;
          this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
        this.lane = (Math.random() < 0.5 ? -1 : 1) * 4;
      }
    }
    // Too far from the player: reappear on a road near them.
    if (playerPos && dist2D(this.pos.x, this.pos.z, playerPos.x, playerPos.z) > 280) {
      const road = Math.floor(Math.random() * 9) * 72 - 288;
      const axis = Math.random() < 0.5 ? 'x' : 'z';
      const off = (Math.random() - 0.5) * 160;
      if (axis === 'x') {
        this.place(playerPos.x + off, road, Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        this.axis = 'x';
        this.line = road;
      } else {
        this.place(road, playerPos.z + off, Math.random() < 0.5 ? 0 : Math.PI);
        this.axis = 'z';
        this.line = road;
      }
      this.dir = Math.random() < 0.5 ? 1 : -1;
      this.lane = (Math.random() < 0.5 ? -1 : 1) * 4;
    }
    this.sync();
    this.updateVisual(dt);
  }
}

// A police car chasing the player: steers toward them, reverses out of
// trouble when stuck against a building.
export function updatePoliceCar(car, dt, targetPos, colliders) {
  if (car.wrecked) return 0;
  const desired = Math.atan2(targetPos.x - car.pos.x, targetPos.z - car.pos.z);
  const turn = clamp(angleDiff(car.heading, desired), -1, 1);
  const dist = dist2D(car.pos.x, car.pos.z, targetPos.x, targetPos.z);
  const throttle = dist > 4 ? 1 : 0.3;
  if (car.stuckTimer > 0) {
    car.stuckTimer -= dt;
    return car.drive(dt, -0.7, -turn, false, colliders);
  }
  const before = car.pos.clone();
  const impact = car.drive(dt, throttle, turn, false, colliders);
  const moved = Math.hypot(car.pos.x - before.x, car.pos.z - before.z);
  if (Math.abs(car.speed) > 4 && moved < Math.abs(car.speed) * dt * 0.35) {
    car.stuckTimer = 0.7;
  }
  return impact;
}

export const CAR_COLORS = PALETTE.car;
