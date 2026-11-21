import test from 'node:test';
import assert from 'node:assert/strict';
import { Flight } from '../src/flight.js';
import { STEP, PHYS } from '../src/config.js';

function run(f, seconds, boxes = []) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) f.step(STEP, boxes);
}

function flying(alt = 5) {
  const f = new Flight();
  f.takeoff(alt);
  run(f, 6);
  assert.equal(f.mode, 'flying');
  return f;
}

test('takeoff reaches the target altitude and switches to flying', () => {
  const f = new Flight();
  assert.ok(f.takeoff(5));
  run(f, 6);
  assert.equal(f.mode, 'flying');
  assert.ok(Math.abs(f.pos[1] - 5) < 0.15, `alt=${f.pos[1]}`);
  run(f, 2);
  assert.ok(Math.abs(f.vel[1]) < 0.05);
});

test('hover: zero input stops horizontal drift', () => {
  const f = flying();
  f.applyAction({ forward: 1 });
  run(f, 2);
  assert.ok(f.telemetry().speed > 3);
  f.applyAction({});
  run(f, 3);
  assert.ok(f.telemetry().speed < 0.05, `speed=${f.telemetry().speed}`);
});

test('movement is not instant: acceleration and damping', () => {
  const f = flying();
  f.applyAction({ forward: 1 });
  f.step(STEP);
  assert.ok(f.telemetry().speed < PHYS.maxSpeed * 0.1);
  run(f, 2);
  assert.ok(f.telemetry().speed > PHYS.maxSpeed * 0.9);
});

test('forward follows heading: yaw 0 goes -Z, yaw 90 goes +X', () => {
  let f = flying();
  f.applyAction({ forward: 1 });
  run(f, 1);
  assert.ok(f.pos[2] < -1 && Math.abs(f.pos[0]) < 0.01);

  f = flying();
  f.yaw = 90;
  f.applyAction({ forward: 1 });
  run(f, 1);
  assert.ok(f.pos[0] > 1 && Math.abs(f.pos[2]) < 0.01);
});

test('strafe right at yaw 0 goes +X; climb and descend change altitude', () => {
  const f = flying();
  f.applyAction({ strafe: 1 });
  run(f, 1);
  assert.ok(f.pos[0] > 1);
  f.applyAction({ climb: 1 });
  const y0 = f.pos[1];
  run(f, 1);
  assert.ok(f.pos[1] > y0 + 0.5);
  f.applyAction({ climb: -1 });
  run(f, 2);
  assert.ok(f.pos[1] < y0);
});

test('positive yaw action turns clockwise, rate is capped', () => {
  const f = flying();
  f.applyAction({ yaw: 1 });
  run(f, 2);
  assert.ok(f.yaw > 90 && f.yaw < 2 * PHYS.maxYawRate + 1, `yaw=${f.yaw}`);
});

test('drone leans into movement (nose down when moving forward)', () => {
  const f = flying();
  f.applyAction({ forward: 1 });
  run(f, 2);
  assert.ok(f.pitch < -10 && f.pitch >= -PHYS.tiltMax - 0.1);
  f.applyAction({ strafe: 1, forward: 0 });
  run(f, 2);
  assert.ok(f.roll > 10);
});

test('land: descends smoothly and ends landed with zero velocity', () => {
  const f = flying();
  f.applyAction({ forward: 1 });
  run(f, 1);
  assert.ok(f.land());
  run(f, 10);
  assert.equal(f.mode, 'landed');
  assert.equal(f.pos[1], 0);
  assert.equal(f.telemetry().speed, 0);
});

test('actions are ignored while landed; takeoff only from landed', () => {
  const f = new Flight();
  f.applyAction({ forward: 1, climb: 1 });
  run(f, 2);
  assert.deepEqual(f.pos, [0, 0, 0]);
  assert.ok(f.takeoff(3));
  assert.equal(f.takeoff(3), false);
});

test('collision: drone is pushed out of a building and the event counts once', () => {
  const box = { min: [-5, 0, -20], max: [5, 20, -10] };
  const f = flying(5);
  f.applyAction({ forward: 1 });
  run(f, 4, [box]);
  assert.ok(f.collisionCount === 1, `count=${f.collisionCount}`);
  assert.ok(f.pos[2] >= -10 + PHYS.radius - 1e-6, `z=${f.pos[2]}`);
});

test('map bounds clamp the position', () => {
  const f = flying(5);
  f.applyAction({ strafe: 1 });
  run(f, 20);
  assert.ok(f.pos[0] <= PHYS.mapHalf + 1e-9);
});

test('deterministic: same inputs give identical state', () => {
  const script = (f) => {
    f.takeoff(8);
    run(f, 5);
    f.applyAction({ forward: 1, yaw: 0.5 });
    run(f, 3);
    f.applyAction({ strafe: -1, climb: 0.3 });
    run(f, 3);
    f.land();
    run(f, 8);
  };
  const a = new Flight(), b = new Flight();
  script(a); script(b);
  assert.deepEqual(a.telemetry(), b.telemetry());
});
