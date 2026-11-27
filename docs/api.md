# API Gateway DroneLab3D (contract v0.2)

Alamat lokal: `http://localhost:8000`. Dokumentasi interaktif (Swagger) selalu mutakhir di `http://localhost:8000/docs`. Skema JSON ada di `backend/contracts/schemas/`.

## Aturan umum

- Satuan: meter, derajat, `t_ms` (milidetik sejak misi mulai). Sumbu Three.js (Y ke atas), titik H di (0, 0, 0).
- Jawaban berbentuk objek memuat `api_version: "1"`. Daftar (misi, dunia, run, leaderboard) berupa array.
- Galat selalu `{"error": {"code": "STRING", "message": "..."}}`.
- CORS dan WebSocket hanya menerima asal di `ALLOWED_ORIGINS`. Alat tanpa header `Origin` diterima.
- Tidak ada autentikasi. Jalankan hanya di komputer atau jaringan yang Anda percaya.

| Kode galat | HTTP | Arti |
|---|---|---|
| `bad_json` | 400 | body bukan JSON |
| `invalid_request` | 400 | isi tidak sesuai skema |
| `invalid_world` | 400 | config dunia tidak bisa dipakai scorer |
| `read_only` | 403 | dunia atau misi bawaan |
| `not_found`, `method_not_allowed` | 404, 405 | jalur atau metode salah |
| `unknown_run`, `unknown_mission`, `unknown_world` | 404 | data tidak ada |
| `no_report` | 404 | laporan hanya untuk misi inspeksi |
| `conflict` | 409 | id sudah dipakai |
| `run_finished`, `run_not_finished` | 409 | status run tidak cocok |
| `ai_bad_response`, `planner_bad_response` | 502 | jawaban layanan tidak sesuai kontrak |
| `ai_down`, `planner_down` | 503 | layanan tidak aktif atau terlalu lama |

## Kesehatan

`GET /health` → `{"status": "ok", "api_version": "1", "ai": "ok" | "down"}`. `ai` adalah keadaan layanan detektor (cek maksimal 0,5 detik).

## Misi

| Jalur | Isi |
|---|---|
| `GET /api/v1/missions` | `[{"id", "title", "variants", "par_time_s"}]` |
| `GET /api/v1/missions/{mission_id}` | definisi lengkap: `scorer`, `weights`, `gugur`, `builtin` |
| `POST /api/v1/missions` | buat misi (201). `scorer`: `sar`, `photo`, `agri`, `delivery`, `inspection`; `weights` memuat semua bobot scorer itu |
| `PUT /api/v1/missions/{mission_id}` | ubah judul, deskripsi, waktu acuan, varian, bobot, `gugur`. Berlaku untuk run berikutnya |
| `DELETE /api/v1/missions/{mission_id}` | hapus misi buatan sendiri beserta dunianya |

Misi bawaan: `m1_sar`, `m2_foto`, `m3_agri`, `m4_delivery`, `m5_inspeksi`. Misi bawaan yang sudah diubah tidak ditimpa saat gateway dinyalakan ulang.

## Dunia

Satu dunia = pasangan `mission_id` + `variant`; id-nya `<mission_id>__<variant>`. 16 dunia bawaan diekspor dari simulator (`node scripts/export_worlds.mjs`) dan hanya-baca.

| Jalur | Isi |
|---|---|
| `GET /api/v1/worlds?mission_id=` | daftar dunia |
| `GET /api/v1/worlds/{world_id}` | satu dunia: `seed`, `limits`, `config`, `builtin` |
| `POST /api/v1/worlds` | `{"mission_id", "variant", "seed", "limits": {"minX","maxX","minZ","maxZ"}, "config"}` (201) |
| `PUT /api/v1/worlds/{world_id}` | ubah `seed`, `limits`, `config` |
| `DELETE /api/v1/worlds/{world_id}` | hapus |

`config.mission` per scorer (lihat `backend/app/models/world.py`):

| Scorer | Kunci wajib |
|---|---|
| `sar` | `area{min,max}`, `victims[{id,x,z}]` |
| `photo` | `landmarks[{id,x,y,z}]`, `sun{az}`, `shots[{id,type,subject}]` (video: `minDur`, `maxDur`) |
| `agri` | `field{min,max,cell}`, `noSpray[]`, `dose{lo,hi,flow,capacity}` |
| `delivery` | `pickup{x,z,r}`, `drop{x,z,r}`, `noFly[]` |
| `inspection` | `structure{x,z,w,d,y0,y1}`, `panels[{id,x,y,z,nx,nz}]`, `defects[{id,x,y,z,size}]`, `safe{min,max}` |

## Run

### `POST /api/v1/runs`

```json
{"mission_id": "m4_delivery", "variant": "kota", "player": "nama"}
```

→ `{"api_version": "1", "run_id": "r_1", "seed": 42, "config": {...}}`. Varian yang tidak dikenal diganti varian pertama.

### `POST /api/v1/runs/{id}/events`

```json
{"t_ms": 12345, "type": "photo", "pose": {"pos": [0, 5, 0], "yaw": 0, "pitch": -10, "roll": 0},
 "visible": [{"label": "landmark", "id": "hotel", "dist": 20, "area": 0.2, "box": [0.3, 0.3, 0.4, 0.4]}],
 "speed": 0.1, "yaw_rate": 0}
```

→ `{"api_version": "1", "ok": true}`

| `type` | Field tambahan |
|---|---|
| `takeoff`, `pickup`, `drop`, `refill`, `collision`, `record_start`, `record_stop` | `pose` |
| `photo` | `pose`, `visible`, `speed`, `yaw_rate` |
| `mark` | `pose`, `visible` |
| `spray` | `pose`, `on` |
| `zone_enter`, `zone_exit` | `pose`, `kind` (`nofly`, `fire`, `checkpoint`) |
| `wind` | `wind{speed, dir, gust}`; angin run itu, dipakai skor M3 |

Entri yang tidak punya field wajib bagi scorer diabaikan saat penilaian.

### `WS /ws/v1/runs/{id}`

Klien mengirim 10 bingkai per detik (laju lain juga diterima):

```json
{"t_ms": 1200, "pos": [0, 5, 0], "vel": [1, 0, 0], "yaw": 90, "roll": 0, "pitch": 0,
 "gimbal": -10, "battery": 82, "payload_kg": 0, "spraying": false, "collision": false}
```

Wajib: `t_ms`, `pos`, `vel`, `yaw`. Bingkai rusak diabaikan. Server membalas:

- `{"type": "hint", "text": "Baterai rendah"}` sekali, saat baterai ≤ 20.
- `{"type": "ack", "t_ms": 1200}` untuk tiap bingkai, hanya bila dibuka dengan `?ack=1` (uji latensi).

Koneksi ditutup dengan kode 1008 bila run tidak ada atau asal ditolak.

### `POST /api/v1/runs/{id}/finish`

```json
{"t_ms": 91000, "battery": 41, "reason": "completed"}
```

`reason`: `completed`, `timeout`, `battery`, `crashed`, `drowned`, `out_of_area`. Server mengubah `completed` menjadi `timeout` (waktu > 2× acuan + 1 s) atau `out_of_area` (keluar batas peta lebih dari 1 m).

→ `{"api_version": "1", "score": 78, "grade": "silver", "breakdown": [{"name", "points", "max", "note"}], ...}` ditambah rincian misi (`details` M2, `report` M5, dan lainnya). Panggilan berikutnya mengembalikan hasil yang sama.

### Hasil, log, replay

| Jalur | Isi |
|---|---|
| `GET /api/v1/runs?limit=50` | run terbaru dengan status dan skor |
| `GET /api/v1/runs/{id}` | `state`, `reason`, `transitions`, `result`, `config`, `limits` |
| `GET /api/v1/runs/{id}/telemetry` | `{"log": [...]}`, urut `t_ms` (peristiwa sebelum sampel) |
| `GET /api/v1/runs/{id}/report` | laporan inspeksi M5: `defects`, `coverage`, `panels`, `wrong_marks` |
| `POST /api/v1/runs/{id}/replay` | hitung ulang dari log: `{"identical": true, "result": {...}}` |
| `GET /api/v1/leaderboard?mission_id=&variant=&limit=10` | `[{"rank", "player", "score"}]`, hanya run selesai |

Status mesin misi: `siap → lepas_landas → menjalankan → kembali → mendarat`, atau `gagal`.

## Penerusan ke layanan B dan C

| Jalur | Diteruskan ke | Isi |
|---|---|---|
| `POST /api/v1/plan` | planner `POST /plan` | `{"scenario", "world", "goal", "params"}` → `{"waypoints", "stats"}`; `scenario` = id misi |
| `POST /api/v1/detect` | detektor `POST /detect` | lihat di bawah |
| `POST /api/v1/command` | layanan AI `POST /command` | `{"text", "context"}`, batas 10 s |
| `POST /api/v1/decide` | layanan AI `POST /decide` | `{"obs": []}` |

Deteksi dari simulator: `{"image": "<jpeg base64 640x360>", "mode": "normal" | "thermal", "camera_pose": {"pos", "quat", "fov"} (opsional)}`.
Ke detektor: `{"frame_id", "image_b64", "camera_pose"}`; `camera_pose` bisa `null`, dan `mode` tidak diteruskan.
Dari detektor: `{"frame_id", "detections": [{"cls", "conf", "bbox": [x1,y1,x2,y2] piksel, "world_pos"}]}`.
Ke simulator: `{"objects": [{"label", "score", "box": [x,y,w,h] 0..1, "world_pos"}], "latency_ms", "model"}`.
