// Langit, awan, dan latar pemandangan di sekeliling peta.
//   createSky(radius)  : kubah langit (gradasi biru, matahari, awan bergerak terbawa angin). Ikut posisi kamera.
//   createBackdrop(o)  : cincin gambar pemandangan (gunung, bukit, pepohonan atau kota) di luar batas peta,
//                        plus tanah jauh di bawahnya. Hanya gambar: drone berhenti di batas peta sebelum sampai.
//   randomWind(rand)   : angin acak untuk tiap kali misi dimulai.
import * as THREE from 'three';

export const HAZE = 0xc9d8e4; // warna kabut di cakrawala: sama untuk fog, kaki langit, dan dasar gambar latar

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w * 0.9999; // selalu paling belakang
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uSun;
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uCover;
  uniform float uSeed;
  varying vec3 vDir;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 17.0; a *= 0.5; } return v; }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 zenith = vec3(0.17, 0.40, 0.72), mid = vec3(0.45, 0.65, 0.86), haze = vec3(0.79, 0.85, 0.89), low = vec3(0.70, 0.75, 0.74);
    vec3 col = y > 0.0 ? mix(haze, mid, smoothstep(0.0, 0.18, y)) : mix(haze, low, smoothstep(0.0, -0.08, y));
    col = mix(col, zenith, smoothstep(0.25, 0.95, y));
    float sd = max(dot(d, normalize(uSun)), 0.0);
    col += vec3(1.0, 0.9, 0.7) * (pow(sd, 8.0) * 0.18 + pow(sd, 64.0) * 0.35);
    col = mix(col, vec3(1.0, 0.98, 0.92), smoothstep(0.9993, 0.9997, sd));
    if (y > 0.0) {
      vec2 p = d.xz / (y + 0.12) * 1.6 + uWind * uTime * 0.0025 + uSeed * 31.0;
      float n = fbm(p);
      float n2 = fbm(p * 2.3 + 4.0);
      float c = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, n * 0.85 + n2 * 0.3);
      float shade = mix(0.72, 1.0, smoothstep(0.35, 0.8, fbm(p + normalize(uSun).xz * 0.08)));
      vec3 cc = vec3(1.0, 0.99, 0.97) * shade + vec3(1.0, 0.85, 0.6) * pow(sd, 6.0) * 0.25;
      c *= smoothstep(0.0, 0.12, y);
      col = mix(col, mix(cc, haze, 1.0 - smoothstep(0.02, 0.3, y)), c * 0.92);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(radius) {
  const uniforms = {
    uSun: { value: new THREE.Vector3(0.4, 0.7, -0.5) },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(1, 0) },
    uCover: { value: 0.4 },
    uSeed: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return {
    mesh,
    setSun(x, y, z) { uniforms.uSun.value.set(x, y, z); },
    setWind(dirDeg, speed) { const a = (dirDeg * Math.PI) / 180; uniforms.uWind.value.set(Math.sin(a) * speed, -Math.cos(a) * speed); },
    setClouds(cover, seed) { uniforms.uCover.value = cover; uniforms.uSeed.value = seed; },
    update(t, cam) { uniforms.uTime.value = t; if (cam) mesh.position.copy(cam); },
    dispose() { mesh.geometry.dispose(); mat.dispose(); },
  };
}

// ---- Latar pemandangan (kanvas, dibuat sekali per dunia) ----

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const lerpC = (a, b, t) => {
  const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255, br = b >> 16, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
};
const rngOf = (seed) => { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };

// Profil periodik (menyambung di ujung kanvas): jumlah sinus dengan frekuensi bulat.
function profile(rand, octaves, base) {
  const waves = [];
  for (let i = 0; i < octaves; i++) waves.push({ f: Math.round(base * 2 ** i * (0.8 + rand() * 0.5)) || 1, a: 1 / 1.9 ** i, p: rand() * Math.PI * 2 });
  const sum = waves.reduce((s, w) => s + w.a, 0);
  return (u) => waves.reduce((s, w) => s + w.a * Math.sin(u * Math.PI * 2 * w.f + w.p), 0) / sum; // -1..1
}

// theme: 'nature' (gunung, bukit, hutan) atau 'city' (gunung jauh, gedung, pepohonan).
export function paintBackdrop(theme, seed, W = 4096, H = 512) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rand = rngOf(seed * 9973 + 7);
  const ridge = (top, amp, col, prof, sharp = 1) => {
    g.fillStyle = hex(col);
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) {
      let v = prof(x / W);
      if (sharp > 1) v = Math.sign(v) * Math.abs(v) ** (1 / sharp);
      g.lineTo(x, H * (top - amp * (v * 0.5 + 0.5)));
    }
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  // Gunung jauh (sangat berkabut), gunung tengah, bukit.
  ridge(0.62, 0.42, lerpC(0x6f86a0, HAZE, 0.62), profile(rand, 5, 2), 1.3);
  ridge(0.72, 0.32, lerpC(0x5a7290, HAZE, 0.45), profile(rand, 5, 3), 1.2);
  ridge(0.82, 0.2, lerpC(0x4d6a58, HAZE, 0.35), profile(rand, 4, 5));
  if (theme === 'city') {
    // Siluet gedung kota di kejauhan.
    for (let x = 0; x < W;) {
      const w = 18 + rand() * 46, h = H * (0.04 + rand() ** 2 * 0.22);
      const col = lerpC(0x55606e, HAZE, 0.3 + rand() * 0.2);
      g.fillStyle = hex(col);
      g.fillRect(x, H * 0.9 - h, w, h + H * 0.1);
      g.fillStyle = hex(lerpC(col, 0xffffff, 0.12));
      for (let wy = H * 0.9 - h + 6; wy < H * 0.88; wy += 9) for (let wx = x + 4; wx < x + w - 4; wx += 7) if (rand() < 0.35) g.fillRect(wx, wy, 3, 4);
      x += w + rand() * 30;
    }
  }
  // Barisan pohon dekat: tajuk bulat bergerigi.
  const treeCol = lerpC(0x2f4a30, HAZE, 0.22);
  g.fillStyle = hex(treeCol);
  const tp = profile(rand, 3, 9);
  for (let x = -20; x < W + 20; x += 7 + rand() * 9) {
    const h = H * (0.05 + 0.04 * (tp(((x % W) + W) % W / W) * 0.5 + 0.5) + rand() * 0.035);
    const r = 6 + rand() * 9;
    g.beginPath(); g.ellipse(x, H * 0.93 - h, r, h, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillRect(0, H * 0.92, W, H * 0.08);
  // Kabut di kaki: menyatu dengan tanah jauh yang tertutup fog.
  const fg = g.createLinearGradient(0, H * 0.78, 0, H);
  fg.addColorStop(0, 'rgba(201,216,228,0)'); fg.addColorStop(0.7, 'rgba(201,216,228,0.75)'); fg.addColorStop(1, hex(HAZE));
  g.fillStyle = fg; g.fillRect(0, H * 0.78, W, H * 0.22);
  return c;
}

// o: { radius, base (ketinggian tanah terendah), theme, seed, groundColor }
export function createBackdrop(o) {
  const R = o.radius, Hc = R * 0.3;
  const group = new THREE.Group();
  group.name = 'backdrop';
  const tex = new THREE.CanvasTexture(paintBackdrop(o.theme || 'nature', o.seed || 1));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = 2;
  tex.anisotropy = 4;
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, Hc, 160, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  ring.position.y = o.base + Hc / 2 - Hc * 0.08;
  ring.renderOrder = -5;
  ring.frustumCulled = false;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(R + 2, 96), new THREE.MeshLambertMaterial({ color: o.groundColor || 0x7a8c66 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = o.base - 0.3;
  ground.receiveShadow = false;
  group.add(ground, ring);
  return { group, radius: R };
}

// Angin acak untuk tiap mulai/ulang. Kebanyakan pelan sampai sedang (0,5-6 m/s), kadang kencang (sampai 12 m/s,
// di atas batas tahan angin drone 10,7 m/s sehingga drone terseret). dir = arah angin bertiup (konvensi yaw).
export function randomWind(rand = Math.random) {
  const r = rand();
  const speed = r < 0.06 ? 9 + rand() * 3 : 0.5 + 6.5 * rand() ** 1.5;
  return { speed: Math.round(speed * 10) / 10, dir: Math.floor(rand() * 360), gust: Math.round((0.15 + rand() * 0.3) * 100) / 100, seed: rand() * 100 };
}

const ARAH = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];
// Teks angin untuk pemain: angin "dari" arah yang berlawanan dengan arah tiupnya.
export function windText(w) {
  if (!w || w.speed < 0.3) return 'Angin tenang';
  const from = ARAH[Math.round((((w.dir + 180) % 360) / 45)) % 8];
  const kind = w.speed < 3 ? 'pelan' : w.speed < 6 ? 'sedang' : w.speed < 9 ? 'kencang' : 'sangat kencang';
  return `Angin ${kind} ${w.speed.toFixed(1)} m/s dari ${from}`;
}
