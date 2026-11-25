// Misi utama di peta realistis (murni, tanpa Three.js, teruji di Node).
// Data titik misi ada di scenarios-data.js. Config yang dihasilkan sama bentuknya dengan misi prosedural
// (makeMissionConfig), ditambah `scene` (id peta di public/scenes) dan `scenario` (judul, ringkasan cerita).
// Varian prosedural lama tetap ada: namanya berakhiran "-acak" (atau "acak", "lahan" untuk M3 lama).
import { SCENARIOS } from './scenarios-data.js';
import { makeDefaultConfig, makeMissionConfig } from './worldconfig.js';
export { SCENARIOS };

export const isProcedural = (v) => !!v && (v === 'acak' || v === 'lahan' || v.endsWith('-acak'));
// Nama varian untuk makeMissionConfig. 'kota' dan 'lahan' adalah varian tunggal lama: tanpa nama.
export const baseVariant = (v) => (!v || v === 'kota' || v === 'acak' || v === 'lahan' ? undefined : v.replace(/-acak$/, ''));

// Skenario realistis untuk (misi, varian), atau null jika varian itu prosedural atau tidak ada skenarionya.
export function scenarioFor(missionId, variant) {
  if (isProcedural(variant)) return null;
  const exact = SCENARIOS[`${missionId}:${variant}`];
  if (exact) return exact;
  if (variant && variant !== 'kota') return null;
  const first = Object.keys(SCENARIOS).find((k) => k.startsWith(`${missionId}:`)); // tanpa varian: yang pertama
  return first ? SCENARIOS[first] : null;
}

// Daftar bidikan M2 (sama dengan versi prosedural, subjeknya dipilih per skenario).
function shotList(m) {
  const lm = (id) => m.landmarks.find((l) => l.id === id);
  const orbit = m.orbit || m.main, reveal = m.reveal || m.main;
  return [
    { id: 's1', type: 'photo', kind: 'wide', subject: m.main, areaRange: [0.05, 0.35], label: `Foto pembuka lebar: ${lm(m.main).name}` },
    { id: 's2', type: 'photo', kind: 'detail', subject: m.second, areaRange: [0.10, 0.60], label: `Foto detail: ${lm(m.second).name}` },
    { id: 's3', type: 'video', kind: 'orbit', subject: orbit, minDur: 8, maxDur: 16, label: `Video orbit 10 detik: ${lm(orbit).name}` },
    { id: 's4', type: 'video', kind: 'reveal', subject: reveal, minDur: 5, maxDur: 14, label: 'Video reveal: naik sambil menjauh' },
  ];
}

export function makeScenarioConfig(entry, seed = 42) {
  const c = makeDefaultConfig(seed);
  const mission = JSON.parse(JSON.stringify(entry.mission));
  if (mission.landmarks) {
    mission.shots = shotList(mission);
    for (const k of ['main', 'second', 'orbit', 'reveal']) delete mission[k];
  }
  const cfg = { ...c, buildings: [], obstacles: [], rings: [], trees: [], solids: [], scene: entry.scene, scenario: { title: entry.title, brief: entry.brief }, mission };
  if (entry.wind) cfg.wind = { ...entry.wind };
  return cfg;
}

// Satu pintu untuk gateway (stub dan mock server): skenario realistis, atau misi prosedural lama.
export function makeRunConfig(missionId, seed = 42, variant) {
  const entry = scenarioFor(missionId, variant);
  return entry ? makeScenarioConfig(entry, seed) : makeMissionConfig(missionId, seed, baseVariant(variant));
}
