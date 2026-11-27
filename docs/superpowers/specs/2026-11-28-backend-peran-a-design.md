# Rancangan: Backend DroneLab3D (Peran A)

Tanggal: 2026-11-28 · Status: **menunggu persetujuan** · Tidak di-commit (git dibiarkan dulu).

Tanda **[usul]** = keputusan yang saya isi sendiri. Coret atau ubah kalau tidak setuju.

## 1. Maksud

Folder `dronelab` baru berisi simulator 3D. Proposal A membutuhkan backend, gateway, dan penilaian otomatis (lihat `ATURAN_A_INFRASTRUKTUR_BACKEND.md`). Backend itu ditambahkan di `backend/` dan mengikuti simulator yang sudah ada.

## 2. Tujuan, bukan tujuan, anti-tujuan

**Tujuan**
- Gateway Python (FastAPI) di port 8000 yang langsung dipakai simulator.
- Mesin misi, lima `Scorer` (M1 sampai M5), penyimpanan, replay, drone tiruan.
- Tes, Ruff, Docker, CI, dokumen, folder bersih, alat terpasang.
- Data eksperimen: latensi p50/p95 untuk 1, 5, 10, 20 drone; replay 10× identik; minimal 10 kasus hitung tangan per misi (50 kasus).

**Bukan tujuan**
- Pekerjaan git: tanpa commit, cabang, tag, atau push.
- Pembagian peran. Simulator tetap milik Anda, nanti untuk Orang B.
- Algoritma jalur (B) dan model deteksi (C). Gateway hanya meneruskan.
- Misi latihan di server (simulator menghitungnya sendiri).
- **[usul]** Validator DSL, kunci API, batas laju, akun pemain, Redis, Grafana, Locust, PostgreSQL.
- **[usul]** Memperbaiki `npm run mock` di Windows (digantikan gateway Python) dan tes `python3` yang gagal.

**Anti-tujuan** (dianggap gagal meskipun jalan)
- Skor server berbeda dari skor simulator untuk log yang sama.
- Cara memainkan simulator berubah.
- Simulator macet atau jatuh ke mode stub karena gateway lambat.

## 3. Batasan

- Format mengikuti simulator: jalur `/api/v1/…`, WebSocket `/ws/v1/runs/{run_id}`, `t_ms`, telemetri 10 Hz, ID misi `m1_sar`, `m2_foto`, `m3_agri`, `m4_delivery`, `m5_inspeksi`.
- Klien simulator memberi batas 1,5 detik untuk `/health`, `/runs`, dan `/finish` (`src/gateway.js`).
- Python 3.11, SQLite. Port: gateway 8000, planner 8001, detektor 8002, Vite 5173.
- Skor deterministik: tanpa angka acak dan tanpa waktu sistem.

## 4. Pendekatan

| Pendekatan | Untung | Rugi |
|---|---|---|
| **1. Skor ditulis ulang di Python, dunia diekspor dari JS (dipilih)** | Backend utuh, kode secukupnya | Rumus ada di dua bahasa; ubah titik misi berarti ekspor ulang; varian acak terkunci di seed 42 |
| 2. Pembangkit dunia juga di Python | Seed bebas | Kode lebih banyak, perubahan dunia dikerjakan dua kali |
| Dicoret: Python memanggil JS | Satu sumber rumus | `Scorer` bukan buatan backend, melemahkan proposal A |

Anda memilih pendekatan 1.

## 5. Struktur

```text
backend/
  app/
    main.py, config.py, errors.py
    api/        health, missions, worlds, runs, leaderboard, ai, ws
    models/     Pydantic (kontrak)
    mission/    engine.py (state machine)
    scoring/    base.py, m1_sar.py, m2_photo.py, m3_agri.py, m4_delivery.py,
                m5_inspection.py, camera.py, agri.py, jsmath.py
    clients/    planner.py, detector.py
    db/         tabel dan repositori SQLite
  worlds/       16 berkas JSON hasil ekspor
  contracts/    contract-v0.2.md, skema JSON, VERSION
  tools/        mock_drone.py, replay.py, latency.py
  tests/
  Dockerfile, docker-compose.yml, requirements.txt, requirements-dev.txt,
  pyproject.toml, .env.example, README.md
scripts/export_worlds.mjs        ekspor dunia dan katalog misi
scripts/make_parity_cases.mjs    contoh log + skor JS untuk tes pembanding
docs/api.md, CHANGELOG.md, .github/workflows/ci.yml
```

## 6. API

Semua galat: `{"error": {"code", "message"}}`, termasuk galat validasi. Jawaban berbentuk objek memuat `api_version: "1"`. CORS hanya untuk asal di `ALLOWED_ORIGINS` (bawaan `http://localhost:5173` dan `http://127.0.0.1:5173`).

**Dipakai simulator** (bentuk sama dengan `mock-server/server.js`):

| Jalur | Isi |
|---|---|
| `GET /health` | `status`, `ai` (`ok`/`down`). Cek ke detektor maksimal 0,5 detik |
| `GET /api/v1/missions` | daftar misi |
| `POST /api/v1/runs` | `mission_id`, `variant`, `player` → `run_id`, `seed` (42), `config`. Varian tidak dikenal → varian pertama |
| `POST /api/v1/runs/{id}/events` | peristiwa |
| `WS /ws/v1/runs/{id}` | telemetri masuk; `hint` keluar saat baterai ≤ 20 |
| `POST /api/v1/runs/{id}/finish` | hitung, simpan, kembalikan `score`, `grade`, `breakdown`, dan rincian misi. Panggilan kedua mengembalikan hasil yang sama |
| `GET /api/v1/runs/{id}/report` | laporan inspeksi (M5) |
| `GET /api/v1/leaderboard` | `mission_id`, `variant`, `limit`; hanya run yang sudah selesai |
| `POST /api/v1/command`, `/decide`, `/detect` | diteruskan ke detektor/AI; mati → 503 `ai_down` |

**Tambahan Peran A:**

| Jalur | Isi |
|---|---|
| `GET /api/v1/runs`, `GET /api/v1/runs/{id}` | daftar run, status mesin misi, hasil |
| `GET /api/v1/runs/{id}/telemetry` | log tersimpan |
| `POST /api/v1/runs/{id}/replay` | hitung ulang dari log; kembalikan skor dan apakah identik |
| `GET`, `POST /api/v1/worlds`; `GET`, `PUT`, `DELETE /api/v1/worlds/{id}` | CRUD dunia. Satu dunia = pasangan `mission_id` + `variant`, jadi dunia baru langsung bisa dipakai `POST /runs`. 16 dunia bawaan hanya-baca |
| `POST /api/v1/missions`; `GET`, `PUT`, `DELETE /api/v1/missions/{id}` | **[usul]** misi baru wajib memakai salah satu dari lima scorer; lima misi bawaan tidak bisa dihapus |
| `POST /api/v1/plan` | bentuk contract v0.1, diteruskan ke planner; mati → 503 `planner_down` |

**[usul] Deteksi:** gateway menerima format simulator `{image, mode}` (ditambah `camera_pose` opsional), mengirim ke C dalam format v0.1 (`frame_id`, `image_b64`, `camera_pose`), lalu mengubah jawabannya ke `{objects: [{label, score, box: [x,y,w,h] 0..1}]}`. `bbox` dari C dianggap piksel pada gambar yang dikirim.

## 7. Mesin misi

```text
siap → lepas_landas → menjalankan → kembali → mendarat
   (dari status mana pun sebelum akhir) → gagal
```

- `lepas_landas`: peristiwa `takeoff`. `menjalankan`: sampel pertama 2 m di atas titik awal.
- `kembali`: tujuan misi terpenuhi menurut log. `mendarat`: `finish` dengan `completed` (boleh langsung dari `menjalankan`, untuk "Akhiri dan lihat skor").
- `gagal`: alasan `battery`, `crashed`, `drowned`, `timeout`, atau `out_of_area`.
- **[usul]** Server menimpa `completed` bila waktu > 2× acuan + 1 detik (`timeout`) atau posisi keluar batas peta (`out_of_area`). Baterai mengikuti alasan dari simulator. Batas peta ikut diekspor ke berkas dunia; untuk peta realistis diambil dari `public/scenes/<id>/scene.json`.
- **[usul]** Tabrakan dicatat dan mengurangi skor; misi gagal hanya bila drone jatuh, sama dengan simulator.
- Setiap perpindahan status ditulis di log peristiwa run.

## 8. Penilaian

- Satu antarmuka: `Scorer.score(config, log, finish) -> hasil`, didaftarkan per jenis scorer.
- Rumus, bobot, `gugur`, dan peringkat sama dengan `src/scoring.js` dan `src/catalog.js`. Bobot dibaca dari berkas misi.
- Urutan log: `t_ms`, lalu peristiwa sebelum sampel, lalu urutan tiba.
- Kesamaan dengan JS: pembulatan meniru `Math.round`, dosis semprot disimpan float 32-bit seperti `Float32Array`.

## 9. Perubahan kecil di simulator

Dua masalah yang membuat skor resmi bisa salah:

1. **Angin.** `main.js` mengacak angin tiap misi dan tidak memberi tahu gateway. Perbaikan: kirim peristiwa `wind` saat misi mulai; `scoring.js` dan scorer Python memakainya, kalau tidak ada memakai `config.wind`.
2. **Urutan kirim.** Peristiwa `drop` dan `finish` dikirim hampir bersamaan, jadi server bisa menilai sebelum `drop` tiba. Perbaikan: `gateway.js` menunggu peristiwa yang masih terkirim sebelum `finish`. Di sisi server, `finish` menunggu WebSocket tertutup (maksimal 0,5 detik).

Tidak ada perubahan lain pada simulator.

## 10. Penyimpanan, drone tiruan, eksperimen

- Tabel: `worlds`, `missions`, `runs`, `events`, `telemetry`, `scores`. Telemetri disimpan penuh (10 Hz), ditulis berkelompok (tiap 1 detik, saat putus, dan saat `finish`). Basis data di `backend/data/`, diabaikan git.
- `mock_drone.py`: menerbangkan tiap misi dari awal sampai akhir lewat API; opsi jumlah drone dan laju kirim.
- `latency.py`: 1, 5, 10, 20 drone, 10 Hz (opsi 20 Hz). Server membalas `ack` hanya bila WebSocket dibuka dengan `?ack=1`. Keluaran CSV, tabel, dan grafik PNG.

## 11. Kebersihan repo dan dokumen

- **Hapus:** `_to_delete/` (sekitar 32 MB), `scripts/blender/_to_delete/`, semua `__pycache__/`. Berkas yang ter-commit bisa dipulihkan dari git; tanpa commit, `git status` akan menampilkannya sebagai terhapus.
- **`.gitignore` ditambah:** `__pycache__/`, `*.pyc`, `.venv/`, `.pytest_cache/`, `.ruff_cache/`, `.env`, `*.db`, `*.sqlite*`, `backend/data/`, `_to_delete/`, `*.blend1`, `*.log`, `Thumbs.db`, `.DS_Store`.
- **Dokumen:** `backend/README.md` (jalan dalam ≤ 5 perintah), `docs/api.md`, `CHANGELOG.md`, `.env.example`, `contracts/contract-v0.2.md`, bagian singkat di README utama. Contract v0.2 mencatat tiap perbedaan dari v0.1 dan **masih perlu disetujui B dan C**. File aturan tidak diubah.

## 12. Alat yang dipasang

| Alat | Cara | Siapa |
|---|---|---|
| Lingkungan `backend/.venv` (Python 3.11) | `venv` | saya |
| fastapi, uvicorn[standard], pydantic, httpx, websockets, sqlmodel, pytest, pytest-asyncio, ruff, matplotlib | pip, dari PyPI | saya |
| Ekstensi VS Code: Ruff, Docker, REST Client | `code --install-extension` | saya |
| Bruno | winget (menyetujui syarat paket) | saya |
| WSL2 dan Docker Desktop | `wsl --install`, winget | **Anda**: perlu admin, persetujuan lisensi, restart |

Menyetujui rancangan ini berarti menyetujui unduhan dan pemasangan di baris "saya". Python, Git, VS Code, Python extension, dan Pylance sudah ada.

## 13. Selesai jika

1. `ruff check` bersih dan `pytest` hijau, termasuk: tiap endpoint minimal satu tes; 50 kasus hitung tangan; tes pembanding skor Python = JS; replay 10× identik.
2. `npm test` tidak lebih buruk dari sekarang (satu kegagalan `python3` yang sudah ada), ditambah tes baru untuk dua perubahan simulator dan tes bahwa berkas ekspor masih cocok dengan kode JS.
3. Drone tiruan menyelesaikan M1 sampai M5.
4. Simulator di browser menampilkan "Tersambung" dan satu misi mendapat skor resmi dari gateway Python.
5. Data latensi 1/5/10/20 drone tersimpan beserta grafik.
6. Docker: berkas dibuat; `docker compose up` baru bisa diuji setelah Anda memasang Docker. CI baru berjalan setelah di-push.

## 14. Diserahkan ke pembuat

Nama fungsi internal, isi detail tiap tes, bentuk tabel, gaya kode (komentar dalam bahasa Inggris).
