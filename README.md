# DroneLab3D (Fase 1 dan 2)

Simulator drone 3D berbasis web (Three.js + Vite). Fase 1: dunia, drone, kamera, loop fisika 1/60 s dengan FPS terukur. Fase 2: input terpadu keyboard + controller dan HUD tetap.

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
  main.js         loop utama
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

## Kriteria selesai

| Kriteria | Status |
| --- | --- |
| F1: takeoff, melayang, 4 arah, naik/turun, putar, mendarat | Logika lolos uji. Tanpa glitch visual belum diuji di browser |
| F1: FPS tercatat di panel status, target ≥30 | Kode ada (panel Status, kanan atas), belum diukur |
| F2: pindah keyboard dan controller tanpa muat ulang | Logika lolos uji dengan gamepad tiruan. Belum diuji dengan controller asli |
| F2: petunjuk tombol berganti otomatis | Sama seperti di atas |
| HUD tetap (posisi sesuai wireframe v2) | Ditulis, belum dilihat di browser |

## Belum dikerjakan

Panel samping (Tab) dan command bar (Fase 3 dan 4), menu, misi, dan freeroam (Fase 3), editor perintah dan mock server (Fase 4), pengaturan dan penyimpanan (Fase 5), optimasi dan Rapier (Fase 6). Status Gateway dan AI di HUD masih "Belum aktif", dan baterai tetap 100% sampai ada model baterai.

## Perbaikan controller (setelah uji pertama)

- Stik kanan "selalu maju": penyebab dugaan = pada controller non-standar (`mapping` kosong) `axes[3]` adalah pemicu (L2) yang diam di -1. Sekarang `pickStickAxes` memilih 4 sumbu stik asli (nilai diam di dekat 0) kalau mapping bukan `standard`.
- Aktivitas controller dihitung dari PERUBAHAN sumbu (>0.03) atau tombol ditekan, bukan dari nilai yang menetap. Controller diam tidak merebut kendali dari keyboard.
- Controller mati: event `gamepaddisconnected` atau `getGamepads()` kosong langsung mengembalikan perangkat ke keyboard dan menolkan aksi.
- Tombol debug: tekan ` (backtick) untuk panel id, mapping, nilai sumbu, dan sumbu terpilih. Kalau stik masih salah, kirim isi panel ini.
- Batas: indeks tombol pada controller non-standar bisa berbeda. Hanya sumbu yang dikoreksi.
