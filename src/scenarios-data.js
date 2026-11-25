// Data skenario misi utama di peta realistis (public/scenes/<id>): titik korban, api, bidikan, lahan, paket, panel dan cacat.
// Koordinat dunia simulator (pad H di 0, 0, 0), sama dengan scene.json. Bentuk `mission` sama dengan config.mission misi
// prosedural (worldconfig.js), jadi missions.js, scoring.js, vision.js dan agri.js memakainya tanpa perubahan.
// Kunci: "<mission_id>:<varian>". tests/scenarios.test.js memeriksa semua titik terhadap scene.json (batas, collider, jangkauan).
export const SCENARIOS = {
 "m1_sar:gedung": {
  "scene": "s1_gedung_terbakar",
  "title": "Gedung perkantoran terbakar",
  "brief": "Api menjalar di gedung kantor. Cari semua korban sebelum api dan baterai menghabiskan waktu.",
  "mission": {
   "variant": "gedung",
   "area": {
    "min": [
     -40,
     -85
    ],
    "max": [
     60,
     5
    ]
   },
   "victims": [
    {
     "id": 1,
     "x": -3,
     "z": -45,
     "y": 16.82
    },
    {
     "id": 2,
     "x": 5,
     "z": -30,
     "y": 0.02
    },
    {
     "id": 3,
     "x": -10,
     "z": -30,
     "y": 0.02
    },
    {
     "id": 4,
     "x": 30,
     "z": -45,
     "y": 0.0
    },
    {
     "id": 5,
     "x": 24,
     "z": -16,
     "y": 0.0
    }
   ],
   "fires": [
    {
     "id": 1,
     "x": 17.4,
     "z": -28,
     "r": 6,
     "y": 0
    },
    {
     "id": 2,
     "x": 12,
     "z": -38,
     "r": 5,
     "y": 10
    },
    {
     "id": 3,
     "x": 8,
     "z": -47,
     "r": 5,
     "y": 0
    }
   ],
   "smoke": [
    {
     "id": 1,
     "x": -3,
     "z": -45,
     "r": 7,
     "h": 26
    },
    {
     "id": 2,
     "x": 5,
     "z": -30,
     "r": 7,
     "h": 26
    },
    {
     "id": 3,
     "x": 17.4,
     "z": -28,
     "r": 9,
     "h": 24
    },
    {
     "id": 4,
     "x": 12,
     "z": -38,
     "r": 9,
     "h": 24
    }
   ],
   "safe": {
    "x": -20,
    "z": -10,
    "r": 4
   },
   "markRadius": 5
  }
 },
 "m1_sar:hutan": {
  "scene": "s2_hutan_terbakar",
  "title": "Hutan terbakar",
  "brief": "Kebakaran hutan memutus jalur pendaki. Temukan mereka di celah pepohonan dan hindari zona api.",
  "mission": {
   "variant": "hutan",
   "area": {
    "min": [
     -150,
     20
    ],
    "max": [
     80,
     215
    ]
   },
   "victims": [
    {
     "id": 1,
     "x": -49,
     "z": 46,
     "y": -9.68
    },
    {
     "id": 2,
     "x": -13,
     "z": 103,
     "y": -6.31
    },
    {
     "id": 3,
     "x": -97,
     "z": 184,
     "y": -21.97
    },
    {
     "id": 4,
     "x": 41,
     "z": 208,
     "y": -24.6
    }
   ],
   "fires": [
    {
     "id": 1,
     "x": -21,
     "z": 62,
     "r": 14,
     "y": -7.53
    },
    {
     "id": 2,
     "x": 10,
     "z": 93,
     "r": 11,
     "y": -4.22
    },
    {
     "id": 3,
     "x": -36,
     "z": 97,
     "r": 10,
     "y": -11.66
    },
    {
     "id": 4,
     "x": -90,
     "z": 155,
     "r": 16,
     "y": -19.66
    },
    {
     "id": 5,
     "x": 46,
     "z": 172,
     "r": 14,
     "y": -21.26
    }
   ],
   "smoke": [
    {
     "id": 1,
     "x": -49,
     "z": 46,
     "r": 8,
     "h": 30
    },
    {
     "id": 2,
     "x": -13,
     "z": 103,
     "r": 8,
     "h": 30
    },
    {
     "id": 3,
     "x": -21,
     "z": 62,
     "r": 18,
     "h": 28
    },
    {
     "id": 4,
     "x": 10,
     "z": 93,
     "r": 15,
     "h": 28
    },
    {
     "id": 5,
     "x": -36,
     "z": 97,
     "r": 14,
     "h": 28
    },
    {
     "id": 6,
     "x": -90,
     "z": 155,
     "r": 20,
     "h": 28
    },
    {
     "id": 7,
     "x": 46,
     "z": 172,
     "r": 18,
     "h": 28
    }
   ],
   "safe": {
    "x": 11,
    "z": 22,
    "r": 4
   },
   "markRadius": 5
  }
 },
 "m2_foto:hotel": {
  "scene": "s3_resor_hotel",
  "title": "Resor hotel tepi laut",
  "brief": "Buat materi promosi resor: foto dan video fasad hotel serta kolam renang. Cahaya terbaik datang dari arah laut.",
  "mission": {
   "variant": "hotel",
   "sun": {
    "az": 200,
    "el": 38
   },
   "landmarks": [
    {
     "id": "hotel",
     "name": "Fasad hotel",
     "kind": "box",
     "x": 0,
     "y": -5,
     "z": 77,
     "hx": 31,
     "hy": 7
    },
    {
     "id": "kolam",
     "name": "Kolam renang",
     "kind": "pool",
     "x": 11,
     "y": -10.2,
     "z": 116.5,
     "hx": 19,
     "hy": 8,
     "w": 38,
     "d": 15
    },
    {
     "id": "atap",
     "name": "Atap hotel",
     "kind": "roof",
     "x": 0,
     "y": 0.4,
     "z": 77,
     "hx": 30,
     "hy": 2
    }
   ],
   "main": "hotel",
   "second": "kolam",
   "orbit": "hotel",
   "reveal": "hotel"
  }
 },
 "m2_foto:gunung": {
  "scene": "s4_gunung_danau",
  "title": "Pegunungan dan danau",
  "brief": "Dokumentasikan puncak gunung dan danau di kakinya untuk film dokumenter alam.",
  "mission": {
   "variant": "gunung",
   "sun": {
    "az": 190,
    "el": 42
   },
   "landmarks": [
    {
     "id": "puncak",
     "name": "Puncak",
     "kind": "peak",
     "x": 260,
     "y": 400,
     "z": -632,
     "hx": 175,
     "hy": 110,
     "r": 175,
     "h": 110,
     "range": 900
    },
    {
     "id": "danau",
     "name": "Danau",
     "kind": "lake",
     "x": -70,
     "y": -4,
     "z": -50,
     "hx": 60,
     "hy": 15,
     "r": 60,
     "range": 400
    }
   ],
   "main": "puncak",
   "second": "danau",
   "orbit": "danau",
   "reveal": "puncak"
  }
 },
 "m3_agri:sawah": {
  "scene": "s5_sawah",
  "title": "Sawah",
  "brief": "Semprot petak padi secara merata. Hindari gubuk petani dan perhatikan angin; tangki diisi ulang di H.",
  "mission": {
   "variant": "sawah",
   "field": {
    "min": [
     -30,
     -68
    ],
    "max": [
     0,
     -40
    ],
    "cell": 2,
    "y": 0.8
   },
   "noSpray": [
    {
     "min": [
      -18,
      -57
     ],
     "max": [
      -12,
      -49
     ],
     "kind": "house"
    }
   ],
   "dose": {
    "lo": 0.4,
    "hi": 1.2,
    "flow": 10,
    "capacity": 200
   }
  },
  "wind": {
   "speed": 1.5,
   "dir": 270,
   "gust": 0.2
  }
 },
 "m4_delivery:kota": {
  "scene": "s6_kota_pengiriman",
  "title": "Kawasan perkotaan",
  "brief": "Ambil paket di depo, antar ke klinik. Dua zona terlarang menghalangi jalan lurus.",
  "mission": {
   "pickup": {
    "x": -29,
    "z": 2,
    "r": 3
   },
   "drop": {
    "x": -57,
    "z": -125,
    "r": 4
   },
   "noFly": [
    {
     "min": [
      -60,
      -72
     ],
     "max": [
      -36,
      -48
     ]
    },
    {
     "min": [
      -50,
      -110
     ],
     "max": [
      -26,
      -90
     ]
    }
   ],
   "payload_kg": 1.5
  }
 },
 "m5_inspeksi:gedung": {
  "scene": "s7_inspeksi_gedung",
  "title": "Gedung bertingkat (inspeksi)",
  "brief": "Periksa keempat sisi menara setinggi 36 m. Foto dari jarak 3 sampai 8 m dan tandai setiap cacat.",
  "mission": {
   "variant": "gedung",
   "structure": {
    "x": 0,
    "z": -30,
    "w": 21.7,
    "d": 30.94,
    "y0": 0,
    "y1": 36
   },
   "panels": [
    {
     "id": 1,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": -7.23,
     "y": 9.0,
     "z": -45.57
    },
    {
     "id": 2,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": -7.23,
     "y": 27.0,
     "z": -45.57
    },
    {
     "id": 3,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 0.0,
     "y": 9.0,
     "z": -45.57
    },
    {
     "id": 4,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 0.0,
     "y": 27.0,
     "z": -45.57
    },
    {
     "id": 5,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 7.23,
     "y": 9.0,
     "z": -45.57
    },
    {
     "id": 6,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 7.23,
     "y": 27.0,
     "z": -45.57
    },
    {
     "id": 7,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": -7.23,
     "y": 9.0,
     "z": -14.43
    },
    {
     "id": 8,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": -7.23,
     "y": 27.0,
     "z": -14.43
    },
    {
     "id": 9,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 0.0,
     "y": 9.0,
     "z": -14.43
    },
    {
     "id": 10,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 0.0,
     "y": 27.0,
     "z": -14.43
    },
    {
     "id": 11,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 7.23,
     "y": 9.0,
     "z": -14.43
    },
    {
     "id": 12,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 7.23,
     "y": 27.0,
     "z": -14.43
    },
    {
     "id": 13,
     "face": "E",
     "nx": 1,
     "nz": 0,
     "x": 10.95,
     "y": 9.0,
     "z": -40.31
    },
    {
     "id": 14,
     "face": "E",
     "nx": 1,
     "nz": 0,
     "x": 10.95,
     "y": 27.0,
     "z": -40.31
    },
    {
     "id": 15,
     "face": "E",
     "nx": 1,
     "nz": 0,
     "x": 10.95,
     "y": 9.0,
     "z": -30.0
    },
    {
     "id": 16,
     "face": "E",
     "nx": 1,
     "nz": 0,
     "x": 10.95,
     "y": 27.0,
     "z": -30.0
    },
    {
     "id": 17,
     "face": "E",
     "nx": 1,
     "nz": 0,
     "x": 10.95,
     "y": 9.0,
     "z": -19.69
    },
    {
     "id": 18,
     "face": "E",
     "nx": 1,
     "nz": 0,
     "x": 10.95,
     "y": 27.0,
     "z": -19.69
    },
    {
     "id": 19,
     "face": "W",
     "nx": -1,
     "nz": 0,
     "x": -10.95,
     "y": 9.0,
     "z": -40.31
    },
    {
     "id": 20,
     "face": "W",
     "nx": -1,
     "nz": 0,
     "x": -10.95,
     "y": 27.0,
     "z": -40.31
    },
    {
     "id": 21,
     "face": "W",
     "nx": -1,
     "nz": 0,
     "x": -10.95,
     "y": 9.0,
     "z": -30.0
    },
    {
     "id": 22,
     "face": "W",
     "nx": -1,
     "nz": 0,
     "x": -10.95,
     "y": 27.0,
     "z": -30.0
    },
    {
     "id": 23,
     "face": "W",
     "nx": -1,
     "nz": 0,
     "x": -10.95,
     "y": 9.0,
     "z": -19.69
    },
    {
     "id": 24,
     "face": "W",
     "nx": -1,
     "nz": 0,
     "x": -10.95,
     "y": 27.0,
     "z": -19.69
    }
   ],
   "defects": [
    {
     "id": 1,
     "kind": "retak",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 1.03,
     "x": -0.71,
     "y": 8.24,
     "z": -14.43
    },
    {
     "id": 2,
     "kind": "karat",
     "face": "W",
     "nx": -1,
     "nz": 0,
     "size": 1.41,
     "x": -10.95,
     "y": 26.36,
     "z": -29.37
    },
    {
     "id": 3,
     "kind": "retak",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 1.37,
     "x": -6.95,
     "y": 8.74,
     "z": -14.43
    },
    {
     "id": 4,
     "kind": "karat",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 0.89,
     "x": 6.36,
     "y": 8.12,
     "z": -14.43
    },
    {
     "id": 5,
     "kind": "retak",
     "face": "N",
     "nx": 0,
     "nz": -1,
     "size": 1.04,
     "x": 0.36,
     "y": 26.86,
     "z": -45.57
    },
    {
     "id": 6,
     "kind": "karat",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 1.02,
     "x": 7.4,
     "y": 26.91,
     "z": -14.43
    },
    {
     "id": 7,
     "kind": "retak",
     "face": "E",
     "nx": 1,
     "nz": 0,
     "size": 0.94,
     "x": 10.95,
     "y": 9.4,
     "z": -29.41
    }
   ],
   "safe": {
    "min": 3,
    "max": 8
   }
  }
 },
 "m5_inspeksi:jembatan": {
  "scene": "s7b_inspeksi_jembatan",
  "title": "Jembatan gantung (inspeksi)",
  "brief": "Periksa kedua sisi dek jembatan gantung dari atas sungai. Foto dari jarak 3 sampai 8 m dan tandai setiap cacat.",
  "mission": {
   "variant": "jembatan",
   "structure": {
    "x": 90,
    "z": 0,
    "w": 112,
    "d": 10.16,
    "y0": -3.01,
    "y1": 0.72
   },
   "panels": [
    {
     "id": 1,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 43.33,
     "y": -1.15,
     "z": -5.18
    },
    {
     "id": 2,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 62.0,
     "y": -1.15,
     "z": -5.18
    },
    {
     "id": 3,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 80.67,
     "y": -1.15,
     "z": -5.18
    },
    {
     "id": 4,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 99.33,
     "y": -1.15,
     "z": -5.18
    },
    {
     "id": 5,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 118.0,
     "y": -1.15,
     "z": -5.18
    },
    {
     "id": 6,
     "face": "N",
     "nx": 0,
     "nz": -1,
     "x": 136.67,
     "y": -1.15,
     "z": -5.18
    },
    {
     "id": 7,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 43.33,
     "y": -1.15,
     "z": 5.18
    },
    {
     "id": 8,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 62.0,
     "y": -1.15,
     "z": 5.18
    },
    {
     "id": 9,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 80.67,
     "y": -1.15,
     "z": 5.18
    },
    {
     "id": 10,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 99.33,
     "y": -1.15,
     "z": 5.18
    },
    {
     "id": 11,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 118.0,
     "y": -1.15,
     "z": 5.18
    },
    {
     "id": 12,
     "face": "S",
     "nx": 0,
     "nz": 1,
     "x": 136.67,
     "y": -1.15,
     "z": 5.18
    },
    {
     "id": 13,
     "face": "E",
     "nx": 1,
     "nz": 0,
     "x": 146.1,
     "y": -1.15,
     "z": 0.0
    },
    {
     "id": 14,
     "face": "W",
     "nx": -1,
     "nz": 0,
     "x": 33.9,
     "y": -1.15,
     "z": 0.0
    }
   ],
   "defects": [
    {
     "id": 1,
     "kind": "retak",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 1.04,
     "x": 136.82,
     "y": -0.4,
     "z": 5.18
    },
    {
     "id": 2,
     "kind": "karat",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 1.41,
     "x": 43.72,
     "y": -0.96,
     "z": 5.18
    },
    {
     "id": 3,
     "kind": "retak",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 1.92,
     "x": 99.24,
     "y": -0.47,
     "z": 5.18
    },
    {
     "id": 4,
     "kind": "karat",
     "face": "N",
     "nx": 0,
     "nz": -1,
     "size": 0.68,
     "x": 117.95,
     "y": -0.82,
     "z": -5.18
    },
    {
     "id": 5,
     "kind": "retak",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 1.99,
     "x": 62.4,
     "y": -0.86,
     "z": 5.18
    },
    {
     "id": 6,
     "kind": "karat",
     "face": "S",
     "nx": 0,
     "nz": 1,
     "size": 1.14,
     "x": 118.64,
     "y": -1.58,
     "z": 5.18
    }
   ],
   "safe": {
    "min": 3,
    "max": 8
   }
  }
 }
};
