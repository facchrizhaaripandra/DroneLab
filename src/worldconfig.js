// Pure world config generator (no Three.js, testable in Node). Same seed gives the same world.
// Small seeded PRNG (mulberry32): the same seed always gives the same world.
import { roofY, insideSpot } from './buildings.js';
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDefaultConfig(seed = 42) {
  const r = rng(seed);
  const rings = [];
  for (let i = 0; i < 5; i++) {
    const ang = (i * Math.PI * 2) / 5;
    rings.push({ x: Math.sin(ang) * 35, y: 6 + r() * 6, z: -Math.cos(ang) * 35 });
  }
  const nearRing = (x, z, d) => rings.some((g) => Math.hypot(g.x - x, g.z - z) < d);
  const overlaps = (list, x, z, w, d, m) =>
    list.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + m && Math.abs(b.z - z) < (b.d + d) / 2 + m);

  const buildings = [];
  for (let tries = 0; buildings.length < 14 && tries < 600; tries++) {
    const w = 6 + r() * 8, d = 6 + r() * 8, h = 8 + r() * 22;
    const x = (r() * 2 - 1) * 85, z = (r() * 2 - 1) * 85;
    if (Math.hypot(x, z) < 20 || nearRing(x, z, 10) || overlaps(buildings, x, z, w, d, 4)) continue;
    buildings.push({ x, z, w, d, h, shade: r() });
  }
  const obstacles = [];
  for (let tries = 0; obstacles.length < 8 && tries < 600; tries++) {
    const w = 1.5, d = 1.5, h = 3 + r() * 3;
    const x = (r() * 2 - 1) * 60, z = (r() * 2 - 1) * 60;
    if (Math.hypot(x, z) < 12 || nearRing(x, z, 6) || overlaps(buildings, x, z, w, d, 2) || overlaps(obstacles, x, z, w, d, 2)) continue;
    obstacles.push({ x, z, w, d, h, shade: 0 });
  }
  return {
    seed, bounds: 100, buildings, obstacles, rings,
    battery: { drain_idle: 0.05, drain_speed: 0.02, drain_kg: 0.05 },
  };
}

// A point at least `margin` m away from every building (and not on the home pad).
function freeSpot(r, buildings, minR, maxR, margin) {
  for (let i = 0; i < 200; i++) {
    const a = r() * Math.PI * 2, d = minR + r() * (maxR - minR);
    const x = Math.sin(a) * d, z = -Math.cos(a) * d;
    if (Math.abs(x) < 95 && Math.abs(z) < 95 && !overlaps(buildings, x, z, 0, 0, margin)) return { x, z };
  }
  return { x: 30, z: 30 };
}
function overlaps(list, x, z, w, d, m) {
  return list.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + m && Math.abs(b.z - z) < (b.d + d) / 2 + m);
}

const round2 = (v) => Math.round(v * 100) / 100;
const pick = (r, a, b) => a + r() * (b - a);
const insideBuilding = (list, x, z, m) => overlaps(list, x, z, 0, 0, m);

// A random spot in the ring minR..maxR from H that satisfies ok(x, z).
function spotWhere(r, minR, maxR, ok) {
  for (let i = 0; i < 400; i++) {
    const a = r() * Math.PI * 2, d = minR + r() * (maxR - minR);
    const x = Math.sin(a) * d, z = -Math.cos(a) * d;
    if (Math.abs(x) < 92 && Math.abs(z) < 92 && ok(x, z)) return { x: round2(x), z: round2(z) };
  }
  return null;
}

// ---- M1: victims, fire, smoke ----
function m1(c, r, variant) {
  const area = { min: [-80, -80], max: [80, 80] };
  const n = 3 + Math.floor(r() * 4); // 3..6 victims
  const victims = [], fires = [], smoke = [];
  if (variant === 'hutan') {
    c.buildings = []; c.obstacles = []; c.trees = [];
    for (let i = 0; i < 70; i++) {
      const p = spotWhere(r, 12, 92, (x, z) => !overlaps(c.trees, x, z, 1.6, 1.6, 2));
      if (p) c.trees.push({ ...p, w: 1.6, d: 1.6, h: round2(pick(r, 6, 11)), r: 2 });
    }
    for (let i = 0; i < 3; i++) {
      const p = spotWhere(r, 25, 70, (x, z) => fires.every((f) => Math.hypot(f.x - x, f.z - z) > 25));
      if (p) fires.push({ id: i + 1, ...p, r: 7 });
    }
    for (let i = 0; i < n; i++) {
      const p = spotWhere(r, 18, 80, (x, z) => fires.every((f) => Math.hypot(f.x - x, f.z - z) > f.r + 6)
        && victims.every((v) => Math.hypot(v.x - x, v.z - z) > 12) && !overlaps(c.trees, x, z, 1, 1, 2));
      if (p) victims.push({ id: i + 1, ...p, y: 0 });
    }
    for (const f of fires) smoke.push({ id: f.id, x: f.x, z: f.z, r: 9, h: 22 });
  } else {
    for (let i = 0; i < 2; i++) {
      const p = spotWhere(r, 20, 75, (x, z) => !insideBuilding(c.buildings, x, z, 3) && fires.every((f) => Math.hypot(f.x - x, f.z - z) > 25));
      if (p) fires.push({ id: i + 1, ...p, r: 6 });
    }
    for (let i = 0; i < n; i++) {
      const b = c.buildings[(i * 5 + 2) % c.buildings.length];
      let v = null;
      if (i === 0) v = { x: b.x, z: b.z, y: roofY(b) };  // one victim waits on a roof
      else if (i === 1 && b.h >= 8) { b.type = 'terbuka'; v = { ...insideSpot(b, 1), inside: true }; } // rangka gedung terbakar: korban di lantai 2
      else {
        const side = r() < 0.5 ? -1 : 1;
        const p = { x: round2(b.x + side * (b.w / 2 + 2.5)), z: round2(b.z + (r() * 2 - 1) * b.d / 2) };
        if (Math.hypot(p.x, p.z) > 14 && Math.abs(p.x) < 92 && !insideBuilding(c.buildings, p.x, p.z, 1)
          && fires.every((f) => Math.hypot(f.x - p.x, f.z - p.z) > f.r + 4)) v = { ...p, y: 0 };
      }
      if (v && victims.every((o) => Math.hypot(o.x - v.x, o.z - v.z) > 6)) victims.push({ id: victims.length + 1, ...v });
    }
    // Smoke hangs over two of the victims' buildings and over the fires: normal mode loses sight, thermal does not.
    victims.slice(0, 2).forEach((v) => smoke.push({ id: smoke.length + 1, x: v.x, z: v.z, r: 8, h: 26 }));
    for (const f of fires) smoke.push({ id: smoke.length + 1, x: f.x, z: f.z, r: 9, h: 24 });
  }
  const safe = spotWhere(r, 14, 26, (x, z) => !insideBuilding(c.buildings, x, z, 5) && !overlaps(c.trees || [], x, z, 1, 1, 4)) || { x: 14, z: 14 };
  c.rings = [];
  c.mission = { variant, area, victims, fires, smoke, safe: { ...safe, r: 4 }, markRadius: 5 };
}

// ---- M2: landmarks, sun, shot list ----
function m2(c, r, variant) {
  c.rings = []; c.obstacles = [];
  const landmarks = [];
  c.solids = [];
  if (variant === 'gunung') {
    c.buildings = [];
    const px = round2(pick(r, -15, 15)), pz = -75;
    landmarks.push({ id: 'puncak', name: 'Puncak', kind: 'peak', x: px, y: 25, z: pz, hx: 30, hy: 25, r: 30, h: 50 });
    landmarks.push({ id: 'danau', name: 'Danau', kind: 'lake', x: round2(px - 38), y: 0.3, z: -38, hx: 14, hy: 3, r: 14 });
    // The peak is solid: three stacked boxes that sit inside the cone.
    for (const [w, y0, h] of [[28, 0, 16], [15, 16, 16], [2, 32, 16]]) c.solids.push({ x: px, z: pz, w, d: w, h, y0, hidden: true });
    c.mission = { variant, landmarks };
    var main = 'puncak', second = 'danau';
  } else {
    const hx = round2(pick(r, -8, 8)), hz = -48;
    c.buildings = [{ x: hx, z: hz, w: 30, d: 14, h: 22, shade: 0.7, type: 'hotel' }, { x: hx - 24, z: hz + 6, w: 12, d: 10, h: 12, shade: 0.4, type: 'hotel' }];
    landmarks.push({ id: 'hotel', name: 'Fasad hotel', kind: 'box', x: hx, y: 11, z: hz + 7, hx: 15, hy: 11 });
    landmarks.push({ id: 'kolam', name: 'Kolam renang', kind: 'pool', x: round2(hx + 6), y: 0.2, z: -28, hx: 6, hy: 2, w: 12, d: 7 });
    landmarks.push({ id: 'atap', name: 'Atap hotel', kind: 'roof', x: hx, y: 22, z: hz, hx: 15, hy: 2 });
    c.mission = { variant, landmarks };
    main = 'hotel'; second = 'kolam';
  }
  const w = (id) => landmarks.find((l) => l.id === id);
  c.mission.sun = { az: Math.round(pick(r, 40, 320)), el: Math.round(pick(r, 25, 60)) };
  c.mission.shots = [
    { id: 's1', type: 'photo', kind: 'wide', subject: main, areaRange: [0.05, 0.35], label: `Foto pembuka lebar: ${w(main).name}` },
    { id: 's2', type: 'photo', kind: 'detail', subject: second, areaRange: [0.10, 0.60], label: `Foto detail: ${w(second).name}` },
    { id: 's3', type: 'video', kind: 'orbit', subject: main, minDur: 8, maxDur: 16, label: `Video orbit 10 detik: ${w(main).name}` },
    { id: 's4', type: 'video', kind: 'reveal', subject: main, minDur: 5, maxDur: 14, label: 'Video reveal: naik sambil menjauh' },
  ];
}

// ---- M3: field with a house and a river ----
function m3(c, r) {
  c.rings = [];
  const cell = 2, w = 24, d = 16;
  const ctr = spotWhere(r, 32, 48, (x, z) => Math.abs(x) < 80 && Math.abs(z) < 82) || { x: 30, z: -40 };
  const minX = Math.round((ctr.x - w / 2) / cell) * cell, minZ = Math.round((ctr.z - d / 2) / cell) * cell;
  const field = { min: [minX, minZ], max: [minX + w, minZ + d], cell };
  const pad = 6;
  const clear = (b) => !(Math.abs(b.x - (minX + w / 2)) < (b.w + w) / 2 + pad && Math.abs(b.z - (minZ + d / 2)) < (b.d + d) / 2 + pad);
  c.buildings = c.buildings.filter(clear);
  c.obstacles = c.obstacles.filter(clear);
  const houseRect = { min: [minX, minZ], max: [minX + 8, minZ + 6], kind: 'house' };
  const riverRect = { min: [minX + w - 4, minZ], max: [minX + w, minZ + d], kind: 'river' };
  c.buildings.push({ x: minX + 4, z: minZ + 3, w: 7, d: 5, h: 5, shade: 0.3 });
  c.wind = { speed: round2(pick(r, 1, 2)), dir: Math.round(pick(r, 0, 359)), gust: 0.2 };
  c.mission = { variant: 'lahan', field, noSpray: [houseRect, riverRect], river: { min: [minX + w - 4, minZ - 20], max: [minX + w, minZ + d + 20] },
    dose: { lo: 0.4, hi: 1.2, flow: 10, capacity: 200 } };
}

// ---- M5: structure with defects ----
function m5(c, r, variant) {
  c.rings = []; c.obstacles = []; c.solids = [];
  const ctr = spotWhere(r, 30, 45, () => true) || { x: 0, z: -40 };
  const faces = [ // name, normal, width axis length, face-plane offset
    { face: 'N', nx: 0, nz: -1 }, { face: 'S', nx: 0, nz: 1 }, { face: 'E', nx: 1, nz: 0 }, { face: 'W', nx: -1, nz: 0 },
  ];
  let s;
  if (variant === 'jembatan') {
    s = { x: ctr.x, z: ctr.z, w: 44, d: 7, y0: 9, y1: 12 };
    c.buildings = c.buildings.filter((b) => Math.hypot(b.x - s.x, b.z - s.z) > 40);
    c.solids.push({ x: s.x, z: s.z, w: s.w, d: s.d, h: 3, y0: 9, shade: 0.5 });
    for (const dx of [-13, 13]) c.solids.push({ x: s.x + dx, z: s.z, w: 3, d: 4, h: 9, y0: 0, shade: 0.6 });
  } else {
    s = { x: ctr.x, z: ctr.z, w: 16, d: 12, y0: 0, y1: 20 };
    c.buildings = c.buildings.filter((b) => Math.hypot(b.x - s.x, b.z - s.z) > 30);
    c.buildings.push({ x: s.x, z: s.z, w: s.w, d: s.d, h: 20, shade: 0.55, type: 'inspeksi' });
  }
  const panels = [];
  for (const f of faces) {
    const along = f.nx === 0 ? s.w : s.d;               // length of this face
    const cols = variant === 'jembatan' ? (f.nx === 0 ? 4 : 1) : 3;
    const rows = variant === 'jembatan' ? 1 : 2;
    const hgt = s.y1 - s.y0;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const t = -along / 2 + (i + 0.5) * (along / cols);
      panels.push({
        id: panels.length + 1, face: f.face, nx: f.nx, nz: f.nz,
        x: round2(f.nx === 0 ? s.x + t : s.x + f.nx * (s.w / 2 + 0.1)), y: round2(s.y0 + (j + 0.5) * (hgt / rows)),
        z: round2(f.nx === 0 ? s.z + f.nz * (s.d / 2 + 0.1) : s.z + t),
      });
    }
  }
  const defects = [], order = panels.map((p, i) => ({ p, k: r() })).sort((a, b) => a.k - b.k).slice(0, 5 + Math.floor(r() * 3));
  order.forEach(({ p }, i) => {
    const jx = (r() - 0.5) * 2, jy = (r() - 0.5) * 2;
    const alongX = p.nx === 0;
    defects.push({
      id: i + 1, kind: r() < 0.5 ? 'retak' : 'karat', face: p.face, nx: p.nx, nz: p.nz, size: round2(pick(r, 0.4, 2)),
      x: round2(p.x + (alongX ? jx : 0)), y: round2(Math.max(s.y0 + 1, p.y + jy)), z: round2(p.z + (alongX ? 0 : jx)),
    });
  });
  c.mission = { variant, structure: s, panels, defects, safe: { min: 3, max: 8 } };
}

// World + mission objects for one mission id. Same (id, seed, variant) always gives the same result.
export function makeMissionConfig(id, seed = 42, variant) {
  const c = makeDefaultConfig(seed);
  const r = rng(seed + 1000);
  if (id === 'latihan_terbang' || id === 'freeroam') {
    c.rings = [];
  } else if (id === 'rintangan') {
    // Goal ring far ahead (-Z) with poles in the lane between.
    c.rings = [{ x: 0, y: 6, z: -80 }];
    for (let i = 0, tries = 0; i < 7 && tries < 200; tries++) {
      const x = (r() * 2 - 1) * 14, z = -20 - r() * 50;
      if (overlaps(c.buildings, x, z, 1.5, 1.5, 3) || overlaps(c.obstacles, x, z, 1.5, 1.5, 3)) continue;
      c.obstacles.push({ x, z, w: 1.5, d: 1.5, h: 4 + r() * 6, shade: 0 });
      i++;
    }
  } else if (id === 'm4_delivery') {
    c.rings = [];
    const pickup = freeSpot(r, c.buildings, 25, 45, 5);
    let drop = freeSpot(r, c.buildings, 55, 80, 5);
    for (let i = 0; i < 50 && Math.hypot(drop.x - pickup.x, drop.z - pickup.z) < 40; i++) drop = freeSpot(r, c.buildings, 55, 80, 5);
    const noFly = [];
    for (let i = 0; i < 2; i++) {
      const p = freeSpot(r, c.buildings, 15, 70, 8);
      if (Math.hypot(p.x - pickup.x, p.z - pickup.z) < 15 || Math.hypot(p.x - drop.x, p.z - drop.z) < 15) continue;
      noFly.push({ min: [p.x - 6, p.z - 6], max: [p.x + 6, p.z + 6] });
    }
    c.mission = { pickup: { ...pickup, r: 3 }, drop: { ...drop, r: 4 }, noFly, payload_kg: 1.5 };
  } else if (id === 'm1_sar') m1(c, r, variant || 'gedung');
  else if (id === 'm2_foto') m2(c, r, variant || 'hotel');
  else if (id === 'm3_agri') m3(c, r);
  else if (id === 'm5_inspeksi') m5(c, r, variant || 'gedung');
  return c;
}

// A config from the gateway may be partial. Fill the gaps so the world builder never crashes.
export function normalizeConfig(c) {
  return {
    seed: 0, bounds: 100, buildings: [], obstacles: [], rings: [], trees: [], solids: [],
    battery: { drain_idle: 0.05, drain_speed: 0.02, drain_kg: 0.05 },
    ...c,
    mission: c.mission ? { noFly: [], payload_kg: 0, ...c.mission } : undefined,
  };
}
