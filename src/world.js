// World builder. The world comes from a config (+ seed), never hard-coded in the render code,
// so the gateway can supply the same shape of config in later phases.
import * as THREE from 'three';
import { events } from './events.js';
import { makeDefaultConfig } from './worldconfig.js';

export { makeDefaultConfig };

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// One InstancedMesh per kind: few draw calls, shared geometry and material.
function instancedBoxes(list, material, colorFn) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length);
  list.forEach((b, i) => {
    _p.set(b.x, b.h / 2, b.z);
    _s.set(b.w, b.h, b.d);
    _m.compose(_p, _q.identity(), _s);
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, colorFn(b));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function buildWorld(scene, config) {
  scene.background = new THREE.Color(0xbfd8ee);
  scene.fog = new THREE.Fog(0xbfd8ee, 90, 320);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b7f5c, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 160;
  scene.add(sun, sun.target);

  // Ground + grid (the grid gives a sense of speed without textures).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(config.bounds * 2 + 200, config.bounds * 2 + 200),
    new THREE.MeshLambertMaterial({ color: 0x8aa07a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(config.bounds * 2, config.bounds, 0x6b7f5c, 0x7a8f6a);
  grid.position.y = 0.02;
  scene.add(grid);

  // Home pad at (0, 0, 0): disc + an "H".
  const padMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pad = new THREE.Mesh(new THREE.CircleGeometry(3, 32), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.03;
  scene.add(pad);
  const hMat = new THREE.MeshBasicMaterial({ color: 0xd9822b });
  const hGeo = new THREE.BoxGeometry(0.4, 0.02, 2);
  const hBar = new THREE.BoxGeometry(1.2, 0.02, 0.4);
  for (const [geo, x] of [[hGeo, -0.6], [hGeo, 0.6], [hBar, 0]]) {
    const m = new THREE.Mesh(geo, hMat);
    m.position.set(x, 0.05, 0);
    scene.add(m);
  }

  // Buildings and obstacles (instanced).
  const bMesh = instancedBoxes(config.buildings, new THREE.MeshLambertMaterial({ color: 0xffffff }),
    (b) => _c.setHSL(0.6, 0.1, 0.55 + b.shade * 0.25));
  const oMesh = instancedBoxes(config.obstacles, new THREE.MeshLambertMaterial({ color: 0xffffff }),
    () => _c.set(0xd9822b));
  scene.add(bMesh, oMesh);

  const colliders = [...config.buildings, ...config.obstacles].map((b) => ({
    min: [b.x - b.w / 2, 0, b.z - b.d / 2],
    max: [b.x + b.w / 2, b.h, b.z + b.d / 2],
  }));

  // Checkpoint rings: sensors only (no collider). One geometry, two shared materials.
  const ringGeo = new THREE.TorusGeometry(2.5, 0.14, 8, 32);
  const matIdle = new THREE.MeshBasicMaterial({ color: 0xf5b700 });
  const matDone = new THREE.MeshBasicMaterial({ color: 0x2ea66b });
  const rings = config.rings.map((g, index) => {
    const mesh = new THREE.Mesh(ringGeo, matIdle);
    mesh.position.set(g.x, g.y, g.z);
    mesh.lookAt(0, g.y, 0); // ring faces the center, so flying inward passes through it
    scene.add(mesh);
    return { mesh, index, x: g.x, y: g.y, z: g.z, passed: false };
  });

  const world = {
    colliders,
    rings,
    passedCount: 0,
    // Sensor check, called once per physics step.
    update(pos) {
      for (let i = 0; i < rings.length; i++) {
        const g = rings[i];
        if (g.passed) continue;
        const dx = pos[0] - g.x, dy = pos[1] - g.y, dz = pos[2] - g.z;
        if (dx * dx + dy * dy + dz * dz < 4) {
          g.passed = true;
          g.mesh.material = matDone;
          world.passedCount++;
          events.emit('zone_enter', { kind: 'checkpoint', index: g.index });
        }
      }
    },
    // Keeps the limited shadow area centered on the drone.
    followLight(px, pz) {
      sun.position.set(px + 40, 70, pz + 25);
      sun.target.position.set(px, 0, pz);
    },
  };
  return world;
}
