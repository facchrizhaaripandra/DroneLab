// Menu screen specs (data only). main.js supplies the callbacks, ui.js draws them.
import { esc } from './ui.js';
import { keyLabel } from './bindings.js';
import { RAMP_NAMES, PRESET_NAMES } from './settings.js';

const TIER = { latihan: 'Latihan (tanpa AI, skor tidak resmi)', utama: 'Misi utama (skor resmi dari gateway)' };

export function mainMenuSpec(cb) {
  return {
    title: 'DroneLab3D', subtitle: 'Simulator drone 3D', foot: '↑ ↓ pilih · Enter / A pilih · Esc / B kembali',
    items: [
      { label: 'Mulai', note: 'Latihan terbang', action: cb.quickStart },
      { label: 'Misi', note: 'Latihan dan misi utama', action: cb.missions },
      { label: 'Freeroam', note: 'Terbang bebas', action: cb.freeroam },
      { label: 'Editor perintah', note: 'Skrip dan bahasa natural', action: cb.editor },
      { label: 'Pengaturan', note: 'Keyboard, controller, grafik', action: cb.settings },
      { label: 'Bantuan', action: cb.help },
    ],
  };
}

export function missionSpec(list, gatewayMode, cb) {
  const items = [];
  for (const tier of ['latihan', 'utama']) {
    for (const m of list.filter((x) => x.tier === tier)) {
      items.push({
        label: m.title, note: m.available ? `${TIER[tier].split(' (')[0]} · acuan ${m.par_time_s} s` : 'belum tersedia',
        enabled: m.available, action: () => cb.start(m),
      });
    }
  }
  items.push({ label: 'Kembali', action: cb.back });
  return {
    title: 'Pilih misi',
    subtitle: gatewayMode === 'online' ? 'Gateway tersambung: misi utama dinilai resmi' : 'Gateway tidak terjangkau: mode lokal (skor sementara)',
    items, onBack: cb.back,
  };
}

const REASON = { completed: 'Selesai', timeout: 'Waktu habis', battery: 'Baterai habis', crashed: 'Jatuh' };
const GRADE = { gold: 'Emas', silver: 'Perak', bronze: 'Perunggu', none: 'Belum ada peringkat' };

// res: { score, grade, breakdown } or null; official: true only for a score computed by the gateway.
export function resultSpec(def, reason, res, official, cb) {
  const rows = res ? res.breakdown.map((b) =>
    `<tr><td>${esc(b.name)}</td><td class="num">${esc(b.points)} / ${esc(b.max)}</td><td class="muted">${esc(b.note || '')}</td></tr>`).join('') : '';
  const body = res
    ? `<div class="score"><b>${esc(res.score)}</b><span>/ 100 · ${esc(GRADE[res.grade] || res.grade)}</span></div>
       <p class="tag">${official ? 'Skor resmi (gateway)' : 'Skor sementara (lokal, tidak resmi)'}</p>
       <table>${rows}</table>`
    : '<p>Skor tidak tersedia (gateway terputus saat menyelesaikan run).</p>';
  return {
    title: `${def.title}: ${REASON[reason] || reason}`, body,
    items: [{ label: 'Ulangi', action: cb.retry }, { label: 'Pilih misi', action: cb.missions }, { label: 'Menu utama', action: cb.main }],
    onBack: cb.main,
  };
}

export function pauseSpec(cb) {
  return {
    title: 'Jeda', dim: true,
    items: [{ label: 'Lanjut', action: cb.resume }, { label: 'Ulangi', action: cb.retry }, { label: 'Menu utama', action: cb.main }],
    onBack: cb.resume,
  };
}

export function helpSpec(cb) {
  const body = `<table class="help">
    <tr><td>Keyboard</td><td>W A S D gerak · Q E putar · Spasi / C naik / turun · X tahan takeoff/land · H return home</td></tr>
    <tr><td></td><td>F foto · P ambil/lepas paket · B tambah objek (freeroam) · V kamera · Tab panel · Enter editor perintah · Esc jeda</td></tr>
    <tr><td>Controller</td><td>Stick kiri naik/putar · stick kanan gerak · A tahan takeoff/land · B home · X foto · LB/RB kamera · Start jeda</td></tr>
    <tr><td></td><td>D-pad kanan ambil/lepas paket</td></tr>
    <tr><td>Debug</td><td>Tombol &#96; (backtick) membuka panel data controller</td></tr></table>`;
  return { title: 'Bantuan', body, items: [{ label: 'Kembali', action: cb.back }], onBack: cb.back };
}

// ---- Settings screens. `get()` returns the current settings; `cb` does the changes (main.js saves and applies them). ----

const ACTION_NAMES = {
  forward: 'Maju', back: 'Mundur', left: 'Geser kiri', right: 'Geser kanan', up: 'Naik', down: 'Turun',
  yawLeft: 'Putar kiri', yawRight: 'Putar kanan', takeoffLand: 'Takeoff / Land (tahan)', home: 'Return home',
  photo: 'Foto', record: 'Rekam', spray: 'Semprot (tahan)', pickupDrop: 'Ambil / lepas paket', mark: 'Tandai',
  thermal: 'Termal', command: 'Editor perintah', panelAI: 'Panel AI', addObject: 'Tambah objek', camera: 'Ganti kamera', pause: 'Jeda',
};
const FOOT = '← → ubah nilai · Enter / A pilih · Esc / B kembali';
const pct = (v) => `${Math.round(v * 100)}%`;
const onOff = (v) => (v ? 'Nyala' : 'Mati');

// Next value in a list (wraps), or a number moved by `step` and clamped.
export function stepList(list, cur, dir) { return list[(list.indexOf(cur) + dir + list.length) % list.length]; }
export function stepNum(cur, lo, hi, step, dir) { return Math.round(Math.min(hi, Math.max(lo, cur + dir * step)) * 100) / 100; }

export function settingsMenuSpec(cb) {
  return {
    title: 'Pengaturan', subtitle: 'Tersimpan otomatis di browser ini', foot: FOOT,
    items: [
      { label: 'Keyboard', note: 'tombol, sensitivitas, akselerasi', action: cb.keyboard },
      { label: 'Controller', note: 'skema, sensitivitas, deadzone, getaran', action: cb.controller },
      { label: 'Grafik', note: 'kualitas, FPS, resolusi, bayangan, HUD', action: cb.graphics },
      { label: 'Kembali', action: cb.back },
    ],
    onBack: cb.back,
  };
}

export function keyboardSpec(get, getCapturing, cb) {
  const s = get().keyboard, capturing = getCapturing();
  const items = Object.keys(ACTION_NAMES).map((a) => ({
    label: ACTION_NAMES[a],
    note: capturing === a ? 'tekan tombol baru... (Esc batal)' : keyLabel(s.keys[a]),
    action: () => cb.remap(a),
  }));
  items.unshift(
    { label: 'Sensitivitas', note: pct(s.sensitivity), step: (d) => cb.set('keyboard.sensitivity', stepNum(s.sensitivity, 0.3, 1, 0.1, d)) },
    { label: 'Akselerasi', note: `${s.ramp} / 5 (${RAMP_NAMES[s.ramp - 1]})`, step: (d) => cb.set('keyboard.ramp', stepNum(s.ramp, 1, 5, 1, d)) },
  );
  items.push({ label: 'Kembalikan tombol bawaan', action: cb.resetKeys }, { label: 'Kembali', action: cb.back });
  return { title: 'Pengaturan keyboard', subtitle: 'Pilih aksi lalu tekan tombol baru. Tombol yang sudah dipakai ditukar.', items, foot: FOOT, onBack: cb.back, rebuild: () => keyboardSpec(get, getCapturing, cb) };
}

export function controllerSpec(get, cb) {
  const s = get().controller;
  return {
    title: 'Pengaturan controller', subtitle: s.mode === 2 ? 'Mode 2: kiri naik/putar, kanan maju/geser' : 'Mode 1: kiri maju/putar, kanan naik/geser',
    foot: FOOT, onBack: cb.back, rebuild: () => controllerSpec(get, cb),
    items: [
      { label: 'Skema stick', note: `Mode ${s.mode}`, step: (d) => cb.set('controller.mode', stepList([1, 2], s.mode, d)) },
      { label: 'Sensitivitas', note: pct(s.sensitivity), step: (d) => cb.set('controller.sensitivity', stepNum(s.sensitivity, 0.5, 1.5, 0.1, d)) },
      { label: 'Deadzone', note: pct(s.deadzone), step: (d) => cb.set('controller.deadzone', stepNum(s.deadzone, 0.05, 0.3, 0.05, d)) },
      { label: 'Balik sumbu Y', note: onOff(s.invertY), step: () => cb.set('controller.invertY', !s.invertY) },
      { label: 'Getaran', note: onOff(s.rumble), step: () => cb.set('controller.rumble', !s.rumble) },
      { label: 'Uji stick dan getaran', action: cb.test },
      { label: 'Kembali', action: cb.back },
    ],
  };
}

export function stickTestSpec(cb) {
  return {
    title: 'Uji stick', subtitle: 'Gerakkan kedua stick. Lingkaran kecil = deadzone.', foot: 'Esc / B kembali', onBack: cb.back,
    body: '<canvas id="stk" width="540" height="150" style="display:block;margin:0 auto;border:1px solid #1f1f1f;background:#f4f3ef"></canvas>',
    tick: cb.tick,
    items: [{ label: 'Tes getaran', action: cb.rumble }, { label: 'Kembali', action: cb.back }],
  };
}

export function graphicsSpec(get, cb) {
  const g = get().graphics;
  return {
    title: 'Pengaturan grafik', subtitle: 'Kualitas turun otomatis jika FPS di bawah 30 (Fase 6)', foot: FOOT, onBack: cb.back, rebuild: () => graphicsSpec(get, cb),
    items: [
      { label: 'Preset kualitas', note: PRESET_NAMES[g.preset], step: (d) => cb.preset(stepList(['low', 'medium', 'high'], g.preset === 'custom' ? 'medium' : g.preset, d)) },
      { label: 'Target FPS', note: String(g.targetFps), step: (d) => cb.set('graphics.targetFps', stepList([30, 60], g.targetFps, d)) },
      { label: 'Resolusi render', note: pct(g.renderScale), step: (d) => cb.setCustom('graphics.renderScale', stepNum(g.renderScale, 0.5, 1, 0.1, d)) },
      { label: 'Bayangan', note: onOff(g.shadows), step: () => cb.setCustom('graphics.shadows', !g.shadows) },
      { label: 'Ukuran HUD', note: pct(g.hudScale), step: (d) => cb.set('graphics.hudScale', stepList([0.8, 0.9, 1], g.hudScale, d)) },
      { label: 'Kembali', action: cb.back },
    ],
  };
}
