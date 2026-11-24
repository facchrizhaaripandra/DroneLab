// Air di peta realistis: baca permukaan air dan dasar air dari scene.glb, tulis ke scene.json sebagai `water`.
// Jalankan setelah export_scene.py:  node scripts/water_grid.mjs [id ...]   (tanpa id = semua peta)
//
// water = { x0, z0, cell, nx, nz, runs: [[j, i0, surf, bed0, bed1, ...], ...] } dalam koordinat simulator.
// Tiap run = sel berurutan di baris j mulai kolom i0 dengan permukaan air sama; bed = dasar (lantai kolam, dasar danau).
// Dasar = permukaan benda bukan-air tertinggi di bawah permukaan air. Air setipis < 3 cm (sawah) tidak ditulis.
// height.data tidak diubah: tanah tetap setinggi permukaan air, flight.js memakai dasar air bila drone di dalam air.
import fs from 'node:fs';

const ROOT = new URL('../public/scenes/', import.meta.url);
const IS_WATER = (n) => /water/i.test(n) && !/tank|streak|weathering|waterline|puddle|sheet|backdrop|foam|rock|moss|bank|fall/i.test(n);
const NO_BED = (n) => /backdrop|foam|puddle|weathering|streak|sheet|decal_ash|tape|marking/i.test(n) || IS_WATER(n);
const MIN_DEPTH = 0.03;
const NO_BED_DEPTH = 2;  // m: no geometry under the surface (open sea, rivers without a bed mesh)
// Pools, ponds and fountains are modelled as a thin tile slab just under the water: give them a real depth.
const MODEL_DEPTH = [[/pool/i, 1.4], [/pond/i, 0.8], [/fountain/i, 0.4]];

function mat4(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
  }
  return o;
}

function readGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bin = b.subarray(20 + jl + 8);
  const acc = (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], off = (v.byteOffset || 0) + (a.byteOffset || 0);
    const comp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const stride = v.byteStride ? v.byteStride / T.BYTES_PER_ELEMENT : comp;
    const arr = new T(bin.buffer, bin.byteOffset + off, (a.count - 1) * stride + comp);
    if (stride === comp) return arr;
    const out = new T(a.count * comp);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < comp; c++) out[k * comp + c] = arr[k * stride + c];
    return out;
  };
  const items = []; // { name, tris: Float32Array (x,y,z)*3 per triangle, world gltf coords }
  const visit = (ni, parent, pname) => {
    const n = j.nodes[ni], m = mul(parent, mat4(n)), name = n.name || pname;
    if (n.mesh !== undefined) {
      const parts = [];
      for (const p of j.meshes[n.mesh].primitives) {
        if (p.mode !== undefined && p.mode !== 4) continue;
        const pos = acc(p.attributes.POSITION), idx = p.indices !== undefined ? acc(p.indices) : null;
        const cnt = idx ? idx.length : pos.length / 3, t = new Float32Array(cnt * 3);
        for (let k = 0; k < cnt; k++) {
          const v = (idx ? idx[k] : k) * 3, x = pos[v], y = pos[v + 1], z = pos[v + 2];
          t[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          t[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          t[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        parts.push(t);
      }
      items.push({ name, parts });
    }
    for (const c of n.children || []) visit(c, m, name);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of j.scenes[j.scene || 0].nodes) visit(r, I, '');
  return items;
}

// Each triangle (sim coords) -> callback(cell index, height at the cell centre) for every cell centre inside it.
function raster(t, k, g, cb) {
  const ax = t[k], ay = t[k + 1], az = t[k + 2], bx = t[k + 3], by = t[k + 4], bz = t[k + 5], cx = t[k + 6], cy = t[k + 7], cz = t[k + 8];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-9) return;
  const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - g.x0) / g.cell - 0.5)), i1 = Math.min(g.nx - 1, Math.floor((Math.max(ax, bx, cx) - g.x0) / g.cell - 0.5));
  const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - g.z0) / g.cell - 0.5)), j1 = Math.min(g.nz - 1, Math.floor((Math.max(az, bz, cz) - g.z0) / g.cell - 0.5));
  for (let j = j0; j <= j1; j++) {
    const pz = g.z0 + (j + 0.5) * g.cell;
    for (let i = i0; i <= i1; i++) {
      const px = g.x0 + (i + 0.5) * g.cell;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      cb(j * g.nx + i, l1 * ay + l2 * by + l3 * cy);
    }
  }
}

export function buildWater(meta, items) {
  const [ox, oy, oz] = meta.offset, h = meta.height;
  for (const it of items) for (const t of it.parts) for (let k = 0; k < t.length; k += 3) { t[k] += ox; t[k + 1] += oy; t[k + 2] += oz; }
  const water = items.filter((it) => IS_WATER(it.name));
  if (!water.length) return null;
  let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const it of water) for (const t of it.parts) for (let k = 0; k < t.length; k += 3) {
    mnx = Math.min(mnx, t[k]); mxx = Math.max(mxx, t[k]); mnz = Math.min(mnz, t[k + 2]); mxz = Math.max(mxz, t[k + 2]);
  }
  const area = (mxx - mnx) * (mxz - mnz), cell = area > 400000 ? 2 : 1;
  const g = { x0: Math.floor(mnx), z0: Math.floor(mnz), cell };
  g.nx = Math.ceil((mxx - g.x0) / cell) + 1; g.nz = Math.ceil((mxz - g.z0) / cell) + 1;
  const N = g.nx * g.nz, surf = new Float32Array(N).fill(-Infinity), bed = new Float32Array(N).fill(-Infinity), minDepth = new Float32Array(N);
  for (const it of water) {
    const md = (MODEL_DEPTH.find(([re]) => re.test(it.name)) || [0, 0])[1];
    for (const t of it.parts) for (let k = 0; k < t.length; k += 9) raster(t, k, g, (c, y) => { if (y > surf[c]) { surf[c] = y; minDepth[c] = md; } });
  }
  for (const it of items) {
    if (NO_BED(it.name)) continue;
    for (const t of it.parts) for (let k = 0; k < t.length; k += 9) {
      const ux = t[k + 3] - t[k], uy = t[k + 4] - t[k + 1], uz = t[k + 5] - t[k + 2], vx = t[k + 6] - t[k], vy = t[k + 7] - t[k + 1], vz = t[k + 8] - t[k + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (Math.abs(ny) < 0.3 * Math.hypot(nx, ny, nz)) continue; // walls do not hold the drone up
      raster(t, k, g, (c, y) => { if (surf[c] > -Infinity && y < surf[c] + 0.02 && y > bed[c]) bed[c] = y; });
    }
  }
  // A solid ground surface above the water there (a deck, a jetty): not water.
  const ground = (x, z) => {
    let fx = Math.min(Math.max((x - h.x0) / h.cell, 0), h.nx - 1), fz = Math.min(Math.max((z - h.z0) / h.cell, 0), h.nz - 1);
    return h.data[Math.round(fz) * h.nx + Math.round(fx)];
  };
  const runs = []; let cells = 0;
  for (let j = 0; j < g.nz; j++) {
    let run = null;
    for (let i = 0; i < g.nx; i++) {
      const c = j * g.nx + i;
      let s = surf[c], b = bed[c] > -Infinity ? bed[c] : s - NO_BED_DEPTH;
      if (s - b < minDepth[c]) b = s - minDepth[c];
      const wet = s > -Infinity && s - b >= MIN_DEPTH && ground(g.x0 + (i + 0.5) * cell, g.z0 + (j + 0.5) * cell) < s + 0.3;
      if (!wet) { run = null; continue; }
      s = Math.round(s * 20) / 20; b = Math.round(b * 20) / 20;
      if (!run || run[2] !== s) { run = [j, i, s]; runs.push(run); }
      run.push(b); cells++;
    }
  }
  return { x0: g.x0, z0: g.z0, cell, nx: g.nx, nz: g.nz, runs, cells };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(ROOT).filter((d) => fs.existsSync(new URL(`${d}/scene.json`, ROOT)));
  for (const id of ids) {
    const jf = new URL(`${id}/scene.json`, ROOT), meta = JSON.parse(fs.readFileSync(jf));
    const w = buildWater(meta, readGlb(new URL(`${id}/scene.glb`, ROOT)));
    if (w && w.cells) { const { cells, ...rest } = w; meta.water = rest; } else delete meta.water;
    fs.writeFileSync(jf, JSON.stringify(meta));
    console.log(id, w ? `${w.cells} sel air (${w.cell} m), ${w.runs.length} baris` : 'tanpa air');
  }
}
