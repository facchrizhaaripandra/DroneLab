// Missions (pure JS, no Three.js, testable in Node).
// - MISSIONS: catalog shown in the mission menu.
// - MissionRun: follows one run (progress, events, finish).
// - scoreFromEvents: scoring from the event log. The stub gateway uses it; the real gateway
//   computes the official score on the server, so the browser score is provisional.

import { MISSIONS, getMission, gradeOf } from './catalog.js';
import { scoreFromEvents } from './scoring.js';
export { MISSIONS, getMission, gradeOf, scoreFromEvents };

import { STEP } from './config.js';
import { visibleObjects } from './vision.js';
import { makeAgri, sprayStep, agriSummary, refill } from './agri.js';
import { markedVictim, markedDefects, inspectionState } from './scoring.js';

const FIRE_H = 15;      // m, heat reaches this high above a fire zone
const BURN_RATE = 0.12; // damage per second inside a fire zone (about 8 s to wreck the camera)
const PHOTO_GAP = 0.4;  // s between two photos
const HOME_R = 3;      // m, landing counts as "on the pad" inside this radius
const REACH_ALT = 5;   // m, latihan_terbang
const HOVER_S = 3;     // s, latihan_terbang
const NEAR_ALT = 3;    // m, pickup/drop only when this low
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const inRect = (x, z, r) => x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1];

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
    this.reason = null;         // completed | timeout | battery | crashed | drowned
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
    // Camera and mission state (M1, M2, M3, M5). `gimbal` is kept up to date by main.js.
    this.gimbal = -10;
    this.gimbalRoll = 0; // diisi main.js
    this.zoom = 1;      // kamera drone, diisi main.js
    this.onNotice = () => {};   // main shows these as toasts (tank empty, refilled)
    this.recording = false;
    this.spraying = false;
    this.lastPhotoT = -9;
    this.photos = 0; this.clips = 0;
    this.inFire = false; this.burnAcc = 0;
    this.found = new Set();
    this.agri = this.def.id === 'm3_agri' ? makeAgri(config.mission) : null;
    this.sum = null;            // M3 live summary
    this.insp = null;           // M5 live state
    this.pose = { pos: [0, 0, 0], yaw: 0, pitch: 0 };
    this.shotsPhoto = this.def.id === 'm2_foto' ? config.mission.shots.filter((x) => x.type === 'photo') : null; // cached: step() must not allocate
    this.shotsVideo = this.def.id === 'm2_foto' ? config.mission.shots.filter((x) => x.type === 'video') : null;
    this.foundDefects = 0;
    this._n = 0;
  }

  // The goal text is rebuilt 10 times a second, not every physics step (strings are allocations too).
  _textDue() { this._n = (this._n + 1) % 6; return this._n === 0; }

  get payloadKg() { return this.carrying ? this.config.mission.payload_kg : 0; }
  get tMs() { return Math.round(this.t * 1000); }

  record(type, sim, extra) {
    const e = { t_ms: this.tMs, type, pose: { pos: [sim.pos[0], sim.pos[1], sim.pos[2]], yaw: sim.yaw, pitch: this.gimbal, zoom: this.zoom, roll: (sim.roll || 0) + this.gimbalRoll }, ...extra };
    this.log.push(e);
    this.onEvent(type, e);
    return e;
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
    else if (id === 'm1_sar') this._stepSar(dt, sim, landedHome);
    else if (id === 'm2_foto') this._stepFoto(landedHome);
    else if (id === 'm3_agri') this._stepAgri(sim, landedHome, homeDist);
    else if (id === 'm5_inspeksi') this._stepInspeksi(landedHome);

    if (this.done) return;
    if (sim.mode === 'crashed') this._finish(sim.drowned ? 'drowned' : 'crashed');
    else if (batteryLevel <= 0) this._finish('battery');
    else if (this.t > this.limitS) this._finish('timeout');
  }


  // ---- M1: fire zones hurt the drone, victims are found with mark() ----
  _stepSar(dt, sim, landedHome) {
    const m = this.config.mission;
    let f = false;
    for (let i = 0; i < m.fires.length; i++) {
      const z = m.fires[i];
      if (sim.pos[1] < (z.y || 0) + FIRE_H && Math.hypot(sim.pos[0] - z.x, sim.pos[2] - z.z) < z.r) f = true; // z.y: alas api (peta realistis)
    }
    if (f !== this.inFire) { this.inFire = f; this.record(f ? 'zone_enter' : 'zone_exit', sim, { kind: 'fire' }); if (f) this.onNotice('Zona api! Drone terbakar, naik atau menjauh'); }
    if (f) { // damage is applied 4 times a second, not every step
      this.burnAcc += dt;
      if (this.burnAcc >= 0.25 && sim.damage && !this.config.realScene) { // peta realistis: panas dari api scene sudah merusak (main.js)
        const ch = sim.damage.burn(BURN_RATE * this.burnAcc);
        this.burnAcc = 0;
        if (ch.length && sim.onDamage) sim.onDamage(ch);
      }
    }
    const n = m.victims.length;
    this.progress = this.found.size / n;
    if (this._textDue()) this.text = `Korban ditemukan ${this.found.size} dari ${n} (tandai dengan M, mode panas T)` + (f ? ' | ZONA API' : '');
    if (this.found.size === n && landedHome) this._finish('completed');
  }

  // ---- M2: shot list ----
  _stepFoto(landedHome) {
    const total = this.shotsPhoto.length + this.shotsVideo.length;
    const done = Math.min(this.photos, this.shotsPhoto.length) + Math.min(this.clips, this.shotsVideo.length);
    this.progress = done / total;
    if (this._textDue()) {
      const next = this.shotsPhoto[this.photos] || this.shotsVideo[this.clips];
      this.text = `Bidikan ${done} dari ${total}` + (this.recording ? ' | REC' : '') + (next ? ` · berikutnya: ${next.label}` : ' · daftar lengkap: mendarat di H');
    }
    if (done === total && !this.recording && landedHome) this._finish('completed');
  }

  // ---- M3: tank refill at H, live dose numbers ----
  _stepAgri(sim, landedHome, homeDist) {
    const a = this.agri;
    if (sim.mode === 'landed' && homeDist < HOME_R && a.tank < a.m.dose.capacity - 0.5) {
      refill(a);
      this.record('refill', sim);
      this.onNotice('Tangki terisi ulang di H');
    }
    if (this.sum) this.progress = this.sum.coverage;
    if (this._textDue()) {
      const cov = this.sum ? Math.round(this.sum.coverage * 100) : 0, w = this.config.wind;
      this.text = `Cakupan ${cov}% · tangki ${Math.round(a.tank)} / ${a.m.dose.capacity}` + (w ? ` · angin ${w.speed} m/s` : '') + (this.spraying ? ' | MENYEMPROT' : '') + (a.tank <= 0 ? ' | TANGKI KOSONG: mendarat di H' : '');
    }
    if (this.sum && this.sum.coverage >= 0.9 && landedHome) this._finish('completed');
  }

  // ---- M5: panels and defects ----
  _stepInspeksi(landedHome) {
    const m = this.config.mission;
    if (!this.insp) this._refreshInsp();
    const st = this.insp, found = this.foundDefects;
    this.progress = (st.panels.size / m.panels.length + found / m.defects.length) / 2;
    if (this._textDue()) this.text = `Panel terfoto ${st.panels.size} dari ${m.panels.length} · cacat difoto dan ditandai ${found} dari ${m.defects.length} (jarak aman ${m.safe.min}-${m.safe.max} m)`;
    if (st.panels.size === m.panels.length && found === m.defects.length && landedHome) this._finish('completed');
  }

  // Recomputed only when a photo or a mark was made.
  _refreshInsp() {
    const st = (this.insp = inspectionState(this.config, this.log));
    this.foundDefects = this.config.mission.defects.filter((d) => st.photographed.has(d.id) && st.marked.has(d.id)).length;
  }

  // 10 Hz telemetry frame (same object that goes to the gateway). Kept for the provisional local score and the live M3 numbers.
  sample(frame) {
    if (this.done || !this.started) return;
    this.log.push({ ...frame, type: 'sample' });
    if (this.agri) {
      sprayStep(this.agri, frame, this.config.wind);
      this.sum = agriSummary(this.agri);
      if (this.spraying && this.agri.tank <= 0) { this.spraying = false; this.onNotice('Tangki kosong: mendarat di H untuk isi ulang'); }
    }
  }

  _canShoot(sim) {
    if (this.done) return 'Misi sudah selesai';
    if (sim.mode !== 'flying') return 'Terbang dulu (kamera hanya aktif saat di udara)';
    if (sim.damage && sim.damage.camera <= 0.05) return 'Kamera pecah';
    return null;
  }
  _cam(sim) {
    const p = this.pose;
    p.pos[0] = sim.pos[0]; p.pos[1] = sim.pos[1]; p.pos[2] = sim.pos[2]; p.yaw = sim.yaw; p.pitch = this.gimbal; p.zoom = this.zoom;
    return p;
  }

  // F key. Returns a message for the toast.
  photo(sim, thermal) {
    const bad = this._canShoot(sim);
    if (bad) return `Foto: ${bad}`;
    if (this.t - this.lastPhotoT < PHOTO_GAP) return null;
    this.lastPhotoT = this.t;
    const dyaw = ((sim.yaw - sim.prevYaw + 540) % 360) - 180;
    this.photos++;
    this.record('photo', sim, {
      visible: visibleObjects(this._cam(sim), this.config, { thermal }),
      speed: Math.round(Math.hypot(sim.vel[0], sim.vel[1], sim.vel[2]) * 100) / 100,
      yaw_rate: Math.round((dyaw / STEP) * 10) / 10,
    });
    if (this.def.id === 'm5_inspeksi') this._refreshInsp();
    return `Foto #${this.photos}`;
  }

  // R key. Toggles recording. Returns a message.
  toggleRecord(sim) {
    if (this.recording) {
      this.recording = false; this.clips++;
      this.record('record_stop', sim);
      return `Rekaman ${this.clips} disimpan`;
    }
    const bad = this._canShoot(sim);
    if (bad) return `Rekam: ${bad}`;
    this.recording = true;
    this.record('record_start', sim);
    return 'Merekam... (tekan R untuk berhenti)';
  }

  // M key (M1 and M5). The answer tells the pilot whether the mark counted.
  mark(sim, thermal) {
    const id = this.def.id;
    if (id !== 'm1_sar' && id !== 'm5_inspeksi') return 'Tandai hanya dipakai di misi pencarian dan inspeksi';
    const bad = this._canShoot(sim);
    if (bad) return `Tandai: ${bad}`;
    const e = this.record('mark', sim, { visible: visibleObjects(this._cam(sim), this.config, { thermal }) });
    if (id === 'm1_sar') {
      const v = markedVictim(this.config, e);
      if (!v) return 'Tanda salah: tidak ada korban di bingkai dalam radius 5 m';
      this.found.add(v.id);
      return `Korban #${v.id} ditandai (${this.found.size} dari ${this.config.mission.victims.length})`;
    }
    this._refreshInsp();
    const ids = markedDefects(e);
    return ids.length ? `Cacat #${ids.join(', #')} ditandai` : 'Tanda salah: tidak ada cacat di bingkai dalam 10 m';
  }

  // G key (hold). on = true / false.
  setSpray(on, sim) {
    if (this.def.id !== 'm3_agri' || this.done) return 'Semprot hanya dipakai di misi penyiraman';
    if (!on) { if (this.spraying) { this.spraying = false; this.record('spray', sim, { on: false }); } return null; }
    if (sim.mode !== 'flying') return 'Semprot: terbang dulu';
    if (this.agri.tank <= 0) return 'Tangki kosong: mendarat di H untuk isi ulang';
    if (!this.spraying) { this.spraying = true; this.record('spray', sim, { on: true }); }
    return null;
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

  // Pause menu "Akhiri dan lihat skor": the pilot ends the run on purpose (counts as completed).
  endNow() { if (!this.done) this._finish('completed'); }

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
