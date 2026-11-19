// Solmar — every tuning number, colour and mission definition in one place.
// The world is a fixed 3600x2700 pixel coastal city; the renderer shows a 1280x720
// window of it through a camera that follows the player.
export const STEP = 1 / 60;
export const VIEW = { width: 1280, height: 720 };

export const WORLD = { width: 3600, height: 2700 };
export const ROAD_W = 72;
export const SIDEWALK = 26;

// Avenues (vertical roads) and streets (horizontal roads), centre lines.
export const AVENUES = [240, 640, 1040, 1440, 1840, 2240, 2640, 3040];
export const STREETS = [240, 640, 1040, 1440, 1840, 2240];
// East of this x the city gives way to sand, then the sea.
export const BEACH_X = 3300;
export const WATER_X = 3480;
// South strip (below the last street) is the docklands.
export const DOCKS_Y = 2560;

export const PLAYER = {
  radius: 11,
  walkSpeed: 175,
  runSpeed: 265,
  health: 100,
  regenDelay: 8,
  regenRate: 3,
};

export const CAR = {
  accel: 300,
  reverseAccel: 200,
  maxSpeed: 560,
  maxReverse: 180,
  steer: 2.6,
  grip: 6.5,
  driftGrip: 2.2,
  brake: 480,
  radius: 15,
  length: 46,
  width: 22,
  health: 100,
};

export const TRAFFIC = { count: 22, speed: 150, speedJitter: 45, followGap: 58 };
export const PEDS = { count: 56, speed: 52 };

export const WANTED = {
  decayQuietSeconds: 25,
  decayStepSeconds: 12,
  maxStars: 5,
  // How many police cars are out at each wanted level.
  policePerStar: [0, 1, 2, 3, 4, 5],
  bustSeconds: 3,
};

export const COMBAT = {
  pistolDamage: 34,
  pistolRange: 420,
  pistolAmmo: 12,
  meleeDamage: 45,
  meleeRange: 44,
  meleeArc: 1.5,
  thugHealth: 60,
  thugDamage: 9,
  thugRange: 300,
};

export const PICKUPS = {
  healthAmount: 40,
  ammoAmount: 12,
  respawnSeconds: 45,
};

export const CLOCK = {
  startMinutes: 10 * 60 + 12, // 10:12 in the morning, golden sun.
  minutesPerSecond: 0.35, // a full day takes about 68 real minutes.
};

export const SAVE_KEY = 'solmar.save.v1';

export const PALETTE = {
  asphalt: '#3d3a38',
  asphaltDark: '#353231',
  roadLine: '#e8d98a',
  sidewalk: '#b8a88f',
  grass: '#7fae5a',
  parkGreen: '#6da34e',
  sand: '#e9d29a',
  water: '#2e7fa8',
  waterDeep: '#256b90',
  buildingRoof: '#c9b8a3',
  text: '#f5efe4',
  muted: '#c9bfae',
  hudPanel: 'rgba(16, 14, 12, 0.62)',
  hudAccent: '#ffb347',
  star: '#ffd23e',
  marker: '#ffd23e',
  police: '#2f6df6',
  policeLight: '#ff3b30',
  blood: '#a83232',
};

// Warm stucco building colours — pastel, sun-bleached, never grey.
export const BUILDING_COLORS = [
  '#f2d8a7', '#e8b48c', '#f0c6c6', '#a8d0c6', '#f6e7c1',
  '#d9a05b', '#e9c46a', '#f4a261', '#cdb4db', '#b7d3a8',
  '#e76f51', '#f2e6c9', '#a3c4bc', '#e5989b', '#ffd6a5',
];

export const CAR_COLORS = [
  '#d64541', '#2f6df6', '#f2c94c', '#e8e8e8', '#22262b',
  '#7fb069', '#e07a5f', '#81b29a', '#f4a261', '#9b5de5',
];

// Named places. Everything the missions and the HUD point at lives here.
export const PLACES = {
  garage: { x: 560, y: 560, label: "Marisol's Garage" },
  bank: { x: 1760, y: 960, label: 'Solmar National Bank' },
  hotel: { x: 3160, y: 640, label: 'Hotel Miramar' },
  pier: { x: 640, y: 2640, label: 'Old Pier' },
  docks: { x: 420, y: 2500, label: 'Docklands' },
  safehouse: { x: 300, y: 2160, label: 'Safehouse' },
  boat: { x: 3420, y: 1440, label: 'Getaway Boat' },
  hospital: { x: 1120, y: 1760, label: 'Solmar General' },
  plaza: { x: 1840, y: 1440, label: 'Plaza del Sol' },
};

// The story: six jobs for fixer Marisol Vega. Each mission is a list of steps; a step
// is { kind, x, y, label, seconds? } — drive-to, pickup, drop, survive, shootout, grab.
export const MISSIONS = [
  {
    id: 1, title: 'First Wheels', reward: 400,
    brief: 'Marisol needs a driver. Steal a car — any car — and bring it to her garage.',
    steps: [
      { kind: 'steal', label: 'Steal a car (walk up to one and press E)' },
      { kind: 'goto', x: 560, y: 560, label: "Drive to Marisol's Garage" },
    ],
  },
  {
    id: 2, title: 'The Pickup', reward: 700,
    brief: 'A package is waiting at the Old Pier. Collect it and bring it back to the garage.',
    steps: [
      { kind: 'goto', x: 640, y: 2640, label: 'Drive to the Old Pier' },
      { kind: 'pickup', x: 640, y: 2640, label: 'Pick up the package (press E)' },
      { kind: 'goto', x: 560, y: 560, label: "Deliver it to Marisol's Garage" },
    ],
  },
  {
    id: 3, title: 'Hot Delivery', reward: 1200,
    brief: 'A client at Hotel Miramar is paying triple for speed. 90 seconds, no excuses.',
    steps: [
      { kind: 'goto', x: 420, y: 2500, label: 'Collect the case at the Docklands', seconds: 90 },
      { kind: 'pickup', x: 420, y: 2500, label: 'Grab the case (press E)', seconds: 90 },
      { kind: 'goto', x: 3160, y: 640, label: 'Deliver to Hotel Miramar — fast!', seconds: 90 },
    ],
  },
  {
    id: 4, title: 'Lose the Heat', reward: 900,
    brief: 'Marisol wants to know you can vanish. Jack a car in front of the law, then lose them and reach the safehouse.',
    steps: [
      { kind: 'steal', label: 'Steal a car and get the cops on you' },
      { kind: 'lose', label: 'Lose the cops — stay out of sight until the heat dies' },
      { kind: 'goto', x: 300, y: 2160, label: 'Reach the Safehouse' },
    ],
  },
  {
    id: 5, title: 'Dockside Shootout', reward: 2000,
    brief: 'The Rivas crew took Marisol’s money. Take it back. They will shoot first.',
    steps: [
      { kind: 'goto', x: 420, y: 2500, label: 'Go to the Docklands' },
      { kind: 'shootout', x: 420, y: 2500, label: 'Take out the Rivas crew (5 left)' },
      { kind: 'pickup', x: 420, y: 2500, label: 'Collect the cash (press E)' },
    ],
  },
  {
    id: 6, title: 'The Solmar Heist', reward: 5000,
    brief: 'The big one. Hit Solmar National Bank, grab the vault cash, and run for the boat.',
    steps: [
      { kind: 'goto', x: 1760, y: 960, label: 'Get to Solmar National Bank' },
      { kind: 'grab', x: 1760, y: 960, label: 'Hold still inside the bank to crack the vault' },
      { kind: 'escape', x: 3420, y: 1440, label: 'Escape to the getaway boat on the beach!' },
    ],
  },
];

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
