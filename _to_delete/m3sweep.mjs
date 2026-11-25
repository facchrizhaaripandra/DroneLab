import { SCENARIOS } from '../src/scenarios-data.js';
import { makeAgri, sprayStep, agriSummary, refill } from '../src/agri.js';
const DEG = Math.PI / 180;
const m = SCENARIOS['m3_agri:sawah'].mission, w = SCENARIOS['m3_agri:sawah'].wind, f = m.field;
function run(alt, speed, spacing, margin) {
  const a = makeAgri(m);
  const fall = (alt / 4) * w.speed, dx = Math.sin(w.dir * DEG) * fall, dz = -Math.cos(w.dir * DEG) * fall;
  let t = 0, dir = 1;
  const inZone = (x, z) => m.noSpray.some((r) => x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]);
  for (let lx = f.min[0] + spacing / 2; lx <= f.max[0] + 0.01; lx += spacing) {
    const z0 = dir > 0 ? f.min[1] - margin : f.max[1] + margin, z1 = dir > 0 ? f.max[1] + margin : f.min[1] - margin;
    for (let z = z0; dir > 0 ? z <= z1 : z >= z1; z += dir * speed * 0.1) {
      if (a.tank <= 0.01) refill(a);
      t += 100;
      const on = lx >= f.min[0] && lx <= f.max[0] && z >= f.min[1] && z <= f.max[1] && !inZone(lx, z);
      sprayStep(a, { t_ms: t, pos: [lx - dx, alt, z - dz], vel: [0, 0, speed], spraying: on }, w);
    }
    dir = -dir;
  }
  const s = agriSummary(a);
  return { cov: +s.coverage.toFixed(3), waste: +s.waste.toFixed(2), refills: a.refills };
}
for (const alt of [3, 4, 5, 6, 8]) for (const speed of [2, 3, 4]) for (const spacing of [2.5, 3, 3.5, 4, 4.5]) console.log(alt, speed, spacing, JSON.stringify(run(alt, speed, spacing, 0)));
