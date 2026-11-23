// Local "what can the drone see" (pure). Two uses:
//  - detect("label") in scripts: yes/no for one label;
//  - the `visible` list inside photo/mark events (ground truth for the scorer, SHARED section 5).
// Old labels (building, obstacle, target, dropzone) use a simple view cone. Mission objects
// (person, fire, smoke, landmark, defect) use the real camera model, with smoke blocking the view.
import { visibleList } from './camera-model.js';

const DEG = Math.PI / 180;
export const VIEW = { range: 60, halfFov: 40 }; // m, degrees

function inView(pos, yaw, x, z) {
  const dx = x - pos[0], dz = z - pos[2];
  const dist = Math.hypot(dx, dz);
  if (dist > VIEW.range) return false;
  if (dist < 1) return true;
  const err = ((Math.atan2(dx, -dz) / DEG - yaw + 180) % 360 + 360) % 360 - 180;
  return Math.abs(err) <= VIEW.halfFov;
}

// Mission objects as camera targets. Built once per world (cache by config object).
const cache = new WeakMap();
export function worldObjects(config) {
  if (cache.has(config)) return cache.get(config);
  const m = config.mission || {}, out = [];
  for (const v of m.victims || []) out.push({ label: 'person', id: v.id, x: v.x, y: v.y + 0.5, z: v.z, hx: 0.5, hy: 0.5 });
  for (const f of m.fires || []) out.push({ label: 'fire', id: f.id, x: f.x, y: 1.5, z: f.z, hx: f.r * 0.6, hy: 1.5 });
  for (const s of m.smoke || []) out.push({ label: 'smoke', id: s.id, x: s.x, y: s.h / 2, z: s.z, hx: s.r, hy: s.h / 2, range: 90 });
  for (const l of m.landmarks || []) out.push({ label: 'landmark', id: l.id, x: l.x, y: l.y, z: l.z, hx: l.hx, hy: l.hy, range: 250 });
  for (const d of m.defects || []) out.push({ label: 'defect', id: d.id, x: d.x, y: d.y, z: d.z, hx: d.size / 2, hy: d.size / 2, range: 40 });
  cache.set(config, out);
  return out;
}

// Smoke limits the view to about 6 m: an object farther than that is hidden when the line from the camera
// to it passes through a smoke column (2D circle) and one of them is below the top of the smoke.
// Thermal sees through it. (A column is treated as solid from the ground up to its top.)
const SMOKE_SIGHT = 6;
export function smokeBlocks(config, pos, o) {
  const smoke = (config.mission && config.mission.smoke) || [];
  for (let i = 0; i < smoke.length; i++) {
    const s = smoke[i];
    if (o.label === 'smoke' || Math.min(pos[1], o.y) >= s.h) continue;
    const dx = o.x - pos[0], dz = o.z - pos[2], len2 = dx * dx + dz * dz;
    if (len2 <= SMOKE_SIGHT * SMOKE_SIGHT) continue;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((s.x - pos[0]) * dx + (s.z - pos[2]) * dz) / len2)) : 0;
    if (Math.hypot(pos[0] + dx * t - s.x, pos[2] + dz * t - s.z) <= s.r) return true;
  }
  return false;
}

// pose: { pos, yaw, pitch } (pitch = gimbal angle). opts.thermal ignores smoke.
export function visibleObjects(pose, config, opts = {}) {
  const objs = worldObjects(config);
  if (!objs.length) return [];
  return visibleList(pose, objs, opts.thermal ? null : (o) => smokeBlocks(config, pose.pos, o));
}

// extra: boxes added by the player in freeroam ({x, z}). opts: { pitch, thermal }.
export function canSee(label, pos, yaw, config, extra = [], opts = {}) {
  const any = (list) => list.some((o) => inView(pos, yaw, o.x, o.z));
  switch (label) {
    case 'building': return any(config.buildings);
    case 'obstacle': return any(config.obstacles) || any(extra);
    case 'target': return any(config.rings.filter((r) => !r.passed));
    case 'dropzone': return !!(config.mission && config.mission.drop && inView(pos, yaw, config.mission.drop.x, config.mission.drop.z));
    default:
      return visibleObjects({ pos, yaw, pitch: opts.pitch ?? -10 }, config, opts).some((v) => v.label === label);
  }
}
