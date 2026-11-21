// Solmar combat: pistol fire (raycast from the camera), melee punches,
// tracers and explosions. Targets are any object with a `group` (a three.js
// Object3D) and a `hitRadius`; the raycaster walks up from the mesh it hits
// to find the owner through userData.

import * as THREE from 'three';
import { PLAYER } from './config.js';
import { dist2D } from './util.js';

export class Combat {
  constructor(scene) {
    this.scene = scene;
    this.raycaster = new THREE.Raycaster();
    this.tracers = []; // { line, life }
    this.explosions = []; // { group, life }
  }

  // Tag a shootable's group so hits can be traced back to it.
  static tag(target) {
    if (target.group) target.group.userData.combatTarget = target;
  }

  // Fire from the shooter's chest along a level aim direction. The ray
  // starts at the player, not at the camera: the camera sits metres above
  // the player's head and looks down at them, so a ray cast from the
  // camera through the screen centre dives under any target more than
  // ~10m away. The aim direction is horizontal (camYaw); the camera's
  // pitch only moves the view, since every target is on foot.
  shoot(origin, direction, targets) {
    this.raycaster.set(origin, direction);
    this.raycaster.far = PLAYER.PISTOL_RANGE;
    const meshes = [];
    for (const t of targets) {
      if (t.dead || t.wrecked) continue;
      if (t.group) meshes.push(t.group);
    }
    const hits = this.raycaster.intersectObjects(meshes, true);
    const from = origin.clone();
    let hitTarget = null;
    let hitPoint = null;
    if (hits.length > 0) {
      const first = hits[0];
      hitPoint = first.point.clone();
      let obj = first.object;
      while (obj) {
        if (obj.userData.combatTarget) {
          hitTarget = obj.userData.combatTarget;
          break;
        }
        obj = obj.parent;
      }
    }
    if (!hitPoint) {
      hitPoint = from.clone().add(this.raycaster.ray.direction.clone().multiplyScalar(PLAYER.PISTOL_RANGE));
    }
    this.spawnTracer(from, hitPoint);
    return { target: hitTarget, point: hitPoint };
  }

  // A punch in front of the attacker: everything within range and a wide
  // forward arc takes damage and is knocked back.
  melee(attackerPos, heading, targets, damage = PLAYER.PUNCH_DAMAGE) {
    const hit = [];
    for (const t of targets) {
      if (t.dead || t.wrecked || !t.pos) continue;
      const d = dist2D(attackerPos.x, attackerPos.z, t.pos.x, t.pos.z);
      if (d > PLAYER.PUNCH_RANGE) continue;
      const ang = Math.atan2(t.pos.x - attackerPos.x, t.pos.z - attackerPos.z);
      let diff = ang - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.1) continue;
      hit.push(t);
      // Knockback away from the attacker.
      const kx = Math.sin(ang);
      const kz = Math.cos(ang);
      t.pos.x += kx * 1.2;
      t.pos.z += kz * 1.2;
      if (t.group) t.group.position.copy(t.pos);
    }
    return hit;
  }

  spawnTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95 }),
    );
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  // A fireball that grows and fades, plus a rising smoke puff.
  spawnExplosion(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 1.2, z);
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95 }),
    );
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95 }),
    );
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 }),
    );
    smoke.position.y = 2.2;
    group.add(fire, core, smoke);
    this.scene.add(group);
    this.explosions.push({ group, fire, core, smoke, life: 0.8 });
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.95;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= dt;
      const k = 1 - Math.max(0, e.life / 0.8);
      const s = 1 + k * 5;
      e.fire.scale.setScalar(s);
      e.core.scale.setScalar(1 + k * 2.5);
      e.fire.material.opacity = Math.max(0, 0.95 * (1 - k));
      e.core.material.opacity = Math.max(0, 0.95 * (1 - k));
      e.smoke.position.y = 2.2 + k * 5;
      e.smoke.material.opacity = Math.max(0, 0.55 * (1 - k * 0.7));
      if (e.life <= 0) {
        this.scene.remove(e.group);
        this.explosions.splice(i, 1);
      }
    }
  }
}
