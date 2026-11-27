// Scoring from the event log (pure). The stub gateway, the mock server and the browser use this code;
// the real gateway (Orang 3) has its own copy of the formulas. Same log in, same score out (deterministic).
// Spec: DRONELAB_SPEC_ORANG3 B5. Weights come from the mission catalog (catalog.js) or config.weights.
// Log entries: { t_ms, type, pose: { pos, yaw, pitch, roll }, visible?, ... }, plus 'sample' frames (10 Hz telemetry).
import { getMission, gradeOf } from './catalog.js';
import { project, inFrame, bearing, angDiff } from './camera-model.js';
import { makeAgri, refill, sprayStep, agriSummary } from './agri.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const round1 = (v) => Math.round(v * 10) / 10;
const timeFactor = (tMs, parS) => clamp01(2 - tMs / 1000 / parS); // full at par time, 0 at 2x par
const HOME_R = 3;
const inRect = (x, z, r) => x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1];

// Time spent inside zones of one kind ('nofly', 'fire'): enter/exit pairs, an open interval ends at finish.
function zoneMs(log, kind, finMs) {
  let ms = 0, since = -1;
  for (const e of log) {
    if (e.kind !== kind) continue;
    if (e.type === 'zone_enter') since = e.t_ms;
    else if (e.type === 'zone_exit' && since >= 0) { ms += e.t_ms - since; since = -1; }
  }
  return since >= 0 ? ms + finMs - since : ms;
}

// ---------------------------------------------------------------- M1
// A mark finds a victim when the victim is in the camera frame (visible) and the drone is within the mark radius (5 m).
export function markedVictim(config, e) {
  const m = config.mission, seen = (e.visible || []).filter((v) => v.label === 'person').map((v) => v.id);
  return m.victims.find((v) => seen.includes(v.id) && Math.hypot(v.x - e.pose.pos[0], v.z - e.pose.pos[2]) <= (m.markRadius || 5)) || null;
}

function scoreM1(ctx) {
  const { config, log, fin, add } = ctx;
  const m = config.mission;
  const found = new Set();
  let marks = 0, wrong = 0;
  for (const e of log) {
    if (e.type !== 'mark') continue;
    marks++;
    const near = markedVictim(config, e);
    if (near) found.add(near.id); else wrong++;
  }
  const ratio = m.victims.length ? found.size / m.victims.length : 0;
  // Coverage: area cells (10 m) the drone flew over while airborne.
  const cell = 10, a = m.area;
  const nx = Math.ceil((a.max[0] - a.min[0]) / cell), nz = Math.ceil((a.max[1] - a.min[1]) / cell);
  const seen = new Set();
  for (const s of log) {
    if (s.type !== 'sample' || s.pos[1] < 0.5 || !inRect(s.pos[0], s.pos[2], a)) continue;
    seen.add(Math.floor((s.pos[0] - a.min[0]) / cell) * nz + Math.floor((s.pos[2] - a.min[1]) / cell));
  }
  const collisions = log.filter((e) => e.type === 'collision').length;
  const fireS = zoneMs(log, 'fire', fin.t_ms) / 1000;
  add('found', 'Korban ditemukan', ratio, `${found.size} dari ${m.victims.length} korban`);
  // Time only counts for what was found: hovering and landing at once must not earn free points.
  add('time', 'Waktu', timeFactor(fin.t_ms, ctx.def.par_time_s) * ratio, `acuan ${ctx.def.par_time_s} s`);
  add('coverage', 'Cakupan area', seen.size / (nx * nz), `${seen.size} dari ${nx * nz} sel dilewati`);
  add('safety', 'Keselamatan', 1 - (collisions * 0.2 + (fireS / 10) * 0.2), `${collisions} tabrakan, ${fireS.toFixed(1)} s di zona api`);
  add('precision', 'Presisi', marks ? 1 - wrong / marks : 0, `${wrong} dari ${marks} tanda salah`);
  return { found: found.size, total: m.victims.length, marks, wrong };
}

// ---------------------------------------------------------------- M2
const PHOTO_KEYS = [['subject', 'Subjek terlihat'], ['thirds', 'Komposisi sepertiga'], ['horizon', 'Horizon rata'],
  ['sharp', 'Ketajaman'], ['light', 'Pencahayaan'], ['variation', 'Variasi']];
const VIDEO_KEYS = [['vsubject', 'Subjek dalam bingkai'], ['smooth', 'Kehalusan'], ['cinematic', 'Gerakan sinematik'],
  ['duration', 'Durasi sesuai'], ['vsafety', 'Keselamatan video']];
const THIRDS = [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]];
const JERK_REF = 8; // m/s^3, a jerk this large means a jerky clip

const landmarkBox = (l) => ({ x: l.x, y: l.y, z: l.z, hx: l.hx, hy: l.hy });

// Photo components, each 0..1. prev = the previous photo event (any shot) for the variation component.
export function photoFactors(photo, shot, config, prev) {
  const m = config.mission, lm = m.landmarks.find((l) => l.id === shot.subject);
  const v = (photo.visible || []).find((o) => o.label === 'landmark' && o.id === shot.subject);
  const [lo, hi] = shot.areaRange || [0.10, 0.60];
  const f = {};
  f.subject = !v ? 0 : v.area < lo ? v.area / lo : v.area > hi ? clamp01((1 - v.area) / (1 - hi)) : 1;
  if (v) {
    const cx = v.box[0] + v.box[2] / 2, cy = v.box[1] + v.box[3] / 2;
    f.thirds = clamp01(1 - Math.min(...THIRDS.map(([tx, ty]) => Math.hypot(cx - tx, cy - ty))) / 0.4714);
  } else f.thirds = 0;
  const roll = Math.abs(photo.pose.roll || 0);
  f.horizon = roll <= 3 ? 1 : clamp01(1 - (roll - 3) / 12);
  const sp = photo.speed || 0, yr = Math.abs(photo.yaw_rate || 0);
  f.sharp = Math.min(sp <= 0.5 ? 1 : clamp01(1 - (sp - 0.5) / 2.5), yr <= 10 ? 1 : clamp01(1 - (yr - 10) / 50));
  // Light: the sun azimuth is where the light comes from. Looking toward it (backlight) is worst.
  const dot = Math.cos(angDiff(photo.pose.yaw, m.sun.az) * Math.PI / 180);
  f.light = dot <= 0.3 ? 1 : clamp01(1 - (dot - 0.3) / 0.7);
  // Variation: the view direction around the subject differs by 30 degrees or more from the previous photo.
  const b = bearing(lm.x, lm.z, photo.pose.pos[0], photo.pose.pos[2]);
  f.variation = prev ? clamp01(Math.abs(angDiff(b, bearing(lm.x, lm.z, prev.pose.pos[0], prev.pose.pos[2]))) / 30) : 1;
  return f;
}

// Video clip components for one shot, each 0..1. samples: the 'sample' frames inside the clip.
export function videoFactors(clip, shot, config, collisionsInClip) {
  const lm = config.mission.landmarks.find((l) => l.id === shot.subject), S = clip.samples, f = {};
  let inView = 0;
  for (const s of S) if (inFrame(project({ pos: s.pos, yaw: s.yaw, pitch: s.gimbal ?? -10 }, landmarkBox(lm)))) inView++;
  f.vsubject = S.length ? inView / S.length : 0;
  // Jerk = change of acceleration, from the velocity samples.
  let jerk = 0, n = 0, pa = null;
  for (let i = 2; i < S.length; i++) {
    const dt = (S[i].t_ms - S[i - 1].t_ms) / 1000;
    if (dt <= 0) continue;
    const a = [(S[i].vel[0] - S[i - 1].vel[0]) / dt, (S[i].vel[1] - S[i - 1].vel[1]) / dt, (S[i].vel[2] - S[i - 1].vel[2]) / dt];
    if (pa) { jerk += Math.hypot(a[0] - pa[0], a[1] - pa[1], a[2] - pa[2]) / dt; n++; }
    pa = a;
  }
  f.smooth = n ? clamp01(1 - jerk / n / JERK_REF) : 0;
  // Cinematic move: orbit (bearing around the subject changes by 90 degrees) or reveal (climb 10 m while moving away).
  let swept = 0;
  for (let i = 1; i < S.length; i++) {
    swept += Math.abs(angDiff(bearing(lm.x, lm.z, S[i].pos[0], S[i].pos[2]), bearing(lm.x, lm.z, S[i - 1].pos[0], S[i - 1].pos[2])));
  }
  const orbit = clamp01(swept / 90);
  let reveal = 0;
  if (S.length > 1) {
    const a = S[0].pos, b = S[S.length - 1].pos;
    reveal = clamp01((b[1] - a[1]) / 10) * clamp01((Math.hypot(b[0] - lm.x, b[2] - lm.z) - Math.hypot(a[0] - lm.x, a[2] - lm.z)) / 5);
  }
  f.cinematic = shot.kind === 'orbit' ? orbit : shot.kind === 'reveal' ? reveal : Math.max(orbit, reveal);
  const dur = clip.dur_s, lo = shot.minDur, hi = shot.maxDur;
  f.duration = dur >= lo && dur <= hi ? 1 : clamp01(1 - (dur < lo ? lo - dur : dur - hi) / (0.5 * (dur < lo ? lo : hi)));
  f.vsafety = collisionsInClip === 0 ? 1 : 0;
  return f;
}

function clipsOf(log, finMs) {
  const clips = [];
  let open = null;
  for (const e of log) {
    if (e.type === 'record_start' && !open) open = { start: e.t_ms, samples: [] };
    else if (e.type === 'record_stop' && open) { open.end = e.t_ms; clips.push(open); open = null; }
  }
  if (open) { open.end = finMs; clips.push(open); }
  for (const c of clips) {
    c.dur_s = (c.end - c.start) / 1000;
    c.samples = log.filter((e) => e.type === 'sample' && e.t_ms >= c.start && e.t_ms <= c.end);
    c.collisions = log.filter((e) => e.type === 'collision' && e.t_ms >= c.start && e.t_ms <= c.end).length;
  }
  return clips;
}

function scoreM2(ctx) {
  const { config, log, fin, W, comp } = ctx;
  const shots = config.mission.shots;
  // Photos in time order; the variation component compares each photo with the one before it.
  const photos = [];
  let prev = null;
  for (const e of log) {
    if (e.type !== 'photo') continue;
    const ph = { e, per: {} };
    for (const s of shots.filter((x) => x.type === 'photo')) ph.per[s.id] = photoFactors(e, s, config, prev);
    photos.push(ph);
    prev = e;
  }
  const photoTotal = (f) => PHOTO_KEYS.reduce((s, [k]) => s + W(k) * f[k], 0);
  const used = new Set(), results = [];
  for (const shot of shots.filter((x) => x.type === 'photo')) {
    let best = null, bi = -1;
    photos.forEach((p, i) => { if (!used.has(i) && (!best || photoTotal(p.per[shot.id]) > photoTotal(best.per[shot.id]))) { best = p; bi = i; } });
    if (best) used.add(bi);
    results.push({ shot, kind: 'photo', f: best ? best.per[shot.id] : null, t_ms: best ? best.e.t_ms : null });
  }
  const clips = clipsOf(log, fin.t_ms), usedC = new Set();
  for (const shot of shots.filter((x) => x.type === 'video')) {
    let best = null, bi = -1, bs = -1;
    clips.forEach((c, i) => {
      if (usedC.has(i)) return;
      const f = videoFactors(c, shot, config, c.collisions);
      const s = VIDEO_KEYS.reduce((t, [k]) => t + W(k) * f[k], 0);
      if (s > bs) { bs = s; best = f; bi = i; }
    });
    if (best) usedC.add(bi);
    results.push({ shot, kind: 'video', f: best, t_ms: best ? clips[bi].start : null });
  }
  const nPhoto = results.filter((r) => r.kind === 'photo').length, nVideo = results.length - nPhoto;
  const share = nPhoto && nVideo ? W('photoShare') : nPhoto ? 1 : 0, vshare = nPhoto && nVideo ? 1 - share : nVideo ? 1 : 0;
  const rows = (keys, kind, sh, n) => {
    if (!n) return;
    for (const [k, name] of keys) {
      const sum = results.filter((r) => r.kind === kind).reduce((s, r) => s + (r.f ? W(k) * r.f[k] : 0), 0);
      comp.push({ key: k, name, points: round1((sh * sum) / n), max: round1(sh * W(k)), note: kind === 'photo' ? 'rata-rata foto terbaik tiap butir' : 'rata-rata video terbaik tiap butir' });
    }
  };
  rows(PHOTO_KEYS, 'photo', share, nPhoto);
  rows(VIDEO_KEYS, 'video', vshare, nVideo);
  const details = results.map((r) => ({
    id: r.shot.id, type: r.kind, label: r.shot.label, done: !!r.f,
    score: r.f ? round1((r.kind === 'photo' ? PHOTO_KEYS : VIDEO_KEYS).reduce((s, [k]) => s + W(k) * r.f[k], 0)) : 0,
  }));
  return { details };
}

// ---------------------------------------------------------------- M3
export function replayAgri(config, log) {
  const a = makeAgri(config.mission);
  // The simulator draws a new wind for every run and reports it as a 'wind' event; it wins over the config.
  const wind = log.find((e) => e.type === 'wind')?.wind ?? config.wind;
  for (const e of log) {
    if (e.type === 'refill' && Math.hypot(e.pose.pos[0], e.pose.pos[2]) <= HOME_R + 2) refill(a);
    else if (e.type === 'sample') sprayStep(a, e, wind);
  }
  return a;
}

function scoreM3(ctx) {
  const { config, log, fin, add, def } = ctx;
  const a = replayAgri(config, log), sum = agriSummary(a);
  add('coverage', 'Cakupan', sum.coverage, `${Math.round(sum.coverage * 100)}% sel lahan dosisnya tepat`);
  add('waste', 'Pemborosan', sum.waste >= 1 ? 0 : 1 - sum.waste, `${Math.round(sum.waste * 100)}% dosis terbuang (luar lahan, zona terlarang, berlebih)`);
  // Efficiency only counts in proportion to the work done.
  add('efficiency', 'Efisiensi', (0.5 * timeFactor(fin.t_ms, def.par_time_s) + 0.5 * clamp01(fin.battery / 40)) * sum.coverage, 'waktu dan baterai terhadap acuan');
  add('envelope', 'Ketinggian dan kecepatan', sum.envelope, `${Math.round(sum.envelope * 100)}% waktu semprot dalam 3-8 m dan ≤ 4 m/s`);
  add('tank', 'Manajemen tangki', a.total > 0 ? 1 - 0.5 * a.empties : 0, `${a.empties} kali tangki kosong, ${a.refills} kali isi ulang di H`);
  return { coverage: sum.coverage, empties: a.empties, refills: a.refills };
}

// ---------------------------------------------------------------- M5
export const severityOf = (d) => (d.size >= 1.5 ? 'berat' : d.size >= 0.8 ? 'sedang' : 'ringan');

// A mark counts for the defects that are in the frame and within 10 m.
export const markedDefects = (e) => (e.visible || []).filter((v) => v.label === 'defect' && v.dist <= 10).map((v) => v.id);

// Which defects were photographed / marked, which panels were photographed, how many marks were wrong.
export function inspectionState(config, log) {
  const m = config.mission, photographed = new Map(), marked = new Set(), panels = new Set();
  let wrong = 0, marks = 0, qualitySum = 0, qualityN = 0;
  for (const e of log) {
    if (e.type === 'photo') {
      for (const p of m.panels) {
        const pr = project(e.pose, { x: p.x, y: p.y, z: p.z, hx: 1, hy: 1 });
        const facing = (e.pose.pos[0] - p.x) * p.nx + (e.pose.pos[2] - p.z) * p.nz > 0;
        if (pr && pr.dist <= 12 && facing && pr.center[0] >= 0 && pr.center[0] <= 1 && pr.center[1] >= 0 && pr.center[1] <= 1) panels.add(p.id);
      }
      for (const v of e.visible || []) {
        if (v.label !== 'defect' || v.dist > 10) continue;
        if (!photographed.has(v.id)) photographed.set(v.id, e.t_ms);
        const sharp = Math.min((e.speed || 0) <= 0.5 ? 1 : clamp01(1 - (e.speed - 0.5) / 2.5), Math.abs(e.yaw_rate || 0) <= 10 ? 1 : clamp01(1 - (Math.abs(e.yaw_rate) - 10) / 50));
        qualitySum += 0.5 * sharp + 0.5 * clamp01(v.area / 0.003);
        qualityN++;
      }
    } else if (e.type === 'mark') {
      marks++;
      const seen = markedDefects(e);
      if (seen.length) for (const id of seen) marked.add(id); else wrong++;
    }
  }
  return { photographed, marked, panels, wrong, marks, quality: qualityN ? qualitySum / qualityN : 0 };
}

export function inspectionReport(config, log) {
  const m = config.mission, st = inspectionState(config, log);
  return {
    defects: m.defects.map((d) => ({
      id: d.id, kind: d.kind, pos: [d.x, d.y, d.z], severity: severityOf(d), face: d.face,
      photographed: st.photographed.has(d.id), marked: st.marked.has(d.id), photo: st.photographed.has(d.id) ? `t=${st.photographed.get(d.id)}` : null,
    })),
    coverage: m.panels.length ? st.panels.size / m.panels.length : 0,
    panels: { covered: st.panels.size, total: m.panels.length },
    wrong_marks: st.wrong,
  };
}

function scoreM5(ctx) {
  const { config, log, add } = ctx;
  const m = config.mission, st = inspectionState(config, log), n = m.defects.length, s = m.structure;
  const found = m.defects.filter((d) => st.photographed.has(d.id) && st.marked.has(d.id)).length;
  add('facade', 'Cakupan fasad', m.panels.length ? st.panels.size / m.panels.length : 0, `${st.panels.size} dari ${m.panels.length} panel terfoto`);
  add('defects', 'Cacat ditemukan', n ? found / n - (st.wrong * 0.1) : 0, `${found} dari ${n} cacat difoto dan ditandai, ${st.wrong} tanda salah`);
  // Safe distance: share of the time near the structure (within 15 m of its surface) spent 3..8 m from it.
  let near = 0, safe = 0;
  for (const e of log) {
    if (e.type !== 'sample' || e.pos[1] < 0.5) continue;
    const dx = Math.max(s.x - s.w / 2 - e.pos[0], 0, e.pos[0] - (s.x + s.w / 2));
    const dy = Math.max(s.y0 - e.pos[1], 0, e.pos[1] - s.y1);
    const dz = Math.max(s.z - s.d / 2 - e.pos[2], 0, e.pos[2] - (s.z + s.d / 2));
    const d = Math.hypot(dx, dy, dz);
    if (d > 15) continue;
    near++;
    if (d >= m.safe.min && d <= m.safe.max) safe++;
  }
  add('distance', 'Jarak aman', near ? safe / near : 0, `${near ? Math.round((safe / near) * 100) : 0}% waktu dekat struktur di jarak ${m.safe.min}-${m.safe.max} m`);
  add('quality', 'Kualitas foto', st.quality, 'rata-rata ketajaman dan ukuran cacat di bingkai');
  // Report: each defect needs a position (marked), a photo and a severity (the server derives it from the size once the defect is known).
  let rep = 0;
  for (const d of m.defects) {
    const mk = st.marked.has(d.id), ph = st.photographed.has(d.id);
    rep += (mk ? 1 : 0) + (ph ? 1 : 0) + (mk || ph ? 1 : 0);
  }
  add('report', 'Kelengkapan laporan', n ? rep / (3 * n) : 0, 'tiap cacat: posisi, foto, tingkat keparahan');
  return { found, total: n, report: inspectionReport(config, log) };
}

// ---------------------------------------------------------------- M4 and practice
function scoreM4(ctx) {
  const { config, log, fin, add, def } = ctx;
  const m = config.mission, completed = fin.reason === 'completed';
  const collisions = log.filter((e) => e.type === 'collision').length;
  const drop = log.find((e) => e.type === 'drop');
  let dist = Infinity;
  if (drop) dist = Math.hypot(drop.pose.pos[0] - m.drop.x, drop.pose.pos[2] - m.drop.z);
  const noFlyMs = zoneMs(log, 'nofly', fin.t_ms);
  const half = drop ? 1 : 0.5; // "gugur": without a delivery the other components are halved
  add('accuracy', 'Ketepatan', drop ? 1 - (dist - 1) / 7 : 0, drop ? `jatuh ${dist.toFixed(1)} m dari pusat zona` : 'paket belum dijatuhkan');
  add('cargo', 'Kondisi barang', (1 - collisions / 3) * half, `${collisions} tabrakan`);
  add('time', 'Waktu', drop ? timeFactor(fin.t_ms, def.par_time_s) : 0, `acuan ${def.par_time_s} s`);
  add('battery', 'Baterai tersisa', Math.min(1, fin.battery / 60) * half, `${Math.round(fin.battery)}% tersisa`);
  add('zones', 'Kepatuhan zona', (1 - noFlyMs / 5000) * half, `${(noFlyMs / 1000).toFixed(1)} s di zona terlarang`);
  return { completed };
}

function scorePractice(ctx) {
  const { log, fin, add, def } = ctx;
  const completed = fin.reason === 'completed';
  const collisions = log.filter((e) => e.type === 'collision').length;
  add('goal', 'Tujuan', completed ? 1 : (fin.progress || 0) * 0.6, completed ? 'selesai' : 'belum selesai');
  add('time', 'Waktu', completed ? timeFactor(fin.t_ms, def.par_time_s) : 0, `acuan ${def.par_time_s} s`);
  add('safety', 'Keselamatan', 1 - collisions / 4, `${collisions} tabrakan`);
  return {};
}

const SCORERS = { m1_sar: scoreM1, m2_foto: scoreM2, m3_agri: scoreM3, m4_delivery: scoreM4, m5_inspeksi: scoreM5 };
const PRACTICE_W = { goal: 60, time: 20, safety: 20 };

// log: [{ t_ms, type, pose?, ... }] (events and samples, any order), fin: { t_ms, battery, reason, progress? }
export function scoreFromEvents(missionId, config, rawLog, fin) {
  const def = getMission(missionId);
  const log = rawLog.slice().sort((a, b) => a.t_ms - b.t_ms); // stable: same-time entries keep their order
  const weights = { ...(def.weights || PRACTICE_W), ...(config.weights || {}) };
  const W = (k) => weights[k];
  const comp = [];
  const add = (key, name, factor, note, override) => {
    const f = override !== undefined ? override : clamp01(factor);
    comp.push({ key, name, points: round1(W(key) * f), max: W(key), note });
  };
  const ctx = { def, config, log, fin, W, add, comp };
  const extra = (SCORERS[missionId] || scorePractice)(ctx) || {};
  // "Gugur": the run did not end as completed, so these components are cut by half.
  if (fin.reason !== 'completed' && def.gugur) {
    for (const c of comp) if (def.gugur.includes(c.key)) { c.points = round1(c.points / 2); c.note += ' (gugur: dipotong 50%)'; }
  }
  const score = Math.round(comp.reduce((s, c) => s + c.points, 0));
  return { score, grade: gradeOf(score), breakdown: comp.map(({ name, points, max, note }) => ({ name, points, max, note })), ...extra };
}
