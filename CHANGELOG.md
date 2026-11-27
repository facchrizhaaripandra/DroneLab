# Changelog

## 0.2.0 (2026-11-28)

### Ditambahkan
- Backend Peran A di `backend/`: gateway FastAPI (REST dan WebSocket), mesin misi, lima scorer, penyimpanan SQLite, replay, CRUD misi dan dunia, penerusan ke planner dan detektor.
- Drone tiruan, uji latensi, ekspor skema, dan contract v0.2 (menunggu persetujuan B dan C).
- `scripts/export_worlds.mjs` dan `scripts/make_parity_cases.mjs`.
- `docs/api.md`, `backend/README.md`, Dockerfile, Docker Compose, dan alur GitHub Actions.

### Diubah
- Simulator mengirim peristiwa `wind` saat misi mulai; skor M3 memakai angin itu (`src/main.js`, `src/scoring.js`).
- Simulator menunggu peristiwa terkirim sebelum `finish` (`src/gateway.js`).
- `.gitignore` mencakup berkas Python, konfigurasi lokal, basis data, dan berkas sementara.

### Dihapus
- `_to_delete/`, `scripts/blender/_to_delete/`, dan folder `__pycache__`.

## 0.1.0

Simulator 3D (Fase 1 sampai Tahap 14), mock gateway Node. Lihat `README.md`.
