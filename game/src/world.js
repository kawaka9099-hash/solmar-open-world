// Solmar — game/src/world.js
// The city of Solmar: a procedural sun-soaked grid city with a marina,
// a bank, a safehouse garage and a hospital, built from three.js meshes
// and canvas-generated facade textures. No external assets.
//
// API:
//   const city = buildCity(scene, THREE);
//   city.group        — the THREE.Group holding the whole city
//   city.colliders     — [{ minX, maxX, minZ, maxZ }] solid AABBs (buildings,
//                        walls, docks) for cars, peds and the player
//   city.roads         — [{ x, z, axis: 'x'|'z', length }] road strips
//   city.sidewalks     — [{ x, z, w, d }] pavement rectangles to walk on
//   city.landmarks     — { spawn, marina, docks, bank, safehouse, hospital },
//                        each { x, z } in world metres
//   city.bounds        — { minX, maxX, minZ, maxZ } drivable city extent
//   city.roadLines     — x/z coordinates of every road centre line
//   city.isBlocked(x, z, r) — true when a circle of radius r hits a collider
//   city.resolveCircle(p, r) — pushes {x, z} out of colliders in place
//
// Layout: a grid of blocks separated by roads. Road centre lines sit at
// roadLines; blocks sit between them. The marina and its docks lie along
// the south edge (positive z), past the last road.

import { CONFIG } from './config.js';
import { makeRng, pick, range, rangeInt, clamp } from './util.js';

const C = CONFIG.city;
const PITCH = C.blockSize + C.roadWidth;                 // 70 m block to block
const HALF = (C.blocksPerSide * PITCH + C.roadWidth) / 2; // 182 m city half-size

export function roadLines() {
  const lines = [];
  for (let i = 0; i <= C.blocksPerSide; i++) lines.push(-HALF + i * PITCH);
  return lines;
}

export function blockCenters() {
  const centers = [];
  for (let i = 0; i < C.blocksPerSide; i++) centers.push(-HALF + C.roadWidth + C.blockSize / 2 + i * PITCH);
  return centers;
}

// ---- Canvas textures -----------------------------------------------------

function facadeTexture(rng, base, lit) {
  const w = 128;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // Slight vertical shading so the face reads in the sun.
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const cols = 5;
  const rows = 10;
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isLit = rng() < 0.22;
      g.fillStyle = isLit ? lit : (rng() < 0.5 ? '#20242e' : '#2c3340');
      g.fillRect(c * cw + 3, r * ch + 4, cw - 6, ch - 8);
      if (isLit) {
        g.fillStyle = 'rgba(255,220,120,0.35)';
        g.fillRect(c * cw + 3, r * ch + 4, cw - 6, 3);
      }
    }
  }
  // Ground-floor shopfront strip.
  g.fillStyle = '#1c1e24';
  g.fillRect(0, h - 18, w, 18);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(6, h - 15, w - 12, 2);
  const tex = new (window.__THREE_CanvasTexture || Object)(cv);
  return tex;
}

function roadTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#2e2f33';
  g.fillRect(0, 0, 128, 128);
  // Speckle so the asphalt is not flat.
  for (let i = 0; i < 260; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  // Edge lines.
  g.fillStyle = '#e8e8e0';
  g.fillRect(4, 0, 3, 128);
  g.fillRect(121, 0, 3, 128);
  // Centre dashes (yellow) — the texture repeats along the road.
  g.fillStyle = '#f2c230';
  g.fillRect(61, 8, 6, 52);
  return cv;
}

function signTexture(text, bg, fg) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg;
  g.font = 'bold 52px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  return cv;
}

// ---- City builder ---------------------------------------------------------

export function buildCity(scene, THREE) {
  // CanvasTexture lives on THREE; the facade helper above needs it.
  window.__THREE_CanvasTexture = THREE.CanvasTexture;

  const rng = makeRng(CONFIG.city.seed);
  const group = new THREE.Group();
  group.name = 'solmar-city';
  const colliders = [];
  const roads = [];
  const sidewalks = [];
  const lines = roadLines();
  const centers = blockCenters();

  const addCollider = (x, z, hx, hz) => {
    colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
  };

  // Ground: grass far out, sand near the marina.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 4, HALF * 4),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.grass, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, HALF * 0.6);
  ground.receiveShadow = true;
  group.add(ground);

  // City base slab (pavement-coloured) under the whole grid.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(HALF * 2 + 8, 0.2, HALF * 2 + 8),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.sidewalk, roughness: 1 }),
  );
  slab.position.set(0, 0.0, 0);
  slab.receiveShadow = true;
  group.add(slab);

  // Roads: long strips with a repeating dashed-centre texture.
  const roadCanvas = roadTexture();
  const roadTex = new THREE.CanvasTexture(roadCanvas);
  roadTex.wrapS = THREE.RepeatWrapping;
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.anisotropy = 4;
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 });
  const roadLen = HALF * 2;
  for (const line of lines) {
    for (const axis of ['x', 'z']) {
      const tex = roadTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(roadLen / C.roadWidth, 1);
      const mat = roadMat.clone();
      mat.map = tex;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(roadLen, C.roadWidth), mat);
      strip.rotation.x = -Math.PI / 2;
      // A road along X sits at constant z with no extra rotation; a road
      // along Z needs the extra quarter-turn so its length runs along Z.
      if (axis === 'z') strip.rotation.z = Math.PI / 2;
      strip.position.set(axis === 'x' ? 0 : line, 0.12, axis === 'x' ? line : 0);
      strip.receiveShadow = true;
      group.add(strip);
      roads.push({ x: strip.position.x, z: strip.position.z, axis, length: roadLen });
    }
  }

  // Crosswalks: white stripes at every intersection.
  const crossMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.laneWhite, roughness: 0.9 });
  for (const lx of lines) {
    for (const lz of lines) {
      for (let s = -1; s <= 1; s++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, C.roadWidth - 2), crossMat);
        stripe.position.set(lx + s * 2.4, 0.16, lz);
        group.add(stripe);
      }
    }
  }

  // Facade materials: three height classes, four palettes.
  const palettes = [
    { base: '#b08a5e', lit: '#ffd98a' },
    { base: '#8a94a6', lit: '#ffe9a8' },
    { base: '#a67c7c', lit: '#ffd98a' },
    { base: '#7d8a6e', lit: '#fff0b0' },
  ];
  const facadeMats = palettes.map((p) => {
    const tex = facadeTexture(rng, p.base, p.lit);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.buildingRoof, roughness: 1 });

  // Landmark blocks (by grid column, row): bank (3,1), safehouse (1,3),
  // hospital (4,4). The park block is (0,4).
  const landmarkBlock = (bx, bz) => `${bx},${bz}`;
  const special = new Map([
    [landmarkBlock(3, 1), 'bank'],
    [landmarkBlock(1, 3), 'safehouse'],
    [landmarkBlock(4, 4), 'hospital'],
    [landmarkBlock(0, 4), 'park'],
  ]);

  function addBuilding(cx, cz, w, d, h, matIdx) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, facadeMats[matIdx % facadeMats.length]);
    mesh.position.set(cx, h / 2 + 0.1, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), roofMat);
    roof.position.set(cx, h + 0.35, cz);
    roof.castShadow = true;
    group.add(roof);
    addCollider(cx, cz, w / 2, d / 2);
  }

  function addTree(x, z, scale = 1) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22 * scale, 0.3 * scale, 2.2 * scale, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 }),
    );
    trunk.position.set(x, 1.1 * scale, z);
    trunk.castShadow = true;
    group.add(trunk);
    const top = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.7 * scale, 0),
      new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 1, flatShading: true }),
    );
    top.position.set(x, 3.1 * scale, z);
    top.castShadow = true;
    group.add(top);
  }

  function addStreetlight(x, z) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.4 }),
    );
    pole.position.set(x, 3, z);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe9a0, emissiveIntensity: 0.9 }),
    );
    lamp.position.set(x, 6.1, z);
    group.add(lamp);
  }

  // Blocks: buildings, a park, or the landmark structures.
  for (let bx = 0; bx < C.blocksPerSide; bx++) {
    for (let bz = 0; bz < C.blocksPerSide; bz++) {
      const cx = centers[bx];
      const cz = centers[bz];
      const kind = special.get(landmarkBlock(bx, bz));
      // Sidewalk ring for this block.
      sidewalks.push({ x: cx, z: cz, w: C.blockSize, d: C.blockSize });

      if (kind === 'park') {
        // Green square with paths and trees.
        const lawn = new THREE.Mesh(
          new THREE.BoxGeometry(C.blockSize - 6, 0.3, C.blockSize - 6),
          new THREE.MeshStandardMaterial({ color: CONFIG.colors.grass, roughness: 1 }),
        );
        lawn.position.set(cx, 0.25, cz);
        lawn.receiveShadow = true;
        group.add(lawn);
        for (let i = 0; i < 7; i++) {
          addTree(cx + range(rng, -20, 20), cz + range(rng, -20, 20), range(rng, 0.9, 1.4));
        }
        continue;
      }
      if (kind === 'bank') {
        buildBank(cx, cz);
        continue;
      }
      if (kind === 'safehouse') {
        buildSafehouse(cx, cz);
        continue;
      }
      if (kind === 'hospital') {
        buildHospital(cx, cz);
        continue;
      }
      // Ordinary block: one tall tower, or two mid-rise slabs, or four shops.
      const style = rng();
      if (style < 0.35) {
        addBuilding(cx, cz, range(rng, 26, 34), range(rng, 26, 34), range(rng, 26, 48), rangeInt(rng, 0, 3));
      } else if (style < 0.75) {
        addBuilding(cx - 12, cz, 20, 30, range(rng, 12, 20), rangeInt(rng, 0, 3));
        addBuilding(cx + 13, cz, 18, 26, range(rng, 10, 18), rangeInt(rng, 0, 3));
      } else {
        const offs = [[-13, -13], [13, -13], [-13, 13], [13, 13]];
        for (const [ox, oz] of offs) {
          addBuilding(cx + ox, cz + oz, 18, 18, range(rng, 7, 13), rangeInt(rng, 0, 3));
        }
      }
      // A tree or two on the block corners.
      if (rng() < 0.6) addTree(cx + range(rng, -24, 24), cz + range(rng, -24, 24), range(rng, 0.8, 1.2));
    }
  }

  // Streetlights at intersections (every other one, to save draw calls).
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      if ((i + j) % 2 === 0) addStreetlight(lines[i] + C.roadWidth / 2 + 0.8, lines[j] - C.roadWidth / 2 - 0.8);
    }
  }

  // ---- Landmarks ----------------------------------------------------------

  function buildBank(cx, cz) {
    // Wide marble building with columns, steps and a sign.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(40, 14, 26),
      new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.85 }),
    );
    body.position.set(cx, 7.1, cz);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(42, 1, 28),
      new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.9 }),
    );
    roof.position.set(cx, 14.5, cz);
    group.add(roof);
    for (let i = -2; i <= 2; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.0, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.8 }),
      );
      col.position.set(cx + i * 7, 6.1, cz + 14.5);
      col.castShadow = true;
      group.add(col);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 5.6),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(signTexture('SOLMAR BANK', '#20344a', '#ffd98a')) }),
    );
    sign.position.set(cx, 11.5, cz + 13.2);
    group.add(sign);
    addCollider(cx, cz, 21, 14);
  }

  function buildSafehouse(cx, cz) {
    // Low house with a garage the player calls home.
    const house = new THREE.Mesh(
      new THREE.BoxGeometry(16, 7, 12),
      new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.9 }),
    );
    house.position.set(cx - 6, 3.6, cz - 4);
    house.castShadow = true;
    group.add(house);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(11, 4, 4),
      new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: 1, flatShading: true }),
    );
    roof.position.set(cx - 6, 9, cz - 4);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
    const garage = new THREE.Mesh(
      new THREE.BoxGeometry(12, 5, 10),
      new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.9 }),
    );
    garage.position.set(cx + 10, 2.6, cz + 8);
    garage.castShadow = true;
    group.add(garage);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(8, 3.6, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.7, metalness: 0.3 }),
    );
    door.position.set(cx + 10, 1.9, cz + 13.1);
    group.add(door);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 2.4),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(signTexture('SAFEHOUSE', '#2a4a3a', '#e8f0d8')) }),
    );
    sign.position.set(cx - 6, 5.6, cz + 2.2);
    group.add(sign);
    addCollider(cx - 6, cz - 4, 8.5, 6.5);
    addCollider(cx + 10, cz + 8, 6.5, 5.5);
  }

  function buildHospital(cx, cz) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(34, 18, 24),
      new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.85 }),
    );
    body.position.set(cx, 9.1, cz);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    // Red cross on the roof, built from two boxes.
    const crossMat = new THREE.MeshStandardMaterial({ color: 0xc03028, roughness: 0.7 });
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 2.4), crossMat);
    crossA.position.set(cx, 18.8, cz);
    group.add(crossA);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 8), crossMat);
    crossB.position.set(cx, 18.8, cz);
    group.add(crossB);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 3.8),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(signTexture('SOLMAR GENERAL', '#f0f0ea', '#c03028')) }),
    );
    sign.position.set(cx, 14, cz + 12.2);
    group.add(sign);
    addCollider(cx, cz, 17.5, 12.5);
  }

  // ---- Marina and docks (south edge) --------------------------------------
  const waterZ0 = HALF + 8;   // water starts just past the last road
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 3.2, 90),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.water, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.05, waterZ0 + 45);
  water.receiveShadow = true;
  group.add(water);
  const beach = new THREE.Mesh(
    new THREE.BoxGeometry(HALF * 2 + 8, 0.3, 10),
    new THREE.MeshStandardMaterial({ color: CONFIG.colors.sand, roughness: 1 }),
  );
  beach.position.set(0, 0.15, HALF + 5);
  beach.receiveShadow = true;
  group.add(beach);
  // Wooden docks reaching into the water, with a few moored boats.
  const dockMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.dockWood, roughness: 1 });
  const boatColors = [0xe8e8e0, 0x3a6a9a, 0xc05040, 0xe8c860];
  for (let i = 0; i < 4; i++) {
    const dx = -120 + i * 80;
    const dock = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 34), dockMat);
    dock.position.set(dx, 0.4, waterZ0 + 16);
    dock.castShadow = true;
    group.add(dock);
    addCollider(dx, waterZ0 + 16, 3.2, 17.2);
    // Simple moored boat beside the dock.
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(5, 1.6, 14),
      new THREE.MeshStandardMaterial({ color: boatColors[i % boatColors.length], roughness: 0.6 }),
    );
    hull.position.set(dx + 7, 0.5, waterZ0 + 18);
    hull.castShadow = true;
    group.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.6, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    );
    cabin.position.set(dx + 7, 1.9, waterZ0 + 16);
    group.add(cabin);
  }
  // Palms along the beach.
  for (let i = 0; i < 8; i++) {
    addTree(-160 + i * 46, HALF + 4, 1.3);
  }

  scene.add(group);

  const landmarks = {
    spawn: { x: lines[2], z: lines[3] },          // a central intersection
    marina: { x: 0, z: waterZ0 + 6 },             // beachfront promenade
    docks: { x: -40, z: waterZ0 + 16 },           // first dock
    bank: { x: centers[3], z: centers[1] + 16 }, // in front of the bank
    safehouse: { x: centers[1] - 6, z: centers[3] + 8 },
    hospital: { x: centers[4], z: centers[4] + 15 },
  };

  function isBlocked(x, z, r) {
    for (const c of colliders) {
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  function resolveCircle(p, r) {
    // Push a circle out of every overlapping collider (a few passes
    // handle corners where two colliders meet).
    for (let pass = 0; pass < 3; pass++) {
      for (const c of colliders) {
        const nx = clamp(p.x, c.minX, c.maxX);
        const nz = clamp(p.z, c.minZ, c.maxZ);
        const dx = p.x - nx;
        const dz = p.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = nx + (dx / d) * r;
          p.z = nz + (dz / d) * r;
        } else {
          // Centre inside the box: push out along the smallest overlap.
          const pushL = p.x - c.minX + r;
          const pushR = c.maxX - p.x + r;
          const pushB = p.z - c.minZ + r;
          const pushF = c.maxZ - p.z + r;
          const m = Math.min(pushL, pushR, pushB, pushF);
          if (m === pushL) p.x = c.minX - r;
          else if (m === pushR) p.x = c.maxX + r;
          else if (m === pushB) p.z = c.minZ - r;
          else p.z = c.maxZ + r;
        }
      }
    }
  }

  return {
    group,
    colliders,
    roads,
    sidewalks,
    landmarks,
    bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: waterZ0 + 40 },
    roadLines: lines,
    isBlocked,
    resolveCircle,
  };
}
