// Local "what can the drone see" (pure). Used by detect("label") in scripts and later for the `visible` field.
// A simple view cone (not real rendering): within range and inside the horizontal field of view.
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

// extra: boxes added by the player in freeroam ({x, z}).
export function canSee(label, pos, yaw, config, extra = []) {
  const any = (list) => list.some((o) => inView(pos, yaw, o.x, o.z));
  switch (label) {
    case 'building': return any(config.buildings);
    case 'obstacle': return any(config.obstacles) || any(extra);
    case 'target': return any(config.rings.filter((r) => !r.passed));
    case 'dropzone': return !!(config.mission && inView(pos, yaw, config.mission.drop.x, config.mission.drop.z));
    default: return false; // person, fire, smoke, landmark, defect: need a mission world that has them
  }
}
