// Drone damage model (pure JS). Parts: 4 rotors, camera, battery, frame. Each has health 1 (new) to 0 (gone).
// An impact hurts the parts on the side that touched the obstacle, in proportion to the impact speed.
// effects() turns the health values into numbers the flight model uses (lift, drift, spin, ...).

const DEG = Math.PI / 180;
export const ROTOR_NAMES = ['kiri depan', 'kanan depan', 'kiri belakang', 'kanan belakang'];
// Rotor positions in the body frame as (right, forward) unit vectors: FL, FR, RL, RR (same order as drone.js).
const ROTOR_DIR = [[-0.707, 0.707], [0.707, 0.707], [-0.707, -0.707], [0.707, -0.707]];

export const SAFE_SPEED = 1.5;   // m/s along the surface normal: a bump below this does nothing
export const FULL_SPEED = 6.5;   // m/s: an impact this hard (or more) wrecks the side that took it
const BROKEN = 0.05;             // rotor health at or below this = the propeller is gone
const DAMAGED = 0.65;            // below this the propeller is bent (still spins, weaker, wobbles)

export const stateOf = (h) => (h <= BROKEN ? 'broken' : h < DAMAGED ? 'damaged' : 'ok');

export class DroneDamage {
  constructor() {
    this.rotors = [1, 1, 1, 1];
    this.camera = 1;
    this.battery = 1;
    this.body = 1;
    // Numbers for the flight model, refreshed whenever health changes (no allocation in the loop).
    this.fx = { lift: 1, speedScale: 1, climbScale: 1, sink: 0, driftRight: 0, driftForward: 0, yawBias: 0, drainMul: 1, camera: 1 };
    this.destroyed = false;
    this.refresh();
  }

  reset() { this.rotors.fill(1); this.camera = this.battery = this.body = 1; this.destroyed = false; this.refresh(); }

  get brokenRotors() { let n = 0; for (const h of this.rotors) if (h <= BROKEN) n++; return n; }

  // Impact with a surface whose normal is (nx, ny, nz) (pointing away from the surface), at `speed` m/s
  // along that normal, while the drone faces yawDeg. Returns the list of parts that changed state.
  hit(nx, ny, nz, speed, yawDeg) {
    if (speed <= SAFE_SPEED) return [];
    const e = Math.min(1, (speed - SAFE_SPEED) / (FULL_SPEED - SAFE_SPEED));
    // Direction from the drone toward what it hit, in the body frame (right, forward) plus up.
    const y = yawDeg * DEG, sy = Math.sin(y), cy = Math.cos(y);
    const dx = -nx, dz = -nz, up = -ny;
    const right = dx * cy + dz * sy;
    const fwd = dx * sy - dz * cy;

    const before = this._states();
    for (let i = 0; i < 4; i++) {
      const share = Math.max(0, right * ROTOR_DIR[i][0] + fwd * ROTOR_DIR[i][1]) + Math.max(0, up) * 0.6;
      this.rotors[i] = Math.max(0, this.rotors[i] - e * (0.2 + 1.2 * Math.min(1, share)));
    }
    this.camera = Math.max(0, this.camera - e * (fwd > 0.5 ? 0.9 : 0.2));
    this.battery = Math.max(0, this.battery - e * (e > 0.5 ? 0.3 : 0.1));
    this.body = Math.max(0, this.body - e * (0.3 + 0.2 * Math.abs(up)));
    this.refresh();
    return this._diff(before);
  }

  // Direct damage without a direction (fire, heat): spread over all parts, scaled by amount 0..1.
  burn(amount) {
    const before = this._states();
    for (let i = 0; i < 4; i++) this.rotors[i] = Math.max(0, this.rotors[i] - amount * 0.5);
    this.camera = Math.max(0, this.camera - amount);
    this.battery = Math.max(0, this.battery - amount * 0.6);
    this.body = Math.max(0, this.body - amount * 0.4);
    this.refresh();
    return this._diff(before);
  }

  // Air pada bagian tertentu: hanya bagian yang terendam yang rusak. rotors = jumlah kerusakan per baling-baling
  // (0..1), camera = jumlah kerusakan kamera. Perubahan ditandai cause 'water'.
  soak(rotors, camera) {
    const before = this._states();
    for (let i = 0; i < 4; i++) if (rotors[i] > 0) this.rotors[i] = Math.max(0, this.rotors[i] - rotors[i]);
    if (camera > 0) this.camera = Math.max(0, this.camera - camera);
    this.refresh();
    return this._diff(before).map((c) => ({ ...c, cause: 'water' }));
  }

  // Badan terendam: air masuk ke baterai dan flight controller. Drone mati total.
  drown() {
    const before = this._states();
    this.body = 0; this.battery = 0;
    this.refresh();
    return this._diff(before).map((c) => ({ ...c, cause: 'water' }));
  }

  refresh() {
    const r = this.rotors, f = this.fx;
    const lift = (r[0] + r[1] + r[2] + r[3]) / 4;
    const left = (r[0] + r[2]) / 2, rightT = (r[1] + r[3]) / 2;
    const front = (r[0] + r[1]) / 2, rear = (r[2] + r[3]) / 2;
    f.lift = lift;
    f.speedScale = 0.4 + 0.6 * lift;
    f.climbScale = lift;
    f.sink = Math.max(0, 0.8 - lift) * 4;               // m/s: below 80% lift the drone cannot hold its altitude
    f.driftRight = (left - rightT) * 3;                // a stronger right side pushes the drone to the left
    f.driftForward = (rear - front) * 3;               // a stronger front pushes it backward
    f.yawBias = ((r[0] + r[3]) - (r[1] + r[2])) / 2 * 45; // deg/s, diagonal imbalance spins the drone
    f.drainMul = 1 + (1 - this.battery) * 2;
    f.camera = this.camera;
    this.destroyed = this.body <= 0 || this.brokenRotors >= 3;
  }

  _states() { return [...this.rotors.map(stateOf), stateOf(this.camera), stateOf(this.body)]; }
  _diff(before) {
    const now = this._states(), out = [];
    now.forEach((s, i) => {
      if (s === before[i]) return;
      const part = i < 4 ? `baling-baling ${ROTOR_NAMES[i]}` : i === 4 ? 'kamera' : 'rangka';
      out.push({ part, index: i, state: s });
    });
    return out;
  }
}
