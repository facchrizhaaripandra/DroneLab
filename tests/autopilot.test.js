import test from 'node:test';
import assert from 'node:assert/strict';
import { Flight } from '../src/flight.js';
import { Autopilot } from '../src/autopilot.js';
import { STEP } from '../src/config.js';

function flyTo(f, x, y, z) {
  f.pos[0] = x; f.pos[1] = y; f.pos[2] = z;
  f.mode = 'flying';
}

test('return home: climbs over a 30 m building, flies to the pad, lands, no collision', () => {
  const f = new Flight();
  flyTo(f, 50, 6, -40);
  const wall = { min: [10, 0, -30], max: [30, 30, -10] }; // tall building between start and home
  const ap = new Autopilot();
  assert.ok(ap.start(f));
  for (let i = 0; i < 60 * 90 && (ap.active || f.mode !== 'landed'); i++) {
    ap.step(f);
    f.step(STEP, [wall]);
  }
  assert.equal(f.mode, 'landed');
  assert.ok(Math.hypot(f.pos[0], f.pos[2]) < 3, `landed ${Math.hypot(f.pos[0], f.pos[2]).toFixed(2)} m from the pad`);
  assert.equal(f.collisionCount, 0);
});

test('autopilot only starts while flying, and cancel() stops it', () => {
  const f = new Flight();
  const ap = new Autopilot();
  assert.equal(ap.start(f), false);
  flyTo(f, 5, 5, 5);
  assert.ok(ap.start(f));
  ap.cancel();
  assert.equal(ap.active, false);
});
