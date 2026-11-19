// The city of Solmar, generated once from a seed: a grid of avenues and streets,
// blocks of sun-bleached buildings, two parks, a plaza, a beach and sea to the east,
// docklands to the south. Pure data — no drawing, no browser — plus the queries the
// simulation needs: what is road, what blocks movement, where the nearest road is,
// and a waypoint route along the grid for the driving autopilot.
import {
  AVENUES, BEACH_X, BUILDING_COLORS, DOCKS_Y, ROAD_W, SIDEWALK, STREETS,
  WATER_X, WORLD,
} from './config.js';
import { pick, range, rangeInt } from './random.js';

const BLOCK_MARGIN = SIDEWALK + 14;

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function createCity(random) {
  const buildings = [];
  const palms = [];
  const parks = [];
  const roadSet = { avenues: AVENUES, streets: STREETS };

  // Blocks are the cells between neighbouring roads. Two are parks, one a plaza;
  // the rest hold one to three buildings each.
  const parkCells = new Set(['2,1', '5,3']);
  const plazaCell = '4,2';
  for (let i = 0; i < AVENUES.length - 1; i += 1) {
    for (let j = 0; j < STREETS.length - 1; j += 1) {
      const x0 = AVENUES[i] + ROAD_W / 2 + BLOCK_MARGIN;
      const y0 = STREETS[j] + ROAD_W / 2 + BLOCK_MARGIN;
      const x1 = AVENUES[i + 1] - ROAD_W / 2 - BLOCK_MARGIN;
      const y1 = STREETS[j + 1] - ROAD_W / 2 - BLOCK_MARGIN;
      const key = `${i},${j}`;
      if (parkCells.has(key)) {
        parks.push({ x: x0 - 10, y: y0 - 10, w: x1 - x0 + 20, h: y1 - y0 + 20 });
        continue;
      }
      if (key === plazaCell) continue; // Plaza del Sol: open paving, fountain, palms.
      const count = rangeInt(random, 1, 3);
      for (let k = 0; k < count; k += 1) {
        const w = range(random, 90, 180);
        const h = range(random, 80, 160);
        const x = range(random, x0, Math.max(x0 + 1, x1 - w));
        const y = range(random, y0, Math.max(y0 + 1, y1 - h));
        const b = {
          x, y, w, h,
          color: pick(random, BUILDING_COLORS),
          height: rangeInt(random, 1, 3),
          roof: random() < 0.35,
        };
        if (buildings.some((o) => rectsOverlap({ x: x - 12, y: y - 12, w: w + 24, h: h + 24 }, o))) continue;
        buildings.push(b);
      }
    }
  }

  // Beachfront hotels: a row of taller pastel blocks between the last avenue and the sand.
  for (let j = 0; j < STREETS.length - 1; j += 1) {
    const y0 = STREETS[j] + ROAD_W / 2 + BLOCK_MARGIN;
    const y1 = STREETS[j + 1] - ROAD_W / 2 - BLOCK_MARGIN;
    buildings.push({
      x: 3120, y: y0 + 10, w: 150, h: Math.min(200, y1 - y0 - 20),
      color: pick(random, BUILDING_COLORS), height: 3, roof: true, hotel: true,
    });
  }

  // Palms line the sidewalks and the beach.
  for (const x of AVENUES) {
    for (let y = 120; y < WORLD.height - 120; y += range(random, 150, 260)) {
      palms.push({ x: x + ROAD_W / 2 + 14, y, lean: range(random, -0.3, 0.3), s: range(random, 0.85, 1.25) });
      palms.push({ x: x - ROAD_W / 2 - 14, y: y + 90, lean: range(random, -0.3, 0.3), s: range(random, 0.85, 1.25) });
    }
  }
  for (let y = 160; y < WORLD.height - 100; y += range(random, 90, 170)) {
    palms.push({ x: BEACH_X + 34 + range(random, -8, 8), y, lean: range(random, -0.4, 0.4), s: range(random, 1, 1.4) });
  }
  // Plaza palms.
  for (let i = 0; i < 6; i += 1) {
    palms.push({ x: 1680 + (i % 3) * 160, y: 1320 + Math.floor(i / 3) * 180, lean: 0, s: 1.2 });
  }

  function onRoad(x, y) {
    if (x < 0 || y < 0 || x > WORLD.width || y > WORLD.height) return false;
    for (const ax of AVENUES) if (Math.abs(x - ax) < ROAD_W / 2) return true;
    for (const sy of STREETS) if (Math.abs(y - sy) < ROAD_W / 2) return true;
    return false;
  }

  function onSidewalk(x, y) {
    if (x < 0 || y < 0 || x > WORLD.width || y > WORLD.height) return false;
    for (const ax of AVENUES) {
      const d = Math.abs(x - ax);
      if (d >= ROAD_W / 2 && d < ROAD_W / 2 + SIDEWALK) return true;
    }
    for (const sy of STREETS) {
      const d = Math.abs(y - sy);
      if (d >= ROAD_W / 2 && d < ROAD_W / 2 + SIDEWALK) return true;
    }
    return false;
  }

  function inWater(x, y) {
    return x > WATER_X;
  }

  function onSand(x, y) {
    return x > BEACH_X && x <= WATER_X;
  }

  function buildingAt(x, y, pad) {
    for (const b of buildings) {
      if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return b;
    }
    return null;
  }

  /** Push a circle out of buildings and the sea; returns the push vector, or null. */
  function resolveCircle(pos, radius) {
    let px = 0;
    let py = 0;
    const b = buildingAt(pos.x, pos.y, radius);
    if (b) {
      const cx = Math.max(b.x, Math.min(pos.x, b.x + b.w));
      const cy = Math.max(b.y, Math.min(pos.y, b.y + b.h));
      let dx = pos.x - cx;
      let dy = pos.y - cy;
      let d = Math.hypot(dx, dy);
      if (d < 1) {
        // Centre inside the building: push out through the nearest edge.
        const left = pos.x - b.x;
        const right = b.x + b.w - pos.x;
        const top = pos.y - b.y;
        const bottom = b.y + b.h - pos.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) { dx = -1; dy = 0; d = 1; }
        else if (m === right) { dx = 1; dy = 0; d = 1; }
        else if (m === top) { dx = 0; dy = -1; d = 1; }
        else { dx = 0; dy = 1; d = 1; }
        const push = radius + m + 1;
        px += dx * push;
        py += dy * push;
      } else {
        const push = radius - d + 1;
        if (push > 0) {
          px += (dx / d) * push;
          py += (dy / d) * push;
        }
      }
    }
    if (pos.x > WATER_X - radius) px -= (pos.x - (WATER_X - radius));
    if (pos.x < radius) px += radius - pos.x;
    if (pos.y < radius) py += radius - pos.y;
    if (pos.y > WORLD.height - radius) py -= (pos.y - (WORLD.height - radius));
    if (px === 0 && py === 0) return null;
    pos.x += px;
    pos.y += py;
    return { x: px, y: py };
  }

  function nearestRoadPoint(x, y) {
    let bestX = AVENUES[0];
    let bestD = Infinity;
    for (const ax of AVENUES) {
      const d = Math.abs(x - ax);
      if (d < bestD) { bestD = d; bestX = ax; }
    }
    let bestY = STREETS[0];
    bestD = Infinity;
    for (const sy of STREETS) {
      const d = Math.abs(y - sy);
      if (d < bestD) { bestD = d; bestY = sy; }
    }
    return Math.abs(x - bestX) < Math.abs(y - bestY) ? { x: bestX, y } : { x, y: bestY };
  }

  /** Waypoints along the road grid from (x, y) to (tx, ty): along the current road
   * to the avenue nearest the target, up that avenue to the street nearest the
   * target, then a short hop to the target itself. */
  function routeWaypoints(x, y, tx, ty) {
    const start = nearestRoadPoint(x, y);
    let tAx = AVENUES[0];
    let d = Infinity;
    for (const ax of AVENUES) {
      const dd = Math.abs(tx - ax);
      if (dd < d) { d = dd; tAx = ax; }
    }
    let tSy = STREETS[0];
    d = Infinity;
    for (const sy of STREETS) {
      const dd = Math.abs(ty - sy);
      if (dd < d) { d = dd; tSy = sy; }
    }
    const points = [{ x: start.x, y: start.y }];
    if (Math.abs(start.x - tAx) > 4) points.push({ x: tAx, y: start.y });
    if (Math.abs(start.y - tSy) > 4) points.push({ x: tAx, y: tSy });
    points.push({ x: tx, y: ty });
    return points;
  }

  /** A random point on a road, at least `minDist` from (x, y). */
  function randomRoadPoint(randomFn, x, y, minDist) {
    for (let tries = 0; tries < 40; tries += 1) {
      const vertical = randomFn() < 0.5;
      const px = vertical ? pick(randomFn, AVENUES) : range(randomFn, 120, WORLD.width - 420);
      const py = vertical ? range(randomFn, 120, WORLD.height - 120) : pick(randomFn, STREETS);
      if (Math.hypot(px - x, py - y) >= minDist) return { x: px, y: py };
    }
    return { x: AVENUES[0], y: STREETS[0] };
  }

  /** A random sidewalk point for a pedestrian to stroll on. */
  function randomSidewalkPoint(randomFn) {
    const vertical = randomFn() < 0.5;
    if (vertical) {
      const ax = pick(randomFn, AVENUES);
      return { x: ax + (randomFn() < 0.5 ? 1 : -1) * (ROAD_W / 2 + SIDEWALK / 2), y: range(randomFn, 120, WORLD.height - 120) };
    }
    const sy = pick(randomFn, STREETS);
    return { x: range(randomFn, 120, BEACH_X - 60), y: sy + (randomFn() < 0.5 ? 1 : -1) * (ROAD_W / 2 + SIDEWALK / 2) };
  }

  return {
    buildings, palms, parks, roadSet,
    onRoad, onSidewalk, inWater, onSand, buildingAt, resolveCircle,
    nearestRoadPoint, routeWaypoints, randomRoadPoint, randomSidewalkPoint,
  };
}

export { DOCKS_Y };
