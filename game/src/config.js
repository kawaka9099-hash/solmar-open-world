// Solmar — game/src/config.js
// Every tuning constant for the city, vehicles, people and HUD lives here
// so the gameplay session can balance the game by editing one file.

export const CONFIG = {
  // ---- City layout (all lengths in metres, city centred on 0,0) ----
  city: {
    blocksPerSide: 5,      // blocks along each axis
    blockSize: 56,         // side of one city block
    roadWidth: 14,         // width of a road between blocks
    sidewalkWidth: 3,      // pavement strip beside each road
    seed: 20261121,        // world-generation seed (same seed, same city)
  },

  // ---- Sky, light and fog ----
  sky: {
    background: 0x8ec9e8,  // pale noon blue
    fog: 0x9fd0e8,
    fogNear: 220,
    fogFar: 620,
    sunColor: 0xfff2d0,
    sunIntensity: 2.4,
    sunPosition: [120, 180, 60],
    ambientColor: 0xbfd9ff,
    ambientIntensity: 0.75,
    hemiSky: 0xbfe3ff,
    hemiGround: 0x8a7a5a,
    hemiIntensity: 0.55,
  },

  // ---- Palette ----
  colors: {
    asphalt: 0x2e2f33,
    asphaltEdge: 0x3a3b40,
    sidewalk: 0x9a9a92,
    curb: 0x6f6f68,
    grass: 0x7fae62,
    sand: 0xd8c49a,
    water: 0x2f7fb8,
    waterDeep: 0x1f5f92,
    dockWood: 0x8a6a45,
    laneYellow: 0xf2c230,
    laneWhite: 0xe8e8e0,
    buildingRoof: 0x4a4a48,
  },

  // ---- Player on foot ----
  player: {
    walkSpeed: 4.2,
    runSpeed: 8.5,
    jumpSpeed: 7.5,
    gravity: 22,
    radius: 0.55,
    height: 1.8,
    health: 100,
  },

  // ---- Cars ----
  cars: {
    accel: 16,            // m/s^2 at full throttle
    brake: 30,            // m/s^2 braking
    reverseAccel: 9,
    maxReverse: 9,
    drag: 0.55,           // 1/s speed loss
    rollDrag: 1.2,
    steerMax: 0.55,       // radians at standstill
    steerSpeed: 2.6,      // how fast steering responds
    grip: 6.5,            // lateral velocity damping
    handbrakeGrip: 1.2,
    damagePerHit: 12,
    wreckAt: 100,         // damage points before the car is wrecked
    enterRadius: 3.2,
  },

  // ---- Pedestrians ----
  peds: {
    count: 26,
    walkSpeedMin: 1.0,
    walkSpeedMax: 1.9,
    fleeSpeed: 3.6,
    fleeRadius: 9,        // run away when a threat is closer than this
    panicRadius: 5,
  },

  // ---- Traffic ----
  traffic: {
    count: 10,
    cruiseSpeedMin: 7,
    cruiseSpeedMax: 11,
  },

  // ---- Wanted / police ----
  wanted: {
    maxStars: 5,
    decayPerSecond: 0.05, // stars fade when the player is hidden and calm
    crimePoints: {
      stealCar: 1,
      assaultPed: 1,
      killPed: 2,
      shootGun: 1,
      hitPolice: 2,
      speedingNearPolice: 0.25,
    },
    policeResponse: [0, 1, 2, 3, 5, 7], // patrol cars per star level
    bustRadius: 2.2,
    bustTime: 2.5,        // seconds an officer must stand next to you
  },

  // ---- Money ----
  money: {
    startCash: 50,
    taxiFare: 120,
    pickupCashMin: 20,
    pickupCashMax: 80,
    missionRewardMin: 300,
    missionRewardMax: 900,
  },

  // ---- Combat ----
  combat: {
    pistolMag: 12,
    pistolReserve: 48,
    pistolDamage: 34,
    pistolRange: 60,
    pistolFireInterval: 0.22,
    punchDamage: 12,
    punchRange: 2.2,
  },

  // ---- HUD / minimap ----
  hud: {
    minimapSize: 190,     // pixels on screen
    minimapRange: 260,    // metres shown across the minimap
    speedUnit: 'km/h',
  },

  // ---- Audio ----
  audio: {
    masterVolume: 0.5,
    musicVolume: 0.16,
    engineVolume: 0.12,
    sirenVolume: 0.10,
  },
};

export default CONFIG;
