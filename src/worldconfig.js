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
  return { seed, bounds: 100, buildings, obstacles, rings };
}
