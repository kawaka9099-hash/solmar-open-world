// Solmar — game/src/missions.js
// Six story jobs for Dario "Daz" Ferran, handed out by the fixer Lena,
// against the developer Viktor Hale. Jobs unlock in order from the
// safehouse beacon; failing one (busted or wasted) sends Daz back to
// the safehouse to try again — the job index does not move.
//
// Steps are small data: goto / enterCar / driveTo / stealCar / fight /
// collect / wait / drops. The system owns the beacon, the client, the
// package and the enemies of the current step, and nothing else.

import { createCar } from './vehicles.js';
import { createPedestrian } from './actors.js';

const LAND = (city, key) => city.landmarks[key];

export const MISSION_DEFS = [
  {
    id: 'm1',
    title: 'The Pickup',
    briefing: 'Lena needs a client taken to the marina. Get a car first.',
    reward: 250,
    steps: [
      { type: 'goto', point: 'spawn', dx: 18, dz: -12, radius: 4, text: 'Meet the client near the plaza' },
      { type: 'enterCar', text: 'Get in a car — the client rides with you' },
      { type: 'driveTo', point: 'marina', radius: 8, text: 'Drive the client to the marina' },
    ],
  },
  {
    id: 'm2',
    title: 'Hot Wheels',
    briefing: 'A sport car is parked by the bank. Take it to the docks.',
    reward: 600,
    steps: [
      { type: 'stealCar', point: 'bank', dx: -10, dz: 8, radius: 5, text: 'Steal the sport car by the bank' },
      { type: 'driveTo', point: 'docks', radius: 8, text: 'Deliver the car to the docks' },
    ],
  },
  {
    id: 'm3',
    title: 'Dockside Trouble',
    briefing: 'Hale’s thugs are holding a package at the docks. Take it back.',
    reward: 800,
    steps: [
      { type: 'goto', point: 'docks', radius: 8, text: 'Head to the docks' },
      { type: 'fight', point: 'docks', kinds: ['thug', 'thug', 'thug'], radius: 30, text: 'Deal with the thugs' },
      { type: 'collect', point: 'docks', dx: 4, dz: 2, radius: 3, item: 'package', text: 'Grab the package' },
      { type: 'goto', point: 'safehouse', radius: 8, text: 'Bring the package to the safehouse' },
    ],
  },
  {
    id: 'm4',
    title: 'The Bank Job',
    briefing: 'Crack the bank safe. The alarm will bring the whole SPD.',
    reward: 900,
    steps: [
      { type: 'goto', point: 'bank', radius: 8, text: 'Get to the bank' },
      { type: 'wait', point: 'bank', radius: 7, seconds: 8, text: 'Crack the safe — stay close', alarm: true },
      { type: 'driveTo', point: 'safehouse', radius: 8, text: 'Lose the heat — get to the safehouse' },
    ],
  },
  {
    id: 'm5',
    title: 'Dead Drops',
    briefing: 'Three drops, three corners of the city. Don’t get followed.',
    reward: 700,
    steps: [
      { type: 'drops', points: ['hospital', 'marina', 'docks'], radius: 6, text: 'Make the dead drops' },
    ],
  },
  {
    id: 'm6',
    title: 'The Ledger',
    briefing: 'Hale keeps his ledger at the docks. End this.',
    reward: 900,
    steps: [
      { type: 'goto', point: 'docks', radius: 8, text: 'Get to the docks' },
      { type: 'fight', point: 'docks', kinds: ['hale', 'guard', 'guard', 'guard'], radius: 30, text: 'Take down Hale and his guards' },
      { type: 'collect', point: 'docks', dx: -4, dz: -2, radius: 3, item: 'ledger', text: 'Take the ledger' },
      { type: 'goto', point: 'safehouse', radius: 8, text: 'Bring the ledger home' },
    ],
  },
];

export class MissionSystem {
  constructor(scene, THREE, city, deps) {
    this.scene = scene;
    this.THREE = THREE;
    this.city = city;
    this.combat = deps.combat;
    this.wanted = deps.wanted;
    this.sfx = deps.sfx ?? null;
    this.game = deps.game; // for addMoney / toast / addCrime
    this.cars = deps.cars; // shared array (target cars get pushed here)
    this.index = 0; // next mission to start
    this.completed = [];
    this.storyDone = false;
    this.active = null; // { def, stepIndex, runtime }
    this.beacon = null; // { group, ring, getPos }
  }

  get currentDef() {
    return this.active ? this.active.def : null;
  }

  startMission(i) {
    if (this.active || i < 0 || i >= MISSION_DEFS.length) return false;
    const def = MISSION_DEFS[i];
    this.active = { def, stepIndex: 0, runtime: this._newRuntime() };
    if (this.game) this.game.toast(`${def.id.toUpperCase()} — ${def.title}: ${def.briefing}`, 4200);
    if (this.sfx) this.sfx.success();
    this._startStep();
    return true;
  }

  startNext() {
    return this.startMission(this.index);
  }

  fail(reason) {
    if (!this.active) return;
    const def = this.active.def;
    this._clearStep();
    this.active = null;
    if (this.game) this.game.toast(`Job failed (${reason}) — see Lena at the safehouse`, 3600);
    if (this.sfx) this.sfx.fail();
    void def;
  }

  onEnemyKilled(enemy) {
    const a = this.active;
    if (!a) return;
    const rt = a.runtime;
    if (rt.fightEnemies.includes(enemy)) {
      rt.fightRemaining -= 1;
      if (rt.fightRemaining <= 0) this._advance();
    }
  }

  _newRuntime() {
    return {
      timer: 0,
      subIndex: 0,
      fightEnemies: [],
      fightRemaining: 0,
      targetCar: null,
      clientPed: null,
      itemMesh: null,
      alarmRaised: false,
    };
  }

  _pointOf(step) {
    if (step.point) {
      const base = LAND(this.city, step.point);
      return { x: base.x + (step.dx ?? 0), z: base.z + (step.dz ?? 0) };
    }
    return null;
  }

  _startStep() {
    const a = this.active;
    if (!a) return;
    const step = a.def.steps[a.stepIndex];
    const rt = a.runtime;
    rt.timer = 0;
    rt.subIndex = 0;
    const pt = this._pointOf(step);

    if (step.type === 'goto' && a.stepIndex === 0 && a.def.id === 'm1') {
      // The client waits at the meeting point.
      rt.clientPed = createPedestrian(this.scene, this.THREE, pt.x, pt.z, { shirt: 0xe8b820, pants: 0x2a2c30, skin: 0xd8a077 });
    }
    if (step.type === 'stealCar') {
      const car = createCar(this.scene, this.THREE, 'sport', pt.x, pt.z, Math.PI / 2);
      car.isMissionTarget = true;
      this.scene.add(car.group);
      this.cars.push(car);
      rt.targetCar = car;
    }
    if (step.type === 'fight') {
      rt.fightEnemies = [];
      step.kinds.forEach((kind, i) => {
        const angle = (i / step.kinds.length) * Math.PI * 2;
        const e = this.combat.spawnEnemy(kind, pt.x + Math.cos(angle) * 7, pt.z + Math.sin(angle) * 7);
        rt.fightEnemies.push(e);
      });
      rt.fightRemaining = step.kinds.length;
    }
    if (step.type === 'collect') {
      const color = step.item === 'ledger' ? 0xf5e6a8 : 0xf2c230;
      const mesh = new this.THREE.Mesh(
        new this.THREE.BoxGeometry(0.7, 0.45, 0.5),
        new this.THREE.MeshBasicMaterial({ color }),
      );
      mesh.position.set(pt.x, 0.6, pt.z);
      this.scene.add(mesh);
      rt.itemMesh = mesh;
    }
    if (step.type === 'wait' && step.alarm && !rt.alarmRaised) {
      rt.alarmRaised = true;
      this.wanted.setStars(3, 0);
      if (this.game) this.game.toast('The alarm is screaming — the whole SPD is coming', 3600);
    }
    this._makeBeacon(step);
  }

  _makeBeacon(step) {
    this._clearBeacon();
    const target = this._stepTarget(step);
    if (!target) return;
    const group = new this.THREE.Group();
    const beam = new this.THREE.Mesh(
      new this.THREE.CylinderGeometry(1.4, 1.4, 34, 12, 1, true),
      new this.THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.22, side: this.THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 17;
    const ring = new this.THREE.Mesh(
      new this.THREE.RingGeometry(2.1, 2.7, 24),
      new this.THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.85, side: this.THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    group.add(beam);
    group.add(ring);
    group.position.set(target.x, 0, target.z);
    this.scene.add(group);
    this.beacon = { group, ring, step };
  }

  _clearBeacon() {
    if (!this.beacon) return;
    this.scene.remove(this.beacon.group);
    this.beacon = null;
  }

  // Where the beacon (and the HUD distance) points for this step.
  _stepTarget(step) {
    const rt = this.active ? this.active.runtime : null;
    if (step.type === 'stealCar' && rt?.targetCar) {
      const c = rt.targetCar;
      return { x: c.group.position.x, z: c.group.position.z };
    }
    if (step.type === 'drops') {
      const key = step.points[Math.min(rt?.subIndex ?? 0, step.points.length - 1)];
      const base = LAND(this.city, key);
      return { x: base.x, z: base.z };
    }
    if (step.type === 'enterCar' || step.type === 'fight') {
      if (step.type === 'fight') return this._pointOf(step);
      return null;
    }
    return this._pointOf(step);
  }

  _clearStep() {
    const a = this.active;
    if (!a) return;
    const rt = a.runtime;
    this._clearBeacon();
    if (rt.clientPed) {
      this.scene.remove(rt.clientPed.group);
      rt.clientPed = null;
    }
    if (rt.itemMesh) {
      this.scene.remove(rt.itemMesh);
      rt.itemMesh = null;
    }
    // A stolen target car stays in the world (it is a normal car now);
    // its mission flag is cleared so nothing else treats it specially.
    if (rt.targetCar) {
      rt.targetCar.isMissionTarget = false;
      rt.targetCar = null;
    }
    // Any fight enemies still standing are pulled out of the world when
    // the step ends (a failed job must not leave thugs hunting the player).
    for (const e of rt.fightEnemies) {
      if (!e.dead) this.combat.removeEnemy(e);
    }
    rt.fightEnemies = [];
    rt.fightRemaining = 0;
  }

  _advance() {
    const a = this.active;
    if (!a) return;
    this._clearStep();
    a.stepIndex += 1;
    a.runtime = this._newRuntime();
    if (a.stepIndex >= a.def.steps.length) {
      this._completeMission();
      return;
    }
    if (this.sfx) this.sfx.pickup();
    this._startStep();
  }

  _completeMission() {
    const a = this.active;
    const def = a.def;
    this.active = null;
    this.completed[this.index] = true;
    this.index += 1;
    if (this.index >= MISSION_DEFS.length) this.storyDone = true;
    if (this.game) {
      this.game.addMoney(def.reward);
      this.game.toast(`Job done — ${def.title} paid $${def.reward}`, 3600);
    }
    if (this.sfx) this.sfx.success();
    if (this.game) this.game.autosave();
  }

  _distTo(playerPos, pt) {
    return Math.hypot(pt.x - playerPos.x, pt.z - playerPos.z);
  }

  update(dt, ctx) {
    const a = this.active;
    if (!a) return;
    const step = a.def.steps[a.stepIndex];
    const rt = a.runtime;
    const pp = ctx.playerPos;

    // The beacon follows a moving target (the steal car).
    if (this.beacon && step.type === 'stealCar' && rt.targetCar) {
      this.beacon.group.position.set(rt.targetCar.group.position.x, 0, rt.targetCar.group.position.z);
    }
    if (this.beacon) {
      const pulse = 0.16 + Math.sin(ctx.time * 3.5) * 0.07;
      this.beacon.group.children[0].material.opacity = pulse;
    }

    switch (step.type) {
      case 'goto':
      case 'driveTo': {
        const pt = this._pointOf(step);
        const needCar = step.type === 'driveTo';
        if ((!needCar || ctx.inCar) && this._distTo(pp, pt) <= step.radius) {
          if (rt.clientPed) {
            this.scene.remove(rt.clientPed.group);
            rt.clientPed = null;
          }
          this._advance();
        }
        break;
      }
      case 'enterCar': {
        if (ctx.inCar) this._advance();
        break;
      }
      case 'stealCar': {
        if (ctx.inCar && ctx.car === rt.targetCar) {
          if (this.game) this.game.toast('Stolen. Get it to the docks.', 2600);
          this._advance();
        }
        break;
      }
      case 'fight': {
        // Completion is driven by onEnemyKilled; nothing to poll here.
        break;
      }
      case 'collect': {
        const pt = this._pointOf(step);
        if (this._distTo(pp, pt) <= step.radius) {
          if (rt.itemMesh) {
            this.scene.remove(rt.itemMesh);
            rt.itemMesh = null;
          }
          if (this.sfx) this.sfx.pickup();
          this._advance();
        }
        break;
      }
      case 'wait': {
        const pt = this._pointOf(step);
        if (this._distTo(pp, pt) <= step.radius) {
          rt.timer += dt;
          if (rt.timer >= step.seconds) this._advance();
        }
        break;
      }
      case 'drops': {
        const key = step.points[rt.subIndex];
        const base = LAND(this.city, key);
        if (this._distTo(pp, base) <= step.radius) {
          if (this.sfx) this.sfx.pickup();
          rt.subIndex += 1;
          this._makeBeacon(step);
          if (rt.subIndex >= step.points.length) this._advance();
        }
        break;
      }
      default:
        break;
    }
  }

  // HUD: title / objective / distance (metres) to the current target.
  getHUD(playerPos) {
    const a = this.active;
    if (!a) {
      if (this.index >= MISSION_DEFS.length) {
        return { title: 'STORY COMPLETE — SOLMAR', objective: 'You own this city, Daz.', distance: null };
      }
      return {
        title: 'FREE ROAM — SOLMAR',
        objective: 'Work waits at the safehouse — follow the yellow marker',
        distance: null,
      };
    }
    const step = a.def.steps[a.stepIndex];
    let objective = step.text;
    if (step.type === 'wait') {
      const left = Math.max(0, Math.ceil(step.seconds - a.runtime.timer));
      objective = `${step.text}… ${left}s`;
    }
    if (step.type === 'drops') {
      objective = `${step.text} (${a.runtime.subIndex}/${step.points.length})`;
    }
    if (step.type === 'fight' && a.runtime.fightRemaining > 0) {
      objective = `${step.text} (${a.runtime.fightRemaining} left)`;
    }
    const target = this._stepTarget(step);
    const distance = target && playerPos ? this._distTo(playerPos, target) : null;
    return {
      title: `${a.def.id.toUpperCase()} — ${a.def.title}`,
      objective,
      distance,
    };
  }

  // Where a new job starts: the safehouse beacon.
  get startPoint() {
    return LAND(this.city, 'safehouse');
  }

  // Current beacon target for the HUD minimap ({x, z} or null).
  getTarget() {
    const a = this.active;
    if (!a) return null;
    return this._stepTarget(a.def.steps[a.stepIndex]);
  }
}
