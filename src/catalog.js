// Mission catalog and weights. Scores are 0..100 made of weighted components (SHARED, Orang 3 spec B5).
// The weights live here (data), not in the scoring code, so they can change without touching the logic.
// `gugur` lists the components that are halved when the run does not end as completed.
export const MISSIONS = [
  { id: 'latihan_terbang', tier: 'latihan', title: 'Latihan terbang', par_time_s: 90, available: true,
    desc: 'Lepas landas, melayang stabil 3 detik, lalu mendarat di helipad.' },
  { id: 'patroli', tier: 'latihan', title: 'Patroli checkpoint', par_time_s: 120, available: true,
    desc: 'Lewati 5 cincin checkpoint, lalu mendarat di helipad.' },
  { id: 'rintangan', tier: 'latihan', title: 'Hindari rintangan', par_time_s: 90, available: true,
    desc: 'Terbang ke cincin tujuan di ujung peta tanpa menabrak tiang.' },
  { id: 'm1_sar', tier: 'utama', title: 'Pencarian dan penyelamatan', par_time_s: 300, available: true, variants: ['gedung', 'hutan'],
    desc: 'Temukan semua korban sebelum baterai habis. Tekan M di dekat korban untuk menandai, T untuk mode panas. Hindari zona api.',
    weights: { found: 40, time: 20, coverage: 15, safety: 15, precision: 10 }, gugur: ['time', 'coverage'] },
  { id: 'm2_foto', tier: 'utama', title: 'Fotografi dan videografi', par_time_s: 300, available: true, variants: ['hotel', 'gunung'],
    desc: 'Penuhi daftar bidikan: foto (F) dan video (R mulai/berhenti). Subjek di sepertiga, horizon rata, diam saat foto.',
    weights: { subject: 30, thirds: 20, horizon: 10, sharp: 15, light: 10, variation: 15, vsubject: 30, smooth: 30, cinematic: 20, duration: 10, vsafety: 10, photoShare: 0.6 }, gugur: [] },
  { id: 'm3_agri', tier: 'utama', title: 'Penyiraman dan pupuk', par_time_s: 300, available: true, variants: ['lahan'],
    desc: 'Semprot lahan merata (tahan G), hindari rumah dan sungai. Tangki terbatas: isi ulang otomatis saat mendarat di H.',
    weights: { coverage: 40, waste: 20, efficiency: 20, envelope: 10, tank: 10 }, gugur: ['efficiency', 'tank'] },
  { id: 'm4_delivery', tier: 'utama', title: 'Pengiriman barang', par_time_s: 180, available: true,
    desc: 'Ambil paket di titik kuning, antar ke zona hijau, hindari zona terlarang merah.',
    weights: { accuracy: 30, cargo: 20, time: 20, battery: 15, zones: 15 }, gugur: [] },
  { id: 'm5_inspeksi', tier: 'utama', title: 'Inspeksi bangunan', par_time_s: 300, available: true, variants: ['gedung', 'jembatan'],
    desc: 'Foto semua sisi struktur dari jarak 3 sampai 8 m, foto (F) dan tandai (M) tiap cacat. Hasilnya laporan inspeksi.',
    weights: { facade: 30, defects: 30, distance: 15, quality: 10, report: 15 }, gugur: ['distance', 'report'] },
];
export const getMission = (id) => MISSIONS.find((m) => m.id === id);

export function gradeOf(score) {
  return score >= 85 ? 'gold' : score >= 70 ? 'silver' : score >= 50 ? 'bronze' : 'none';
}
