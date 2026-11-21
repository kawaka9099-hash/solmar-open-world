// Solmar — game/src/shots.js
// Screenshot capture (F9) and the staged ?shot= setups the dossier shots
// use. A staging puts the game straight into a fixed, deterministic
// situation — same positions every run — so the screenshots are
// reproducible renders of the game's own code, never composites.

export function capture(renderer, name = 'shot') {
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.png`;
  a.click();
}

// api: { game, missions, wanted, player, THREE } — everything a staging
// needs, all of it already built by main.js.
export function applyShotStaging(name, api) {
  const { game, missions, wanted, player } = api;
  const city = game.city;
  const spawn = city.landmarks.spawn;
  const marina = city.landmarks.marina;

  const startPlaying = () => {
    if (game.phase === 'menu') game.start();
  };
  const putPlayerInCar = () => {
    // Prefer a car already travelling along Z (heading near 0 or PI), so
    // the staged drive runs down a road instead of into a building.
    let best = null;
    let bestScore = Infinity;
    for (const car of game.cars) {
      if (car.wrecked) continue;
      const d = Math.hypot(car.group.position.x - player.pos.x, car.group.position.z - player.pos.z);
      const alongZ = Math.abs(Math.sin(car.heading));
      const score = d + (alongZ < 0.3 ? 0 : 500);
      if (score < bestScore) { bestScore = score; best = car; }
    }
    if (!best) return null;
    player.pos.set(best.group.position.x + 2, 0, best.group.position.z);
    player.group.position.copy(player.pos);
    game.ctx.driving.car = best;
    best.driver = 'player';
    const ti = game.traffic.indexOf(best);
    if (ti >= 0) game.traffic.splice(ti, 1);
    player.group.visible = false;
    game.hud.setCrosshair(false);
    // Face down the road it sits on.
    best.heading = Math.abs(Math.sin(best.heading)) < 0.3
      ? (Math.cos(best.heading) >= 0 ? 0 : Math.PI)
      : best.heading;
    return best;
  };

  switch (name) {
    case 'street': {
      startPlaying();
      player.pos.set(spawn.x + 18, 0, spawn.z - 12);
      player.group.position.copy(player.pos);
      game.camYaw = Math.PI;
      break;
    }
    case 'mission': {
      startPlaying();
      missions.startMission(0);
      player.pos.set(spawn.x + 18, 0, spawn.z - 12);
      player.group.position.copy(player.pos);
      game.camYaw = Math.PI;
      break;
    }
    case 'drive': {
      startPlaying();
      const car = putPlayerInCar();
      if (car) {
        car.speed = 12;
        game.camYaw = car.heading;
      }
      break;
    }
    case 'chase': {
      startPlaying();
      const car = putPlayerInCar();
      if (car) {
        car.speed = 14;
        game.camYaw = car.heading;
      }
      wanted.setStars(3, game.time);
      break;
    }
    case 'start':
    default:
      // The start screen itself.
      break;
  }
}
