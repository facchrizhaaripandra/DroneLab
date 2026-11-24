import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { instanceRepeats } from '../src/realworld.js';

test('repeated meshes become one InstancedMesh with the same world placement', () => {
  const root = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(geo, mat); m.name = `tree_cemara_${i}`; m.position.set(i * 10, 2, -i); root.add(m); }
  const lone = new THREE.Mesh(new THREE.BoxGeometry(), mat); lone.name = 'hut'; root.add(lone);
  assert.equal(instanceRepeats(root), 6);
  const inst = root.children.find((c) => c.isInstancedMesh);
  assert.equal(inst.count, 6);
  assert.equal(inst.name, 'tree_cemara');
  const m = new THREE.Matrix4(); inst.getMatrixAt(3, m);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(m).toArray(), [30, 2, -3]);
  assert.ok(root.children.includes(lone));
  assert.equal(instanceRepeats(root), 0); // second call (scene reused for "Ulangi") changes nothing
});
