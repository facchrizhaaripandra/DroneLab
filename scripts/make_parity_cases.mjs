// Builds scoring cases with the JavaScript scorer as the reference; the Python scorers must give the same result.
//   node scripts/make_parity_cases.mjs     -> backend/tests/parity/<mission_id>.json
// Logs are synthetic but deterministic (seeded). At equal t_ms events come before samples, like in the simulator.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { project, bearing } from '../src/camera-model.js';
import { scoreFromEvents } from '../src/scoring.js';
import { buildExport } from './export_worlds.mjs';

const CASES_PER_MISSION = 24;
const REASONS = ['completed', 'completed', 'completed', 'timeout', 'battery', 'crashed', 'drowned', 'out_of_area'];

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
const between = (r, a, b) => round(a + r() * (b - a));
const int = (r, a, b) => Math.floor(a + r() * (b - a + 1));
const one = (r, list) => list[Math.floor(r() * list.length)];
const DEG = Math.PI / 180;

const pose = (pos, yaw = 0, pitch = 0, roll = 0) => ({ pos: pos.map((v) => round(v)), yaw: round(yaw, 1), pitch: round(pitch, 1), zoom: 1, roll: round(roll, 1) });
const sample = (t_ms, pos, extra = {}) => ({ t_ms, type: 'sample', pos: pos.map((v) => round(v)), vel: [0, 0, 0], yaw: 0, gimbal: -10, spraying: false, ...extra });

// A camera position `dist` m from a point, looking at it.
function lookingAt(r, target, dist, bearingDeg, height) {
  const pos = [target[0] + Math.sin(bearingDeg * DEG) * dist, target[1] + height, target[2] - Math.cos(bearingDeg * DEG) * dist];
  const yaw = (bearing(pos[0], pos[2], target[0], target[2]) + between(r, -25, 25) + 360) % 360;
  const pitch = Math.atan2(target[1] - pos[1], dist) / DEG + between(r, -10, 10);
  return pose(pos, yaw, Math.max(-90, Math.min(30, pitch)), one(r, [0, 0, 2, 7, -12, 20]));
}

function visibleOf(p, objects) {
  const out = [];
  for (const o of objects) {
    const pr = project(p, o);
    if (!pr || pr.dist > 60) continue;
    out.push({ label: o.label, id: o.id, dist: round(pr.dist, 1), area: round(pr.area, 4), box: pr.box.map((b) => round(b)) });
  }
  return out;
}

function noise(r, log, tMax) { // collisions that any mission can have
  for (let i = int(r, 0, 4); i > 0; i--) log.push({ t_ms: int(r, 0, tMax), type: 'collision', pose: pose([0, 3, 0]) });
}
function zones(r, log, kind, tMax) {
  for (let i = int(r, 0, 2); i > 0; i--) {
    const t = int(r, 0, tMax - 12000);
    log.push({ t_ms: t, type: 'zone_enter', kind, pose: pose([0, 3, 0]) });
    if (r() < 0.8) log.push({ t_ms: t + int(r, 200, 12000), type: 'zone_exit', kind, pose: pose([0, 3, 0]) });
  }
}

const GENERATORS = {
  m1_sar(r, c, log, tMax) {
    const m = c.mission;
    for (let i = int(r, 0, 8); i > 0; i--) {
      const v = one(r, m.victims);
      const near = r() < 0.7;
      const p = pose([v.x + between(r, -3, 3) + (near ? 0 : 20), (v.y || 0) + between(r, 1, 6), v.z + between(r, -3, 3)]);
      const seen = r() < 0.8 ? [{ label: 'person', id: v.id, dist: 4, area: 0.01, box: [0.4, 0.4, 0.1, 0.1] }] : [];
      log.push({ t_ms: int(r, 0, tMax), type: 'mark', pose: p, visible: seen });
    }
    const a = m.area;
    for (let i = int(r, 0, 90); i > 0; i--) {
      log.push(sample(int(r, 0, tMax / 100) * 100, [between(r, a.min[0] - 5, a.max[0] + 5), r() < 0.2 ? between(r, 0, 0.49) : between(r, 0.5, 30), between(r, a.min[1] - 5, a.max[1] + 5)]));
    }
    zones(r, log, 'fire', tMax);
  },
  m2_foto(r, c, log, tMax) {
    const m = c.mission;
    const objects = m.landmarks.map((l) => ({ label: 'landmark', ...l }));
    for (let i = int(r, 0, 5); i > 0; i--) {
      const l = one(r, m.landmarks);
      const p = lookingAt(r, [l.x, l.y, l.z], between(r, 8, 55), between(r, 0, 360), between(r, 0, 25));
      log.push({ t_ms: int(r, 0, tMax), type: 'photo', pose: p, visible: r() < 0.9 ? visibleOf(p, objects) : [], speed: one(r, [0, 0.3, 0.9, 1.75, 4]), yaw_rate: one(r, [0, -5, 25, -35, 90]) });
    }
    let t = int(r, 0, 4) * 1000;
    for (let k = int(r, 0, 3); k > 0; k--) {
      const subject = one(r, m.shots).subject;
      const l = m.landmarks.find((x) => x.id === subject);
      const start = t, n = int(r, 1, 40), sweep = between(r, 0, 200), radius = between(r, 15, 40), a0 = between(r, 0, 360);
      const climb = between(r, 0, 14), out = between(r, 0, 10), look = between(r, -20, 0);
      log.push({ t_ms: start, type: 'record_start', pose: pose([0, 5, 0]) });
      for (let i = 0; i < n; i++) {
        const f = n > 1 ? i / (n - 1) : 0, ang = (a0 + sweep * f) * DEG, d = radius + out * f;
        const pos = [l.x + Math.sin(ang) * d, l.y + 2 + climb * f, l.z - Math.cos(ang) * d];
        const jitter = () => between(r, -0.6, 0.6);
        log.push(sample(start + i * 500, pos, {
          vel: [round(Math.cos(ang) * 2 + jitter()), jitter(), round(Math.sin(ang) * 2 + jitter())],
          yaw: round((bearing(pos[0], pos[2], l.x, l.z) + (r() < 0.8 ? 0 : 70)) % 360, 1), gimbal: round(look, 1),
        }));
      }
      t = start + (n - 1) * 500 + int(r, 0, 3) * 1000;
      if (!(k === 1 && r() < 0.15)) log.push({ t_ms: t, type: 'record_stop', pose: pose([0, 5, 0]) }); // sometimes left open
      t += 1500;
    }
  },
  m3_agri(r, c, log, tMax) {
    const f = c.mission.field;
    if (r() < 0.75) log.push({ t_ms: 0, type: 'wind', wind: { speed: between(r, 0, 9), dir: int(r, 0, 359), gust: 0.2 } });
    let t = 0;
    for (let k = int(r, 0, 6); k > 0; k--) {
      const z = between(r, f.min[1] - 2, f.max[1] + 2), alt = between(r, 1, 11), speed = between(r, 0, 6), spraying = r() < 0.85;
      let x = f.min[0] + between(r, -4, 6);
      for (let i = int(r, 5, 45); i > 0; i--) {
        t += one(r, [100, 100, 100, 200, 500]);
        x += speed * 0.1;
        log.push(sample(t, [x, alt, z], { vel: [speed, 0, 0], spraying }));
      }
      if (r() < 0.5) log.push({ t_ms: t, type: 'refill', pose: pose(r() < 0.8 ? [1, 0, 1] : [30, 0, 30]) });
    }
  },
  m4_delivery(r, c, log, tMax) {
    const m = c.mission;
    log.push({ t_ms: int(r, 0, tMax / 2), type: 'pickup', pose: pose([m.pickup.x, 2, m.pickup.z]) });
    if (r() < 0.75) {
      const d = between(r, 0, 10), a = between(r, 0, 360) * DEG;
      log.push({ t_ms: int(r, tMax / 2, tMax), type: 'drop', pose: pose([m.drop.x + Math.sin(a) * d, 2, m.drop.z - Math.cos(a) * d]) });
    }
    zones(r, log, 'nofly', tMax);
  },
  m5_inspeksi(r, c, log, tMax) {
    const m = c.mission, s = m.structure;
    const objects = m.defects.map((d) => ({ label: 'defect', id: d.id, x: d.x, y: d.y, z: d.z, hx: d.size / 2, hy: d.size / 2 }));
    for (let i = int(r, 0, 14); i > 0; i--) {
      const target = r() < 0.6 ? one(r, m.defects) : one(r, m.panels);
      const dist = between(r, 3, 14), side = between(r, -3, 3);
      const pos = [target.x + target.nx * dist + (target.nx === 0 ? side : 0), target.y + between(r, -1, 1), target.z + target.nz * dist + (target.nz === 0 ? side : 0)];
      const p = pose(pos, bearing(pos[0], pos[2], target.x, target.z), between(r, -8, 8));
      const visible = visibleOf(p, objects);
      const t = int(r, 0, tMax);
      if (r() < 0.85) log.push({ t_ms: t, type: 'photo', pose: p, visible, speed: one(r, [0, 0.4, 1.2, 1.75, 3.5]), yaw_rate: one(r, [0, 8, -30, 70]) });
      if (r() < 0.65) log.push({ t_ms: t + 400, type: 'mark', pose: p, visible: r() < 0.9 ? visible : [] });
    }
    for (let i = int(r, 0, 80); i > 0; i--) {
      log.push(sample(int(r, 0, tMax / 100) * 100, [
        between(r, s.x - s.w / 2 - 22, s.x + s.w / 2 + 22), r() < 0.1 ? 0.2 : between(r, s.y0, s.y1 + 8), between(r, s.z - s.d / 2 - 22, s.z + s.d / 2 + 22)]));
    }
  },
};

export function buildCases() {
  const { missions, worlds } = buildExport();
  const out = {};
  missions.forEach((mission, mi) => {
    const own = worlds.filter((w) => w.mission_id === mission.id);
    out[mission.id] = Array.from({ length: CASES_PER_MISSION }, (_, i) => {
      const r = rng((mi + 1) * 10000 + i);
      const world = own[i % own.length];
      const config = JSON.parse(JSON.stringify(world.config));
      if (i % 11 === 10) config.weights = { [Object.keys(mission.weights)[0]]: 55 }; // per-world weight override
      const tMax = Math.round(mission.par_time_s * 1000 * one(r, [0.3, 0.8, 1.2, 2]));
      const log = [{ t_ms: 0, type: 'takeoff', pose: pose([0, 0, 0]) }];
      if (i > 0) { // case 0 stays empty: a run in which nothing happened
        GENERATORS[mission.id](r, config, log, tMax);
        noise(r, log, tMax);
      }
      log.sort((a, b) => a.t_ms - b.t_ms || (a.type === 'sample') - (b.type === 'sample'));
      const finish = {
        t_ms: i % 7 === 6 ? Math.round(mission.par_time_s * 2500) : Math.max(tMax, log.at(-1).t_ms),
        battery: int(r, 0, 100), reason: REASONS[i % REASONS.length],
      };
      const input = JSON.parse(JSON.stringify({ name: `${mission.id}-${world.variant}-${i}`, config, log, finish }));
      return { ...input, expected: JSON.parse(JSON.stringify(scoreFromEvents(mission.id, input.config, input.log, input.finish))) };
    });
  });
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = new URL('../backend/tests/parity/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [id, cases] of Object.entries(buildCases())) {
    writeFileSync(new URL(`${id}.json`, dir), `[\n${cases.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`);
    console.log(id, cases.length, 'cases, scores', [...new Set(cases.map((c) => c.expected.score))].length, 'distinct');
  }
}
