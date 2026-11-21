import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultConfig } from '../src/worldconfig.js';

test('same seed gives the same world, different seed differs', () => {
  assert.deepEqual(makeDefaultConfig(42), makeDefaultConfig(42));
  assert.notDeepEqual(makeDefaultConfig(42), makeDefaultConfig(7));
});

test('world has buildings, obstacles and 5 rings, clear of the home pad', () => {
  const c = makeDefaultConfig(42);
  assert.equal(c.rings.length, 5);
  assert.ok(c.buildings.length >= 8);
  assert.ok(c.obstacles.length >= 4);
  for (const b of [...c.buildings, ...c.obstacles]) assert.ok(Math.hypot(b.x, b.z) >= 12);
});
