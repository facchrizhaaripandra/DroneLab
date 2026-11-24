// Gedung misi prosedural (pure JS, tanpa Three.js, teruji di Node). Tiap gedung config ({ x, z, w, d, h, shade, type? })
// menjadi daftar bagian (kotak, silinder, atap pelana) dan daftar collider. world.js menggambar bagiannya.
// Ukuran mengikuti bangunan Indonesia: ruko lebar 4-5 m per unit, 2-4 lantai @ 3,6 m; kantor lantai 3,8 m dengan
// kaca berangka tiap 1,5 m; apartemen lantai 3 m dengan balkon; gudang rangka baja beratap pelana.
//
// fac = [gaya fasad, lebar bay, tinggi lantai] untuk shader jendela:
//   0 polos, 1 dinding kaca (curtain wall), 2 jendela berbingkai, 3 ruko (rolling door di lantai dasar),
//   4 panel pracetak, 5 seng bergelombang, 6 kaca lobi, 7 rangka hangus (jendela pecah, jelaga)

export const RUKO_FLOOR = 3.6, OFFICE_FLOOR = 3.8, FLAT_FLOOR = 3.0, OPEN_FLOOR = 3.6, SLAB = 0.3;

const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
const PLAIN = [0, 1, 1];

// Tipe dari ukuran, tanpa memanggil generator acak lagi (dunia dengan seed yang sama tetap sama).
export function buildingType(b) {
  if (b.type) return b.type;
  const area = b.w * b.d;
  if (b.h < 12) return area > 110 ? 'gudang' : 'ruko';
  if (b.h >= 20) return b.shade < 0.55 ? 'kantor' : 'apartemen';
  return b.shade < 0.35 ? 'kantor' : 'apartemen';
}

// Bingkai lokal: u sepanjang sisi panjang, v ke depan (menghadap pusat peta, tempat jalan dan pad H).
function frame(b) {
  const alongX = b.w >= b.d;
  const fs = alongX ? (b.z > 0 ? -1 : 1) : (b.x > 0 ? -1 : 1);
  const L = alongX ? b.w : b.d, D = alongX ? b.d : b.w;
  return {
    L, D,
    box(cu, cy, cv, su, sy, sv) { // pusat dan ukuran lokal -> dunia (tetap sejajar sumbu)
      return alongX ? { c: [b.x + cu, cy, b.z + cv * fs], s: [su, sy, sv] } : { c: [b.x + cv * fs, cy, b.z + cu], s: [sv, sy, su] };
    },
    axis: alongX ? 'x' : 'z',
  };
}
const aabb = ({ c, s }) => ({ min: [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2], max: [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2] });
const boxOf = (b) => ({ min: [b.x - b.w / 2, b.y0 || 0, b.z - b.d / 2], max: [b.x + b.w / 2, (b.y0 || 0) + b.h, b.z + b.d / 2] });

const CONCRETE = [0xd9d4c8, 0xc9c3b6, 0xe6e2d8, 0xbfc4c7, 0xd8cbb4];
const RUKO = [0xe8dcc2, 0xf1efe7, 0xd9c49b, 0xc7d4d0, 0xe3c7b0, 0xbfcfe0, 0xf0d7a8];
const SIGNS = [0xc0392b, 0x1f6fb2, 0xf2b705, 0x2e8b57, 0xe67e22, 0x8e44ad];
const tint = (hex, k) => { // k > 1 lebih terang, < 1 lebih gelap
  const r = Math.min(255, ((hex >> 16) & 255) * k), g = Math.min(255, ((hex >> 8) & 255) * k), bl = Math.min(255, (hex & 255) * k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

// ---- tipe per tipe: { parts, colliders } ----
function ruko(b) {
  const f = frame(b), parts = [], colliders = [];
  let roof;
  const n = Math.max(1, Math.round(f.L / 4.5)), uw = f.L / n;
  const awn = 1.2, bodyD = f.D - awn; // jalur kanopi di depan
  const maxFloors = Math.max(2, Math.min(4, Math.floor((b.h - 0.8) / RUKO_FLOOR)));
  for (let i = 0; i < n; i++) {
    const k = hash(b.x + i * 3.1, b.z - i * 1.7);
    const floors = Math.min(maxFloors, 2 + Math.floor(k * (maxFloors - 1) + 0.5));
    const top = floors * RUKO_FLOOR, para = 0.8, H = top + para;
    const cu = -f.L / 2 + (i + 0.5) * uw, cv = -f.D / 2 + bodyD / 2;
    const col = RUKO[Math.floor(k * 97) % RUKO.length];
    const body = f.box(cu, top / 2, cv, uw - 0.04, top, bodyD);
    parts.push({ t: 'box', ...body, col, fac: [3, uw / 2, RUKO_FLOOR] });
    parts.push({ t: 'box', ...f.box(cu, top + para / 2, cv + bodyD / 2 - 0.1, uw - 0.04, para, 0.2), col: tint(col, 0.92), fac: PLAIN }); // dinding atap depan
    parts.push({ t: 'box', ...f.box(cu, top + 0.05, cv, uw - 0.1, 0.1, bodyD - 0.1), col: 0x8d8a84, fac: PLAIN }); // dak beton
    parts.push({ t: 'box', ...f.box(cu, 3.25, f.D / 2 - awn / 2, uw - 0.15, 0.08, awn), col: SIGNS[(i + Math.floor(k * 10)) % SIGNS.length], fac: PLAIN }); // kanopi
    parts.push({ t: 'box', ...f.box(cu, 4.3, cv + bodyD / 2 + 0.06, uw * 0.8, 0.9, 0.1), col: tint(SIGNS[Math.floor(k * 31) % SIGNS.length], 1.1), fac: PLAIN }); // papan nama
    if (floors >= 3) parts.push({ t: 'box', ...f.box(cu, RUKO_FLOOR * 2 + 0.55, cv + bodyD / 2 + 0.35, uw * 0.7, 1.1, 0.06), col: 0x3a3d40, fac: PLAIN }); // teralis balkon
    if (k > 0.3) { const tc = k > 0.65 ? 0xe46b1f : 0x2f6db5; parts.push({ t: 'cyl', c: f.box(cu - uw * 0.2, top + 0.85, cv - bodyD * 0.25, 1, 1, 1).c, r: 0.55, h: 1.5, col: tc }); } // tandon air
    colliders.push(aabb(f.box(cu, H / 2, cv, uw, H, bodyD)));
  }
  const mid = Math.min(n - 1, Math.floor(n / 2));
  roof = { y: 0 };
  {
    const k = hash(b.x + mid * 3.1, b.z - mid * 1.7);
    const fl = Math.min(maxFloors, 2 + Math.floor(k * (maxFloors - 1) + 0.5));
    roof.y = fl * RUKO_FLOOR + 0.1;
  }
  colliders.push(aabb(f.box(0, 1.7, f.D / 2 - awn / 2, f.L, 3.4, awn))); // kanopi: bisa ditabrak, tidak bisa dilewati di bawahnya
  return { parts, colliders, roof: roof.y };
}

function kantor(b) {
  const f = frame(b), parts = [], colliders = [boxOf(b)];
  const col = CONCRETE[Math.floor(b.shade * 50) % CONCRETE.length];
  const podium = Math.min(5.6, b.h * 0.3), inset = 0.5, crown = 1.4, roofTop = b.h - 1.6;
  parts.push({ t: 'box', ...f.box(0, podium / 2, 0, f.L, podium, f.D), col: tint(col, 0.9), fac: [6, 3, podium] }); // lobi kaca dua lantai
  parts.push({ t: 'box', ...f.box(0, podium + 0.2, f.D / 2 + 0.01, f.L, 0.4, 0.02 + 0.0), col: tint(col, 0.8), fac: PLAIN });
  parts.push({ t: 'box', ...f.box(0, podium - 0.15, f.D / 2 - 1.2, Math.min(8, f.L * 0.5), 0.3, 2.4), col: 0x6f7377, fac: PLAIN }); // kanopi pintu
  const th = roofTop - podium;
  parts.push({ t: 'box', ...f.box(0, podium + th / 2, 0, f.L - inset * 2, th, f.D - inset * 2), col, fac: [1, 1.5, OFFICE_FLOOR] });
  // sirip vertikal tiap ~6 m di sisi panjang
  const nf = Math.max(2, Math.round(f.L / 6));
  for (let i = 0; i <= nf; i++) {
    const u = -f.L / 2 + inset + (i / nf) * (f.L - inset * 2);
    for (const sv of [1, -1]) parts.push({ t: 'box', ...f.box(u, podium + th / 2, sv * (f.D / 2 - inset + 0.15), 0.3, th, 0.3), col: tint(col, 1.05), fac: PLAIN });
  }
  parts.push({ t: 'box', ...f.box(0, roofTop + crown / 2, 0, f.L - inset * 2 + 0.4, crown, f.D - inset * 2 + 0.4), col: tint(col, 1.08), fac: PLAIN }); // mahkota
  parts.push({ t: 'box', ...f.box(0, roofTop + 0.15, 0, f.L - inset * 2 - 0.6, 0.3, f.D - inset * 2 - 0.6), col: 0x7b7d7f, fac: PLAIN }); // atap
  const k = hash(b.x, b.z);
  parts.push({ t: 'box', ...f.box(-f.L * 0.15, roofTop + 0.8, -f.D * 0.1, Math.min(6, f.L * 0.3), 1.4, Math.min(4, f.D * 0.35)), col: 0xb7b9bb, fac: PLAIN }); // ruang mesin lift
  for (let i = 0; i < 3; i++) parts.push({ t: 'box', ...f.box(f.L * (0.08 + i * 0.12), roofTop + 0.75, f.D * (0.1 + (k - 0.5) * 0.2), 1.6, 1.2, 1.2), col: 0x9aa0a4, fac: PLAIN }); // unit AC
  return { parts, colliders, roof: roofTop + 0.3 };
}

function apartemen(b, hotel = false) {
  const f = frame(b), parts = [], colliders = [boxOf(b)];
  const col = hotel ? 0xf2efe6 : CONCRETE[Math.floor(b.shade * 70) % CONCRETE.length];
  const bal = 0.9, top = b.h - 2.4;
  const floors = Math.max(1, Math.floor(top / FLAT_FLOOR));
  const bodyH = floors * FLAT_FLOOR;
  parts.push({ t: 'box', ...f.box(0, bodyH / 2, 0, f.L, bodyH, f.D - bal * 2), col, fac: [2, 3, FLAT_FLOOR] });
  parts.push({ t: 'box', ...f.box(0, bodyH + 0.55, 0, f.L, 1.1, f.D - bal * 2), col: tint(col, 0.95), fac: PLAIN }); // dinding atap
  const nb = Math.max(1, Math.round(f.L / 3));
  for (let fl = 1; fl < floors; fl++) {
    const y = fl * FLAT_FLOOR;
    for (const sv of [1, -1]) {
      const v = sv * (f.D / 2 - bal / 2);
      parts.push({ t: 'box', ...f.box(0, y, v, f.L - 0.4, 0.18, bal), col: tint(col, 0.97), fac: PLAIN }); // pelat balkon
      parts.push({ t: 'box', ...f.box(0, y + 0.55, sv * (f.D / 2 - 0.04), f.L - 0.4, 0.95, 0.06), col: hotel ? 0x9b7653 : 0x50555a, fac: PLAIN }); // pagar balkon
      for (let i = 1; i < nb; i++) parts.push({ t: 'box', ...f.box(-f.L / 2 + i * (f.L / nb), y + 1.4, v, 0.12, 2.8, bal), col: tint(col, 0.9), fac: PLAIN }); // sekat
    }
  }
  parts.push({ t: 'box', ...f.box(f.L * 0.2, bodyH + 1.1, 0, 3.2, 2.2, 3), col: tint(col, 0.9), fac: PLAIN }); // rumah tangga di atap
  for (let i = 0; i < 2; i++) parts.push({ t: 'cyl', c: f.box(-f.L * 0.25 + i * 1.6, bodyH + 0.85, 0, 1, 1, 1).c, r: 0.7, h: 1.6, col: hotel ? 0xdcdcdc : 0x2f6db5 });
  if (hotel) parts.push({ t: 'box', ...f.box(0, 2.1, f.D / 2 - 1.4, Math.min(10, f.L * 0.4), 0.35, 2.8), col: 0x6b4f36, fac: PLAIN }); // kanopi lobi kayu
  return { parts, colliders, roof: bodyH + 0.1 };
}

function gudang(b) {
  const f = frame(b), parts = [], colliders = [];
  const eave = Math.max(5, b.h * 0.68), ridge = b.h - eave;
  parts.push({ t: 'box', ...f.box(0, eave / 2, 0, f.L, eave, f.D - 0.6), col: 0xb9c0c4, fac: [5, 1, 1] });
  parts.push({ t: 'gable', ...f.box(0, eave + ridge / 2, 0, f.L + 0.6, ridge, f.D), axis: f.axis, col: 0x8f9aa1, fac: [5, 1, 1] });
  const nd = Math.max(1, Math.floor(f.L / 7));
  for (let i = 0; i < nd; i++) {
    const u = -f.L / 2 + (i + 0.5) * (f.L / nd);
    parts.push({ t: 'box', ...f.box(u, 2.1, f.D / 2 - 0.27, 3.6, 4.2, 0.06), col: 0x4b5258, fac: [5, 1, 1] }); // pintu muat
  }
  parts.push({ t: 'box', ...f.box(0, 4.8, f.D / 2 - 0.15, f.L * 0.9, 0.15, 0.3 + 0.0), col: 0x707780, fac: PLAIN });
  parts.push({ t: 'box', ...f.box(0, 0.5, f.D / 2 - 0.15, f.L * 0.9, 1.0, 0.3), col: 0xa7a59e, fac: PLAIN }); // dok
  colliders.push(aabb(f.box(0, eave / 2, 0, f.L, eave, f.D)));
  colliders.push(aabb(f.box(0, eave + ridge / 2, 0, f.L, ridge, f.D * 0.5))); // atap: separuh lebar di atas tritisan
  return { parts, colliders, roof: b.h };
}

// Rangka gedung terbakar (misi SAR): lantai terbuka, kolom, inti tangga, dinding tersisa di dua sisi. Korban bisa di dalam.
export function openFloors(b) { return Math.max(2, Math.floor(b.h / OPEN_FLOOR)); }
function terbuka(b) {
  const f = frame(b), parts = [], colliders = [];
  const nfl = openFloors(b), H = nfl * OPEN_FLOOR;
  for (let i = 0; i <= nfl; i++) {
    const y = i * OPEN_FLOOR;
    const slab = f.box(0, i === 0 ? 0.1 : y - SLAB / 2, 0, f.L, i === 0 ? 0.2 : SLAB, f.D);
    parts.push({ t: 'box', ...slab, col: i === nfl ? 0x4a4644 : 0x8a8580, fac: PLAIN });
    if (i > 0) colliders.push(aabb(slab));
  }
  const cu = Math.max(2, Math.round(f.L / 5)), cv = Math.max(2, Math.round(f.D / 5));
  for (let i = 0; i <= cu; i++) for (let j = 0; j <= cv; j++) {
    const c = f.box(-f.L / 2 + 0.3 + i * ((f.L - 0.6) / cu), H / 2, -f.D / 2 + 0.3 + j * ((f.D - 0.6) / cv), 0.5, H, 0.5);
    parts.push({ t: 'box', ...c, col: 0x7d7772, fac: PLAIN }); colliders.push(aabb(c));
  }
  const core = f.box(-f.L / 2 + 2.6, H / 2, -f.D / 2 + 2.6, 4, H, 4); // tangga dan lift
  parts.push({ t: 'box', ...core, col: 0x6e6964, fac: PLAIN }); colliders.push(aabb(core));
  const back = f.box(0, H / 2, -f.D / 2 + 0.15, f.L, H, 0.3), side = f.box(-f.L / 2 + 0.15, H / 2, 0, 0.3, H, f.D);
  for (const w of [back, side]) { parts.push({ t: 'box', ...w, col: 0x5a5450, fac: [7, 2.8, OPEN_FLOOR] }); colliders.push(aabb(w)); }
  return { parts, colliders, roof: H };
}

// Gedung inspeksi M5: muka harus rata (cacat ditempel di permukaan), detail hanya di atap.
function inspeksi(b) {
  const f = frame(b), parts = [], colliders = [boxOf(b)];
  parts.push({ t: 'box', c: [b.x, b.h / 2, b.z], s: [b.w, b.h, b.d], col: 0xcfcac0, fac: [4, 2.4, 3.4] });
  parts.push({ t: 'box', c: [b.x, b.h + 0.5, b.z], s: [b.w, 1, b.d], col: 0xbdb8ae, fac: PLAIN }); // dinding pembatas atap
  parts.push({ t: 'box', c: [b.x, b.h + 0.06, b.z], s: [b.w - 0.6, 0.12, b.d - 0.6], col: 0x77797b, fac: PLAIN });
  const bmu = f.box(f.L * 0.15, b.h + 1.6, 0, 1.4, 2.2, 1.4); // gondola pembersih fasad (BMU) dan lengannya
  parts.push({ t: 'box', ...bmu, col: 0xd8d8d8, fac: PLAIN });
  parts.push({ t: 'box', ...f.box(f.L * 0.15, b.h + 2.9, f.D * 0.2, 0.4, 0.4, f.D * 0.45), col: 0xd8d8d8, fac: PLAIN });
  for (let i = 0; i < 2; i++) parts.push({ t: 'cyl', c: f.box(-f.L * 0.25 + i * 1.8, b.h + 1.1, -f.D * 0.2, 1, 1, 1).c, r: 0.75, h: 2, col: 0x2f6db5 });
  colliders.push({ min: [b.x - b.w / 2, b.h, b.z - b.d / 2], max: [b.x + b.w / 2, b.h + 1, b.z + b.d / 2] });
  colliders.push(aabb(bmu));
  return { parts, colliders, roof: b.h + 0.12 };
}

const BUILDERS = { ruko, kantor, apartemen, gudang, terbuka, inspeksi, hotel: (b) => apartemen(b, true) };
const cache = new WeakMap();
export function buildingLayout(b) {
  let v = cache.get(b);
  if (!v) { v = (BUILDERS[buildingType(b)] || kantor)(b); cache.set(b, v); }
  return v;
}
export const buildingColliders = (b) => buildingLayout(b).colliders;
// Tinggi permukaan atap di tengah gedung (tempat korban menunggu di atap).
export const roofY = (b) => Math.round(buildingLayout(b).roof * 100) / 100;

// Titik di dalam rangka gedung terbakar, lantai `floor`: petak paling depan, jauh dari inti tangga dan dinding sisa.
export function insideSpot(b, floor = 1) {
  const f = frame(b);
  const cu = Math.max(2, Math.round(f.L / 5)), cv = Math.max(2, Math.round(f.D / 5));
  const u = -f.L / 2 + 0.3 + ((f.L - 0.6) / cu) * (cu - 0.5), v = -f.D / 2 + 0.3 + ((f.D - 0.6) / cv) * (cv - 0.5);
  const { c } = f.box(u, 0, v, 1, 1, 1);
  return { x: Math.round(c[0] * 100) / 100, y: floor * OPEN_FLOOR, z: Math.round(c[2] * 100) / 100 };
}

// Jembatan misi M5 (dek beton di atas dua pilar): detail yang tidak menutupi muka dek tempat cacat ditempel.
// s = { x, z, w, d, y0, y1 } (dek), pilar di x +-13.
export function bridgeLayout(s) {
  const parts = [], colliders = [], top = s.y1, half = s.w / 2;
  parts.push({ t: 'box', c: [s.x, top + 0.03, s.z], s: [s.w, 0.06, s.d - 1.2], col: 0x3b3d40, fac: PLAIN }); // aspal
  for (const sz of [1, -1]) {
    const ez = s.z + sz * (s.d / 2 - 0.3);
    parts.push({ t: 'box', c: [s.x, top + 0.15, ez], s: [s.w, 0.3, 0.6], col: 0xb9b6ae, fac: PLAIN }); // kerb
    parts.push({ t: 'box', c: [s.x, top + 1.1, s.z + sz * (s.d / 2 - 0.08)], s: [s.w, 0.08, 0.08], col: 0x8c949b, fac: PLAIN }); // pagar atas
    parts.push({ t: 'box', c: [s.x, top + 0.7, s.z + sz * (s.d / 2 - 0.08)], s: [s.w, 0.06, 0.06], col: 0x8c949b, fac: PLAIN });
    for (let x = -half + 1; x <= half - 1 + 1e-6; x += 2) parts.push({ t: 'box', c: [s.x + x, top + 0.7, s.z + sz * (s.d / 2 - 0.08)], s: [0.08, 0.8, 0.08], col: 0x8c949b, fac: PLAIN });
    colliders.push({ min: [s.x - half, top, s.z + sz * (s.d / 2) - (sz > 0 ? 0.3 : 0)], max: [s.x + half, top + 1.15, s.z + sz * (s.d / 2) + (sz > 0 ? 0 : 0.3)] });
    for (let x = -half + 5; x < half - 1; x += 11) { // lampu jalan
      const lz = s.z + sz * (s.d / 2 - 0.3);
      parts.push({ t: 'cyl', c: [s.x + x + (sz > 0 ? 0 : 5.5), top + 3.3, lz], r: 0.1, h: 6, col: 0x6d747a });
      parts.push({ t: 'box', c: [s.x + x + (sz > 0 ? 0 : 5.5), top + 6.25, lz - sz * 0.6], s: [0.35, 0.15, 1.3], col: 0x6d747a, fac: PLAIN });
    }
  }
  for (let x = -half + 3; x < half - 2; x += 3) parts.push({ t: 'box', c: [s.x + x, top + 0.065, s.z], s: [1.5, 0.01, 0.15], col: 0xf2f2f2, fac: PLAIN }); // marka
  for (const gz of [-2, 0, 2]) parts.push({ t: 'box', c: [s.x, s.y0 - 0.45, s.z + gz], s: [s.w - 1, 0.9, 0.5], col: 0xa8a49b, fac: PLAIN }); // gelagar
  for (const px of [-13, 13]) parts.push({ t: 'box', c: [s.x + px, s.y0 - 0.5, s.z], s: [4.2, 1.0, s.d - 0.4], col: 0xb3afa6, fac: PLAIN }); // kepala pilar
  return { parts, colliders };
}
