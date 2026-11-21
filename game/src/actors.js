// Solmar's people: one box-built humanoid factory for the player,
// pedestrians, police officers and mission enemies, plus a thin Person
// wrapper that moves them, animates their walk and tracks their health.
// Behaviour (wandering, chasing, shooting) lives in game.js; this file
// only knows how a person looks and moves.

import * as THREE from 'three';
import { resolveCircle } from './world.js';

const SKIN_TONES = [0xe8b88a, 0xc98e5f, 0x8a5a34, 0xf0c8a0];

// Build a simple humanoid from boxes. The figure faces +Z; heading 0
// faces +Z and rotation.y turns it. Arms and legs pivot at the shoulder
// and hip so the walk animation can swing them.
export function buildPersonMesh(opts = {}) {
  const shirt = opts.shirt ?? 0x4a90d8;
  const pants = opts.pants ?? 0x2c3136;
  const skin = opts.skin ?? SKIN_TONES[0];
  const scale = opts.scale ?? 1;
  const group = new THREE.Group();

  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });

  const legGeo = new THREE.BoxGeometry(0.22, 0.78, 0.26);
  legGeo.translate(0, -0.39, 0);
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.set(-0.14, 0.78, 0);
  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.position.set(0.14, 0.78, 0);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirtMat);
  torso.position.set(0, 1.14, 0);

  const armGeo = new THREE.BoxGeometry(0.17, 0.66, 0.2);
  armGeo.translate(0, -0.33, 0);
  const leftArm = new THREE.Mesh(armGeo, shirtMat);
  leftArm.position.set(-0.4, 1.46, 0);
  const rightArm = new THREE.Mesh(armGeo, shirtMat);
  rightArm.position.set(0.4, 1.46, 0);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skinMat);
  head.position.set(0, 1.68, 0);

  group.add(leftLeg, rightLeg, torso, leftArm, rightArm, head);
  group.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
    }
  });

  // Optional hat: a flat cap (cops), a bandana (thugs), or a sun hat.
  if (opts.hat) {
    const hat = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.1, 0.38),
      new THREE.MeshLambertMaterial({ color: opts.hat }),
    );
    hat.position.set(0, 1.9, 0);
    group.add(hat);
  }
  // The player carries a visible pistol when armed.
  let gun = null;
  if (opts.gun) {
    gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.34),
      new THREE.MeshLambertMaterial({ color: 0x1a1d20 }),
    );
    gun.position.set(0.4, 0.86, 0.2);
    group.add(gun);
  }

  group.scale.setScalar(scale);
  const parts = { leftArm, rightArm, leftLeg, rightLeg, torso, head, gun };
  return { group, parts };
}

// Swing the limbs for a walk cycle. phase advances with distance walked;
// amount 0..1 blends the swing in and out.
export function animatePersonWalk(parts, phase, amount) {
  const swing = Math.sin(phase) * 0.62 * amount;
  parts.leftLeg.rotation.x = swing;
  parts.rightLeg.rotation.x = -swing;
  parts.leftArm.rotation.x = -swing * 0.9;
  parts.rightArm.rotation.x = swing * 0.9;
  parts.torso.position.y = 1.14 + Math.abs(Math.sin(phase)) * 0.04 * amount;
}

export class Person {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.role = opts.role ?? 'ped';
    const built = buildPersonMesh(opts);
    this.group = built.group;
    this.parts = built.parts;
    this.pos = new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 0);
    this.heading = opts.heading ?? 0;
    this.health = opts.health ?? 100;
    this.maxHealth = this.health;
    this.walkPhase = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.down = false;
    this.dead = false;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    scene.add(this.group);
  }

  place(x, z, heading = this.heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.group.position.copy(this.pos);
    this.group.rotation.y = heading;
  }

  faceToward(x, z) {
    this.heading = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.group.rotation.y = this.heading;
  }

  // Walk forward along the current heading, pushing out of buildings.
  // Returns the distance actually covered.
  step(dt, speed, colliders) {
    if (this.down || this.dead) return 0;
    const before = this.pos.clone();
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.z += Math.cos(this.heading) * speed * dt;
    resolveCircle(this.pos, 0.7, colliders);
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.walkPhase += moved * 2.4;
    this.speed = moved / Math.max(dt, 0.0001);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    animatePersonWalk(this.parts, this.walkPhase, Math.min(1, this.speed / 3));
    return moved;
  }

  // Stand still and let the walk cycle settle.
  idle(dt) {
    this.speed = 0;
    animatePersonWalk(this.parts, this.walkPhase, 0);
  }

  // Take damage; returns true when this kills the person.
  damage(amount) {
    if (this.dead) return true;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.fall();
      return true;
    }
    return false;
  }

  // Fall flat on the ground (used for knocked-down peds and dead enemies).
  fall() {
    this.down = true;
    this.group.rotation.x = -Math.PI / 2;
    this.group.position.y = 0.25;
  }

  rise() {
    this.down = false;
    this.dead = false;
    this.health = this.maxHealth;
    this.group.rotation.x = 0;
    this.group.position.y = 0;
  }

  remove() {
    this.scene.remove(this.group);
  }
}
