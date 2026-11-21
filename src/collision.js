// Sphere vs AABB resolution. Pure functions, no Three.js, so they are testable in Node.
// Phase 1 uses plain AABB math. The interface can be swapped for Rapier later.

// Pushes the sphere (pos, radius) out of every box and removes the velocity component
// pointing into the box. Returns true if any contact happened.
export function resolveSphereBoxes(pos, vel, radius, boxes) {
  let hit = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = Math.max(b.min[0], Math.min(pos[0], b.max[0]));
    const cy = Math.max(b.min[1], Math.min(pos[1], b.max[1]));
    const cz = Math.max(b.min[2], Math.min(pos[2], b.max[2]));
    let nx = pos[0] - cx, ny = pos[1] - cy, nz = pos[2] - cz;
    const d2 = nx * nx + ny * ny + nz * nz;
    if (d2 >= radius * radius) continue;

    if (d2 > 1e-12) {
      // Center is outside the box: push along the closest-point normal.
      const d = Math.sqrt(d2);
      nx /= d; ny /= d; nz /= d;
      const push = radius - d;
      pos[0] += nx * push; pos[1] += ny * push; pos[2] += nz * push;
    } else {
      // Center is inside the box: push out through the nearest face.
      const dx0 = pos[0] - b.min[0], dx1 = b.max[0] - pos[0];
      const dy0 = pos[1] - b.min[1], dy1 = b.max[1] - pos[1];
      const dz0 = pos[2] - b.min[2], dz1 = b.max[2] - pos[2];
      const m = Math.min(dx0, dx1, dy0, dy1, dz0, dz1);
      nx = ny = nz = 0;
      if (m === dx0) { nx = -1; pos[0] = b.min[0] - radius; }
      else if (m === dx1) { nx = 1; pos[0] = b.max[0] + radius; }
      else if (m === dy0) { ny = -1; pos[1] = b.min[1] - radius; }
      else if (m === dy1) { ny = 1; pos[1] = b.max[1] + radius; }
      else if (m === dz0) { nz = -1; pos[2] = b.min[2] - radius; }
      else { nz = 1; pos[2] = b.max[2] + radius; }
    }

    const vn = vel[0] * nx + vel[1] * ny + vel[2] * nz;
    if (vn < 0) { vel[0] -= vn * nx; vel[1] -= vn * ny; vel[2] -= vn * nz; }
    hit = true;
  }
  return hit;
}
