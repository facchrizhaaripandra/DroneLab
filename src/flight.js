// Kinematic drone flight model. Pure JS, no Three.js, so it is testable in Node.
// Conventions (see DRONELAB_SHARED.md section 4): meters, Y up, yaw in degrees,
// yaw 0 faces -Z, positive yaw is clockwise seen from above.
import { PHYS } from './config.js';
import { resolveSphereBoxes } from './collision.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// First-order lag toward a target with an acceleration cap (this is the "damping" feel).
function approach(v, target, tau, maxAccel, dt) {
  let dv = (target - v) * (1 - Math.exp(-dt / tau));
  const cap = maxAccel * dt;
  dv = clamp(dv, -cap, cap);
  return v + dv;
}

export class Flight {
  constructor() {
    this.mode = 'landed';          // landed | takeoff | flying | landing
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;                  // degrees, unwrapped (use telemetry() for 0..360)
    this.yawRate = 0;              // deg/s
    this.pitch = 0;                // degrees, positive = nose up
    this.roll = 0;                 // degrees, positive = right side down
    this.action = { yaw: 0, climb: 0, strafe: 0, forward: 0 };
    this.takeoffAlt = 0;
    this.collision = false;        // true while touching a box
    this.collisionCount = 0;       // rising edges
    // Previous-step pose, used by the renderer to interpolate between fixed steps.
    this.prevPos = [0, 0, 0];
    this.prevYaw = 0;
    this.prevPitch = 0;
    this.prevRoll = 0;
  }

  // Single entry point for every input source (keyboard, gamepad, script, autopilot).
  applyAction(a) {
    const t = this.action;
    t.yaw = clamp(a.yaw || 0, -1, 1);
    t.climb = clamp(a.climb || 0, -1, 1);
    t.strafe = clamp(a.strafe || 0, -1, 1);
    t.forward = clamp(a.forward || 0, -1, 1);
  }

  takeoff(h = 5) {
    if (this.mode !== 'landed') return false;
    this.takeoffAlt = clamp(h, 1, PHYS.maxAlt);
    this.mode = 'takeoff';
    return true;
  }

  land() {
    if (this.mode !== 'flying' && this.mode !== 'takeoff') return false;
    this.mode = 'landing';
    return true;
  }

  step(dt, boxes = []) {
    this.prevPos[0] = this.pos[0]; this.prevPos[1] = this.pos[1]; this.prevPos[2] = this.pos[2];
    this.prevYaw = this.yaw; this.prevPitch = this.pitch; this.prevRoll = this.roll;

    const P = PHYS;
    const a = this.action;
    const yawRad = this.yaw * DEG;
    const fx = Math.sin(yawRad), fz = -Math.cos(yawRad);   // forward
    const rx = Math.cos(yawRad), rz = Math.sin(yawRad);    // right

    let tvx = 0, tvy = 0, tvz = 0, tyaw = 0;
    if (this.mode === 'takeoff') {
      const rem = this.takeoffAlt - this.pos[1];
      tvy = clamp(rem * 1.2, 0.3, P.takeoffSpeed);
      if (rem <= 0.05) this.mode = 'flying';
    } else if (this.mode === 'flying') {
      const f = a.forward * P.maxSpeed, s = a.strafe * P.maxSpeed;
      tvx = fx * f + rx * s;
      tvz = fz * f + rz * s;
      tvy = a.climb * P.maxClimb;
      tyaw = a.yaw * P.maxYawRate;
    } else if (this.mode === 'landing') {
      tvy = -clamp(0.4 + this.pos[1] * 1.1, 0.4, P.landSpeed);
    }

    if (this.mode !== 'landed') {
      this.vel[0] = approach(this.vel[0], tvx, P.tauH, P.maxAccelH, dt);
      this.vel[2] = approach(this.vel[2], tvz, P.tauH, P.maxAccelH, dt);
      this.vel[1] = approach(this.vel[1], tvy, P.tauV, P.maxAccelV, dt);
      this.yawRate = approach(this.yawRate, tyaw, P.tauYaw, 1e9, dt);
      this.yaw += this.yawRate * dt;
    }

    // Tilt follows body-frame velocity (lean into the movement).
    const vf = this.vel[0] * fx + this.vel[2] * fz;
    const vr = this.vel[0] * rx + this.vel[2] * rz;
    const kt = 1 - Math.exp(-dt / P.tauTilt);
    this.pitch += (-clamp(vf / P.maxSpeed, -1, 1) * P.tiltMax - this.pitch) * kt;
    this.roll += (clamp(vr / P.maxSpeed, -1, 1) * P.tiltMax - this.roll) * kt;

    if (this.mode !== 'landed') {
      this.pos[0] += this.vel[0] * dt;
      this.pos[1] += this.vel[1] * dt;
      this.pos[2] += this.vel[2] * dt;

      // Ceiling and map bounds.
      if (this.pos[1] > P.maxAlt) { this.pos[1] = P.maxAlt; if (this.vel[1] > 0) this.vel[1] = 0; }
      this._clampAxis(0, P.mapHalf);
      this._clampAxis(2, P.mapHalf);

      const hit = resolveSphereBoxes(this.pos, this.vel, P.radius, boxes);
      if (hit && !this.collision) this.collisionCount++;
      this.collision = hit;

      // Ground contact: soft touchdown (hard-landing damage is a later mission rule).
      if (this.pos[1] <= 0.03 && this.vel[1] <= 0 && (this.mode === 'landing' || this.mode === 'flying')) {
        this.pos[1] = 0;
        this.vel[0] = this.vel[1] = this.vel[2] = 0;
        this.yawRate = 0;
        this.mode = 'landed';
      }
    }
  }

  _clampAxis(i, half) {
    if (this.pos[i] > half) { this.pos[i] = half; if (this.vel[i] > 0) this.vel[i] = 0; }
    else if (this.pos[i] < -half) { this.pos[i] = -half; if (this.vel[i] < 0) this.vel[i] = 0; }
  }

  telemetry() {
    const speed = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
    return {
      mode: this.mode,
      pos: this.pos,
      vel: this.vel,
      yaw: ((this.yaw % 360) + 360) % 360,
      pitch: this.pitch,
      roll: this.roll,
      alt: this.pos[1],
      speed,
      collision: this.collision,
    };
  }
}
