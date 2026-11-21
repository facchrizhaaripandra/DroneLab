import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSticks, keysToAction, padType, pickStickAxes, HoldTracker } from '../src/inputmap.js';
import { DEFAULT_KEYS, buildHints } from '../src/bindings.js';

const out = () => ({ yaw: 0, climb: 0, strafe: 0, forward: 0 });

test('deadzone 0.15: small stick values give exactly 0, full deflection gives 1', () => {
  let o = mapSticks([0.1, -0.1, 0.14, 0.05], {}, out());
  assert.deepEqual(o, { yaw: 0, climb: 0, strafe: 0, forward: 0 });
  o = mapSticks([1, 0, 0, -1], {}, out());
  assert.equal(o.yaw, 1);
  assert.equal(o.forward, 1);
  o = mapSticks([0.2, 0, 0, 0], {}, out()); // just past the deadzone: starts near 0, no jump
  assert.ok(o.yaw > 0 && o.yaw < 0.1);
});

test('diagonal stick is normalized radially (no faster than a cardinal push)', () => {
  const o = mapSticks([0, 0, 1, -1], {}, out());
  assert.ok(Math.hypot(o.strafe, o.forward) <= 1 + 1e-9);
});

test('Mode 2 (default): left stick = climb + yaw, right stick = forward + strafe; up is positive', () => {
  let o = mapSticks([0, -1, 0, 0], {}, out());
  assert.equal(o.climb, 1);
  o = mapSticks([1, 0, 1, 0], {}, out());
  assert.equal(o.yaw, 1);
  assert.equal(o.strafe, 1);
  o = mapSticks([0, 0, 0, -1], {}, out());
  assert.equal(o.forward, 1);
});

test('Mode 1: left stick = forward + yaw, right stick = climb + strafe', () => {
  let o = mapSticks([0, -1, 0, 0], { mode: 1 }, out());
  assert.equal(o.forward, 1);
  o = mapSticks([-1, 0, 0, -1], { mode: 1 }, out());
  assert.equal(o.yaw, -1);
  assert.equal(o.climb, 1);
});

test('invertY flips climb and forward only', () => {
  let o = mapSticks([0, -1, 0, -1], { invertY: true }, out());
  assert.ok(o.climb < 0 && o.forward < 0);
  o = mapSticks([1, 0, 1, 0], { invertY: true }, out());
  assert.ok(o.yaw > 0 && o.strafe > 0);
});

test('sensitivity scales and is clamped to [-1, 1]', () => {
  const o = mapSticks([0, 0, 0, -0.5], { sensitivity: 3 }, out());
  assert.equal(o.forward, 1);
});

test('keyboard: opposite keys cancel, WASD/Space/C/Q/E map to the unified action', () => {
  const k = new Set([DEFAULT_KEYS.forward, DEFAULT_KEYS.back, DEFAULT_KEYS.right, DEFAULT_KEYS.up, DEFAULT_KEYS.yawLeft]);
  assert.deepEqual(keysToAction(k, DEFAULT_KEYS, out()), { forward: 0, strafe: 1, climb: 1, yaw: -1 });
});

test('padType: Sony vendor id and names are PlayStation, others Xbox', () => {
  assert.equal(padType('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'ps');
  assert.equal(padType('Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)'), 'xbox');
  assert.equal(padType(''), 'xbox');
});

test('HoldTracker fires once after 0.6 s, not when released early, re-arms after release', () => {
  const h = new HoldTracker(0.6);
  let fired = 0;
  for (let i = 0; i < 30; i++) if (h.update(1 / 60, true)) fired++; // 0.5 s
  assert.equal(fired, 0);
  h.update(1 / 60, false);
  for (let i = 0; i < 120; i++) if (h.update(1 / 60, true)) fired++; // 2 s
  assert.equal(fired, 1);
  h.update(1 / 60, false);
  for (let i = 0; i < 40; i++) if (h.update(1 / 60, true)) fired++;
  assert.equal(fired, 2);
});

test('hints follow the device and the controller type', () => {
  const kb = buildHints('latihan', 'keyboard');
  assert.ok(kb.left.some(([k]) => k === 'WASD'));
  const xbox = buildHints('latihan', 'gamepad', 'xbox');
  assert.ok(xbox.left.some(([k]) => k === 'A'));
  const ps = buildHints('latihan', 'gamepad', 'ps');
  assert.ok(ps.left.some(([k]) => k === '✕'));
  assert.ok(!ps.left.some(([k]) => k === 'A'));
});

test('pickStickAxes: standard pads use 0..3; DirectInput and Linux layouts skip trigger and hat axes', () => {
  assert.deepEqual(pickStickAxes([0, 0, 0, 0, -1, -1], 'standard'), [0, 1, 2, 3]);
  assert.deepEqual(pickStickAxes([0, 0, 0, -1, -1, 0, 3.2857], ''), [0, 1, 2, 5]);   // DualShock (DirectInput)
  assert.deepEqual(pickStickAxes([0, 0, -1, 0, 0, -1], ''), [0, 1, 3, 4]);            // Xbox on Linux/Firefox
  assert.deepEqual(pickStickAxes([-1, -1, -1], ''), [0, 1, 2, 3]);                      // unknown: fall back
});
