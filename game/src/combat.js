// Combat: the player's pistol and fists, the Rivas crew's thugs, bullets, and the
// health and ammo pickups scattered around Solmar. Nothing here draws anything;
// render.js paints bullets, muzzle flashes and enemies from this state.
import { COMBAT, PICKUPS } from './config.js';
import { range } from './random.js';

export function createCombat(city, random) {
  const bullets = []; // {x, y, vx, vy, life, fromPlayer, damage}
  const enemies = []; // thugs: {x, y, angle, health, shootTimer, strafe}
  const pickups = []; // {kind: 'health'|'ammo', x, y, timer}
  let muzzle = 0; // seconds left of the player's muzzle flash

  function spawnThugs(x, y) {
    enemies.length = 0;
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      enemies.push({
        x: x + Math.cos(angle) * range(random, 70, 180),
        y: y + Math.sin(angle) * range(random, 70, 180),
        angle: 0, health: COMBAT.thugHealth,
        shootTimer: range(random, 0.5, 1.5), strafe: range(random, -1, 1),
        hitFlash: 0,
      });
    }
  }

  function spawnPickups() {
    // Health and ammo at fixed, memorable spots around the city.
    const spots = [
      { kind: 'health', x: 1120, y: 1760 }, { kind: 'health', x: 3160, y: 1440 },
      { kind: 'health', x: 640, y: 1440 }, { kind: 'ammo', x: 1840, y: 640 },
      { kind: 'ammo', x: 2640, y: 1840 }, { kind: 'ammo', x: 420, y: 2500 },
      { kind: 'health', x: 240, y: 640 }, { kind: 'ammo', x: 1440, y: 2240 },
    ];
    for (const s of spots) pickups.push({ ...s, timer: 0 });
  }

  function fireBullet(state, x, y, angle, fromPlayer) {
    const speed = 780;
    bullets.push({
      x: x + Math.cos(angle) * 18, y: y + Math.sin(angle) * 18,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: COMBAT.pistolRange / speed, fromPlayer, damage: fromPlayer ? COMBAT.pistolDamage : COMBAT.thugDamage,
    });
    if (fromPlayer) muzzle = 0.07;
    state.audioCue = 'shot';
  }

  function playerShoot(state, targetX, targetY) {
    const p = state.player;
    if (p.car || !p.hasPistol || p.ammo <= 0 || p.shootCooldown > 0) return false;
    p.ammo -= 1;
    p.shootCooldown = 0.28;
    const angle = Math.atan2(targetY - p.y, targetX - p.x);
    p.angle = angle;
    fireBullet(state, p.x, p.y, angle, true);
    return true;
  }

  function playerMelee(state) {
    const p = state.player;
    if (p.car || p.meleeTimer > 0) return;
    p.meleeTimer = 0.45;
    p.meleeSwing = 0.45;
    state.audioCue = 'melee';
    // Hit enemies and pedestrians in front of the player.
    for (const e of enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > COMBAT.meleeRange) continue;
      let diff = Math.atan2(e.y - p.y, e.x - p.x) - p.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < COMBAT.meleeArc) damageEnemy(state, e, COMBAT.meleeDamage);
    }
  }

  function damageEnemy(state, enemy, amount) {
    enemy.health -= amount;
    enemy.hitFlash = 0.15;
    if (enemy.health <= 0) {
      enemy.dead = true;
      state.audioCue = 'thugDown';
      state.missions.onEvent(state, 'thugDown');
      state.cash += 50; // pocket cash off the crew
    }
  }

  function update(state, dt) {
    const p = state.player;
    if (p.shootCooldown > 0) p.shootCooldown -= dt;
    if (p.meleeTimer > 0) p.meleeTimer -= dt;
    if (p.meleeSwing > 0) p.meleeSwing -= dt;
    if (muzzle > 0) muzzle -= dt;

    // Bullets fly, hit buildings, thugs, the player, or pedestrians.
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      if (city.buildingAt(b.x, b.y, 0)) { b.dead = true; continue; }
      if (b.fromPlayer) {
        for (const e of enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) < 16) {
            damageEnemy(state, e, b.damage);
            b.dead = true;
            break;
          }
        }
        if (!b.dead) {
          for (const ped of state.peds) {
            if (Math.hypot(ped.x - b.x, ped.y - b.y) < 12) {
              ped.flee = 2; ped.fleeX = b.x; ped.fleeY = b.y;
              b.dead = true;
              break;
            }
          }
        }
      } else if (Math.hypot(p.x - b.x, p.y - b.y) < 13 && !p.car) {
        p.health -= b.damage;
        p.lastDamage = state.elapsed;
        state.audioCue = 'hurt';
        b.dead = true;
      }
    }
    for (let i = bullets.length - 1; i >= 0; i -= 1) if (bullets[i].dead) bullets.splice(i, 1);

    // Thugs: strafe toward the player and shoot when in range.
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.angle = Math.atan2(dy, dx);
      if (d > 130) {
        e.x += (dx / d) * 95 * dt;
        e.y += (dy / d) * 95 * dt;
      } else {
        e.x += Math.cos(e.angle + Math.PI / 2) * e.strafe * 60 * dt;
        e.y += Math.sin(e.angle + Math.PI / 2) * e.strafe * 60 * dt;
      }
      city.resolveCircle(e, 11);
      e.shootTimer -= dt;
      if (e.shootTimer <= 0 && d < COMBAT.thugRange && !p.car) {
        e.shootTimer = range(random, 0.9, 1.6);
        const spread = range(random, -0.09, 0.09);
        fireBullet(state, e.x, e.y, e.angle + spread, false);
      }
    }
    for (let i = enemies.length - 1; i >= 0; i -= 1) if (enemies[i].dead) enemies.splice(i, 1);

    // Pickups: walk over one to take it; they respawn after a while.
    for (const pk of pickups) {
      if (pk.timer > 0) {
        pk.timer -= dt;
        continue;
      }
      if (Math.hypot(p.x - pk.x, p.y - pk.y) < 26 && !p.car) {
        pk.timer = PICKUPS.respawnSeconds;
        if (pk.kind === 'health') {
          p.health = Math.min(100, p.health + PICKUPS.healthAmount);
          state.message = `+${PICKUPS.healthAmount} health`;
        } else {
          p.ammo += PICKUPS.ammoAmount;
          if (!p.hasPistol) p.hasPistol = true;
          state.message = `+${PICKUPS.ammoAmount} pistol ammo`;
        }
        state.messageTimer = 1.6;
        state.audioCue = 'pickup';
      }
    }
  }

  return {
    bullets, enemies, pickups, spawnThugs, spawnPickups,
    playerShoot, playerMelee, fireBullet, update,
    get muzzle() { return muzzle; },
  };
}
