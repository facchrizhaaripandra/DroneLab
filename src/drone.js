// Drone visual model and pose sync. The Blender model (public/models/drone.glb) is loaded in the
// background; the simple primitive model is shown until it arrives and stays as the fallback if it fails.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAM } from './camera-model.js';

const DEG = Math.PI / 180;
const SCORCH = new THREE.Color(0x2a1a14);
export const DRONE_MODEL_URL = '/models/drone.glb';
// The Blender model is a real 45 cm quadcopter. It is scaled so it matches the 0.5 m collision sphere
// and stays readable from the chase camera (about 1.25 m tip to tip, like the old primitive model).
export const DRONE_SCALE = 1.8;
const CLEARANCE = 0.166;              // m in the model: ground to body centre (drone_root.ground_clearance_m)
const PROP_NAMES = ['FL', 'FR', 'RL', 'RR']; // same order as the rotors array and damage.rotors

export function createDrone(scene, modelUrl = DRONE_MODEL_URL) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ'; // yaw, then pitch, then roll
  const prim = new THREE.Group(); // primitive model (until the .glb is loaded, or if it fails)
  group.add(prim);

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
  prim.add(body, arm1, arm2, nose);

  const motorGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10);
  const bladeGeo = new THREE.BoxGeometry(0.46, 0.012, 0.05);
  const rotors = [];
  const o = 0.39;
  [[-o, -o, 1], [o, -o, -1], [-o, o, -1], [o, o, 1]].forEach(([x, z, dir]) => {
    const motor = new THREE.Mesh(motorGeo, dark);
    motor.position.set(x, 0.05, z);
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(x, 0.12, z);
    prim.add(motor, blade);
    rotors.push({ blade, dir, flat: true });
  });
  group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  scene.add(group);

  // Drone camera for the PIP: nose-mounted, yaw follows the drone, pitch is a separate gimbal angle.
  const pipCamera = new THREE.PerspectiveCamera(CAM.vfov, CAM.aspect, 0.1, 400);
  pipCamera.rotation.order = 'YXZ';
  let gimbalPitch = -10; // degrees, DSL look(pitch) range is -90..30

  const spray = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x6ec6ff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
  spray.visible = false;
  group.add(spray);
  const bodyBase = dark.color.getHex();
  const health = [1, 1, 1, 1]; // rotor health, same order as the rotors array
  let camHealth = 1;

  let spinRate = 0;   // rad/s, smoothed
  let spin = 0;
  let lastDamage = null;
  let gimbalNode = null;
  const bodyMats = [];  // [material, original color] of the shell, darkened by body damage

  const applyRotor = (i) => {
    const h = health[i], r = rotors[i].blade;
    r.visible = h > 0.05;                                  // a broken blade is gone
    const s = h > 0.65 ? 1 : 0.5 + h * 0.5;                // a damaged blade is shorter and bent
    if (rotors[i].flat) r.scale.x = s; else r.scale.set(s, 1, s);
    r.rotation.z = h > 0.65 ? 0 : (1 - h) * 0.5;
  };
  const applyBody = (b) => {
    dark.color.setHex(b > 0.65 ? bodyBase : b > 0.3 ? 0x4a3b32 : 0x5a2f2a); // scorched body
    const k = b > 0.65 ? 0 : b > 0.3 ? 0.55 : 0.85;
    for (const [m, c] of bodyMats) m.color.copy(c).lerp(SCORCH, k);
  };

  // Swap in the Blender model when it has loaded. Rotor spin, damage and gimbal move its parts.
  new GLTFLoader().load(modelUrl, (gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(DRONE_SCALE);
    model.position.y = CLEARANCE * DRONE_SCALE; // skids on the ground when the sim altitude is 0
    const props = PROP_NAMES.map((k) => model.getObjectByName(`drone_propeller_${k}`));
    if (props.some((p) => !p)) { console.warn('drone.glb: propeller nodes missing, keeping the simple model'); return; }
    props.forEach((p, i) => {
      const cw = (p.userData && p.userData.spin_dir) === 'CW';
      rotors[i] = { blade: p, dir: cw ? -1 : 1, flat: false }; // CW seen from above = negative turn about +Y
    });
    gimbalNode = model.getObjectByName('drone_gimbal_camera_pitch') || null;
    model.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true;
      if (/body|shell/.test(m.name) && m.material && m.material.color) {
        m.material = m.material.clone();
        bodyMats.push([m.material, m.material.color.clone()]);
      }
    });
    prim.visible = false;
    group.add(model);
    if (lastDamage) for (let i = 0; i < 4; i++) applyRotor(i);
    if (lastDamage) applyBody(lastDamage.body);
  }, undefined, (err) => console.warn('drone.glb not loaded, using the simple model:', err && err.message ? err.message : err));

  return {
    group,
    pipCamera,
    // Call when damage changes (and with a fresh DroneDamage on reset). Allocates nothing per frame.
    setDamage(d) {
      lastDamage = d;
      for (let i = 0; i < 4; i++) { health[i] = d.rotors[i]; applyRotor(i); }
      camHealth = d.camera;
      applyBody(d.body);
    },
    // PIP feed is dead when the camera is broken.
    get cameraOk() { return camHealth > 0.05; },
    setGimbalPitch(deg) { gimbalPitch = Math.max(-90, Math.min(30, deg)); },
    get gimbal() { return gimbalPitch; },
    // Spray cone under the drone (M3). One mesh, shown while spraying.
    setSpray(on) { spray.visible = on; },
    setSprayWidth(w) { spray.scale.set(w, 1, w); },
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
      pipCamera.rotation.set(gimbalPitch * DEG, -yaw * DEG, -roll * DEG); // the picture tilts with the drone, like the horizon score assumes

      if (gimbalNode) gimbalNode.rotation.x = gimbalPitch * DEG; // the camera on the model tilts with the gimbal
      if (spray.visible) { spray.scale.y = Math.max(0.5, group.position.y); spray.position.y = -spray.scale.y / 2; } // apex at the drone, base on the ground
      const target = f.mode === 'landed' ? 0 : 70;
      spinRate += (target - spinRate) * (1 - Math.exp(-dt * 4));
      spin += spinRate * dt;
      for (let i = 0; i < rotors.length; i++) rotors[i].blade.rotation.y = spin * rotors[i].dir * (0.4 + 0.6 * health[i]);
    },
  };
}
