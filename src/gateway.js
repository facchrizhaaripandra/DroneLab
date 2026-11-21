// Gateway client (Orang 3). The simulator only talks to the gateway, never to the AI service.
// If the gateway is not reachable, a local stub takes over so missions still work (provisional score).
import { MISSIONS, getMission, scoreFromEvents } from './missions.js';
import { makeMissionConfig } from './worldconfig.js';

const TIMEOUT_MS = 1500;

// Offline stand-in. Same shape as the real API: it scores from the event log, never from client numbers.
export function createStubGateway() {
  const runs = new Map();
  let n = 0;
  return {
    name: 'stub',
    async missions() { return MISSIONS.map(({ id, title, par_time_s }) => ({ id, title, par_time_s, variants: ['kota'] })); },
    async startRun({ mission_id }) {
      const seed = 42;
      const run_id = `local_${++n}`;
      const config = makeMissionConfig(mission_id, seed);
      runs.set(run_id, { mission_id, config, log: [] });
      return { api_version: '1', run_id, seed, config };
    },
    async event(run_id, body) { runs.get(run_id)?.log.push(body); return { ok: true }; },
    async finish(run_id, body) {
      const r = runs.get(run_id);
      return { api_version: '1', ...scoreFromEvents(r.mission_id, r.config, r.log, body) };
    },
    telemetry() {},
  };
}

const fetchJson = async (f, url, opts) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, { ...opts, signal: ctl.signal, headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
};

// fetchImpl and WebSocketImpl are injectable so the fallback logic can be tested without a network.
export function createGateway(baseUrl, { fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket } = {}) {
  const stub = createStubGateway();
  let online = false;
  let ws = null;
  let current = null; // 'real' | 'stub' for the run in progress

  const api = {
    get mode() { return online ? 'online' : 'stub'; },
    // Health check. Never throws; sets the mode shown in the HUD.
    async check() {
      try {
        const h = await fetchJson(fetchImpl, `${baseUrl}/health`);
        online = h.status === 'ok';
      } catch { online = false; }
      return api.mode;
    },
    async missions() {
      if (online) { try { return await fetchJson(fetchImpl, `${baseUrl}/api/v1/missions`); } catch { online = false; } }
      return stub.missions();
    },
    async startRun(body) {
      if (online) {
        try {
          const res = await fetchJson(fetchImpl, `${baseUrl}/api/v1/runs`, { method: 'POST', body: JSON.stringify(body) });
          current = 'real';
          openSocket(res.run_id);
          return res;
        } catch { online = false; }
      }
      current = 'stub';
      return stub.startRun(body);
    },
    // Fire and forget: a lost event must never stop the simulation.
    event(run_id, body) {
      if (current !== 'real') return stub.event(run_id, body);
      return fetchJson(fetchImpl, `${baseUrl}/api/v1/runs/${run_id}/events`, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
    },
    async finish(run_id, body) {
      closeSocket();
      if (current === 'real') {
        try { return await fetchJson(fetchImpl, `${baseUrl}/api/v1/runs/${run_id}/finish`, { method: 'POST', body: JSON.stringify(body) }); }
        catch { /* fall through: no official score available */ }
        return { offline: true };
      }
      return stub.finish(run_id, body);
    },
    // 10 Hz telemetry over WebSocket (real gateway only).
    telemetry(frame) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(frame));
    },
    get official() { return current === 'real'; },
  };

  function openSocket(run_id) {
    try {
      const url = baseUrl.replace(/^http/, 'ws') + `/ws/v1/runs/${run_id}`;
      ws = new WebSocketImpl(url);
      ws.onerror = () => {};
    } catch { ws = null; }
  }
  function closeSocket() { try { ws && ws.close(); } catch { /* ignore */ } ws = null; }
  return api;
}
