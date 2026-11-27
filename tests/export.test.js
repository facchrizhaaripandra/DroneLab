// The Python gateway reads files exported from this code base. These tests fail when the files go stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildExport, worldFile } from '../scripts/export_worlds.mjs';
import { buildCases } from '../scripts/make_parity_cases.mjs';

const dir = new URL('../backend/worlds/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const plain = (v) => JSON.parse(JSON.stringify(v)); // what a JSON file can hold

test('export has the five main missions and sixteen worlds', () => {
  const { missions, worlds } = buildExport();
  assert.deepEqual(missions.map((m) => [m.id, m.scorer]), [
    ['m1_sar', 'sar'], ['m2_foto', 'photo'], ['m3_agri', 'agri'], ['m4_delivery', 'delivery'], ['m5_inspeksi', 'inspection'],
  ]);
  assert.equal(worlds.length, 16);
  assert.ok(worlds.every((w) => w.seed === 42 && w.config.mission));
});

test('realistic worlds take their map limits from scene.json, procedural ones from bounds', () => {
  const { worlds } = buildExport();
  const find = (m, v) => worlds.find((w) => w.mission_id === m && w.variant === v);
  assert.equal(find('m4_delivery', 'kota').limits.minX, -341);
  assert.deepEqual(find('m4_delivery', 'acak').limits, { minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
});

test('the files in backend/worlds match the current simulator code', () => {
  const { missions, worlds } = buildExport();
  assert.deepEqual(read('missions.json'), plain(missions));
  for (const w of worlds) assert.deepEqual(read(worldFile(w)), plain(w), worldFile(w));
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.json')).sort(), ['missions.json', ...worlds.map(worldFile)].sort());
});

test('the parity cases in backend/tests/parity match the current JavaScript scorer', () => {
  for (const [id, cases] of Object.entries(buildCases())) {
    assert.ok(cases.length >= 20, id);
    assert.deepEqual(JSON.parse(readFileSync(new URL(`../backend/tests/parity/${id}.json`, import.meta.url), 'utf8')), cases, id);
  }
});

test('parity cases cover every exported world', () => {
  const names = Object.values(buildCases()).flat().map((c) => c.name);
  for (const w of buildExport().worlds) assert.ok(names.some((n) => n.startsWith(`${w.mission_id}-${w.variant}-`)), worldFile(w));
});
