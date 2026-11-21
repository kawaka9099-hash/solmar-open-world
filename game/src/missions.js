// Solmar — game/src/missions.js
// Story missions for Solmar. Dario "Daz" Ferran runs jobs for the fixer
// Lena against Viktor Hale. Missions unlock one after another from the
// safehouse beacon: walk to the yellow marker with no mission active and
// the next job starts. A bust or a trip to the hospital fails the current
// job back to the safehouse — the job itself is not lost.
//
// Steps are data: reach a place, get in a car, deliver by car, defeat a
// group of enemies, or wait in a zone. The class owns the beacon marker
// and the small job props (client, package, ledger) it spawns.

function personMesh(THREE, shirt) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.34), mat(shirt));
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), mat(0xe8b88a));
  head.position.y = 1.6;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.24), mat(0x2a344a));
  legL.position.set(-0.15, 0.34, 0);
  const legR = legL.clone();
  legR.position.x = 0.15;
  g.add(torso, head, legL, legR);
  return g;
}

function propMesh(THREE, color) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.4, 0.4),
    new THREE.MeshLambertMaterial({ color }),
  );
  box.position.y = 0.35;
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.57, 0.08, 0.42),
    new THREE.MeshLambertMaterial({ color: 0xe8b820 }),
  );
  lid.position.y = 0.58;
  g.add(box, lid);
  return g;
}

export const MISSION_DEFS = [
  {
    id: 0, title: 'M1 — The Pickup', payout: 250,
    briefing: 'Lena has a client who needs a quiet ride to the marina.',
    steps: [
      { kind: 'enterCar', text: 'Get in a car — the client rides with you' },
      { kind: 'deliver', target: 'marina', radius: 14, text: 'Drive the client to the marina' },
    ],
  },
  {
    id: 1, title: 'M2 — The Lift', payout: 600,
    briefing: 'Lena needs a clean car. Take one and bring it to the docks.',
    steps: [
      { kind: 'enterCar', text: 'Steal a car — any car will do' },
      { kind: 'deliver', target: 'docks', radius: 14, text: 'Deliver the car to the docks' },
    ],
  },
  {
    id: 2, title: 'M3 — Dockside', payout: 800,
    briefing: 'Hale’s crew is holding a package at the docks. Take it back.',
    steps: [
      { kind: 'reach', target: 'docks', radius: 16, text: 'Head to the docks' },
      { kind: 'defeat', kinds: ['thug', 'thug', 'thug'], text: 'Deal with the thugs' },
      { kind: 'reach', target: 'package', radius: 4, text: 'Grab the package' },
    ],
  },
  {
    id: 3, title: 'M4 — The Vault', payout: 900,
    briefing: 'The bank vault is soft. Crack it — and be ready to run.',
    steps: [
      { kind: 'reach', target: 'bank', radius: 16, text: 'Get to the bank' },
      { kind: 'wait', target: 'bank', radius: 12, seconds: 5, text: 'Crack the safe — stay close' },
      { kind: 'deliver', target: 'safehouse', radius: 14, text: 'Lose the cops — get to the safehouse' },
    ],
  },
  {
    id: 4, title: 'M5 — Dead Drops', payout: 700,
    briefing: 'Three drops, three corners of the city. No noise, no witnesses.',
    steps: [
      { kind: 'reach', target: 'marina', radius: 12, text: 'Drop one: the marina' },
      { kind: 'reach', target: 'bank', radius: 12, text: 'Drop two: the bank' },
      { kind: 'reach', target: 'hospital', radius: 12, text: 'Drop three: the hospital' },
    ],
  },
  {
    id: 5, title: 'M6 — The Ledger', payout: 900,
    briefing: 'Hale keeps his ledger at the docks. End it there.',
    steps: [
      { kind: 'reach', target: 'docks', radius: 16, text: 'Meet Hale at the docks' },
      { kind: 'defeat', kinds: ['hale', 'guard', 'guard', 'guard'], text: 'Take down Hale and his guards' },
      { kind: 'reach', target: 'ledger', radius: 4, text: 'Recover the ledger' },
    ],
  },
];

export class Missions {
  // game facade: { THREE, scene, landmarks, combat, wanted, hud,
  //   playerPos(), currentCar(), addMoney(n), onMissionDone(def),
  //   saveProgress(), playSuccess() }
  constructor(game) {
    this.game = game;
    this.THREE = game.THREE;
    this.index = game.startMissionIndex || 0;
    this.active = false;
    this.step = 0;
    this.waitLeft = 0;
    this.spawned = []; // enemy kinds alive for the current defeat step
    this.props = []; // { group, kind: 'client'|'package'|'ledger' }
    this.clientAboard = false;
    this.beacon = this._makeBeacon();
    game.scene.add(this.beacon);
    this._refreshBeacon();
  }

  _makeBeacon() {
    const g = new this.THREE.Group();
    const ring = new this.THREE.Mesh(
      new this.THREE.RingGeometry(2.2, 3, 32),
      new this.THREE.MeshBasicMaterial({ color: 0xe8b820, side: this.THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    const beam = new this.THREE.Mesh(
      new this.THREE.CylinderGeometry(0.7, 0.7, 26, 12, 1, true),
      new this.THREE.MeshBasicMaterial({ color: 0xe8b820, transparent: true, opacity: 0.16, side: this.THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 13;
    g.add(ring, beam);
    return g;
  }

  _landmark(name) {
    if (name === 'package' || name === 'ledger') {
      const prop = this.props.find((p) => p.kind === name);
      return prop ? { x: prop.group.position.x, z: prop.group.position.z } : this.game.landmarks.docks;
    }
    return this.game.landmarks[name] || { x: 0, z: 0 };
  }

  _clearProps() {
    for (const p of this.props) this.game.scene.remove(p.group);
    this.props = [];
    this.clientAboard = false;
  }

  _spawnProp(kind, where) {
    const lm = this.game.landmarks[where] || { x: 0, z: 0 };
    const mesh = kind === 'client'
      ? personMesh(this.THREE, 0xe8e8e8)
      : propMesh(this.THREE, kind === 'ledger' ? 0x8a2a20 : 0x3a6a8a);
    mesh.position.set(lm.x + 3, 0, lm.z + 3);
    this.game.scene.add(mesh);
    this.props.push({ group: mesh, kind });
    return mesh;
  }

  get def() {
    return MISSION_DEFS[this.index] || null;
  }

  get done() {
    return this.index >= MISSION_DEFS.length;
  }

  currentStep() {
    if (!this.active || !this.def) return null;
    return this.def.steps[this.step] || null;
  }

  targetPos() {
    if (!this.active) return this.game.landmarks.safehouse;
    const step = this.currentStep();
    if (!step) return this.game.landmarks.safehouse;
    if (step.kind === 'enterCar' || step.kind === 'defeat') {
      // No fixed target: point at the job site (docks for fights, self for cars).
      if (step.kind === 'defeat') return this.game.landmarks.docks;
      return null;
    }
    return this._landmark(step.target);
  }

  objectiveText() {
    if (this.done) return 'All jobs done — Solmar is yours, Daz.';
    if (!this.active) return 'Work waits at the safehouse — follow the yellow marker';
    const step = this.currentStep();
    return step ? step.text : '';
  }

  titleText() {
    if (this.done) return 'FREE ROAM — SOLMAR';
    if (!this.active) return 'FREE ROAM — SOLMAR';
    return this.def.title;
  }

  start(index) {
    if (this.done) return;
    this.index = index;
    this.active = true;
    this.step = 0;
    this.waitLeft = 0;
    this._clearProps();
    const def = this.def;
    if (def.id === 0) this._spawnProp('client', 'safehouse');
    this.game.hud.toast(`${def.title} — ${def.briefing}`, 5000);
    if (this.game.sfx) this.game.sfx.success();
    this._beginStep();
    this._refreshBeacon();
  }

  _beginStep() {
    const step = this.currentStep();
    if (!step) return;
    this.waitLeft = step.seconds || 0;
    if (step.kind === 'defeat') {
      const at = this.game.landmarks.docks;
      this.spawned = step.kinds.map((kind, i) => {
        const angle = (i / step.kinds.length) * Math.PI * 2;
        return this.game.combat.spawnEnemy(kind, at.x + Math.cos(angle) * 8, at.z + Math.sin(angle) * 8);
      });
    }
    if (step.kind === 'reach' && step.target === 'package') {
      this._spawnProp('package', 'docks');
    }
    if (step.kind === 'reach' && step.target === 'ledger') {
      this._spawnProp('ledger', 'docks');
    }
    if (step.kind === 'wait') {
      // Tripping the safe trips the alarm: three stars of heat.
      this.game.wanted.addPoints(95);
      this.game.hud.toast('The alarm is tripped — the cops are coming!', 4000);
    }
  }

  _advance() {
    this.step++;
    if (this.step >= this.def.steps.length) {
      this._complete();
      return;
    }
    this._beginStep();
    this._refreshBeacon();
  }

  _complete() {
    const def = this.def;
    this.game.addMoney(def.payout);
    this.game.hud.toast(`${def.title} done — +$${def.payout}`, 4500);
    if (this.game.sfx) this.game.sfx.success();
    this.active = false;
    this.step = 0;
    this._clearProps();
    this.index++;
    const storyDone = this.index >= MISSION_DEFS.length;
    if (this.game.onMissionDone) this.game.onMissionDone(def, storyDone);
    if (this.game.saveProgress) this.game.saveProgress();
    this._refreshBeacon();
  }

  // Called when the player is busted or wasted: the job fails back to the
  // safehouse, the job itself stays open for another try.
  failCurrent() {
    if (!this.active) return;
    this.active = false;
    this.step = 0;
    this.spawned = [];
    this._clearProps();
    if (this.game.combat) this.game.combat.clear();
    this._refreshBeacon();
  }

  // Called when the player gets into a car (for enterCar steps and to hide
  // the M1 client once they are aboard).
  onEnterCar() {
    if (this.active) {
      const step = this.currentStep();
      if (step && step.kind === 'enterCar') {
        const client = this.props.find((p) => p.kind === 'client');
        if (client) {
          client.group.visible = false;
          this.clientAboard = true;
        }
        this._advance();
        return;
      }
    }
  }

  update(dt) {
    // Beacon idle spin.
    this.beacon.rotation.y += dt * 0.4;
    const p = this.game.playerPos();
    if (!p) return;

    if (!this.active) {
      // Free roam: reaching the safehouse starts the next job.
      if (!this.done) {
        const sh = this.game.landmarks.safehouse;
        if (Math.hypot(p.x - sh.x, p.z - sh.z) < 10) this.start(this.index);
      }
      return;
    }

    const step = this.currentStep();
    if (!step) return;
    const car = this.game.currentCar();

    if (step.kind === 'reach') {
      const t = this._landmark(step.target);
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (d < (step.radius || 12)) this._advance();
    } else if (step.kind === 'deliver') {
      if (car) {
        const t = this._landmark(step.target);
        const cp = { x: car.group.position.x, z: car.group.position.z };
        if (Math.hypot(cp.x - t.x, cp.z - t.z) < (step.radius || 14)) {
          if (this.clientAboard) {
            // The client gets out at the marina.
            const client = this.props.find((pr) => pr.kind === 'client');
            if (client) {
              client.group.visible = true;
              client.group.position.set(t.x + 2, 0, t.z + 2);
            }
            this.clientAboard = false;
          }
          this._advance();
        }
      }
    } else if (step.kind === 'defeat') {
      this.spawned = this.spawned.filter((e) => this.game.combat.enemies.includes(e));
      if (this.spawned.length === 0) this._advance();
    } else if (step.kind === 'wait') {
      const t = this._landmark(step.target);
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (d < (step.radius || 12)) {
        this.waitLeft -= dt;
        if (this.waitLeft <= 0) this._advance();
      }
    }
  }

  _refreshBeacon() {
    const t = this.targetPos();
    if (t) {
      this.beacon.position.set(t.x, 0, t.z);
      this.beacon.visible = true;
    } else {
      this.beacon.visible = false;
    }
  }

  // Distance from the player to the current objective, for the HUD.
  distanceToTarget() {
    const t = this.targetPos();
    if (!t) return null;
    const p = this.game.playerPos();
    if (!p) return null;
    return Math.hypot(p.x - t.x, p.z - t.z);
  }
}
