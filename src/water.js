// Air: permukaan dan dasar air, dan bagian drone mana yang terendam (pure JS, teruji di Node).
// Peta realistis: grid `water` di scene.json (scripts/water_grid.mjs). Dunia misi prosedural: zona danau,
// kolam renang dan sungai dari config.mission. Tanah peta tetap setinggi permukaan air; flight.js memakai dasar air
// sebagai lantai saat drone berada di atas air, jadi drone bisa masuk dan tenggelam.

// Titik bagian drone relatif terhadap posisi drone (bawah kaki), dalam meter: [kanan, atas, depan].
// Baling-baling di ujung lengan (urutan FL, FR, RL, RR seperti damage.js), kamera gimbal menggantung di depan bawah,
// badan (baterai, flight controller) di tengah.
export const PARTS = {
  rotors: [[-0.39, 0.42, 0.39], [0.39, 0.42, 0.39], [-0.39, 0.42, -0.39], [0.39, 0.42, -0.39]],
  camera: [0, 0.18, 0.3],
  body: [0, 0.3, 0],
};
// Kerusakan per detik terendam: baling-baling yang berputar menghantam air dan motornya korslet hampir seketika,
// kamera gimbal mati dalam setengah detik. Badan terendam = air masuk ke baterai dan flight controller: tenggelam.
export const SOAK_ROTOR = 3;
export const SOAK_CAMERA = 2;
export const SINK_SPEED = 0.6;   // m/s: drone mati (sedikit lebih berat dari air) turun pelan ke dasar
export const SPLASH_SPEED = 4;   // m/s ke bawah: masuk air lebih cepat dari ini = hantaman seperti menabrak
export const WATER_WARN = 3;     // m di atas permukaan air: peringatan di HUD

const DEG = Math.PI / 180;
const DRY = { surface: () => NaN, bed: () => NaN, any: false };

// grid: { x0, z0, cell, nx, nz, runs: [[j, i0, surf, bed...]] }. zones: [{ circle: [x, z, r] | rect: [x0, z0, x1, z1], surf, depth }]
export function makeWater({ grid = null, zones = [] } = {}) {
  if (!grid && !zones.length) return DRY;
  let surfA = null, bedA = null;
  if (grid) {
    surfA = new Float32Array(grid.nx * grid.nz).fill(NaN); bedA = new Float32Array(grid.nx * grid.nz).fill(NaN);
    for (const r of grid.runs) for (let k = 3; k < r.length; k++) { const c = r[0] * grid.nx + r[1] + k - 3; surfA[c] = r[2]; bedA[c] = r[k]; }
  }
  const cellAt = (x, z) => {
    const i = Math.floor((x - grid.x0) / grid.cell), j = Math.floor((z - grid.z0) / grid.cell);
    return i < 0 || j < 0 || i >= grid.nx || j >= grid.nz ? -1 : j * grid.nx + i;
  };
  const zoneAt = (x, z) => {
    for (const zn of zones) {
      if (zn.circle) { const [cx, cz, r] = zn.circle; if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) return zn; }
      else if (zn.rect) { const [a, b, c, d] = zn.rect; if (x >= a && x <= c && z >= b && z <= d) return zn; }
    }
    return null;
  };
  return {
    any: true,
    surface(x, z) {
      if (grid) { const c = cellAt(x, z); if (c >= 0 && surfA[c] === surfA[c]) return surfA[c]; }
      const zn = zones.length ? zoneAt(x, z) : null;
      return zn ? zn.surf : NaN;
    },
    bed(x, z) {
      if (grid) { const c = cellAt(x, z); if (c >= 0 && bedA[c] === bedA[c]) return bedA[c]; }
      const zn = zones.length ? zoneAt(x, z) : null;
      return zn ? zn.surf - zn.depth : NaN;
    },
  };
}

// Air di dunia misi prosedural, sama dengan yang digambar world.js (danau, kolam renang, sungai M3).
export function missionWaterZones(mission) {
  const out = [];
  if (!mission) return out;
  for (const l of mission.landmarks || []) {
    if (l.kind === 'lake') out.push({ circle: [l.x, l.z, l.r], surf: 0.06, depth: 3 });
    else if (l.kind === 'pool') out.push({ rect: [l.x - l.w / 2, l.z - l.d / 2, l.x + l.w / 2, l.z + l.d / 2], surf: 0.08, depth: 1.6 });
  }
  if (mission.river) out.push({ rect: [mission.river.min[0], mission.river.min[1], mission.river.max[0], mission.river.max[1]], surf: 0.03, depth: 1.5 });
  return out;
}

// Kedalaman tiap bagian di bawah permukaan air (0 = kering). out = { rotors: [4], camera, body }.
// pitch + = hidung naik, roll + = sisi kanan turun (konvensi flight.js), yaw searah jarum jam dari atas, 0 = -Z.
export function partDepths(water, pos, yawDeg, pitchDeg, rollDeg, out) {
  const y = yawDeg * DEG, sy = Math.sin(y), cy = Math.cos(y), sp = Math.sin(pitchDeg * DEG), sr = Math.sin(rollDeg * DEG);
  const depth = (o) => {
    const x = pos[0] + o[0] * cy + o[2] * sy, z = pos[2] + o[0] * sy - o[2] * cy;
    const s = water.surface(x, z);
    if (s !== s) return 0;
    const h = pos[1] + o[1] + o[2] * sp - o[0] * sr;
    return h < s ? s - h : 0;
  };
  for (let i = 0; i < 4; i++) out.rotors[i] = depth(PARTS.rotors[i]);
  out.camera = depth(PARTS.camera);
  out.body = depth(PARTS.body);
  return out;
}
