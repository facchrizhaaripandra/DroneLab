import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeWater, missionWaterZones, partDepths } from '../src/water.js';
import { Flight } from '../src/flight.js';
import { DroneDamage } from '../src/damage.js';
import { STEP } from '../src/config.js';
import { makeHeightSampler, sceneLimits, sceneColliders } from '../src/terrain.js';
import { carveBasins } from '../scripts/water_grid.mjs';

const fly = (sim, secs, action = {}, world = []) => { for (let t = 0; t < secs; t += STEP) { sim.applyAction(action); sim.step(STEP, world); } };
function simOver(zones, y = 6) {
  const sim = new Flight();
  sim.damage = new DroneDamage();
  sim.water = makeWater({ zones });
  sim.mode = 'flying'; sim.pos = [0, y, 0];
  return sim;
}

test('water grid and zones give surface and bed, dry land gives NaN', () => {
  const w = makeWater({ grid: { x0: 0, z0: 0, cell: 1, nx: 4, nz: 2, runs: [[1, 1, 2, -1, -1.5]] }, zones: [{ circle: [50, 50, 5], surf: 0.06, depth: 3 }] });
  assert.equal(w.surface(1.5, 1.5), 2); assert.equal(w.bed(2.5, 1.5), -1.5);
  assert.ok(Number.isNaN(w.surface(0.5, 0.5)));
  assert.ok(Math.abs(w.bed(51, 50) - -2.94) < 1e-6);
  const zones = missionWaterZones({ landmarks: [{ kind: 'pool', x: 0, z: 0, w: 12, d: 7 }], river: { min: [10, -5], max: [14, 5] } });
  assert.equal(zones.length, 2);
});

test('only the parts under the surface count as wet', () => {
  const w = makeWater({ zones: [{ rect: [-10, -10, 10, 10], surf: 0.25, depth: 0.25 }] });
  const out = { rotors: [0, 0, 0, 0], camera: 0, body: 0 };
  partDepths(w, [0, 0, 0], 0, 0, 0, out); // standing on the bottom of 25 cm of water
  assert.ok(out.camera > 0 && out.body === 0 && out.rotors.every((d) => d === 0));
  partDepths(w, [0, 0.1, 0], 0, 0, 60, out); // rolled hard right: the right rotors dip, the left ones stay dry
  assert.ok(out.rotors[1] > 0 && out.rotors[3] > 0 && out.rotors[0] === 0 && out.rotors[2] === 0);
});

test('flying down into deep water: the drone drowns and sinks to the bottom', () => {
  const sim = simOver([{ circle: [0, 0, 20], surf: 0, depth: 3 }]);
  const events = []; sim.onWater = (k) => events.push(k);
  fly(sim, 6, { climb: -1 });
  assert.ok(sim.drowned && sim.mode === 'crashed', `mode ${sim.mode}`);
  assert.equal(sim.damage.body, 0);
  assert.deepEqual(events, ['splash', 'drown']);
  fly(sim, 10);
  assert.ok(Math.abs(sim.pos[1] - -3) < 0.05, `rests on the bed, y=${sim.pos[1]}`);
});

test('landing in shallow water ruins only the camera; land is not water', () => {
  const sim = simOver([{ rect: [-10, -10, 10, 10], surf: 0.25, depth: 0.25 }], 3);
  sim.land();
  fly(sim, 10);
  assert.equal(sim.mode, 'landed'); assert.ok(!sim.drowned);
  assert.ok(sim.damage.camera <= 0.05, `camera ${sim.damage.camera}`);
  assert.deepEqual(sim.damage.rotors, [1, 1, 1, 1]);
  const dry = simOver([{ rect: [50, 50, 60, 60], surf: 0.25, depth: 2 }], 3);
  dry.land(); fly(dry, 10);
  assert.equal(dry.mode, 'landed'); assert.equal(dry.damage.camera, 1); assert.equal(dry.pos[1], 0);
});

test('a dipped propeller is damaged, the rest of the drone is not', () => {
  const d = new DroneDamage();
  const ch = d.soak([0, 1, 0, 0], 0);
  assert.equal(d.rotors[1], 0); assert.equal(d.rotors[0], 1); assert.equal(d.camera, 1);
  assert.equal(ch[0].cause, 'water'); assert.equal(ch[0].index, 1);
});

test('realistic maps: the mountain lake drowns the drone, the rice paddy does not', () => {
  const load = (id) => JSON.parse(fs.readFileSync(new URL(`../public/scenes/${id}/scene.json`, import.meta.url)));
  const lake = load('s4_gunung_danau'), w = makeWater({ grid: lake.water });
  // the deepest cell of the lake
  let best = null;
  for (const r of lake.water.runs) for (let k = 3; k < r.length; k++) if (!best || r[2] - r[k] > best[2]) best = [lake.water.x0 + r[1] + k - 3 + 0.5, lake.water.z0 + r[0] + 0.5, r[2] - r[k]];
  assert.ok(best[2] > 2, `lake depth ${best[2]}`);
  const sim = new Flight(); sim.damage = new DroneDamage(); sim.water = w;
  sim.ground = makeHeightSampler(lake.height); sim.limits = sceneLimits(lake);
  sim.mode = 'flying'; sim.pos = [best[0], w.surface(best[0], best[1]) + 4, best[1]];
  fly(sim, 8, { climb: -1 }, sceneColliders(lake.colliders));
  assert.ok(sim.drowned, `y=${sim.pos[1]} surf=${w.surface(best[0], best[1])}`);

  const paddy = load('s5_sawah');
  for (const r of paddy.water.runs) for (let k = 3; k < r.length; k++) assert.ok(r[2] - r[k] < 0.3, 'paddy and canals are shallow');
});

test('a pool basin box at the water line is opened down to the pool floor', () => {
  const { colliders, carved } = carveBasins([[-10, -3, -10, 10, 0, 10]], [{ min: [-2, -2], max: [2, 2], surf: 0.02, bed: -1.4 }]);
  assert.equal(carved, 1);
  assert.equal(colliders.length, 5);
  const inside = colliders.find((c) => c[0] === -2 && c[2] === -2);
  assert.equal(inside[4], -1.4);
  assert.equal(carveBasins(colliders, [{ min: [-2, -2], max: [2, 2], surf: 0.02, bed: -1.4 }]).carved, 0); // run twice: no change
});
