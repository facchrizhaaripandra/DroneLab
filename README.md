# DroneLab3D (Fase 1 sampai 6, Tahap 7 sampai 11)

Simulator drone 3D berbasis web (Three.js + Vite). Fase 1: dunia, drone, kamera, loop fisika 1/60 s dengan FPS terukur. Fase 2: input terpadu keyboard + controller dan HUD tetap. Fase 3: menu utama, misi, freeroam. Fase 4: editor perintah (DSL) dan mock server. Fase 5: pengaturan dan penyimpanan. Fase 6: optimasi dan perapian. Tahap 7: Rapier dan kerusakan drone. Tahap 8: semua misi utama (M1, M2, M3, M5). Tahap 9: ekspor dataset YOLO.

## Menjalankan

```text
npm install
npm run dev      # buka alamat yang tampil (biasanya http://localhost:5173), Chrome terbaru
npm test         # uji Node, tanpa browser (termasuk uji HTTP ke mock server)
npm run bench    # biaya dan alokasi kode per langkah (fisika, skrip, misi)
npm run mock     # mock gateway di http://localhost:8000 (MOCK_AI=down untuk mensimulasikan AI mati)
```

## Kontrol

| Aksi | Keyboard | Controller (Mode 2) |
| --- | --- | --- |
| Gerak maju / mundur / kiri / kanan | W / S / A / D | Stick kanan |
| Naik / turun | Spasi / C | Stick kiri atas / bawah |
| Putar kiri / kanan | Q / E | Stick kiri kiri / kanan |
| Takeoff / Land (tahan 0,6 detik) | X | A |
| Return home (autopilot) | H | B |

Aksi kamera dan misi (Tahap 8): **F** foto, **R** mulai/berhenti rekam, **M** tandai (M1 korban, M5 cacat), **G** semprot (tahan, M3), **T** mode panas, **P** ambil/lepas paket (M4), **V** kamera, **B** tambah objek (freeroam), **Enter** editor perintah, **Tab** panel AI, **Esc** jeda. Di controller: X foto, RT semprot (tahan), D-pad atas = tandai, kiri = rekam, kanan = ambil/lepas, bawah = mode panas, LB/RB kamera, Start jeda. Menu Jeda punya "Akhiri dan lihat skor" di misi utama (dipakai kalau misi tidak bisa selesai otomatis).

Pengaturan bawaan: deadzone 0,15 (radial), Mode 2. Mengubahnya lewat menu ada di Fase 5.

## Struktur

```text
src/
  config.js       konstanta fisika dan langkah waktu (STEP = 1/60)
  flight.js       fisika drone (murni, tanpa Three.js) + applyAction()
  collision.js    bola vs AABB (murni)
  worldconfig.js  generator konfigurasi dunia dari seed (murni)
  world.js        membangun scene dari config (InstancedMesh, cincin checkpoint)
  drone.js        model drone (public/models/drone.glb, cadangan kotak), baling-baling, sinkron pose
  terrain.js      peta ketinggian, kotak tabrakan, batas peta scene Blender (murni)
  realworld.js    memuat peta realistis (public/scenes/<id>/scene.glb + scene.json)
  camera.js       kamera ikut dengan gerakan halus
  input.js        keyboard + gamepad, perangkat terakhir, tahan-untuk-konfirmasi
  inputmap.js     pemetaan stick, deadzone, HoldTracker (murni)
  bindings.js     tombol bawaan dan data petunjuk tombol
  autopilot.js    return home (sumber input yang memanggil applyAction)
  hud.js, hud.css HUD tetap 1280x720 (telemetri, tujuan, status, peta mini, PIP, hint bar)
  events.js       bus peristiwa (collision, zone_enter) untuk gateway nanti
  battery.js      model baterai (murni, parameter dari config.battery)
  missions.js     MissionRun: jalannya satu misi, aksi foto/rekam/tandai/semprot (murni)
  gateway.js      klien gateway (REST + WebSocket) dengan stub lokal sebagai cadangan
  ui.js, screens.js  menu overlay (mouse, keyboard, controller) dan isi layar
  dsl.js          parser, validator, compiler bahasa skrip (murni)
  commander.js    menjalankan skrip lewat applyAction (murni, diuji dengan fisika asli)
  nlparse.js      parser bahasa natural lokal (murni)
  vision.js       "apa yang terlihat": kerucut untuk label lama, model kamera + asap untuk person/fire/smoke/landmark/defect (murni)
  camera-model.js proyeksi kamera drone (FOV 70, 16:9): kotak di bingkai, daftar `visible` (murni)
  catalog.js      katalog misi dan bobot skor (data)
  scoring.js      skor semua misi dari log peristiwa + laporan inspeksi (murni)
  agri.js         model semprot M3: dosis per sel, tangki, angin (murni)
  dataset.js      label kebenaran dasar, rencana dataset, penulis ZIP (murni)
  exporter.js     halaman ekspor dataset (?export=1, perlu browser)
  editor.js       panel editor perintah (DOM)
  quality.js      kualitas adaptif: turun otomatis jika FPS rendah (murni)
  settings.js     pengaturan: bawaan, validasi, localStorage, remap, preset (murni)
  main.js         loop utama dan alur aplikasi (menu, main, jeda, hasil)
mock-server/      gateway tiruan (Node, tanpa dependensi)
scripts/          bench.mjs (npm run bench)
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
- Pada Fase 3 hanya M4 yang dibuat. M1, M2, M3, M5 menyusul di Tahap 8 (di bawah).
- Gateway: `GATEWAY_URL` dari `VITE_GATEWAY_URL` (bawaan `http://localhost:8000`). Jika `/health` gagal dalam 1,5 detik, `stub` lokal menggantikan: membangkitkan dunia dari seed dan menghitung skor dari log peristiwa, persis seperti server. Label di HUD: "Tersambung" atau "Mode lokal (stub)". Layar hasil menandai skor resmi vs sementara.
- Telemetri 10 Hz lewat WebSocket hanya ke gateway asli. Peristiwa: takeoff, collision, zone_enter/zone_exit (kind nofly/checkpoint), pickup, drop.
- Skor M4 mengikuti spec Orang 3: Ketepatan 30, Kondisi barang 20, Waktu 20, Baterai 15, Kepatuhan zona 15; peringkat Perunggu 50, Perak 70, Emas 85; aturan gugur (tanpa pengiriman, komponen lain dipotong 50%). Tafsiran saya: "kondisi barang" dihitung dari jumlah tabrakan (1 - n/3), "waktu" penuh sampai waktu acuan lalu turun linear ke 0 di 2x acuan, "baterai" penuh di >=60%.
- Baterai nyata: laju dari `config.battery` (bawaan 0,05 %/s melayang + 0,02 per m/s + 0,05 per kg muatan). Habis = misi berakhir (`battery`). Waktu lebih dari 2x acuan = `timeout`. Freeroam tidak menguras baterai.
- Dunia diganti per misi: semua objek ada dalam satu Group yang di-dispose saat misi baru. Config dari gateway yang tidak lengkap diisi bawaan lewat `normalizeConfig`.
- Navigasi menu: keyboard (panah / W S, Enter, Esc), controller (D-pad, A, B / Start), mouse. Saat menu terbuka drone tidak menerima aksi, dan tombol A yang dipakai memilih tidak memicu takeoff.
- Telemetri membuat string JSON 10 kali per detik (tidak terhindarkan untuk WebSocket). Selain itu loop fisika dan render tidak membuat objek baru.

## Fase 4: editor perintah dan mock server

Cara pakai: menu Editor perintah (membuka Freeroam dengan editor), atau tekan Enter saat terbang (di misi mana pun). Panel di kiri, di antara telemetri dan peta mini.

- Tab Skrip: Jalankan (Ctrl+Enter), Langkah (satu perintah per tekan), Hentikan, Contoh. Saat berjalan, pernyataan aktif disorot kuning dan log menulis `>>` mulai, `OK` selesai, galat berwarna merah dengan nomor baris.
- Tab Bahasa natural: parser lokal untuk frasa umum ("naik 5 meter", "mendarat", "putar 360", "maju 12, lalu foto, kemudian pulang"). Yang tidak dikenal dikirim ke `/api/v1/command` (timeout 10 s). Hasil masuk ke tab Skrip untuk diperiksa, tidak langsung jalan.
- DSL mengikuti SHARED bagian 3: semua perintah dalam tabel, batas nilai diperiksa sebelum jalan, perintah di luar tabel ditolak dengan nomor baris. Batas 60 dihitung per pernyataan (bukan per baris, supaya skrip contoh satu baris tetap sah).
- Skrip hanya memakai `sim.applyAction()` seperti sumber input lain. Menggerakkan kontrol manual membatalkan skrip. `detect("label")` memakai data lokal (kerucut pandang 80 derajat, 60 m): building, obstacle, target (cincin), dropzone (M4). Sejak Tahap 8, person, fire, smoke, landmark, defect juga bekerja di dunia misi (memakai kamera drone, termasuk sudut gimbal dan mode panas).
- Perintah foto, rekam, semprot, tandai, pickup/drop terhubung ke sistem misi sejak Tahap 8 (hasilnya ditulis di log editor), look() menggerakkan kamera drone (PIP).
- Setiap perintah punya batas waktu 120 detik. Perintah terbang saat drone di darat memberi galat "pakai takeoff() dulu".
- Klien AI (`gateway.js`): `command`, `detect`, `decide` lewat gateway, tidak pernah melempar galat (`{ok:false, reason}`). Cek `/health` tiap 10 detik. HUD: "Server AI terhubung" / "AI offline" dan "Tersambung" / "Mode lokal (stub)". Satu panggilan AI gagal langsung mengubah indikator.
- Mock server (`npm run mock`): health, missions, runs, events, finish (skor dari kode yang sama dengan stub), leaderboard, detect, decide, command. WebSocket telemetri ditambahkan di Tahap 8. `command` memakai parser lokal, lainnya dijawab skrip contoh dengan `source: "llm"`.
- Simulator hanya bicara dengan gateway. `detect` dan `decide` sudah ada di klien tetapi belum dipakai oleh fitur apa pun (menunggu A* dan asisten AI).

## Fase 5: pengaturan

Menu utama > Pengaturan (panah kiri/kanan mengubah nilai, Enter memilih, Esc kembali). Semua perubahan langsung berlaku dan disimpan di `localStorage` (kunci `dronelab.settings.v1`).

| Halaman | Isi |
| --- | --- |
| Keyboard | Ubah tombol untuk 21 aksi (pilih aksi, tekan tombol baru; tombol yang sudah dipakai otomatis ditukar, Esc membatalkan), sensitivitas 30-100%, akselerasi 1-5 |
| Controller | Skema Mode 1/2, sensitivitas 50-150%, deadzone 5-30%, balik sumbu Y, getaran, layar uji stick (dua lingkaran + cincin deadzone) dan tombol uji getaran |
| Grafik | Preset (Rendah/Sedang/Tinggi/Kustom), target FPS 30/60, resolusi render 50-100%, bayangan, ukuran HUD 80/90/100% |

Keputusan Fase 5:
- Semua nilai melewati `sanitize()` saat dimuat: JSON rusak, nilai di luar batas, atau tombol ganda tidak bisa merusak aplikasi (kembali ke bawaan).
- "Akselerasi" keyboard = seberapa cepat tombol mencapai defleksi penuh (2, 4, 8, 16 satuan/detik, atau instan). Ini tidak mengubah fisika drone, jadi misi dan skor tetap adil. "Sensitivitas" keyboard membatasi defleksi maksimum.
- Preset hanya mengisi resolusi render dan bayangan. Mengubah salah satunya manual menandai preset "Kustom".
- Target FPS 30: fisika dan input tetap jalan tiap frame, hanya gambar yang dirender tiap 2 frame.
- Ukuran HUD hanya mengecil (80-100%) ke arah tengah layar, supaya tidak keluar dari margin 5%.
- Getaran memakai `vibrationActuator` (dual-rumble) saat tabrakan, hanya bila controller sedang dipakai dan opsi menyala.
- Bilah petunjuk tombol ikut tombol yang sudah diubah. Tombol ` (backtick) dicadangkan untuk panel debug dan tidak bisa dipakai ulang.

## Fase 6: optimasi dan perapian

Yang dikerjakan:
- **Kualitas adaptif** (`quality.js`): jika FPS di bawah 30 selama 2 detik berturut-turut saat bermain, kualitas turun satu tingkat (Penuh 100% > Sedang 80% > Rendah 60% tanpa bayangan > Minimum 50%), dengan toast dan nama tingkat di baris FPS. Aturan: tidak pernah naik sendiri (supaya tidak bolak-balik), jeda 3 detik setelah turun, jeda 4 detik setelah dunia baru (kompilasi shader), tingkat yang tidak mengubah apa pun dilewati. Tidak mengubah pengaturan tersimpan, hanya membatasi yang dipakai renderer. Mengubah pengaturan grafik mengembalikannya ke awal. Pada target 30 FPS batasnya 27.
- **Satu lintasan bayangan per frame**: lintasan kedua (kamera drone) memakai ulang shadow map dari lintasan utama (`shadowMap.autoUpdate = false` sementara).
- **Menu, jeda, hasil digambar maksimal 30 FPS**, gameplay mengikuti target FPS.
- **HUD hanya menulis teks yang berubah** (10 kali per detik, tanpa layout ulang yang sia-sia).
- **Pemeriksaan alokasi** (`npm run bench`): fisika, penjalan skrip, dan pelacak misi diukur 600 000 langkah (10 000 detik terbang): sekitar 0,2 sampai 0,6 mikrodetik per langkah dan pertumbuhan heap di bawah 150 KB total (praktis nol per langkah). Loop render sudah memakai ulang geometri, material, dan vektor; objek baru hanya dibuat saat ada kejadian (tombol, ganti misi, tekan B) dan di tick HUD 10 Hz (telemetri, string teks).
- Perapian: impor dan ekspor yang tidak terpakai dihapus.

Sengaja tidak dikerjakan di fase ini:
- **Rapier**: spec membolehkan AABB sebagai versi awal ("Versi paling awal boleh hanya AABB + Raycaster"), dan paket tidak bisa dipasang dan diuji di lingkungan saya. Tabrakan memakai bola vs kotak (`collision.js`), sensor cincin dan zona memakai jarak. Perlu keputusan Anda jika Rapier tetap diwajibkan.
- **Ekspor dataset YOLO (`?export=1`)**: dikerjakan di Tahap 9.

Cara cek di laptop Anda: buka Freeroam, lihat angka FPS di panel status. Untuk memaksa kualitas turun, pilih Pengaturan > Grafik > Resolusi 100% di jendela sangat besar, atau perlambat dengan DevTools (Performance > CPU 6x slowdown). Hasil ukur FPS di GPU asli belum ada, karena saya tidak bisa menjalankan browser.

## Tahap 7: fisika Rapier dan kerusakan drone

Yang dikerjakan:
- **Lapisan fisika** (`physics.js`): satu antarmuka kecil (`setStatic`, `add`, `resolve`, `raycast`) dengan dua isi. `AabbPhysics` (bola vs kotak, selalu jalan) dan adaptor Rapier (`createRapierPhysics`, memakai `KinematicCharacterController` dan bola kinematik). Rapier dimuat di latar belakang (WASM); sebelum selesai, atau jika gagal dimuat, atau jika Rapier melempar error di tengah permainan, simulasi pindah ke AABB secara permanen dan menulis peringatan di konsol. Cek mesin yang aktif: konsol browser menampilkan `Physics: rapier` atau `Physics: aabb`.
- **Model kerusakan** (`damage.js`): 4 baling-baling (kiri-depan, kanan-depan, kiri-belakang, kanan-belakang), kamera, baterai, bodi. Tabrakan di atas 1,5 m/s merusak bagian yang menghadap arah benturan (makin cepat makin parah; penuh di 6,5 m/s). Status: utuh (di atas 65%), rusak (5-65%), patah (di bawah 5%).
- **Efek ke terbang**: baling patah/rusak mengurangi gaya angkat (drone turun perlahan dan lebih lambat), sisi lemah membuat drone melayang ke sisi itu dan berputar (yaw), baterai rusak menambah laju kuras, kamera pecah mematikan gambar PIP. Drone tidak bisa lepas landas jika gaya angkat di bawah 35%. Bodi hancur atau 3 baling patah membuat drone jatuh (mode `crashed`, kontrol mati).
- **Tampilan**: baling patah hilang dari model, baling rusak lebih pendek dan miring, bodi menggelap. Panel Telemetri punya baris Baling (4 kotak hijau/kuning/merah). Toast muncul tiap bagian berubah status.
- **Misi**: drone yang jatuh mengakhiri misi dengan alasan "Jatuh" (skor mengikuti aturan misi gagal). Di Freeroam drone baru muncul di pad 3 detik setelah jatuh.
- **Angin** sudah didukung oleh `Flight` (`sim.wind`, dibaca dari `config.wind` jika ada). Zona api/asap yang merusak lewat `damage.burn()` dipakai di misi M1 (Tahap 8).

Pemasangan: jalankan `npm install` (menambah `@dimforge/rapier3d-compat`). Tanpa paket itu, simulasi tetap jalan dengan AABB.

Yang belum bisa saya buktikan: kode Rapier asli tidak bisa dijalankan di lingkungan saya (tanpa jaringan dan browser). Adaptor diuji dengan modul Rapier tiruan (`tests/physics.test.js`), jadi bentuk pemanggilan API sudah dicek tetapi perilaku fisika Rapier sungguhan belum. Mohon laporkan error konsol jika ada. Tampilan visual kerusakan dan baris HUD juga belum terlihat oleh saya.

## Tahap 8: misi utama M1, M2, M3, M5

Semua misi utama sekarang bisa dimainkan. Menu Misi menampilkan satu entri per varian (gedung/hutan, hotel/gunung, lahan, gedung/jembatan). Dunia dibangkitkan dari `(id, seed, varian)`, jadi sama persis di stub lokal, mock server, dan (nanti) gateway.

Aturan umum: misi selesai otomatis saat tujuannya tercapai **dan** drone mendarat di H. Kalau pemain mau berhenti lebih awal: Jeda > "Akhiri dan lihat skor". Waktu > 2x acuan = `timeout`, baterai habis = `battery`, jatuh = `crashed`. Tiga alasan terakhir memotong komponen "gugur" (daftar di `catalog.js`) 50%.

| Misi | Dunia | Mekanik | Aksi |
| --- | --- | --- | --- |
| M1 SAR | Gedung berasap: 14 gedung, 1 korban di atap. Hutan: 70 pohon (bertabrakan), 3 zona api. Korban 3 sampai 6 orang, 2 sampai 3 zona api, kolom asap | Api membakar drone di bawah 15 m (`damage.burn`, sekitar 8 detik sampai kamera pecah). Asap membatasi pandangan ke 6 m (hanya mode panas menembus). Korban tidak ditampilkan di peta mini | M tandai, T mode panas, F foto |
| M2 Foto/video | Hotel (fasad, kolam, atap) atau gunung (puncak, danau). Matahari dengan azimut dan elevasi dari seed | Daftar bidikan: foto lebar, foto detail, video orbit, video reveal. HUD menyebut bidikan berikutnya | F foto, R rekam mulai/berhenti |
| M3 Agri | Lahan 24 x 16 m (sel 2 m) dengan rumah dan sungai (area terlarang), angin 1 sampai 2 m/s | Tangki 200 satuan (20 detik semprot), isi ulang otomatis saat mendarat di H. Lebar semprot = 0,8 x tinggi (2 sampai 7 m). Angin menggeser jatuhnya semprotan. Sel lahan berwarna sesuai dosis: biru muda kurang, hijau-biru pas, ungu berlebih | G tahan semprot |
| M5 Inspeksi | Gedung 16 x 12 x 20 m atau jembatan 44 m, 5 sampai 7 cacat (retak, karat) di permukaan | Panel fasad (24 di gedung, 10 di jembatan) dan cacat; jarak aman 3 sampai 8 m. Hasil akhir memuat laporan inspeksi | F foto, M tandai |

Cara menguji (di browser): `npm run dev`, Misi, pilih tiap varian. M1: takeoff, cari oranye (korban), turun ke dalam 5 m dengan kamera menghadap korban, tekan M (toast menyebut benar atau salah). Coba T di dekat asap. M2: tekan F dari beberapa sudut, R untuk rekam saat mengorbit. M3: terbang rendah (3 sampai 8 m, di bawah 4 m/s) di atas lahan sambil menahan G, perhatikan warna sel. M5: dekati dinding, F lalu M di depan cacat. Untuk uji tanpa browser: `npm test`.

**Skor** (spec Orang 3 B5, bobot ada di `catalog.js` dan bisa ditimpa `config.weights`; `scoring.js` hanya membaca bobot itu):
- M1: Korban ditemukan 40, Waktu 20, Cakupan area 15, Keselamatan 15, Presisi 10. "Ditemukan" = korban ada di bingkai kamera pada saat M ditekan dan drone di dalam 5 m (horizontal).
- M2: tiap foto dinilai Subjek 30, Sepertiga 20, Horizon 10, Ketajaman 15, Cahaya 10, Variasi 15; tiap video Subjek 30, Kehalusan 30, Sinematik 20, Durasi 10, Keselamatan 10; misi = 60% foto + 40% video. Terbaik per butir daftar bidikan, satu foto atau klip tidak dipakai dua kali.
- M3: Cakupan 40, Pemborosan 20, Efisiensi 20, Ketinggian dan kecepatan 10, Manajemen tangki 10.
- M5: Cakupan fasad 30, Cacat ditemukan 30, Jarak aman 15, Kualitas foto 10, Kelengkapan laporan 15.

Tafsiran saya yang perlu dikonfirmasi Orang 3 (rumus Orang 3 belum final menurut spec "boleh disesuaikan"):
- Komponen Waktu M1 dikali rasio korban ditemukan, dan Efisiensi M3 dikali cakupan, supaya terbang sebentar lalu mendarat tidak mendapat poin gratis.
- Gugur: M1 memotong Waktu dan Cakupan, M3 Efisiensi dan Tangki, M5 Jarak aman dan Laporan. M2 dan M4 tidak punya komponen gugur selain aturan M4 yang sudah ada.
- M2: rentang luas subjek per bidikan (foto lebar 5 sampai 35%, detail 10 sampai 60%); titik sepertiga: jarak maksimum 0,47 (pojok); "ketajaman" turun linear sampai 0 di 3 m/s atau 60 derajat per detik; "hentakan" dinormalkan 8 m/s^3; cahaya: menghadap matahari (dot > 0,3) mengurangi nilai; video "orbit" = sapuan sudut 90 derajat, "reveal" = naik 10 m sambil menjauh 5 m.
- M3: dosis per sel = aliran 10 satuan/detik dibagi rata ke sel di bawah lingkaran semprot; target 0,4 sampai 1,2 satuan per m2; pemborosan = dosis di luar lahan, di rumah/sungai, dan di atas batas atas.
- M5: cacat dihitung jika difoto dalam 10 m dan ditandai; tiap tanda salah mengurangi 0,1 dari rasio; tingkat keparahan dari ukuran (di bawah 0,8 m ringan, di bawah 1,5 m sedang, selebihnya berat); kualitas foto memakai ketajaman dan luas cacat di bingkai.
- Id misi mengikuti SHARED: `m1_sar`, `m2_foto`, `m3_agri`, `m4_delivery`, `m5_inspeksi`. Varian: `gedung`/`hutan`, `hotel`/`gunung`, `lahan`, `gedung`/`jembatan`.

Kontrak yang dipakai: peristiwa `photo`/`mark` membawa `pose {pos, yaw, pitch (gimbal), roll}`, `visible [{label, id, dist, area, box}]`, `speed`, `yaw_rate`; peristiwa `record_start/stop`, `spray`, `refill`, `zone_enter/zone_exit` (kind `fire`). Telemetri WebSocket memakai kolom kontrak ditambah `gimbal` (sudut gimbal, dipakai skor video). Server tidak menerima frame telemetri sebagai peristiwa; skor memakai frame itu sebagai log `sample`. Tanpa telemetri, M1 (cakupan), M3, M5 (jarak aman), dan video M2 tidak bisa dinilai.

Mock server: WebSocket nyata (`/ws/v1/runs/{id}`, tulisan tangan RFC 6455, tes memakai klien WebSocket bawaan Node), `GET /runs/{id}/report` (laporan inspeksi), semua misi dan varian. Layar hasil M2 menampilkan nilai tiap bidikan, layar hasil M5 menampilkan laporan (daftar cacat, tingkat keparahan, cakupan, tanpa foto kecil).

Batas yang sudah saya ketahui:
- Semua tampilan baru (orang, api, asap, pohon, lahan berwarna, cacat, kerucut semprot, filter termal, kilatan foto) ditulis tanpa pernah dilihat di browser. Warna, ukuran, dan keterbacaan perlu dicek mata Anda.
- Mode panas hanya filter CSS (abu-abu, kontras, warna hangat) ditambah orang/api putih terang dan asap tipis. Bukan model panas sungguhan.
- Asap dan pandangan: aturan sederhana (garis pandang menembus kolom asap dan jarak di atas 6 m). Gedung tidak menghalangi pandangan dalam `visible` (hanya asap).
- Gimbal hanya diubah oleh perintah `look()`, belum ada tombolnya. Gambar PIP ikut miring mengikuti roll drone supaya cocok dengan nilai horizon.
- Foto kecil (thumbnail) belum dikirim ke gateway; laporan inspeksi memuat referensi waktu foto saja.
- Rumus M2 butuh data kamera dari simulator; Orang 3 perlu memakai `visible` apa adanya dan tidak menghitung ulang dari gambar.

## Tahap 9: ekspor dataset YOLO

Buka `http://localhost:5173/?export=1`. Halaman ekspor menggantikan menu: isi jumlah gambar (bawaan 200) dan seed rencana, tekan Mulai. Simulator merender dunia misi dari banyak sudut dan mengunduh satu berkas `dronelab-dataset.zip`:

```text
images/{train,val,test}/<misi>_<varian>_<seed>_<n>.jpg   640x360
labels/{train,val,test}/<sama>.txt                       format YOLO: kelas cx cy w h (0..1)
classes.txt, data.yaml, manifest.json (pose, matahari, mode panas, label), README.txt
```

- Sembilan kelas: person, fire, smoke, landmark, dropzone, defect, building, obstacle, target (urutan sama dengan `LABELS` di DSL).
- Pembagian 70/20/10 per dunia, dan seed uji (3000 sampai 3499) tidak pernah dipakai di latih (1000 sampai 1499) atau validasi (2000 sampai 2499), sesuai spec Orang 2.
- Variasi (domain randomization): sudut dan tinggi kamera (2 sampai 36 m), jarak (6 sampai 46 m), arah dan tinggi matahari, bayangan nyala/mati (30%), asap (dari dunia M1), mode panas (sekitar 10%, filter 2D yang sama dengan game), varian dunia. Tekstur tidak divariasikan (dunia memakai warna polos).
- Pemilihan sasaran seimbang per kelas yang ada di dunia itu. Gambar tanpa satu pun objek dilewati.
- Kotak diambil dari proyeksi kotak pembatas objek (tepi kotak 3D), jadi tidak seketat piksel. Objek yang tertutup asap (mode normal) tidak diberi label, sama dengan aturan game.
- ZIP ditulis tanpa kompresi (JPEG sudah terkompresi). Logika label, rencana, dan ZIP diuji di Node (`tests/dataset.test.js`, termasuk pembacaan ulang dan `zipfile` Python). Bagian render (`exporter.js`) tidak bisa saya jalankan tanpa browser, jadi belum terbukti.

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

## Tahap 11: perbaikan tampilan

Tampilan diubah dari wireframe (kotak putih bergaris hitam) ke gaya stasiun kendali darat. Posisi dan ukuran HUD tetap mengikuti wireframe v2.
- **HUD** (`hud.css`, `hud.js`): panel kaca biru-baja gelap tembus pandang, teks putih, aksen oranye keselamatan `#ff8a1f` (warna yang sama dengan drone dan tanda H). Huruf Bahnschrift (keluarga DIN, bawaan Windows) dengan angka tabular, cadangan ke font sistem. Panel Telemetri dan Status tidak lagi memotong baris terakhir (Baling, FPS). Mode terbang tampil dalam Bahasa Indonesia (Di darat, Terbang, Mendarat, ...). Baterai berwarna kuning di bawah 30% dan merah di bawah 15%. Minimap gelap dengan grid 20 m dan panah drone oranye.
- **Menu**: kartu kaca gelap, pilihan aktif ditandai garis oranye, sorotan mengikuti kursor mouse. Menu utama berupa kolom kiri di atas adegan 3D, dengan kamera yang mengorbit drone perlahan. Menu pendek (jeda, memuat) memakai kartu ramping. Editor perintah ikut bertema gelap.
- **Render** (`main.js`): tone mapping ACES Filmic, bayangan lembut (PCFSoft, peta 2048), PIP tidak lagi digambar di belakang menu.
- **Dunia prosedural** (`world.js`): langit bergradasi, gedung mendapat jendela dan garis lantai lewat shader (tanpa tekstur), warna gedung bervariasi, tanah berpetak lembut, grid samar. Pohon bertingkat dua dengan variasi warna. Api memakai kerucut aditif berinti kuning dan cahaya di tanah, asap berupa gumpalan sprite yang naik dan membesar.
- **Perbaikan bug**: misi M1, M2, M3, dan M5 macet di layar "Memuat misi..." karena minimap mencoba menggambar titik paket M4 (`normalizeConfig` memberi `noFly: []` ke semua misi). Sekarang hanya digambar jika titiknya ada.

- **Layar menu lanjutan**: daftar misi dikelompokkan dengan judul "Latihan" dan "Misi utama", acuan waktu memakai koma desimal (1,5 menit). Layar skor memakai lencana peringkat (emas, perak, perunggu) dan bilah meter per komponen nilai, dan HUD disembunyikan di belakang kartu skor. Bantuan tampil dua kolom (keyboard dan controller) tanpa perlu digulir, kartu selalu mulai dari atas. Pengaturan keyboard menampilkan tombol sebagai keycap, dan pilihan bernilai (grafik, sensitivitas) diberi tanda ‹ ›.

Catatan: tone mapping juga berlaku untuk ekspor dataset (`?export=1`), jadi warna gambar dataset baru sedikit berbeda dari ekspor sebelumnya.

## Tahap 12: S3 dan S4 lebih realistis

File Blender baru: `S3_resor_hotel/resor_hotel_v06.blend` dan `S4_gunung_danau/gunung_danau_v06.blend` (v05 tetap ada). Skrip di `scripts/blender/`.
- **Tanah tanpa kotak-kotak** (`bake_terrain.py`): zona material per-face di-bake menjadi satu peta warna 4096 px. Batas zona dikaburkan, dibelokkan dengan noise (domain warp) lalu ditajamkan lagi, tiap zona memakai teksturnya sendiri di dua skala (pengulangan tidak terlihat), lereng curam otomatis menjadi batu. Ditambah normal map detail berulang (KHR_texture_transform). Terrain kini satu material, sehingga GLB lebih kecil.
- **S4 gunung** (`s4_reshape.py`, `s4_zones.py`): lereng atas (di atas ~95 m) diberi punggungan dan alur (sebelumnya piramida halus). Pohon, batu, jalur, dan sungai ikut diturunkan atau dinaikkan ke permukaan baru. Zona tanah dibuat ulang dari ketinggian: hutan, rumput dengan petak kering, kerikil, batu dan pasir vulkanik di puncak, kerikil di tepi danau, batu berlumut di tebing rendah.
- **Air** (`water_backdrop.py`, `s4_water.py`, `s3_coast.py`): danau dan laut berupa satu grid dengan warna kedalaman (vertex color), riak dari normal map. Sungai dibangun ulang mengikuti lereng (jeram putih di bagian curam, kolam lebih tenang, dasar batu basah). Air terjun bergaris dengan buih di kolamnya. Laut S3 bergradasi dari pirus ke biru tua, dengan buih ombak di garis pantai, garis buih kedua di lepas pantai, dan pasir basah.
- **Tanpa tepi peta**: S4 dikelilingi pegunungan sejauh 2,2 km. S3 mendapat pantai yang berlanjut ke dua tanjung (membentuk teluk), bukit hijau dengan pohon dan kelapa, dan laut sampai cakrawala. Semua bernama `backdrop_*`: `export_scene.py` melewatinya untuk tanah dan collider, jadi batas terbang dan heightfield tidak berubah.
- **Web** (`world.js`): air di peta realistis memantulkan gradasi langit (envMap), sehingga danau dan laut tidak terlihat seperti pelat cat.

Catatan: warna batu besar S4 dibuat lebih abu-abu (`rock_boulder_grey_diff.png`). Air terjun dan buih memakai transparansi (alpha blend).

## Pengaturan dari menu Jeda, kualitas grafik tetap

- Menu Jeda punya pilihan **Pengaturan** (keyboard, controller, grafik). Permainan tetap terjeda di belakangnya, dan "Kembali" mengarah lagi ke menu Jeda.
- Kualitas grafik tidak lagi turun sendiri saat bermain. Penurunan otomatis kini pilihan **Turunkan otomatis** di Pengaturan grafik (bawaan: Mati, juga untuk pengaturan lama yang tersimpan). Jika dinyalakan, perilakunya sama seperti sebelumnya (turun satu tingkat jika FPS rendah selama 2 detik).

## Peta mini mengikuti drone

Peta mini dulu hanya menggambar ±110 m di sekitar titik start, sehingga di peta realistis (sampai 1 km) panah drone keluar dari panel dan hilang. Sekarang lapisan statisnya digambar seukuran dunia, dan tiap pembaruan menampilkan potongan 296 px yang berpusat pada drone (`hud.js`). Di dekat tepi dunia peta berhenti bergeser dan panah bergerak ke pinggir, tetap di dalam panel. Dunia 200 m tampil persis seperti sebelumnya (tidak bergeser).

## Tahap 13: S4 Pegunungan dan danau dibuat ulang (v07)

File Blender `S4_gunung_danau/gunung_danau_v07.blend` (v06 tetap ada). Skrip: `scripts/blender/s4v07_*.py`.
- **Relief baru 1,2 km**: gunung berapi dengan kawah, gunung kedua di timur, punggungan perbukitan. Lembah dibentuk erosi aliran (stream power implisit + difusi lereng, aliran multi-arah), jadi alurnya bercabang alami.
- **Danau** di cekungan dengan tebing di sisi barat laut, warna menurut kedalaman. **Sungai** mengikuti alur lembah dari lereng gunung (dicari otomatis), lalu jatuh sebagai **air terjun 88 m** dari bibir tebing ke danau, dengan buih di kolamnya.
- **Vegetasi baru** (bukan kerucut low-poly lagi): pohon daun lebar pegunungan, cemara gunung, pakis pohon, semak, pakis tanah. Daunnya foto asli (atlas daun Poly Haven `jacaranda_tree`, `fern_02`, CC0) yang disusun menjadi kartu kelompok daun. Sebaran mengikuti ekologi: hutan rapat di lembah dan dataran rendah, cemara di ketinggian menengah, semak di atas batas hutan, pakis di alur basah, punggungan tetap terbuka.
- **Kemah** di padang tepi danau (titik start baru dengan helipad berhuruf H), tenda, pondok, tungku, dermaga. **Jalur pendakian** 1,8 km berkelok dari kemah ke bibir kawah. Batu Poly Haven (`rock_moss_set_01`, `rock_07`) di tebing, scree, dan dasar alur. Pegunungan latar sejauh 2,7 km.
- **Web** (`realworld.js`, `instanceRepeats`): salinan mesh yang sama (pohon, batu) digabung menjadi `InstancedMesh` saat peta dimuat. Ekspor Blender tidak pernah menulis GPU instancing, jadi sebelumnya tiap pohon satu draw call (S4 v07: 7.400 objek). Ini berlaku untuk semua peta. Tes: `tests/instancing.test.js`.

## Tahap 14: mobil dan pohon realistis di semua peta

Pustaka aset baru `DroneLab3D/A2_aset_realistis/aset_v01.blend` (skrip `scripts/blender/asset_*.py`).
- **Kendaraan** (`asset_cars.py`): sedan, hatchback, MPV, SUV, pikap, taksi, bus, truk boks, motor. Bodi dibuat dari penampang yang di-loft lalu dihaluskan (Catmull-Clark), dengan lengkung roda, kaca gelap, bemper, lampu depan/belakang, ban dan velg. Cat metalik dengan clearcoat, 42 kombinasi tipe dan warna, versi hangus untuk S1.
- **Pohon** (`asset_trees.py`): pohon tropis (4 varian), pohon hutan tinggi, pohon jalan, pohon kering, kamboja, pohon hangus dan mati, kelapa, semak, semak hangus, pagar tanaman, rumpun bambu. Daun foto asli (Poly Haven `island_tree_02`, `fern_02`, `shrub_03`, CC0) disusun jadi kartu kelompok daun, kulit batang foto (`island_tree_02`, `palm_tree_bark`).
- **Penggantian** (`asset_apply.py`, `asset_run.py`): tiap pohon lama diganti model baru di posisi, tinggi, dan pangkal yang sama. Mobil dicari di dalam objek mobil gabungan lama (satu kelompok bagian per kendaraan), tipe dipilih dari panjang dan tinggi, arah dari sumbu panjangnya. Objek mobil lama disembunyikan, tidak dihapus. Versi baru: S0 v05, S1 v08, S2 v06, S3 v07, S5 v05, S6 v06, S7 v06, S7b v06.
- **Dunia misi/freeroam** (`world.js`): pohon kerucut diganti model dari `public/models/trees.glb` (0,35 MB) begitu termuat; kerucut tetap jadi cadangan bila file tidak ada.

## Kriteria selesai

| Kriteria | Status |
| --- | --- |
| F1: takeoff, melayang, 4 arah, naik/turun, putar, mendarat | Logika lolos uji. Tanpa glitch visual belum diuji di browser |
| F1: FPS tercatat di panel status, target ≥30 | Kode ada (panel Status, kanan atas), belum diukur |
| F2: pindah keyboard dan controller tanpa muat ulang | Logika lolos uji dengan gamepad tiruan. Belum diuji dengan controller asli |
| F2: petunjuk tombol berganti otomatis | Sama seperti di atas |
| HUD tetap (posisi sesuai wireframe v2) | Ditulis, belum dilihat di browser |
| F3: satu latihan + satu misi utama bisa dimulai, selesai, tampil skor dan rincian | Logika lolos uji (50 tes, termasuk stub gateway). Alur layar belum dilihat di browser |
| F5: skrip contoh berjalan dan baris aktif ditandai | Berjalan di fisika asli dalam tes (takeoff, goto, rotate, if, land). Penandaan di UI belum dilihat di browser |
| F6: mematikan server tidak membuat simulator error atau macet | Diuji dengan server HTTP nyata yang dimatikan: stub dan indikator "AI offline" bekerja. Belum diuji di browser |
| F7: pengaturan tersimpan di localStorage dan berlaku setelah muat ulang | Simpan, muat ulang, dan perbaikan data rusak diuji di Node (78 tes). Layar pengaturan belum dilihat di browser |
| F8: FPS tercatat di panel status; kualitas turun otomatis jika FPS < 30 selama 2 detik | Logika diuji (82 tes). FPS di laptop tanpa GPU khusus belum diukur |
| F4: tambah objek dan buka panel tanpa menghentikan simulasi | Kode ada (B, Tab), belum diuji di browser |
| F7 (sebagian): menu utama dengan 6 entri | Ada. Pengaturan dan Editor perintah nonaktif sampai Fase 4/5 |

## Belum dikerjakan

- Tab Notebook (opsional di spec) dan command bar terpisah (Enter membuka editor penuh).
- Editor hanya bisa dipakai dengan keyboard dan mouse (tidak dari controller).
- Panel Tab (Deteksi, Jalur A*, Auto-hindari, Auto-pilot) hanya menyimpan status. A* JS dan pemakaian `detect`/`decide` dari AI belum ada.
- Mock server tidak punya `plan`.
- Controller tidak punya tombol tambah objek. Kamera drone (PIP) tidak mengikuti mode kamera V.
- Tombol untuk mengubah sudut gimbal (sekarang hanya lewat skrip `look()`), foto kecil di laporan inspeksi, penilai estetika VLM (bonus M2).
- Pengaturan tidak bisa dibuka dari menu Jeda, hanya dari menu utama. Tombol controller tidak bisa diubah (spec hanya meminta remap keyboard).
- Id misi mengikuti file Orang 3 (`m4_delivery`). Perlu dikonfirmasi dengan Orang 3.

## Perbaikan controller (setelah uji pertama)

- Stik kanan "selalu maju": penyebab dugaan = pada controller non-standar (`mapping` kosong) `axes[3]` adalah pemicu (L2) yang diam di -1. Sekarang `pickStickAxes` memilih 4 sumbu stik asli (nilai diam di dekat 0) kalau mapping bukan `standard`.
- Aktivitas controller dihitung dari PERUBAHAN sumbu (>0.03) atau tombol ditekan, bukan dari nilai yang menetap. Controller diam tidak merebut kendali dari keyboard.
- Controller mati: event `gamepaddisconnected` atau `getGamepads()` kosong langsung mengembalikan perangkat ke keyboard dan menolkan aksi.
- Tombol debug: tekan ` (backtick) untuk panel id, mapping, nilai sumbu, dan sumbu terpilih. Kalau stik masih salah, kirim isi panel ini.
- Batas: indeks tombol pada controller non-standar bisa berbeda. Hanya sumbu yang dikoreksi.

## Batas ketinggian drone

Batas atas dihitung dari titik lepas landas, seperti drone sungguhan (DJI default 120 m), dan tidak lebih dari 120 m di atas tanah (aturan 400 ft). Di lereng tinggi drone tetap boleh naik minimal 30 m di atas tanah supaya tidak tersangkut gunung. Nilai `maxAgl` semua peta realistis: 120 m (dulu 60 m dari tanah, jadi di tanah tinggi bisa terbang lebih tinggi).

Di peta realistis batas ini bukan tembok. Di atas batas: peringatan di layar 10 detik (`ALT_GRACE`, kira-kira jeda failsafe sinyal DJI). Lewat itu baling-baling, kamera, baterai dan rangka rusak bertahap, dan drone gagal lalu jatuh di detik ke-30 (`ALT_FAIL`). Turun kembali di bawah batas meredakan peringatan 2x lebih cepat, tapi kerusakan yang sudah terjadi tetap. Dunia misi (peta generate) tetap memakai langit-langit 50 m.

## Kamera tidak tembus tanah

Saat drone mendarat, kamera drone (PIP) dinaikkan sampai tanah di bawah dan di depan lensa tertutup, jadi tidak tembus ke bawah. Kamera ikut dan kamera depan juga memeriksa tanah di bawahnya dan tidak pernah turun di bawah kaki drone.

Mode "Kamera depan drone" (tombol V): layar penuh menampilkan gambar kamera drone yang sama dengan popup (ikut gimbal dan miring badan drone), dan popup "Kamera drone" disembunyikan. Di mode lain popup tetap tampil. Kalau kamera rusak, layar jadi hitam.

## Zoom kamera drone

Zoom 1x sampai 6x (`ZOOM` di `camera-model.js`), kira-kira drone konsumen asli: Mini 4 Pro 4x, Air 3 3x optik plus digital, Mavic 3 Pro sampai 7x. Tombol `=` zoom masuk dan `-` zoom keluar (bisa ditahan), atau roda mouse; di controller tombol Back mengganti 1x, 2x, 3x, 4x, 6x. Tombol bisa diubah di Pengaturan. Zoom mempersempit sudut pandang kamera drone (popup dan layar penuh mode kamera depan), dan ikut menghitung objek yang terlihat: area di foto mengecil, jarak lihat bertambah sebanding zoom. Level zoom ditulis di label popup, atau di atas layar saat mode kamera depan.

## Arah kamera saat diam (gimbal)

Drone asli melayang tetap lurus; yang miring adalah gimbal kamera. Di sini juga begitu: drone diam di udara (stick di tengah), kamera diarahkan dengan `↑` / `↓` (ditahan, 45°/detik, rentang −90° sampai +30°), `Home` meluruskan kamera ke 0°, dan tombol Y di controller berganti 0°, −30°, −45°, −90°. Sudut ditampilkan di label popup (atau di atas layar saat mode kamera depan) dan ikut menghitung objek yang terlihat di foto dan skor. Dipasangkan dengan zoom dan mode kamera depan untuk mendapat sudut pandang serong.

Kamera juga bisa diputar miring (roll, sudut serong): `[` miring kiri, `]` miring kanan (ditahan, 45°/detik, maksimal 45° tiap sisi), `Home` meluruskan semuanya. Sudutnya ditulis di label kamera (↻ kanan, ↺ kiri) dan dihitung di skor "horizon rata" pada foto. Belum ada tombol controller untuk roll.

Gimbal bergerak seperti motor gimbal asli, bukan melompat: `Home`, tombol Y, dan perintah `look` menggerakkan kamera dengan animasi (mulai pelan, maksimal 120°/detik, melambat di ujung, sekitar 0,5 sampai 1 detik untuk sudut besar). Kamera pada model drone ikut bergerak.
