import test from 'node:test';
import assert from 'node:assert/strict';
import { Battery } from '../src/battery.js';
import { makeMissionConfig, normalizeConfig } from '../src/worldconfig.js';
import { MissionRun, scoreFromEvents, gradeOf } from '../src/missions.js';
import { Flight } from '../src/flight.js';
import { createGateway } from '../src/gateway.js';

const fake = (over = {}) => ({ mode: 'flying', pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, collisionCount: 0, ...over });

test('battery drains only while airborne, more with speed and payload, never below 0', () => {
  const b = new Battery();
  b.step(10, false, 5, 1);
  assert.equal(b.level, 100);
  b.step(10, true, 0, 0);
  const hover = 100 - b.level;
  const c = new Battery(); c.step(10, true, 8, 1.5);
  assert.ok(100 - c.level > hover * 2);
  b.step(1e6, true, 8, 2);
  assert.equal(b.level, 0);
  assert.ok(b.empty);
});

test('mission configs are deterministic and M4 spots are clear of buildings', () => {
  assert.deepEqual(makeMissionConfig('m4_delivery', 42), makeMissionConfig('m4_delivery', 42));
  for (const seed of [1, 42, 99]) {
    const { mission: m, buildings } = makeMissionConfig('m4_delivery', seed);
    for (const p of [m.pickup, m.drop]) {
      assert.ok(!buildings.some((b) => Math.abs(b.x - p.x) < b.w / 2 + 3 && Math.abs(b.z - p.z) < b.d / 2 + 3));
    }
    assert.ok(Math.hypot(m.pickup.x - m.drop.x, m.pickup.z - m.drop.z) >= 30);
  }
  assert.equal(makeMissionConfig('rintangan', 42).rings.length, 1);
  assert.equal(makeMissionConfig('latihan_terbang', 42).rings.length, 0);
});

test('normalizeConfig fills missing parts', () => {
  const c = normalizeConfig({ seed: 5, mission: { pickup: { x: 1, z: 1, r: 3 }, drop: { x: 2, z: 2, r: 4 } } });
  assert.equal(c.bounds, 100);
  assert.deepEqual(c.mission.noFly, []);
  assert.ok(c.battery.drain_idle > 0);
});

test('latihan_terbang: takeoff, hover 3 s, land on the pad completes it', () => {
  const run = new MissionRun('latihan_terbang', makeMissionConfig('latihan_terbang'));
  const s = fake({ mode: 'landed' });
  run.step(1 / 60, s, 100, 0, 0);
  assert.equal(run.started, false);
  s.mode = 'flying'; s.pos = [0, 6, 0];
  for (let i = 0; i < 60 * 4; i++) run.step(1 / 60, s, 100, 0, 0);
  assert.equal(run.phase, 2);
  s.mode = 'landed'; s.pos = [0.5, 0, 0.5];
  run.step(1 / 60, s, 100, 0, 0);
  assert.equal(run.done, true);
  assert.equal(run.reason, 'completed');
  const r = run.result(90);
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.equal(r.grade, 'gold');
});

test('landing far from the pad does not complete; timeout and battery end the run', () => {
  const run = new MissionRun('latihan_terbang', makeMissionConfig('latihan_terbang'));
  const s = fake({ pos: [0, 6, 0] });
  for (let i = 0; i < 60 * 4; i++) run.step(1 / 60, s, 100, 0, 0);
  s.mode = 'landed'; s.pos = [20, 0, 0];
  run.step(1 / 60, s, 100, 0, 0);
  assert.equal(run.done, false);
  run.step(1 / 60, s, 0, 0, 0);
  assert.equal(run.reason, 'battery');
  const r2 = new MissionRun('patroli', makeMissionConfig('patroli'));
  r2.t = r2.limitS; r2.started = true;
  r2.step(1, fake(), 50, 0, 5);
  assert.equal(r2.reason, 'timeout');
});

test('patroli needs all rings AND a landing; collisions are counted as events', () => {
  const run = new MissionRun('patroli', makeMissionConfig('patroli'));
  const s = fake({ pos: [30, 8, 0] });
  run.step(1 / 60, s, 100, 3, 5);
  assert.equal(run.log.filter((e) => e.kind === 'checkpoint').length, 3);
  s.collisionCount = 2;
  run.step(1 / 60, s, 100, 5, 5);
  assert.equal(run.log.filter((e) => e.type === 'collision').length, 1);
  assert.equal(run.done, false);
  s.mode = 'landed'; s.pos = [0, 0, 1];
  run.step(1 / 60, s, 100, 5, 5);
  assert.equal(run.reason, 'completed');
});

test('rintangan completes when the goal ring is passed', () => {
  const run = new MissionRun('rintangan', makeMissionConfig('rintangan'));
  run.step(1 / 60, fake({ pos: [0, 6, -40] }), 100, 0, 1);
  assert.ok(run.progress > 0.3 && run.progress < 0.7);
  run.step(1 / 60, fake({ pos: [0, 6, -79] }), 100, 1, 1);
  assert.equal(run.reason, 'completed');
});

function deliver(cfg, { dropAt, noFlyS = 0, collisions = 0, tS = 100 }) {
  const events = [];
  const run = new MissionRun('m4_delivery', cfg, (t) => events.push(t));
  const m = cfg.mission;
  const s = fake({ pos: [m.pickup.x, 1.5, m.pickup.z] });
  run.step(1 / 60, s, 100, 0, 0);
  assert.equal(run.pickupDrop(s), 'Paket diambil');
  assert.equal(run.payloadKg, m.payload_kg);
  if (noFlyS) {
    const z = m.noFly[0];
    s.pos = [(z.min[0] + z.max[0]) / 2, 10, (z.min[1] + z.max[1]) / 2];
    for (let i = 0; i < noFlyS * 60; i++) run.step(1 / 60, s, 100, 0, 0);
  }
  s.collisionCount = collisions;
  s.pos = [dropAt[0], 1.5, dropAt[1]];
  run.t = tS;
  run.step(1 / 60, s, 100, 0, 0);
  run.pickupDrop(s);
  return { run, events };
}

test('M4: pickup far away is refused, delivery in the zone scores high with a full breakdown', () => {
  const cfg = makeMissionConfig('m4_delivery', 42);
  const m = cfg.mission;
  const far = new MissionRun('m4_delivery', cfg);
  const s = fake({ pos: [m.pickup.x + 30, 1, m.pickup.z] });
  far.step(1 / 60, s, 100, 0, 0);
  assert.match(far.pickupDrop(s), /jauh/);
  assert.equal(far.carrying, false);

  const { run, events } = deliver(cfg, { dropAt: [m.drop.x, m.drop.z] });
  assert.equal(run.reason, 'completed');
  assert.ok(events.includes('pickup') && events.includes('drop'));
  const r = run.result(80);
  assert.equal(r.breakdown.length, 5);
  assert.equal(r.breakdown.reduce((a, c) => a + c.max, 0), 100);
  assert.ok(r.score >= 85, `score ${r.score}`);
});

test('M4: a worse drop, no-fly time and collisions all lower the score', () => {
  const cfg = makeMissionConfig('m4_delivery', 42);
  const m = cfg.mission;
  const good = deliver(cfg, { dropAt: [m.drop.x, m.drop.z] }).run.result(80).score;
  const offDrop = deliver(cfg, { dropAt: [m.drop.x + 3.5, m.drop.z] }).run.result(80).score;
  const noFly = deliver(cfg, { dropAt: [m.drop.x, m.drop.z], noFlyS: 3 }).run.result(80).score;
  const hits = deliver(cfg, { dropAt: [m.drop.x, m.drop.z], collisions: 2 }).run.result(80).score;
  assert.ok(offDrop < good && noFly < good && hits < good, [good, offDrop, noFly, hits].join(','));
});

test('M4 score is deterministic and the gugur rule halves components without a delivery', () => {
  const cfg = makeMissionConfig('m4_delivery', 42);
  const fin = { t_ms: 400000, battery: 0, reason: 'battery' };
  const a = scoreFromEvents('m4_delivery', cfg, [], fin);
  assert.deepEqual(a, scoreFromEvents('m4_delivery', cfg, [], fin));
  assert.equal(a.breakdown.find((c) => c.name === 'Ketepatan').points, 0);
  assert.equal(a.breakdown.find((c) => c.name === 'Kepatuhan zona').points, 7.5);
  assert.equal(gradeOf(85), 'gold'); assert.equal(gradeOf(70), 'silver'); assert.equal(gradeOf(50), 'bronze'); assert.equal(gradeOf(49), 'none');
});

test('gateway: unreachable -> stub works end to end; reachable -> real; failure mid-run does not crash', async () => {
  const down = createGateway('http://x', { fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(await down.check(), 'stub');
  const { run_id, config } = await down.startRun({ mission_id: 'm4_delivery' });
  assert.ok(config.mission.pickup);
  const cfg = makeMissionConfig('m4_delivery', 42);
  const { run } = deliver(cfg, { dropAt: [cfg.mission.drop.x, cfg.mission.drop.z] });
  for (const e of run.log) await down.event(run_id, e);
  const res = await down.finish(run_id, { t_ms: 100000, battery: 80, reason: 'completed' });
  assert.ok(res.score > 50 && res.breakdown.length === 5);
  assert.equal(down.official, false);

  const calls = [];
  let fail = false;
  const up = createGateway('http://x', {
    fetchImpl: async (url) => {
      calls.push(url);
      if (fail) throw new Error('lost');
      return { ok: true, json: async () => (url.endsWith('/health') ? { status: 'ok' } : { run_id: 'r_1', seed: 1, config: {} }) };
    },
    WebSocketImpl: class { constructor() { this.readyState = 1; this.sent = []; } send(x) { calls.push('ws:' + x); } close() {} },
  });
  assert.equal(await up.check(), 'online');
  await up.startRun({ mission_id: 'm4_delivery' });
  assert.equal(up.official, true);
  up.telemetry({ t_ms: 1 });
  assert.ok(calls.includes('ws:{"t_ms":1}'));
  fail = true;
  await up.event('r_1', { type: 'photo' });          // must not throw
  assert.deepEqual(await up.finish('r_1', {}), { offline: true });
});
