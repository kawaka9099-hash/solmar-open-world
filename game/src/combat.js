// Solmar — game/src/combat.js
// Combat for Solmar: the player's pistol and fists, armed enemies who shoot
// back, and cash pickups. Hitscan shooting uses a raycaster from the camera
// through the crosshair; the scene matrices are refreshed first, or the ray
// tests ghosts at the origin (a real bug from an earlier build).

import { clamp, angleDiff, makeRng } from './util.js';

export const PISTOL = {
  magSize: 12,
  reserveStart: 48,
  damage: 34,
  range: 120,
  fireInterval: 0.22,
};

export const PUNCH = {
  damage: 12,
  range: 2.8,
  arc: 1.9, // radians of facing cone
  cooldown: 0.45,
};

const ENEMY_DEFS = {
  thug: { health: 60, speed: 2.4, color: 0x8a2a20, fireInterval: 2.1, damage: 7, cash: 25, range: 26 },
  guard: { health: 100, speed: 2.8, color: 0x2a344a, fireInterval: 1.7, damage: 8, cash: 40, range: 30 },
  hale: { health: 170, speed: 3.1, color: 0x1a1a1a, fireInterval: 1.3, damage: 10, cash: 150, range: 32 },
};

function enemyMesh(THREE, kind, def) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.36), mat(def.color));
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), mat(0xe8b88a));
  head.position.y = 1.62;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.26), mat(0x2a344a));
  legL.position.set(-0.16, 0.35, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), mat(0x111111));
  gun.position.set(0.3, 1.1, 0.3);
  g.add(torso, head, legL, legR, gun);
  g.traverse((m) => { m.castShadow = false; });
  return g;
}

export class Combat {
  constructor(scene, THREE, city, hooks) {
    this.scene = scene;
    this.THREE = THREE;
    this.city = city;
    this.hooks = hooks || {}; // { onCrime(kind), onPlayerHit(dmg), onKill(kind) }
    this.enemies = []; // { kind, def, health, group, x, z, heading, fireTimer, walkPhase }
    this.pickups = []; // { group, x, z, amount }
    this.tracers = []; // { line, life }
    this.rng = makeRng(424242);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = PISTOL.range;
  }

  clear() {
    for (const e of this.enemies) this.scene.remove(e.group);
    for (const p of this.pickups) this.scene.remove(p.group);
    for (const t of this.tracers) this.scene.remove(t.line);
    this.enemies = [];
    this.pickups = [];
    this.tracers = [];
  }

  spawnEnemy(kind, x, z) {
    const def = ENEMY_DEFS[kind] || ENEMY_DEFS.thug;
    const group = enemyMesh(this.THREE, kind, def);
    group.position.set(x, 0, z);
    const enemy = {
      kind, def, health: def.health, group,
      x, z, heading: this.rng() * Math.PI * 2,
      fireTimer: 1 + this.rng(), walkPhase: this.rng() * 6,
    };
    group.traverse((m) => { m.userData.enemyRef = enemy; });
    this.scene.add(group);
    this.enemies.push(enemy);
    return enemy;
  }

  _dropCash(x, z, amount) {
    const g = new this.THREE.Group();
    const box = new this.THREE.Mesh(
      new this.THREE.BoxGeometry(0.5, 0.1, 0.35),
      new this.THREE.MeshLambertMaterial({ color: 0x20c860 }),
    );
    box.position.y = 0.25;
    const band = new this.THREE.Mesh(
      new this.THREE.BoxGeometry(0.52, 0.12, 0.1),
      new this.THREE.MeshLambertMaterial({ color: 0xe8b820 }),
    );
    band.position.y = 0.25;
    g.add(box, band);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.pickups.push({ group: g, x, z, amount });
  }

  _tracer(from, to) {
    const geo = new this.THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new this.THREE.Line(geo, new this.THREE.LineBasicMaterial({
      color: 0xffe080, transparent: true, opacity: 0.9,
    }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  // Fire the pistol. origin/direction are THREE.Vector3. targets is a list
  // of { mesh, kind: 'enemy'|'ped', ref } the ray may hit. Returns the hit
  // ({ kind, ref, point, distance }) or null. Ammo is the caller's job.
  shoot(origin, direction, targets) {
    this.scene.updateMatrixWorld(true);
    this.raycaster.set(origin, direction);
    const meshes = [];
    for (const t of targets) {
      t.mesh.traverse((m) => { if (m.isMesh) meshes.push(m); });
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    const end = origin.clone().add(direction.clone().multiplyScalar(PISTOL.range));
    if (hits.length === 0) {
      this._tracer(origin, end);
      return null;
    }
    const hit = hits[0];
    this._tracer(origin, hit.point);
    // Walk up to the object that carries the target reference.
    let obj = hit.object;
    let ref = null;
    let kind = null;
    while (obj) {
      if (obj.userData.enemyRef) { ref = obj.userData.enemyRef; kind = 'enemy'; break; }
      if (obj.userData.pedRef) { ref = obj.userData.pedRef; kind = 'ped'; break; }
      obj = obj.parent;
    }
    if (!ref) return { kind: 'wall', point: hit.point, distance: hit.distance };
    if (kind === 'enemy') {
      ref.health -= PISTOL.damage;
      if (ref.health <= 0) this._killEnemy(ref);
    }
    return { kind, ref, point: hit.point, distance: hit.distance };
  }

  _killEnemy(enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i >= 0) this.enemies.splice(i, 1);
    this.scene.remove(enemy.group);
    this._dropCash(enemy.x, enemy.z, enemy.def.cash);
    if (this.hooks.onKill) this.hooks.onKill(enemy.kind);
  }

  // A fist swing. player = { x, z, heading }. Returns the enemy hit or null.
  punch(player) {
    for (const e of [...this.enemies]) {
      const dx = e.x - player.x;
      const dz = e.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > PUNCH.range) continue;
      const want = Math.atan2(dx, dz);
      if (Math.abs(angleDiff(player.heading, want)) > PUNCH.arc / 2) continue;
      e.health -= PUNCH.damage;
      if (e.health <= 0) this._killEnemy(e);
      return e;
    }
    return null;
  }

  // dt seconds. player = { x, z, heading, onFoot }. Collect pickups within
  // 2 m and let enemies close in and shoot back.
  update(dt, player) {
    // Pickups spin and get collected.
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.group.rotation.y += dt * 3;
      if (Math.hypot(p.x - player.x, p.z - player.z) < 2.2) {
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
        if (this.hooks.onPickup) this.hooks.onPickup(p.amount);
      }
    }
    // Tracers fade fast.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    // Enemies: close in, stop at range, shoot back with shaky aim.
    for (const e of [...this.enemies]) {
      const dx = player.x - e.x;
      const dz = player.z - e.z;
      const d = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      e.heading = want;
      e.group.rotation.y = want;
      if (d > 13) {
        const step = e.def.speed * dt;
        e.x += Math.sin(want) * step;
        e.z += Math.cos(want) * step;
        const p = { x: e.x, z: e.z };
        this.city.resolveCircle(p, 0.6);
        e.x = p.x;
        e.z = p.z;
        e.walkPhase += dt * 7;
      }
      e.group.position.set(e.x, Math.abs(Math.sin(e.walkPhase)) * 0.05, e.z);
      e.fireTimer -= dt;
      // Enemies shoot back at an on-foot player in range; a car is cover.
      if (player.onFoot && d < e.def.range && e.fireTimer <= 0) {
        e.fireTimer = e.def.fireInterval * (0.8 + this.rng() * 0.5);
        // Shaky aim: roughly half the shots land.
        if (this.rng() < 0.55 && this.hooks.onPlayerHit) {
          this.hooks.onPlayerHit(e.def.damage);
        }
      }
    }
  }
}
