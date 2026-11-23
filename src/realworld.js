// Realistic environments made in Blender (public/scenes/<id>/scene.glb + scene.json).
// scene.json comes from scripts/blender/export_scene.py: spawn offset, flight bounds, ground heightfield
// and AABB colliders, already in simulator coordinates with the spawn pad at (0, 0, 0).
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeHeightSampler, sceneColliders, sceneLimits, sceneMapBoxes } from './terrain.js';

const BASE = '/scenes';
let indexCache = null;
const cache = new Map(); // id -> { meta, gltf }: only the last scene, so "Ulangi" is instant without holding every scene

export async function loadSceneIndex() {
  if (indexCache) return indexCache;
  try {
    const r = await fetch(`${BASE}/index.json`);
    indexCache = r.ok ? await r.json() : [];
  } catch { indexCache = []; }
  return indexCache;
}

// onProgress(0..1) while the .glb downloads. Throws if the files are missing.
export async function loadScene(id, onProgress = () => {}) {
  if (cache.has(id)) return cache.get(id);
  const r = await fetch(`${BASE}/${id}/scene.json`);
  if (!r.ok) throw new Error(`scene.json ${r.status}`);
  const meta = await r.json();
  const gltf = await new GLTFLoader().loadAsync(`${BASE}/${id}/scene.glb`, (e) => {
    if (e.total) onProgress(e.loaded / e.total);
  });
  const entry = { meta, gltf };
  cache.clear();
  cache.set(id, entry);
  return entry;
}

// Turns a loaded scene into the pieces buildWorld() and Flight need.
export function prepareScene({ meta, gltf }) {
  const root = gltf.scene;
  root.position.set(meta.offset[0], meta.offset[1], meta.offset[2]); // spawn pad -> (0, 0, 0)
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const see = mats.some((m) => m && (m.transparent || m.alphaTest > 0));
    o.castShadow = !see && !/decal|weathering|marking|water/.test(o.name);
    for (const m of mats) if (m && m.transparent) m.depthWrite = false; // decals and glass over walls
  });
  const groundAt = makeHeightSampler(meta.height);
  const b = meta.bounds;
  return {
    root,
    groundAt,
    colliders: sceneColliders(meta.colliders),
    limits: sceneLimits(meta),
    mapBoxes: sceneMapBoxes(meta.mapBoxes),
    bounds: Math.ceil(Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minZ), Math.abs(b.maxZ))),
    title: meta.title,
    id: meta.id,
  };
}

// Freeroam config for a realistic scene: no generated buildings, the scene supplies everything.
export function realSceneConfig(base, prepared) {
  return {
    ...base,
    bounds: prepared.bounds,
    buildings: [], obstacles: [], rings: [], trees: [], solids: [],
    mapBoxes: prepared.mapBoxes,
    realScene: prepared,
  };
}
