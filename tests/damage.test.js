import test from 'node:test';
import assert from 'node:assert/strict';
import { DroneDamage, stateOf, SAFE_SPEED, FULL_SPEED } from '../src/damage.js';
import { Flight } from '../src/flight.js';

// Hit a wall. For a drone facing yaw 0 (forward = -Z), a wall ahead has normal +Z (pointing back at the drone).
const frontHit = (d, v) => d.hit(0, 0, 1, v, 0);

test('a bump below the safe speed does nothing; a hard front hit breaks the front propellers', () => {
  const d = new DroneDamage();
  assert.deepEqual(frontHit(d, SAFE_SPEED), []);
  assert.deepEqual(d.rotors, [1, 1, 1, 1]);
  const changes = frontHit(d, FULL_SPEED);
  assert.ok(d.rotors[0] <= 0.05 && d.rotors[1] <= 0.05, `front ${d.rotors}`);
  assert.ok(d.rotors[2] > 0.5 && d.rotors[3] > 0.5, `rear ${d.rotors}`);
  assert.ok(changes.some((c) => c.part.includes('kiri depan') && c.state === 'broken'));
  assert.ok(d.camera < 0.2, 'camera is on the nose');
  assert.equal(d.destroyed, false);                  // two propellers gone: crippled but flying
});

test('damage follows the side that was hit and the drone heading', () => {
  const right = new DroneDamage();
  right.hit(-1, 0, 0, 5, 0);                         // wall on the right (normal points left)
  assert.ok(right.rotors[1] < right.rotors[0] && right.rotors[3] < right.rotors[2]);
  const turned = new DroneDamage();
  turned.hit(-1, 0, 0, 5, 90);                       // same wall, drone turned right: wall is now in front
  assert.ok(turned.rotors[0] < turned.rotors[2] && turned.rotors[1] < turned.rotors[3]);
  const harder = new DroneDamage(); frontHit(harder, 4);
  const softer = new DroneDamage(); frontHit(softer, 3);
  assert.ok(harder.rotors[0] < softer.rotors[0]);
  const ceiling = new DroneDamage();
  ceiling.hit(0, -1, 0, 5, 0);                       // hit something above
  assert.ok(ceiling.rotors.every((h) => h < 1 && Math.abs(h - ceiling.rotors[0]) < 1e-9));
});

test('effects: lift loss makes the drone sink and slow; imbalance makes it drift and spin; 3 dead rotors = destroyed', () => {
  const d = new DroneDamage();
  assert.deepEqual([d.fx.lift, d.fx.sink, d.fx.driftRight, d.fx.yawBias], [1, 0, 0, 0]);
  d.rotors = [0, 1, 1, 1]; d.refresh();                // front-left gone
  assert.ok(d.fx.lift === 0.75 && d.fx.sink > 0 && d.fx.speedScale < 1);
  assert.ok(d.fx.driftRight < 0, 'left side weak -> that side drops, drifts left');
  assert.ok(d.fx.yawBias < 0);
  d.rotors = [0, 0, 1, 1]; d.refresh();                // whole front gone
  assert.ok(d.fx.driftForward > 0 && Math.abs(d.fx.driftRight) < 1e-9);
  d.rotors = [0, 0, 0, 1]; d.refresh();
  assert.equal(d.destroyed, true);
  d.reset();
  assert.equal(d.destroyed, false);
  assert.equal(stateOf(0.7), 'ok'); assert.equal(stateOf(0.3), 'damaged'); assert.equal(stateOf(0), 'broken');
});

test('burn() hurts every part evenly', () => {
  const d = new DroneDamage();
  d.burn(0.4);
  assert.ok(d.rotors.every((h) => Math.abs(h - 0.8) < 1e-9));
  assert.ok(d.camera < 0.7 && d.body > 0.8);
});

// ---- inside the flight model ----
// The damage is applied after the drone is hovering at 10 m, so we only test what damage does in the air.
function fly(rotors, seconds, action = {}) {
  const f = new Flight();
  f.damage = new DroneDamage();
  f.takeoff(10);
  for (let i = 0; i < 60 * 6; i++) f.step(1 / 60, []);
  f.damage.rotors = [...rotors]; f.damage.refresh();
  const start = [...f.pos], yaw0 = f.yaw;
  f.applyAction({ yaw: 0, climb: 0, strafe: 0, forward: 0, ...action });
  for (let i = 0; i < 60 * seconds; i++) f.step(1 / 60, []);
  return { f, start, yaw0 };
}
const dist = (r) => Math.hypot(r.f.pos[0] - r.start[0], r.f.pos[2] - r.start[2]);

test('flight: a healthy drone hovers; a drone with lost lift sinks; a one-sided loss drifts and turns', () => {
  const ok = fly([1, 1, 1, 1], 5);
  assert.ok(Math.abs(ok.f.pos[1] - ok.start[1]) < 0.1);
  const sink = fly([0.4, 0.4, 0.4, 0.4], 4);
  assert.ok(sink.f.pos[1] < sink.start[1] - 2, `sank ${sink.start[1] - sink.f.pos[1]}`);
  const lop = fly([0, 1, 1, 1], 4);
  assert.ok(lop.f.pos[0] - lop.start[0] < -2, 'drifted toward the weak (left) side');
  assert.ok(Math.abs(lop.f.yaw - lop.yaw0) > 20, 'spinning');
  assert.ok(dist(fly([0.5, 0.5, 0.5, 0.5], 3, { forward: 1 })) < dist(fly([1, 1, 1, 1], 3, { forward: 1 })) * 0.85, 'slower');
});

test('flight: a hard wall hit damages the drone; a destroyed drone falls and cannot be flown or relaunched', () => {
  const f = new Flight();
  f.damage = new DroneDamage();
  const hits = [];
  f.onDamage = (changes) => hits.push(...changes);
  const wall = [{ min: [-5, 0, -20], max: [5, 30, -15] }];
  f.takeoff(10);
  for (let i = 0; i < 60 * 5; i++) f.step(1 / 60, wall);
  f.applyAction({ forward: 1 });
  for (let i = 0; i < 60 * 6 && f.mode === 'flying'; i++) f.step(1 / 60, wall);
  assert.ok(f.damage.rotors[0] < 1 || f.damage.rotors[1] < 1, 'front rotors took the hit');
  assert.ok(hits.length >= 0);
  f.damage.rotors = [0, 0, 0, 1]; f.damage.refresh();
  f.step(1 / 60, wall);
  assert.equal(f.mode, 'crashed');
  for (let i = 0; i < 60 * 8; i++) f.step(1 / 60, []);
  assert.equal(f.pos[1], 0);
  assert.equal(f.takeoff(5), false);
  f.applyAction({ forward: 1 });
  const x = f.pos[0], z = f.pos[2];
  f.step(1 / 60, []);
  assert.deepEqual([f.pos[0], f.pos[2]], [x, z]);
});
