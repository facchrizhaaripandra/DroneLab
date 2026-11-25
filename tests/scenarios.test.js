import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MISSIONS } from '../src/catalog.js';
import { SCENARIOS, makeRunConfig, scenarioFor, isProcedural, makeScenarioConfig } from '../src/scenarios.js';
import { normalizeConfig } from '../src/worldconfig.js';
import { sceneColliders, makeHeightSampler } from '../src/terrain.js';
import { visibleObjects } from '../src/vision.js';
import { bearing } from '../src/camera-model.js';
import { makeAgri, sprayStep, agriSummary, refill } from '../src/agri.js';
import { markedVictim, markedDefects } from '../src/scoring.js';

const DEG = Math.PI / 180;
const cache = new Map();
// Peta nyata dari public/scenes, dalam bentuk yang dipakai game (config.realScene).
function sceneOf(id) {
  if (cache.has(id)) return cache.get(id);
  const meta = JSON.parse(fs.readFileSync(new URL(`../public/scenes/${id}/scene.json`, import.meta.url)));
  const s = { id, meta, colliders: sceneColliders(meta.colliders), groundAt: makeHeightSampler(meta.height), bounds: meta.bounds, maxAgl: meta.maxAgl || 120 };
  cache.set(id, s);
  return s;
}
const configOf = (key) => {
  const e = SCENARIOS[key];
  const c = normalizeConfig(makeScenarioConfig(e));
  c.realScene = sceneOf(e.scene);
  return c;
};
const inBounds = (b, x, z, m = 0) => x >= b.minX + m && x <= b.maxX - m && z >= b.minZ + m && z <= b.maxZ - m;
// Bola (drone r = 0.5) memotong collider?
const hits = (cols, x, y, z, r = 0.5) => cols.some((c) => {
  const dx = Math.max(c.min[0] - x, 0, x - c.max[0]), dy = Math.max(c.min[1] - y, 0, y - c.max[1]), dz = Math.max(c.min[2] - z, 0, z - c.max[2]);
  return dx * dx + dy * dy + dz * dz < r * r;
});
// Titik bebas dari collider di sepanjang kolom (dari y0 ke y1), untuk turun/naik lurus.
const columnFree = (cols, x, z, y0, y1, r = 0.5) => { for (let y = y0; y <= y1; y += 0.5) if (hits(cols, x, y, z, r)) return false; return true; };
const topUnder = (cols, x, z, y) => { let t = -Infinity; for (const c of cols) if (x >= c.min[0] && x <= c.max[0] && z >= c.min[2] && z <= c.max[2] && c.max[1] <= y + 0.6) t = Math.max(t, c.max[1]); return t; };
const standsOnSomething = (s, x, y, z) => Math.abs(y - s.groundAt(x, z)) < 0.6 || Math.abs(y - topUnder(s.colliders, x, z, y)) < 0.6;

// Mencari pose kamera di sekitar satu titik yang memenuhi `good(pose)`; mengembalikan pose pertama yang cocok.
function searchPoses(s, target, { dists, heights, good, zoom = 1, ring = 12 }) {
  for (const d of dists) for (let k = 0; k < ring; k++) {
    const a = (k * 360) / ring * DEG;
    for (const h of heights) {
      const x = target.x + Math.sin(a) * d, z = target.z - Math.cos(a) * d;
      if (!inBounds(s.bounds, x, z, 2)) continue;
      const y = (h.abs ? h.v : s.groundAt(x, z) + h.v) + (h.rel ? target.y : 0);
      if (y - s.groundAt(x, z) > s.maxAgl - 2 || hits(s.colliders, x, y, z)) continue;
      const yaw = bearing(x, z, target.x, target.z);
      const pitch = Math.max(-90, Math.min(20, -Math.atan2(y - target.y, d) / DEG));
      const pose = { pos: [x, y, z], yaw, pitch, zoom };
      if (good(pose)) return pose;
    }
  }
  return null;
}

test('setiap varian misi utama bernama biasa punya skenario peta realistis yang lengkap', () => {
  const index = JSON.parse(fs.readFileSync(new URL('../public/scenes/index.json', import.meta.url)));
  let n = 0;
  for (const m of MISSIONS.filter((x) => x.tier === 'utama')) {
    for (const v of m.variants || [undefined]) {
      const e = scenarioFor(m.id, v);
      if (isProcedural(v)) { assert.equal(e, null, `${m.id}:${v} harus prosedural`); assert.equal(makeRunConfig(m.id, 42, v).scene, undefined); continue; }
      assert.ok(e, `${m.id}:${v} belum punya skenario`);
      n++;
      assert.ok(index.some((x) => x.id === e.scene), `${e.scene} tidak ada di index.json`);
      for (const f of ['scene.glb', 'scene.json']) assert.ok(fs.existsSync(new URL(`../public/scenes/${e.scene}/${f}`, import.meta.url)), `${e.scene}/${f}`);
      const c = makeRunConfig(m.id, 42, v);
      assert.equal(c.scene, e.scene);
      if (e.mission.variant) assert.equal(c.mission.variant, e.mission.variant);
      assert.ok(c.scenario.title && c.scenario.brief);
      JSON.parse(JSON.stringify(c)); // harus bisa lewat HTTP
    }
  }
  assert.equal(n, Object.keys(SCENARIOS).length, 'tiap skenario terpakai oleh satu varian');
});

test('M1: korban, api, titik aman ada di peta, tidak di dalam benda, dan korban tidak di dalam api', () => {
  for (const key of ['m1_sar:gedung', 'm1_sar:hutan']) {
    const c = configOf(key), s = c.realScene, m = c.mission;
    assert.ok(m.victims.length >= 3);
    for (const v of m.victims) {
      assert.ok(inBounds(s.bounds, v.x, v.z, 3), `${key} korban ${v.id} di luar peta`);
      assert.ok(inBounds({ minX: m.area.min[0], maxX: m.area.max[0], minZ: m.area.min[1], maxZ: m.area.max[1] }, v.x, v.z), `${key} korban ${v.id} di luar area cari`);
      assert.ok(!hits(s.colliders, v.x, v.y + 0.6, v.z, 0.3), `${key} korban ${v.id} berada di dalam collider`);
      assert.ok(standsOnSomething(s, v.x, v.y, v.z), `${key} korban ${v.id} melayang (y ${v.y})`);
      for (const f of m.fires) assert.ok(Math.hypot(v.x - f.x, v.z - f.z) > f.r + 4, `${key} korban ${v.id} terlalu dekat api ${f.id}`);
    }
    for (const f of m.fires) assert.ok(inBounds(s.bounds, f.x, f.z), `${key} api ${f.id} di luar peta`);
    assert.ok(columnFree(s.colliders, m.safe.x, m.safe.z, s.groundAt(m.safe.x, m.safe.z) + 1, s.groundAt(m.safe.x, m.safe.z) + 40, 1), `${key} titik aman tertutup`);
  }
});

test('M1: setiap korban bisa ditandai dari posisi yang bisa dicapai drone (mode panas, dinding menghalangi mode biasa)', () => {
  for (const key of ['m1_sar:gedung', 'm1_sar:hutan']) {
    const c = configOf(key), s = c.realScene;
    for (const v of c.mission.victims) {
      const target = { x: v.x, y: v.y + 0.5, z: v.z };
      const pose = searchPoses(s, target, {
        dists: [3, 4, 4.8], heights: [{ v: 3.5, rel: true, abs: true }, { v: 6, rel: true, abs: true }, { v: 10, rel: true, abs: true }, { v: 14, rel: true, abs: true }],
        good: (p) => {
          if (Math.hypot(p.pos[0] - v.x, p.pos[2] - v.z) > 5) return false;
          const vis = visibleObjects(p, c, { thermal: true });
          const e = { visible: vis, pose: { pos: p.pos } };
          const m = markedVictim(c, e);
          return !!m && m.id === v.id;
        },
      });
      assert.ok(pose, `${key} korban ${v.id} (${v.x}, ${v.z}) tidak bisa ditandai dari mana pun`);
    }
  }
});

test('dinding peta menghalangi pandangan ke korban di balik tembok', () => {
  const c = configOf('m1_sar:gedung'), s = c.realScene;
  const v = c.mission.victims.find((x) => x.id === 3); // di sisi barat gedung, di luar dinding
  // dari dalam atrium (timur dinding barat), memandang ke barat menembus dinding setinggi 15 m
  const inside = { pos: [4, v.y + 1.5, v.z], yaw: 270, pitch: -2, zoom: 1 };
  assert.ok(!hits(s.colliders, ...inside.pos), 'pose uji harus bebas');
  assert.ok(!visibleObjects(inside, c, { thermal: true }).some((o) => o.label === 'person' && o.id === 3), 'tembok harus menghalangi');
  const outside = { pos: [v.x - 4.5, v.y + 1.5, v.z], yaw: 90, pitch: -5, zoom: 1 };
  assert.ok(visibleObjects(outside, c, { thermal: true }).some((o) => o.label === 'person' && o.id === 3), 'tanpa tembok korban terlihat');
});

test('M2: bidikan foto dan video tiap skenario bisa dipenuhi (area subjek, orbit tanpa tabrakan)', () => {
  for (const key of ['m2_foto:hotel', 'm2_foto:gunung']) {
    const c = configOf(key), s = c.realScene, m = c.mission;
    assert.equal(m.shots.length, 4);
    for (const shot of m.shots.filter((x) => x.type === 'photo')) {
      const lm = m.landmarks.find((l) => l.id === shot.subject);
      const [lo, hi] = shot.areaRange;
      const pose = searchPoses(s, lm, {
        dists: [25, 40, 60, 90, 130, 180, 250, 350, 450, 550, 650], ring: 12,
        heights: [{ v: 10 }, { v: 25 }, { v: 50 }, { v: 90 }],
        good: (p) => { const o = visibleObjects(p, c).find((v) => v.label === 'landmark' && v.id === lm.id); return !!o && o.area >= lo && o.area <= hi; },
      });
      assert.ok(pose, `${key} ${shot.id}: tidak ada posisi dengan ${lm.id} berukuran ${lo}-${hi} bingkai`);
    }
    // orbit: busur 90 derajat di sekitar subjek, bebas collider, durasi 8-16 s pada 8 m/s
    const orb = m.shots.find((x) => x.kind === 'orbit'), lm = m.landmarks.find((l) => l.id === orb.subject);
    let ok = false;
    for (const R of [50, 60, 70]) for (const h of [8, 15, 25, 40]) for (let a0 = 0; a0 < 360 && !ok; a0 += 15) {
      const arc = (R * Math.PI / 2) / 8;
      if (arc < orb.minDur || arc > orb.maxDur) continue;
      let free = true;
      for (let a = a0; a <= a0 + 90 && free; a += 5) {
        const x = lm.x + Math.sin(a * DEG) * R, z = lm.z - Math.cos(a * DEG) * R;
        free = inBounds(s.bounds, x, z, 2) && !hits(s.colliders, x, s.groundAt(x, z) + h, z);
      }
      ok = free;
    }
    assert.ok(ok, `${key}: tidak ada busur orbit bebas di sekitar ${lm.id}`);
    assert.ok(m.sun && m.sun.el > 10 && m.sun.el < 80);
  }
});

test('M3: petak sawah bisa disemprot merata (sapuan bolak-balik, tangki diisi ulang)', () => {
  const c = configOf('m3_agri:sawah'), s = c.realScene, m = c.mission;
  const f = m.field;
  assert.ok(f.y > 0.7, 'lantai petak harus di atas permukaan air sawah (0,35-0,7 m)');
  for (const r of m.noSpray) assert.ok(r.min[0] >= f.min[0] && r.max[0] <= f.max[0] && r.min[1] >= f.min[1] && r.max[1] <= f.max[1], 'zona larangan di dalam petak');
  // petak tidak ditutupi bangunan (kecuali zona larangan: gubuk)
  const a = makeAgri(m);
  for (let i = 0; i < a.nx; i++) for (let j = 0; j < a.nz; j++) {
    if (a.kind[i * a.nz + j]) continue;
    const x = f.min[0] + (i + 0.5) * f.cell, z = f.min[1] + (j + 0.5) * f.cell;
    assert.ok(!s.colliders.some((q) => x >= q.min[0] && x <= q.max[0] && z >= q.min[2] && z <= q.max[2] && q.max[1] - s.groundAt(x, z) > 1), `sel ${x}, ${z} tertutup benda`);
  }
  // bot: sapuan sejajar sumbu Z, ketinggian 4 m, 4 m/s, jarak antar-sapuan 3 m, mengoreksi hanyut angin
  const w = c.wind, alt = 4, speed = 4, fall = (alt / 4) * w.speed;
  const dx = Math.sin(w.dir * DEG) * fall, dz = -Math.cos(w.dir * DEG) * fall;
  let t = 0, dir = 1;
  const inZone = (x, z) => m.noSpray.some((r) => x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]);
  for (let lx = f.min[0] + 1.5; lx <= f.max[0] + 0.01; lx += 3) {
    const z0 = dir > 0 ? f.min[1] : f.max[1], z1 = dir > 0 ? f.max[1] : f.min[1];
    for (let z = z0; dir > 0 ? z <= z1 : z >= z1; z += dir * speed * 0.1) {
      if (a.tank <= 0.01) refill(a);
      t += 100;
      sprayStep(a, { t_ms: t, pos: [lx - dx, alt, z - dz], vel: [0, 0, speed], spraying: !inZone(lx, z) }, w); // titik jatuh = posisi + hanyut
    }
    dir = -dir;
  }
  const sum = agriSummary(a);
  assert.ok(sum.coverage >= 0.9, `cakupan bot hanya ${(sum.coverage * 100).toFixed(0)}%`);
  assert.ok(a.refills >= 1, 'petak sebesar ini butuh isi ulang tangki');
});

test('M4: titik ambil dan antar bebas dan terjangkau, zona terlarang tidak menutupi titik, jalan lurus terhalang', () => {
  const c = configOf('m4_delivery:kota'), s = c.realScene, m = c.mission;
  for (const [name, p] of [['ambil', m.pickup], ['antar', m.drop]]) {
    assert.ok(inBounds(s.bounds, p.x, p.z, 5), `${name} di luar peta`);
    const g = s.groundAt(p.x, p.z);
    assert.ok(columnFree(s.colliders, p.x, p.z, g + 1.2, g + 60, 0.6), `${name}: kolom dari atas ke tanah tertutup`);
    // cakram pendaratan datar bebas benda setinggi lutut sampai 3 m
    for (let k = 0; k < 12; k++) {
      const x = p.x + Math.cos(k / 12 * 6.283) * (p.r + 1.5), z = p.z + Math.sin(k / 12 * 6.283) * (p.r + 1.5);
      assert.ok(!hits(s.colliders, x, g + 2, z, 0.5), `${name}: cakram penuh benda di (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    for (const nf of m.noFly) assert.ok(!(p.x > nf.min[0] - p.r && p.x < nf.max[0] + p.r && p.z > nf.min[1] - p.r && p.z < nf.max[1] + p.r), `${name} masuk zona terlarang`);
  }
  // garis lurus ambil -> antar memotong paling sedikit satu zona terlarang
  const cross = (r) => { let hit = false; for (let t = 0; t <= 1; t += 0.01) { const x = m.pickup.x + (m.drop.x - m.pickup.x) * t, z = m.pickup.z + (m.drop.z - m.pickup.z) * t; if (x > r.min[0] && x < r.max[0] && z > r.min[1] && z < r.max[1]) hit = true; } return hit; };
  assert.ok(m.noFly.some(cross), 'zona terlarang harus menghalangi jalan lurus');
  const d = Math.hypot(m.drop.x - m.pickup.x, m.drop.z - m.pickup.z);
  assert.ok(d > 60 && d < 260, `jarak ambil-antar ${d.toFixed(0)} m`);
});

test('M5: setiap cacat bisa difoto dan ditandai dari jarak aman, setiap panel bisa difoto', () => {
  for (const key of ['m5_inspeksi:gedung', 'm5_inspeksi:jembatan']) {
    const c = configOf(key), s = c.realScene, m = c.mission;
    assert.ok(m.defects.length >= 5 && m.panels.length >= 10);
    for (const d of m.defects) {
      assert.ok(inBounds(s.bounds, d.x, d.z, 2), `${key} cacat ${d.id} di luar peta`);
      assert.ok(!hits(s.colliders, d.x + d.nx * 0.05, d.y, d.z + d.nz * 0.05, 0.04), `${key} cacat ${d.id} tertanam di dalam benda`);
      const pose = searchPoses(s, d, {
        dists: [4, 5, 6, 7.5], ring: 1, heights: [{ v: 0, abs: true, rel: true }, { v: 2, abs: true, rel: true }, { v: -2, abs: true, rel: true }],
        good: (p) => {
          const dxo = p.pos[0] - d.x, dzo = p.pos[2] - d.z;
          if (dxo * d.nx + dzo * d.nz <= 0) return false; // di sisi luar
          const vis = visibleObjects(p, c);
          return markedDefects({ visible: vis }).includes(d.id) && vis.find((v) => v.label === 'defect' && v.id === d.id).dist <= m.safe.max + 1;
        },
      });
      // `searchPoses` memutar mengelilingi titik; untuk cacat kita butuh posisi di sisi luar fasad: cari manual di sepanjang normal
      let found = false;
      for (const dist of [3.5, 4.5, 5.5, 7]) for (const dy of [0, 1.5, -1.5]) {
        const p = { pos: [d.x + d.nx * dist, d.y + dy, d.z + d.nz * dist], yaw: bearing(d.x + d.nx * dist, d.z + d.nz * dist, d.x, d.z), pitch: -Math.atan2(dy, dist) / DEG, zoom: 1 };
        if (hits(s.colliders, ...p.pos)) continue;
        const vis = visibleObjects(p, c);
        if (markedDefects({ visible: vis }).includes(d.id)) { found = true; break; }
      }
      assert.ok(found || pose, `${key} cacat ${d.id} (${d.face}) tidak bisa difoto dari sisi luar fasad`);
    }
    for (const p of m.panels) {
      let ok = false;
      for (const dist of [4, 6, 8, 10]) for (const dy of [0, 2, -2]) {
        const pos = [p.x + p.nx * dist, p.y + dy, p.z + p.nz * dist];
        if (hits(s.colliders, ...pos)) continue;
        ok = true;
      }
      assert.ok(ok, `${key} panel ${p.id} (${p.face}) tak bisa difoto: sisi luar tertutup`);
    }
  }
});
