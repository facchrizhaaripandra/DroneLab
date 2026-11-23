// Realistic scenes: heightfield sampler, collider filter and Flight on uneven ground with scene limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHeightSampler, sceneColliders, sceneLimits } from '../src/terrain.js';
import { Flight } from '../src/flight.js';
import { STEP } from '../src/config.js';

// 3 x 3 grid, cell 10 m, starting at (-10, -10): a slope that rises 1 m per meter along +X.
const H = { x0: -10, z0: -10, cell: 10, nx: 3, nz: 3, data: [0, 10, 20, 0, 10, 20, 0, 10, 20] };

test('height sampler is bilinear and clamps outside the grid', () => {
  const g = makeHeightSampler(H);
  assert.equal(g(-10, -10), 0);
  assert.equal(g(0, 0), 10);
  assert.ok(Math.abs(g(5, 3) - 15) < 1e-6);
  assert.equal(g(500, 0), 20);   // past the edge: edge value
  assert.equal(g(-500, 0), 0);
  assert.equal(makeHeightSampler(null)(3, 4), 0);
});

test('thin colliders are dropped, the rest keep min/max', () => {
  const c = sceneColliders([[0, 0, 0, 1, 0.1, 1], [0, 0, 0, 2, 3, 2]]);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0], { min: [0, 0, 0], max: [2, 3, 2] });
});

function fly(sim, seconds, action) {
  for (let t = 0; t < seconds; t += STEP) { if (action) sim.applyAction(action); sim.step(STEP, []); }
}

test('takeoff, climb a slope, land on raised ground', () => {
  const sim = new Flight();
  sim.ground = makeHeightSampler(H);
  sim.pos = [0, 10, 0]; sim.prevPos = [0, 10, 0];
  assert.ok(sim.takeoff(5));
  fly(sim, 6);
  assert.equal(sim.mode, 'flying');
  assert.ok(Math.abs(sim.pos[1] - 15) < 0.2, `hover 5 m above the ground, got ${sim.pos[1]}`);
  // Fly right (+X) up the slope with a small forward speed: the drone never goes under the terrain.
  sim.yaw = 90;
  for (let t = 0; t < 3; t += STEP) { sim.applyAction({ forward: 0.2 }); sim.step(STEP, []); assert.ok(sim.pos[1] >= sim.groundY() - 1e-6); }
  sim.applyAction({});
  fly(sim, 1);
  sim.land();
  fly(sim, 25);
  assert.equal(sim.mode, 'landed');
  assert.ok(Math.abs(sim.pos[1] - sim.groundY()) < 0.05);
  assert.ok(sim.pos[1] > 10, 'landed on the higher part of the slope');
});

test('scene limits clamp the map and the ceiling follows the ground', () => {
  const sim = new Flight();
  sim.ground = () => 100;
  sim.limits = sceneLimits({ bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, maxAgl: 20 });
  sim.pos = [0, 100, 0]; sim.prevPos = [0, 100, 0];
  sim.takeoff(5);
  fly(sim, 5);
  fly(sim, 12, { climb: 1, forward: 1 });
  assert.ok(sim.pos[1] <= 120 + 1e-6, `ceiling 20 m above ground, got ${sim.pos[1]}`);
  assert.ok(sim.pos[2] >= -5 - 1e-6, 'stopped at the map edge');
});

test('flat world is unchanged without ground/limits (lands at y = 0)', () => {
  const sim = new Flight();
  sim.takeoff(4); fly(sim, 5); sim.land(); fly(sim, 10);
  assert.equal(sim.mode, 'landed');
  assert.equal(sim.pos[1], 0);
});
