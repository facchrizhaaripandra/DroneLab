// Drone visual model (primitives for now; a .glb can replace it later) and pose sync.
import * as THREE from 'three';

const DEG = Math.PI / 180;

export function createDrone(scene) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ'; // yaw, then pitch, then roll

  const dark = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const grey = new THREE.MeshLambertMaterial({ color: 0x8b9099 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd9822b });
  const bladeMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), dark);
  const armGeo = new THREE.BoxGeometry(1.1, 0.05, 0.07);
  const arm1 = new THREE.Mesh(armGeo, grey);
  const arm2 = new THREE.Mesh(armGeo, grey);
  arm1.rotation.y = Math.PI / 4;
  arm2.rotation.y = -Math.PI / 4;
  // Orange nose marker so the heading (-Z) is visible from behind and above.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.16), accent);
  nose.position.set(0, 0, -0.22);
  group.add(body, arm1, arm2, nose);

  const motorGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10);
  const bladeGeo = new THREE.BoxGeometry(0.46, 0.012, 0.05);
  const rotors = [];
  const o = 0.39;
  [[-o, -o, 1], [o, -o, -1], [-o, o, -1], [o, o, 1]].forEach(([x, z, dir]) => {
    const motor = new THREE.Mesh(motorGeo, dark);
    motor.position.set(x, 0.05, z);
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(x, 0.12, z);
    group.add(motor, blade);
    rotors.push({ blade, dir });
  });
  group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  scene.add(group);

  // Drone camera for the PIP: nose-mounted, yaw follows the drone, pitch is a separate gimbal angle.
  const pipCamera = new THREE.PerspectiveCamera(70, 254 / 140, 0.1, 400);
  pipCamera.rotation.order = 'YXZ';
  let gimbalPitch = -10; // degrees, DSL look(pitch) range is -90..30

  let spinRate = 0;   // rad/s, smoothed
  let spin = 0;

  return {
    group,
    pipCamera,
    setGimbalPitch(deg) { gimbalPitch = Math.max(-90, Math.min(30, deg)); },
    // alpha (0..1) interpolates between the previous and current fixed physics step.
    update(f, alpha, dt) {
      const p = f.prevPos, c = f.pos;
      group.position.set(
        p[0] + (c[0] - p[0]) * alpha,
        p[1] + (c[1] - p[1]) * alpha,
        p[2] + (c[2] - p[2]) * alpha,
      );
      const yaw = f.prevYaw + (f.yaw - f.prevYaw) * alpha;
      const pitch = f.prevPitch + (f.pitch - f.prevPitch) * alpha;
      const roll = f.prevRoll + (f.roll - f.prevRoll) * alpha;
      // Convention conversion lives here only:
      // sim yaw is clockwise from above, Three rotation.y is counter-clockwise -> negate.
      // sim roll (+ = right side down) is a rotation about -Z -> negate for rotation.z.
      group.rotation.set(pitch * DEG, -yaw * DEG, -roll * DEG);

      const sy = Math.sin(yaw * DEG), cy = Math.cos(yaw * DEG);
      pipCamera.position.set(group.position.x + sy * 0.3, group.position.y + 0.02, group.position.z - cy * 0.3);
      pipCamera.rotation.set(gimbalPitch * DEG, -yaw * DEG, 0);

      const target = f.mode === 'landed' ? 0 : 70;
      spinRate += (target - spinRate) * (1 - Math.exp(-dt * 4));
      spin += spinRate * dt;
      for (let i = 0; i < rotors.length; i++) rotors[i].blade.rotation.y = spin * rotors[i].dir;
    },
  };
}
