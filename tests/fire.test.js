import test from 'node:test';
import assert from 'node:assert/strict';
import { createFireField, fireCounts } from '../src/fire.js';

test('fire field builds instanced geometry for flames, glow, embers and smoke', () => {
  const f = createFireField();
  f.add({ x: 0, y: 0, z: 0, r: 4, h: 6 });
  f.add({ x: 10, y: 0, z: 0, r: 3, h: 2, flame: false, smokeH: 30 });
  f.build();
  assert.ok(f.built);
  const meshes = f.group.children.filter((o) => o.geometry);
  assert.equal(meshes.length, 4, 'smoke, glow, flame, ember');
  const flame = meshes.find((m) => m.material.vertexShader.includes('aA'));
  assert.equal(flame.geometry.instanceCount, fireCounts(4, 6, 30).tongues, 'only the burning source has flame tongues');
});

test('smoke-only sources do not light the surroundings', () => {
  const f = createFireField();
  f.add({ x: 0, y: 0, z: 0, r: 3, h: 2, flame: false });
  f.build();
  f.update(1, [0, 1, 0]);
  const lights = f.group.children.filter((o) => o.isLight);
  assert.ok(lights.every((l) => l.intensity === 0));
});

test('the nearest flaming source lights up and thermal mode whitens it', () => {
  const f = createFireField();
  f.add({ x: 0, y: 0, z: 0, r: 3, h: 4 });
  f.build();
  f.update(1, [5, 2, 0]);
  const l = f.group.children.find((o) => o.isLight);
  assert.ok(l.intensity > 50);
  f.setThermal(true); f.update(1, [5, 2, 0]);
  assert.equal(l.color.getHex(), 0xffffff);
});

test('far from every fire the lights stay off', () => {
  const f = createFireField();
  f.add({ x: 0, y: 0, z: 0, r: 3, h: 4 });
  f.build();
  f.update(1, [500, 2, 0]);
  assert.ok(f.group.children.filter((o) => o.isLight).every((l) => l.intensity === 0));
});

import { heatAt, fireCore, FIRE_WARN } from '../src/fire.js';

const src = [{ x: 0, y: 0, z: 0, r: 4, h: 5, flame: true }];

test('heat: inside the fire is full, outside it fades, far away is zero', () => {
  assert.equal(heatAt(src, 0, 2, 0).level, 1);
  const edge = fireCore(src[0]) + 2;
  const mid = heatAt(src, edge, 0, 0);
  assert.ok(mid.level > 0 && mid.level < 0.6, `radiant heat, got ${mid.level}`);
  assert.equal(heatAt(src, 40, 2, 0).level, 0);
});

test('heat: the plume rises above the fire but high above it is safe', () => {
  assert.equal(heatAt(src, 0, 12, 0).level, 1, 'in the plume column');
  assert.equal(heatAt(src, 0, 60, 0).level, 0);
});

test('heat: near reports the distance to the fire core, warning range is 10 m', () => {
  const h = heatAt(src, fireCore(src[0]) + 6, 1, 0);
  assert.ok(Math.abs(h.near - 6) < 1e-6);
  assert.ok(h.near < FIRE_WARN);
  assert.equal(heatAt([], 0, 0, 0).near, Infinity);
});
