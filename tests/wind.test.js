import test from 'node:test';
import assert from 'node:assert/strict';
import { Flight } from '../src/flight.js';
import { STEP, PHYS } from '../src/config.js';
import { randomWind, windText } from '../src/sky.js';

const fly = (sim, secs, a = {}) => { for (let t = 0; t < secs; t += STEP) { sim.applyAction(a); sim.step(STEP, []); } };
const hover = (wind) => {
  const sim = new Flight(); sim.wind = wind;
  sim.takeoff(5); fly(sim, 4);
  const x0 = sim.pos[0];
  fly(sim, 20);
  return { sim, drift: sim.pos[0] - x0 };
};

test('moderate wind: GPS hover holds position (only small gust drift) and the body leans into the wind', () => {
  const { sim, drift } = hover({ speed: 6, dir: 90, gust: 0.3, seed: 1 }); // blows toward +x
  assert.ok(Math.abs(drift) < 15, `drift ${drift}`);
  assert.ok(Math.abs(sim.leanRoll) > 3, 'leans into the wind');
  assert.ok(Math.abs(sim.roll) < 3, 'camera roll stays level (gimbal)');
});

test('wind stronger than the drone can resist pushes it away', () => {
  const calm = hover({ speed: 6, dir: 90, gust: 0, seed: 0 }).drift;
  const storm = hover({ speed: PHYS.windResist + 3, dir: 90, gust: 0, seed: 0 }).drift;
  assert.ok(Math.abs(calm) < 1);
  assert.ok(storm > 40, `storm drift ${storm}`);
});

test('flying into the wind is slower than flying with it', () => {
  const run = (yaw) => { const s = new Flight(); s.wind = { speed: 8, dir: 0, gust: 0, seed: 0 }; s.yaw = yaw; s.takeoff(5); fly(s, 4); const z0 = s.pos[2]; fly(s, 5, { forward: 1 }); return Math.abs(s.pos[2] - z0); };
  assert.ok(run(180) < run(0) * 0.8); // wind blows toward -z (yaw 0 = north/-z)
});

test('random wind differs per start and stays in a realistic range', () => {
  const ws = Array.from({ length: 300 }, () => randomWind());
  assert.ok(ws.every((w) => w.speed >= 0.5 && w.speed <= 12 && w.dir >= 0 && w.dir < 360));
  assert.ok(new Set(ws.map((w) => w.dir)).size > 100);
  const mean = ws.reduce((s, w) => s + w.speed, 0) / ws.length;
  assert.ok(mean > 2 && mean < 5.5, `mean ${mean}`);
  assert.match(windText({ speed: 4, dir: 0 }), /dari selatan/);
});
