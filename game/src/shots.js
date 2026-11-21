// Solmar — game/src/shots.js
// Screenshots: a helper that dumps the live canvas to a PNG (F9), and the
// staged setups behind the `?shot=` URL parameter, so the dossier shots
// are reproducible: `?shot=street`, `?shot=mission`, `?shot=drive` and
// `?shot=chase` each put the game in a fixed, seeded state before the
// picture is taken. `?shot=start` leaves the title screen up.
//
// The helper never touches the game files: it drives the same public
// hooks the game itself uses (start, teleport, enter a car, start a
// mission, set the wanted level).

import { nearestCar } from './vehicles.js';

export class ShotsHelper {
  constructor(ctx) {
    this.ctx = ctx;
  }

  // Save the current frame as a PNG download. Renders one fresh frame
  // first so toDataURL reads live pixels without preserveDrawingBuffer.
  capture(name) {
    const ctx = this.ctx;
    if (ctx.renderFrame) ctx.renderFrame();
    const canvas = ctx.renderer.domElement;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = (name || 'solmar-shot') + '.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return url;
  }

  // Put the game in a fixed scene for a screenshot. Called once after
  // boot when the page carries ?shot=<name>.
  stage(name) {
    const ctx = this.ctx;
    const game = ctx.game;
    if (!game) return false;
    if (name === 'start') return true; // title screen, nothing to stage
    if (game.phase === 'menu') game.start();

    const teleport = (x, z) => {
      ctx.player.pos.set(x, 0, z);
      ctx.player.group.position.copy(ctx.player.pos);
      ctx.player.heading = 0;
    };

    if (name === 'street') {
      // On foot on a busy road near the spawn, traffic rolling past.
      const spawn = ctx.city.landmarks.spawn;
      teleport(spawn.x, spawn.z + 30);
      return true;
    }
    if (name === 'mission') {
      // M1 in progress: Daz at the client meeting point.
      game.missions.startMission(0);
      const spawn = ctx.city.landmarks.spawn;
      teleport(spawn.x + 14, spawn.z - 8);
      return true;
    }
    if (name === 'drive' || name === 'chase') {
      // Behind the wheel on a road. The nearest car can be anywhere in
      // the city, so walk the player over to it first.
      const car = nearestCar(ctx.cars, ctx.player.pos.x, ctx.player.pos.z, 400);
      if (car) {
        teleport(car.group.position.x + 2, car.group.position.z);
        ctx.enterCar(car);
      }
      if (name === 'chase') {
        // A three-star getaway: driving, cruisers closing in.
        game.wanted.setStars(3);
      }
      return true;
    }
    return false;
  }
}
