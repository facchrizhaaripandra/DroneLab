import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sceneColliders } from '../src/terrain.js';

// Hitbox harus mengikuti bentuk yang terlihat: di bawah lengan lampu lalu lintas dan lampu jalan (kawasan perkotaan)
// drone harus bisa lewat. Titik = 60% tinggi lengan, di bawah lengan (koordinat simulator).
const UNDER_ARMS = [["traffic_lights",-233.58,3.3,-36.5],["traffic_lights",-254.18,3.3,-11.5],["traffic_lights",-233.58,3.3,-236.5],["traffic_lights",-254.18,3.3,-211.5],["traffic_lights",-233.58,3.3,48.5],["traffic_lights",-254.18,3.3,63.5],["traffic_lights",-233.58,3.3,-131.5],["traffic_lights",-254.18,3.3,-116.5],["street_lamps",-339,5.47,-23.04],["street_lamps",-243.96,5.47,72],["street_lamps",-309,5.47,-23.04],["street_lamps",-243.96,5.47,42],["street_lamps",-243.96,5.47,17],["street_lamps",-259,5.47,-23.04],["street_lamps",-243.96,5.47,-8],["street_lamps",-224,5.47,-23.04]];

test('a drone can fly under traffic light and street lamp arms', () => {
  const meta = JSON.parse(fs.readFileSync(new URL('../public/scenes/s6_kota_pengiriman/scene.json', import.meta.url)));
  const cols = sceneColliders(meta.colliders);
  for (const [kind, x, y, z] of UNDER_ARMS) {
    const r = 0.5; // radius bola drone
    const hit = cols.find((c) => c.min[0] - r < x && x < c.max[0] + r && c.min[1] - r < y && y < c.max[1] + r && c.min[2] - r < z && z < c.max[2] + r);
    assert.ok(!hit, `${kind} at ${x}, ${y}, ${z} blocked by ${JSON.stringify(hit)}`);
  }
});
