// Solmar — game/src/combat.js
// Combat: the pistol (hitscan, magazine + reserve, reload), the punch,
// and the armed enemies missions throw at the player. Enemies are
// pedestrians with a health bar and a tag ('thug', 'guard', 'hale'); they
// close in, shoot back with shaky aim, and drop cash when they fall.
// Shooting a bystander is a crime — the wanted system hears about it.
//
// Enemies are driven here, not by the ambient pedestrian walker: they
// chase the player, face them, and fall over when their health runs out.

import { CONFIG } from './config.js';
import { clamp, makeRng, range, vec2 } from './util.js';
import { createPedestrian } from './actors.js';

const ENEMY_COLORS = {
  thug: { shirt: 0x8a2020, pants: 0x222222, skin: 0xc89878 },
  guard: { shirt: 0x20242a, pants: 0x2a2a2a, skin: 0xb08060 },
  hale: { shirt: 0xd8b820, pants: 0x1a1a1a, skin: 0xd8a880 },
};

const ENEMY_HEALTH = { thug: 100, guard: 120, hale: 240 };

export class CombatSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.ammoMag = CONFIG.combat.pistolMag;
    this.ammoReserve = CONFIG.combat.pistolReserve;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireTimer = 0;
    this.enemies = []; // { ped, health, maxHealth, tag, alive, shootCooldown, meleeCooldown, fallTimer, deadTimer }
    this.pickups = []; // { mesh, amount, x, z }
    this._rng = makeRng(CONFIG.city.seed + 31);
    this._tracer = null;
    this._tracerLife = 0;
    this._flash = null;
    this._pedHealth = new Map(); // ambient ped -> remaining health
  }

  spawnEnemy(tag, x, z, health) {
    const colors = ENEMY_COLORS[tag] || ENEMY_COLORS.thug;
    const ped = createPedestrian(this.ctx.scene, this.ctx.THREE, x, z, {
      shirt: colors.shirt,
      pants: colors.pants,
      skin: colors.skin,
      speed: 3.2,
    });
    const enemy = {
      ped,
      tag,
      health: health || ENEMY_HEALTH[tag] || 100,
      maxHealth: health || ENEMY_HEALTH[tag] || 100,
      alive: true,
      shootCooldown: range(this._rng, 0.6, 1.6),
      meleeCooldown: 0,
      fallTimer: 0,
      deadTimer: 0,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  countAlive(tag) {
    let n = 0;
    for (const e of this.enemies) if (e.alive && (!tag || e.tag === tag)) n++;
    return n;
  }

  enemyPositions() {
    const out = [];
    for (const e of this.enemies) {
      if (e.alive) out.push({ x: e.ped.group.position.x, z: e.ped.group.position.z });
    }
    return out;
  }

  resupply() {
    this.ammoReserve += 24;
  }

  startReload() {
    if (this.reloading) return;
    if (this.ammoMag >= CONFIG.combat.pistolMag || this.ammoReserve <= 0) return;
    this.reloading = true;
    this.reloadTimer = 1.1;
    this.ctx.sfx.reload();
  }

  // A pistol shot from the camera through the crosshair.
  tryShoot() {
    const ctx = this.ctx;
    if (this.reloading || this.fireTimer > 0) return;
    if (ctx.driving.car) return; // no drive-bys
    if (this.ammoMag <= 0) {
      this.ctx.sfx.click();
      this.startReload();
      return;
    }
    this.fireTimer = CONFIG.combat.pistolFireInterval;
    this.ammoMag -= 1;
    ctx.sfx.gunshot();
    ctx.game.registerThreat(ctx.player.pos.x, ctx.player.pos.z, 26, 2);

    const THREE = ctx.THREE;
    // Where the crosshair points: a ray from the camera through the
    // centre of the screen, sampled a short way out and kept at chest
    // height so distant targets stay on the line.
    const aimRay = new THREE.Raycaster();
    aimRay.setFromCamera({ x: 0, y: 0 }, ctx.camera);
    aimRay.far = CONFIG.combat.pistolRange;
    const aimPoint = aimRay.ray.at(12, new THREE.Vector3());
    aimPoint.y = Math.max(1.0, aimPoint.y);
    // The shot leaves the player's eye toward that point (third-person
    // hitscan): shooting from the camera behind the player would send
    // bullets over the heads of nearby targets.
    const eye = ctx.player.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const dir = aimPoint.clone().sub(eye).normalize();
    const shotRay = new THREE.Raycaster(eye, dir);
    shotRay.far = CONFIG.combat.pistolRange;
    // Freshly spawned targets may not have had a render yet, so their
    // world matrices can be stale — refresh the scene graph before the
    // raycast, or the shot tests ghosts at the origin.
    this.ctx.scene.updateMatrixWorld(true);
    const { groups, records } = this._collectTargets();
    const hits = shotRay.intersectObjects(groups, true);
    const from = eye.clone().addScaledVector(dir, 0.6);
    let end = eye.clone().addScaledVector(dir, CONFIG.combat.pistolRange);
    if (hits.length > 0) {
      const hit = hits[0];
      end = hit.point.clone();
      const record = this._recordForMesh(hit.object, records);
      if (record) this._applyHit(record, hit.point);
    }
    this._showTracer(from, end);
    if (this.ammoMag === 0) this.startReload();
  }

  // A punch at whatever is right in front of the player.
  tryPunch() {
    const ctx = this.ctx;
    if (ctx.driving.car) return;
    const px = ctx.player.pos.x;
    const pz = ctx.player.pos.z;
    const forward = new ctx.THREE.Vector3();
    ctx.camera.getWorldDirection(forward);
    let best = null;
    let bestDist = CONFIG.combat.punchRange;
    const consider = (x, z, record) => {
      const dx = x - px;
      const dz = z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > bestDist) return;
      const dot = (dx * forward.x + dz * forward.z) / Math.max(0.001, dist);
      if (dot < 0.5) return;
      bestDist = dist;
      best = record;
    };
    for (const e of this.enemies) {
      if (!e.alive) continue;
      consider(e.ped.group.position.x, e.ped.group.position.z, { kind: 'enemy', enemy: e });
    }
    for (const ped of ctx.peds) {
      if (ped._dead) continue;
      consider(ped.group.position.x, ped.group.position.z, { kind: 'ped', ped });
    }
    if (!best) {
      ctx.sfx.punch();
      return;
    }
    ctx.sfx.punch();
    if (best.kind === 'enemy') {
      this._damageEnemy(best.enemy, CONFIG.combat.punchDamage);
    } else {
      this._damagePed(best.ped, CONFIG.combat.punchDamage);
    }
  }

  update(dt) {
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        const need = CONFIG.combat.pistolMag - this.ammoMag;
        const moved = Math.min(need, this.ammoReserve);
        this.ammoMag += moved;
        this.ammoReserve -= moved;
      }
    }
    if (this._tracer) {
      this._tracerLife -= dt;
      if (this._tracerLife <= 0) {
        this.ctx.scene.remove(this._tracer);
        this._tracer.geometry.dispose();
        this._tracer.material.dispose();
        this._tracer = null;
      }
    }

    // Enemy behaviour: close in, shoot with shaky aim, or punch up close.
    const ctx = this.ctx;
    const playerPos = ctx.player.pos;
    const driving = ctx.driving.car;
    for (const e of [...this.enemies]) {
      if (!e.alive) {
        e.deadTimer += dt;
        if (e.deadTimer > 4) {
          ctx.scene.remove(e.ped.group);
          this.enemies.splice(this.enemies.indexOf(e), 1);
        }
        continue;
      }
      const pos = e.ped.group.position;
      const dx = playerPos.x - pos.x;
      const dz = playerPos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      // Face the player.
      pos.y = 0;
      e.ped.group.rotation.y = Math.atan2(dx, dz);
      e.shootCooldown -= dt;
      e.meleeCooldown -= dt;
      if (dist > 2.4) {
        // Walk toward the player (never through walls).
        const speed = e.tag === 'hale' ? 3.6 : 3.1;
        const step = Math.min(dist - 2.4, speed * dt);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        ctx.city.resolveCircle(pos, 0.5);
        // Limb swing while they close in.
        e.walkPhase = (e.walkPhase || 0) + dt * 8;
        const limbs = e.ped.limbs;
        if (limbs) {
          const swing = Math.sin(e.walkPhase) * 0.55;
          if (limbs.legL) limbs.legL.rotation.x = swing;
          if (limbs.legR) limbs.legR.rotation.x = -swing;
          if (limbs.armL) limbs.armL.rotation.x = -swing * 0.8;
          if (limbs.armR) limbs.armR.rotation.x = swing * 0.8;
        }
      }
      if (dist < 2.4 && e.meleeCooldown <= 0) {
        e.meleeCooldown = 1.0;
        ctx.sfx.punch();
        if (!driving) ctx.game.damagePlayer(10);
      } else if (dist >= 2.4 && dist < 30 && e.shootCooldown <= 0 && !driving) {
        e.shootCooldown = range(this._rng, 1.2, 2.1);
        ctx.sfx.gunshot();
        const hitChance = dist < 12 ? 0.42 : 0.26;
        this._showTracer(pos.clone().add(new ctx.THREE.Vector3(0, 1.4, 0)), playerPos.clone().add(new ctx.THREE.Vector3(0, 1.2, 0)));
        if (this._rng() < hitChance) ctx.game.damagePlayer(8 + Math.floor(this._rng() * 8));
      }
    }

    // Cash pickups: walk over one to grab it.
    for (const pickup of [...this.pickups]) {
      pickup.mesh.rotation.y += dt * 2;
      const d = vec2.dist(pickup.x, pickup.z, playerPos.x, playerPos.z);
      if (d < 1.6) {
        ctx.game.addMoney(pickup.amount);
        ctx.sfx.pickup();
        ctx.game.showToast('Picked up ' + '$' + pickup.amount, 1800);
        ctx.scene.remove(pickup.mesh);
        this.pickups.splice(this.pickups.indexOf(pickup), 1);
      }
    }
  }

  _collectTargets() {
    const groups = [];
    const records = new Map(); // mesh -> { kind, enemy|ped|car }
    const register = (group, record) => {
      groups.push(group);
      group.traverse((obj) => {
        if (obj.isMesh) records.set(obj, record);
      });
    };
    for (const e of this.enemies) {
      if (e.alive) register(e.ped.group, { kind: 'enemy', enemy: e });
    }
    for (const ped of this.ctx.peds) {
      if (!ped._dead) register(ped.group, { kind: 'ped', ped });
    }
    for (const car of this.ctx.cars) {
      if (car.driver === 'police') register(car.group, { kind: 'policeCar', car });
    }
    return { groups, records };
  }

  _recordForMesh(mesh, records) {
    let obj = mesh;
    while (obj) {
      const record = records.get(obj);
      if (record) return record;
      obj = obj.parent;
    }
    return null;
  }

  _applyHit(record, point) {
    const ctx = this.ctx;
    if (record.kind === 'enemy') {
      this._damageEnemy(record.enemy, CONFIG.combat.pistolDamage);
    } else if (record.kind === 'ped') {
      this._damagePed(record.ped, CONFIG.combat.pistolDamage);
    } else if (record.kind === 'policeCar') {
      const car = record.car;
      car.damage = Math.min(CONFIG.cars.wreckAt, (car.damage || 0) + CONFIG.combat.pistolDamage);
      if (car.damage >= CONFIG.cars.wreckAt) car.wrecked = true;
      ctx.game.wanted.addCrime('hitPolice');
      ctx.sfx.crash(0.4);
    }
  }

  _damageEnemy(enemy, amount) {
    enemy.health -= amount;
    if (enemy.health > 0) return;
    enemy.alive = false;
    enemy.deadTimer = 0;
    // Fall flat on their side.
    enemy.ped.group.rotation.z = Math.PI / 2;
    // A third of kills drop a little cash.
    if (this._rng() < 0.35) {
      const amount = CONFIG.money.pickupCashMin + Math.floor(this._rng() * (CONFIG.money.pickupCashMax - CONFIG.money.pickupCashMin));
      this._dropPickup(enemy.ped.group.position.x, enemy.ped.group.position.z, amount);
    }
  }

  _damagePed(ped, amount) {
    const before = this._pedHealth.get(ped) ?? 50;
    const after = before - amount;
    this._pedHealth.set(ped, after);
    this.ctx.game.wanted.addCrime('assaultPed');
    if (after <= 0 && !ped._dead) {
      ped._dead = true;
      ped.group.rotation.z = Math.PI / 2;
      this.ctx.game.wanted.addCrime('killPed');
      this.ctx.game.showToast('You killed a bystander. The city saw that.', 2600);
    } else {
      // The victim and everyone nearby runs.
      this.ctx.game.registerThreat(ped.group.position.x, ped.group.position.z, 14, 3);
    }
  }

  _dropPickup(x, z, amount) {
    const THREE = this.ctx.THREE;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.12, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x37c978, emissive: 0x1a5a30 }),
    );
    mesh.position.set(x, 0.6, z);
    mesh.castShadow = true;
    this.ctx.scene.add(mesh);
    this.pickups.push({ mesh, amount, x, z });
  }

  _showTracer(from, to) {
    const THREE = this.ctx.THREE;
    if (this._tracer) {
      this.ctx.scene.remove(this._tracer);
      this._tracer.geometry.dispose();
      this._tracer.material.dispose();
      this._tracer = null;
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    this._tracer = new THREE.Line(geometry, material);
    this._tracerLife = 0.09;
    this.ctx.scene.add(this._tracer);
  }
}
