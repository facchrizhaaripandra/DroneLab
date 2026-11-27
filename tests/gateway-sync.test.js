// Two things that keep the official score equal to what the pilot saw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { replayAgri } from '../src/scoring.js';
import { createGateway } from '../src/gateway.js';
import { makeRunConfig } from '../src/scenarios.js';

function sprayLog(field) {
  const log = [];
  for (let i = 0; i <= 40; i++) {
    const pos = [(field.min[0] + field.max[0]) / 2, 5, (field.min[1] + field.max[1]) / 2];
    log.push({ t_ms: i * 100, type: 'sample', pos, vel: [0, 0, 0], spraying: true });
  }
  return log;
}

test('M3: the wind event of the run wins over the wind in the config', () => {
  const config = makeRunConfig('m3_agri', 42, 'lahan');
  const calm = { ...config, wind: { speed: 0, dir: 0 } };
  const wind = { speed: 6, dir: 90 };
  const log = sprayLog(config.mission.field);
  const withEvent = replayAgri(calm, [{ t_ms: 0, type: 'wind', wind }, ...log]);
  const withConfig = replayAgri({ ...config, wind }, log);
  assert.deepEqual(Array.from(withEvent.dose), Array.from(withConfig.dose));
  assert.notDeepEqual(Array.from(withEvent.dose), Array.from(replayAgri(calm, log).dose), 'the wind must matter here');
});

test('finish is sent only after every event has reached the gateway', async () => {
  const arrived = [];
  const reply = (body) => ({ ok: true, json: async () => body });
  const fetchImpl = async (url) => {
    if (url.endsWith('/health')) return reply({ status: 'ok', ai: 'down' });
    if (url.endsWith('/runs')) return reply({ run_id: 'r_1', seed: 42, config: {} });
    if (url.endsWith('/events')) await new Promise((r) => setTimeout(r, 50)); // a slow event
    arrived.push(url.split('/').pop());
    return reply({ ok: true });
  };
  const gw = createGateway('http://gateway.test', { fetchImpl, WebSocketImpl: class { close() {} } });
  await gw.check();
  const { run_id } = await gw.startRun({ mission_id: 'm4_delivery' });
  gw.event(run_id, { t_ms: 1, type: 'drop' }); // fire and forget, as main.js does
  await gw.finish(run_id, { t_ms: 2, battery: 80, reason: 'completed' });
  assert.deepEqual(arrived, ['events', 'finish']);
});
