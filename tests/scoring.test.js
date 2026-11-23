import test from 'node:test';
import assert from 'node:assert/strict';
import { project, inFrame, bearing } from '../src/camera-model.js';
import { makeMissionConfig } from '../src/worldconfig.js';
import { visibleObjects, canSee } from '../src/vision.js';
import { scoreFromEvents, photoFactors, videoFactors, replayAgri, inspectionReport, severityOf } from '../src/scoring.js';
import { MISSIONS, getMission } from '../src/catalog.js';

const sum = (r) => Math.round(r.breakdown.reduce((s, b) => s + b.points, 0));
const fin = (over = {}) => ({ t_ms: 150000, battery: 50, reason: 'completed', ...over });
const ev = (t_ms, type, pos, yaw, extra = {}) => ({ t_ms, type, pose: { pos, yaw, pitch: -10, roll: 0 }, ...extra });

// ---------------------------------------------------------------- camera model
test('camera: an object straight ahead is centered, behind is gone, off to the side leaves the frame', () => {
  const pose = { pos: [0, 5, 0], yaw: 0, pitch: 0 };
  const p = project(pose, { x: 0, y: 5, z: -20, hx: 2, hy: 2 });
  assert.ok(Math.abs(p.center[0] - 0.5) < 1e-9 && Math.abs(p.center[1] - 0.5) < 1e-9);
  assert.ok(inFrame(p));
  assert.equal(project(pose, { x: 0, y: 5, z: 20, hx: 1, hy: 1 }), null);
  assert.ok(!inFrame(project(pose, { x: 60, y: 5, z: -20, hx: 1, hy: 1 })));
  // twice as far = a quarter of the area
  const far = project(pose, { x: 0, y: 5, z: -40, hx: 2, hy: 2 });
  assert.ok(Math.abs(far.area / p.area - 0.25) < 1e-9);
  // pitched down: an object below the drone moves toward the frame center
  const down = project({ pos: [0, 10, 0], yaw: 0, pitch: -45 }, { x: 0, y: 0, z: -10, hx: 1, hy: 1 });
  assert.ok(Math.abs(down.center[1] - 0.5) < 0.01);
  // yaw 90 looks toward +X
  assert.ok(inFrame(project({ pos: [0, 5, 0], yaw: 90, pitch: 0 }, { x: 20, y: 5, z: 0, hx: 1, hy: 1 })));
});

// ---------------------------------------------------------------- worlds
test('mission worlds are deterministic and well formed for many seeds', () => {
  for (const [id, variants] of [['m1_sar', ['gedung', 'hutan']], ['m2_foto', ['hotel', 'gunung']], ['m3_agri', [undefined]], ['m5_inspeksi', ['gedung', 'jembatan']]]) {
    for (const v of variants) for (const seed of [1, 7, 42, 99, 123]) {
      const a = makeMissionConfig(id, seed, v);
      assert.deepEqual(a, makeMissionConfig(id, seed, v), `${id} ${v} ${seed}`);
      const m = a.mission;
      if (id === 'm1_sar') {
        assert.ok(m.victims.length >= 3 && m.victims.length <= 6, `victims ${m.victims.length}`);
        for (const vic of m.victims) {
          assert.ok(Math.hypot(vic.x, vic.z) > 12);
          for (const f of m.fires) assert.ok(Math.hypot(vic.x - f.x, vic.z - f.z) > f.r, 'victim in fire');
          if (vic.y === 0) assert.ok(!a.buildings.some((b) => Math.abs(b.x - vic.x) < b.w / 2 && Math.abs(b.z - vic.z) < b.d / 2), 'victim inside a building');
        }
        assert.ok(m.fires.length >= 2);
      }
      if (id === 'm2_foto') { assert.equal(m.shots.length, 4); for (const s of m.shots) assert.ok(m.landmarks.some((l) => l.id === s.subject)); }
      if (id === 'm3_agri') {
        const f = m.field;
        assert.ok(f.min[0] > -95 && f.max[0] < 95 && f.min[1] > -95 && f.max[1] < 95);
        assert.ok(a.wind.speed > 0);
      }
      if (id === 'm5_inspeksi') { assert.ok(m.defects.length >= 5 && m.defects.length <= 7); assert.ok(m.panels.length >= 10); }
    }
  }
});

test('catalog: every mission is available and the weights of the main missions are in the catalog', () => {
  assert.ok(MISSIONS.every((m) => m.available));
  assert.equal(getMission('m1_sar').weights.found, 40);
  const w1 = Object.values(getMission('m1_sar').weights).reduce((a, b) => a + b, 0);
  assert.equal(w1, 100);
  assert.equal(['found', 'time', 'coverage', 'safety', 'precision'].length, 5);
  const w3 = Object.values(getMission('m3_agri').weights).reduce((a, b) => a + b, 0), w5 = Object.values(getMission('m5_inspeksi').weights).reduce((a, b) => a + b, 0);
  assert.equal(w3, 100); assert.equal(w5, 100);
});

// ---------------------------------------------------------------- vision: smoke and thermal
test('vision: smoke hides a victim beyond 6 m in normal mode; thermal and closeness see through', () => {
  const c = makeMissionConfig('m1_sar', 42, 'gedung');
  const v = c.mission.victims.find((x) => c.mission.smoke.some((s) => Math.hypot(s.x - x.x, s.z - x.z) < 1));
  assert.ok(v, 'a victim under smoke');
  const has = (pose, opts) => visibleObjects(pose, c, opts).some((o) => o.label === 'person' && o.id === v.id);
  const far = { pos: [v.x, v.y + 3, v.z + 14], yaw: 0, pitch: -8 }, close = { pos: [v.x, v.y + 3, v.z + 4], yaw: 0, pitch: -40 };
  assert.ok(!has(far, {}));
  assert.ok(has(far, { thermal: true }));
  assert.ok(has(close, {}));
  assert.ok(canSee('person', far.pos, 0, c, [], { pitch: -8, thermal: true }));
  assert.ok(!canSee('person', far.pos, 0, c, [], { pitch: -8 }));
  // an object with no smoke around it is seen normally
  const free = c.mission.victims.find((x) => !c.mission.smoke.some((s) => Math.hypot(s.x - x.x, s.z - x.z) < s.r + 8));
  if (free) assert.ok(visibleObjects({ pos: [free.x, free.y + 3, free.z + 14], yaw: 0, pitch: -8 }, c).some((o) => o.id === free.id && o.label === 'person'));
});

// ---------------------------------------------------------------- M1
function sarLog(c, marks, extra = []) {
  const log = [ev(1000, 'takeoff', [0, 0, 0], 0)];
  marks.forEach((v, i) => {
    const pos = [v.x, v.y + 3, v.z + 4];
    const pose = { pos, yaw: 0, pitch: -40 };
    log.push({ ...ev(20000 + i * 5000, 'mark', pos, 0), visible: visibleObjects(pose, c, { thermal: true }) });
  });
  return log.concat(extra);
}
test('M1: marks count only for victims in the frame within 5 m; wrong marks lower precision', () => {
  const c = makeMissionConfig('m1_sar', 42, 'hutan');
  const vs = c.mission.victims;
  const good = scoreFromEvents('m1_sar', c, sarLog(c, vs), fin());
  const row = (r, n) => r.breakdown.find((b) => b.name === n);
  assert.equal(row(good, 'Korban ditemukan').points, 40);
  assert.equal(row(good, 'Presisi').points, 10);
  assert.equal(sum(good), good.score);
  // one real mark and one mark in an empty spot
  const wrong = { ...ev(40000, 'mark', [0, 3, 0], 0), visible: [] };
  const half = scoreFromEvents('m1_sar', c, sarLog(c, [vs[0]], [wrong]), fin());
  assert.equal(row(half, 'Korban ditemukan').points, Math.round(40 / vs.length * 10) / 10);
  assert.equal(row(half, 'Presisi').points, 5);
  // a victim that is visible but too far away does not count
  const far = { ...ev(30000, 'mark', [vs[1].x, 3, vs[1].z + 30], 0), visible: [{ label: 'person', id: vs[1].id, dist: 30, area: 0.001, box: [0.5, 0.5, 0.01, 0.01] }] };
  assert.equal(row(scoreFromEvents('m1_sar', c, [far], fin()), 'Korban ditemukan').points, 0);
});

test('M1: same log twice, or shuffled, gives the identical score; fire time and collisions cost safety', () => {
  const c = makeMissionConfig('m1_sar', 42, 'gedung');
  const log = sarLog(c, c.mission.victims);
  const a = scoreFromEvents('m1_sar', c, log, fin());
  assert.deepEqual(a, scoreFromEvents('m1_sar', c, log, fin()));
  assert.deepEqual(a, scoreFromEvents('m1_sar', c, log.slice().reverse(), fin()));
  const hurt = log.concat([ev(5000, 'zone_enter', [0, 5, 0], 0, { kind: 'fire' }), ev(15000, 'zone_exit', [0, 5, 0], 0, { kind: 'fire' }), ev(6000, 'collision', [0, 5, 0], 0)]);
  const b = scoreFromEvents('m1_sar', c, hurt, fin());
  const safety = (r) => r.breakdown.find((x) => x.name === 'Keselamatan').points;
  assert.equal(safety(a), 15);
  assert.equal(safety(b), Math.round(15 * (1 - (0.2 + 0.2 * 1)) * 10) / 10); // 1 collision, 10 s in fire
});

test('M1: the weights come from the mission data (config.weights overrides the catalog) and "gugur" halves time and coverage', () => {
  const c = makeMissionConfig('m1_sar', 42, 'hutan');
  const log = sarLog(c, c.mission.victims);
  const base = scoreFromEvents('m1_sar', c, log, fin());
  const w = scoreFromEvents('m1_sar', { ...c, weights: { found: 50 } }, log, fin());
  assert.equal(w.breakdown[0].max, 50);
  assert.equal(w.breakdown[0].points, 50);
  const crashed = scoreFromEvents('m1_sar', c, log, fin({ reason: 'crashed' }));
  const t = (r) => r.breakdown.find((x) => x.name === 'Waktu').points;
  assert.equal(t(crashed), Math.round(t(base) / 2 * 10) / 10);
  assert.equal(crashed.breakdown[0].points, base.breakdown[0].points); // the found victims still count
});

// ---------------------------------------------------------------- M2: photo scoring, 10 cases
function aim(lm, pos, want) { // search the yaw/pitch that puts the subject nearest to the wanted frame point
  const base = bearing(pos[0], pos[2], lm.x, lm.z);
  let best = null;
  for (let dy = -30; dy <= 30; dy += 0.5) for (let pt = -40; pt <= 20; pt += 1) {
    const pose = { pos, yaw: base + dy, pitch: pt };
    const p = project(pose, { x: lm.x, y: lm.y, z: lm.z, hx: lm.hx, hy: lm.hy });
    if (!p) continue;
    const d = Math.hypot(p.center[0] - want[0], p.center[1] - want[1]);
    if (!best || d < best.d) best = { d, pose };
  }
  return best.pose;
}
function photoEv(c, pose, extra = {}) {
  return { t_ms: 30000, type: 'photo', pose: { pos: pose.pos, yaw: pose.yaw, pitch: pose.pitch, roll: 0 }, speed: 0, yaw_rate: 0, visible: visibleObjects(pose, c), ...extra };
}
test('M2: ten photo cases, good photos score high and bad ones score low', () => {
  const c = makeMissionConfig('m2_foto', 42, 'hotel');
  const m = c.mission, hotel = m.landmarks.find((l) => l.id === 'hotel'), shot = m.shots[0];
  const total = (f) => 30 * f.subject + 20 * f.thirds + 10 * f.horizon + 15 * f.sharp + 10 * f.light + 15 * f.variation;
  // good: the sun is behind the camera, the subject sits on a third point, drone still and level, ~35 m away
  const camBearing = (m.sun.az + 180) % 360;  // camera looks away from the sun
  const standAt = (dist, b) => [hotel.x - Math.sin(b * Math.PI / 180) * dist, 14, hotel.z + Math.cos(b * Math.PI / 180) * dist];
  const pos = standAt(40, camBearing);
  const goodPose = aim(hotel, pos, [1 / 3, 1 / 3]);
  const good = photoEv(c, goodPose);
  const g = total(photoFactors(good, shot, c, null));
  assert.ok(g >= 85, `good photo ${g}`);
  const cases = {
    shaky: photoEv(c, goodPose, { speed: 3.5 }),
    spinning: photoEv(c, goodPose, { yaw_rate: 70 }),
    tilted: { ...good, pose: { ...good.pose, roll: 20 } },
    cutOff: photoEv(c, { ...goodPose, yaw: goodPose.yaw + 38 }),
    tooFar: photoEv(c, { ...aim(hotel, standAt(200, camBearing), [1 / 3, 1 / 3]) }),
    tooClose: photoEv(c, aim(hotel, standAt(9, camBearing), [0.5, 0.5])),
    lookAway: photoEv(c, { ...goodPose, yaw: goodPose.yaw + 180 }),
    backlit: (() => { const p = aim(hotel, standAt(40, m.sun.az), [1 / 3, 1 / 3]); return photoEv(c, p); })(),
    badThirds: photoEv(c, aim(hotel, pos, [0.5, 0.5])),
  };
  const r = {};
  for (const [k, e] of Object.entries(cases)) r[k] = total(photoFactors(e, shot, c, null));
  for (const k of ['shaky', 'spinning', 'tilted', 'cutOff', 'tooFar', 'lookAway']) assert.ok(r[k] < g - 9, `${k}: ${r[k]} vs good ${g}`);
  assert.ok(r.backlit < g - 5, `backlit ${r.backlit}`); // lighting is only 10 of 100 points
  assert.ok(r.lookAway <= 50 && r.tooFar < g - 20 && r.cutOff <= 50, JSON.stringify(r)); // without a subject only the 50 technical points remain
  assert.ok(r.tooClose < g && r.badThirds < g - 5, JSON.stringify(r));
  // variation: a second photo from almost the same place scores 0 on variation, from 40 degrees away it scores 1
  const near = photoFactors(good, shot, c, good).variation;
  const other = photoFactors(photoEv(c, aim(hotel, standAt(40, camBearing + 40), [1 / 3, 1 / 3])), shot, c, good).variation;
  assert.equal(near, 0); assert.equal(other, 1);
});

function orbitClip(c, lm, { jerky = false, still = false, turn = 120, secs = 10 } = {}) {
  const S = [];
  const R = 40;
  const b0 = bearing(lm.x, lm.z, 0, 0);
  for (let i = 0; i <= secs * 10; i++) {
    const b = (b0 + (still ? 0 : (turn * i) / (secs * 10))) * Math.PI / 180;
    const pos = [lm.x + Math.sin(b) * R, 12, lm.z - Math.cos(b) * R];
    const vel = still ? [0, 0, 0] : [Math.cos(b) * 5, 0, Math.sin(b) * 5].map((v) => (jerky ? v * (i % 2 ? 1.8 : -1.8) : v));
    S.push({ t_ms: 10000 + i * 100, type: 'sample', pos, vel, yaw: bearing(pos[0], pos[2], lm.x, lm.z), gimbal: -10, spraying: false });
  }
  return S;
}
test('M2: video scoring: a smooth orbit that keeps the subject in frame beats a still or jerky clip', () => {
  const c = makeMissionConfig('m2_foto', 42, 'hotel');
  const lm = c.mission.landmarks[0], shot = c.mission.shots[2];
  const mk = (opts) => { const S = orbitClip(c, lm, opts); return { samples: S, dur_s: (S[S.length - 1].t_ms - S[0].t_ms) / 1000 }; };
  const f = videoFactors(mk({}), shot, c, 0), jerky = videoFactors(mk({ jerky: true }), shot, c, 0), still = videoFactors(mk({ still: true }), shot, c, 0);
  assert.ok(f.vsubject > 0.9 && f.smooth > 0.8 && f.cinematic === 1 && f.duration === 1 && f.vsafety === 1, JSON.stringify(f));
  assert.ok(jerky.smooth < f.smooth - 0.4);
  assert.equal(still.cinematic, 0);
  assert.equal(videoFactors(mk({ secs: 3 }), shot, c, 0).duration < 1, true);
  assert.equal(videoFactors(mk({}), shot, c, 1).vsafety, 0);
});

test('M2: full mission score: breakdown adds up, empty run scores 0, results list every shot', () => {
  const c = makeMissionConfig('m2_foto', 42, 'hotel');
  const m = c.mission, hotel = m.landmarks[0];
  assert.equal(scoreFromEvents('m2_foto', c, [], fin()).score, 0);
  const b = (m.sun.az + 180) % 360;
  const pos = [hotel.x - Math.sin(b * Math.PI / 180) * 40, 14, hotel.z + Math.cos(b * Math.PI / 180) * 40];
  const log = [photoEv(c, aim(hotel, pos, [1 / 3, 1 / 3]))];
  const r = scoreFromEvents('m2_foto', c, log.concat(orbitClip(c, hotel).concat([ev(10000, 'record_start', pos, 0), ev(20000, 'record_stop', pos, 0)])), fin());
  assert.equal(sum(r), r.score);
  assert.equal(r.details.length, 4);
  assert.equal(r.details.filter((d) => d.done).length, 2); // one photo shot and one video shot done
  assert.ok(r.score > 25 && r.score < 100);
  assert.deepEqual(r, scoreFromEvents('m2_foto', c, log.concat(orbitClip(c, hotel).concat([ev(10000, 'record_start', pos, 0), ev(20000, 'record_stop', pos, 0)])), fin()));
});

// ---------------------------------------------------------------- M3
function mow(c, { refillAt = null, capacity, spraying = () => true, alt = 5, rowStep = 3 } = {}) {
  const f = c.mission.field, log = [];
  let t = 0, row = 0;
  for (let z = f.min[1] + 1.5; z < f.max[1]; z += rowStep, row++) {
    const dir = row % 2 ? -1 : 1;
    for (let x = dir > 0 ? f.min[0] - 2 : f.max[0] + 2; dir > 0 ? x <= f.max[0] + 2 : x >= f.min[0] - 2; x += dir * 0.3) {
      t += 100;
      log.push({ t_ms: t, type: 'sample', pos: [x, alt, z], vel: [dir * 3, 0, 0], yaw: 0, spraying: spraying(x, z) });
    }
    if (refillAt && refillAt.includes(row)) log.push({ t_ms: t + 1, type: 'refill', pose: { pos: [0, 0, 0], yaw: 0 } });
  }
  return log;
}
test('M3: spraying the whole field gives coverage, no-spray zones count as waste, the tank runs dry without refills', () => {
  const c = makeMissionConfig('m3_agri', 42);
  c.wind = null;
  c.mission.dose.capacity = 5000;
  const noSpray = c.mission.noSpray;
  const safe = (x, z) => !noSpray.some((r) => x >= r.min[0] - 2 && x <= r.max[0] + 2 && z >= r.min[1] - 2 && z <= r.max[1] + 2);
  const smart = scoreFromEvents('m3_agri', c, mow(c, { spraying: safe }), fin());
  const dumb = scoreFromEvents('m3_agri', c, mow(c, {}), fin());
  const row = (r, n) => r.breakdown.find((b) => b.name === n).points;
  assert.ok(row(smart, 'Cakupan') > 25, `coverage ${row(smart, 'Cakupan')}`);
  assert.ok(row(smart, 'Pemborosan') > row(dumb, 'Pemborosan'));
  assert.ok(row(smart, 'Ketinggian dan kecepatan') === 10);
  assert.equal(sum(smart), smart.score);
  // a small tank without refills: dry in the middle, the coverage stops growing, tank score drops
  const small = makeMissionConfig('m3_agri', 42); small.wind = null;
  const dry = scoreFromEvents('m3_agri', small, mow(small, { spraying: safe }), fin());
  assert.ok(row(dry, 'Manajemen tangki') < 10);
  assert.ok(row(dry, 'Cakupan') < row(smart, 'Cakupan'));
  // with refills at home the same flight is fully supplied
  const fed = scoreFromEvents('m3_agri', small, mow(small, { spraying: safe, refillAt: [1, 3] }), fin());
  assert.ok(row(fed, 'Cakupan') > row(dry, 'Cakupan'));
  // too fast and too high: the envelope score drops
  const high = scoreFromEvents('m3_agri', c, mow(c, { spraying: safe, alt: 12 }), fin());
  assert.equal(row(high, 'Ketinggian dan kecepatan'), 0);
  assert.deepEqual(smart, scoreFromEvents('m3_agri', c, mow(c, { spraying: safe }), fin()));
});
test('M3: a refill event far from H is ignored', () => {
  const c = makeMissionConfig('m3_agri', 42); c.wind = null;
  const log = mow(c, { spraying: () => true }).concat([{ t_ms: 99999, type: 'refill', pose: { pos: [50, 0, 50], yaw: 0 } }]);
  assert.equal(replayAgri(c, log).refills, 0);
});

// ---------------------------------------------------------------- M5
function inspectLog(c, defects, { mark = true, speed = 0 } = {}) {
  const log = [];
  defects.forEach((d, i) => {
    const pos = [d.x + d.nx * 5, d.y, d.z + d.nz * 5];
    const yaw = (Math.atan2(-d.nx, d.nz) * 180 / Math.PI + 360) % 360;
    const pose = { pos, yaw, pitch: 0 };
    const visible = visibleObjects(pose, c);
    log.push({ t_ms: 10000 + i * 4000, type: 'photo', pose: { ...pose, roll: 0 }, speed, yaw_rate: 0, visible });
    if (mark) log.push({ t_ms: 11000 + i * 4000, type: 'mark', pose: { ...pose, roll: 0 }, visible });
  });
  return log;
}
test('M5: defects need both a photo and a mark, wrong marks cost points, the report lists severity and coverage', () => {
  const c = makeMissionConfig('m5_inspeksi', 42, 'gedung');
  const ds = c.mission.defects;
  const all = scoreFromEvents('m5_inspeksi', c, inspectLog(c, ds), fin());
  const row = (r, n) => r.breakdown.find((b) => b.name === n).points;
  assert.equal(row(all, 'Cacat ditemukan'), 30);
  assert.equal(row(all, 'Kelengkapan laporan'), 15);
  assert.equal(all.found, ds.length);
  assert.equal(sum(all), all.score);
  const photoOnly = scoreFromEvents('m5_inspeksi', c, inspectLog(c, ds, { mark: false }), fin());
  assert.equal(row(photoOnly, 'Cacat ditemukan'), 0);
  assert.ok(row(photoOnly, 'Kelengkapan laporan') > 0 && row(photoOnly, 'Kelengkapan laporan') < 15);
  const wrongMark = { t_ms: 70000, type: 'mark', pose: { pos: [0, 3, 0], yaw: 0, pitch: 0, roll: 0 }, visible: [] };
  assert.ok(row(scoreFromEvents('m5_inspeksi', c, inspectLog(c, ds).concat([wrongMark]), fin()), 'Cacat ditemukan') < 30);
  const rep = inspectionReport(c, inspectLog(c, ds.slice(0, 2)));
  assert.equal(rep.defects.length, ds.length);
  assert.equal(rep.defects.filter((d) => d.photographed && d.marked).length, 2);
  assert.ok(rep.coverage > 0 && rep.coverage <= 1);
  assert.ok(['ringan', 'sedang', 'berat'].includes(rep.defects[0].severity));
  assert.equal(severityOf({ size: 0.4 }), 'ringan'); assert.equal(severityOf({ size: 1 }), 'sedang'); assert.equal(severityOf({ size: 2 }), 'berat');
});
test('M5: safe distance is the share of time 3..8 m from the structure', () => {
  const c = makeMissionConfig('m5_inspeksi', 42, 'gedung');
  const s = c.mission.structure;
  const at = (dist, i) => ({ t_ms: i * 100, type: 'sample', pos: [s.x + s.w / 2 + dist, 5, s.z], vel: [0, 0, 0], yaw: 270, spraying: false });
  const log = [];
  for (let i = 0; i < 10; i++) log.push(at(5, i));       // 5 m: safe
  for (let i = 10; i < 20; i++) log.push(at(1.5, i));    // too close
  const d = scoreFromEvents('m5_inspeksi', c, log, fin()).breakdown.find((b) => b.name === 'Jarak aman');
  assert.equal(d.points, 7.5);
});
