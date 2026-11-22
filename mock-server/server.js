// Mock gateway for testing the simulator without Orang 2 and Orang 3. Node 18+, no dependencies.
//   node mock-server/server.js          (port 8000, or PORT=...)
//   MOCK_AI=down node mock-server/server.js   -> /health says "ai": "down" (simulates a dead AI service)
// Follows DRONELAB_SHARED.md section 5. Limitation: no WebSocket telemetry (the simulator ignores that failure).
import http from 'node:http';
import { MISSIONS, scoreFromEvents } from '../src/missions.js';
import { makeMissionConfig } from '../src/worldconfig.js';
import { parseNatural } from '../src/nlparse.js';

export function createMockServer({ ai = process.env.MOCK_AI !== 'down' } = {}) {
  const runs = new Map();
  const board = [];
  let n = 0;
  const state = { ai };

  const send = (res, code, body) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end(JSON.stringify({ api_version: '1', ...body }));
  };
  const err = (res, code, c, message) => send(res, code, { error: { code: c, message } });
  const readBody = (req) => new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', ai: state.ai ? 'ok' : 'down' });
    if (req.method === 'GET' && path === '/api/v1/missions') {
      return res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }),
        res.end(JSON.stringify(MISSIONS.filter((m) => m.available).map(({ id, title, par_time_s }) => ({ id, title, variants: ['kota'], par_time_s }))));
    }
    if (req.method === 'GET' && path === '/api/v1/leaderboard') {
      const id = url.searchParams.get('mission_id');
      const top = board.filter((b) => !id || b.mission_id === id).sort((a, b) => b.score - a.score)
        .slice(0, Number(url.searchParams.get('limit') || 10)).map((b, i) => ({ rank: i + 1, player: b.player, score: b.score }));
      return res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }), res.end(JSON.stringify(top));
    }
    if (req.method !== 'POST') return err(res, 404, 'not_found', 'Jalur tidak ada');
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_json', 'Body bukan JSON');

    if (path === '/api/v1/runs') {
      if (!MISSIONS.some((m) => m.id === body.mission_id && m.available)) return err(res, 404, 'unknown_mission', 'Misi tidak dikenal');
      const seed = 42, run_id = `r_${++n}`;
      const config = makeMissionConfig(body.mission_id, seed);
      runs.set(run_id, { mission_id: body.mission_id, player: body.player || 'anon', config, log: [] });
      return send(res, 200, { run_id, seed, config });
    }
    let m = /^\/api\/v1\/runs\/([^/]+)\/(events|finish)$/.exec(path);
    if (m) {
      const run = runs.get(m[1]);
      if (!run) return err(res, 404, 'unknown_run', 'Run tidak ditemukan');
      if (m[2] === 'events') { run.log.push(body); return send(res, 200, { ok: true }); }
      const result = scoreFromEvents(run.mission_id, run.config, run.log, body);
      board.push({ mission_id: run.mission_id, player: run.player, score: result.score });
      return send(res, 200, result);
    }
    if (path.startsWith('/api/v1/') && ['detect', 'decide', 'command'].some((k) => path.endsWith(k)) && !state.ai) {
      return err(res, 503, 'ai_down', 'Layanan AI tidak aktif');
    }
    if (path === '/api/v1/detect') return send(res, 200, { objects: [], latency_ms: 1, model: 'mock' });
    if (path === '/api/v1/decide') return send(res, 200, { action: { yaw: 0, climb: 0, strafe: 0, forward: 0 }, policy: 'mock' });
    if (path === '/api/v1/command') {
      const local = parseNatural(body.text || '');
      if (local) return send(res, 200, local);
      // Pretend to be the LLM for anything the local parser cannot do.
      return send(res, 200, { script: 'takeoff(8);\nphoto();\nrotate(120);\nphoto();\nrotate(120);\nphoto();\nreturn_home();', warnings: ['mock LLM: jawaban contoh tetap'], source: 'llm' });
    }
    return err(res, 404, 'not_found', 'Jalur tidak ada');
  });
  return { server, state };
}

// Started directly (not imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8000);
  const { server, state } = createMockServer();
  server.listen(port, () => console.log(`Mock gateway on http://localhost:${port} (AI ${state.ai ? 'ok' : 'down'})`));
}
