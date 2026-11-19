// The screenshot scenes behind ?shot=cover|street|mission|chase. Each one sets up
// a real game state — a mission in progress, a wanted level, police on the tail —
// then plays it forward with a simple autopilot (drive the road grid toward the
// marker, walk to a point, shoot the nearest thug), so the frame is what a short
// stretch of real play looks like, and the same seed always gives the same frame.
import { STEP } from './config.js';
import { SCREEN_PLAY } from './render.js';

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Drive input steering the player's car toward the next waypoint. */
function driveInput(game, waypoints, wpIndex) {
  const state = game.state;
  const p = state.player;
  const wp = waypoints[Math.min(wpIndex, waypoints.length - 1)];
  const diff = angleDiff(p.angle, Math.atan2(wp.y - p.y, wp.x - p.x));
  return {
    up: true, down: false,
    left: diff < -0.08, right: diff > 0.08,
    handbrake: Math.abs(diff) > 1.1,
    run: false, interact: false, melee: false, shoot: false,
  };
}

/** Walk input toward a point. */
function walkInput(state, tx, ty) {
  const p = state.player;
  const dx = tx - p.x;
  const dy = ty - p.y;
  return {
    up: dy < -12, down: dy > 12, left: dx < -12, right: dx > 12,
    handbrake: false, run: false, interact: false, melee: false, shoot: false,
  };
}

function putPlayerInCar(game, x, y, angle, color) {
  const state = game.state;
  // Find a parked car, move it to the spot, and hand it to the player.
  const car = state.entities.cars.find((c) => c.kind === 'parked') || state.entities.cars[0];
  car.x = x;
  car.y = y;
  car.angle = angle;
  car.speed = 0;
  car.health = 100;
  car.kind = 'player';
  car.occupied = true;
  if (color) car.color = color;
  const p = state.player;
  p.car = car;
  p.x = x;
  p.y = y;
  p.angle = angle;
}

function putPlayerOnFoot(game, x, y, angle, pistol) {
  const state = game.state;
  const p = state.player;
  if (p.car) {
    p.car.kind = 'parked';
    p.car.occupied = false;
    p.car = null;
  }
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.health = 100;
  if (pistol) {
    p.hasPistol = true;
    p.ammo = 24;
  }
}

function stepFor(game, seconds, inputFn) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    game.update(inputFn(i), STEP);
  }
}

/**
 * Set `game` to the named scene and return the screen to draw over it.
 * Scenes: cover (timed delivery chase), street (on foot at the beach),
 * mission (dockside shootout), chase (wanted-4 golden-hour pursuit).
 */
export function stageShot(name, game) {
  const state = game.state;
  if (name === 'cover') {
    state.missions.restore({ index: 2, step: 2, done: false });
    state.missions.start(state);
    state.clockMinutes = 11 * 60 + 20;
    state.cash = 1840;
    putPlayerInCar(game, 1040, 1440, 0, '#d64541');
    state.wanted = 3;
    const waypoints = state.city.routeWaypoints(1040, 1440, 3160, 640);
    let wp = 1;
    stepFor(game, 6, () => {
      const target = waypoints[Math.min(wp, waypoints.length - 1)];
      if (Math.hypot(target.x - state.player.x, target.y - state.player.y) < 80 && wp < waypoints.length - 1) wp += 1;
      return driveInput(game, waypoints, wp);
    });
    // A clean frame: no transient banner (a sideswipe message from the drive).
    state.message = '';
    state.messageTimer = 0;
    return { screen: SCREEN_PLAY };
  }
  if (name === 'street') {
    state.missions.restore({ index: 0, step: 0, done: false });
    state.missions.start(state);
    state.clockMinutes = 10 * 60 + 30;
    state.cash = 250;
    putPlayerOnFoot(game, 3340, 900, Math.PI / 2, false);
    // A lively beachfront: extra strollers and cars cruising the coast road.
    for (let i = 0; i < 8; i += 1) {
      state.entities.spawnPed(3300 + (i % 3) * 40, 1000 + i * 90);
    }
    for (let i = 0; i < 3; i += 1) {
      const car = state.entities.spawnTrafficCar();
      car.x = 3040;
      car.y = 900 + i * 320;
      car.road = { vertical: true, line: 3040, dir: 1 };
      car.angle = Math.PI / 2;
    }
    stepFor(game, 7, () => walkInput(state, 3340, 1500));
    return { screen: SCREEN_PLAY };
  }
  if (name === 'mission') {
    state.missions.restore({ index: 4, step: 1, done: false });
    state.missions.start(state);
    state.clockMinutes = 13 * 60 + 40;
    state.cash = 3120;
    putPlayerOnFoot(game, 420, 2350, -Math.PI / 2, true);
    // start() fields the Rivas crew for the shootout step.
    stepFor(game, 1.8, () => {
      const enemies = state.combat.enemies;
      let aim = null;
      let best = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.x - state.player.x, e.y - state.player.y);
        if (d < best) { best = d; aim = e; }
      }
      const input = walkInput(state, 420, 2420);
      if (aim) {
        input.shoot = true;
        // The autopilot is a hurried shooter, not a sniper: some shots miss,
        // so the frame still shows thugs standing.
        input.shootX = aim.x + 34;
        input.shootY = aim.y - 20;
      }
      return input;
    });
    return { screen: SCREEN_PLAY };
  }
  if (name === 'chase') {
    state.missions.restore({ index: 5, step: 2, done: false });
    state.missions.start(state);
    state.clockMinutes = 17 * 60 + 45;
    state.cash = 5230;
    putPlayerInCar(game, 2240, 2050, -Math.PI / 2, '#d64541');
    state.wanted = 4;
    const waypoints = state.city.routeWaypoints(2240, 2050, 3420, 1440);
    let wp = 1;
    stepFor(game, 5.5, () => {
      const target = waypoints[Math.min(wp, waypoints.length - 1)];
      if (Math.hypot(target.x - state.player.x, target.y - state.player.y) < 80 && wp < waypoints.length - 1) wp += 1;
      return driveInput(game, waypoints, wp);
    });
    // A clean frame: no transient banner (a sideswipe message from the drive).
    state.message = '';
    state.messageTimer = 0;
    return { screen: SCREEN_PLAY };
  }
  // Any other name is the title screen's backdrop.
  return { screen: SCREEN_PLAY };
}
