// Kinematic drone flight model. Pure JS, no Three.js, so it is testable in Node.
// Conventions (see DRONELAB_SHARED.md section 4): meters, Y up, yaw in degrees,
// yaw 0 faces -Z, positive yaw is clockwise seen from above.
import { PHYS } from './config.js';
import { resolveSphereBoxes } from './collision.js';
import { SAFE_SPEED } from './damage.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NO_FX = { speedScale: 1, climbScale: 1, sink: 0, driftRight: 0, driftForward: 0, yawBias: 0, lift: 1 };
const GRAVITY = 9.8;

// First-order lag toward a target with an acceleration cap (this is the "damping" feel).
function approach(v, target, tau, maxAccel, dt) {
  let dv = (target - v) * (1 - Math.exp(-dt / tau));
  const cap = maxAccel * dt;
  dv = clamp(dv, -cap, cap);
  return v + dv;
}

// Di atas batas ketinggian: peringatan 10 detik (kira-kira jeda failsafe sinyal DJI), lalu kerusakan bertahap
// sampai drone jatuh di detik ke-30.
export const ALT_GRACE = 10;
export const ALT_FAIL = 30;

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
    this.homeY = 0;
    this.ceiling = Infinity;
    this.overTime = 0;  // detik di atas batas ketinggian
    this.collision = false;        // true while touching a box
    this.collisionCount = 0;       // rising edges
    this.damage = null;            // DroneDamage (damage.js) or null for an undamageable drone
    this.onDamage = null;          // called with the list of parts that changed state after an impact
    this.contact = { nx: 0, ny: 0, nz: 0, speed: 0 }; // hardest impact of the last step
    this.wind = null;              // { speed, dir, gust } or null; dir uses the yaw convention (direction it blows to)
    this.time = 0;
    // Realistic scenes (terrain.js): ground height sampler (x, z) -> y and map limits
    // { minX, maxX, minZ, maxZ, maxAgl }. Null = the flat generated world (ground 0, PHYS.mapHalf, PHYS.maxAlt).
    this.ground = null;
    this.limits = null;
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
    if (this.damage && this.damage.fx.lift < 0.35) return false; // too damaged to lift off
    const g = this.groundY();
    this.homeY = g; // ketinggian titik lepas landas: batas atas dihitung dari sini seperti drone asli
    this.takeoffAlt = g + clamp(h, 1, this.limits ? this.limits.maxAgl : PHYS.maxAlt);
    this.mode = 'takeoff';
    return true;
  }

  land() {
    if (this.mode !== 'flying' && this.mode !== 'takeoff') return false;
    this.mode = 'landing';
    return true;
  }

  // Ground height under the drone (0 in the flat generated world).
  groundY() { return this.ground ? this.ground(this.pos[0], this.pos[2]) : 0; }

  // `world` is a list of AABBs or a physics object from physics.js (Rapier or AABB).
  step(dt, world = []) {
    this.time += dt;
    this.prevPos[0] = this.pos[0]; this.prevPos[1] = this.pos[1]; this.prevPos[2] = this.pos[2];
    this.prevYaw = this.yaw; this.prevPitch = this.pitch; this.prevRoll = this.roll;

    const dmg = this.damage;
    if (dmg && dmg.destroyed && this.mode !== 'landed' && this.mode !== 'crashed') this.mode = 'crashed';
    if (this.mode === 'crashed') { this._stepCrashed(dt, world); return; }

    const P = PHYS;
    const fxd = dmg ? dmg.fx : NO_FX;
    const a = this.action;
    const yawRad = this.yaw * DEG;
    const fx = Math.sin(yawRad), fz = -Math.cos(yawRad);   // forward
    const rx = Math.cos(yawRad), rz = Math.sin(yawRad);    // right

    let tvx = 0, tvy = 0, tvz = 0, tyaw = 0;
    if (this.mode === 'takeoff') {
      const rem = this.takeoffAlt - this.pos[1];
      tvy = clamp(rem * 1.2, 0.3, P.takeoffSpeed) * fxd.climbScale - fxd.sink;
      if (rem <= 0.05) this.mode = 'flying';
    } else if (this.mode === 'flying') {
      const top = P.maxSpeed * fxd.speedScale;
      const f = a.forward * top + fxd.driftForward, s = a.strafe * top + fxd.driftRight; // damage drift pushes even with sticks centered
      tvx = fx * f + rx * s;
      tvz = fz * f + rz * s;
      tvy = a.climb * P.maxClimb * fxd.climbScale - fxd.sink;
      tyaw = a.yaw * P.maxYawRate + fxd.yawBias;
    } else if (this.mode === 'landing') {
      tvy = -clamp(0.4 + (this.pos[1] - this.groundY()) * 1.1, 0.4, P.landSpeed);
    }

    if (this.wind && (this.mode === 'flying' || this.mode === 'takeoff')) {
      const w = this.wind, g = 1 + w.gust * Math.sin(this.time * 0.9) * Math.sin(this.time * 2.3 + 1);
      tvx += Math.sin(w.dir * DEG) * w.speed * g;
      tvz += -Math.cos(w.dir * DEG) * w.speed * g;
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

    if (this.mode === 'landed') this.overTime = 0;
    if (this.mode !== 'landed') {
      this.pos[0] += this.vel[0] * dt;
      this.pos[1] += this.vel[1] * dt;
      this.pos[2] += this.vel[2] * dt;

      // Ceiling and map bounds.
      const L = this.limits;
      if (L) {
        this._clampRange(0, L.minX, L.maxX);
        this._clampRange(2, L.minZ, L.maxZ);
      } else {
        this._clampAxis(0, P.mapHalf);
        this._clampAxis(2, P.mapHalf);
      }
      // Batas atas drone asli: 120 m dari titik lepas landas (default DJI), dan tak lebih dari 120 m di atas tanah
      // (aturan 400 ft). Di lereng tetap boleh naik minimal 30 m di atas tanah agar tidak tersangkut gunung.
      // Tidak ada tembok: melewati batas memberi peringatan ALT_GRACE detik, lalu motor dan baterai rusak
      // sampai drone gagal di ALT_FAIL detik (tanpa peta realistis, langit-langit lama 50 m tetap tembok).
      if (L) {
        const gy = this.groundY();
        this.ceiling = Math.min(gy + L.maxAgl, Math.max(this.homeY + L.maxAgl, gy + 30));
        if (this.pos[1] > this.ceiling) {
          this.overTime += dt;
          if (this.overTime > ALT_GRACE && dmg && !dmg.destroyed) {
            const ch = dmg.burn(dt * 2 / (ALT_FAIL - ALT_GRACE));
            if (ch.length && this.onDamage) this.onDamage(ch);
          }
        } else this.overTime = Math.max(0, this.overTime - dt * 2); // turun kembali: peringatan mereda
      } else {
        this.ceiling = P.maxAlt;
        if (this.pos[1] > P.maxAlt) { this.pos[1] = P.maxAlt; if (this.vel[1] > 0) this.vel[1] = 0; }
      }

      const hit = this._collide(world, P.radius);
      if (hit && !this.collision) this.collisionCount++;
      this.collision = hit;
      if (hit && dmg && this.contact.speed > SAFE_SPEED) {
        const changes = dmg.hit(this.contact.nx, this.contact.ny, this.contact.nz, this.contact.speed, this.yaw);
        if (changes.length && this.onDamage) this.onDamage(changes);
      }

      // Uneven ground (realistic scenes): never sink into the terrain. Flying into a slope fast counts as a hit.
      const g = this.groundY();
      if (this.ground && this.pos[1] < g) {
        this.pos[1] = g;
        const hs = Math.hypot(this.vel[0], this.vel[2]);
        if (this.vel[1] < 0) this.vel[1] = 0;
        if (hs > 2 && this.mode === 'flying') {
          if (!this.collision) this.collisionCount++;
          this.collision = true;
          this.vel[0] *= 0.3; this.vel[2] *= 0.3;
        }
      }

      // Ground contact: soft touchdown (hard-landing damage is a later mission rule).
      if (this.pos[1] <= g + 0.03 && this.vel[1] <= 0 && (this.mode === 'landing' || this.mode === 'flying')
          && (!this.ground || this.mode === 'landing' || Math.hypot(this.vel[0], this.vel[2]) < 2)) {
        this.pos[1] = g;
        this.vel[0] = this.vel[1] = this.vel[2] = 0;
        this.yawRate = 0;
        this.mode = 'landed';
      }
    }
  }

  _collide(world, radius) {
    const c = this.contact;
    if (Array.isArray(world)) return resolveSphereBoxes(this.pos, this.vel, radius, world, c);
    c.speed = 0;
    return world.resolve(this.prevPos, this.pos, this.vel, radius, c);
  }

  // A destroyed drone: no control, falls with gravity, slides to a stop.
  _stepCrashed(dt, world) {
    this.vel[1] -= GRAVITY * dt;
    const k = Math.exp(-dt * 0.8);
    this.vel[0] *= k; this.vel[2] *= k;
    this.yawRate *= k;
    this.yaw += this.yawRate * dt;
    this.pitch += (35 - this.pitch) * (1 - Math.exp(-dt * 2)); // nose down, tumbling
    const g = this.groundY();
    if (this.pos[1] > g) {
      for (let i = 0; i < 3; i++) this.pos[i] += this.vel[i] * dt;
      this._collide(world, PHYS.radius);
    }
    const g2 = this.groundY();
    if (this.pos[1] <= g2) { this.pos[1] = g2; this.vel[0] = this.vel[1] = this.vel[2] = 0; this.yawRate = 0; }
  }

  _clampRange(i, lo, hi) {
    if (this.pos[i] > hi) { this.pos[i] = hi; if (this.vel[i] > 0) this.vel[i] = 0; }
    else if (this.pos[i] < lo) { this.pos[i] = lo; if (this.vel[i] < 0) this.vel[i] = 0; }
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
