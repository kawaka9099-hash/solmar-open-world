// Solmar — game/src/shots.js
// Screenshot helper for Solmar. F9 captures the canvas to a PNG download.
// The ?shot= URL parameter stages a deterministic scene for the dossier
// screenshots: street (on foot), mission (M1 in progress), drive (behind
// the wheel), chase (a three-star pursuit) or start (the title screen).
//
// The game facade handed in: { THREE, scene, camera, renderer, hud,
//   missions, wanted, teleport(x, z), enterNearestCar(), addWantedPoints(n),
//   beginPlaying(), showStart(), playerPos() }

export const SHOT_SETUPS = ['start', 'street', 'mission', 'drive', 'chase'];

export class Shots {
  constructor(game) {
    this.game = game;
    this.pending = false;
    this.counter = 0;
  }

  // Queue a capture for right after the next rendered frame, when the
  // canvas holds a fresh image.
  takeShot() {
    this.pending = true;
  }

  // Called by the main loop after renderer.render().
  afterRender() {
    if (!this.pending) return;
    this.pending = false;
    const canvas = this.game.renderer.domElement;
    this.counter++;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `solmar-shot-${this.counter}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  applySetup(name) {
    const g = this.game;
    const lm = g.landmarks;
    if (name === 'start') {
      g.showStart();
      return;
    }
    g.beginPlaying();
    if (name === 'street') {
      g.teleport(lm.spawn.x + 4, lm.spawn.z + 4);
    } else if (name === 'mission') {
      g.teleport(lm.safehouse.x + 6, lm.safehouse.z + 6);
      g.missions.start(0);
    } else if (name === 'drive') {
      g.teleport(lm.spawn.x, lm.spawn.z);
      g.ensureCarNearPlayer();
      g.enterNearestCar();
    } else if (name === 'chase') {
      g.teleport(lm.spawn.x, lm.spawn.z);
      g.ensureCarNearPlayer();
      g.enterNearestCar();
      g.addWantedPoints(95);
      g.hud.toast('Three stars — lose them!', 3000);
    }
  }
}
