// Smooth chase camera: follows behind the drone, with separate smoothing for position and heading.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const DIST = 6;     // m behind the drone
const HEIGHT = 2.6; // m above the drone

// V cycles through these views. All of them reuse the same camera object.
export const CAMERA_MODES = [
  { id: 'chase', label: 'Kamera ikut' },
  { id: 'fpv', label: 'Kamera depan drone' },
  { id: 'top', label: 'Kamera atas' },
];

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;              // smoothed heading, radians
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.ready = false;
    this.modeIndex = 0;
  }

  get mode() { return CAMERA_MODES[this.modeIndex]; }
  cycle(step = 1) {
    this.modeIndex = (this.modeIndex + step + CAMERA_MODES.length) % CAMERA_MODES.length;
    this.ready = false; // snap to the new view instead of sliding across the map
    return this.mode;
  }

  // target = interpolated drone position, yawDeg = drone heading, dt = real frame time (s)
  update(target, yawDeg, dt) {
    const goal = yawDeg * DEG;
    const id = this.mode.id;
    if (id !== 'chase') {
      const sy = Math.sin(goal), cy = Math.cos(goal);
      if (id === 'fpv') {
        this.camera.up.set(0, 1, 0);
        this.camera.position.set(target.x + sy * 0.4, target.y + 0.1, target.z - cy * 0.4);
        this.look.set(target.x + sy * 10, target.y - 0.8, target.z - cy * 10);
      } else { // top: straight down, screen "up" follows the drone heading
        this.camera.position.set(target.x, target.y + 30, target.z);
        this.look.set(target.x - sy * 0.01, target.y, target.z + cy * 0.01);
        this.camera.up.set(sy, 0, -cy);
      }
      this.camera.lookAt(this.look);
      return;
    }
    this.camera.up.set(0, 1, 0);
    if (!this.ready) {
      this.yaw = goal;
      this.pos.set(target.x - Math.sin(goal) * DIST, target.y + HEIGHT, target.z + Math.cos(goal) * DIST);
      this.look.copy(target);
      this.ready = true;
    }
    // Shortest-angle turn toward the drone heading.
    let d = goal - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-dt * 3));

    const gx = target.x - Math.sin(this.yaw) * DIST;
    const gy = target.y + HEIGHT;
    const gz = target.z + Math.cos(this.yaw) * DIST;
    const k = 1 - Math.exp(-dt * 6);
    this.pos.x += (gx - this.pos.x) * k;
    this.pos.y += (gy - this.pos.y) * k;
    this.pos.z += (gz - this.pos.z) * k;
    this.look.x += (target.x - this.look.x) * k;
    this.look.y += (target.y + 0.4 - this.look.y) * k;
    this.look.z += (target.z - this.look.z) * k;

    this.camera.position.set(this.pos.x, Math.max(this.pos.y, 0.6), this.pos.z); // never below ground
    this.camera.lookAt(this.look);
  }
}
