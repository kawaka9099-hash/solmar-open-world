// Solmar's missions: six story jobs driven by the data in config.js. The
// runner shows an intro card, plants a light beacon on the current
// objective, watches the player complete each step (go to, enter a car,
// deliver, collect, defeat enemies, escape), pays the reward and reports
// pass or fail back to the game.

import * as THREE from 'three';
import { MISSIONS } from './config.js';
import { dist2D } from './util.js';

// Which step of which mission needs a specific car (by the game's car id).
const MISSION_CARS = {
  1: { 0: 'lena' },
  // The sport is the target for both the steal step and the delivery step:
  // without the delivery mapping, enterStep clears targetCar and the
  // deliverCar check (inCar === targetCar) can never pass.
  2: { 1: 'sport', 2: 'sport' },
};

export class MissionRunner {
  constructor(scene) {
    this.scene = scene;
    this.active = null;
    this.completed = new Set();
    this.beacon = this.makeBeacon();
    this.beacon.visible = false;
    scene.add(this.beacon);
    this.packageMesh = null;
    this.targetCar = null;
  }

  makeBeacon() {
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.6, 70, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb62e, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    beam.position.y = 35;
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.3),
      new THREE.MeshBasicMaterial({ color: 0xffb62e }),
    );
    diamond.position.y = 7;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb62e, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    group.add(beam, diamond, ring);
    group.userData.diamond = diamond;
    return group;
  }

  // Begin a mission by its 1-based id. Returns its definition.
  start(id, game) {
    const def = MISSIONS.find((m) => m.id === id);
    if (!def) return null;
    this.abort();
    this.active = {
      def,
      stepIndex: 0,
      timer: 0,
      kills: 0,
      step: null,
      game,
    };
    this.enterStep(game);
    return def;
  }

  abort() {
    this.active = null;
    this.beacon.visible = false;
    this.clearPackage();
    this.targetCar = null;
  }

  clearPackage() {
    if (this.packageMesh) {
      this.scene.remove(this.packageMesh);
      this.packageMesh = null;
    }
  }

  currentStep() {
    return this.active ? this.active.def.steps[this.active.stepIndex] : null;
  }

  enterStep(game) {
    const step = this.currentStep();
    this.active.step = step;
    this.active.timer = step.time ?? 0;
    this.active.kills = 0;
    this.clearPackage();
    this.targetCar = null;
    const carId = MISSION_CARS[this.active.def.id]?.[this.active.stepIndex];
    if (carId) this.targetCar = game.getMissionCar(carId);
    if (step.type === 'kill') {
      game.spawnEnemies(step.x, step.z, step.count, this.active.def.id === 6);
    }
    if (step.type === 'collect') {
      const pkg = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.6, 0.9),
        new THREE.MeshBasicMaterial({ color: 0xffd24a }),
      );
      pkg.position.set(step.x, 0.8, step.z);
      this.scene.add(pkg);
      this.packageMesh = pkg;
    }
    if (step.wanted) game.wanted.setStars(step.wanted);
    this.beacon.visible = true;
    this.moveBeacon(game);
    game.hud.showObjective(this.active.def, step);
  }

  // The beacon follows moving targets (a car) and pulses.
  moveBeacon(game) {
    const step = this.currentStep();
    if (!step) return;
    let x = step.x;
    let z = step.z;
    if (this.targetCar && !this.targetCar.wrecked) {
      x = this.targetCar.pos.x;
      z = this.targetCar.pos.z;
    }
    this.beacon.position.set(x, 0, z);
  }

  update(dt, game) {
    if (!this.active) return;
    const step = this.currentStep();
    const player = game.player;
    this.moveBeacon(game);
    this.beacon.userData.diamond.rotation.y += dt * 2;
    this.beacon.userData.diamond.position.y = 7 + Math.sin(game.time * 2.2) * 0.6;
    if (this.packageMesh) {
      this.packageMesh.rotation.y += dt * 1.5;
      this.packageMesh.position.y = 0.8 + Math.sin(game.time * 3) * 0.15;
    }

    // Countdown for timed steps.
    if (step.time) {
      this.active.timer -= dt;
      if (this.active.timer <= 0) {
        this.fail(game, 'Out of time.');
        return;
      }
    }

    const px = player.pos.x;
    const pz = player.pos.z;
    const inCar = game.playerCar;

    switch (step.type) {
      case 'goto':
      case 'driveTo':
      case 'escape': {
        const cx = inCar ? inCar.pos.x : px;
        const cz = inCar ? inCar.pos.z : pz;
        if (dist2D(cx, cz, step.x, step.z) < step.radius) this.advance(game);
        break;
      }
      case 'enterCar': {
        if (inCar && inCar === this.targetCar) this.advance(game);
        break;
      }
      case 'deliverCar': {
        if (this.targetCar && this.targetCar.wrecked) {
          this.fail(game, 'The car was destroyed.');
          return;
        }
        if (inCar && inCar === this.targetCar && dist2D(inCar.pos.x, inCar.pos.z, step.x, step.z) < step.radius) {
          this.advance(game);
        }
        break;
      }
      case 'collect': {
        if (dist2D(px, pz, step.x, step.z) < step.radius) {
          this.clearPackage();
          game.audio.pickup();
          this.advance(game);
        }
        break;
      }
      case 'kill': {
        if (this.active.kills >= step.count) this.advance(game);
        break;
      }
      default:
        break;
    }
  }

  registerKill() {
    if (!this.active) return;
    this.active.kills++;
    const step = this.currentStep();
    if (step && step.type === 'kill') {
      const done = Math.min(this.active.kills, step.count);
      const base = step.text.replace(/\(\d+\/\d+\)/, '').trim();
      this.active.game?.hud.setObjectiveText(`${base} (${done}/${step.count})`);
    }
  }

  advance(game) {
    this.active.stepIndex++;
    if (this.active.stepIndex >= this.active.def.steps.length) {
      this.complete(game);
      return;
    }
    this.enterStep(game);
  }

  complete(game) {
    const def = this.active.def;
    this.completed.add(def.id);
    this.abort();
    game.onMissionPassed(def);
  }

  fail(game, reason) {
    const def = this.active.def;
    this.abort();
    game.onMissionFailed(def, reason);
  }

  // Objective text for the HUD, with a live kill count when relevant.
  objectiveText() {
    if (!this.active) return null;
    const step = this.currentStep();
    if (step.type === 'kill') {
      const base = step.text.replace(/\(\d+\/\d+\)/, '').trim();
      return `${base} (${Math.min(this.active.kills, step.count)}/${step.count})`;
    }
    return step.text;
  }

  // Distance from the player to the current objective, in metres.
  distanceTo(playerPos) {
    if (!this.active) return null;
    const step = this.currentStep();
    let x = step.x;
    let z = step.z;
    if (this.targetCar && !this.targetCar.wrecked) {
      x = this.targetCar.pos.x;
      z = this.targetCar.pos.z;
    }
    return Math.round(dist2D(playerPos.x, playerPos.z, x, z));
  }

  // Minimap blip position, or null when no mission is active.
  blip() {
    if (!this.active) return null;
    const step = this.currentStep();
    if (this.targetCar && !this.targetCar.wrecked) {
      return { x: this.targetCar.pos.x, z: this.targetCar.pos.z };
    }
    return { x: step.x, z: step.z };
  }
}
