import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sceneColliders, makeHeightSampler, sceneLimits } from '../src/terrain.js';
import { Flight } from '../src/flight.js';
import { STEP } from '../src/config.js';

// The office building has an atrium in the middle (x 1..9, z -38..-24 in world coordinates): the floors there must be open
// all the way from the ground to the roof, so the drone can fly down into it and out through the roof.
const meta = JSON.parse(fs.readFileSync(new URL('../public/scenes/s1_gedung_terbakar/scene.json', import.meta.url)));

test('atrium of the burning office is open from ground to roof', () => {
  const cols = sceneColliders(meta.colliders);
  for (const [x, z] of [[5, -31], [3, -26], [7, -35], [4, -36]]) {
    const hit = cols.filter((c) => c.min[0] - 0.5 <= x && x <= c.max[0] + 0.5 && c.min[2] - 0.5 <= z && z <= c.max[2] + 0.5 && c.max[1] > 0.8 && c.min[1] < 13.6);
    assert.equal(hit.length, 0, `column at ${x}, ${z} blocked by ${JSON.stringify(hit[0])}`);
  }
});

test('a drone really flies down the atrium and lands on the ground floor', () => {
  const sim = new Flight();
  sim.ground = makeHeightSampler(meta.height);
  sim.limits = sceneLimits(meta);
  const cols = sceneColliders(meta.colliders);
  sim.pos = [5, 13, -31]; sim.prevPos = [5, 13, -31];
  sim.takeoff(1); // flying mode at the starting height
  sim.mode = 'flying';
  let minY = 99;
  for (let t = 0; t < 10; t += STEP) { sim.applyAction({ climb: -1 }); sim.step(STEP, cols); minY = Math.min(minY, sim.pos[1]); }
  assert.ok(minY < 2.5, `the drone stopped at y=${minY.toFixed(2)}, something blocks the shaft`);
});
