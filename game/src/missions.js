// Solmar — game/src/missions.js
// The story: six jobs from Lena, the fixer, against Viktor Hale's crew.
// Dario "Daz" Ferran is new in town and needs the money; each mission is a
// chain of small steps — go somewhere, drive something, deal with someone,
// bring something back — and each one pays out and unlocks the next.
//
// A mission starts by walking into the yellow beacon at the safehouse.
// The manager owns the beacon, the objective marker, any package or client
// it spawns, and the enemies a step calls for; the Game owns the money and
// the save, so finishing a job pays through the Game.

import { vec2, formatMoney } from './util.js';
import { createPedestrian } from './actors.js';

export const MISSIONS = [
  {
    id: 'm1',
    title: 'M1 — The Pickup',
    briefing: 'Lena: "A client needs a ride to the marina. Be polite, drive fast."',
    reward: 250,
    steps: [
      { type: 'goto', at: 'client', radius: 6, label: 'Meet the client near the plaza' },
      { type: 'enterCar', label: 'Get in a car — the client rides with you' },
      { type: 'driveTo', at: 'marina', radius: 14, label: 'Drive the client to the marina' },
    ],
  },
  {
    id: 'm2',
    title: 'M2 — Hot Wheels',
    briefing: 'Lena: "Hale wants a ride. Take any car off the street and bring it to my garage."',
    reward: 600,
    steps: [
      { type: 'enterCar', label: 'Steal a car — any ride will do' },
      { type: 'driveTo', at: 'safehouse', radius: 12, label: 'Deliver it to the safehouse garage' },
    ],
  },
  {
    id: 'm3',
    title: 'M3 — Dockside Debt',
    briefing: 'Lena: "Hale\'s thugs are holding my package at the docks. Go get it back."',
    reward: 800,
    steps: [
      { type: 'goto', at: 'docks', radius: 16, label: 'Head to the docks' },
      { type: 'eliminate', groups: [{ tag: 'thug', count: 4 }], at: 'docks', label: 'Deal with Hale\'s thugs' },
      { type: 'collect', at: 'docks', radius: 3, label: 'Grab the package' },
      { type: 'goto', at: 'safehouse', radius: 12, label: 'Take the package to Lena' },
    ],
  },
  {
    id: 'm4',
    title: 'M4 — Bank Job',
    briefing: 'Lena: "The Solmar Bank vault, six seconds of nerve, then run. You in?"',
    reward: 900,
    steps: [
      { type: 'goto', at: 'bank', radius: 14, label: 'Reach the Solmar Bank' },
      { type: 'wait', at: 'bank', radius: 12, seconds: 6, label: 'Crack the safe — stay close' },
      { type: 'escape', at: 'safehouse', radius: 12, label: 'Lose the heat — get to the safehouse' },
    ],
  },
  {
    id: 'm5',
    title: 'M5 — Dead Drops',
    briefing: 'Lena: "Three drops around the city. Collect them all, no questions."',
    reward: 700,
    steps: [
      { type: 'collect', at: 'docks', radius: 3, label: 'First drop: the docks' },
      { type: 'collect', at: 'hospital', radius: 3, label: 'Second drop: the hospital' },
      { type: 'collect', at: 'marina', radius: 3, label: 'Third drop: the marina' },
      { type: 'goto', at: 'safehouse', radius: 12, label: 'Bring the drops to Lena' },
    ],
  },
  {
    id: 'm6',
    title: 'M6 — The Ledger',
    briefing: 'Lena: "Hale himself is at the bank with his guards. Take the ledger, end this."',
    reward: 900,
    steps: [
      { type: 'goto', at: 'bank', radius: 16, label: 'Hale\'s crew is at the bank' },
      { type: 'eliminate', groups: [{ tag: 'guard', count: 5 }, { tag: 'hale', count: 1 }], at: 'bank', label: 'Take down Hale and his guards' },
      { type: 'collect', at: 'bank', radius: 3, label: 'Recover the ledger' },
      { type: 'goto', at: 'safehouse', radius: 12, label: 'Get the ledger to Lena' },
    ],
  },
];

export class MissionManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.index = 0;
    this.completed = [];
    this.storyComplete = false;
    this.active = null; // { def, stepIndex, spawned, packageMesh, clientPed, waitElapsed }
    this.marker = null; // beacon mesh at the current objective
    this.startBeacon = null; // beacon at the safehouse when work is waiting
    this._time = 0;
    this._announced = false;
  }

  get nextDef() {
    return this.index < MISSIONS.length ? MISSIONS[this.index] : null;
  }

  // The point the HUD and minimap should point at right now.
  get target() {
    if (this.active) {
      const step = this.active.def.steps[this.active.stepIndex];
      if (!step) return null;
      return step.at ? this._resolvePoint(step.at) : null;
    }
    if (this.nextDef) return this._resolvePoint('safehouse');
    return null;
  }

  get objectiveText() {
    if (!this.active) return null;
    const step = this.active.def.steps[this.active.stepIndex];
    if (!step) return null;
    if (step.type === 'eliminate') {
      const left = this._enemiesLeft(step);
      return step.label + (left > 0 ? ' (' + left + ' left)' : '');
    }
    if (step.type === 'wait') {
      const left = Math.max(0, Math.ceil(step.seconds - this.active.waitElapsed));
      return step.label + ' (' + left + 's)';
    }
    return step.label;
  }

  get titleText() {
    return this.active ? this.active.def.title : null;
  }

  distanceToTarget() {
    const target = this.target;
    if (!target) return null;
    const p = this.ctx.player.pos;
    return vec2.dist(p.x, p.z, target.x, target.z);
  }

  update(dt) {
    this._time += dt;
    if (this.active) {
      this._updateActive(dt);
    } else if (this.nextDef) {
      this._ensureStartBeacon();
      // Walking into the safehouse beacon starts the next job.
      const p = this.ctx.player.pos;
      const safe = this._resolvePoint('safehouse');
      if (vec2.dist(p.x, p.z, safe.x, safe.z) < 6) {
        this.startMission(this.index);
        return;
      }
      if (!this._announced) {
        this._announced = true;
        this.ctx.game.showToast('New job from Lena — head to the yellow marker at the safehouse', 5000);
      }
    }
    // Bob the beacon diamond.
    if (this.marker && this.marker.userData.diamond) {
      this.marker.userData.diamond.position.y = 3.2 + Math.sin(this._time * 2.5) * 0.4;
      this.marker.userData.diamond.rotation.y += dt * 1.5;
    }
  }

  startMission(i) {
    const def = MISSIONS[i];
    if (!def) return false;
    this._removeStartBeacon();
    this.active = { def, stepIndex: 0, spawned: [], packageMesh: null, clientPed: null, waitElapsed: 0 };
    this.ctx.game.showToast(def.briefing, 6000);
    this.ctx.sfx.click();
    this._beginStep();
    return true;
  }

  fail(reason) {
    if (!this.active) return;
    this._cleanupActive();
    this.active = null;
    this._announced = false;
    this.ctx.game.showToast('Mission failed — ' + reason, 4000);
    this.ctx.sfx.fail();
  }

  complete() {
    const def = this.active.def;
    this._cleanupActive();
    this.active = null;
    this.completed.push(def.id);
    this.index += 1;
    this._announced = false;
    this.ctx.game.addMoney(def.reward);
    this.ctx.game.combat.resupply();
    this.ctx.sfx.success();
    if (this.index >= MISSIONS.length) {
      this.storyComplete = true;
      this.ctx.game.showToast('SOLMAR IS YOURS — story complete! ' + formatMoney(def.reward) + ' from Lena.', 7000);
    } else {
      this.ctx.game.showToast('Job done — ' + formatMoney(def.reward) + ' from Lena.', 4500);
    }
    this.ctx.game.autosave();
  }

  // ---- internals ----

  _resolvePoint(at) {
    if (typeof at === 'string') {
      if (at === 'client') {
        // The M1 client waits on the plaza just north of the spawn.
        const spawn = this.ctx.city.landmarks.spawn;
        return { x: spawn.x + 18, z: spawn.z - 12 };
      }
      const landmark = this.ctx.city.landmarks[at];
      if (landmark) return { x: landmark.x, z: landmark.z };
      return { x: 0, z: 0 };
    }
    return { x: at.x, z: at.z };
  }

  _beginStep() {
    const step = this.active.def.steps[this.active.stepIndex];
    if (!step) {
      this.complete();
      return;
    }
    this.active.waitElapsed = 0;
    // Objective marker (not for pure enterCar steps, which have no place).
    this._setMarker(step.at ? this._resolvePoint(step.at) : null);
    if (step.type === 'eliminate') {
      const at = this._resolvePoint(step.at);
      const rng = this.ctx.rng;
      for (const group of step.groups) {
        for (let i = 0; i < group.count; i++) {
          const angle = rng() * Math.PI * 2;
          const radius = 4 + rng() * 9;
          const enemy = this.ctx.game.combat.spawnEnemy(
            group.tag,
            at.x + Math.cos(angle) * radius,
            at.z + Math.sin(angle) * radius,
          );
          this.active.spawned.push(enemy);
        }
      }
    } else if (step.type === 'collect') {
      const at = this._resolvePoint(step.at);
      this.active.packageMesh = this._makePackage(at.x, at.z);
    } else if (step.type === 'goto' && this.active.def.id === 'm1' && this.active.stepIndex === 0) {
      // The M1 client stands at the meeting point.
      const at = this._resolvePoint('client');
      this.active.clientPed = createPedestrian(this.ctx.scene, this.ctx.THREE, at.x, at.z, {
        shirt: 0xe8b820,
        pants: 0x2a2a4a,
        skin: 0xd8a880,
        speed: 0,
      });
    } else if (step.type === 'escape') {
      // The getaway: the heat is on the moment the step begins.
      this.ctx.game.wanted.setStars(3);
      this.ctx.game.showToast('The whole city is after you — run!', 3500);
    }
    if (step.type === 'enterCar' && this.ctx.driving.car) {
      // Already in a car when the step begins: it counts at once.
      this._advanceStep();
    }
  }

  _updateActive(dt) {
    const step = this.active.def.steps[this.active.stepIndex];
    if (!step) {
      this.complete();
      return;
    }
    const p = this.ctx.player.pos;
    const driving = this.ctx.driving.car;
    switch (step.type) {
      case 'goto':
      case 'escape': {
        const at = this._resolvePoint(step.at);
        if (vec2.dist(p.x, p.z, at.x, at.z) < step.radius) this._advanceStep();
        break;
      }
      case 'driveTo': {
        const at = this._resolvePoint(step.at);
        if (driving && vec2.dist(p.x, p.z, at.x, at.z) < step.radius) this._advanceStep();
        break;
      }
      case 'enterCar': {
        if (driving) this._advanceStep();
        break;
      }
      case 'eliminate': {
        if (this._enemiesLeft(step) === 0) this._advanceStep();
        break;
      }
      case 'collect': {
        const at = this._resolvePoint(step.at);
        if (vec2.dist(p.x, p.z, at.x, at.z) < step.radius) {
          if (this.active.packageMesh) {
            this.ctx.scene.remove(this.active.packageMesh);
            this.active.packageMesh = null;
          }
          this.ctx.sfx.pickup();
          this._advanceStep();
        }
        break;
      }
      case 'wait': {
        const at = this._resolvePoint(step.at);
        if (vec2.dist(p.x, p.z, at.x, at.z) < step.radius) {
          this.active.waitElapsed += dt;
          if (this.active.waitElapsed >= step.seconds) this._advanceStep();
        }
        break;
      }
      default:
        break;
    }
    if (this.active && this.active.packageMesh) {
      this.active.packageMesh.rotation.y += dt * 2;
      this.active.packageMesh.position.y = 0.8 + Math.sin(this._time * 3) * 0.15;
    }
  }

  _enemiesLeft(step) {
    let left = 0;
    for (const group of step.groups) {
      left += this.ctx.game.combat.countAlive(group.tag);
    }
    return left;
  }

  _advanceStep() {
    // The M1 client climbs in when the player gets a car.
    if (this.active.clientPed) {
      this.ctx.scene.remove(this.active.clientPed.group);
      this.active.clientPed = null;
      this.ctx.game.showToast('Client\'s in. Drive!', 2500);
    }
    this.active.stepIndex += 1;
    this.ctx.sfx.click();
    if (this.active.stepIndex >= this.active.def.steps.length) {
      this.complete();
      return;
    }
    this._beginStep();
  }

  _cleanupActive() {
    if (!this.active) return;
    for (const enemy of this.active.spawned) {
      this.ctx.scene.remove(enemy.ped.group);
      const list = this.ctx.game.combat.enemies;
      const i = list.indexOf(enemy);
      if (i !== -1) list.splice(i, 1);
    }
    if (this.active.packageMesh) this.ctx.scene.remove(this.active.packageMesh);
    if (this.active.clientPed) this.ctx.scene.remove(this.active.clientPed.group);
    this._setMarker(null);
    this.active.spawned = [];
    this.active.packageMesh = null;
    this.active.clientPed = null;
  }

  _setMarker(point) {
    if (this.marker) {
      this.ctx.scene.remove(this.marker);
      this.marker = null;
    }
    if (!point) return;
    const THREE = this.ctx.THREE;
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd820, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 13;
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.9),
      new THREE.MeshStandardMaterial({ color: 0xffd820, emissive: 0xa08000 }),
    );
    diamond.position.y = 3.2;
    diamond.castShadow = true;
    group.add(beam);
    group.add(diamond);
    group.userData.diamond = diamond;
    group.position.set(point.x, 0, point.z);
    this.ctx.scene.add(group);
    this.marker = group;
  }

  _makePackage(x, z) {
    const THREE = this.ctx.THREE;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.45, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x37c978, emissive: 0x1a6a35 }),
    );
    mesh.position.set(x, 0.8, z);
    mesh.castShadow = true;
    this.ctx.scene.add(mesh);
    return mesh;
  }

  _ensureStartBeacon() {
    if (this.startBeacon) return;
    const safe = this._resolvePoint('safehouse');
    const THREE = this.ctx.THREE;
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd820, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 13;
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.9),
      new THREE.MeshStandardMaterial({ color: 0xffd820, emissive: 0xa08000 }),
    );
    diamond.position.y = 3.2;
    group.add(beam);
    group.add(diamond);
    group.position.set(safe.x, 0, safe.z);
    this.ctx.scene.add(group);
    this.startBeacon = group;
  }

  _removeStartBeacon() {
    if (!this.startBeacon) return;
    this.ctx.scene.remove(this.startBeacon);
    this.startBeacon = null;
  }
}
