// World builder. The world comes from a config (+ seed), never hard-coded in the render code,
// so the gateway can supply the same shape of config in later phases.
import * as THREE from 'three';
import { events } from './events.js';
import { makeDefaultConfig } from './worldconfig.js';
import { makeAgri, cellState } from './agri.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createFireField } from './fire.js';
import { createSky, createBackdrop, HAZE } from './sky.js';
import { buildingLayout, buildingColliders, bridgeLayout } from './buildings.js';

// Realistic tree models (public/models/trees.glb, built in Blender from photographed leaves). Loaded once; until
// they arrive (or if the file is missing) the forest is drawn with the simple cone trees.
let treeModels = null;
function loadTreeModels() {
  if (!treeModels) {
    treeModels = new GLTFLoader().loadAsync('/models/trees.glb').then((g) => g.scene.children.map((node) => {
      const box = new THREE.Box3().setFromObject(node);
      const parts = [];
      node.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material.alphaTest > 0) o.material.color.setScalar(1.3); // leaf cards read darker than the cone trees under the same lights
        parts.push({ geometry: o.geometry, material: o.material });
      });
      return { parts, height: box.max.y - box.min.y, radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 };
    }).filter((v) => v.parts.length && v.height > 0)).catch(() => null);
  }
  return treeModels;
}

export { makeDefaultConfig };

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// One InstancedMesh per kind: few draw calls, shared geometry and material.
function instancedBoxes(list, material, colorFn) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length);
  list.forEach((b, i) => {
    _p.set(b.x, b.h / 2, b.z);
    _s.set(b.w, b.h, b.d);
    _m.compose(_p, _q.identity(), _s);
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, colorFn(b));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// Sky: a vertical gradient used as an equirectangular background (zenith blue -> pale horizon -> haze below).
let skyTex = null;
function skyTexture() {
  if (skyTex) return skyTex;
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#3f78b8'); grad.addColorStop(0.32, '#7fa9d4'); grad.addColorStop(0.49, '#d3e2ee');
  grad.addColorStop(0.52, '#c9d6dc'); grad.addColorStop(1, '#8c9a8e');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  skyTex = new THREE.CanvasTexture(c);
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  skyTex.colorSpace = THREE.SRGBColorSpace;
  return skyTex;
}
const HORIZON = 0xd3e2ee;

// Soft round puff (smoke) and flame glow textures, drawn once on a canvas.
let puffTex = null, glowTex = null;
function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const puffTexture = () => puffTex || (puffTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]));
const glowTexture = () => glowTex || (glowTex = radialTexture([[0, 'rgba(255,240,190,1)'], [0.3, 'rgba(255,170,60,0.8)'], [1, 'rgba(255,90,20,0)']]));

// Gedung prosedural (buildings.js): semua bagian digabung jadi satu mesh berwarna per titik. Jendela, rangka kaca,
// rolling door, panel pracetak dan seng digambar di shader dari atribut aFac = (gaya, lebar bay, tinggi lantai).
function buildingMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFac;\nvarying vec3 vDlPos;\nvarying vec3 vDlN;\nvarying vec3 vFac;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vDlPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDlN = objectNormal; vFac = aFac;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDlPos;\nvarying vec3 vDlN;\nvarying vec3 vFac;
        float dlHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float box2(vec2 c, float x0, float x1, float y0, float y1) { return step(x0, c.x) * step(c.x, x1) * step(y0, c.y) * step(c.y, y1); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float side = 1.0 - step(0.5, abs(vDlN.y));
        float st = floor(vFac.x + 0.5);
        if (st > 0.5 && side > 0.5) {
          vec2 fp = vec2(abs(vDlN.x) > 0.5 ? vDlPos.z : vDlPos.x, vDlPos.y);
          vec2 cs = max(vFac.yz, vec2(0.2));
          vec2 id = floor(fp / cs), c = fract(fp / cs);
          float rnd = dlHash(id);
          vec3 base = diffuseColor.rgb;
          vec3 glass = mix(vec3(0.10, 0.15, 0.20), vec3(0.38, 0.50, 0.60), clamp(rnd * 0.55 + fp.y * 0.008, 0.0, 1.0));
          if (st < 1.5) { // dinding kaca: rangka tipis, panel spandrel di tiap lantai
            vec3 g = mix(vec3(0.17, 0.27, 0.35), vec3(0.50, 0.63, 0.72), clamp(fp.y * 0.012 + rnd * 0.18, 0.0, 1.0));
            vec3 col = c.y < 0.24 ? vec3(0.20, 0.24, 0.28) : g;
            float frameM = 1.0 - box2(c, 0.04, 0.96, 0.03, 1.0);
            diffuseColor.rgb = mix(col, base * 0.6, frameM);
          } else if (st < 2.5) { // jendela berbingkai
            float win = box2(c, 0.22, 0.78, 0.30, 0.84), fr = box2(c, 0.19, 0.81, 0.27, 0.87) - win;
            diffuseColor.rgb = mix(base, vec3(0.92), fr * 0.7);
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
            diffuseColor.rgb *= 1.0 - step(c.y, 0.05) * 0.12;
          } else if (st < 3.5) { // ruko: rolling door di lantai dasar, jendela di atas
            if (fp.y < cs.y) {
              float door = box2(vec2(fract(fp.x / (cs.x * 2.0)), fp.y / cs.y), 0.06, 0.94, 0.0, 0.8);
              vec3 sh = vec3(0.60, 0.62, 0.64) * (0.88 + 0.12 * step(0.5, fract(fp.y * 7.0)));
              diffuseColor.rgb = mix(base, sh, door);
            } else {
              float win = box2(c, 0.18, 0.82, 0.32, 0.82), fr = box2(c, 0.15, 0.85, 0.29, 0.85) - win;
              diffuseColor.rgb = mix(base, vec3(0.30, 0.25, 0.22), fr);
              diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
            }
          } else if (st < 4.5) { // panel pracetak: garis sambungan, jendela lajur
            float joint = 1.0 - box2(c, 0.012, 0.988, 0.015, 1.0);
            float win = box2(c, 0.12, 0.88, 0.44, 0.80);
            diffuseColor.rgb = mix(base, glass, win);
            diffuseColor.rgb = mix(diffuseColor.rgb, base * 0.55, joint);
          } else if (st < 5.5) { // seng bergelombang
            diffuseColor.rgb = base * (0.84 + 0.16 * step(0.5, fract(fp.x * 5.0)));
          } else if (st < 6.5) { // kaca lobi tinggi
            float pane = box2(c, 0.03, 0.97, 0.0, 0.86);
            diffuseColor.rgb = mix(base, mix(glass, vec3(0.55, 0.64, 0.70), 0.25), pane);
          } else { // rangka hangus: lubang jendela gelap, jelaga makin pekat ke atas
            float hole = box2(c, 0.15, 0.85, 0.25, 0.85);
            float soot = clamp(0.25 + rnd * 0.5 + fp.y * 0.02, 0.0, 0.9);
            diffuseColor.rgb = mix(base, vec3(0.08, 0.07, 0.06), max(hole * 0.92, soot * 0.6));
          }
        }
        diffuseColor.rgb *= mix(1.0, 0.86, 1.0 - side);`);
  };
  return m;
}

// Bagian gedung -> satu BufferGeometry (posisi, normal, warna, aFac). null bila tidak ada gedung.
const buildingMesh = (list) => partsMesh(list.flatMap((b) => buildingLayout(b).parts));
function partsMesh(parts) {
  const pos = [], nor = [], col = [], fac = [];
  const add = (g, color, f) => {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position.array, n = ng.attributes.normal.array;
    _c.setHex(color);
    for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); col.push(_c.r, _c.g, _c.b); fac.push(f[0], f[1], f[2]); }
    g.dispose(); if (ng !== g) ng.dispose();
  };
  {
    for (const pt of parts) {
      if (pt.t === 'box') add(new THREE.BoxGeometry(pt.s[0], pt.s[1], pt.s[2]).translate(pt.c[0], pt.c[1], pt.c[2]), pt.col, pt.fac);
      else if (pt.t === 'cyl') add(new THREE.CylinderGeometry(pt.r, pt.r, pt.h, 10).translate(pt.c[0], pt.c[1], pt.c[2]), pt.col, [0, 1, 1]);
      else if (pt.t === 'gable') { // prisma atap pelana, bubungan sepanjang sumbu
        const [sx, sy, sz] = pt.s, along = pt.axis === 'x';
        const L = (along ? sx : sz) / 2, W = (along ? sz : sx) / 2;
        const P = (u, y, v) => (along ? [u, y, v] : [v, y, u]);
        const v = [P(-L, -sy / 2, -W), P(L, -sy / 2, -W), P(L, sy / 2, 0), P(-L, sy / 2, 0), P(-L, -sy / 2, W), P(L, -sy / 2, W)];
        const tri = [[0, 2, 1], [0, 3, 2], [4, 5, 2], [4, 2, 3], [0, 4, 3], [1, 2, 5], [0, 1, 5], [0, 5, 4]];
        const arr = [];
        for (const t of tri) for (const k of t) arr.push(...v[k]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        g.translate(pt.c[0], pt.c[1], pt.c[2]);
        g.computeVertexNormals();
        // segitiga dibuat dua arah putaran: pastikan normal menghadap keluar dari pusat
        const pa = g.attributes.position.array, na = g.attributes.normal.array;
        for (let i = 0; i < pa.length; i += 9) {
          const cx = (pa[i] + pa[i + 3] + pa[i + 6]) / 3 - pt.c[0], cy = (pa[i + 1] + pa[i + 4] + pa[i + 7]) / 3 - pt.c[1] + sy * 0.2, cz = (pa[i + 2] + pa[i + 5] + pa[i + 8]) / 3 - pt.c[2];
          if (na[i] * cx + na[i + 1] * cy + na[i + 2] * cz < 0) {
            for (let k = 0; k < 9; k++) na[i + k] = -na[i + k];
            for (let k = 0; k < 3; k++) { const t = pa[i + 3 + k]; pa[i + 3 + k] = pa[i + 6 + k]; pa[i + 6 + k] = t; }
          }
        }
        add(g, pt.col, pt.fac);
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFac', new THREE.Float32BufferAttribute(fac, 3));
  const mesh = new THREE.Mesh(g, buildingMaterial());
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Ground: soft large patches (mown / dry grass) instead of one flat colour.
function groundMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0x8aa07a });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGp = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n = sin(vGp.x * 0.045) * sin(vGp.y * 0.038) + 0.5 * sin(vGp.x * 0.13 + vGp.y * 0.09) + 0.25 * sin(vGp.x * 0.41 - vGp.y * 0.37);
        diffuseColor.rgb *= 0.9 + 0.08 * n;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.42), smoothstep(0.6, 1.3, n) * 0.25);`);
  };
  return m;
}

export function buildWorld(scene, config) {
  const real = config.realScene || null; // realistic Blender scene: { root, colliders, groundAt } (see realworld.js)
  scene.background = skyTexture();
  scene.fog = real ? new THREE.Fog(HAZE, 300, 1700) : new THREE.Fog(HAZE, 140, 420);
  const root = new THREE.Group(); // everything of this world lives here, so dispose() can remove it
  scene.add(root);

  // Realistic scenes use PBR materials from Blender: they need more light than the flat-colored world.
  root.add(new THREE.HemisphereLight(0xdfefff, 0x6b7f5c, real ? 1.7 : 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, real ? 2.6 : 1.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; // no acne on the large flat faces
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 160;
  root.add(sun, sun.target);

  // Langit (kubah dengan awan, ikut kamera) dan latar pemandangan di luar batas peta. Batas peta = tembok tak terlihat
  // (Flight menahan drone di bounds), jadi gambar latar tidak pernah bisa didekati.
  const extent = config.bounds || 100;
  const backR = extent + (real ? 160 : 230);
  const sky = createSky(real ? 2700 : 850);
  const wind = config.wind;
  if (wind) sky.setWind(wind.dir, Math.max(1, wind.speed));
  sky.setClouds(config.clouds ? config.clouds.cover : 0.4, config.clouds ? config.clouds.seed : 0);
  const sid = real ? real.id || '' : '';
  const theme = /gedung|kota|inspeksi_gedung/.test(sid) || (!real && (config.buildings || []).length > 6) ? 'city' : 'nature';
  const backdrop = createBackdrop({ radius: backR, base: real ? (real.groundMin ?? 0) : 0, theme, seed: (config.seed || 1) + sid.length, groundColor: real ? 0x6f7f5c : 0x86997a });
  root.add(sky.mesh, backdrop.group);

  // Ground + grid (the grid gives a sense of speed without textures). A realistic scene brings its own ground.
  if (real) {
    root.add(real.root);
    // Water reflects the sky gradient (Blender only gives it a colour and a ripple normal map): lakes and the sea
    // pick up the pale horizon at low angles instead of looking like painted plates.
    real.root.traverse((o) => {
      if (!o.isMesh || !/water|lake|sea_|stream/.test(o.name) || /bed|decal/.test(o.name)) return;
      for (const m of [].concat(o.material)) {
        if (!m || m.transparent) continue;
        m.envMap = skyTexture(); m.envMapIntensity = 0.85; m.needsUpdate = true;
      }
    });
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(config.bounds * 2 + 200, config.bounds * 2 + 200),
    groundMaterial(),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const grid = new THREE.GridHelper(config.bounds * 2, config.bounds, 0x6b7f5c, 0x7a8f6a);
  grid.position.y = 0.02;
  grid.material.transparent = true; grid.material.opacity = 0.28; grid.material.depthWrite = false; // a hint of scale, not a sheet of graph paper
  ground.position.y = 0;
  if (!real) root.add(ground, grid);

  // Home pad at (0, 0, 0): disc + an "H".
  const padMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pad = new THREE.Mesh(new THREE.CircleGeometry(3, 32), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = real ? 0.06 : 0.03;
  root.add(pad);
  const hMat = new THREE.MeshBasicMaterial({ color: 0xd9822b });
  const hGeo = new THREE.BoxGeometry(0.4, 0.02, 2);
  const hBar = new THREE.BoxGeometry(1.2, 0.02, 0.4);
  for (const [geo, x] of [[hGeo, -0.6], [hGeo, 0.6], [hBar, 0]]) {
    const m = new THREE.Mesh(geo, hMat);
    m.position.set(x, real ? 0.08 : 0.05, 0);
    root.add(m);
  }

  // Buildings and obstacles (instanced).
  const bMesh = buildingMesh(config.buildings); // ruko, kantor, apartemen, gudang, rangka terbakar (buildings.js)
  const oMesh = instancedBoxes(config.obstacles, new THREE.MeshLambertMaterial({ color: 0xffffff }),
    () => _c.set(0xd9822b));
  if (bMesh) root.add(bMesh);
  root.add(oMesh);

  const colliders = config.buildings.flatMap((b) => buildingColliders(b));
  for (const b of [...config.obstacles, ...(config.trees || [])]) colliders.push({ min: [b.x - b.w / 2, 0, b.z - b.d / 2], max: [b.x + b.w / 2, b.h, b.z + b.d / 2] });
  if (real) for (const c of real.colliders) colliders.push(c);
  const groundAt = real && real.groundAt ? real.groundAt : () => 0;

  // ---- mission objects (M1, M2, M3, M5). Everything is built once per world from the config. ----
  const m = config.mission || {};
  const fire = createFireField(); // api, bara, dan asap (fire.js); thermal mode memutihkannya
  root.add(fire.group);
  if (config.wind) fire.setWind(config.wind.dir, config.wind.speed || 1);
  let lastPos = [0, 0, 0];
  let personMat = null, field = null, fieldAgri = null;
  const markers = new THREE.Group();
  root.add(markers);

  // Forest: instanced trunks and crowns. Collision uses the tree box.
  const trees = config.trees || [];
  if (trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 1, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 9), new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
    const crown2 = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 9), new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
    trees.forEach((t, i) => {
      const k = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233)) % 1; // stable per-tree variation
      _m.compose(_p.set(t.x, t.h * 0.2, t.z), _q.identity(), _s.set(1, t.h * 0.4, 1)); trunk.setMatrixAt(i, _m);
      _m.compose(_p.set(t.x, t.h * 0.25 + t.h * 0.3, t.z), _q.setFromAxisAngle(_s.set(0, 1, 0), k * 6), _s.set(t.r, t.h * 0.6, t.r)); crown.setMatrixAt(i, _m);
      _m.compose(_p.set(t.x, t.h * 0.62 + t.h * 0.19, t.z), _q.setFromAxisAngle(_s.set(0, 1, 0), k * 3), _s.set(t.r * 0.68, t.h * 0.38, t.r * 0.68)); crown2.setMatrixAt(i, _m);
      crown.setColorAt(i, _c.setHSL(0.28 + k * 0.08, 0.38 + k * 0.15, 0.2 + k * 0.08));
      crown2.setColorAt(i, _c.setHSL(0.28 + k * 0.08, 0.38 + k * 0.15, 0.25 + k * 0.08)); // lit tip, a shade lighter
    });
    for (const mesh of [trunk, crown, crown2]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; root.add(mesh); }
    // swap the cones for the realistic models as soon as they are loaded (same place, height and crown size)
    loadTreeModels().then((variants) => {
      if (!variants || !variants.length) return;
      const per = variants.map(() => []);
      trees.forEach((t) => per[Math.floor(Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233)) * 43758.5453) % variants.length].push(t));
      const up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      variants.forEach((v, k) => {
        const list = per[k];
        if (!list.length) return;
        for (const part of v.parts) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
          list.forEach((t, i) => {
            const s = t.h / v.height, sw = Math.min(1.3, Math.max(0.75, t.r / (v.radius * s))) * s;
            m.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(up, (t.x * 7.31 + t.z * 3.17) % 6.283), sc.set(sw, s, sw));
            im.setMatrixAt(i, m);
          });
          im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
          root.add(im);
        }
      });
      for (const mesh of [trunk, crown, crown2]) mesh.visible = false;
    });
  }
  // Solid blocks with a base height (bridge deck and piers, mountain core). `hidden` ones only collide.
  for (const b of config.solids || []) {
    colliders.push({ min: [b.x - b.w / 2, b.y0, b.z - b.d / 2], max: [b.x + b.w / 2, b.y0 + b.h, b.z + b.d / 2] });
    if (b.hidden) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(0.6, 0.05, 0.5 + (b.shade || 0) * 0.2) }));
    mesh.position.set(b.x, b.y0 + b.h / 2, b.z); mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (m.structure && m.variant === 'jembatan') { // jembatan M5: aspal, kerb, pagar, lampu, gelagar, kepala pilar
    const br = bridgeLayout(m.structure);
    const bm = partsMesh(br.parts); if (bm) root.add(bm);
    for (const c of br.colliders) colliders.push(c);
  }
  const flat = (geo, color, x, y, z) => { // a flat shape on the ground
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  for (const l of m.landmarks || []) {
    if (l.kind === 'peak') {
      const body = new THREE.Mesh(new THREE.ConeGeometry(l.r, l.h, 16), new THREE.MeshLambertMaterial({ color: 0x7d746a }));
      body.position.set(l.x, l.h / 2, l.z); body.castShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(l.r * 0.27, l.h * 0.27, 16), new THREE.MeshLambertMaterial({ color: 0xf2f4f6 }));
      cap.position.set(l.x, l.h * 0.865, l.z);
      root.add(body, cap);
    } else if (l.kind === 'lake') flat(new THREE.CircleGeometry(l.r, 32), 0x3d86c6, l.x, 0.06, l.z);
    else if (l.kind === 'pool') flat(new THREE.PlaneGeometry(l.w, l.d), 0x4fb3d9, l.x, 0.08, l.z);
  }

  // M1: victims, fire, smoke, safe point
  if (m.victims) {
    personMat = new THREE.MeshLambertMaterial({ color: 0xff7a2f });
    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.9, 6), headGeo = new THREE.SphereGeometry(0.2, 8, 6);
    for (const v of m.victims) {
      const body = new THREE.Mesh(bodyGeo, personMat), head = new THREE.Mesh(headGeo, personMat);
      body.position.set(v.x, v.y + 0.45, v.z); head.position.set(v.x, v.y + 1.1, v.z);
      body.castShadow = true;
      root.add(body, head);
    }
    // Api: lidah api shader, cahaya, bara; asap naik terbawa angin (fire.js). Bidang hangus tetap digambar di tanah.
    for (const f of m.fires) {
      flat(new THREE.CircleGeometry(f.r, 24), 0x241510, f.x, 0.05, f.z);
      fire.add({ x: f.x, y: 0.05, z: f.z, r: f.r, h: 1.5 + f.r * 0.75, smoke: false });
    }
    for (const sm of m.smoke) fire.add({ x: sm.x, y: 0.5, z: sm.z, r: sm.r, h: 2, smokeH: sm.h * 1.6, flame: false });
    const safe = flat(new THREE.CircleGeometry(m.safe.r, 24), 0x2ea66b, m.safe.x, 0.06, m.safe.z);
    safe.material = new THREE.MeshBasicMaterial({ color: 0x2ea66b });
  }

  // M3: the field is a grid of cells. Colors show the dose (see setFieldDose).
  if (m.field) {
    const f = m.field, agri = makeAgri(m), c = f.cell;
    flat(new THREE.PlaneGeometry(m.river.max[0] - m.river.min[0], m.river.max[1] - m.river.min[1]), 0x4a90d9, (m.river.min[0] + m.river.max[0]) / 2, 0.03, (m.river.min[1] + m.river.max[1]) / 2);
    const geo = new THREE.PlaneGeometry(c * 0.94, c * 0.94); geo.rotateX(-Math.PI / 2);
    field = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), agri.nx * agri.nz);
    field.frustumCulled = false;
    for (let i = 0; i < agri.nx; i++) for (let j = 0; j < agri.nz; j++) {
      const idx = i * agri.nz + j;
      _m.compose(_p.set(f.min[0] + (i + 0.5) * c, 0.08, f.min[1] + (j + 0.5) * c), _q.identity(), _s.set(1, 1, 1));
      field.setMatrixAt(idx, _m);
      const cx = f.min[0] + (i + 0.5) * c, cz = f.min[1] + (j + 0.5) * c;
      const zone = m.noSpray.find((r) => cx >= r.min[0] && cx <= r.max[0] && cz >= r.min[1] && cz <= r.max[1]);
      field.setColorAt(idx, _c.setHex(zone ? (zone.kind === 'river' ? 0x4a90d9 : 0xc96a5b) : (j % 2 ? 0x4f8a3a : 0x5e9a46)));
    }
    field.instanceMatrix.needsUpdate = true; field.instanceColor.needsUpdate = true;
    root.add(field);
    fieldAgri = agri;
  }

  // M5: defects are flat marks on the surface, facing outward. They are not colliders.
  for (const d of m.defects || []) {
    const crack = d.kind === 'retak';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: crack ? 0x1a1a1a : 0xb5532a, side: THREE.DoubleSide }));
    mesh.scale.set(crack ? d.size : d.size * 0.7, crack ? d.size * 0.18 : d.size * 0.7, 1);
    mesh.position.set(d.x, d.y, d.z);
    mesh.rotation.y = Math.atan2(d.nx, d.nz);
    if (crack) mesh.rotation.z = 0.5;
    root.add(mesh);
  }

  // Checkpoint rings: sensors only (no collider). One geometry, two shared materials.
  const ringGeo = new THREE.TorusGeometry(2.5, 0.14, 8, 32);
  const matIdle = new THREE.MeshBasicMaterial({ color: 0xf5b700 });
  const matDone = new THREE.MeshBasicMaterial({ color: 0x2ea66b });
  const rings = config.rings.map((g, index) => {
    const mesh = new THREE.Mesh(ringGeo, matIdle);
    mesh.position.set(g.x, g.y, g.z);
    mesh.lookAt(0, g.y, 0); // ring faces the center, so flying inward passes through it
    root.add(mesh);
    return { mesh, index, x: g.x, y: g.y, z: g.z, passed: false };
  });

  // Mission markers (flat discs + a thin beacon) and no-fly zones (translucent red boxes).
  if (config.mission && config.mission.pickup) {
    const m = config.mission;
    const disc = (spot, color) => {
      const d = new THREE.Mesh(new THREE.CircleGeometry(spot.r, 32), new THREE.MeshBasicMaterial({ color }));
      d.rotation.x = -Math.PI / 2; d.position.set(spot.x, 0.06, spot.z);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 14, 8), new THREE.MeshBasicMaterial({ color }));
      beacon.position.set(spot.x, 7, spot.z);
      root.add(d, beacon);
    };
    disc(m.pickup, 0xf5b700);
    disc(m.drop, 0x2ea66b);
    const zoneMat = new THREE.MeshBasicMaterial({ color: 0xd64545, transparent: true, opacity: 0.25, depthWrite: false });
    for (const z of m.noFly) {
      const w = z.max[0] - z.min[0], d = z.max[1] - z.min[1];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 40, d), zoneMat);
      mesh.position.set((z.min[0] + z.max[0]) / 2, 20, (z.min[1] + z.max[1]) / 2);
      root.add(mesh);
    }
  }

  // Freeroam "add object" (B): one box per press, shared geometry and material, capped.
  const extraGeo = new THREE.BoxGeometry(2, 3, 2);
  const extraMat = new THREE.MeshLambertMaterial({ color: 0xd9822b });
  const MAX_EXTRA = 20;
  let extraCount = 0;

  // M2 sets the sun angle (azimuth in the yaw convention = where the light comes from, elevation in degrees).
  const sunDir = [40 / 80, 70 / 80, 25 / 80];
  if (m.sun) {
    const az = (m.sun.az * Math.PI) / 180, el = (m.sun.el * Math.PI) / 180;
    sunDir[0] = Math.sin(az) * Math.cos(el); sunDir[1] = Math.sin(el); sunDir[2] = -Math.cos(az) * Math.cos(el);
  }
  sky.setSun(sunDir[0], sunDir[1], sunDir[2]);

  const world = {
    colliders,
    config,
    // Adds a 2x3x2 m box on the ground at (x, z). Returns the box, or null at the cap or outside the map.
    addBox(x, z) {
      if (extraCount >= MAX_EXTRA || Math.abs(x) > config.bounds - 2 || Math.abs(z) > config.bounds - 2) return null;
      extraCount++;
      const y0 = groundAt(x, z);
      const mesh = new THREE.Mesh(extraGeo, extraMat);
      mesh.position.set(x, y0 + 1.5, z);
      mesh.castShadow = true;
      root.add(mesh);
      colliders.push({ min: [x - 1, y0, z - 1], max: [x + 1, y0 + 3, z + 1] });
      return { x, z, w: 2, d: 2, h: 3 };
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        for (const mat of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) if (mat[k]) mat[k].dispose();
          mat.dispose();
        }
        if (o.isInstancedMesh) o.dispose();
      });
    },
    rings,
    passedCount: 0,
    // Sensor check, called once per physics step.
    update(pos) {
      lastPos = pos;
      for (let i = 0; i < rings.length; i++) {
        const g = rings[i];
        if (g.passed) continue;
        const dx = pos[0] - g.x, dy = pos[1] - g.y, dz = pos[2] - g.z;
        if (dx * dx + dy * dy + dz * dz < 4) {
          g.passed = true;
          g.mesh.material = matDone;
          world.passedCount++;
          events.emit('zone_enter', { kind: 'checkpoint', index: g.index });
        }
      }
    },
    // Thermal mode: people and fire glow white-hot, smoke becomes thin. (The canvas also gets a CSS filter in main.js.)
    setThermal(on) {
      if (personMat) personMat.color.setHex(on ? 0xffffff : 0xff7a2f);
      fire.setThermal(on);
    },
    // A flag where the pilot pressed "tandai".
    addMarker(x, y, z) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.03), new THREE.MeshBasicMaterial({ color: 0xd64545 }));
      pole.position.set(x, y + 1.25, z); flag.position.set(x + 0.35, y + 2.2, z);
      markers.add(pole, flag);
    },
    // M3: repaint the cells from the dose state (call when the numbers changed, about 2 times a second).
    setFieldDose(agri) {
      if (!field) return;
      const f = config.mission.field;
      for (let i = 0; i < agri.nx; i++) for (let j = 0; j < agri.nz; j++) {
        const idx = i * agri.nz + j;
        if (agri.kind[idx] === 1) continue;
        const st = cellState(agri, idx);
        field.setColorAt(idx, _c.setHex(st === 0 ? (j % 2 ? 0x4f8a3a : 0x5e9a46) : st === 1 ? 0x9fd3ee : st === 2 ? 0x2fd0a0 : 0x6a4fc8));
      }
      field.instanceColor.needsUpdate = true;
    },
    // Api, bara, dan asap bergerak di shader; di sini hanya waktu dan lampu api terdekat. Tanpa alokasi.
    tick(t, cam) { fire.update(t, lastPos); sky.update(t, cam); },
    // Sun angle (dataset export varies it). Azimuth in the yaw convention, elevation in degrees.
    setSun(az, el) {
      const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
      sunDir[0] = Math.sin(a) * Math.cos(e); sunDir[1] = Math.sin(e); sunDir[2] = -Math.cos(a) * Math.cos(e);
      sky.setSun(sunDir[0], sunDir[1], sunDir[2]);
    },
    // Shadows on/off (graphics setting). Only the sun casts shadows, so this is one flag.
    setShadows(on) { sun.castShadow = on; },
    // Keeps the limited shadow area centered on the drone.
    followLight(px, pz) {
      const gy = real ? groundAt(px, pz) : 0;
      sun.position.set(px + sunDir[0] * 80, gy + sunDir[1] * 80, pz + sunDir[2] * 80);
      sun.target.position.set(px, gy, pz);
    },
  };
  // Sumber api peta realistis (meta.fires dari scene.json), lalu dibangun sekali.
  if (real && real.fires) for (const f of real.fires) fire.add(f);
  fire.build();
  world.fireHazards = fire.hazards; // dipakai main.js: peringatan dekat api dan kerusakan panas
  return world;
}
