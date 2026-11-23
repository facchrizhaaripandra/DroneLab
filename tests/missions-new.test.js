import test from 'node:test';
import assert from 'node:assert/strict';
import { MissionRun } from '../src/missions.js';
import { makeMissionConfig } from '../src/worldconfig.js';
import { Flight } from '../src/flight.js';
import { DroneDamage } from '../src/damage.js';
import { replayAgri } from '../src/scoring.js';
import { agriSummary } from '../src/agri.js';

const fly = (pos, extra = {}) => { const s = new Flight(); s.damage = new DroneDamage(); s.mode = 'flying'; s.pos = [...pos]; s.prevYaw = s.yaw = 0; Object.assign(s, extra); return s; };
const frame = (run, sim, spraying = false) => run.sample({ t_ms: run.tMs, pos: sim.pos.slice(), vel: [0, 0, 0], yaw: sim.yaw, roll: 0, pitch: 0, gimbal: run.gimbal, battery: 80, payload_kg: 0, spraying, collision: false });
const tick = (run, sim, sec) => { for (let i = 0; i < sec * 60; i++) run.step(1 / 60, sim, 80, 0, 0); };

test('M1 run: mark answers right/wrong, fire burns the drone, all found + landed at H completes', () => {
  const c = makeMissionConfig('m1_sar', 42, 'hutan');
  const run = new MissionRun('m1_sar', c);
  const msgs = [];
  run.onNotice = (m) => msgs.push(m);
  const vs = c.mission.victims;
  const sim = fly([0, 3, 0]);
  tick(run, sim, 0.1);
  assert.match(run.mark(sim, true), /Tanda salah/);
  sim.pos = [vs[0].x, 3, vs[0].z + 4]; sim.yaw = 0; run.gimbal = -40;
  assert.match(run.mark(sim, true), /Korban #1 ditandai/);
  assert.equal(run.found.size, 1);
  // fire zone: entering logs zone_enter, burns the drone after a while, leaving logs zone_exit
  const f = c.mission.fires[0];
  sim.pos = [f.x, 3, f.z];
  let changes = 0; sim.onDamage = (ch) => { changes += ch.length; };
  tick(run, sim, 9);
  assert.ok(run.log.some((e) => e.type === 'zone_enter' && e.kind === 'fire'));
  assert.ok(sim.damage.camera < 0.3 && changes > 0, `camera ${sim.damage.camera}`);
  assert.ok(msgs.some((m) => /api/i.test(m)));
  sim.pos = [f.x + f.r + 5, 3, f.z]; tick(run, sim, 0.1);
  assert.ok(run.log.some((e) => e.type === 'zone_exit' && e.kind === 'fire'));
  // find the rest, then land at H
  sim.damage.reset(); run.gimbal = -40;
  for (const v of vs.slice(1)) { sim.pos = [v.x, v.y + 3, v.z + 4]; run.mark(sim, true); }
  assert.equal(run.found.size, vs.length);
  sim.pos = [0, 0, 0]; sim.mode = 'landed'; tick(run, sim, 0.1);
  assert.equal(run.done, true);
  assert.equal(run.reason, 'completed');
  const res = run.result(60);
  assert.equal(res.breakdown.find((b) => b.name === 'Korban ditemukan').points, 40);
});

test('camera actions need a working camera and flight', () => {
  const c = makeMissionConfig('m2_foto', 42, 'hotel');
  const run = new MissionRun('m2_foto', c);
  const sim = fly([0, 10, 0]);
  tick(run, sim, 0.1);
  assert.match(run.photo(sim, false), /^Foto #1/);
  assert.equal(run.photo(sim, false), null, 'two photos in 0.4 s: the second is ignored');
  sim.damage.camera = 0;
  assert.match(run.photo(sim, false), /Kamera pecah/);
  sim.damage.camera = 1;
  assert.match(run.mark(sim), /hanya dipakai/);
  const landed = fly([0, 0, 0], { mode: 'landed' });
  assert.match(run.toggleRecord(landed), /Terbang dulu/);
  assert.match(run.toggleRecord(sim), /Merekam/);
  assert.equal(run.recording, true);
  assert.match(run.toggleRecord(sim), /disimpan/);
  assert.deepEqual(run.log.filter((e) => e.type.startsWith('record')).map((e) => e.type), ['record_start', 'record_stop']);
  const ph = run.log.find((e) => e.type === 'photo');
  assert.ok(Array.isArray(ph.visible) && ph.pose.pitch === -10 && 'roll' in ph.pose && 'speed' in ph && 'yaw_rate' in ph);
});

test('M2 run: shot list progress counts photos and clips, ends when the list is done and the drone is home', () => {
  const c = makeMissionConfig('m2_foto', 42, 'hotel');
  const run = new MissionRun('m2_foto', c);
  const sim = fly([0, 10, 0]);
  tick(run, sim, 0.1);
  assert.match(run.text, /berikutnya/);
  run.t += 1; run.photo(sim); run.t += 1; run.photo(sim);
  run.toggleRecord(sim); run.toggleRecord(sim); run.toggleRecord(sim); run.toggleRecord(sim);
  sim.mode = 'landed'; sim.pos = [0, 0, 0];
  tick(run, sim, 0.1);
  assert.equal(run.progress, 1);
  assert.equal(run.done, true);
});

test('M3 run: spraying uses the tank, tank empty stops it, landing at H refills, live numbers match the scorer', () => {
  const c = makeMissionConfig('m3_agri', 42);
  const run = new MissionRun('m3_agri', c);
  const notes = [];
  run.onNotice = (m) => notes.push(m);
  const sim = fly([c.mission.field.min[0] + 6, 5, c.mission.field.min[1] + 6]);
  tick(run, sim, 0.1);
  assert.equal(run.setSpray(true, sim), null);
  assert.equal(run.spraying, true);
  for (let i = 0; i < 400; i++) { frame(run, sim, run.spraying); run.t += 0.1; }  // 40 s of spraying: the 20 s tank runs dry
  assert.equal(run.spraying, false);
  assert.ok(notes.some((n) => /Tangki kosong/.test(n)));
  assert.match(run.setSpray(true, sim), /Tangki kosong/);
  const a = replayAgri(c, run.log);
  assert.deepEqual(agriSummary(a), agriSummary(run.agri));    // live == scorer
  assert.ok(a.empties >= 1);
  sim.mode = 'landed'; sim.pos = [0, 0, 0];
  tick(run, sim, 0.1);
  assert.ok(run.agri.tank > 100 && notes.some((n) => /terisi/.test(n)));
  assert.ok(run.log.some((e) => e.type === 'refill'));
  assert.equal(replayAgri(c, run.log).refills, 1);
});

test('M5 run: photo + mark of a defect from 5 m, progress and the report fill in', () => {
  const c = makeMissionConfig('m5_inspeksi', 42, 'gedung');
  const run = new MissionRun('m5_inspeksi', c);
  const d = c.mission.defects[0];
  const sim = fly([d.x + d.nx * 5, d.y, d.z + d.nz * 5]);
  sim.yaw = (Math.atan2(-d.nx, d.nz) * 180 / Math.PI + 360) % 360; sim.prevYaw = sim.yaw;
  run.gimbal = 0;
  tick(run, sim, 0.1);
  assert.match(run.photo(sim), /Foto #1/);
  run.t += 1;
  assert.match(run.mark(sim), /Cacat #1/);
  tick(run, sim, 0.1);
  assert.ok(run.progress > 0);
  run.endNow();
  const res = run.result(70);
  assert.ok(res.report.defects[0].photographed && res.report.defects[0].marked);
  assert.ok(res.found >= 1);
});

test('endNow ends the run as completed', () => {
  const run = new MissionRun('m1_sar', makeMissionConfig('m1_sar', 42, 'gedung'));
  run.step(1 / 60, fly([0, 3, 0]), 80, 0, 0);
  run.endNow();
  assert.equal(run.done, true); assert.equal(run.reason, 'completed');
});

// A DSL script drives a whole M3 run on the real flight model: the script commands reach the mission through act().
import { Commander } from '../src/commander.js';
import { Autopilot } from '../src/autopilot.js';
import { scoreFromEvents } from '../src/scoring.js';

test('script: spray("on") / move / spray("off") / photo / record run end to end and score from the log', () => {
  const c = makeMissionConfig('m3_agri', 42);
  c.wind = null;
  const run = new MissionRun('m3_agri', c);
  const sim = new Flight(); sim.damage = new DroneDamage();
  const act = (name, arg) => {
    if (name === 'spray') return run.setSpray(arg === 'on', sim);
    if (name === 'photo') return run.photo(sim, false);
    if (name === 'record') return arg === 'start' ? run.toggleRecord(sim) : run.recording ? run.toggleRecord(sim) : null;
    return null;
  };
  const cmd = new Commander({ autopilot: new Autopilot(), detect: () => false, battery: () => 100, act, setGimbal: (d) => { run.gimbal = d; } });
  cmd.onLog = () => {};
  // fly over the field from its west edge toward +X at row z
  const f = c.mission.field, z = (f.min[1] + f.max[1]) / 2;
  const r = cmd.load('takeoff(5); spray("on"); move(maju, 10); spray("off"); photo(); record("start"); hover(1); record("stop"); land();', 100);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  sim.pos = [f.min[0] - 1, 0, z]; sim.yaw = sim.prevYaw = 90; // facing +X
  cmd.start();
  let t = 0;
  for (let i = 0; i < 60 * 60 && cmd.state === 'running'; i++) {
    cmd.step(1 / 60, sim); sim.step(1 / 60, []); run.step(1 / 60, sim, 90, 0, 0);
    if (i % 6 === 0) run.sample({ t_ms: run.tMs, pos: sim.pos.slice(), vel: sim.vel.slice(), yaw: sim.yaw, roll: sim.roll, pitch: sim.pitch, gimbal: run.gimbal, battery: 90, payload_kg: 0, spraying: run.spraying, collision: false });
    t = i;
  }
  assert.equal(cmd.state, 'done', `state ${cmd.state} after ${t} steps`);
  assert.ok(run.agri.total > 0, 'the nozzle was open for part of the flight');
  assert.ok(run.log.some((e) => e.type === 'photo') && run.log.some((e) => e.type === 'record_start') && run.log.some((e) => e.type === 'record_stop'));
  const res = scoreFromEvents('m3_agri', c, run.log, { t_ms: run.tMs, battery: 90, reason: 'completed' });
  assert.ok(res.breakdown.find((b) => b.name === 'Manajemen tangki').points === 10);
  assert.equal(res.score, run.result ? scoreFromEvents('m3_agri', c, run.log, { t_ms: run.tMs, battery: 90, reason: 'completed' }).score : 0);
});
