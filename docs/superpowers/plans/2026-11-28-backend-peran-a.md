# Backend DroneLab3D (Peran A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan gateway Python, mesin misi, lima scorer, penyimpanan, replay, drone tiruan, dan eksperimen latensi yang dipakai simulator DroneLab3D tanpa mengubah cara memainkannya.

**Architecture:** FastAPI di `backend/` memakai format simulator (`/api/v1`). Dunia dan katalog misi diekspor dari kode JS menjadi JSON; rumus skor ditulis ulang di Python dan dibandingkan dengan JS lewat kasus uji yang dibangkitkan dari JS. SQLite menyimpan log sehingga skor bisa dihitung ulang.

**Tech Stack:** Python 3.11, FastAPI, Uvicorn, Pydantic v2, SQLModel, httpx, websockets, pytest, pytest-asyncio, Ruff, matplotlib; Node 24 (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-28-backend-peran-a-design.md`

## Global Constraints

- **Tanpa git:** jangan commit, buat cabang, tag, `git rm`, atau push. Setiap tugas ditutup dengan tes hijau, bukan commit.
- Jalur `/api/v1/…`, WebSocket `/ws/v1/runs/{run_id}`, waktu `t_ms`, telemetri 10 Hz.
- ID misi: `m1_sar`, `m2_foto`, `m3_agri`, `m4_delivery`, `m5_inspeksi`. Scorer: `sar`, `photo`, `agri`, `delivery`, `inspection`.
- Galat selalu `{"error": {"code", "message"}}`. Jawaban berbentuk objek memuat `api_version: "1"`.
- Port: gateway 8000, planner 8001, detektor 8002, Vite 5173. `ALLOWED_ORIGINS` bawaan `http://localhost:5173,http://127.0.0.1:5173`.
- Batas klien 1,5 s untuk `/health`, `/runs`, `/finish`. Cek detektor maksimal 0,5 s.
- Skor deterministik: tanpa acak tanpa seed, tanpa waktu sistem. `seed` selalu 42.
- Komentar kode dalam bahasa Inggris, dokumen dalam bahasa Indonesia.
- Perintah Python dijalankan dari `backend/` dengan `.venv/Scripts/python`.
- Simulator hanya diubah di Task 4. File `ATURAN_A_INFRASTRUKTUR_BACKEND.md` tidak diubah.

## Review Focus

1. Bingkai telemetri rusak (bukan JSON, `pos` kurang, `NaN`, `vel` null) → diabaikan, koneksi tetap hidup, skor tidak galat. (Task 11)
2. `finish` tanpa data, dipanggil dua kali, atau untuk run tak dikenal → skor valid, hasil kedua identik, 404 `unknown_run`. (Task 11)
3. Peristiwa atau bingkai yang tiba setelah `finish` → ditolak, hasil tersimpan dan replay tidak berubah. (Task 11)
4. Gateway dimatikan di tengah run lalu dinyalakan lagi → run masih bisa diselesaikan dari basis data. (Task 11)
5. Detektor/planner menggantung → `/health` tetap < 1 s dan run tetap bisa dibuat. (Task 13)

---

### Task 1: Kebersihan folder dan `.gitignore`

**Files:** Delete: `_to_delete/`, `scripts/blender/_to_delete/`, semua `__pycache__/` di luar `node_modules`. Modify: `.gitignore`.

- [ ] **Step 1:** `git status --porcelain --ignored -- _to_delete scripts` → pastikan tidak ada berkas tak terlacak (`??`/`!!`) di folder yang akan dihapus. Jika ada, laporkan dulu.
- [ ] **Step 2:** `grep -rn "_to_delete" src tests scripts mock-server package.json` → hanya boleh muncul di dalam folder yang dihapus.
- [ ] **Step 3:** Hapus folder tersebut.
- [ ] **Step 4:** Tulis `.gitignore`: `node_modules`, `dist`, `__pycache__/`, `*.pyc`, `.venv/`, `.pytest_cache/`, `.ruff_cache/`, `.env`, `*.db`, `*.sqlite*`, `backend/data/`, `backend/results/`, `_to_delete/`, `*.blend1`, `*.log`, `Thumbs.db`, `.DS_Store`.
- [ ] **Step 5:** `git check-ignore -v backend/.env backend/data/x.db backend/.venv/a __pycache__/a.pyc` → empat baris. `git check-ignore backend/.env.example` → kosong. `npm test` → 173 lulus, 1 gagal (`python3`).

### Task 2: Alat dan kerangka backend

**Files:** Create: `backend/{requirements.txt,requirements-dev.txt,pyproject.toml,.env.example}`, `backend/app/{__init__,main,config,errors}.py`, `backend/app/api/{__init__,health}.py`, `backend/tests/{conftest,test_health}.py`

**Interfaces — Produces:**
- `Settings` (dataclass, `Settings.from_env()`): `db_path: str = "data/dronelab.db"`, `worlds_dir: str = "worlds"`, `allowed_origins: list[str]`, `planner_url = "http://localhost:8001"`, `detector_url = "http://localhost:8002"`, `ai_timeout_s = 2.0`, `llm_timeout_s = 10.0`, `health_timeout_s = 0.5`, `flush_interval_s = 1.0`, `ws_drain_s = 0.5`.
- `create_app(settings: Settings | None = None) -> FastAPI`; `app = create_app()` di `app/main.py`.
- `ApiError(status: int, code: str, message: str)`; handler untuk `ApiError`, `RequestValidationError` (400 `invalid_request`, JSON rusak 400 `bad_json`), 404 jalur (`not_found`).
- Fixture `settings(tmp_path)` dan `client(settings)` (`TestClient`).

- [ ] **Step 1:** `py -3.11 -m venv .venv`; pasang `requirements-dev.txt` (fastapi, `uvicorn[standard]`, pydantic, httpx, websockets, sqlmodel, matplotlib; dev: pytest, pytest-asyncio, ruff). Setelah terpasang, kunci versi mayor-minor di berkas requirements (`~=`).
- [ ] **Step 2:** Pasang ekstensi: `code --install-extension charliermarsh.ruff`, `ms-azuretools.vscode-docker`, `humao.rest-client`.
- [ ] **Step 3:** `winget install --id Bruno.Bruno --exact --accept-package-agreements --accept-source-agreements`.
- [ ] **Step 4:** Tulis tes:
```python
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "api_version": "1", "ai": "down"}

def test_unknown_path_uses_error_format(client):
    r = client.get("/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"

def test_cors_preflight_allows_simulator(client):
    r = client.options("/api/v1/runs", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
```
- [ ] **Step 5:** `.venv/Scripts/python -m pytest -q` → gagal (modul belum ada).
- [ ] **Step 6:** Implementasikan. `ai` masih tetap `"down"` (diisi Task 13). `pyproject.toml`: pytest `pythonpath=["."]`, `asyncio_mode="auto"`; ruff `line-length=100`, `target-version="py311"`.
- [ ] **Step 7:** `pytest -q` dan `ruff check .` → hijau.

### Task 3: Ekspor dunia dan katalog misi

**Files:** Create: `scripts/export_worlds.mjs`, `backend/worlds/missions.json`, `backend/worlds/<mission_id>__<variant>.json` (16), `tests/export.test.js`

**Interfaces — Produces:**
- `export function buildExport(): { missions: Mission[], worlds: World[] }`; dijalankan langsung (`node scripts/export_worlds.mjs`) menulis berkas. Deteksi "dijalankan langsung" memakai `pathToFileURL(process.argv[1]).href` (harus jalan di Windows).
- `Mission = {id, title, desc, scorer, par_time_s, variants, weights, gugur}` — hanya `tier === 'utama'`.
- `World = {mission_id, variant, seed: 42, limits: {minX,maxX,minZ,maxZ}, config}`; `config = makeRunConfig(id, 42, variant)`. `limits`: dari `public/scenes/<config.scene>/scene.json` `bounds`, selain itu ±`config.bounds`.

- [ ] **Step 1:** Tulis tes: `buildExport()` menghasilkan 5 misi dan 16 dunia; tiap berkas di `backend/worlds/` sama (`deepEqual`) dengan hasil `buildExport()`; dunia `m4_delivery`/`kota` memiliki `limits.minX === -341`.
- [ ] **Step 2:** `node --test tests/export.test.js` → gagal.
- [ ] **Step 3:** Implementasikan, jalankan skripnya.
- [ ] **Step 4:** `node --test tests/export.test.js` → lulus.

### Task 4: Dua perubahan simulator

**Files:** Modify: `src/main.js` (setelah `new MissionRun`, ~baris 404), `src/scoring.js` (`replayAgri`), `src/gateway.js` (`event`, `finish`). Test: `tests/gateway-sync.test.js`

**Interfaces — Produces:** peristiwa `{t_ms: 0, type: 'wind', wind: {speed, dir, gust?}}`.

- [ ] **Step 1:** Tulis tes:
  - `replayAgri(config, log)` dengan peristiwa `wind` berbeda dari `config.wind` memberi dosis sama dengan menjalankan tanpa peristiwa pada config ber-angin tersebut; tanpa peristiwa, memakai `config.wind`.
  - `createGateway` dengan `fetchImpl` yang menunda `/events` 50 ms: urutan penyelesaian di "server" adalah `events` lalu `finish`.
- [ ] **Step 2:** Jalankan → gagal.
- [ ] **Step 3:** `replayAgri`: `const wind = log.find((e) => e.type === 'wind')?.wind ?? config.wind`. `gateway.js`: simpan promise `event` dalam `Set`, `finish` menunggu `Promise.allSettled` sebelum POST. `main.js`: `if (runId && config.wind) gateway.event(runId, { t_ms: 0, type: 'wind', wind: config.wind });`
- [ ] **Step 4:** `npm test` → semua lulus kecuali tes `python3` yang sudah gagal sebelumnya.

### Task 5: Inti scoring, scorer M4, kasus pembanding

**Files:** Create: `scripts/make_parity_cases.mjs`, `backend/tests/parity/<mission_id>.json`, `backend/app/scoring/{__init__,base,jsmath,m4_delivery}.py`, `backend/tests/scoring/{helpers,test_jsmath,test_m4_hand,test_parity}.py`. Modify: `tests/export.test.js`.

**Interfaces — Produces:**
- JS: `export function buildCases(): Record<missionId, {name, config, log, finish, expected}[]>` — minimal 20 kasus per misi, PRNG berseed, mencakup 16 dunia ekspor, semua `reason`, peristiwa `wind` untuk M3; pada `t_ms` sama, peristiwa ditulis sebelum sampel. `expected = scoreFromEvents(...)`.
- `jsmath`: `js_round(x: float) -> int` (setengah ke atas), `round1(x: float) -> float`, `clamp01(x: float) -> float`, `js_fixed(x: float, digits: int) -> str` (`Decimal`, `ROUND_HALF_UP`), `js_num(x: float) -> str` (`180.0` → `"180"`), `f32(x: float) -> float` (`struct`).
- `base`: `ScoringContext(config, log, finish, par_time_s, weights, gugur)` dengan `w(key) -> float`, `add(key, name, factor, note)`, `comp: list[dict]`; `class Scorer(ABC)`: `key: ClassVar[str]`, `score(ctx) -> dict` (rincian tambahan), `objectives_met(config, log) -> bool`; `register(cls)`; `SCORERS: dict[str, Scorer]`; `sort_log(log) -> list[dict]` (kunci `(t_ms, type == "sample")`, stabil); `time_factor(t_ms, par_s) -> float`; `zone_ms(log, kind, fin_ms) -> float`; `score_run(mission: dict, config: dict, log: list[dict], finish: dict) -> dict` → `{score, grade, breakdown, **extra}`.
- `tests/scoring/helpers.py`: `mission(mission_id) -> dict` (dari `worlds/missions.json`), `event(t_ms, type, pos=(0,0,0), **extra)`, `sample(t_ms, pos, vel=(0,0,0), **extra)`.

- [ ] **Step 1:** Tes `jsmath`: `js_round(2.5) == 3`, `js_round(-2.5) == -2`, `js_fixed(0.25, 1) == "0.3"`, `js_num(180.0) == "180"`, `f32(0.1) != 0.1`.
- [ ] **Step 2:** `test_m4_hand.py`, 10 kasus (bobot 30/20/20/15/15, acuan 180 s; dasar: antar ≤1 m, 100 s, baterai 80, tanpa tabrakan), perhitungan ditulis di komentar:

| Kasus | Skor |
|---|---|
| dasar | 100 (gold) |
| jatuh 4,5 m | 85 |
| jatuh 8 m | 70 |
| 270 s | 90 |
| 360 s | 80 |
| baterai 30 | 93 |
| 1 tabrakan | 93 |
| 3 tabrakan | 80 |
| 2,5 s di zona terlarang | 93 |
| tanpa antar, baterai 60, `reason="battery"` | 25 (none) |

- [ ] **Step 3:** `test_parity.py`: parametrisasi atas semua kasus di `tests/parity/`; `score_run` harus sama dengan `expected` (angka lain toleransi `1e-9`, teks persis). Misi yang scorer-nya belum ada di-`skip`; Task 9 menghapus skip.
- [ ] **Step 4:** Jalankan → gagal. Implementasikan `make_parity_cases.mjs`, `jsmath`, `base`, `DeliveryScorer` (`objectives_met`: ada peristiwa `drop`) mengikuti `src/scoring.js`.
- [ ] **Step 5:** Tambah ke `tests/export.test.js`: berkas parity sama dengan `buildCases()`.
- [ ] **Step 6:** `pytest tests/scoring -q`, `node --test tests/export.test.js` → hijau.

### Task 6: Kamera dan scorer M1

**Files:** Create: `backend/app/scoring/{camera,m1_sar}.py`, `backend/tests/scoring/{test_camera,test_m1_hand}.py`

**Interfaces — Produces:** `camera.project(pose: dict, obj: dict) -> dict | None` (`dist, box, area, full, center`), `in_frame(p) -> bool`, `bearing(ax, az, bx, bz) -> float`, `ang_diff(a, b) -> float`; `SarScorer` (`key="sar"`), `marked_victim(config, event) -> dict | None`. Modulo memakai `math.fmod` (perilaku `%` JavaScript).

- [ ] **Step 1:** `test_camera.py`: objek 10 m di depan (`yaw=0`, `pos` nol, objek `z=-10`) berpusat `(0.5, 0.5)`; di belakang → `None`; `ang_diff(10, 350) == 20`; `bearing(0,0,0,-1) == 0`, `bearing(0,0,1,0) == 90`.
- [ ] **Step 2:** `test_m1_hand.py` (area −20..20 = 16 sel, 2 korban, acuan 300 s; dasar: 2 korban ditandai, 2 tanda, 200 s, 16 sel, aman):

| Kasus | Skor |
|---|---|
| dasar | 100 |
| 1 dari 2 korban, 1 tanda | 70 |
| tanpa tanda | 30 |
| dasar + 1 tanda salah | 97 |
| 8 sel | 93 |
| 2 tabrakan | 94 |
| 10 s zona api | 97 |
| 450 s | 90 |
| semua sampel di bawah 0,5 m | 85 |
| dasar, `reason="crashed"` | 83 |

- [ ] **Step 3:** Jalankan → gagal; implementasikan (`objectives_met`: semua korban ditandai).
- [ ] **Step 4:** `pytest tests/scoring -q` → hijau, kasus parity M1 ikut jalan.

### Task 7: Model semprot dan scorer M3

**Files:** Create: `backend/app/scoring/{agri,m3_agri}.py`, `backend/tests/scoring/test_m3_hand.py`

**Interfaces — Produces:** `Agri(mission: dict)` dengan `refill()`, `spray_step(sample: dict, wind: dict | None)`, `summary() -> dict`; `replay_agri(config, log) -> Agri` (angin: peristiwa `wind`, selain itu `config["wind"]`); `AgriScorer` (`key="agri"`). Dosis per sel disimpan lewat `f32`.

- [ ] **Step 1:** `test_m3_hand.py`. Dunia: lahan `[0,0]..[4,2]`, sel 2, tanpa area terlarang, dosis `lo .4, hi 1.2, flow 10, capacity 200`, tanpa angin; sampel diam di `(2,5,1)` tiap 100 ms; `k` = jumlah selang semprot (`k+1` sampel). Tiap selang: 1 satuan dibagi 6 sel, 2 di dalam lahan. Dasar `k=18`, baterai 40, `t_ms=1800`:

| Kasus | Skor |
|---|---|
| dasar | 87 |
| tanpa sampel | 0 |
| `k=5` (kurang) | 27 |
| `k=36` (berlebih) | 25 |
| baterai 20 | 82 |
| selesai 450 s | 82 |
| kecepatan 5 m/s | 77 |
| `reason="timeout"` | 72 |
| sel x 2..4 terlarang | 83 |
| kapasitas 10 (tangki habis) | 82 |

- [ ] **Step 2:** Jalankan → gagal; implementasikan (`objectives_met`: cakupan ≥ 0,9).
- [ ] **Step 3:** `pytest tests/scoring -q` → hijau.

### Task 8: Scorer M2

**Files:** Create: `backend/app/scoring/m2_photo.py`, `backend/tests/scoring/test_m2_hand.py`

**Interfaces — Consumes:** `camera.*`. **Produces:** `PhotoScorer` (`key="photo"`), `photo_factors(photo, shot, config, prev) -> dict`, `video_factors(clip, shot, config, collisions) -> dict`; extra `details`.

- [ ] **Step 1:** `test_m2_hand.py`. Satu bidikan foto (`areaRange [.1,.6]`), matahari `az 0`; dasar: kotak berpusat di titik sepertiga luas .16, roll 0, diam, `yaw 180`:

| Kasus | Skor |
|---|---|
| dasar | 100 |
| subjek tidak terlihat | 50 |
| luas .05 | 85 |
| luas .8 | 85 |
| roll 9° | 95 |
| 1,75 m/s | 93 |
| laju putar 35°/s | 93 |
| `yaw 0` (melawan matahari) | 90 |
| subjek di tengah bingkai | 90 |
| tanpa foto sama sekali | 0 |

Tambahan: bidikan video tanpa klip → 0; dua foto dari arah sama untuk dua bidikan → `variation` foto kedua 0.
- [ ] **Step 2:** Jalankan → gagal; implementasikan (`objectives_met`: jumlah `photo` ≥ bidikan foto dan `record_stop` ≥ bidikan video).
- [ ] **Step 3:** `pytest tests/scoring -q` → hijau.

### Task 9: Scorer M5 dan laporan inspeksi

**Files:** Create: `backend/app/scoring/m5_inspection.py`, `backend/tests/scoring/test_m5_hand.py`. Modify: `backend/tests/scoring/test_parity.py` (hapus skip).

**Interfaces — Produces:** `InspectionScorer` (`key="inspection"`), `inspection_state(config, log) -> dict`, `inspection_report(config, log) -> dict` (bentuk sama dengan `inspectionReport` JS).

- [ ] **Step 1:** `test_m5_hand.py`. Struktur `{x:0, z:-20, w:10, d:10, y0:0, y1:10}`, 2 panel muka selatan `(±2,5,-14.9)`, 2 cacat, aman 3..8; foto dari `(0,5,-9.9)` yaw 0 pitch 0 dengan `visible` cacat `dist 5, area .003`; sampel aman `z=-10`, tidak aman `z=-13`:

| Kasus | Skor |
|---|---|
| dasar (semua foto, tanda, aman) | 100 |
| tanpa peristiwa dan sampel | 0 |
| 4 panel, 2 di muka utara tak terfoto | 85 |
| 1 dari 2 cacat | 78 |
| 1 tanda salah | 97 |
| foto tanpa tanda | 65 |
| setengah sampel aman | 93 |
| foto pada 1,75 m/s | 98 |
| luas cacat .0015 | 98 |
| `reason="battery"` | 85 |

- [ ] **Step 2:** Jalankan → gagal; implementasikan (`objectives_met`: semua panel terfoto dan semua cacat difoto serta ditandai).
- [ ] **Step 3:** `pytest tests/scoring -q` → hijau tanpa satu pun `skip`.

### Task 10: Mesin misi

**Files:** Create: `backend/app/mission/{__init__,engine}.py`, `backend/tests/test_engine.py`

**Interfaces — Consumes:** `SCORERS[key].objectives_met`. **Produces:** `MissionEngine(scorer_key: str, par_time_s: float, config: dict, limits: dict)`: `state: str`, `reason: str | None`, `transitions: list[dict{t_ms, state}]`, `feed(entry: dict) -> None`, `finish(finish: dict) -> str` (alasan akhir). `run_engine(...argumen sama, log, finish) -> MissionEngine`. Status: `siap, lepas_landas, menjalankan, kembali, mendarat, gagal`. `objectives_met` hanya dievaluasi pada peristiwa dan saat `finish`.

- [ ] **Step 1:** Tes: jalur M4 penuh `siap → lepas_landas → menjalankan → kembali → mendarat`; "Akhiri" dari `menjalankan` → `mendarat`; tiap `reason` gagal → `gagal`; `completed` dengan `t_ms = 2*par*1000 + 1001` → `timeout`, `+1000` tetap `completed`; sampel `x = maxX + 1.01` → `out_of_area`, `+1` tidak; tabrakan saja tidak menggagalkan; `feed` setelah status akhir tidak mengubah apa pun; titik awal `menjalankan` = sampel pertama ≥ 2 m di atas sampel pertama.
- [ ] **Step 2:** Jalankan → gagal; implementasikan.
- [ ] **Step 3:** `pytest tests/test_engine.py -q` → hijau.

### Task 11: Penyimpanan dan gateway untuk simulator

**Files:** Create: `backend/app/models/{__init__,contract}.py`, `backend/app/db/{__init__,tables,repo}.py`, `backend/app/{telemetry,service}.py`, `backend/app/api/{missions,runs,leaderboard,ws}.py`, `backend/tests/{test_repo,test_gateway,test_ws,test_robust}.py`. Modify: `app/main.py`.

**Interfaces — Produces:**
- Pydantic: `RunCreate(mission_id, variant: str | None, player = "anon" (1..40))`, `RunCreated`, `Event(t_ms >= 0, type, extra="allow")`, `TelemetryFrame(t_ms >= 0, pos[3], vel[3], yaw, roll=0, pitch=0, gimbal=-10, battery=100, payload_kg=0, spraying=False, collision=False; allow_inf_nan=False)`, `Finish(t_ms >= 0, battery 0..100, reason ∈ completed|timeout|battery|crashed|drowned|out_of_area, progress: float | None)`, `ScoreResult(extra="allow")`, `LeaderboardRow(rank, player, score)`, `MissionSummary(id, title, variants, par_time_s)`.
- `Repo(db_path)`: `seed_builtins(worlds_dir)`, `list_missions()`, `get_mission(id)`, `get_world(mission_id, variant)`, `create_run(mission_id, variant, player, seed, config, limits) -> str` (`r_<n>`), `get_run(id)`, `list_runs(limit)`, `add_entries(run_id, entries)`, `get_log(run_id)` (urutan tiba), `save_result(run_id, finish, result)`, `leaderboard(mission_id, variant, limit)`.
- `TelemetryHub(repo, flush_interval_s)`: `ingest(run_id, frame)`, `flush(run_id)`, `flush_all()` (saat aplikasi berhenti), `opened(run_id)`, `closed(run_id)`, `async wait_closed(run_id, timeout)`.
- `RunService`: `start(body) -> dict`, `add_event(run_id, event)`, `async finish(run_id, body) -> dict`, `report(run_id) -> dict`.

- [ ] **Step 1:** Tes (`test_gateway.py`): daftar misi 5 butir dengan varian M5 `["gedung","jembatan","gedung-acak","jembatan-acak"]`; `POST /runs` 16 varian → `config` sama dengan berkas dunia, `seed 42`; varian tak dikenal → varian pertama; misi tak dikenal → 404 `unknown_mission`; M4 penuh lewat HTTP → skor ≥ 85 dan 5 komponen; `report` M5 → daftar cacat, M4 → 404 `no_report`; leaderboard urut turun, bisa difilter `mission_id`/`variant`/`limit`, run belum selesai tidak muncul.
- [ ] **Step 2:** `test_ws.py`: telemetri M3 lewat WebSocket menaikkan Cakupan > 0; baterai 20 memicu tepat satu `{"type":"hint","text":"Baterai rendah"}`; `?ack=1` membalas `{"type":"ack","t_ms":…}` per bingkai, tanpa itu tidak; run tak dikenal ditolak; `Origin` asing ditutup 1008, tanpa `Origin` diterima.
- [ ] **Step 3:** `test_robust.py` (Review Focus 1–4):
  - kirim `"bukan json"`, `{"t_ms":1}`, `pos` 2 elemen, `NaN`, `vel: null`, lalu bingkai sah → koneksi hidup, hanya bingkai sah tersimpan, `finish` 200;
  - `finish` run kosong → 200 skor 0..100; panggilan kedua (isi berbeda) → jawaban identik; run tak dikenal → 404;
  - peristiwa setelah `finish` → 409 `run_finished`, log tidak bertambah; bingkai setelah `finish` diabaikan;
  - buat run + peristiwa, buat aplikasi baru pada `db_path` sama, `finish` → skor sama dengan tanpa restart.
- [ ] **Step 4:** Jalankan → gagal; implementasikan. Urutan `finish`: bila sudah ada hasil, kembalikan; `wait_closed(ws_drain_s)`; `flush`; `run_engine`; `score_run` dengan alasan dari engine; simpan hasil beserta transisi status.
- [ ] **Step 5:** `pytest -q`, `ruff check .` → hijau.

### Task 12: Hasil, replay, CRUD dunia dan misi

**Files:** Create: `backend/app/replay.py`, `backend/app/api/worlds.py`, `backend/tools/replay.py`, `backend/tests/{test_results,test_crud}.py`. Modify: `app/api/{runs,missions}.py`, `app/db/repo.py`.

**Interfaces — Produces:** `replay_run(repo, run_id) -> {"result": dict, "identical": bool}`; jalur tambahan pada spec §6. Dunia: `{id, mission_id, variant, seed, limits, config, builtin}`.

- [ ] **Step 1:** Tes: `GET /runs/{id}` memuat `state, reason, transitions, result`; `GET …/telemetry` mengembalikan log; replay 10× untuk tiap dari 5 misi (log dari `tests/parity`) → semua jawaban identik dan `identical: true`; replay run belum selesai → 409 `run_not_finished`; dunia bawaan `PUT`/`DELETE` → 403 `read_only`; buat dunia `m4_delivery`/`uji` lalu `POST /runs` varian itu mendapat config tersebut; pasangan ganda → 409 `conflict`; config tanpa kunci `mission` → 400; misi baru dengan `scorer` tak dikenal → 400; hapus misi bawaan → 403; ubah bobot misi bawaan dipakai oleh run berikutnya dan replay run lama tetap identik (definisi misi disalin ke run saat `finish`).
- [ ] **Step 2:** Jalankan → gagal; implementasikan. `tools/replay.py --db PATH --run-id ID --times 10` mencetak hasil dan keluar 1 bila tidak identik.
- [ ] **Step 3:** `pytest -q` → hijau.

### Task 13: Planner dan detektor

**Files:** Create: `backend/app/clients/{__init__,planner,detector}.py`, `backend/app/api/ai.py`, `backend/tests/test_ai.py`. Modify: `app/api/health.py`, `app/main.py`, `app/models/contract.py`.

**Interfaces — Produces:** `DetectorClient(base_url, settings, transport=None)`: `healthy() -> bool`, `detect(image, camera_pose) -> dict`, `command(body)`, `decide(body)`; `PlannerClient.plan(body) -> dict`; `create_app(settings, ai_transport=None, planner_transport=None)`. `PlanRequest(scenario, world, goal, params)`; `Waypoint(id, x, y, z, speed, action ∈ fly|spray|drop|capture|hover, params)`; `PlanResponse(waypoints, stats(length_m, est_time_s, est_energy, coverage_pct, compute_ms))`; `DetectRequest(image, mode="normal", camera_pose: CameraPose | None)`.

- [ ] **Step 1:** Tes dengan `httpx.MockTransport`: detektor sehat → `health.ai == "ok"`; `/detect` mengirim `{frame_id, image_b64, camera_pose}` dan menerjemahkan `bbox [64,36,128,108]` (gambar 640×360) menjadi `box [0.1,0.1,0.1,0.2]`; `command`/`decide` diteruskan apa adanya; mati atau 500 → 503 `ai_down`; planner sah diteruskan, jawaban tak sesuai skema → 502 `planner_bad_response`, mati → 503 `planner_down`.
- [ ] **Step 2:** Review Focus 5: transport yang tidur 5 s → `/health` selesai < 1 s dengan `ai: "down"`, `POST /runs` tetap < 1 s.
- [ ] **Step 3:** Jalankan → gagal; implementasikan (batas total memakai `asyncio.wait_for`). Path ke C: `GET /health`, `POST /detect`, `/command`, `/decide`; ke B: `POST /plan`.
- [ ] **Step 4:** `pytest -q` → hijau.

### Task 14: Drone tiruan

**Files:** Create: `backend/tools/{__init__,mock_drone}.py`, `backend/tests/test_mock_drone.py`

**Interfaces — Produces:** `async fly_mission(base_url: str, mission_id: str, variant: str | None = None, hz: int = 10, realtime: bool = False, player: str = "mock") -> {"run_id", "result", "state", "reason"}`; CLI `python tools/mock_drone.py --mission all|<id> [--url] [--hz] [--drones N] [--realtime]`. Rute dibuat dari `config` yang diterima; `visible` dihitung dengan `camera.project`; M3 mengirim peristiwa `wind`.

- [ ] **Step 1:** Tes dengan server Uvicorn nyata di port acak: untuk kelima misi `state == "mendarat"`, `reason == "completed"`, skor ≥ 50; replay tiap run identik.
- [ ] **Step 2:** Jalankan → gagal; implementasikan (rute lurus, 8 m/s, dalam `limits`).
- [ ] **Step 3:** `pytest tests/test_mock_drone.py -q` → hijau.

### Task 15: Eksperimen latensi

**Files:** Create: `backend/tools/latency.py`, `backend/tests/test_latency.py`

**Interfaces — Produces:** `percentile(values: list[float], p: float) -> float` (interpolasi linear); `async measure(base_url, drones: int, hz: int, duration_s: float) -> {"drones","hz","frames","lost","p50_ms","p95_ms"}`; CLI `--drones 1 5 10 20 --hz 10 --duration 30 --out results` menulis `latency.csv`, `latency.md`, `latency.png`.

- [ ] **Step 1:** Tes: `percentile([1,2,3,4], 50) == 2.5`; `measure(…, 2, 10, 1.0)` → `frames >= 18`, `lost == 0`, `0 < p50_ms <= p95_ms`.
- [ ] **Step 2:** Jalankan → gagal; implementasikan.
- [ ] **Step 3:** Tes hijau; jalankan eksperimen penuh pada gateway nyata untuk 10 Hz dan 20 Hz, simpan di `backend/results/`.

### Task 16: Dokumen, Docker, CI

**Files:** Create: `backend/{README.md,Dockerfile,docker-compose.yml,.dockerignore}`, `backend/contracts/{contract-v0.2.md,VERSION,schemas/*.json}`, `backend/tools/export_schemas.py`, `backend/tests/{test_docs,test_contracts}.py`, `docs/api.md`, `CHANGELOG.md`, `.github/workflows/ci.yml`. Modify: `README.md` (bagian "Backend", maksimal 15 baris).

- [ ] **Step 1:** Tes: tiap jalur di `app.openapi()` (dan jalur WebSocket) disebut di `docs/api.md`; berkas di `contracts/schemas/` sama dengan hasil `export_schemas.build() -> dict[str, dict]` (Waypoint, TelemetryFrame, Event, Finish, PlanRequest, PlanResponse, DetectRequest, World, Mission); `VERSION` berisi `0.2`.
- [ ] **Step 2:** Jalankan → gagal; tulis dokumen. `contract-v0.2.md` memuat tabel perbedaan v0.1 → v0.2 untuk butir 1–9 dan status "menunggu persetujuan B dan C". `backend/README.md`: jalan dalam ≤ 5 perintah PowerShell, cara memasang WSL2 + Docker Desktop (dilakukan pengguna), cara menjalankan drone tiruan dan eksperimen.
- [ ] **Step 3:** `Dockerfile` (`python:3.11-slim`, uvicorn port 8000, volume `data/`), compose satu layanan `gateway`; `ci.yml`: job `backend` (ruff check, ruff format --check, pytest) dan `simulator` (Node 24, `npm ci`, `npm test`).
- [ ] **Step 4:** `pytest -q`, `ruff check .`, `ruff format --check .` → hijau.

### Task 17: Verifikasi akhir

- [ ] **Step 1:** `ruff check .`, `ruff format --check .`, `pytest -q` → hijau; catat jumlah tes.
- [ ] **Step 2:** `npm test` → hanya kegagalan `python3` yang lama.
- [ ] **Step 3:** Jalankan gateway (`.venv/Scripts/python -m uvicorn app.main:app --port 8000`) dan `tools/mock_drone.py --mission all` → lima hasil `mendarat`.
- [ ] **Step 4:** Jalankan simulator di browser pane (`.claude/launch.json`), pastikan HUD "Tersambung", mulai M4 dan M3, "Akhiri dan lihat skor" → skor bertanda resmi; run tampak di `GET /api/v1/runs`; konsol tanpa galat CORS.
- [ ] **Step 5:** Cocokkan tiap butir spec §13 dan laporkan yang belum terbukti (Docker dan CI).
