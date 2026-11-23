// Drone camera geometry (pure, no Three.js). One model for everything that needs "what is in the frame":
// the `visible` list of photo/mark events, video scoring and the M2/M5 photo scores.
// Camera: nose-mounted, yaw follows the drone, pitch is the gimbal angle, 16:9, vertical FOV 70 degrees.
// Roll is not used for projection (it only matters for the "horizon level" photo score).
const DEG = Math.PI / 180;
export const CAM = { vfov: 70, aspect: 16 / 9 };
const TAN = Math.tan((CAM.vfov / 2) * DEG);

const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

// Projects an object {x, y, z, hx, hy} (center and half extents in m) into the frame of a camera pose.
// pose: { pos: [x, y, z], yaw, pitch }. Returns null when it is behind the camera, otherwise
// { dist, box: [x, y, w, h] (normalized, top-left origin, clipped to the frame), area (clipped), full (unclipped area), center: [u, v] }.
export function project(pose, o) {
  const yaw = pose.yaw * DEG, pit = pose.pitch * DEG;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pit), cp = Math.cos(pit);
  const dx = o.x - pose.pos[0], dy = o.y - pose.pos[1], dz = o.z - pose.pos[2];
  const z = dx * sy * cp + dy * sp - dz * cy * cp;       // depth along the view direction
  if (z < 0.5) return null;
  const x = dx * cy + dz * sy;                            // right
  const y = -dx * sy * sp + dy * cp + dz * cy * sp;       // up
  const u = 0.5 + x / (z * TAN * CAM.aspect) / 2, v = 0.5 - y / (z * TAN) / 2;
  const w = (o.hx || 0.01) / (z * TAN * CAM.aspect), h = (o.hy || 0.01) / (z * TAN); // normalized full width/height
  const x0 = Math.max(0, u - w / 2), x1 = Math.min(1, u + w / 2);
  const y0 = Math.max(0, v - h / 2), y1 = Math.min(1, v + h / 2);
  const cw = Math.max(0, x1 - x0), ch = Math.max(0, y1 - y0);
  return { dist: Math.hypot(dx, dy, dz), box: [x0, y0, cw, ch], area: cw * ch, full: w * h, center: [u, v] };
}

// An object counts as "in the frame" when at least half of its box is inside it.
export const inFrame = (p) => !!p && p.full > 0 && p.area / p.full >= 0.5;

// Builds the `visible` list for an event. objects: [{ label, id, x, y, z, hx, hy, range }].
// `blocked(o)` lets the caller hide objects (smoke). The output is rounded so logs stay small and stable.
export function visibleList(pose, objects, blocked = null) {
  const out = [];
  for (const o of objects) {
    const p = project(pose, o);
    if (!p || p.dist > (o.range || 60) || !inFrame(p)) continue;
    if (blocked && blocked(o)) continue;
    out.push({ label: o.label, id: o.id, dist: round(p.dist, 1), area: round(p.area, 4), box: p.box.map((b) => round(b, 3)) });
  }
  return out;
}

// Angle (degrees, 0..360) of the bearing from point A to point B, yaw convention (0 = -Z, clockwise).
export const bearing = (ax, az, bx, bz) => ((Math.atan2(bx - ax, -(bz - az)) / DEG) + 360) % 360;
// Smallest signed difference between two angles, -180..180.
export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
