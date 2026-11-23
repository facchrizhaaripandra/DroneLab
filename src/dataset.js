// Dataset export for the YOLO training (Orang 2): pure parts, testable in Node.
// - labelFrame: ground-truth boxes for one camera pose, from the world config (same truth as the `visible` list);
// - planDataset: which worlds and camera poses to render, with domain randomization and a 70/20/10 split by world seed;
// - makeZip: a ZIP writer (stored, no compression) so the browser can save the whole dataset as one file.
// The images are rendered by exporter.js (needs Three.js and a browser).
import { worldObjects } from './vision.js';

export const CLASSES = ['person', 'fire', 'smoke', 'landmark', 'dropzone', 'defect', 'building', 'obstacle', 'target'];
export const SIZE = { w: 640, h: 360 }; // SHARED section 4: JPEG, 640 px wide, 16:9
const DEG = Math.PI / 180;
const VFOV = 70, ASPECT = 16 / 9, TAN = Math.tan((VFOV / 2) * DEG);

// All labeled objects of a world as axis-aligned boxes { label, x, y, z, hx, hy, hz } (half extents in m).
export function datasetObjects(config) {
  const out = [];
  for (const o of worldObjects(config)) {
    const m = config.mission || {};
    let half = [o.hx, o.hy, o.hx];
    if (o.label === 'person') half = [0.4, 0.9, 0.4];
    else if (o.label === 'fire') half = [o.hx / 0.6, 2, o.hx / 0.6];
    else if (o.label === 'smoke') half = [o.hx, o.hy, o.hx];
    else if (o.label === 'landmark') { const l = m.landmarks.find((x) => x.id === o.id); half = [o.hx, o.hy, l.kind === 'peak' || l.kind === 'lake' ? o.hx : l.d ? l.d / 2 : o.hx * 0.3]; }
    else if (o.label === 'defect') half = [o.hx, o.hy, 0.05].map((v, i) => (i < 2 ? v : Math.max(v, 0.05)));
    out.push({ ...o, half });
  }
  for (const b of config.buildings) out.push({ label: 'building', x: b.x, y: b.h / 2, z: b.z, half: [b.w / 2, b.h / 2, b.d / 2], range: 150 });
  for (const b of [...config.obstacles, ...(config.trees || [])]) out.push({ label: 'obstacle', x: b.x, y: b.h / 2, z: b.z, half: [b.w / 2, b.h / 2, b.d / 2], range: 80 });
  for (const g of config.rings) out.push({ label: 'target', x: g.x, y: g.y, z: g.z, half: [2.6, 2.6, 0.3], range: 100 });
  const mm = config.mission;
  if (mm && mm.drop) out.push({ label: 'dropzone', x: mm.drop.x, y: 0.1, z: mm.drop.z, half: [mm.drop.r, 0.1, mm.drop.r], range: 100 });
  return out;
}

// Tight 2D box of an axis-aligned 3D box seen from a pose: samples points along the 12 edges, keeps those in front of the camera.
function projectBox(pose, o) {
  const yaw = pose.yaw * DEG, pit = pose.pitch * DEG;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pit), cp = Math.cos(pit);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0, minDepth = 1e9;
  const pts = [];
  for (const sx of [-1, 1]) for (const sy2 of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx, sy2, sz]);
  const edge = (a, b) => {
    for (let t = 0; t <= 8; t++) {
      const k = t / 8;
      const px = o.x + (a[0] + (b[0] - a[0]) * k) * o.half[0], py = o.y + (a[1] + (b[1] - a[1]) * k) * o.half[1], pz = o.z + (a[2] + (b[2] - a[2]) * k) * o.half[2];
      const dx = px - pose.pos[0], dy = py - pose.pos[1], dz = pz - pose.pos[2];
      const z = dx * sy * cp + dy * sp - dz * cy * cp;
      if (z < 0.5) continue;
      const x = dx * cy + dz * sy, y = -dx * sy * sp + dy * cp + dz * cy * sp;
      const u = 0.5 + x / (z * TAN * ASPECT) / 2, v = 0.5 - y / (z * TAN) / 2;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); n++;
      minDepth = Math.min(minDepth, z);
    }
  };
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const d = (pts[i][0] !== pts[j][0]) + (pts[i][1] !== pts[j][1]) + (pts[i][2] !== pts[j][2]);
    if (d === 1) edge(pts[i], pts[j]);
  }
  if (!n) return null;
  return { x0, y0, x1, y1, depth: minDepth };
}

// Ground-truth labels for one camera pose: [{ cls, id, box: [cx, cy, w, h] }] normalized (YOLO order).
// Boxes are clipped to the frame; an object needs at least 50% of its box inside and a minimum size.
// `blocked(o)` hides objects (smoke); thermal sees through it, so pass null then.
export function labelFrame(pose, objs, { minSize = 0.012, blocked = null } = {}) {
  const out = [];
  for (const o of objs) {
    const b = projectBox(pose, o);
    if (!b) continue;
    const full = (b.x1 - b.x0) * (b.y1 - b.y0);
    const cx0 = Math.max(0, b.x0), cx1 = Math.min(1, b.x1), cy0 = Math.max(0, b.y0), cy1 = Math.min(1, b.y1);
    if (cx1 <= cx0 || cy1 <= cy0 || full <= 0 || ((cx1 - cx0) * (cy1 - cy0)) / full < 0.5) continue;
    const w = cx1 - cx0, h = cy1 - cy0;
    if (w < minSize || h < minSize || Math.hypot(o.x - pose.pos[0], o.y - pose.pos[1], o.z - pose.pos[2]) > (o.range || 60)) continue;
    if (blocked && blocked(o)) continue;
    out.push({ cls: o.label, id: o.id, box: [round((cx0 + cx1) / 2), round((cy0 + cy1) / 2), round(w), round(h)] });
  }
  return out;
}
const round = (v) => Math.round(v * 1e5) / 1e5;
export const yoloLines = (labels) => labels.map((l) => `${CLASSES.indexOf(l.cls)} ${l.box.join(' ')}`).join('\n');

// ---- plan ----
function rng(seed) { // same PRNG family as worldconfig.js
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// The test split uses world seeds that never appear in training (SPEC Orang 2: different seeds for the test set).
export const SEED_BASE = { train: 1000, val: 2000, test: 3000 };
const WORLD_VARIANTS = [
  ['m1_sar', 'gedung'], ['m1_sar', 'hutan'], ['m2_foto', 'hotel'], ['m2_foto', 'gunung'], ['m5_inspeksi', 'gedung'],
  ['m5_inspeksi', 'jembatan'], ['m4_delivery', undefined], ['patroli', undefined],
];
export { WORLD_VARIANTS };

// count images, spread over world variants. Each world is rendered with `perWorld` camera poses.
// Returns [{ split, mission, variant, seed, shots: [{ cls, k, dist, alt, pitchJitter, yawJitter, sunAz, sunEl, thermal, shadows }] }].
export function planDataset({ count = 200, perWorld = 8, seed = 7, variants = WORLD_VARIANTS } = {}) {
  const r = rng(seed), worlds = [];
  const nWorlds = Math.ceil(count / perWorld);
  for (let i = 0; i < nWorlds; i++) {
    const u = r(), split = u < 0.7 ? 'train' : u < 0.9 ? 'val' : 'test';
    const [mission, variant] = variants[i % variants.length];
    const shots = [];
    for (let k = 0; k < perWorld && worlds.reduce((s, w) => s + w.shots.length, 0) + shots.length < count; k++) {
      shots.push({
        k: Math.floor(r() * 1e6), dist: 6 + r() * 40, alt: 2 + r() * 34, pitchJitter: (r() - 0.5) * 16, yawJitter: (r() - 0.5) * 40,
        sunAz: Math.round(r() * 360), sunEl: Math.round(20 + r() * 50), thermal: r() < 0.1, shadows: r() < 0.7,
      });
    }
    worlds.push({ split, mission, variant, seed: SEED_BASE[split] + Math.floor(r() * 500), shots });
  }
  return worlds;
}

// Pose that looks at object o from a random side. shot comes from planDataset. Pure and deterministic.
export function poseFor(o, shot) {
  const bearing = ((shot.k % 360) * DEG);
  const dist = shot.dist + Math.max(...o.half) * 1.5;
  const pos = [o.x + Math.sin(bearing) * dist, Math.max(1.5, shot.alt), o.z - Math.cos(bearing) * dist];
  const dx = o.x - pos[0], dz = o.z - pos[2], dy = o.y - pos[1];
  const yaw = ((Math.atan2(dx, -dz) / DEG) + 360 + shot.yawJitter) % 360;
  const pitch = Math.max(-85, Math.min(25, Math.atan2(dy, Math.hypot(dx, dz)) / DEG + shot.pitchJitter));
  pos[0] = Math.max(-98, Math.min(98, pos[0])); pos[2] = Math.max(-98, Math.min(98, pos[2]));
  return { pos, yaw, pitch };
}

// ---- ZIP (stored) ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// files: [{ name, data: Uint8Array | string }] -> Uint8Array of a valid ZIP archive (no compression).
export function makeZip(files) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0]);
    chunks.push(local, name, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), 0, 0]);
  const all = [...chunks, ...central, end], out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
