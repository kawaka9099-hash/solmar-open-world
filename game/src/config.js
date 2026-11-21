// Solmar configuration: tuning numbers, the city layout, named places and
// the six story missions. Pure data — no logic lives here, so the rest of
// the game can read it without importing each other.

export const CITY = {
  // Road centre lines run every ROAD_PITCH units, ROAD_HALF each side.
  ROAD_PITCH: 72,
  ROAD_HALF: 8,
  ROAD_COUNT: 9, // roads at -288 .. 288
  GROUND_HALF: 320, // ground plane reaches +-320
  BLOCK: 56, // block interior between roads
  // East edge: beach sand, then water.
  BEACH_X: 320,
  WATER_X: 352,
  WORLD_EDGE: 340,
};

// Named places, in world coordinates (x east, z south).
export const PLACES = {
  garage: { x: -36, z: 180, name: "Lena's Garage" },
  marina: { x: 330, z: 60, name: 'Solmar Marina' },
  dealership: { x: 108, z: -252, name: 'Sunset Motors' },
  chopShop: { x: -252, z: 252, name: 'Chop Shop' },
  docks: { x: -308, z: -36, name: 'Port Solmar Docks' },
  bank: { x: 36, z: -36, name: 'Solmar National Bank' },
  safehouse: { x: 180, z: 252, name: 'Safehouse' },
  compound: { x: 252, z: -252, name: "Hale's Compound" },
  hospital: { x: 252, z: 108, name: 'Solmar General' },
  plaza: { x: 0, z: 0, name: 'Plaza del Sol' },
  spawn: { x: -30, z: 148, name: 'Spawn' },
};

// Player / driving tuning.
export const PLAYER = {
  WALK_SPEED: 7,
  SPRINT_SPEED: 11,
  JUMP_SPEED: 8.5,
  HEALTH: 100,
  RADIUS: 0.7,
  PISTOL_DAMAGE: 34,
  PISTOL_RANGE: 70,
  PISTOL_RATE: 0.16, // seconds between shots
  PUNCH_DAMAGE: 25,
  PUNCH_RANGE: 2.4,
  START_AMMO: 60,
  START_MONEY: 50,
  CAMERA_DIST_FOOT: 8.5,
  CAMERA_DIST_CAR: 12.5,
};

export const CAR = {
  MAX_SPEED: 36,
  SPORT_MAX_SPEED: 47,
  ACCEL: 16,
  BRAKE: 30,
  REVERSE_MAX: 12,
  STEER: 1.9, // radians per second at full lock, scaled by speed
  DRAG: 0.55,
  RADIUS: 2.1,
  HEALTH: 100,
};

// Wanted / police tuning.
export const WANTED = {
  MAX_STARS: 5,
  DECAY_IDLE_SECONDS: 15, // quiet time before stars start falling
  DECAY_PER_STAR_SECONDS: 9, // seconds per star once decaying
  COP_CAR_SPEED: 30,
  COP_RUN_SPEED: 7.6,
  COP_ARREST_RANGE: 1.7,
  COP_ARREST_SECONDS: 1.1,
  COP_SPAWN_INTERVAL: 6, // seconds between police spawns while wanted
  MAX_COP_CARS: [0, 1, 2, 3, 4, 4],
  MAX_COP_FOOT: [0, 0, 1, 2, 3, 4],
};

// Traffic and pedestrians.
export const CROWD = {
  TRAFFIC_CARS: 14,
  PEDESTRIANS: 26,
  TRAFFIC_SPEED: 12,
  PED_SPEED: 1.6,
};

// Pickups scattered around the city.
export const PICKUPS = {
  HEALTH_COUNT: 10,
  AMMO_COUNT: 10,
  HEALTH_VALUE: 40,
  AMMO_VALUE: 30,
  RESPAWN_SECONDS: 45,
};

// Enemy tuning for missions.
export const ENEMY = {
  HEALTH: 100,
  HALE_HEALTH: 320,
  SHOOT_RANGE: 34,
  SHOOT_INTERVAL: 1.7,
  HIT_CHANCE: 0.34,
  DAMAGE: 11,
  MOVE_SPEED: 4.2,
};

// Story: six missions. Each step is one objective; the mission runner
// reads these and drives the beacons, the HUD and the rewards.
export const MISSIONS = [
  {
    id: 1,
    title: 'First Fare',
    sub: 'Lena needs a driver',
    briefing:
      "Lena's client is waiting at the marina and her driver bailed. Take her sedan — it's parked outside the garage — and get the client to the marina in one piece. Easy money. Don't scratch the paint.",
    reward: 250,
    steps: [
      { type: 'enterCar', x: -24, z: 156, radius: 6, text: "Get in Lena's sedan" },
      { type: 'driveTo', x: 330, z: 60, radius: 11, text: 'Drive the client to the marina' },
    ],
  },
  {
    id: 2,
    title: 'Hot Wheels',
    sub: 'A red sports car, no questions',
    briefing:
      "A buyer in the south wants the red sportscar off Sunset Motors' lot, tonight. Take it — the lot is unguarded, but the city will notice — and deliver it to the chop shop. Lose the heat on the way.",
    reward: 600,
    steps: [
      { type: 'goto', x: 108, z: -252, radius: 13, text: 'Go to Sunset Motors' },
      { type: 'enterCar', x: 112, z: -238, radius: 6, text: 'Steal the red sports car', wanted: 2 },
      { type: 'deliverCar', x: -252, z: 216, radius: 12, text: 'Deliver the car to the chop shop' },
    ],
  },
  {
    id: 3,
    title: 'Dockside Debt',
    sub: "Hale's boys took Lena's package",
    briefing:
      "Hale's crew grabbed a package of Lena's at the docks and they are not giving it back nicely. Clear them out, take the package, and bring it home to the garage. Watch your back — they shoot first.",
    reward: 800,
    steps: [
      { type: 'goto', x: -308, z: -36, radius: 15, text: 'Go to the Port Solmar docks' },
      { type: 'kill', x: -308, z: -36, radius: 20, count: 4, text: 'Clear out Hale\'s thugs (0/4)' },
      { type: 'collect', x: -302, z: -28, radius: 4, text: "Grab Lena's package" },
      { type: 'goto', x: -36, z: 180, radius: 12, text: 'Bring the package to the garage' },
    ],
  },
  {
    id: 4,
    title: 'The Getaway',
    sub: 'In and out before the sirens',
    briefing:
      'Lena has a crew hitting the Solmar National Bank and you are the wheel. Get to the bank, then get the crew to the safehouse — the whole city will be looking for you. Drive like your life depends on it.',
    reward: 1200,
    steps: [
      { type: 'driveTo', x: 36, z: -36, radius: 18, time: 110, text: 'Reach the bank before the crew moves' },
      { type: 'escape', x: 180, z: 252, radius: 14, time: 150, wanted: 3, text: 'Escape to the safehouse' },
    ],
  },
  {
    id: 5,
    title: 'Three Drops',
    sub: 'Packages all over Solmar',
    briefing:
      'Three packages, three corners of the city, one clock. Pick them all up before time runs out. The first grab will put the cops on you — keep moving and do not stop for anyone.',
    reward: 1500,
    steps: [
      { type: 'collect', x: 216, z: 72, radius: 4, time: 240, text: 'Pick up package 1 of 3 (east side)' },
      { type: 'collect', x: -144, z: -144, radius: 4, text: 'Pick up package 2 of 3 (old town)' },
      { type: 'collect', x: 144, z: 216, radius: 4, wanted: 2, text: 'Pick up package 3 of 3 (south side)' },
    ],
  },
  {
    id: 6,
    title: "Hale's Fall",
    sub: 'End the syndicate',
    briefing:
      "This is it. Hale's compound, north-east Solmar — guards, walls and Hale himself. Take the ledger that proves what he has been doing to this city, then get out and bring it to the marina. Solmar is watching, Daz.",
    reward: 3000,
    steps: [
      { type: 'goto', x: 252, z: -252, radius: 17, text: "Reach Hale's compound" },
      { type: 'kill', x: 252, z: -252, radius: 24, count: 7, text: "Take down Hale's guards (0/7)" },
      { type: 'collect', x: 250, z: -236, radius: 4, text: 'Take the ledger' },
      { type: 'escape', x: 330, z: 60, radius: 12, wanted: 5, text: 'Escape to the marina with the ledger' },
    ],
  },
];

// Colours used across the game (buildings, cars, clothes, UI).
export const PALETTE = {
  sky: 0x8ec9e8,
  fog: 0xa8d4e6,
  sun: 0xfff2d0,
  ground: 0x8f979e,
  road: 0x2f3338,
  sidewalk: 0x9aa1a6,
  sand: 0xe6d3a3,
  water: 0x2a7fa8,
  building: [0xd8c9a3, 0xc9a06a, 0x9fb8c8, 0xe8e0d0, 0xb8a8c8, 0x7fb0a0, 0xe0b090, 0xa8b8d0],
  car: [0xc23b2e, 0x2e6fc2, 0xe8c832, 0x3aa655, 0xe8e8e8, 0x22262c, 0x8a5fc2, 0xe07a28, 0x18a0a8, 0xb03060],
  shirt: [0xd84a4a, 0x4a90d8, 0x7ac74f, 0xe8c832, 0x9a6ad8, 0xe07840, 0x40c8b8, 0xd8d8d8, 0x5a5a6a, 0xc25a8a],
  thug: 0x3a3f4a,
  cop: 0x1e3a5f,
  beacon: 0xffb62e,
};
