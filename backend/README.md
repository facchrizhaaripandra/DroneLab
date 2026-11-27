# Backend DroneLab3D (Peran A)

Gateway REST dan WebSocket, mesin misi, lima scorer, penyimpanan SQLite, replay, drone tiruan, dan uji latensi. Daftar jalur: [`../docs/api.md`](../docs/api.md). Swagger: `http://localhost:8000/docs`.

## Menjalankan

Dari folder `dronelab`, dengan Python 3.11:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Lalu jalankan simulator di terminal lain (`npm run dev` dari folder `dronelab`). HUD menampilkan **Tersambung** bila gateway hidup. Jangan jalankan `npm run mock` bersamaan: keduanya memakai port 8000.

Pengaturan opsional: salin `.env.example` menjadi `.env`, lalu tambahkan `--env-file .env` pada perintah `uvicorn`.

## Tes dan lint

```powershell
.\.venv\Scripts\python -m pytest -q
```

```powershell
.\.venv\Scripts\python -m ruff check .
```

```powershell
.\.venv\Scripts\python -m ruff format --check .
```

## Drone tiruan, replay, latensi

Gateway harus sedang berjalan untuk drone tiruan dan uji latensi.

```powershell
.\.venv\Scripts\python tools\mock_drone.py --mission all
```

```powershell
.\.venv\Scripts\python tools\replay.py --run-id r_1 --times 10
```

Untuk eksperimen latensi, pakai gateway terpisah supaya basis data utama tidak terisi run uji:

```powershell
$env:DB_PATH = "data/latency.db"; .\.venv\Scripts\python -m uvicorn app.main:app --port 8010
```

```powershell
.\.venv\Scripts\python tools\latency.py --url http://127.0.0.1:8010 --drones 1 5 10 20 --hz 10 20 --duration 30 --out results
```

Hasil: `results/latency.csv`, `latency.md`, `latency.png`. Folder `results/` dan `data/` diabaikan git; salin hasil yang mau disimpan. Tutup `$env:DB_PATH` (`Remove-Item Env:DB_PATH`) setelah selesai.

## Setelah simulator berubah

Jalankan dari folder `dronelab` bila titik misi, bobot, rumus skor, atau batas peta diubah:

```powershell
node scripts/export_worlds.mjs
```

```powershell
node scripts/make_parity_cases.mjs
```

Rumus skor ada di dua tempat: `src/scoring.js` (simulator) dan `app/scoring/` (backend). Ubah keduanya, lalu pastikan `pytest tests/scoring` dan `npm test` hijau. Bila model kontrak berubah, jalankan `tools\export_schemas.py`.

## Docker

WSL2 dan Docker Desktop dipasang sendiri karena perlu hak admin, persetujuan lisensi, dan restart. Di PowerShell **sebagai Administrator**:

```powershell
wsl --install
```

Restart komputer, lalu:

```powershell
winget install --id Docker.DockerDesktop --exact
```

Buka Docker Desktop sekali, kemudian dari folder `backend`:

```powershell
docker compose up --build
```

Gateway tersedia di `http://localhost:8000` (hanya dari komputer ini). Data disimpan di volume `gateway-data`.

## Susunan kode

```text
app/
  main.py, config.py, errors.py, service.py, telemetry.py, replay.py
  api/        health, missions, worlds, runs, leaderboard, ai, ws
  models/     Pydantic: kontrak, misi, dunia
  mission/    mesin misi (state machine)
  scoring/    satu antarmuka Scorer, lima scorer, model kamera dan semprot
  clients/    planner (B) dan detektor (C)
  db/         tabel SQLite
worlds/       diekspor dari simulator, jangan diubah manual
contracts/    contract v0.2 dan skema JSON
tools/        drone tiruan, replay, latensi, ekspor skema
tests/        termasuk kasus hitung tangan dan pembanding dengan JavaScript
```
