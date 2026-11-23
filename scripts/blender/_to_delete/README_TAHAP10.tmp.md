
## Tahap 10: drone 3D dan peta realistis dari Blender

Yang ditambahkan:
- **Model drone Blender** (`public/models/drone.glb`, 268 KB, 5.900 segitiga) menggantikan model kotak. `drone.js` memuatnya di latar belakang; model kotak tampil sampai GLB siap dan tetap dipakai jika GLB gagal dimuat (peringatan di konsol). Baling-baling `drone_propeller_FL/FR/RL/RR` berputar sesuai arah `spin_dir` (CW/CCW), kerusakan memendekkan/menyembunyikan baling dan menggelapkan bodi, gimbal kamera model ikut sudut `look()`. Skala `DRONE_SCALE = 1.8` (model asli 45 cm) supaya cocok dengan bola tabrakan 0,5 m.
- **Menu "Peta realistis"** (menu utama): 9 lingkungan dari Blender, dimainkan dalam mode freeroam: S0 lapangan latihan, S1 gedung terbakar, S2 hutan terbakar, S3 resor hotel, S4 gunung dan danau, S5 sawah, S6 kota, S7 gedung inspeksi, S7b jembatan. File di `public/scenes/<id>/scene.glb` (tekstur WebP, instancing GPU untuk pohon) dan `scene.json`. Daftar di `public/scenes/index.json`.
- **`scene.json`** (dibuat `scripts/blender/export_scene.py`): titik spawn digeser ke (0, 0, 0), batas peta, peta ketinggian tanah (sel 2 m, S4 sel 4 m) dan kotak tabrakan AABB (387 sampai 6.743 per scene). Struktur bangunan disimpan per bagian sehingga jendela besar, pintu, dan atrium tetap bisa dilewati drone. Pohon = kotak batang + kotak tajuk. Kotak lebih tipis dari 0,3 m diabaikan.
- **Fisika tanah tidak datar** (`flight.js`, `terrain.js`): `Flight.ground` (fungsi tinggi tanah) dan `Flight.limits` (batas peta + plafon 60 m di atas tanah setempat). Tanpa keduanya perilaku lama tidak berubah (tanah y = 0, ±100 m, plafon 50 m). Lepas landas dan mendarat mengikuti tinggi tanah setempat; menabrak lereng di atas 2 m/s dihitung tabrakan. Kamera ikut tidak masuk ke dalam bukit.
- Uji baru `tests/terrain.test.js` (sampler bilinear, filter kotak, mendarat di lereng, batas dan plafon, dunia datar tidak berubah). Total 131 tes lolos.

Mengekspor ulang scene setelah mengubahnya di Blender: buka file `.blend`, lalu di konsol Python Blender:

```text
exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\export_scene.py").read())
process("s1_gedung_terbakar", "Gedung perkantoran terbakar", (-5.0, -31.0))   # id, judul, titik spawn (x, y Blender)
```

Batas yang diketahui:
- Peta realistis hanya untuk freeroam. Misi M1 sampai M5 masih memakai dunia prosedural, karena korban, zona api, cacat, dan titik paket belum dipetakan ke scene Blender.
- `alt` di telemetri tetap tinggi terhadap pad awal (bukan terhadap tanah setempat). Return home terbang di 34 m di atas pad, jadi di S4 bisa tertahan lereng gunung.
- Ukuran total `public/scenes` sekitar 112 MB. Untuk repo Git sebaiknya memakai Git LFS untuk `*.glb`.
- Tampilan di browser belum saya lihat sendiri; pencahayaan PBR memakai lampu dunia yang sama dengan dunia prosedural.
