// Exports the mission catalog and every mission world to backend/worlds/ for the Python gateway.
//   node scripts/export_worlds.mjs
// Run it again after changing src/catalog.js, src/scenarios*.js, src/worldconfig.js or a scene's bounds.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MISSIONS } from '../src/catalog.js';
import { makeRunConfig } from '../src/scenarios.js';

const SEED = 42; // the only seed the simulator and the gateway use
const SCORER = { m1_sar: 'sar', m2_foto: 'photo', m3_agri: 'agri', m4_delivery: 'delivery', m5_inspeksi: 'inspection' };
const root = new URL('../', import.meta.url);

export const worldFile = (w) => `${w.mission_id}__${w.variant}.json`;

// Map rectangle: realistic maps from their scene.json, procedural worlds are a square of +-bounds.
function limitsOf(config) {
  if (config.scene) {
    const { bounds } = JSON.parse(readFileSync(new URL(`public/scenes/${config.scene}/scene.json`, root), 'utf8'));
    return { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ };
  }
  const b = config.bounds;
  return { minX: -b, maxX: b, minZ: -b, maxZ: b };
}

export function buildExport() {
  const main = MISSIONS.filter((m) => m.tier === 'utama');
  const missions = main.map(({ id, title, desc, par_time_s, variants, weights, gugur }) =>
    ({ id, title, desc, scorer: SCORER[id], par_time_s, variants, weights, gugur }));
  const worlds = main.flatMap((m) => m.variants.map((variant) => {
    const config = makeRunConfig(m.id, SEED, variant);
    return { mission_id: m.id, variant, seed: SEED, limits: limitsOf(config), config };
  }));
  return { missions, worlds };
}

// Started directly (not imported by a test). pathToFileURL keeps this working on Windows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { missions, worlds } = buildExport();
  const out = new URL('backend/worlds/', root);
  mkdirSync(out, { recursive: true });
  const write = (name, value) => writeFileSync(new URL(name, out), `${JSON.stringify(value, null, 1)}\n`);
  write('missions.json', missions);
  for (const w of worlds) write(worldFile(w), w);
  console.log(`wrote ${missions.length} missions and ${worlds.length} worlds to backend/worlds/`);
}
