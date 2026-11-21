// Solmar — game/src/util.js
// Small shared helpers: clamping, interpolation, a seeded random stream
// and tiny 2D vector math. No dependencies.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function damp(current, target, rate, dt) {
  // Frame-rate independent exponential approach.
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Seeded pseudo-random generator (mulberry32). Same seed -> same stream,
// which is how the city stays identical between loads.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export function range(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function rangeInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// Minimal 2D vector helpers (x, z plane).
export const vec2 = {
  len(x, z) { return Math.hypot(x, z); },
  dist(ax, az, bx, bz) { return Math.hypot(bx - ax, bz - az); },
  norm(x, z) {
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  },
};

// Format helpers for the HUD.
export function formatMoney(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

export function formatSpeed(ms) {
  return Math.round(ms * 3.6);
}

export function formatDistance(m) {
  if (m < 1000) return Math.round(m) + 'm';
  return (m / 1000).toFixed(1) + 'km';
}
