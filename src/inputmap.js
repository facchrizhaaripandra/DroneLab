// Pure input mapping helpers (no DOM, no Three.js), testable in Node.

export const DEFAULT_INPUT = {
  deadzone: 0.15,     // radial stick deadzone
  mode: 2,            // RC stick scheme: 2 = left throttle+yaw, right pitch+roll
  invertY: false,
  sensitivity: 1,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Radial deadzone with rescale so the output still reaches 1 at full deflection.
const rz = [0, 0];
function radial(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) { rz[0] = 0; rz[1] = 0; return; }
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  rz[0] = x * s; rz[1] = y * s;
}

// axes: standard mapping [LX, LY, RX, RY], up is negative. Writes into `out` (reused each frame).
export function mapSticks(axes, cfg, out) {
  const c = { ...DEFAULT_INPUT, ...cfg };
  const sgn = c.invertY ? -1 : 1;
  radial(axes[0] || 0, axes[1] || 0, c.deadzone);
  const lx = rz[0], ly = rz[1];
  radial(axes[2] || 0, axes[3] || 0, c.deadzone);
  const rx = rz[0], ry = rz[1];
  const k = c.sensitivity;
  out.yaw = clamp(lx * k, -1, 1);
  out.strafe = clamp(rx * k, -1, 1);
  if (c.mode === 1) {
    out.forward = clamp(-ly * sgn * k, -1, 1) + 0; // + 0 turns -0 into 0
    out.climb = clamp(-ry * sgn * k, -1, 1) + 0;
  } else {
    out.climb = clamp(-ly * sgn * k, -1, 1) + 0;
    out.forward = clamp(-ry * sgn * k, -1, 1) + 0;
  }
  return out;
}

// Which raw axes are [LX, LY, RX, RY]? Standard-mapping pads use 0..3. Other pads (DirectInput/HID)
// expose triggers and the hat as extra axes that rest at +-1 (or beyond), e.g. a DualShock reports
// [LX, LY, RX, L2, R2, RY, hat]. Reading axes[3] as "right stick Y" would then be stuck at -1
// (= forward forever). So for non-standard pads we skip axes that do not rest near 0.
// Call once when the pad appears, with the sticks centered.
export function pickStickAxes(axes, mapping) {
  if (mapping === 'standard' || axes.length < 4) return [0, 1, 2, 3];
  const picked = [];
  for (let i = 0; i < axes.length && picked.length < 4; i++) if (Math.abs(axes[i]) < 0.5) picked.push(i);
  return picked.length === 4 ? picked : [0, 1, 2, 3];
}

// keys: Set of KeyboardEvent.code, b: bindings (action -> code).
export function keysToAction(keys, b, out) {
  out.forward = (keys.has(b.forward) ? 1 : 0) - (keys.has(b.back) ? 1 : 0);
  out.strafe = (keys.has(b.right) ? 1 : 0) - (keys.has(b.left) ? 1 : 0);
  out.climb = (keys.has(b.up) ? 1 : 0) - (keys.has(b.down) ? 1 : 0);
  out.yaw = (keys.has(b.yawRight) ? 1 : 0) - (keys.has(b.yawLeft) ? 1 : 0);
  return out;
}

// PlayStation pads report Sony's vendor id 054c; everything else is treated as Xbox-style.
export function padType(id) {
  return /054c|dualsense|dualshock|playstation/i.test(id || '') ? 'ps' : 'xbox';
}

// Hold-to-confirm: fires once after `duration` seconds of continuous press, re-arms on release.
export class HoldTracker {
  constructor(duration = 0.6) {
    this.duration = duration;
    this.t = 0;
    this.fired = false;
  }

  get progress() { return this.fired ? 1 : Math.min(this.t / this.duration, 1); }

  // returns true on the frame the hold completes
  update(dt, down) {
    if (!down) { this.t = 0; this.fired = false; return false; }
    if (this.fired) return false;
    this.t += dt;
    if (this.t >= this.duration) { this.fired = true; return true; }
    return false;
  }
}

// Move `cur` toward `target` by at most `step` (step = Infinity jumps at once). Used for keyboard acceleration.
export function approach(cur, target, step) {
  if (step === Infinity || Math.abs(target - cur) <= step) return target;
  return cur + Math.sign(target - cur) * step;
}
