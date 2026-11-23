import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLASSES, datasetObjects, labelFrame, yoloLines, planDataset, poseFor, makeZip, crc32, SEED_BASE, WORLD_VARIANTS } from '../src/dataset.js';
import { makeMissionConfig } from '../src/worldconfig.js';

test('labelFrame: an object ahead gets a centered box, behind or too small gets none', () => {
  const c = makeMissionConfig('m1_sar', 42, 'hutan');
  const v = c.mission.victims[0];
  const objs = datasetObjects(c);
  const pose = { pos: [v.x, 6, v.z + 12], yaw: 0, pitch: -25 };
  const lab = labelFrame(pose, objs).filter((l) => l.cls === 'person' && l.id === v.id);
  assert.equal(lab.length, 1);
  const [cx, cy, w, h] = lab[0].box;
  assert.ok(cx > 0.4 && cx < 0.6 && cy > 0.35 && cy < 0.8 && w > 0 && h > w, JSON.stringify(lab[0]));
  assert.equal(labelFrame({ ...pose, yaw: 180 }, objs).filter((l) => l.id === v.id && l.cls === 'person').length, 0);
  assert.equal(labelFrame({ pos: [v.x, 6, v.z + 300], yaw: 0, pitch: -3 }, objs).filter((l) => l.cls === 'person').length, 0);
  // a blocked object (smoke in normal mode) is dropped
  assert.equal(labelFrame(pose, objs, { blocked: (o) => o.label === 'person' }).filter((l) => l.cls === 'person').length, 0);
  assert.ok(lab[0].box.every((x) => x >= 0 && x <= 1));
});

test('yolo lines use the class index and 4 normalized numbers', () => {
  const t = yoloLines([{ cls: 'fire', box: [0.5, 0.5, 0.1, 0.2] }, { cls: 'person', box: [0.1, 0.2, 0.03, 0.04] }]);
  assert.equal(t, '1 0.5 0.5 0.1 0.2\n0 0.1 0.2 0.03 0.04');
  assert.equal(CLASSES.length, 9);
});

test('plan: deterministic, exact image count, 70/20/10 split by world seed, test seeds never used for training', () => {
  const a = planDataset({ count: 1000, seed: 3 });
  assert.deepEqual(a, planDataset({ count: 1000, seed: 3 }));
  assert.notDeepEqual(a, planDataset({ count: 1000, seed: 4 }));
  assert.equal(a.reduce((s, w) => s + w.shots.length, 0), 1000);
  const n = (sp) => a.filter((w) => w.split === sp).length / a.length;
  assert.ok(Math.abs(n('train') - 0.7) < 0.1 && Math.abs(n('val') - 0.2) < 0.1 && Math.abs(n('test') - 0.1) < 0.07, `${n('train')} ${n('val')} ${n('test')}`);
  const seeds = (sp) => new Set(a.filter((w) => w.split === sp).map((w) => w.seed));
  for (const s of seeds('test')) assert.ok(!seeds('train').has(s) && !seeds('val').has(s));
  for (const w of a) assert.ok(w.seed >= SEED_BASE[w.split] && w.seed < SEED_BASE[w.split] + 500);
  assert.equal(new Set(a.map((w) => `${w.mission}/${w.variant}`)).size, WORLD_VARIANTS.length);
  assert.ok(a.some((w) => w.shots.some((s) => s.thermal)));
});

test('poseFor looks at the object, and every class gets labeled somewhere in a small dataset', () => {
  const plan = planDataset({ count: 160, perWorld: 8, seed: 11 });
  const seen = new Set();
  let frames = 0, nonEmpty = 0;
  for (const w of plan) {
    const cfg = makeMissionConfig(w.mission, w.seed, w.variant);
    const objs = datasetObjects(cfg);
    for (const [i, shot] of w.shots.entries()) {
      const target = objs[(shot.k + i) % objs.length];
      const pose = poseFor(target, shot);
      assert.ok(Math.abs(pose.pos[0]) <= 98 && Math.abs(pose.pos[2]) <= 98 && pose.pos[1] >= 1.5);
      const lab = labelFrame(pose, objs);
      frames++; if (lab.length) nonEmpty++;
      for (const l of lab) seen.add(l.cls);
    }
  }
  assert.ok(nonEmpty / frames > 0.5, `${nonEmpty}/${frames} frames have labels`);
  for (const k of ['person', 'fire', 'landmark', 'defect', 'building', 'obstacle', 'target', 'dropzone']) assert.ok(seen.has(k), `class ${k} never labeled (saw ${[...seen]})`);
});

test('zip: valid archive (own reader, CRC check, and python zipfile when available)', () => {
  const files = [{ name: 'labels/a.txt', data: '0 0.5 0.5 0.1 0.1\n' }, { name: 'images/a.jpg', data: Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255) }, { name: 'classes.txt', data: CLASSES.join('\n') }];
  const zip = makeZip(files);
  // read the central directory
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  const n = dv.getUint16(end + 10, true);
  assert.equal(n, 3);
  let p = dv.getUint32(end + 16, true);
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nl));
    assert.equal(name, files[i].name);
    const lnl = dv.getUint16(off + 26, true);
    const data = zip.subarray(off + 30 + lnl, off + 30 + lnl + size);
    assert.equal(crc32(data), crc);
    assert.deepEqual(Buffer.from(data), Buffer.from(typeof files[i].data === 'string' ? new TextEncoder().encode(files[i].data) : files[i].data));
    p += 46 + nl;
  }
  const tmp = path.join(os.tmpdir(), `dl-${process.pid}.zip`);
  fs.writeFileSync(tmp, zip);
  try { execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert len(z.namelist())==3', tmp]); }
  catch (e) { if (e.code !== 'ENOENT') throw e; /* no python here: the reader above is enough */ }
  fs.unlinkSync(tmp);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926); // the standard CRC-32 check value
});
