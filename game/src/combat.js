// Solmar — game/src/combat.js
// Pistol + fists, armed enemies, and cash pickups. Shooting is hitscan
// from the PLAYER'S EYE toward the crosshair's world point — the previous
// build fired the ray from the high chase camera and it passed over
// nearby targets' heads — and the scene graph is refreshed with
// updateMatrixWorld before every raycast, because freshly spawned
// enemies otherwise raycast as ghosts at the origin.

import { CONFIG } from './config.js';
import { makeRng } from './util.js';
import { createPlayer, updatePlayer, setPedFleeing } from './actors.js';

const ENEMY_DEFS = {
  thug: { health: 100, damage: 10, shootRange: 30, hitChance: 0.22, marker: 0xff4030 },
  guard: { health: 120, damage: 12, shootRange: 34, hitChance: 0.26, marker: 0xff8020 },
  hale: { health: 260, damage: 16, shootRange: 38, hitChance: 0.3, marker: 0xffd020 },
};

export class CombatSystem {
  constructor(scene, camera, THREE, city, hooks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.THREE = THREE;
    this.city = city;
    this.sfx = hooks.sfx ?? null;
    this.onCrime = hooks.onCrime ?? (() => {});
    this.onEnemyKilled = hooks.onEnemyKilled ?? (() => {});
    this.onPickup = hooks.onPickup ?? (() => {});
    this.rng = makeRng(0xc0ffee);
    this.ammoMag = CONFIG.combat.pistolMag;
    this.ammoReserve = CONFIG.combat.pistolReserve;
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.punchTimer = 0;
    this.enemies = [];
    this.pickups = [];
    this.tracers = [];
    this.peds = [];
    this.ctx = null; // latest frame context from update()
    this._raycaster = new THREE.Raycaster();
    this._center = new THREE.Vector2(0, 0);
  }

  setPeds(peds) {
    this.peds = peds;
  }

  spawnEnemy(kind, x, z, health = null) {
    const def = ENEMY_DEFS[kind] ?? ENEMY_DEFS.thug;
    const actor = createPlayer(this.scene, this.THREE, x, z);
    const markerGeo = new this.THREE.OctahedronGeometry(0.35);
    const markerMat = new this.THREE.MeshBasicMaterial({ color: def.marker });
    const marker = new this.THREE.Mesh(markerGeo, markerMat);
    marker.position.set(x, 2.4, z);
    this.scene.add(marker);
    const enemy = {
      kind,
      def,
      actor,
      health: health ?? def.health,
      maxHealth: health ?? def.health,
      marker,
      shootTimer: 0.8 + this.rng() * 1.2,
      dead: false,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  removeEnemy(enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i >= 0) this.enemies.splice(i, 1);
    this.scene.remove(enemy.actor.group);
    this.scene.remove(enemy.marker);
    enemy.dead = true;
  }

  clearEnemies() {
    for (const e of [...this.enemies]) this.removeEnemy(e);
  }

  spawnPickup(x, z) {
    const amount = CONFIG.money.pickupCashMin + Math.floor(this.rng() * (CONFIG.money.pickupCashMax - CONFIG.money.pickupCashMin + 1));
    const geo = new this.THREE.BoxGeometry(0.7, 0.25, 0.5);
    const mat = new this.THREE.MeshBasicMaterial({ color: 0x37c978 });
    const mesh = new this.THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.5, z);
    this.scene.add(mesh);
    this.pickups.push({ mesh, amount, age: 0 });
  }

  _shootTargets() {
    const out = [];
    for (const e of this.enemies) out.push({ root: e.actor.group, enemy: e, ped: null });
    for (const ped of this.peds) out.push({ root: ped.group, enemy: null, ped });
    return out;
  }

  tryShoot() {
    if (this.fireTimer > 0 || this.reloadTimer > 0) return false;
    if (this.ammoMag <= 0) {
      this.startReload();
      return false;
    }
    const ctx = this.ctx;
    if (!ctx) return false;
    this.fireTimer = CONFIG.combat.pistolFireInterval;
    this.ammoMag -= 1;
    if (this.sfx) this.sfx.gunshot();
    this.onCrime('shootGun');

    // Refresh world matrices first: a freshly spawned enemy's meshes sit
    // at the origin until the next render, and the ray would test ghosts.
    this.scene.updateMatrixWorld(true);

    // 1. Where is the crosshair pointing? Ray from the camera through
    //    the screen centre; the first enemy hit there is the aim point,
    //    otherwise a point 30 m out along the ray.
    this._raycaster.setFromCamera(this._center, this.camera);
    this._raycaster.far = CONFIG.combat.pistolRange;
    const targets = this._shootTargets();
    const meshes = [];
    for (const t of targets) meshes.push(t.root);
    const camHits = this._raycaster.intersectObjects(meshes, true);
    let aimPoint;
    if (camHits.length > 0) {
      aimPoint = camHits[0].point;
    } else {
      aimPoint = this._raycaster.ray.at(30, new this.THREE.Vector3());
    }

    // 2. Fire from the player's eye toward that point, and test enemies
    //    (and peds) with the eye ray — never with the camera ray.
    const eye = new this.THREE.Vector3(ctx.playerPos.x, ctx.playerPos.y + 1.5, ctx.playerPos.z);
    const dir = aimPoint.clone().sub(eye).normalize();
    this._raycaster.set(eye, dir);
    this._raycaster.far = CONFIG.combat.pistolRange;
    const hits = this._raycaster.intersectObjects(meshes, true);
    let endPoint = eye.clone().add(dir.clone().multiplyScalar(CONFIG.combat.pistolRange));
    if (hits.length > 0) {
      const hit = hits[0];
      endPoint = hit.point.clone();
      let node = hit.object;
      while (node && !targets.some((t) => t.root === node)) node = node.parent;
      const target = node ? targets.find((t) => t.root === node) : null;
      if (target?.enemy) this._damageEnemy(target.enemy, CONFIG.combat.pistolDamage);
      else if (target?.ped) {
        setPedFleeing(target.ped, true);
        this.onCrime('assaultPed');
      }
    }
    this._addTracer(eye, endPoint);
    if (this.ammoMag <= 0) this.startReload();
    return true;
  }

  _damageEnemy(enemy, dmg) {
    enemy.health -= dmg;
    if (enemy.health <= 0 && !enemy.dead) {
      this.spawnPickup(enemy.actor.pos.x, enemy.actor.pos.z);
      this.onEnemyKilled(enemy);
      this.removeEnemy(enemy);
    }
  }

  tryPunch() {
    if (this.punchTimer > 0) return false;
    const ctx = this.ctx;
    if (!ctx) return false;
    this.punchTimer = 0.45;
    if (this.sfx) this.sfx.punch();
    const facing = { x: Math.sin(ctx.playerHeading), z: Math.cos(ctx.playerHeading) };
    let best = null; // { kind: 'enemy'|'ped', ref, dist }
    const consider = (kind, ref, x, z) => {
      const dx = x - ctx.playerPos.x;
      const dz = z - ctx.playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d > CONFIG.combat.punchRange) return;
      if (best && d >= best.dist) return;
      const dot = (dx * facing.x + dz * facing.z) / Math.max(d, 0.001);
      if (dot < 0.3) return;
      best = { kind, ref, dist: d, dx, dz };
    };
    for (const e of this.enemies) consider('enemy', e, e.actor.pos.x, e.actor.pos.z);
    for (const ped of this.peds) consider('ped', ped, ped.pos.x, ped.pos.z);
    if (best?.kind === 'enemy') {
      const hitEnemy = best.ref;
      this._damageEnemy(hitEnemy, CONFIG.combat.punchDamage);
      // Shove the enemy away from the player.
      const d = Math.max(0.5, best.dist);
      hitEnemy.actor.pos.x += (best.dx / d) * 0.7;
      hitEnemy.actor.pos.z += (best.dz / d) * 0.7;
      this.city.resolveCircle(hitEnemy.actor.pos, 0.55);
    } else if (best?.kind === 'ped') {
      setPedFleeing(best.ref, true);
      this.onCrime('assaultPed');
    }
    return true;
  }

  startReload() {
    if (this.reloadTimer > 0 || this.ammoReserve <= 0 || this.ammoMag >= CONFIG.combat.pistolMag) return;
    this.reloadTimer = 0.9;
    if (this.sfx) this.sfx.reload();
  }

  _finishReload() {
    const need = CONFIG.combat.pistolMag - this.ammoMag;
    const take = Math.min(need, this.ammoReserve);
    this.ammoMag += take;
    this.ammoReserve -= take;
  }

  _addTracer(from, to) {
    const geo = new this.THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new this.THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
    const line = new this.THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, age: 0 });
  }

  update(dt, ctx) {
    this.ctx = ctx;
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this._finishReload();
    }

    // Tracers fade out fast.
    for (const t of [...this.tracers]) {
      t.age += dt;
      t.line.material.opacity = Math.max(0, 0.9 - t.age * 9);
      if (t.age > 0.12) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(this.tracers.indexOf(t), 1);
      }
    }

    // Cash pickups bob; walking over one collects it.
    for (const pk of [...this.pickups]) {
      pk.age += dt;
      pk.mesh.position.y = 0.5 + Math.sin(pk.age * 4) * 0.12;
      pk.mesh.rotation.y += dt * 2;
      const d = Math.hypot(pk.mesh.position.x - ctx.playerPos.x, pk.mesh.position.z - ctx.playerPos.z);
      if (d < 1.6 && !ctx.inCar) {
        this.scene.remove(pk.mesh);
        this.pickups.splice(this.pickups.indexOf(pk), 1);
        if (this.sfx) this.sfx.pickup();
        this.onPickup(pk.amount);
      }
    }

    // Enemy AI: close to shooting range, then stand off and fire with
    // shaky aim. Enemies never shoot a fast-moving car.
    const inCar = !!ctx.inCar;
    const carSpeed = Math.abs(ctx.carSpeed ?? 0);
    for (const e of [...this.enemies]) {
      const p = e.actor.pos;
      const dx = ctx.playerPos.x - p.x;
      const dz = ctx.playerPos.z - p.z;
      const dist = Math.hypot(dx, dz);
      const heading = Math.atan2(dx, dz);
      e.marker.position.set(p.x, 2.4 + Math.sin(ctx.time * 3 + p.x) * 0.12, p.z);
      if (dist > 40) continue;
      if (dist > 11) {
        updatePlayer(e.actor, { forward: 1, strafe: 0, heading, sprint: false, jump: false }, dt, this.city);
      } else {
        e.actor.heading = heading;
        updatePlayer(e.actor, { forward: 0, strafe: 0, heading, sprint: false, jump: false }, dt, this.city);
      }
      e.shootTimer -= dt;
      const canShoot = dist <= e.def.shootRange && (!inCar || (carSpeed < 5 && dist < 15));
      if (canShoot && e.shootTimer <= 0) {
        e.shootTimer = 1.1 + this.rng() * 1.1;
        if (this.rng() < e.def.hitChance) {
          ctx.damagePlayer(e.def.damage * (0.7 + this.rng() * 0.6));
        }
        if (this.sfx && dist < 40) this.sfx.gunshot();
      }
    }
  }
}
