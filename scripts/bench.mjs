// Cost and allocation check for the per-step code (physics, script runner, mission tracker).
//   npm run bench      (node --expose-gc scripts/bench.mjs)
// Heap growth here means garbage per step; the loop code must stay near zero.
import { Flight } from '../src/flight.js';
import { Commander } from '../src/commander.js';
import { Autopilot } from '../src/autopilot.js';
import { MissionRun } from '../src/missions.js';
import { Battery } from '../src/battery.js';
import { makeMissionConfig } from '../src/worldconfig.js';
import { STEP } from '../src/config.js';

const cfg = makeMissionConfig('patroli', 42);
const boxes = [...cfg.buildings, ...cfg.obstacles].map((b) => ({ min: [b.x - b.w / 2, 0, b.z - b.d / 2], max: [b.x + b.w / 2, b.h, b.z + b.d / 2] }));
const N = 600000; // 10 000 s of flight

function measure(name, fn) {
  globalThis.gc?.();
  const h0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  globalThis.gc?.();
  const grow = (process.memoryUsage().heapUsed - h0) / 1024;
  console.log(`${name.padEnd(34)} ${((ms * 1000) / N).toFixed(3)} us/step   heap ${grow >= 0 ? '+' : ''}${grow.toFixed(0)} KB${globalThis.gc ? '' : ' (no gc: run with --expose-gc)'}`);
}

measure('Flight.step + applyAction (orbit)', () => {
  const f = new Flight();
  f.takeoff(10);
  const a = { yaw: 0.3, climb: 0, strafe: 0, forward: 1 };
  for (let i = 0; i < N; i++) { f.applyAction(a); f.step(STEP, boxes); if (f.pos[0] * f.pos[0] + f.pos[2] * f.pos[2] > 8000) f.pos[0] = f.pos[2] = 0; }
});

measure('Commander.step (repeat loop script)', () => {
  const f = new Flight();
  const c = new Commander({ autopilot: new Autopilot(), detect: () => false, battery: () => 100, act: () => null, setGimbal() {} });
  c.onLog = () => {};
  c.load('takeoff(10); repeat(20) { move(maju, 10); rotate(90); } land();');
  for (let i = 0; i < N; i++) {
    if (c.state !== 'running') { c.logs.length = 0; c.start(); }
    c.step(STEP, f); f.step(STEP, []);
  }
});

measure('MissionRun.step + Battery.step', () => {
  const f = new Flight();
  f.takeoff(10);
  const run = new MissionRun('patroli', cfg);
  const b = new Battery(cfg.battery);
  for (let i = 0; i < N; i++) { f.step(STEP, []); b.step(STEP, true, 3, 0); run.step(STEP, f, 100, 0, 5); }
});
