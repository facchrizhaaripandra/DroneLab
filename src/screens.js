// Menu screen specs (data only). main.js supplies the callbacks, ui.js draws them.
import { esc } from './ui.js';
import { keyLabel, DEFAULT_KEYS } from './bindings.js';
import { RAMP_NAMES, PRESET_NAMES } from './settings.js';

const VARIANT = { gedung: 'gedung', hutan: 'hutan', hotel: 'hotel', gunung: 'gunung', jembatan: 'jembatan', lahan: 'lahan' };
const TIER = { latihan: 'Latihan', utama: 'Misi utama' };
const TIER_NOTE = { latihan: 'tanpa AI, skor tidak resmi', utama: 'skor dari gateway' };

export function mainMenuSpec(cb) {
  return {
    title: 'DroneLab3D', subtitle: 'Latihan terbang, misi penyelamatan, dan inspeksi dari udara', hero: true,
    foot: '↑ ↓ pilih · Enter / A pilih · Esc / B kembali',
    items: [
      { label: 'Mulai', note: 'Latihan terbang', action: cb.quickStart },
      { label: 'Misi', note: 'Latihan dan misi utama', action: cb.missions },
      { label: 'Freeroam', note: 'Terbang bebas', action: cb.freeroam },
      { label: 'Peta realistis', note: 'Lingkungan 3D dari Blender', action: cb.scenes },
      { label: 'Editor perintah', note: 'Skrip dan bahasa natural', action: cb.editor },
      { label: 'Pengaturan', note: 'Keyboard, controller, grafik', action: cb.settings },
      { label: 'Bantuan', action: cb.help },
    ],
  };
}

export function missionSpec(list, gatewayMode, cb) {
  const items = [];
  for (const tier of ['latihan', 'utama']) {
    items.push({ heading: true, label: TIER[tier], note: TIER_NOTE[tier], enabled: false, action: () => {} }); // section title, never focused
    for (const m of list.filter((x) => x.tier === tier)) {
      // A mission with variants gets one entry per variant (gedung / hutan, hotel / gunung, ...).
      for (const v of m.variants && m.variants.length > 1 ? m.variants : [null]) {
        items.push({
          label: v ? `${m.title}: ${VARIANT[v] || v}` : m.title,
          note: m.available ? `acuan ${String(Math.round(m.par_time_s / 6) / 10).replace('.', ',')} menit` : 'belum tersedia',
          enabled: m.available, action: () => cb.start(m, v || (m.variants && m.variants[0]) || undefined),
        });
      }
    }
  }
  items.push({ label: 'Kembali', action: cb.back });
  return {
    title: 'Pilih misi',
    subtitle: gatewayMode === 'online' ? 'Gateway tersambung: misi utama dinilai resmi' : 'Gateway tidak terjangkau: mode lokal (skor sementara)',
    items, onBack: cb.back,
  };
}

const SEVERITY = { ringan: 'ringan', sedang: 'sedang', berat: 'berat' };
const REASON = { completed: 'Selesai', timeout: 'Waktu habis', battery: 'Baterai habis', crashed: 'Jatuh', drowned: 'Tenggelam' };
const GRADE = { gold: 'Emas', silver: 'Perak', bronze: 'Perunggu', none: 'Belum ada peringkat' };

// res: { score, grade, breakdown } or null; official: true only for a score computed by the gateway.
export function resultSpec(def, reason, res, official, cb) {
  const share = (b) => (Number(b.max) > 0 ? Math.max(0, Math.min(100, (Number(b.points) / Number(b.max)) * 100)) : 0);
  const rows = res ? res.breakdown.map((b) =>
    `<tr><td>${esc(b.name)}<span class="meter"><i style="width:${share(b).toFixed(0)}%"></i></span></td><td class="num">${esc(b.points)} / ${esc(b.max)}</td><td class="muted">${esc(b.note || '')}</td></tr>`).join('') : '';
  const body = res
    ? `<div class="score"><b>${esc(res.score)}</b><span>/ 100</span><em class="grade g-${esc(res.grade)}">${esc(GRADE[res.grade] || res.grade)}</em></div>
       <p class="tag">${official ? 'Skor resmi (gateway)' : 'Skor sementara (lokal, tidak resmi)'}</p>
       <table>${rows}</table>${extraBody(res)}`
    : '<p>Skor tidak tersedia (gateway terputus saat menyelesaikan run).</p>';
  return {
    title: `${def.title}: ${REASON[reason] || reason}`, body,
    items: [{ label: 'Ulangi', action: cb.retry }, { label: 'Pilih misi', action: cb.missions }, { label: 'Menu utama', action: cb.main }],
    onBack: cb.main,
  };
}

// M2 shot results and the M5 inspection report (lists only; no thumbnails yet).
function extraBody(res) {
  let h = '';
  if (res.details && res.details.length) {
    h += '<p class="tag">Daftar bidikan</p><table>' + res.details.map((d) =>
      `<tr><td>${esc(d.label)}</td><td class="num">${d.done ? esc(d.score) : '-'} / 100</td><td class="muted">${d.done ? (d.type === 'photo' ? 'foto' : 'video') + ' terbaik' : 'belum ada'}</td></tr>`).join('') + '</table>';
  }
  if (res.report) {
    const r = res.report;
    h += `<p class="tag">Laporan inspeksi: cakupan fasad ${Math.round(r.coverage * 100)}% (${r.panels.covered} dari ${r.panels.total} panel)</p><table>`
      + r.defects.map((d) => `<tr><td>Cacat #${esc(d.id)} (${esc(d.kind)})</td><td class="num">${esc(SEVERITY[d.severity] || d.severity)}</td><td class="muted">${d.photographed ? 'foto' : 'tanpa foto'}, ${d.marked ? 'ditandai' : 'belum ditandai'} · posisi ${d.pos.map((v) => Math.round(v)).join(', ')}</td></tr>`).join('') + '</table>';
  }
  return h;
}

export function pauseSpec(cb) {
  const items = [{ label: 'Lanjut', action: cb.resume }, { label: 'Ulangi', action: cb.retry }];
  if (cb.settings) items.push({ label: 'Pengaturan', note: 'keyboard, controller, grafik', action: cb.settings });
  if (cb.finish) items.push({ label: 'Akhiri dan lihat skor', note: 'selesai sekarang', action: cb.finish });
  items.push({ label: 'Menu utama', action: cb.main });
  return {
    title: 'Jeda', dim: true,
    items,
    onBack: cb.resume,
  };
}

// Help: what each control does, grouped by task. Keyboard keys follow the player's own bindings.
export function helpSpec(cb, keys = DEFAULT_KEYS) {
  const k = (a) => `<span class="key">${esc(keyLabel(keys[a] || DEFAULT_KEYS[a]))}</span>`;
  const p = (...b) => b.map((x) => `<span class="key pad">${esc(x)}</span>`).join('');
  const rows = [
    ['Terbang', [
      ['Maju, mundur, geser', `${k('forward')}${k('left')}${k('back')}${k('right')}`, p('Stick kanan')],
      ['Naik dan turun', `${k('up')}${k('down')}`, p('Stick kiri ↑↓')],
      ['Putar', `${k('yawLeft')}${k('yawRight')}`, p('Stick kiri ←→')],
      ['Lepas landas / mendarat (tahan)', k('takeoffLand'), p('A')],
      ['Pulang ke pad', k('home'), p('B')],
    ]],
    ['Kamera dan misi', [
      ['Foto', k('photo'), p('X')],
      ['Rekam video', k('record'), p('D-pad ←')],
      ['Tandai korban atau cacat', k('mark'), p('D-pad ↑')],
      ['Semprot (tahan)', k('spray'), p('RT')],
      ['Mode panas', k('thermal'), p('D-pad ↓')],
      ['Ambil / lepas paket', k('pickupDrop'), p('D-pad →')],
      ['Ganti kamera', k('camera'), p('LB', 'RB')],
      ['Arahkan kamera atas / bawah', `${k('gimbalUp')} ${k('gimbalDown')} (${k('gimbalReset')} lurus)`, p('Y')],
      ['Putar kamera miring kiri / kanan', `${k('gimbalRollLeft')} ${k('gimbalRollRight')}`, '–'],
      ['Zoom kamera drone', `${k('zoomIn')} ${k('zoomOut')} atau roda mouse`, p('Back')],
    ]],
    ['Lainnya', [
      ['Editor perintah', k('command'), ''],
      ['Panel asisten AI', k('panelAI'), ''],
      ['Tambah objek (freeroam)', k('addObject'), ''],
      ['Jeda', k('pause'), p('Start')],
      ['Panel data controller', '<span class="key">`</span>', ''],
    ]],
  ];
  const table = (groups) => `<table class="help"><tr class="hd"><td></td><td>Keyboard</td><td>Controller</td></tr>${groups.map(([group, list]) =>
    `<tr class="grp"><td colspan="3">${group}</td></tr>` + list.map(([what, kb, pad]) => `<tr><td>${what}</td><td>${kb}</td><td>${pad}</td></tr>`).join('')).join('')}</table>`;
  const body = `<div class="help-cols">${table([rows[0], rows[2]])}${table([rows[1]])}</div>`; // flying + other on the left, camera and mission on the right
  return { title: 'Bantuan', subtitle: 'Tombol keyboard mengikuti pengaturan Anda.', body, items: [{ label: 'Kembali', action: cb.back }], onBack: cb.back, wide: true };
}

// ---- Settings screens. `get()` returns the current settings; `cb` does the changes (main.js saves and applies them). ----

const ACTION_NAMES = {
  forward: 'Maju', back: 'Mundur', left: 'Geser kiri', right: 'Geser kanan', up: 'Naik', down: 'Turun',
  yawLeft: 'Putar kiri', yawRight: 'Putar kanan', takeoffLand: 'Takeoff / Land (tahan)', home: 'Return home',
  photo: 'Foto', record: 'Rekam', spray: 'Semprot (tahan)', pickupDrop: 'Ambil / lepas paket', mark: 'Tandai',
  thermal: 'Termal', command: 'Editor perintah', panelAI: 'Panel AI', addObject: 'Tambah objek', camera: 'Ganti kamera', pause: 'Jeda', zoomIn: 'Zoom masuk', zoomOut: 'Zoom keluar',
  gimbalUp: 'Kamera miring ke atas', gimbalDown: 'Kamera miring ke bawah', gimbalReset: 'Kamera lurus',
  gimbalRollLeft: 'Kamera putar kiri', gimbalRollRight: 'Kamera putar kanan',
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
    key: capturing !== a, // drawn as a keycap
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
    title: 'Pengaturan grafik', subtitle: g.autoQuality ? 'Kualitas turun sendiri jika FPS rendah saat bermain' : 'Kualitas tetap seperti yang dipilih, tidak berubah saat bermain', foot: FOOT, onBack: cb.back, rebuild: () => graphicsSpec(get, cb),
    items: [
      { label: 'Preset kualitas', note: PRESET_NAMES[g.preset], step: (d) => cb.preset(stepList(['low', 'medium', 'high'], g.preset === 'custom' ? 'medium' : g.preset, d)) },
      { label: 'Target FPS', note: String(g.targetFps), step: (d) => cb.set('graphics.targetFps', stepList([30, 60], g.targetFps, d)) },
      { label: 'Resolusi render', note: pct(g.renderScale), step: (d) => cb.setCustom('graphics.renderScale', stepNum(g.renderScale, 0.5, 1, 0.1, d)) },
      { label: 'Bayangan', note: onOff(g.shadows), step: () => cb.setCustom('graphics.shadows', !g.shadows) },
      { label: 'Ukuran HUD', note: pct(g.hudScale), step: (d) => cb.set('graphics.hudScale', stepList([0.8, 0.9, 1], g.hudScale, d)) },
      { label: 'Turunkan otomatis', note: g.autoQuality ? 'Nyala (saat FPS rendah)' : 'Mati', step: () => cb.set('graphics.autoQuality', !g.autoQuality) },
      { label: 'Kembali', action: cb.back },
    ],
  };
}

// Realistic Blender scenes (public/scenes/index.json). Flown in freeroam mode.
export function sceneSpec(list, cb) {
  const items = list.map((e) => ({ label: e.title, note: `${e.notes || 'freeroam'} · ${e.glb_mb} MB`, action: () => cb.start(e) }));
  if (!list.length) items.push({ label: 'Belum ada scene', note: 'public/scenes/index.json tidak ditemukan', enabled: false, action: () => {} });
  items.push({ label: 'Kembali', action: cb.back });
  return { title: 'Peta realistis', subtitle: 'Terbang bebas di lingkungan 3D. Pemuatan pertama butuh beberapa detik.', items, onBack: cb.back };
}
