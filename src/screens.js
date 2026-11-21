// Menu screen specs (data only). main.js supplies the callbacks, ui.js draws them.
import { esc } from './ui.js';

const TIER = { latihan: 'Latihan (tanpa AI, skor tidak resmi)', utama: 'Misi utama (skor resmi dari gateway)' };

export function mainMenuSpec(cb) {
  return {
    title: 'DroneLab3D', subtitle: 'Simulator drone 3D', foot: '↑ ↓ pilih · Enter / A pilih · Esc / B kembali',
    items: [
      { label: 'Mulai', note: 'Latihan terbang', action: cb.quickStart },
      { label: 'Misi', note: 'Latihan dan misi utama', action: cb.missions },
      { label: 'Freeroam', note: 'Terbang bebas', action: cb.freeroam },
      { label: 'Editor perintah', note: 'Fase 4', enabled: false, action() {} },
      { label: 'Pengaturan', note: 'Fase 5', enabled: false, action() {} },
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
    <tr><td></td><td>F foto · P ambil/lepas paket · B tambah objek (freeroam) · V kamera · Tab panel · Esc jeda</td></tr>
    <tr><td>Controller</td><td>Stick kiri naik/putar · stick kanan gerak · A tahan takeoff/land · B home · X foto · LB/RB kamera · Start jeda</td></tr>
    <tr><td></td><td>D-pad kanan ambil/lepas paket</td></tr>
    <tr><td>Debug</td><td>Tombol &#96; (backtick) membuka panel data controller</td></tr></table>`;
  return { title: 'Bantuan', body, items: [{ label: 'Kembali', action: cb.back }], onBack: cb.back };
}
