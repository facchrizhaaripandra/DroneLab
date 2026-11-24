import test from 'node:test';
import assert from 'node:assert/strict';
import { project, inFrame, clampZoom, ZOOM, visibleList } from '../src/camera-model.js';

const obj = { x: 0, y: 0, z: -20, hx: 1, hy: 1, label: 'a' };
const pose = (zoom) => ({ pos: [0, 0, 0], yaw: 0, pitch: 0, zoom });

test('zoom narrows the view: objects look bigger and off-center ones leave the frame', () => {
  const a = project(pose(1), obj), b = project(pose(4), obj);
  assert.ok(b.full > a.full * 15, 'about 16x the area at 4x zoom');
  const side = { ...obj, x: 12 };
  assert.ok(inFrame(project(pose(1), side)));
  assert.ok(!inFrame(project(pose(4), side)));
});

test('zoom range is clamped to 1x-6x', () => {
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(40), ZOOM.max);
  assert.equal(ZOOM.max, 6);
});

test('zoom extends how far an object can be seen', () => {
  const far = { x: 0, y: 0, z: -90, hx: 2, hy: 2, label: 'far', range: 60 };
  assert.equal(visibleList(pose(1), [far]).length, 0);
  assert.equal(visibleList(pose(2), [far]).length, 1);
});

test('default keys have no duplicates (new zoom and gimbal keys do not clash)', async () => {
  const { DEFAULT_KEYS } = await import('../src/bindings.js');
  const codes = Object.values(DEFAULT_KEYS);
  assert.equal(new Set(codes).size, codes.length);
});
