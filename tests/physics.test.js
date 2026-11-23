import test from 'node:test';
import assert from 'node:assert/strict';
import { AabbPhysics, createRapierPhysics } from '../src/physics.js';

const wall = { min: [5, 0, -5], max: [6, 10, 5] };

// A tiny stand-in for the Rapier module: one controller, cuboid colliders, ball mover.
function fakeRapier({ throwOn = null } = {}) {
  const calls = [];
  const colliders = [];
  const R = {
    calls,
    RigidBodyDesc: { kinematicPositionBased: () => ({ setTranslation() { return this; } }) },
    ColliderDesc: {
      ball: (r) => ({ kind: 'ball', r, setTranslation() { return this; } }),
      cuboid: (hx, hy, hz) => ({ kind: 'box', hx, hy, hz, setTranslation(x, y, z) { this.t = [x, y, z]; return this; } }),
    },
    Ray: class { constructor(o, d) { this.o = o; this.d = d; } },
    World: class {
      constructor() {}
      createRigidBody() { return {}; }
      createCollider(desc) {
        if (throwOn === 'collider') throw new Error('boom');
        const c = { desc, setTranslation(p) { this.p = p; } };
        if (desc.kind === 'box') colliders.push(desc);
        calls.push('collider:' + desc.kind);
        return c;
      }
      removeCollider(c) { const i = colliders.indexOf(c.desc); if (i >= 0) colliders.splice(i, 1); calls.push('remove'); }
      createCharacterController() {
        let moved = { x: 0, y: 0, z: 0 }, n = 0;
        return {
          computeColliderMovement(col, d) {
            moved = { ...d }; n = 0;
            for (const b of colliders) {
              const minX = b.t[0] - b.hx;
              const edge = minX - col.desc.r; // wall face minus ball radius
              if (col.p.x + d.x > edge && col.p.x <= edge) { moved.x = Math.max(0, edge - col.p.x); n++; }
            }
          },
          computedMovement: () => moved,
          numComputedCollisions: () => n,
        };
      }
      castRay(ray, max) {
        for (const b of colliders) {
          const t = (b.t[0] - b.hx - ray.o.x) / ray.d.x;
          if (t >= 0 && t <= max) return { timeOfImpact: t };
        }
        return null;
      }
      step() { calls.push('step'); }
    },
  };
  return R;
}

test('aabb: resolve pushes out and reports contact speed', () => {
  const p = new AabbPhysics();
  p.setStatic([wall]);
  const pos = [4.6, 2, 0], vel = [3, 0, 0], c = {};
  assert.equal(p.resolve([4.4, 2, 0], pos, vel, 0.5, c), true);
  assert.ok(pos[0] <= 4.5 + 1e-9);
  assert.equal(vel[0], 0);
  assert.ok(Math.abs(c.speed - 3) < 1e-9);
  assert.equal(c.nx, -1);
});

test('aabb: add adds a collider; raycast returns distance or -1', () => {
  const p = new AabbPhysics();
  p.setStatic([]);
  assert.equal(p.raycast([0, 2, 0], [1, 0, 0], 20), -1);
  p.add({ min: [4, 0, -1], max: [6, 3, 1] });
  const d = p.raycast([0, 1, 0], [1, 0, 0], 20);
  assert.ok(Math.abs(d - 4) < 1e-9); // box spans x 4..6
  assert.equal(p.raycast([0, 1, 0], [1, 0, 0], 2), -1);
});

test('rapier adapter: blocks movement, derives normal and speed', async () => {
  const R = fakeRapier();
  const p = createRapierPhysics(R);
  p.setStatic([wall]);
  const pos = [4.6, 2, 0], vel = [3, 0, 0], c = {};
  const hit = p.resolve([4.4, 2, 0], pos, vel, 0.5, c);
  assert.equal(hit, true);
  assert.ok(Math.abs(pos[0] - 4.5) < 1e-6);
  assert.equal(vel[0], 0);
  assert.ok(Math.abs(c.speed - 3) < 1e-6);
  assert.ok(c.nx < -0.99);
  assert.equal(p.kind, 'rapier');
});

test('rapier adapter: free movement is not a hit', () => {
  const p = createRapierPhysics(fakeRapier());
  p.setStatic([wall]);
  const pos = [1.1, 2, 0], vel = [3, 0, 0], c = {};
  assert.equal(p.resolve([1, 2, 0], pos, vel, 0.5, c), false);
  assert.equal(c.speed, 0);
  assert.ok(Math.abs(pos[0] - 1.1) < 1e-9);
});

test('rapier adapter: setStatic replaces old colliders; raycast works', () => {
  const R = fakeRapier();
  const p = createRapierPhysics(R);
  p.setStatic([wall]);
  p.setStatic([wall]);
  assert.equal(R.calls.filter((x) => x === 'remove').length, 1);
  assert.ok(Math.abs(p.raycast([0, 1, 0], [1, 0, 0], 20) - 5) < 1e-9);
  assert.equal(p.raycast([0, 1, 0], [1, 0, 0], 2), -1);
});

test('rapier adapter: any exception falls back to AABB for good', () => {
  const R = fakeRapier({ throwOn: 'collider' });
  const p = createRapierPhysics(R);
  p.setStatic([wall]);               // throws inside, must not escape
  assert.equal(p.kind, 'aabb');
  const pos = [4.6, 2, 0], vel = [3, 0, 0];
  assert.equal(p.resolve([4.4, 2, 0], pos, vel, 0.5, {}), true); // AABB still knows the wall
  assert.equal(vel[0], 0);
});
