// Staging helpers for screenshots and headless playtests. These are only
// a test harness: they drive the same public game methods a player uses
// (start, teleport, enter a car, auto-drive, set the wanted level) and read
// the same state the HUD shows. Nothing here changes the game's rules.

export function installShotHelpers(game) {
  const api = {
    version: 'solmar-2.0',
    game,

    get mode() { return game.mode; },
    get ready() { return game.firstFrameDone; },

    // A snapshot of the state a test or a screenshot cares about.
    state() {
      return {
        mode: game.mode,
        money: game.money,
        health: Math.ceil(game.player.health),
        ammo: game.ammoReserve,
        mag: game.mag,
        wanted: game.wanted.stars,
        mission: game.missions.active ? game.missions.active.def.id : null,
        missionStep: game.missions.active ? game.missions.active.stepIndex : null,
        missionText: game.missions.objectiveText(),
        // The player's position is the car's while driving.
        player: game.playerCar
          ? { x: +game.playerCar.pos.x.toFixed(1), z: +game.playerCar.pos.z.toFixed(1) }
          : { x: +game.player.pos.x.toFixed(1), z: +game.player.pos.z.toFixed(1) },
        inCar: !!game.playerCar,
        carSpeed: game.playerCar ? +game.playerCar.speed.toFixed(1) : 0,
        traffic: game.traffic.length,
        peds: game.peds.length,
        enemies: game.enemies.filter((e) => !e.dead).length,
        cops: game.wanted.cops.length,
        copCars: game.wanted.copCars.length,
        completed: [...game.missions.completed].sort(),
      };
    },

    startNewGame() { game.startNewGame(); },
    continueGame() { game.continueGame(); },
    startMission(n) { game.startMission(n); },
    teleport(x, z) {
      game.exitCar(true);
      game.player.place(x, z, game.player.heading);
      game.player.pos.y = 0;
      game.player.vy = 0;
    },
    setCamera(yaw, pitch, dist) {
      if (yaw !== undefined) game.camYaw = yaw;
      if (pitch !== undefined) game.camPitch = pitch;
      if (dist !== undefined) game.camDist = dist;
    },
    setWanted(n) { game.wanted.setStars(n); },
    setHealth(n) {
      game.player.health = n;
      if (n <= 0) game.wasted();
    },
    setMoney(n) { game.money = n; },
    giveAmmo(n) { game.ammoReserve += n; },
    enterNearestCar() { game.tryEnterCar(); },
    exitCar() { game.exitCar(); },
    // Drive the player's car toward a point, like a test driver.
    autoDriveTo(x, z) { game.setAutoDrive(x, z); },
    // Walk the player toward a point on foot.
    autoWalkTo(x, z) { game.setAutoWalk(x, z); },
    autoStop() { game.autoTarget = null; },
    // Put the heat on: wanted 3 with police cars already close by.
    spawnChase() {
      game.wanted.setStars(3);
      game.wanted.spawnCopCar(game.player.pos);
      game.wanted.spawnCopCar(game.player.pos);
    },
    // Damage every live enemy (test helper to verify mission flow).
    debugKillEnemies() {
      for (const e of game.enemies) {
        if (!e.dead) game.killEnemy(e);
      }
    },
  };
  window.__solmar = api;
  return api;
}
