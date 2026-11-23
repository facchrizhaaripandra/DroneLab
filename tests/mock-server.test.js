// Real HTTP round trip: gateway client <-> mock server on a random local port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../mock-server/server.js';
import { createGateway } from '../src/gateway.js';
import { MissionRun } from '../src/missions.js';

async function boot(opts) {
  const { server, state } = createMockServer(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, state, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

test('full M4 run over HTTP: official score from the mock, AI ok, local and LLM commands', async () => {
  const s = await boot({ ai: true });
  const gw = createGateway(s.url, { WebSocketImpl: class { constructor() { throw new Error('no ws'); } } });
  assert.equal(await gw.check(), 'online');
  assert.equal(gw.ai, true);
  const list = await gw.missions();
  assert.ok(list.some((m) => m.id === 'm4_delivery'));

  const { run_id, config } = await gw.startRun({ mission_id: 'm4_delivery', player: 'tes' });
  assert.equal(gw.official, true);
  const run = new MissionRun('m4_delivery', config, (t, e) => gw.event(run_id, e));
  const m = config.mission;
  const sim = { mode: 'flying', pos: [m.pickup.x, 1.5, m.pickup.z], vel: [0, 0, 0], yaw: 0, collisionCount: 0 };
  run.step(1 / 60, sim, 100, 0, 0);
  run.pickupDrop(sim);
  sim.pos = [m.drop.x, 1.5, m.drop.z];
  run.t = 90; run.step(1 / 60, sim, 100, 0, 0);
  run.pickupDrop(sim);
  await new Promise((r) => setTimeout(r, 50)); // events are fire-and-forget
  const res = await gw.finish(run_id, { t_ms: 90000, battery: 80, reason: 'completed' });
  assert.ok(res.score >= 85, `score ${res.score}`);
  assert.equal(res.breakdown.length, 5);
  assert.deepEqual(res.score, run.result(80).score); // server and local scoring agree

  const local = await gw.command('naik 5 meter lalu foto');
  assert.equal(local.ok, true);
  assert.equal(local.source, 'local');
  const llm = await gw.command('foto hotel dari tiga sudut');
  assert.equal(llm.source, 'llm');
  assert.ok(llm.script.includes('photo()'));
  assert.equal((await gw.detect('abc')).objects.length, 0);
  assert.equal((await gw.decide([0, 1])).action.forward, 0);
  await s.close();
});

test('AI down: health says so, AI calls fail softly, missions still work; server gone: stub mode', async () => {
  const s = await boot({ ai: false });
  const gw = createGateway(s.url);
  assert.equal(await gw.check(), 'online');
  assert.equal(gw.ai, false);
  const r = await gw.command('naik');
  assert.deepEqual([r.ok, r.reason], [false, 'ai_down']);
  const run = await gw.startRun({ mission_id: 'm4_delivery' });
  assert.ok(run.config.mission);
  await s.close();

  const gone = createGateway(s.url);
  assert.equal(await gone.check(), 'stub');
  const r2 = await gone.command('naik');
  assert.deepEqual([r2.ok, r2.reason], [false, 'offline']);
  assert.ok((await gone.startRun({ mission_id: 'm4_delivery' })).config.mission); // simulator keeps working
});

test('AI dies while the simulator is running: one failed call flips the indicator, nothing throws', async () => {
  const s = await boot({ ai: true });
  const gw = createGateway(s.url);
  await gw.check();
  assert.equal(gw.ai, true);
  s.state.ai = false;
  const r = await gw.command('foto hotel');
  assert.equal(r.ok, false);
  assert.equal(gw.ai, false);
  await s.close();
});

// ---- WebSocket telemetry and the new missions over a real socket ----
import { wsParse } from '../mock-server/server.js';
import { makeMissionConfig } from '../src/worldconfig.js';
import { Flight } from '../src/flight.js';
import { DroneDamage } from '../src/damage.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('wsParse reads masked frames of all three length forms', () => {
  const mask = [1, 2, 3, 4];
  const frame = (text) => {
    const d = Buffer.from(text), n = d.length;
    const head = n < 126 ? Buffer.from([0x81, 0x80 | n]) : Buffer.from([0x81, 0x80 | 126, n >> 8, n & 255]);
    return Buffer.concat([head, Buffer.from(mask), Buffer.from(d.map((b, i) => b ^ mask[i & 3]))]);
  };
  const a = 'x'.repeat(10), b = 'y'.repeat(300);
  const both = Buffer.concat([frame(a), frame(b)]);
  const { frames, rest } = wsParse(both);
  assert.deepEqual(frames.map((f) => f.text), [a, b]);
  assert.equal(rest.length, 0);
  // an incomplete frame stays in the buffer
  assert.equal(wsParse(both.subarray(0, 20)).frames.length, 1);
});

test('M3 over HTTP + WebSocket: telemetry frames reach the server and count in the official score', async () => {
  const s = await boot({ ai: true });
  const gw = createGateway(s.url);
  await gw.check();
  const { run_id, config } = await gw.startRun({ mission_id: 'm3_agri', variant: 'lahan', player: 'tes' });
  assert.ok(config.mission.field);
  await sleep(100); // socket opens
  const f = config.mission.field;
  const hints = [];
  // fly the middle row of the field spraying, 10 Hz
  let t = 0;
  for (let x = f.min[0]; x <= f.max[0]; x += 0.3) {
    t += 100;
    gw.telemetry({ t_ms: t, pos: [x, 5, (f.min[1] + f.max[1]) / 2], vel: [3, 0, 0], yaw: 90, roll: 0, pitch: 0, gimbal: -10, battery: 15, payload_kg: 0, spraying: true, collision: false });
  }
  await sleep(150);
  const res = await gw.finish(run_id, { t_ms: t, battery: 15, reason: 'completed' });
  const cov = res.breakdown.find((b) => b.name === 'Cakupan').points, tank = res.breakdown.find((b) => b.name === 'Manajemen tangki').points;
  assert.ok(cov > 0, `coverage ${cov}`);
  assert.equal(tank, 10);
  const none = await gw.startRun({ mission_id: 'm3_agri', player: 'x' });
  const res2 = await gw.finish(none.run_id, { t_ms: 1000, battery: 90, reason: 'completed' });
  assert.equal(res2.breakdown.find((b) => b.name === 'Cakupan').points, 0, 'without telemetry nothing was sprayed');
  await s.close();
});

test('M5 over HTTP: variants, run config, report endpoint and the score agree with the local run', async () => {
  const s = await boot({ ai: true });
  const gw = createGateway(s.url, { WebSocketImpl: class { constructor() { throw new Error('no ws'); } } });
  await gw.check();
  const list = await gw.missions();
  assert.deepEqual(list.find((m) => m.id === 'm5_inspeksi').variants, ['gedung', 'jembatan']);
  const { run_id, config } = await gw.startRun({ mission_id: 'm5_inspeksi', variant: 'jembatan', player: 'tes' });
  assert.equal(config.mission.variant, 'jembatan');
  const run = new MissionRun('m5_inspeksi', config, (t, e) => gw.event(run_id, e));
  const d = config.mission.defects[0];
  const sim = new Flight(); sim.damage = new DroneDamage(); sim.mode = 'flying';
  sim.pos = [d.x + d.nx * 5, d.y, d.z + d.nz * 5];
  sim.yaw = sim.prevYaw = (Math.atan2(-d.nx, d.nz) * 180 / Math.PI + 360) % 360;
  run.gimbal = 0;
  run.step(1 / 60, sim, 100, 0, 0);
  run.photo(sim); run.t += 1; run.mark(sim);
  await sleep(80);
  run.endNow();
  const res = await gw.finish(run_id, { t_ms: run.tMs, battery: 80, reason: 'completed' });
  assert.equal(res.score, run.result(80).score);
  const rep = await gw.report(run_id);
  assert.equal(rep.defects.length, config.mission.defects.length);
  assert.ok(rep.defects.some((x) => x.photographed && x.marked));
  assert.ok(rep.coverage >= 0);
  await s.close();
});

test('M1 and M2 start over HTTP with every variant', async () => {
  const s = await boot({ ai: true });
  const gw = createGateway(s.url, { WebSocketImpl: class { constructor() { throw new Error('no ws'); } } });
  await gw.check();
  for (const [id, v] of [['m1_sar', 'gedung'], ['m1_sar', 'hutan'], ['m2_foto', 'hotel'], ['m2_foto', 'gunung']]) {
    const r = await gw.startRun({ mission_id: id, variant: v, player: 'tes' });
    assert.deepEqual(r.config, makeMissionConfig(id, 42, v));
    assert.equal(r.config.mission.variant, v);
  }
  await s.close();
});
