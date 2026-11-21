// Solmar's city: a procedural grid city built from three.js boxes and
// canvas textures — roads, sidewalks, downtown towers, a beach and marina,
// docks, a walled compound, parks and parking lots. buildCity fills the
// scene and returns the collision data and road list the rest of the game
// drives on. The layout is seeded, so every load builds the same Solmar.

import * as THREE from 'three';
import { CITY, PALETTE, PLACES } from './config.js';
import { makeRng, rand, randInt, pick, clamp } from './util.js';

const ROAD_LINES = [];
for (let i = 0; i < CITY.ROAD_COUNT; i++) {
  ROAD_LINES.push(-288 + i * CITY.ROAD_PITCH);
}
const BLOCK_CENTERS = [];
for (let i = 0; i < CITY.ROAD_COUNT - 1; i++) {
  BLOCK_CENTERS.push(-252 + i * CITY.ROAD_PITCH);
}

// Special blocks get hand-placed landmarks instead of random buildings.
const SPECIAL_BLOCKS = {
  '-36,180': 'garage',
  '108,-252': 'dealership',
  '-252,252': 'chopshop',
  '252,-252': 'compound',
  '36,-36': 'bank',
  '252,108': 'hospital',
  '0,0': 'plaza',
};

// ---- canvas textures ------------------------------------------------------

function makeGroundTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const toPx = (v) => ((v + CITY.GROUND_HALF) / (CITY.GROUND_HALF * 2)) * size;
  // Sidewalk base.
  g.fillStyle = '#9aa1a6';
  g.fillRect(0, 0, size, size);
  // Block interiors, slightly varied.
  const rng = makeRng(4242);
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      const shade = 150 + Math.floor(rng() * 18);
      g.fillStyle = `rgb(${shade},${shade + 4},${shade + 8})`;
      g.fillRect(toPx(bx - 28), toPx(bz - 28), toPx(56) - toPx(0), toPx(56) - toPx(0));
    }
  }
  // Plaza park.
  g.fillStyle = '#6fae62';
  g.fillRect(toPx(-28), toPx(-28), toPx(56) - toPx(0), toPx(56) - toPx(0));
  // Roads.
  g.fillStyle = '#2f3338';
  for (const v of ROAD_LINES) {
    g.fillRect(0, toPx(v - CITY.ROAD_HALF), size, toPx(CITY.ROAD_HALF * 2) - toPx(0));
    g.fillRect(toPx(v - CITY.ROAD_HALF), 0, toPx(CITY.ROAD_HALF * 2) - toPx(0), size);
  }
  // Centre dashes.
  g.fillStyle = '#d8b93a';
  for (const v of ROAD_LINES) {
    for (let d = -308; d < 308; d += 16) {
      g.fillRect(toPx(d), toPx(v - 0.4), toPx(8) - toPx(0), toPx(0.8) - toPx(0));
      g.fillRect(toPx(v - 0.4), toPx(d), toPx(0.8) - toPx(0), toPx(8) - toPx(0));
    }
  }
  // Crosswalks at every intersection.
  g.fillStyle = '#e8e8e8';
  for (const vx of ROAD_LINES) {
    for (const vz of ROAD_LINES) {
      for (let k = -6; k <= 6; k += 3) {
        g.fillRect(toPx(vx + k - 1), toPx(vz - CITY.ROAD_HALF), toPx(2) - toPx(0), toPx(3) - toPx(0));
        g.fillRect(toPx(vx + k - 1), toPx(vz + CITY.ROAD_HALF - 3), toPx(2) - toPx(0), toPx(3) - toPx(0));
        g.fillRect(toPx(vx - CITY.ROAD_HALF), toPx(vz + k - 1), toPx(3) - toPx(0), toPx(2) - toPx(0));
        g.fillRect(toPx(vx + CITY.ROAD_HALF - 3), toPx(vz + k - 1), toPx(3) - toPx(0), toPx(2) - toPx(0));
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A building facade: base colour with a grid of lit and dark windows.
function makeFacadeTexture(baseColor, floors, cols, seed) {
  const rng = makeRng(seed);
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = baseColor;
  g.fillRect(0, 0, w, h);
  const cellW = w / cols;
  const cellH = h / floors;
  for (let f = 0; f < floors; f++) {
    for (let col = 0; col < cols; col++) {
      const lit = rng() < 0.28;
      g.fillStyle = lit ? '#ffe9a8' : (rng() < 0.5 ? '#2c3540' : '#4a5a68');
      g.fillRect(col * cellW + 3, f * cellH + 5, cellW - 6, cellH - 10);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- collision ------------------------------------------------------------

// Push a circle (x, z, radius) out of every AABB it overlaps. Returns true
// when a push happened. Mutates pos in place.
export function resolveCircle(pos, radius, colliders) {
  let hit = false;
  for (const b of colliders) {
    const cx = clamp(pos.x, b.minX, b.maxX);
    const cz = clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // Centre inside the box: push out along the smallest penetration.
      const pl = pos.x - b.minX;
      const pr = b.maxX - pos.x;
      const pt = pos.z - b.minZ;
      const pb = b.maxZ - pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = b.minX - radius;
      else if (m === pr) pos.x = b.maxX + radius;
      else if (m === pt) pos.z = b.minZ - radius;
      else pos.z = b.maxZ + radius;
    }
  }
  return hit;
}

export function pointBlocked(x, z, colliders) {
  for (const b of colliders) {
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return true;
  }
  return false;
}

// ---- city build -----------------------------------------------------------

export function buildCity(scene) {
  const rng = makeRng(20261121);
  const world = {
    colliders: [],
    roads: [],
    parkingSpots: [],
    update: null,
    sun: null,
    hemi: null,
  };

  for (const v of ROAD_LINES) {
    world.roads.push({ axis: 'x', at: v });
    world.roads.push({ axis: 'z', at: v });
  }

  // Sky, fog and lights.
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 260, 720);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a5a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
  sun.position.set(140, 220, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 620;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  world.sun = sun;
  world.hemi = hemi;

  // Ground: one big textured plane for the whole city.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.GROUND_HALF * 2, CITY.GROUND_HALF * 2),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Beach sand and animated water to the east.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(32, CITY.GROUND_HALF * 2),
    new THREE.MeshLambertMaterial({ color: PALETTE.sand }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(CITY.BEACH_X + 16, 0.02, 0);
  sand.receiveShadow = true;
  scene.add(sand);
  const waterMat = new THREE.MeshLambertMaterial({ color: PALETTE.water });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(560, 900), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(CITY.WATER_X + 280, -0.4, 0);
  scene.add(water);
  const waterBaseY = water.position.y;
  world.update = (t) => {
    water.position.y = waterBaseY + Math.sin(t * 0.7) * 0.25;
  };

  // Facade materials (shared across buildings).
  const facadeMats = [];
  const facadeColors = ['#d8c9a3', '#c9a06a', '#9fb8c8', '#e8e0d0', '#b8a8c8', '#7fb0a0', '#e0b090', '#a8b8d0'];
  for (let i = 0; i < facadeColors.length; i++) {
    facadeMats.push(new THREE.MeshLambertMaterial({
      map: makeFacadeTexture(facadeColors[i], 8 + (i % 5), 5 + (i % 3), 100 + i * 17),
    }));
  }
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a5f66 });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x2a4a5a });
  const neonMats = [0xff5a8a, 0x19c2b8, 0xffb62e, 0x8a6cff].map(
    (c) => new THREE.MeshBasicMaterial({ color: c }),
  );

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  function addBox(x, y, z, w, h, d, mat, collide = true, shadow = true) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
    if (collide) {
      world.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    }
    return m;
  }

  // Palms and lamps are drawn as instanced meshes (one draw call each)
  // so hundreds of them cost almost nothing. Positions are collected
  // while the city is laid out and instanced at the end of buildCity.
  const palmPositions = [];
  const lampPositions = [];
  function addPalm(x, z) {
    palmPositions.push({ x, z });
    world.colliders.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5 });
  }
  function addLamp(x, z) {
    lampPositions.push({ x, z });
    world.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 });
  }

  // ---- regular blocks -----------------------------------------------------
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      const key = `${bx},${bz}`;
      const special = SPECIAL_BLOCKS[key];
      if (special === 'plaza') {
        // Central park: trees and a fountain ring.
        for (let i = 0; i < 7; i++) {
          addPalm(bx + rand(rng, -20, 20), bz + rand(rng, -20, 20));
        }
        addBox(bx, 0.6, bz, 10, 1.2, 10, new THREE.MeshLambertMaterial({ color: 0x7fb8d8 }), false);
        continue;
      }
      if (special) continue; // landmarks are placed below
      const roll = rng();
      if (roll < 0.1) {
        // Pocket park.
        for (let i = 0; i < 4; i++) addPalm(bx + rand(rng, -18, 18), bz + rand(rng, -18, 18));
        continue;
      }
      if (roll < 0.18) {
        // Parking lot: record spots, vehicles.js fills them.
        const spots = [];
        for (let i = 0; i < 5; i++) {
          spots.push({ x: bx - 16 + i * 8, z: bz - 10, heading: 0 });
        }
        world.parkingSpots.push(...spots);
        continue;
      }
      // Buildings: 1-3 per block, on a 2x2 cell grid so they never overlap.
      const downtown = 1 - Math.hypot(bx, bz) / 380;
      const cells = [0, 1, 2, 3].sort(() => rng() - 0.5);
      const count = rng() < 0.55 ? 1 : rng() < 0.8 ? 2 : 3;
      for (let i = 0; i < count; i++) {
        const cell = cells[i];
        const cx = bx + (cell % 2 === 0 ? -13 : 13);
        const cz = bz + (cell < 2 ? -13 : 13);
        const w = rand(rng, 16, 24);
        const d = rand(rng, 16, 24);
        const h = Math.max(7, rand(rng, 8, 15) + downtown * rand(rng, 6, 30));
        const mat = pick(rng, facadeMats);
        addBox(cx, h / 2, cz, w, h, d, mat);
        // Rooftop unit.
        if (rng() < 0.6) addBox(cx + rand(rng, -4, 4), h + 0.9, cz + rand(rng, -4, 4), 4, 1.8, 3, roofMat, false);
        // Neon sign on some downtown towers.
        if (downtown > 0.55 && rng() < 0.5) {
          const sign = new THREE.Mesh(boxGeo, pick(rng, neonMats));
          sign.position.set(cx, h * 0.82, cz + d / 2 + 0.15);
          sign.scale.set(Math.min(14, w * 0.6), 1.6, 0.3);
          scene.add(sign);
        }
      }
    }
  }

  // ---- landmarks ----------------------------------------------------------
  // Lena's garage: low workshop with a big door and a forecourt.
  addBox(-36, 4, 180, 34, 8, 20, new THREE.MeshLambertMaterial({ color: 0xb85a3a }));
  addBox(-36, 2.6, 169.4, 12, 5.2, 0.6, new THREE.MeshLambertMaterial({ color: 0x3a4048 }), false);
  world.parkingSpots.push({ x: -24, z: 156, heading: Math.PI / 2 });
  world.parkingSpots.push({ x: -48, z: 156, heading: Math.PI / 2 });

  // Dealership: glass showroom + lot.
  addBox(108, 5, -252, 30, 10, 18, glassMat);
  addBox(108, 10.6, -252, 30, 1.2, 18, roofMat, false);
  world.parkingSpots.push({ x: 112, z: -238, heading: 0 });
  world.parkingSpots.push({ x: 96, z: -238, heading: 0 });
  world.parkingSpots.push({ x: 128, z: -238, heading: 0 });

  // Chop shop: rust-red warehouse.
  addBox(-252, 5, 252, 32, 10, 22, new THREE.MeshLambertMaterial({ color: 0x8a4a3a }));

  // Hale's compound: walled mansion with a gate gap on the south side.
  addBox(252, 7, -252, 26, 14, 20, new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
  addBox(252, 14.8, -252, 26, 1.6, 20, roofMat, false);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x9a8a72 });
  addBox(252, 2, -276, 52, 4, 3, wallMat);
  addBox(226, 2, -252, 3, 4, 48, wallMat);
  addBox(278, 2, -252, 3, 4, 48, wallMat);
  addBox(240, 2, -228, 24, 4, 3, wallMat);
  addBox(268, 2, -228, 20, 4, 3, wallMat);

  // Bank: glass tower downtown.
  addBox(36, 16, -36, 26, 32, 26, glassMat);
  addBox(36, 32.8, -36, 26, 1.6, 26, roofMat, false);

  // Hospital: white block with a red cross slab.
  addBox(252, 9, 108, 28, 18, 22, new THREE.MeshLambertMaterial({ color: 0xf0f0ea }));
  addBox(252, 12, 96.4, 8, 8, 0.6, new THREE.MeshLambertMaterial({ color: 0xc23b2e }), false);

  // Docks: containers and a crane silhouette on the west edge.
  const containerColors = [0xc25a2e, 0x2e6fc2, 0x3aa655, 0x8a5fc2, 0xe8c832];
  for (let i = 0; i < 9; i++) {
    const cx = -312 + (i % 3) * 7;
    const cz = -58 + Math.floor(i / 3) * 9 + rand(rng, -2, 2);
    const stacked = rng() < 0.3;
    addBox(cx, 1.6, cz, 6, 3.2, 3, new THREE.MeshLambertMaterial({ color: pick(rng, containerColors) }));
    if (stacked) addBox(cx, 4.8, cz, 6, 3.2, 3, new THREE.MeshLambertMaterial({ color: pick(rng, containerColors) }));
  }
  addBox(-316, 9, -20, 2, 18, 2, new THREE.MeshLambertMaterial({ color: 0xd8b93a }));
  addBox(-316, 17.5, -32, 2, 2, 26, new THREE.MeshLambertMaterial({ color: 0xd8b93a }));

  // Marina: wooden dock planks and two boats on the sand.
  const dockMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
  addBox(330, 0.5, 44, 3, 1, 34, dockMat, false);
  addBox(330, 0.5, 76, 3, 1, 34, dockMat, false);
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
  addBox(346, 1.2, 40, 8, 2.4, 3.4, hullMat);
  addBox(346, 1.2, 84, 8, 2.4, 3.4, new THREE.MeshLambertMaterial({ color: 0x2e6fc2 }));

  // Safehouse: small house with a porch.
  addBox(180, 3.5, 252, 18, 7, 14, new THREE.MeshLambertMaterial({ color: 0x7fb0a0 }));

  // Palms along the beach road and the plaza; lamps along the roads.
  for (let z = -280; z <= 280; z += 36) {
    addPalm(308, z + rand(rng, -6, 6));
    if (rng() < 0.5) addPalm(-308, z + rand(rng, -6, 6));
  }
  for (const v of ROAD_LINES) {
    for (let d = -270; d <= 270; d += 108) {
      addLamp(v + 9.5, d);
      addLamp(d, v - 9.5);
    }
  }

  // Instance all palms and lamps: four draw calls for hundreds of props.
  const dummy = new THREE.Object3D();
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.34, 7, 6),
    new THREE.MeshLambertMaterial({ color: 0x7a5a34 }),
    Math.max(1, palmPositions.length),
  );
  const frondMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.9, 4.4, 4),
    new THREE.MeshLambertMaterial({ color: 0x3f8f4f }),
    Math.max(1, palmPositions.length * 6),
  );
  palmPositions.forEach((p, i) => {
    dummy.position.set(p.x, 3.5, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      dummy.position.set(p.x + Math.cos(a) * 1.4, 7.2, p.z + Math.sin(a) * 1.4);
      dummy.rotation.set(-Math.sin(a) * 1.15, 0, Math.cos(a) * 1.15);
      dummy.updateMatrix();
      frondMesh.setMatrixAt(i * 6 + k, dummy.matrix);
    }
  });
  trunkMesh.castShadow = true;
  frondMesh.castShadow = true;
  scene.add(trunkMesh);
  scene.add(frondMesh);
  const poleMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.12, 6.5, 6),
    new THREE.MeshLambertMaterial({ color: 0x2c3136 }),
    Math.max(1, lampPositions.length),
  );
  const headMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.32, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0 }),
    Math.max(1, lampPositions.length),
  );
  lampPositions.forEach((p, i) => {
    dummy.position.set(p.x, 3.25, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 6.6, p.z);
    dummy.updateMatrix();
    headMesh.setMatrixAt(i, dummy.matrix);
  });
  poleMesh.castShadow = true;
  scene.add(poleMesh);
  scene.add(headMesh);

  return world;
}
