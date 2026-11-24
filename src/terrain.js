// Ground height and flight limits for the realistic Blender scenes (pure JS, testable in Node).
// scene.json is written by scripts/blender/export_scene.py, already in simulator coordinates and
// shifted so the spawn pad is at (0, 0, 0).

// Bilinear height sampler over a regular grid. Column i runs along +X, row j along +Z.
// Outside the grid the nearest edge value is used.
export function makeHeightSampler(h) {
  if (!h || !h.data || !h.nx || !h.nz) return () => 0;
  const { x0, z0, cell, nx, nz } = h;
  const data = h.data instanceof Float32Array ? h.data : Float32Array.from(h.data);
  const at = (i, j) => data[j * nx + i];
  return (x, z) => {
    let fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0) fx = 0; else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0; else if (fz > nz - 1) fz = nz - 1;
    const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fz), nz - 2);
    const tx = fx - i, tz = fz - j;
    if (nx < 2 || nz < 2) return at(0, 0);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return a + (b - a) * tz;
  };
}

// AABB colliders from scene.json ([minX, minY, minZ, maxX, maxY, maxZ]) in the shape collision.js uses.
// Boxes thinner than `minHeight` are dropped: kerbs, yard slabs and markings would only snag the 0.5 m sphere.
export function sceneColliders(list, minHeight = 0.3) {
  const out = [];
  for (const c of list || []) {
    if (c[4] - c[1] < minHeight) continue;
    out.push({ min: [c[0], c[1], c[2]], max: [c[3], c[4], c[5]] });
  }
  return out;
}

// Flight limits for Flight.limits: map rectangle and the ceiling above the local ground.
export function sceneLimits(meta) {
  const b = meta.bounds;
  return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, maxAgl: meta.maxAgl || 120 };
}

// Minimap boxes ({x, z, w, d}) for hud.js.
export function sceneMapBoxes(list) {
  return (list || []).map((b) => ({ x: b[0], z: b[1], w: b[2], d: b[3] }));
}
