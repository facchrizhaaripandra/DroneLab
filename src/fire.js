// Animasi kebakaran: api, bara, asap, dan cahaya api. Semua digerakkan di GPU (shader) sehingga
// ratusan sumber api tetap ringan. Tiap sumber api dibuat dengan add(), lalu build() sekali.
//
//   const fire = createFireField();           // fire.group ditambahkan ke scene
//   fire.add({ x, y, z, r: 4, h: 6 });        // r = radius sebaran api (m), h = tinggi lidah api (m)
//   fire.build();
//   fire.update(t, dronePos);                 // tiap frame
//
// Api: lidah api tegak (billboard silinder) dengan bentuk dari noise yang bergerak naik, warna dari
// merah tua ke kuning ke putih. Cahaya dasar, bara terbang, dan asap naik terbawa angin.
import * as THREE from 'three';

const GLSL_NOISE = /* glsl */`
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

const FLAME_VERT = /* glsl */`
  attribute vec3 aCenter;
  attribute vec4 aA; // seed, lebar, tinggi, kecepatan
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv; vSeed = aA.x;
    float fl = 1.0 + 0.18 * sin(uTime * 7.0 * aA.w + aA.x * 20.0) + 0.08 * sin(uTime * 13.0 * aA.w + aA.x * 7.0);
    vec3 toCam = cameraPosition - aCenter; toCam.y = 0.0;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(1e-4));
    vec3 world = aCenter + right * (position.x * aA.y) + vec3(0.0, position.y * aA.z * fl, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FLAME_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uThermal;
  varying vec2 vUv;
  varying float vSeed;
  ${GLSL_NOISE}
  void main() {
    vec2 p = vec2((vUv.x - 0.5) * 2.0, vUv.y);
    float t = uTime * (1.3 + 0.5 * fract(vSeed * 13.0));
    float n = fbm(vec2(p.x * 1.6 + vSeed * 40.0, p.y * 2.2 - t * 1.8));
    float n2 = fbm(vec2(p.x * 3.5 - vSeed * 10.0, p.y * 3.5 - t * 2.6) + 5.0);
    p.x += (n - 0.5) * 1.1 * p.y;
    float taper = mix(0.85, 0.04, pow(p.y, 0.75));
    float shape = 1.0 - smoothstep(taper * 0.35, taper, abs(p.x));
    float fade = 1.0 - smoothstep(0.5, 1.0, p.y + (n2 - 0.5) * 0.5);
    float heat = shape * fade * (0.55 + 0.9 * n2);
    float a = smoothstep(0.06, 0.4, heat);
    if (a < 0.01) discard;
    vec3 c = mix(vec3(0.55, 0.06, 0.0), vec3(1.0, 0.45, 0.05), smoothstep(0.12, 0.5, heat));
    c = mix(c, vec3(1.0, 0.88, 0.4), smoothstep(0.5, 0.85, heat));
    c = mix(c, vec3(1.0), smoothstep(0.85, 1.1, heat) * 0.6);
    if (uThermal > 0.5) c = vec3(1.0);
    gl_FragColor = vec4(c * 1.25, a);
  }
`;

const PUFF_VERT = /* glsl */`
  attribute vec3 aCenter;
  attribute vec4 aB; // seed, ukuran, tinggi naik, laju (1/detik)
  uniform float uTime;
  uniform vec2 uWind;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vPhase;
  varying float vSeed;
  void main() {
    vUv = uv; vSeed = aB.x;
    float ph = fract(uTime * aB.w + aB.x);
    vPhase = ph;
    vec3 wind = vec3(uWind.x, 0.0, uWind.y);
    vec3 c; float size;
    #if defined(SMOKE)
      float rise = ph * aB.z;
      c = aCenter + vec3(0.0, rise, 0.0) + wind * rise * 0.35
          + vec3(sin(aB.x * 40.0 + uTime * 0.4), 0.0, cos(aB.x * 31.0 + uTime * 0.35)) * ph * aB.y * 0.6;
      size = aB.y * (0.6 + ph * 2.6);
      vAlpha = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.5, 1.0, ph)) * 0.55;
    #elif defined(EMBER)
      float rise = ph * aB.z;
      c = aCenter + vec3(sin(aB.x * 50.0 + uTime * 2.0), 0.0, cos(aB.x * 37.0 + uTime * 1.7)) * ph * 1.5
          + vec3(0.0, rise, 0.0) + wind * rise * 0.5;
      size = aB.y * (1.0 - ph * 0.6);
      vAlpha = (1.0 - ph) * (0.6 + 0.4 * sin(uTime * 30.0 + aB.x * 50.0));
    #else
      c = aCenter;
      size = aB.y * (1.0 + 0.15 * sin(uTime * 9.0 + aB.x * 30.0) + 0.08 * sin(uTime * 17.0));
      vAlpha = 0.55 + 0.25 * sin(uTime * 11.0 + aB.x * 20.0);
    #endif
    vec4 mv = viewMatrix * vec4(c, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
  }
`;

const PUFF_FRAG = /* glsl */`
  uniform float uThermal;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vPhase;
  varying float vSeed;
  ${GLSL_NOISE}
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    #if defined(SMOKE)
      float d = 1.0 - smoothstep(0.2, 1.0, r + (noise(vUv * 4.0 + vSeed * 30.0) - 0.5) * 0.5);
      vec3 col = mix(vec3(0.10, 0.10, 0.11), vec3(0.50, 0.50, 0.52), vPhase);
      gl_FragColor = vec4(col, d * vAlpha * (uThermal > 0.5 ? 0.2 : 1.0));
    #elif defined(EMBER)
      float core = smoothstep(1.0, 0.0, r);
      vec3 col = uThermal > 0.5 ? vec3(1.0) : vec3(1.0, 0.55, 0.15);
      gl_FragColor = vec4(col, core * core * vAlpha);
    #else
      float g = pow(max(1.0 - r, 0.0), 2.0);
      vec3 col = uThermal > 0.5 ? vec3(1.0) : vec3(1.0, 0.45, 0.1);
      gl_FragColor = vec4(col, g * vAlpha);
    #endif
  }
`;

// Pilihan jumlah partikel per sumber api.
export const fireCounts = (r, h, smokeH) => ({
  tongues: Math.max(5, Math.min(16, Math.round(r * 3))),
  puffs: Math.max(8, Math.min(28, Math.round(smokeH / (r * 0.9)))),
  embers: Math.max(6, Math.min(24, Math.round(8 + r * 2))),
});

const rng = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };

export function createFireField() {
  const group = new THREE.Group();
  group.name = 'fire';
  const sources = [];
  const uTime = { value: 0 };
  const uThermal = { value: 0 };
  const uWind = { value: new THREE.Vector2(0, 0) };
  const mats = [];
  let built = false;

  const instanced = (data, strideB) => { // data: Float32Array of [cx,cy,cz, a,b,c,d] per instance
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const buf = new THREE.InstancedInterleavedBuffer(data, 7);
    g.setAttribute('aCenter', new THREE.InterleavedBufferAttribute(buf, 3, 0));
    g.setAttribute(strideB, new THREE.InterleavedBufferAttribute(buf, 4, 3));
    g.instanceCount = data.length / 7;
    return g;
  };
  const mesh = (geo, mat, order) => {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = order; m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };

  // Dua lampu titik untuk menerangi sekitar api yang terdekat dengan drone (jumlah tetap: tanpa kompilasi ulang shader).
  const lights = [0, 1].map(() => {
    const l = new THREE.PointLight(0xff7a2a, 0, 45, 2);
    l.visible = true;
    group.add(l);
    return l;
  });

  return {
    group,
    get count() { return sources.length; },
    get built() { return built; },
    add(o) { sources.push({ r: 3, h: 5, smoke: true, flame: true, ...o }); }, // flame: false = hanya asap
    setWind(dirDeg, speed) { // konvensi sama dengan Flight.wind
      const a = (dirDeg * Math.PI) / 180;
      uWind.value.set(Math.sin(a) * speed, -Math.cos(a) * speed);
    },
    build() {
      if (built || !sources.length) return;
      built = true;
      const flame = [], glow = [], smoke = [], ember = [];
      sources.forEach((s, si) => {
        const R = rng(si * 7919 + 17);
        const smokeH = s.smokeH || Math.max(14, s.h * 5);
        const c = fireCounts(s.r, s.h, smokeH);
        if (s.flame) for (let k = 0; k < c.tongues; k++) {
          const a = R() * Math.PI * 2, d = Math.sqrt(R()) * s.r * 0.7;
          const hh = s.h * (0.6 + R() * 0.5);
          flame.push(s.x + Math.cos(a) * d, s.y, s.z + Math.sin(a) * d, R(), s.r * (0.5 + R() * 0.5) * 1.1, hh, 0.8 + R() * 0.7);
        }
        if (s.flame) glow.push(s.x, s.y + s.h * 0.25, s.z, R(), s.r * 3.2 + s.h * 0.6, 0, 0);
        if (s.smoke) {
          for (let k = 0; k < c.puffs; k++) smoke.push(s.x, s.y + s.h * 0.6, s.z, k / c.puffs + R() * 0.02, s.r * 0.9, smokeH, 3 / smokeH * (0.8 + R() * 0.4));
        }
        if (s.flame) for (let k = 0; k < c.embers; k++) ember.push(s.x, s.y + s.h * 0.3, s.z, R(), 0.12 + R() * 0.1, s.h * 3 + 4, 0.18 + R() * 0.25);
      });
      const base = { transparent: true, depthWrite: false, side: THREE.DoubleSide };
      const add = THREE.AdditiveBlending;
      const make = (vs, fs, defines, blending) => {
        const m = new THREE.ShaderMaterial({
          ...base, blending, defines, vertexShader: vs, fragmentShader: fs,
          uniforms: { uTime, uThermal, uWind },
        });
        mats.push(m);
        return m;
      };
      // Urutan gambar: asap dulu (di belakang), lalu cahaya, api, dan bara di depan.
      if (smoke.length) mesh(instanced(new Float32Array(smoke), 'aB'), make(PUFF_VERT, PUFF_FRAG, { SMOKE: '' }, THREE.NormalBlending), 1);
      if (glow.length) mesh(instanced(new Float32Array(glow), 'aB'), make(PUFF_VERT, PUFF_FRAG, { GLOW: '' }, add), 2);
      if (flame.length) mesh(instanced(new Float32Array(flame), 'aA'), make(FLAME_VERT, FLAME_FRAG, {}, add), 3);
      if (ember.length) mesh(instanced(new Float32Array(ember), 'aB'), make(PUFF_VERT, PUFF_FRAG, { EMBER: '' }, add), 4);
    },
    // Tiap frame. pos = posisi drone [x, y, z] atau {x,y,z}, untuk memilih api yang menerangi.
    update(t, pos) {
      uTime.value = t;
      if (!built) return;
      const px = pos ? (pos.x ?? pos[0]) : 0, py = pos ? (pos.y ?? pos[1]) : 0, pz = pos ? (pos.z ?? pos[2]) : 0;
      let b0 = -1, b1 = -1, d0 = 1e9, d1 = 1e9;
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i]; if (!s.flame) continue;
        const d = (s.x - px) ** 2 + (s.y - py) ** 2 + (s.z - pz) ** 2;
        if (d < d0) { d1 = d0; b1 = b0; d0 = d; b0 = i; } else if (d < d1) { d1 = d; b1 = i; }
      }
      [b0, b1].forEach((bi, k) => {
        const l = lights[k];
        if (bi < 0 || (k ? d1 : d0) > 70 * 70) { l.intensity = 0; return; }
        const s = sources[bi];
        l.position.set(s.x, s.y + s.h * 0.5 + 0.5, s.z);
        l.intensity = (60 + 25 * s.r) * (0.8 + 0.25 * Math.sin(t * 13 + bi) + 0.12 * Math.sin(t * 29 + bi * 3));
        l.color.setHex(uThermal.value ? 0xffffff : 0xff7a2a);
      });
    },
    setThermal(on) { uThermal.value = on ? 1 : 0; },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      mats.forEach((m) => m.dispose());
      group.removeFromParent();
    },
  };
}
