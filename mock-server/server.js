// Mock gateway for testing the simulator without Orang 2 and Orang 3. Node 18+, no dependencies.
//   node mock-server/server.js          (port 8000, or PORT=...)
//   MOCK_AI=down node mock-server/server.js   -> /health says "ai": "down" (simulates a dead AI service)
// Follows DRONELAB_SHARED.md section 5, including the WebSocket telemetry (a small hand-written RFC 6455
// server: text frames in, a "hint" back when the battery is low). Telemetry frames become 'sample' entries
// of the run log, which the scorers use (coverage, spray dose, video smoothness, safe distance).
import http from 'node:http';
import crypto from 'node:crypto';
import { MISSIONS, scoreFromEvents } from '../src/missions.js';
import { inspectionReport } from '../src/scoring.js';
import { makeMissionConfig } from '../src/worldconfig.js';
import { parseNatural } from '../src/nlparse.js';

// ---- minimal WebSocket server side (no dependencies) ----
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsSend(socket, text, opcode = 1) {
  const data = Buffer.from(text);
  const n = data.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : null;
  if (!head) return; // the mock never sends big frames
  socket.write(Buffer.concat([head, data]));
}
// Reads every complete client frame in `buf`; returns { frames: [{opcode, text}], rest }.
export function wsParse(buf) {
  const frames = [];
  let o = 0;
  while (buf.length - o >= 2) {
    const opcode = buf[o] & 15, masked = (buf[o + 1] & 128) !== 0;
    let len = buf[o + 1] & 127, p = o + 2;
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length - p < 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    if (buf.length - p < len + (masked ? 4 : 0)) break;
    let payload;
    if (masked) {
      const key = buf.subarray(p, p + 4); p += 4;
      payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = buf[p + i] ^ key[i & 3];
    } else payload = buf.subarray(p, p + len);
    frames.push({ opcode, text: payload.toString('utf8') });
    o = p + len;
  }
  return { frames, rest: buf.subarray(o) };
}

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
        res.end(JSON.stringify(MISSIONS.filter((m) => m.available).map(({ id, title, par_time_s, variants }) => ({ id, title, variants: variants || ['kota'], par_time_s }))));
    }
    if (req.method === 'GET' && path === '/api/v1/leaderboard') {
      const id = url.searchParams.get('mission_id'), variant = url.searchParams.get('variant');
      const top = board.filter((b) => (!id || b.mission_id === id) && (!variant || b.variant === variant)).sort((a, b) => b.score - a.score)
        .slice(0, Number(url.searchParams.get('limit') || 10)).map((b, i) => ({ rank: i + 1, player: b.player, score: b.score }));
      return res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }), res.end(JSON.stringify(top));
    }
    const rep = /^\/api\/v1\/runs\/([^/]+)\/report$/.exec(path);
    if (req.method === 'GET' && rep) {
      const run = runs.get(rep[1]);
      if (!run) return err(res, 404, 'unknown_run', 'Run tidak ditemukan');
      if (run.mission_id !== 'm5_inspeksi') return err(res, 404, 'no_report', 'Laporan hanya untuk inspeksi');
      return send(res, 200, inspectionReport(run.config, run.log));
    }
    if (req.method !== 'POST') return err(res, 404, 'not_found', 'Jalur tidak ada');
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_json', 'Body bukan JSON');

    if (path === '/api/v1/runs') {
      if (!MISSIONS.some((m) => m.id === body.mission_id && m.available)) return err(res, 404, 'unknown_mission', 'Misi tidak dikenal');
      const seed = 42, run_id = `r_${++n}`;
      const def = MISSIONS.find((m) => m.id === body.mission_id);
      const variant = def.variants ? (def.variants.includes(body.variant) ? body.variant : def.variants[0]) : undefined;
      const config = makeMissionConfig(body.mission_id, seed, variant);
      runs.set(run_id, { mission_id: body.mission_id, variant, player: body.player || 'anon', config, log: [] });
      return send(res, 200, { run_id, seed, config });
    }
    let m = /^\/api\/v1\/runs\/([^/]+)\/(events|finish)$/.exec(path);
    if (m) {
      const run = runs.get(m[1]);
      if (!run) return err(res, 404, 'unknown_run', 'Run tidak ditemukan');
      if (m[2] === 'events') { run.log.push(body); return send(res, 200, { ok: true }); }
      const result = scoreFromEvents(run.mission_id, run.config, run.log, body);
      board.push({ mission_id: run.mission_id, variant: run.variant, player: run.player, score: result.score });
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

  // WebSocket telemetry: WS /ws/v1/runs/{run_id}
  server.on('upgrade', (req, socket) => {
    const m = /^\/ws\/v1\/runs\/([^/?]+)/.exec(req.url);
    const run = m && runs.get(m[1]);
    const key = req.headers['sec-websocket-key'];
    if (!run || !key) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buf = Buffer.alloc(0), hinted = false;
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const { frames, rest } = wsParse(buf);
      buf = rest;
      for (const f of frames) {
        if (f.opcode === 8) { socket.end(); return; }
        if (f.opcode === 9) { wsSend(socket, f.text, 10); continue; }
        if (f.opcode !== 1) continue;
        let frame;
        try { frame = JSON.parse(f.text); } catch { continue; }
        if (typeof frame.t_ms !== 'number' || !Array.isArray(frame.pos)) continue;
        run.log.push({ ...frame, type: 'sample' });
        if (!hinted && frame.battery <= 20) { hinted = true; wsSend(socket, JSON.stringify({ type: 'hint', text: 'Baterai rendah' })); }
      }
    });
    socket.on('error', () => {});
  });
  return { server, state };
}

// Started directly (not imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8000);
  const { server, state } = createMockServer();
  server.listen(port, () => console.log(`Mock gateway on http://localhost:${port} (AI ${state.ai ? 'ok' : 'down'})`));
}
