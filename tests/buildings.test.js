import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMissionConfig } from '../src/worldconfig.js';
import { buildingLayout, buildingType, roofY, insideSpot, bridgeLayout, openFloors, OPEN_FLOOR } from '../src/buildings.js';

const inBox = (p, c, pad = 0) => p[0] > c.min[0] - pad && p[0] < c.max[0] + pad && p[1] > c.min[1] - pad && p[1] < c.max[1] + pad && p[2] > c.min[2] - pad && p[2] < c.max[2] + pad;

test('every generated building gets a type, stays on its footprint and under its height', () => {
  const seen = new Set();
  for (const seed of [1, 7, 42, 99, 123]) for (const [id, v] of [['freeroam'], ['m1_sar', 'gedung'], ['m2_foto', 'hotel'], ['m5_inspeksi', 'gedung']]) {
    const c = makeMissionConfig(id, seed, v);
    for (const b of c.buildings) {
      const t = buildingType(b); seen.add(t);
      const { parts, colliders } = buildingLayout(b);
      assert.ok(parts.length > 3 && colliders.length >= 1, t);
      for (const p of parts) if (p.t === 'box') {
        assert.ok(Math.abs(p.c[0] - b.x) + p.s[0] / 2 <= b.w / 2 + 0.25 && Math.abs(p.c[2] - b.z) + p.s[2] / 2 <= b.d / 2 + 0.25, `${t} part outside the footprint`);
        if (t !== 'inspeksi') assert.ok(p.c[1] + p.s[1] / 2 <= b.h + 0.01, `${t} part above the height`);
      }
      const r = roofY(b);
      assert.ok(r > 3 && r <= b.h + 0.2, `${t} roof ${r} vs ${b.h}`);
    }
  }
  for (const t of ['ruko', 'kantor', 'apartemen', 'gudang', 'terbuka', 'hotel', 'inspeksi']) assert.ok(seen.has(t), `type ${t} never used`);
});

test('the burnt open building has a victim inside that a drone can reach from the open side', () => {
  const c = makeMissionConfig('m1_sar', 42, 'gedung');
  const b = c.buildings.find((x) => x.type === 'terbuka');
  const v = c.mission.victims.find((x) => x.inside);
  assert.ok(b && v);
  const cols = buildingLayout(b).colliders;
  const head = [v.x, v.y + 1.2, v.z];
  assert.ok(!cols.some((cl) => inBox(head, cl, 0.5)), 'victim spot is free');
  assert.ok(v.y + 3 <= openFloors(b) * OPEN_FLOOR, 'there is a slab above (inside, not on the roof)');
  // straight line from 8 m outside the open front to the victim at drone height: no collider in the way
  const dirX = Math.sign(-b.x) || 1, dirZ = Math.sign(-b.z) || 1, alongX = b.w >= b.d;
  const start = alongX ? [v.x, v.y + 1.4, b.z + dirZ * (b.d / 2 + 8)] : [b.x + dirX * (b.w / 2 + 8), v.y + 1.4, v.z];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40, p = [start[0] + (v.x - start[0]) * t, start[1], start[2] + (v.z - start[2]) * t];
    assert.ok(!cols.some((cl) => inBox(p, cl, 0.45)), `blocked at ${p.map((n) => n.toFixed(1))}`);
  }
});

test('bridge details stay off the deck faces where defects sit', () => {
  const c = makeMissionConfig('m5_inspeksi', 42, 'jembatan'), s = c.mission.structure;
  for (const p of bridgeLayout(s).parts) if (p.t === 'box') {
    const y0 = p.c[1] - p.s[1] / 2, y1 = p.c[1] + p.s[1] / 2;
    if (y1 > s.y0 + 0.01 && y0 < s.y1 - 0.01) assert.fail('a detail covers the deck side');
  }
  void insideSpot;
});
