// Missions (pure JS, no Three.js, testable in Node).
// - MISSIONS: catalog shown in the mission menu.
// - MissionRun: follows one run (progress, events, finish).
// - scoreFromEvents: scoring from the event log. The stub gateway uses it; the real gateway
//   computes the official score on the server, so the browser score is provisional.

export const MISSIONS = [
  { id: 'latihan_terbang', tier: 'latihan', title: 'Latihan terbang', par_time_s: 90, available: true,
    desc: 'Lepas landas, melayang stabil 3 detik, lalu mendarat di helipad.' },
  { id: 'patroli', tier: 'latihan', title: 'Patroli checkpoint', par_time_s: 120, available: true,
    desc: 'Lewati 5 cincin checkpoint, lalu mendarat di helipad.' },
  { id: 'rintangan', tier: 'latihan', title: 'Hindari rintangan', par_time_s: 90, available: true,
    desc: 'Terbang ke cincin tujuan di ujung peta tanpa menabrak tiang.' },
  { id: 'm1_sar', tier: 'utama', title: 'Pencarian dan penyelamatan', par_time_s: 300, available: false },
  { id: 'm2_foto', tier: 'utama', title: 'Fotografi dan videografi', par_time_s: 300, available: false },
  { id: 'm3_agri', tier: 'utama', title: 'Penyiraman dan pupuk', par_time_s: 300, available: false },
  { id: 'm4_delivery', tier: 'utama', title: 'Pengiriman barang', par_time_s: 180, available: true,
    desc: 'Ambil paket di titik kuning, antar ke zona hijau, hindari zona terlarang merah.' },
  { id: 'm5_inspeksi', tier: 'utama', title: 'Inspeksi bangunan', par_time_s: 300, available: false },
];
export const getMission = (id) => MISSIONS.find((m) => m.id === id);

const HOME_R = 3;      // m, landing counts as "on the pad" inside this radius
const REACH_ALT = 5;   // m, latihan_terbang
const HOVER_S = 3;     // s, latihan_terbang
const NEAR_ALT = 3;    // m, pickup/drop only when this low
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const inRect = (x, z, r) => x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1];

export function gradeOf(score) {
  return score >= 85 ? 'gold' : score >= 70 ? 'silver' : score >= 50 ? 'bronze' : 'none';
}

// Time component, "like M1" in the Orang 3 spec: full at par time, linear to 0 at 2x par.
const timeFactor = (tMs, parS) => clamp01(2 - tMs / 1000 / parS);
const round1 = (v) => Math.round(v * 10) / 10;

// log: [{ t_ms, type, pose?, kind? }], fin: { t_ms, battery, reason, progress? }
export function scoreFromEvents(missionId, config, log, fin) {
  const def = getMission(missionId);
  const completed = fin.reason === 'completed';
  const collisions = log.filter((e) => e.type === 'collision').length;
  const comp = [];
  const add = (name, max, factor, note) => comp.push({ name, points: round1(max * clamp01(factor)), max, note });

  if (missionId === 'm4_delivery') {
    const m = config.mission;
    const drop = log.find((e) => e.type === 'drop');
    let dist = Infinity;
    if (drop) dist = Math.hypot(drop.pose.pos[0] - m.drop.x, drop.pose.pos[2] - m.drop.z);
    // Time spent inside no-fly zones (open interval is closed at finish).
    let noFlyMs = 0, since = -1;
    for (const e of log) {
      if (e.kind !== 'nofly') continue;
      if (e.type === 'zone_enter') since = e.t_ms;
      else if (e.type === 'zone_exit' && since >= 0) { noFlyMs += e.t_ms - since; since = -1; }
    }
    if (since >= 0) noFlyMs += fin.t_ms - since;
    // "Gugur" rule: without a delivery, the other components are halved.
    const half = drop ? 1 : 0.5;
    add('Ketepatan', 30, drop ? 1 - (dist - 1) / 7 : 0, drop ? `jatuh ${dist.toFixed(1)} m dari pusat zona` : 'paket belum dijatuhkan');
    add('Kondisi barang', 20, (1 - collisions / 3) * half, `${collisions} tabrakan`);
    add('Waktu', 20, drop ? timeFactor(fin.t_ms, def.par_time_s) : 0, `acuan ${def.par_time_s} s`);
    add('Baterai tersisa', 15, Math.min(1, fin.battery / 60) * half, `${Math.round(fin.battery)}% tersisa`);
    add('Kepatuhan zona', 15, (1 - noFlyMs / 5000) * half, `${(noFlyMs / 1000).toFixed(1)} s di zona terlarang`);
  } else {
    // Practice missions: unofficial, scored locally.
    add('Tujuan', 60, completed ? 1 : (fin.progress || 0) * 0.6, completed ? 'selesai' : 'belum selesai');
    add('Waktu', 20, completed ? timeFactor(fin.t_ms, def.par_time_s) : 0, `acuan ${def.par_time_s} s`);
    add('Keselamatan', 20, 1 - collisions / 4, `${collisions} tabrakan`);
  }
  const score = Math.round(comp.reduce((s, c) => s + c.points, 0));
  return { score, grade: gradeOf(score), breakdown: comp };
}

// One run of one mission. step() is called once per physics step and does not allocate.
export class MissionRun {
  // onEvent(type, extra) lets main forward events to the gateway as they happen.
  constructor(missionId, config, onEvent = () => {}) {
    this.def = getMission(missionId);
    this.config = config;
    this.onEvent = onEvent;
    this.t = 0;                 // s since first takeoff
    this.started = false;
    this.done = false;
    this.reason = null;         // completed | timeout | battery
    this.progress = 0;          // 0..1
    this.log = [];
    this.limitS = this.def.par_time_s * 2;
    this.phase = 0;
    this.hover = 0;
    this.carrying = false;
    this.delivered = false;
    this.inNoFly = false;
    this.seenCollisions = 0;
    this.seenRings = 0;
    this.startDist = 1;
    this.text = '';
  }

  get payloadKg() { return this.carrying ? this.config.mission.payload_kg : 0; }
  get tMs() { return Math.round(this.t * 1000); }

  record(type, sim, extra) {
    const e = { t_ms: this.tMs, type, pose: { pos: [sim.pos[0], sim.pos[1], sim.pos[2]], yaw: sim.yaw }, ...extra };
    this.log.push(e);
    this.onEvent(type, e);
  }

  step(dt, sim, batteryLevel, ringsPassed, ringsTotal) {
    if (this.done) return;
    if (!this.started) {
      if (sim.mode === 'landed') return;
      this.started = true;
      this.record('takeoff', sim);
    }
    this.t += dt;

    if (sim.collisionCount > this.seenCollisions) {
      this.seenCollisions = sim.collisionCount;
      this.record('collision', sim);
    }
    const id = this.def.id;
    const homeDist = Math.hypot(sim.pos[0], sim.pos[2]);
    const landedHome = sim.mode === 'landed' && homeDist < HOME_R;

    if (id === 'latihan_terbang') {
      if (this.phase === 0 && sim.pos[1] >= REACH_ALT) this.phase = 1;
      if (this.phase === 1) {
        const still = Math.hypot(sim.vel[0], sim.vel[1], sim.vel[2]) < 0.6 && sim.pos[1] >= REACH_ALT - 0.5;
        this.hover = still ? this.hover + dt : 0;
        if (this.hover >= HOVER_S) this.phase = 2;
      }
      this.progress = (this.phase + (this.phase === 1 ? this.hover / HOVER_S : 0)) / 3;
      this.text = this.phase === 0 ? `Naik ke ${REACH_ALT} m (takeoff: tahan X / A)`
        : this.phase === 1 ? `Melayang stabil ${this.hover.toFixed(1)} / ${HOVER_S} s` : 'Mendarat di helipad (H)';
      if (this.phase === 2 && landedHome) this._finish('completed');
    } else if (id === 'patroli') {
      while (this.seenRings < ringsPassed) { this.seenRings++; this.record('zone_enter', sim, { kind: 'checkpoint' }); }
      const all = ringsPassed >= ringsTotal;
      this.progress = (ringsPassed + (all && landedHome ? 1 : 0)) / (ringsTotal + 1);
      this.text = all ? 'Semua checkpoint lewat: mendarat di H' : `Checkpoint ${ringsPassed} dari ${ringsTotal}`;
      if (all && landedHome) this._finish('completed');
    } else if (id === 'rintangan') {
      const g = this.config.rings[0];
      if (this.startDist === 1) this.startDist = Math.hypot(g.x, g.z);
      const d = Math.hypot(sim.pos[0] - g.x, sim.pos[2] - g.z);
      this.progress = ringsPassed > 0 ? 1 : clamp01(1 - d / this.startDist);
      this.text = `Ke cincin tujuan: ${Math.round(d)} m (${this.seenCollisions} tabrakan)`;
      if (ringsPassed > 0) this._finish('completed');
    } else if (id === 'm4_delivery') {
      const m = this.config.mission;
      let z = false;
      for (let i = 0; i < m.noFly.length; i++) if (inRect(sim.pos[0], sim.pos[2], m.noFly[i])) z = true;
      if (z !== this.inNoFly) { this.inNoFly = z; this.record(z ? 'zone_enter' : 'zone_exit', sim, { kind: 'nofly' }); }
      const t = this.carrying ? m.drop : m.pickup;
      const d = Math.round(Math.hypot(sim.pos[0] - t.x, sim.pos[2] - t.z));
      this.progress = this.delivered ? 1 : this.carrying ? 0.5 : 0;
      this.text = this.carrying ? `Antar paket ke zona hijau: ${d} m (tekan P rendah di zona)`
        : `Ambil paket di titik kuning: ${d} m (tekan P rendah di titik)`;
      if (z) this.text += ' | ZONA TERLARANG';
    }

    if (this.done) return;
    if (batteryLevel <= 0) this._finish('battery');
    else if (this.t > this.limitS) this._finish('timeout');
  }

  // P key. Returns a message for the toast, or null when this mission has no pickup.
  pickupDrop(sim) {
    if (this.def.id !== 'm4_delivery' || this.done) return null;
    const m = this.config.mission;
    if (sim.mode !== 'flying' || sim.pos[1] > NEAR_ALT) return 'Terbang rendah (di bawah 3 m) dulu';
    if (!this.carrying) {
      if (Math.hypot(sim.pos[0] - m.pickup.x, sim.pos[2] - m.pickup.z) > m.pickup.r + 1.5) return 'Terlalu jauh dari titik ambil';
      this.carrying = true;
      this.record('pickup', sim);
      return 'Paket diambil';
    }
    if (Math.hypot(sim.pos[0] - m.drop.x, sim.pos[2] - m.drop.z) > m.drop.r + 1.5) return 'Terlalu jauh dari zona antar';
    this.carrying = false;
    this.delivered = true;
    this.record('drop', sim);
    this._finish('completed');
    return 'Paket dilepas';
  }

  _finish(reason) {
    this.done = true;
    this.reason = reason;
    this.finish = { t_ms: this.tMs, battery: 0, reason, progress: this.progress };
  }

  // Provisional score from the local log (the real gateway recomputes it on the server).
  result(batteryLevel) {
    this.finish.battery = batteryLevel;
    return scoreFromEvents(this.def.id, this.config, this.log, this.finish);
  }
}
