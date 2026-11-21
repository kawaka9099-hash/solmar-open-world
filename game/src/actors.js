// Solmar — game/src/actors.js
// People: a blocky third-person player character with walk/run/jump
// animation, and pedestrians who stroll the sidewalks and flee when
// threatened. All models are built from three.js primitives.
//
// API:
//   createPlayer(scene, THREE, x, z) -> player
//     player = { group, pos: THREE.Vector3 (feet), heading, speed,
//                vy, grounded, walkPhase, limbs: { legL, legR, armL, armR } }
//   updatePlayer(player, move, dt, world)
//     move = { forward: -1..1, strafe: -1..1, heading, sprint: bool,
//              jump: bool } — moves the player on foot, applies gravity,
//              collides with the city's colliders, swings the limbs.
//   createPedestrian(scene, THREE, x, z, opts?) -> ped
//     opts = { shirt, pants, skin, speed } — colours are hex numbers.
//   updatePedestrian(ped, dt, world, threats)
//     threats = [{ x, z, radius }] — peds inside a threat radius flee;
//     otherwise they stroll along their sidewalk path and turn at corners.
//   makePedestrianWalk(ped, dt) — internal limb swing, also used by player.
//   setPedFleeing(ped, on) — force a ped to run away from its position.

import { CONFIG } from './config.js';
import { clamp, makeRng, pick, range, angleLerp, damp } from './util.js';

const SHIRTS = [0xd05040, 0x3a7a8a, 0x6a8a3a, 0xe8b820, 0x8a5aa0, 0xdddddd, 0x2a2c30, 0xc07030];
const PANTS = [0x2a344a, 0x3a3a3a, 0x5a4a3a, 0x243028];
const SKINS = [0xe8b88a, 0xc98a5a, 0x8a5a3a, 0xf0c8a0];

// A blocky humanoid: torso, head, arms and legs as boxes, with pivots at
// the shoulders and hips so the limbs can swing.
function buildFigure(THREE, shirt, pants, skin, scale = 1) {
  const group = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), mat(shirt));
  torso.position.y = 1.08 * scale;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), mat(skin));
  head.position.y = 1.66 * scale;
  head.castShadow = true;
  group.add(head);

  // Simple hair cap.
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), mat(0x2a2018));
  hair.position.y = 1.88 * scale;
  group.add(hair);

  const mkLimb = (w, h, d, c, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  };

  const legL = mkLimb(0.22, 0.72, 0.24, pants, -0.16, 0.72 * scale);
  const legR = mkLimb(0.22, 0.72, 0.24, pants, 0.16, 0.72 * scale);
  const armL = mkLimb(0.16, 0.62, 0.18, shirt, -0.4, 1.38 * scale);
  const armR = mkLimb(0.16, 0.62, 0.18, shirt, 0.4, 1.38 * scale);

  group.scale.setScalar(scale);
  return { group, limbs: { legL, legR, armL, armR } };
}

export function createPlayer(scene, THREE, x, z) {
  // The player wears a teal jacket so they read clearly on the street.
  const { group, limbs } = buildFigure(THREE, 0x2a8a7a, 0x2a344a, 0xe8b88a, 1.0);
  group.position.set(x, 0, z);
  scene.add(group);
  return {
    group,
    pos: group.position,
    heading: 0,
    speed: 0,
    vy: 0,
    grounded: true,
    walkPhase: 0,
    limbs,
    radius: CONFIG.player.radius,
  };
}

export function updatePlayer(player, move, dt, world) {
  const cfg = CONFIG.player;
  const targetSpeed = move.sprint ? cfg.runSpeed : cfg.walkSpeed;
  const moving = Math.abs(move.forward) > 0.05 || Math.abs(move.strafe) > 0.05;
  const speed = moving ? targetSpeed : 0;
  player.speed = damp(player.speed, speed, 10, dt);

  // Face the camera heading while moving; stand still otherwise.
  if (moving) player.heading = angleLerp(player.heading, move.heading, 1 - Math.exp(-12 * dt));

  const fx = Math.sin(player.heading);
  const fz = Math.cos(player.heading);
  const rx = Math.cos(player.heading);
  const rz = -Math.sin(player.heading);
  const p = player.pos;
  p.x += (fx * move.forward + rx * move.strafe) * player.speed * dt;
  p.z += (fz * move.forward + rz * move.strafe) * player.speed * dt;

  // Jump and gravity.
  if (move.jump && player.grounded) {
    player.vy = cfg.jumpSpeed;
    player.grounded = false;
  }
  if (!player.grounded) {
    player.vy -= cfg.gravity * dt;
    p.y += player.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      player.vy = 0;
      player.grounded = true;
    }
  }

  world.resolveCircle(p, player.radius);
  const b = world.bounds;
  p.x = clamp(p.x, b.minX + 1, b.maxX - 1);
  p.z = clamp(p.z, b.minZ + 1, b.maxZ - 1);

  player.group.rotation.y = player.heading;
  // Limb swing: legs and arms counter-swing, faster when running.
  player.walkPhase += dt * player.speed * 1.6;
  const swing = moving ? Math.sin(player.walkPhase) * clamp(player.speed / cfg.runSpeed, 0.25, 1) : 0;
  const { legL, legR, armL, armR } = player.limbs;
  legL.rotation.x = swing * 0.9;
  legR.rotation.x = -swing * 0.9;
  armL.rotation.x = -swing * 0.7;
  armR.rotation.x = swing * 0.7;
}

export function createPedestrian(scene, THREE, x, z, opts = {}) {
  const rng = makeRng((Math.random() * 1e9) | 0);
  const shirt = opts.shirt ?? pick(rng, SHIRTS);
  const pants = opts.pants ?? pick(rng, PANTS);
  const skin = opts.skin ?? pick(rng, SKINS);
  const scale = opts.scale ?? range(rng, 0.92, 1.06);
  const { group, limbs } = buildFigure(THREE, shirt, pants, skin, scale);
  group.position.set(x, 0, z);
  scene.add(group);
  return {
    group,
    pos: group.position,
    heading: rng() * Math.PI * 2,
    walkSpeed: opts.speed ?? range(rng, CONFIG.peds.walkSpeedMin, CONFIG.peds.walkSpeedMax),
    walkPhase: rng() * 6,
    limbs,
    fleeing: false,
    fleeTimer: 0,
    // Sidewalk strolling: pick a road line and a direction; the ped walks
    // along it and turns at the city edge.
    lane: opts.lane ?? null,
    laneDir: rng() < 0.5 ? 1 : -1,
    radius: 0.5,
    alive: true,
  };
}

export function setPedFleeing(ped, on) {
  ped.fleeing = on;
  ped.fleeTimer = on ? 3 : 0;
}

export function updatePedestrian(ped, dt, world, threats = []) {
  if (!ped.alive) return;
  const p = ped.pos;

  // Check threats: any threat closer than the flee radius sends the ped running.
  let fleeX = 0;
  let fleeZ = 0;
  let threatened = false;
  for (const t of threats) {
    const dx = p.x - t.x;
    const dz = p.z - t.z;
    const d = Math.hypot(dx, dz);
    if (d < (t.radius ?? CONFIG.peds.fleeRadius)) {
      threatened = true;
      const inv = 1 / (d || 1);
      fleeX += dx * inv;
      fleeZ += dz * inv;
    }
  }
  if (threatened) {
    ped.fleeing = true;
    ped.fleeTimer = 2;
  } else if (ped.fleeTimer > 0) {
    ped.fleeTimer -= dt;
    if (ped.fleeTimer <= 0) ped.fleeing = false;
  }

  let speed = ped.walkSpeed;
  let dirX = 0;
  let dirZ = 0;
  if (ped.fleeing) {
    speed = CONFIG.peds.fleeSpeed;
    const l = Math.hypot(fleeX, fleeZ) || 1;
    dirX = fleeX / l;
    dirZ = fleeZ / l;
  } else if (ped.lane) {
    // Stroll along the assigned road line (sidewalk beside it).
    const axis = ped.lane.axis;
    const off = ped.lane.offset || 9;
    if (axis === 'x') {
      dirX = ped.laneDir;
      dirZ = 0;
      p.z = damp(p.z, ped.lane.line + off, 4, dt);
      if (p.x > world.bounds.maxX - 6) ped.laneDir = -1;
      if (p.x < world.bounds.minX + 6) ped.laneDir = 1;
    } else {
      dirX = 0;
      dirZ = ped.laneDir;
      p.x = damp(p.x, ped.lane.line + off, 4, dt);
      if (p.z > world.bounds.maxZ - 6) ped.laneDir = -1;
      if (p.z < world.bounds.minZ + 6) ped.laneDir = 1;
    }
  } else {
    // No lane: wander in a slow circle.
    ped.heading += dt * 0.4;
    dirX = Math.sin(ped.heading);
    dirZ = Math.cos(ped.heading);
  }

  if (dirX !== 0 || dirZ !== 0) {
    const targetHeading = Math.atan2(dirX, dirZ);
    ped.heading = angleLerp(ped.heading, targetHeading, 1 - Math.exp(-8 * dt));
    p.x += dirX * speed * dt;
    p.z += dirZ * speed * dt;
    world.resolveCircle(p, ped.radius);
  }

  ped.group.rotation.y = ped.heading;
  ped.walkPhase += dt * speed * 2.2;
  const swing = Math.sin(ped.walkPhase) * 0.7;
  ped.limbs.legL.rotation.x = swing;
  ped.limbs.legR.rotation.x = -swing;
  ped.limbs.armL.rotation.x = -swing * 0.8;
  ped.limbs.armR.rotation.x = swing * 0.8;
}
