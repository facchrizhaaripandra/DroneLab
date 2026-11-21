// Pure world config generator (no Three.js, testable in Node). Same seed gives the same world.
// Small seeded PRNG (mulberry32): the same seed always gives the same world.
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

// World + mission objects for one mission id. Same (id, seed) always gives the same result.
export function makeMissionConfig(id, seed = 42) {
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
  }
  return c;
}

// A config from the gateway may be partial. Fill the gaps so the world builder never crashes.
export function normalizeConfig(c) {
  return {
    seed: 0, bounds: 100, buildings: [], obstacles: [], rings: [],
    battery: { drain_idle: 0.05, drain_speed: 0.02, drain_kg: 0.05 },
    ...c,
    mission: c.mission ? { noFly: [], payload_kg: 0, ...c.mission } : undefined,
  };
}
