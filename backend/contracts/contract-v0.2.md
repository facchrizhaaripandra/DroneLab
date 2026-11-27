# Contract v0.2

**Status: menunggu persetujuan B dan C.** Disusun 2026-11-28 oleh Peran A agar sesuai dengan simulator yang sudah ada. Sampai disetujui, `ATURAN_A_INFRASTRUKTUR_BACKEND.md` masih memuat v0.1.

Sesuai aturan perubahan kontrak: buat Issue berlabel `contract`, minta persetujuan ketiganya, beri tag git, lalu kabari grup. Langkah itu belum dilakukan.

Detail jalur: [`../../docs/api.md`](../../docs/api.md). Skema JSON: [`schemas/`](schemas/).

## Perubahan dari v0.1

| # | Butir | v0.1 | v0.2 | Yang terdampak |
|---|---|---|---|---|
| 1 | Satuan, koordinat | meter, detik, derajat; `world.origin` | meter, derajat, **`t_ms` (milidetik)**; sumbu Three.js tetap; asal dunia selalu titik H (0,0,0), tidak ada field `world.origin` | B |
| 2 | ID skenario | `spray`, `delivery`, `inspection` | `m1_sar`, `m2_foto`, `m3_agri` (spray), `m4_delivery` (delivery), `m5_inspeksi` (inspection). Dua misi baru: SAR dan foto | B, C |
| 3 | Port | 8000, 8001, 8002, 5173 | tidak berubah | |
| 4 | Waypoint | `{id,x,y,z,speed,action,params}` | tidak berubah; gateway menolak jawaban planner yang tidak sesuai | B |
| 5 | Telemetri | `/ws/telemetry/{run_id}`, ±20 Hz; `t, run_id, drone_id, pos, vel, yaw, battery, payload, status` | `/ws/v1/runs/{run_id}`, 10 Hz (20 Hz diterima); `t_ms, pos, vel, yaw, roll, pitch, gimbal, battery, payload_kg, spraying, collision`. `run_id` ada di URL, satu run = satu drone, status dibaca dari `GET /api/v1/runs/{id}` | B |
| 6 | Planner `POST /plan` | request/response v0.1 | tidak berubah. `scenario` = ID misi v0.2; `goal` objek atau array. Dipanggil lewat `POST /api/v1/plan` | B |
| 7 | Detektor `POST /detect` | `{frame_id, image_b64, camera_pose}` | sama, dengan dua penegasan: `camera_pose` boleh `null`; `bbox` dalam **piksel** gambar 640×360. Gateway menerjemahkan ke format simulator | C |
| 8 | Ground truth cacat | `{id, type, pos, normal, size}` | `{id, kind: "retak"\|"karat", face, x, y, z, nx, nz, size}` di `config.mission.defects` | C |
| 9 | Format galat | `{"error": {"code","message"}}` | tidak berubah | |

## Tambahan baru

- Peristiwa misi lewat `POST /api/v1/runs/{run_id}/events`, termasuk `wind` (angin run itu).
- Layanan C juga boleh menyediakan `POST /command` dan `POST /decide` (opsional) serta wajib `GET /health` agar gateway menampilkan `ai: "ok"`.
- Dunia disimpan per pasangan misi dan varian dengan `limits` (batas peta).

## Pertanyaan terbuka untuk B dan C

1. Setuju ID misi v0.2 menggantikan tiga ID skenario?
2. C: apakah `bbox` piksel dan ukuran 640×360 cocok dengan model deteksi?
3. C: apakah `type/pos/normal` pada data cacat masih dibutuhkan? Gateway bisa menurunkannya dari `kind/x,y,z/nx,nz`.
4. B: apakah planner butuh `goal` dengan bentuk tertentu per misi?
