// Return-home autopilot. It is just another input source: it only calls sim.applyAction().
// Strategy: climb above every building, fly straight to the pad, then land.
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Autopilot {
  constructor(cruiseAlt = 34) {
    this.minCruiseAlt = cruiseAlt; // tallest generated building is 30 m
    this.active = false;
    this.phase = 'idle';           // climb | cruise
    this.cruiseAlt = cruiseAlt;
    this._a = { yaw: 0, climb: 0, strafe: 0, forward: 0 };
  }

  start(sim) {
    if (sim.mode !== 'flying') return false;
    this.active = true;
    this.phase = 'climb';
    this.cruiseAlt = Math.max(sim.pos[1], this.minCruiseAlt);
    return true;
  }

  cancel() {
    this.active = false;
    this.phase = 'idle';
  }

  // Call once per physics step while active.
  step(sim) {
    if (!this.active) return;
    if (sim.mode !== 'flying') { this.cancel(); return; }
    const a = this._a;
    a.yaw = 0; a.strafe = 0; a.forward = 0;
    a.climb = clamp((this.cruiseAlt - sim.pos[1]) * 0.8, -1, 1);

    if (this.phase === 'climb') {
      if (sim.pos[1] >= this.cruiseAlt - 0.5) this.phase = 'cruise';
    } else {
      const dx = -sim.pos[0], dz = -sim.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist < 1 && Math.hypot(sim.vel[0], sim.vel[2]) < 1) {
        sim.land();
        this.cancel();
        return;
      }
      // Heading to home: forward = (sin yaw, -cos yaw) => yaw = atan2(dx, -dz).
      const want = Math.atan2(dx, -dz) / DEG;
      let err = want - sim.yaw;
      err = ((err + 180) % 360 + 360) % 360 - 180;
      a.yaw = clamp(err / 30, -1, 1);
      a.forward = clamp(dist / 12, 0, 1) * Math.max(0, Math.cos(err * DEG));
    }
    sim.applyAction(a);
  }
}
