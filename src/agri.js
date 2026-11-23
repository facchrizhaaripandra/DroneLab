// M3 spray model (pure). The same code runs live in the browser (HUD, field colors) and in the scorer,
// fed by the same 10 Hz samples, so the live number and the official number agree.
// Field = grid of square cells. Spray lands in a circle under the drone, pushed by the wind while it falls.
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const swathWidth = (alt) => clamp(alt * 0.8, 2, 7); // m, wider when flying higher
export const SPRAY_ENV = { altMin: 3, altMax: 8, speedMax: 4 }; // "good spraying" envelope for the score

export function makeAgri(m) {
  const f = m.field, c = f.cell;
  const nx = Math.round((f.max[0] - f.min[0]) / c), nz = Math.round((f.max[1] - f.min[1]) / c);
  const kind = new Uint8Array(nx * nz); // 0 = target cell, 1 = no-spray cell (house, river)
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = f.min[0] + (i + 0.5) * c, z = f.min[1] + (j + 0.5) * c;
    for (const r of m.noSpray) if (x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]) kind[i * nz + j] = 1;
  }
  let targets = 0;
  for (let i = 0; i < kind.length; i++) if (kind[i] === 0) targets++;
  return {
    m, nx, nz, kind, targets, dose: new Float32Array(nx * nz),
    tank: m.dose.capacity, total: 0, outside: 0, noSprayDose: 0, empties: 0, refills: 0,
    sprayMs: 0, goodMs: 0, lastMs: -1, empty: false,
  };
}

export function refill(a) { if (a.tank < a.m.dose.capacity) { a.tank = a.m.dose.capacity; a.refills++; } a.empty = false; }

// One sample: { t_ms, pos, vel, spraying }. wind: { speed, dir } or null.
export function sprayStep(a, s, wind) {
  const dt = a.lastMs < 0 ? 0 : Math.min(0.3, (s.t_ms - a.lastMs) / 1000);
  a.lastMs = s.t_ms;
  if (!s.spraying || dt <= 0) return;
  const m = a.m, f = m.field, c = f.cell;
  let amount = m.dose.flow * dt;
  if (a.tank <= 0) return; // dry: nothing comes out (running dry was counted when it happened)
  if (amount > a.tank) amount = a.tank;
  a.tank -= amount;
  if (a.tank <= 1e-9 && !a.empty) { a.empty = true; a.empties++; } // the tank ran dry while spraying
  const alt = s.pos[1], speed = Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
  a.sprayMs += dt * 1000;
  if (alt >= SPRAY_ENV.altMin && alt <= SPRAY_ENV.altMax && speed <= SPRAY_ENV.speedMax) a.goodMs += dt * 1000;
  // Landing point: pushed downwind for the time it takes to fall (about alt / 4 m/s).
  let cx = s.pos[0], cz = s.pos[2];
  if (wind) { const fall = (alt / 4) * wind.speed; cx += Math.sin(wind.dir * DEG) * fall; cz -= Math.cos(wind.dir * DEG) * fall; }
  const rr = swathWidth(alt) / 2 + c * 0.35;
  const i0 = Math.floor((cx - rr - f.min[0]) / c), i1 = Math.floor((cx + rr - f.min[0]) / c);
  const j0 = Math.floor((cz - rr - f.min[1]) / c), j1 = Math.floor((cz + rr - f.min[1]) / c);
  let n = 0;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (Math.hypot(f.min[0] + (i + 0.5) * c - cx, f.min[1] + (j + 0.5) * c - cz) <= rr) n++;
  a.total += amount;
  if (n === 0) { a.outside += amount; return; }
  const share = amount / n;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    if (Math.hypot(f.min[0] + (i + 0.5) * c - cx, f.min[1] + (j + 0.5) * c - cz) > rr) continue;
    if (i < 0 || j < 0 || i >= a.nx || j >= a.nz) a.outside += share;
    else if (a.kind[i * a.nz + j] === 1) a.noSprayDose += share;
    else a.dose[i * a.nz + j] += share;
  }
}

// Summary numbers: coverage (cells with density inside the target range), waste share, spray-envelope share.
export function agriSummary(a) {
  const area = a.m.field.cell * a.m.field.cell, lo = a.m.dose.lo * area, hi = a.m.dose.hi * area;
  let good = 0, excess = 0;
  for (let i = 0; i < a.dose.length; i++) {
    if (a.kind[i] === 1) continue;
    if (a.dose[i] >= lo && a.dose[i] <= hi) good++;
    if (a.dose[i] > hi) excess += a.dose[i] - hi;
  }
  const wasted = a.outside + a.noSprayDose + excess;
  return {
    coverage: a.targets ? good / a.targets : 0,
    waste: a.total > 0 ? Math.min(1, wasted / a.total) : 1,
    envelope: a.sprayMs > 0 ? a.goodMs / a.sprayMs : 0,
    total: a.total, outside: a.outside, noSprayDose: a.noSprayDose, excess,
  };
}
// Dose state of one cell for drawing: 0 none, 1 low, 2 in range, 3 too much.
export function cellState(a, i) {
  const area = a.m.field.cell * a.m.field.cell, d = a.dose[i];
  return d <= 0 ? 0 : d < a.m.dose.lo * area ? 1 : d <= a.m.dose.hi * area ? 2 : 3;
}
