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
