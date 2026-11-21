// Smooth chase camera: follows behind the drone, with separate smoothing for position and heading.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const DIST = 6;     // m behind the drone
const HEIGHT = 2.6; // m above the drone

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;              // smoothed heading, radians
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.ready = false;
  }

  // target = interpolated drone position, yawDeg = drone heading, dt = real frame time (s)
  update(target, yawDeg, dt) {
    const goal = yawDeg * DEG;
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
