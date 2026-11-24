import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FollowCamera } from '../src/camera.js';

const slope = (x, z) => 10 + 0.3 * z; // ground rises toward +z, behind a drone facing -z (yaw 0)

for (const mode of [0, 1]) {
  test(`camera mode ${mode} stays above the ground when the drone is landed on a slope`, () => {
    const cam = new FollowCamera(new THREE.PerspectiveCamera());
    cam.ground = slope;
    cam.modeIndex = mode;
    const target = new THREE.Vector3(0, slope(0, 0), 0);
    for (let i = 0; i < 60; i++) cam.update(target, 0, 1 / 60);
    const p = cam.camera.position;
    assert.ok(p.y >= slope(p.x, p.z) + 0.25, `camera y ${p.y} vs ground ${slope(p.x, p.z)}`);
    assert.ok(p.y >= target.y + 0.1, 'not below the drone');
  });
}
