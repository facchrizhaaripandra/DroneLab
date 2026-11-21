# DroneLab3D (Fase 1 sampai 3)

Simulator drone 3D berbasis web (Three.js + Vite). Fase 1: dunia, drone, kamera, loop fisika 1/60 s dengan FPS terukur. Fase 2: input terpadu keyboard + controller dan HUD tetap. Fase 3: menu utama, misi, freeroam.

## Menjalankan

```text
npm install
npm run dev      # buka alamat yang tampil (biasanya http://localhost:5173), Chrome terbaru
npm test         # uji fisika dan konfigurasi dunia (Node, tanpa browser)
```

## Kontrol

| Aksi | Keyboard | Controller (Mode 2) |
| --- | --- | --- |
| Gerak maju / mundur / kiri / kanan | W / S / A / D | Stick kanan |
| Naik / turun | Spasi / C | Stick kiri atas / bawah |
| Putar kiri / kanan | Q / E | Stick kiri kiri / kanan |
| Takeoff / Land (tahan 0,6 detik) | X | A |
| Return home (autopilot) | H | B |

Aksi lain sudah terpasang di input tetapi belum ada sistemnya, jadi hanya memunculkan notifikasi "(belum terhubung)": F foto, R rekam, G semprot (tahan), P ambil/lepas, M tandai, T mode panas, V kamera, B tambah objek, Enter perintah, Tab panel AI, Esc jeda. Di controller: X foto, RT semprot, D-pad atas/kiri/kanan/bawah = tandai/rekam/ambil-lepas/mode panas, LB/RB kamera, Start jeda, Y (menu radial) belum dipakai.

Pengaturan bawaan: deadzone 0,15 (radial), Mode 2. Mengubahnya lewat menu ada di Fase 5.

## Struktur

```text
src/
  config.js       konstanta fisika dan langkah waktu (STEP = 1/60)
  flight.js       fisika drone (murni, tanpa Three.js) + applyAction()
  collision.js    bola vs AABB (murni)
  worldconfig.js  generator konfigurasi dunia dari seed (murni)
  world.js        membangun scene dari config (InstancedMesh, cincin checkpoint)
  drone.js        model drone, baling-baling, sinkron pose
  camera.js       kamera ikut dengan gerakan halus
  input.js        keyboard + gamepad, perangkat terakhir, tahan-untuk-konfirmasi
  inputmap.js     pemetaan stick, deadzone, HoldTracker (murni)
  bindings.js     tombol bawaan dan data petunjuk tombol
  autopilot.js    return home (sumber input yang memanggil applyAction)
  hud.js, hud.css HUD tetap 1280x720 (telemetri, tujuan, status, peta mini, PIP, hint bar)
  events.js       bus peristiwa (collision, zone_enter) untuk gateway nanti
  battery.js      model baterai (murni, parameter dari config.battery)
  missions.js     katalog misi, MissionRun, skor dari log peristiwa (murni)
  gateway.js      klien gateway (REST + WebSocket) dengan stub lokal sebagai cadangan
  ui.js, screens.js  menu overlay (mouse, keyboard, controller) dan isi layar
  main.js         loop utama dan alur aplikasi (menu, main, jeda, hasil)
tests/            uji Node (node --test)
```

## Keputusan teknis

- Fisika memakai langkah tetap 1/60 s dengan akumulator, terpisah dari render. Render menginterpolasi pose antar langkah supaya halus di layar 120/144 Hz.
- Drone benda kinematik: kecepatan mengejar target dengan redaman orde-1 dan batas akselerasi, lalu miring mengikuti arah gerak.
- Tabrakan memakai AABB sederhana (boleh untuk versi awal). Antarmukanya `resolveSphereBoxes`, jadi bisa diganti Rapier di fase berikutnya.
- Konversi sudut sim ke Three.js hanya ada di `drone.js` (yaw sim searah jarum jam, `rotation.y` Three berlawanan).
- Dunia dibangun dari `config` dan `seed`, bukan ditulis tetap, supaya cocok dengan `POST /runs` nanti.

## Keputusan teknis Fase 2

- Semua sumber (keyboard, gamepad, autopilot) berujung di `sim.applyAction()`. Autopilot dibatalkan otomatis jika pemain menggerakkan kontrol.
- Panggung HUD selalu 16:9 (basis 1280x720) dan diskalakan ke jendela dengan bilah hitam. Posisi HUD sama di keyboard dan controller. Margin aman 5%: telemetri di (64, 36).
- Kamera drone (PIP) adalah render kedua pada viewport kecil di scene yang sama. Panel PIP transparan di atasnya. Ini menambah draw calls dan akan dioptimalkan di Fase 6.
- Petunjuk tombol berganti saat perangkat terakhir berubah, dan simbol tombol mengikuti tipe controller (PlayStation memakai ✕ ○ □ △).
- Return home naik ke 34 m (di atas gedung tertinggi 30 m), terbang lurus ke helipad, lalu mendarat.

## Fase 3: menu, misi, freeroam

Alur: Menu utama -> Mulai (Latihan terbang langsung) / Misi / Freeroam / Bantuan. Editor perintah (Fase 4) dan Pengaturan (Fase 5) tampil tetapi nonaktif.

| Mode | Isi |
| --- | --- |
| Latihan terbang | Takeoff ke 5 m, melayang stabil 3 detik, mendarat di helipad. Lokal, skor tidak resmi |
| Patroli checkpoint | 5 cincin lalu mendarat di H. Lokal |
| Hindari rintangan | Terbang ke cincin di (0, 6, -80) melewati tiang. Lokal |
| M4 Pengiriman barang (misi utama) | Terbang rendah (<3 m) ke titik kuning, tekan P / D-pad kanan untuk ambil; ke zona hijau, tekan lagi untuk lepas. Zona merah = terlarang. Dunia dari `POST /runs`, skor dari `finish` |
| Freeroam | Terbang bebas, waktu terbang, B tambah objek (maks 20), V ganti kamera (3 tampilan), Tab panel asisten AI |

Keputusan Fase 3:
- Misi utama yang dibuat hanya M4 (butuh gerak, ambil/lepas, tanpa model AI). M1, M2, M3, M5 terlihat di daftar sebagai "belum tersedia".
- Gateway: `GATEWAY_URL` dari `VITE_GATEWAY_URL` (bawaan `http://localhost:8000`). Jika `/health` gagal dalam 1,5 detik, `stub` lokal menggantikan: membangkitkan dunia dari seed dan menghitung skor dari log peristiwa, persis seperti server. Label di HUD: "Tersambung" atau "Mode lokal (stub)". Layar hasil menandai skor resmi vs sementara.
- Telemetri 10 Hz lewat WebSocket hanya ke gateway asli. Peristiwa: takeoff, collision, zone_enter/zone_exit (kind nofly/checkpoint), pickup, drop.
- Skor M4 mengikuti spec Orang 3: Ketepatan 30, Kondisi barang 20, Waktu 20, Baterai 15, Kepatuhan zona 15; peringkat Perunggu 50, Perak 70, Emas 85; aturan gugur (tanpa pengiriman, komponen lain dipotong 50%). Tafsiran saya: "kondisi barang" dihitung dari jumlah tabrakan (1 - n/3), "waktu" penuh sampai waktu acuan lalu turun linear ke 0 di 2x acuan, "baterai" penuh di >=60%.
- Baterai nyata: laju dari `config.battery` (bawaan 0,05 %/s melayang + 0,02 per m/s + 0,05 per kg muatan). Habis = misi berakhir (`battery`). Waktu lebih dari 2x acuan = `timeout`. Freeroam tidak menguras baterai.
- Dunia diganti per misi: semua objek ada dalam satu Group yang di-dispose saat misi baru. Config dari gateway yang tidak lengkap diisi bawaan lewat `normalizeConfig`.
- Navigasi menu: keyboard (panah / W S, Enter, Esc), controller (D-pad, A, B / Start), mouse. Saat menu terbuka drone tidak menerima aksi, dan tombol A yang dipakai memilih tidak memicu takeoff.
- Telemetri membuat string JSON 10 kali per detik (tidak terhindarkan untuk WebSocket). Selain itu loop fisika dan render tidak membuat objek baru.

## Kriteria selesai

| Kriteria | Status |
| --- | --- |
| F1: takeoff, melayang, 4 arah, naik/turun, putar, mendarat | Logika lolos uji. Tanpa glitch visual belum diuji di browser |
| F1: FPS tercatat di panel status, target ≥30 | Kode ada (panel Status, kanan atas), belum diukur |
| F2: pindah keyboard dan controller tanpa muat ulang | Logika lolos uji dengan gamepad tiruan. Belum diuji dengan controller asli |
| F2: petunjuk tombol berganti otomatis | Sama seperti di atas |
| HUD tetap (posisi sesuai wireframe v2) | Ditulis, belum dilihat di browser |
| F3: satu latihan + satu misi utama bisa dimulai, selesai, tampil skor dan rincian | Logika lolos uji (50 tes, termasuk stub gateway). Alur layar belum dilihat di browser |
| F4: tambah objek dan buka panel tanpa menghentikan simulasi | Kode ada (B, Tab), belum diuji di browser |
| F7 (sebagian): menu utama dengan 6 entri | Ada. Pengaturan dan Editor perintah nonaktif sampai Fase 4/5 |

## Belum dikerjakan

- Misi utama M1, M2, M3, M5 (dunia, objek, skor). Foto/rekam/semprot/tandai masih "(belum terhubung)".
- Panel Tab: pilihan Deteksi, Jalur A*, Auto-hindari, Auto-pilot hanya menyimpan status (AI di Fase 4+). Diganti dengan tombol 1-4, belum bisa dari controller.
- Controller tidak punya tombol tambah objek (spec hanya memberi tombol B di keyboard).
- Mode Mulai = Latihan terbang. Editor perintah (Fase 4), pengaturan (Fase 5), optimasi dan Rapier (Fase 6).
- Kamera drone (PIP) tidak mengikuti mode kamera V.
- Nama id misi mengikuti file Orang 3 (`m4_delivery`). Perlu dipastikan dengan Orang 3 karena SHARED hanya memberi contoh `m1_sar` dan `m2_foto`.

## Perbaikan controller (setelah uji pertama)

- Stik kanan "selalu maju": penyebab dugaan = pada controller non-standar (`mapping` kosong) `axes[3]` adalah pemicu (L2) yang diam di -1. Sekarang `pickStickAxes` memilih 4 sumbu stik asli (nilai diam di dekat 0) kalau mapping bukan `standard`.
- Aktivitas controller dihitung dari PERUBAHAN sumbu (>0.03) atau tombol ditekan, bukan dari nilai yang menetap. Controller diam tidak merebut kendali dari keyboard.
- Controller mati: event `gamepaddisconnected` atau `getGamepads()` kosong langsung mengembalikan perangkat ke keyboard dan menolkan aksi.
- Tombol debug: tekan ` (backtick) untuk panel id, mapping, nilai sumbu, dan sumbu terpilih. Kalau stik masih salah, kirim isi panel ini.
- Batas: indeks tombol pada controller non-standar bisa berbeda. Hanya sumbu yang dikoreksi.
