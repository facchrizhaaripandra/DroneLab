# DroneLab3D: generator geometri gedung, murni Python (tanpa bpy) supaya bisa diuji di luar Blender.
# Koordinat Blender: X, Y datar, Z ke atas, meter. Geo mengumpulkan verteks, muka (dengan nama material) dan UV
# proyeksi kotak (UV = koordinat dunia / ukuran ubin material), lalu bld_lib.py mengubahnya jadi objek Blender.
import math

TILE = {"default": 3.0}


class Geo:
    def __init__(self, tile=None):
        self.v, self.f, self.fm, self.uv = [], [], [], []   # verts, faces (index tuples), face material, per-loop uv
        self.tile = dict(TILE, **(tile or {}))

    # ---- primitif ----
    def face(self, mat, pts):
        i0 = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(tuple(range(i0, i0 + len(pts))))
        self.fm.append(mat)
        # proyeksi kotak menurut sumbu normal terbesar
        n = _normal(pts)
        ax = max(range(3), key=lambda k: abs(n[k]))
        t = self.tile.get(mat, self.tile["default"])
        uv = []
        for p in pts:
            if ax == 0: uv.append((p[1] / t, p[2] / t))
            elif ax == 1: uv.append((p[0] / t, p[2] / t))
            else: uv.append((p[0] / t, p[1] / t))
        self.uv.append(uv)

    def mesh(self, mat, pts, faces, mats=None):
        """Satu primitif tertutup: titik dipakai bersama antar muka (satu bagian terhubung = satu collider)."""
        i0 = len(self.v)
        self.v += [tuple(p) for p in pts]
        for k, q in enumerate(faces):
            m = mats[k] if mats else mat
            fp = [pts[i] for i in q]
            self.f.append(tuple(i0 + i for i in q)); self.fm.append(m)
            n = _normal(fp); ax = max(range(3), key=lambda a: abs(n[a]))
            t = self.tile.get(m, self.tile["default"])
            self.uv.append([((p[1] if ax == 0 else p[0]) / t, (p[2] if ax != 2 else p[1]) / t) for p in fp])

    def box(self, mat, x0, y0, z0, x1, y1, z1, skip=()):
        x0, x1 = min(x0, x1), max(x0, x1); y0, y1 = min(y0, y1), max(y0, y1); z0, z1 = min(z0, z1), max(z0, z1)
        if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4: return
        P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        F = {"-z": (0, 3, 2, 1), "+z": (4, 5, 6, 7), "-y": (0, 1, 5, 4), "+y": (2, 3, 7, 6), "-x": (3, 0, 4, 7), "+x": (1, 2, 6, 5)}
        self.mesh(mat, P, [q for k, q in F.items() if k not in skip])

    def cyl(self, mat, cx, cy, z0, z1, r, seg=12, cap=True):
        ring = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        P = [(x, y, z0) for x, y in ring] + [(x, y, z1) for x, y in ring]
        F = [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)]
        if cap:
            F += [tuple(seg + i for i in range(seg)), tuple(reversed(range(seg)))]
        self.mesh(mat, P, F)

    def _prim(self, fn):
        """Jalankan fn yang memanggil self.face, lalu satukan titik berimpit di primitif itu saja."""
        v0, f0 = len(self.v), len(self.f)
        fn()
        key, nv, remap = {}, [], {}
        for i in range(v0, len(self.v)):
            k = tuple(round(c, 5) for c in self.v[i])
            if k not in key: key[k] = v0 + len(nv); nv.append(self.v[i])
            remap[i] = key[k]
        self.v[v0:] = nv
        for j in range(f0, len(self.f)):
            self.f[j] = tuple(remap[i] for i in self.f[j])

    def gable(self, mat, x0, y0, x1, y1, z0, z1, axis="x", over=0.0, gable_mat=None):
        self._prim(lambda: self._gable(mat, x0, y0, x1, y1, z0, z1, axis, over, gable_mat))

    def hip(self, mat, x0, y0, x1, y1, z0, z1, over=0.0):
        self._prim(lambda: self._hip(mat, x0, y0, x1, y1, z0, z1, over))

    def _gable(self, mat, x0, y0, x1, y1, z0, z1, axis="x", over=0.0, gable_mat=None):
        """Atap pelana: bubungan sepanjang `axis`, ujung segitiga diberi gable_mat (dinding) bila ada."""
        if axis == "x":
            ym = (y0 + y1) / 2
            a, b = (x0 - over, y0 - over), (x1 + over, y1 + over)
            self.face(mat, [(a[0], a[1], z0), (b[0], a[1], z0), (b[0], ym, z1), (a[0], ym, z1)])
            self.face(mat, [(b[0], b[1], z0), (a[0], b[1], z0), (a[0], ym, z1), (b[0], ym, z1)])
            gm = gable_mat or mat
            self.face(gm, [(x0, y1, z0), (x0, y0, z0), (x0, ym, z1)])
            self.face(gm, [(x1, y0, z0), (x1, y1, z0), (x1, ym, z1)])
        else:
            xm = (x0 + x1) / 2
            a, b = (x0 - over, y0 - over), (x1 + over, y1 + over)
            self.face(mat, [(a[0], b[1], z0), (a[0], a[1], z0), (xm, a[1], z1), (xm, b[1], z1)])
            self.face(mat, [(b[0], a[1], z0), (b[0], b[1], z0), (xm, b[1], z1), (xm, a[1], z1)])
            gm = gable_mat or mat
            self.face(gm, [(x0, y0, z0), (x1, y0, z0), (xm, y0, z1)])
            self.face(gm, [(x1, y1, z0), (x0, y1, z0), (xm, y1, z1)])

    def _hip(self, mat, x0, y0, x1, y1, z0, z1, over=0.0):
        """Atap limasan (perisai): empat bidang miring, bubungan pendek di tengah (atau puncak bila persegi)."""
        x0 -= over; y0 -= over; x1 += over; y1 += over
        w, d = x1 - x0, y1 - y0
        h = z1 - z0
        if w >= d:
            r = (d / 2); a, b = (x0 + r, (y0 + y1) / 2), (x1 - r, (y0 + y1) / 2)
        else:
            r = (w / 2); a, b = ((x0 + x1) / 2, y0 + r), ((x0 + x1) / 2, y1 - r)
        A, B = (a[0], a[1], z1), (b[0], b[1], z1)
        c00, c10, c11, c01 = (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)
        if w >= d:
            self.face(mat, [c00, c10, B, A]); self.face(mat, [c11, c01, A, B])
            self.face(mat, [c01, c00, A]); self.face(mat, [c10, c11, B])
        else:
            self.face(mat, [c10, c11, B, A]); self.face(mat, [c01, c00, A, B])
            self.face(mat, [c00, c10, A]); self.face(mat, [c11, c01, B])

    def pyramid(self, mat, cx, cy, w, d, z0, z1):
        self.hip(mat, cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, z0, z1)

    # ---- bantu ----
    def ring(self, mat, x0, y0, x1, y1, z0, z1, t):
        """Dinding keliling setebal t (parapet, pagar)."""
        self.box(mat, x0, y0, z0, x1, y0 + t, z1); self.box(mat, x0, y1 - t, z0, x1, y1, z1)
        self.box(mat, x0, y0 + t, z0, x0 + t, y1 - t, z1); self.box(mat, x1 - t, y0 + t, z0, x1, y1 - t, z1)

    def move(self, dx, dy, dz):
        self.v = [(x + dx, y + dy, z + dz) for (x, y, z) in self.v]
        return self

    def extend(self, other):
        off = len(self.v)
        self.v += other.v
        self.f += [tuple(i + off for i in f) for f in other.f]
        self.fm += other.fm; self.uv += other.uv

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.f)


def _normal(pts):
    nx = ny = nz = 0.0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1])
    return (nx, ny, nz)


# ======================================================================================================
# Gedung. Semua fungsi menerima kotak lahan (x0, y0, x1, y1) dan tinggi total h, menulis ke Geo g.
# front: sisi depan ('-y', '+y', '-x', '+x') tempat pintu masuk / kanopi.
# ======================================================================================================

def _faces_of(x0, y0, x1, y1):
    """Empat muka: (nama, titik awal, titik akhir, arah keluar)."""
    return [("-y", (x0, y0), (x1, y0), (0, -1)), ("+x", (x1, y0), (x1, y1), (1, 0)),
            ("+y", (x1, y1), (x0, y1), (0, 1)), ("-x", (x0, y1), (x0, y0), (-1, 0))]


def office(g, x0, y0, x1, y1, h, m, style="curtain", front="-y", floor=3.8, podium=5.6):
    """Kantor bertingkat. m = {facade, glass, roof, frame, lobby_glass}. style: curtain | fins | grid.
    Lobi dua lantai, menara kaca dengan pita lantai dan rangka vertikal, mahkota, ruang mesin dan unit AC di atap."""
    fac, gl, roof = m["facade"], m["glass"], m["roof"]
    frame = m.get("frame", fac)
    inset = 0.6
    top = h - 1.4                       # atap menara; mahkota 1,4 m di atasnya
    # lobi: kaca tinggi di dalam deretan kolom
    g.box(m.get("lobby_glass", gl), x0 + 0.8, y0 + 0.8, 0, x1 - 0.8, y1 - 0.8, podium - 0.4)
    ncx, ncy = max(2, round((x1 - x0) / 6)), max(2, round((y1 - y0) / 6))
    for i in range(ncx + 1):
        for yy in (y0, y1 - 0.6):
            x = x0 + i * (x1 - x0 - 0.6) / ncx
            g.box(fac, x, yy, 0, x + 0.6, yy + 0.6, podium)
    for j in range(1, ncy):
        for xx in (x0, x1 - 0.6):
            y = y0 + j * (y1 - y0 - 0.6) / ncy
            g.box(fac, xx, y, 0, xx + 0.6, y + 0.6, podium)
    g.box(fac, x0, y0, podium - 0.4, x1, y1, podium + 0.4)   # balok transfer di atas lobi
    _canopy(g, x0, y0, x1, y1, front, podium - 1.2, frame)
    # menara
    tx0, ty0, tx1, ty1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    g.box(gl, tx0 + 0.15, ty0 + 0.15, podium + 0.4, tx1 - 0.15, ty1 - 0.15, top)
    nfl = max(1, int((top - podium - 0.4) / floor))
    for k in range(nfl + 1):
        z = podium + 0.4 + k * floor
        if z > top - 0.3: z = top - 0.6
        band = 0.9 if style != "grid" else 1.3
        g.ring(fac if style != "curtain" else frame, tx0, ty0, tx1, ty1, z, min(top, z + band), 0.25)
    for name, a, b, n in _faces_of(tx0, ty0, tx1, ty1):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        step = {"curtain": 1.5, "fins": 3.0, "grid": 3.0}[style]
        depth = {"curtain": 0.12, "fins": 0.6, "grid": 0.35}[style]
        wid = {"curtain": 0.08, "fins": 0.25, "grid": 0.6}[style]
        cnt = max(1, int(L / step))
        for i in range(1, cnt):
            s = i * L / cnt
            cx, cy = a[0] + ux * s, a[1] + uy * s
            px0, py0 = cx - ux * wid / 2, cy - uy * wid / 2
            px1, py1 = cx + ux * wid / 2 + n[0] * depth, cy + uy * wid / 2 + n[1] * depth
            g.box(frame if style == "curtain" else fac, px0, py0, podium + 0.4, px1, py1, top)
    for cx, cy in ((tx0, ty0), (tx1, ty0), (tx1, ty1), (tx0, ty1)):   # kolom sudut
        g.box(fac, cx - 0.45, cy - 0.45, podium + 0.4, cx + 0.45, cy + 0.45, top)
    # atap dan mahkota
    g.box(roof, tx0, ty0, top - 0.3, tx1, ty1, top)
    g.ring(fac, tx0 - 0.2, ty0 - 0.2, tx1 + 0.2, ty1 + 0.2, top - 0.3, h, 0.35)
    _roof_plant(g, tx0, ty0, tx1, ty1, top, m)


def _canopy(g, x0, y0, x1, y1, front, z, mat):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w = min(9.0, 0.45 * ((x1 - x0) if front in ("-y", "+y") else (y1 - y0)))
    if front == "-y": g.box(mat, cx - w / 2, y0 - 2.5, z, cx + w / 2, y0 + 0.6, z + 0.3)
    elif front == "+y": g.box(mat, cx - w / 2, y1 - 0.6, z, cx + w / 2, y1 + 2.5, z + 0.3)
    elif front == "-x": g.box(mat, x0 - 2.5, cy - w / 2, z, x0 + 0.6, cy + w / 2, z + 0.3)
    else: g.box(mat, x1 - 0.6, cy - w / 2, z, x1 + 2.5, cy + w / 2, z + 0.3)


def _roof_plant(g, x0, y0, x1, y1, z, m, lift=True):
    """Ruang mesin lift, unit AC, tandon: semua di dalam batas atap."""
    w, d = x1 - x0, y1 - y0
    mr = m.get("plant", m["roof"])
    if lift:
        g.box(mr, x0 + w * 0.15, y0 + d * 0.2, z, x0 + w * 0.15 + min(7, w * 0.35), y0 + d * 0.2 + min(5, d * 0.35), z + 3.0)
    ac = m.get("ac", mr)
    n = max(2, int(w / 4))
    for i in range(n):
        ax = x0 + w * 0.55 + (i % 3) * 1.9
        ay = y0 + d * 0.6 + (i // 3) * 1.7
        if ax + 1.4 < x1 - 0.8 and ay + 1.2 < y1 - 0.8:
            g.box(ac, ax, ay, z, ax + 1.4, ay + 1.2, z + 1.1)


def tower(g, x0, y0, x1, y1, h, m, roof_z, front="-y"):
    """Menara landmark: alas lebar 8 m, badan kaca berangka dengan sudut menyerong, mahkota di bawah helipad."""
    fac, gl = m["facade"], m["glass"]
    g.box(fac, x0, y0, 0, x1, y1, 1.0)                                  # alas batu
    g.box(m.get("lobby_glass", gl), x0 + 1.0, y0 + 1.0, 1.0, x1 - 1.0, y1 - 1.0, 8.0)
    for i in range(7):
        t = i / 6.0
        for (ax, ay, bx, by) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            g.box(fac, px - 0.5, py - 0.5, 1.0, px + 0.5, py + 0.5, 8.0)
    g.box(fac, x0, y0, 8.0, x1, y1, 9.0)
    i0 = 1.5
    tx0, ty0, tx1, ty1 = x0 + i0, y0 + i0, x1 - i0, y1 - i0
    ch = 3.0  # sudut menyerong: kotak inti + empat sisi
    g.box(gl, tx0 + ch, ty0, 9.0, tx1 - ch, ty1, roof_z - 1.2)
    g.box(gl, tx0, ty0 + ch, 9.0, tx1, ty1 - ch, roof_z - 1.2)
    nfl = int((roof_z - 10.2) / 3.8)
    for k in range(nfl + 1):
        z = 9.0 + k * 3.8
        g.box(fac, tx0 + ch - 0.2, ty0 - 0.2, z, tx1 - ch + 0.2, ty1 + 0.2, z + 0.5)
        g.box(fac, tx0 - 0.2, ty0 + ch - 0.2, z, tx1 + 0.2, ty1 - ch + 0.2, z + 0.5)
    for (fx0, fy0, fx1, fy1, n) in ((tx0 + ch, ty0, tx1 - ch, ty0, (0, -1)), (tx0 + ch, ty1, tx1 - ch, ty1, (0, 1)),
                                    (tx0, ty0 + ch, tx0, ty1 - ch, (-1, 0)), (tx1, ty0 + ch, tx1, ty1 - ch, (1, 0))):
        L = math.hypot(fx1 - fx0, fy1 - fy0); cnt = int(L / 1.5)
        for i in range(1, cnt):
            s = i / cnt; cx, cy = fx0 + (fx1 - fx0) * s, fy0 + (fy1 - fy0) * s
            g.box(m.get("frame", fac), cx - 0.05 + min(0, n[0] * 0.15), cy - 0.05 + min(0, n[1] * 0.15), 9.0,
                  cx + 0.05 + max(0, n[0] * 0.15), cy + 0.05 + max(0, n[1] * 0.15), roof_z - 1.2)
    g.box(fac, tx0, ty0, roof_z - 1.2, tx1, ty1, roof_z)                # mahkota (helipad di atasnya)


def hospital(g, x0, y0, x1, y1, h, m, floor=3.6):
    """Rumah sakit: dinding putih berjendela dengan pita sirip peneduh, tangga darurat, parapet."""
    fac, gl = m["facade"], m["glass"]
    top = h - 1.0
    g.box(gl, x0 + 0.3, y0 + 0.3, 0.1, x1 - 0.3, y1 - 0.3, top)
    nfl = max(1, int(top / floor))
    for k in range(nfl + 1):
        z = min(top - 0.2, k * floor)
        g.ring(fac, x0, y0, x1, y1, max(0, z - 0.15), z + (1.1 if k else 0.8), 0.3)
        if 0 < k < nfl:
            g.ring(m.get("frame", fac), x0 - 0.7, y0 - 0.7, x1 + 0.7, y1 + 0.7, z + 1.0, z + 1.12, 0.7)   # sirip peneduh
    for name, a, b, n in _faces_of(x0, y0, x1, y1):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        cnt = max(1, int(L / 3.6))
        for i in range(cnt + 1):
            s = i * L / cnt; cx, cy = a[0] + ux * s, a[1] + uy * s
            g.box(fac, cx - 0.35, cy - 0.35, 0, cx + 0.35, cy + 0.35, top)
    g.box(m["roof"], x0 + 0.3, y0 + 0.3, top - 0.3, x1 - 0.3, y1 - 0.3, top)
    g.ring(fac, x0, y0, x1, y1, top - 0.3, h, 0.3)
    _roof_plant(g, x0 + 1, y0 + 1, x1 - 1, y1 - 1, top, m)


def warehouse(g, x0, y0, x1, y1, h, m, eave=None, axis="x"):
    """Gudang rangka baja: dinding seng, kolom portal, atap pelana dengan jalur skylight, talang."""
    wall, roof = m["wall"], m["roof"]
    eave = eave or h * 0.72
    g.box(wall, x0 + 0.2, y0 + 0.2, 0, x1 - 0.2, y1 - 0.2, eave, skip=("+z",))
    g.box(m.get("plinth", wall), x0, y0, 0, x1, y1, 1.2, skip=("+z", "-z"))      # dinding beton bawah
    L = (x1 - x0) if axis == "x" else (y1 - y0)
    n = max(2, int(L / 6.0))
    for i in range(n + 1):
        s = i * L / n
        for side in (0, 1):
            if axis == "x":
                cx = x0 + s; cy = y0 if side == 0 else y1
                g.box(m.get("steel", wall), cx - 0.2, cy - 0.25, 0, cx + 0.2, cy + 0.25, eave)
            else:
                cy = y0 + s; cx = x0 if side == 0 else x1
                g.box(m.get("steel", wall), cx - 0.25, cy - 0.2, 0, cx + 0.25, cy + 0.2, eave)
    g.gable(roof, x0, y0, x1, y1, eave, h, axis=axis, over=0.5, gable_mat=wall)
    g.box(m.get("steel", wall), x0 - 0.5, y0 - 0.7, eave - 0.3, x1 + 0.5, y0 - 0.4, eave) if axis == "x" else None   # talang


def market_roof(g, x0, y0, x1, y1, z0, z1, m, bays=4, axis="x"):
    """Pasar: deretan atap pelana seng dengan bukaan ventilasi (atap gergaji rendah), kolom baja."""
    roof = m["roof"]
    W = (y1 - y0) if axis == "x" else (x1 - x0)
    bw = W / bays
    for k in range(bays):
        if axis == "x":
            a, b = y0 + k * bw, y0 + (k + 1) * bw
            g.gable(roof, x0, a, x1, b, z0, z1, axis="x", over=0.2)
            g.box(roof, x0, (a + b) / 2 - 0.9, z1 + 0.6, x1, (a + b) / 2 + 0.9, z1 + 0.7)   # tudung ventilasi
            for i in range(int((x1 - x0) / 6) + 1):
                cx = x0 + i * 6
                g.cyl(m.get("steel", roof), min(cx, x1), (a + b) / 2, 0.2, z1, 0.15, seg=6)
        else:
            a, b = x0 + k * bw, x0 + (k + 1) * bw
            g.gable(roof, a, y0, b, y1, z0, z1, axis="y", over=0.2)
            g.box(roof, (a + b) / 2 - 0.9, y0, z1 + 0.6, (a + b) / 2 + 0.9, y1, z1 + 0.7)
            for i in range(int((y1 - y0) / 6) + 1):
                cy = y0 + i * 6
                g.cyl(m.get("steel", roof), (a + b) / 2, min(cy, y1), 0.2, z1, 0.15, seg=6)
    for (cx, cy) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        g.box(m.get("steel", roof), cx - 0.2, cy - 0.2, 0.2, cx + 0.2, cy + 0.2, z0)


def house(g, x0, y0, x1, y1, m, front="-y", floors=1, roof="pelana", seed=0.0):
    """Rumah tinggal Indonesia: dinding bata plester 3,4 m per lantai, atap genteng pelana atau limasan dengan
    teritis 0,8 m, teras beratap dengan dua tiang di depan, pintu, jendela, pagar rendah di depan."""
    wall, rf = m["wall"], m["roof"]
    fl = 3.4
    terr = 2.2  # kedalaman teras
    bx0, by0, bx1, by1 = x0, y0, x1, y1
    if front == "-y": by0 += terr
    elif front == "+y": by1 -= terr
    elif front == "-x": bx0 += terr
    else: bx1 -= terr
    H = floors * fl
    g.box(m.get("plinth", wall), bx0 - 0.1, by0 - 0.1, 0, bx1 + 0.1, by1 + 0.1, 0.45)
    g.box(wall, bx0, by0, 0.45, bx1, by1, H)
    w, d = bx1 - bx0, by1 - by0
    ridge = H + 0.5 * min(w, d) * 0.6
    if roof == "limasan": g.hip(rf, bx0, by0, bx1, by1, H, ridge, over=0.8)
    else: g.gable(rf, bx0, by0, bx1, by1, H, ridge, axis="x" if w >= d else "y", over=0.8, gable_mat=wall)
    # teras
    tx0, ty0, tx1, ty1 = x0, y0, x1, y1
    if front == "-y": ty1 = by0
    elif front == "+y": ty0 = by1
    elif front == "-x": tx1 = bx0
    else: tx0 = bx1
    g.box(m.get("plinth", wall), tx0, ty0, 0, tx1, ty1, 0.35)
    g.box(rf, tx0 - 0.3, ty0 - 0.3, 2.9, tx1 + 0.3, ty1 + 0.3, 3.05)
    for (px, py) in _front_posts(tx0, ty0, tx1, ty1, front):
        g.box(m.get("post", wall), px - 0.12, py - 0.12, 0.35, px + 0.12, py + 0.12, 2.9)
    # pintu dan jendela di muka depan (sedikit menonjol supaya terlihat)
    win, door = m.get("window", wall), m.get("door", wall)
    for k in range(floors):
        z = 0.45 + k * fl
        _openings(g, bx0, by0, bx1, by1, front, z, win, door if k == 0 else None)
        for side in ("-x", "+x", "+y", "-y"):
            if side != front:
                _openings(g, bx0, by0, bx1, by1, side, z, win, None, count=1 if side in ("-x", "+x") else 2)


def _front_posts(x0, y0, x1, y1, front):
    if front in ("-y", "+y"):
        y = y0 + 0.2 if front == "-y" else y1 - 0.2
        return [(x0 + 0.3, y), (x1 - 0.3, y)]
    x = x0 + 0.2 if front == "-x" else x1 - 0.2
    return [(x, y0 + 0.3), (x, y1 - 0.3)]


def _openings(g, x0, y0, x1, y1, side, z, win, door, count=2):
    o = 0.04
    if side in ("-y", "+y"):
        y = y0 - o if side == "-y" else y1
        L = x1 - x0
        if door:
            cx = x0 + L * 0.5
            g.box(door, cx - 0.5, y, z, cx + 0.5, y + o, z + 2.1)
        for i in range(count):
            cx = x0 + L * (0.22 if i == 0 else 0.78) if count == 2 else x0 + L * 0.5
            if door and abs(cx - (x0 + L * 0.5)) < 1.0: continue
            g.box(win, cx - 0.6, y, z + 0.9, cx + 0.6, y + o, z + 2.2)
    else:
        x = x0 - o if side == "-x" else x1
        L = y1 - y0
        if door:
            cy = y0 + L * 0.5
            g.box(door, x, cy - 0.5, z, x + o, cy + 0.5, z + 2.1)
        for i in range(count):
            cy = y0 + L * (0.22 if i == 0 else 0.78) if count == 2 else y0 + L * 0.5
            if door and abs(cy - (y0 + L * 0.5)) < 1.0: continue
            g.box(win, x, cy - 0.6, z + 0.9, x + o, cy + 0.6, z + 2.2)


def ruko_unit_details(g, x0, y0, x1, y1, h, front, m, seed=0.0):
    """Tambahan per unit ruko yang sudah ada: pilaster pembatas, balkon berteralis di lantai 2, unit AC luar,
    tandon air di atap, list parapet. Ruko 3,6 m per lantai."""
    st = m.get("steel"); ac = m.get("ac"); tank = m.get("tank"); cap = m.get("cap")
    fl = 3.6
    floors = int(round(h / fl))
    if front in ("-y", "+y"):
        y = y0 if front == "-y" else y1; n = -1 if front == "-y" else 1
        for xx in (x0, x1):   # pilaster
            g.box(cap, xx - 0.15, y - 0.0 if n > 0 else y - 0.2, 0.0, xx + 0.15, y + 0.2 if n > 0 else y, h + 0.3)
        g.box(cap, x0, min(y, y + n * 0.3), h - 0.1, x1, max(y, y + n * 0.3), h + 0.3)   # list atas
        if floors >= 2:
            z = fl
            g.box(cap, x0 + 0.3, min(y, y + n * 0.9), z - 0.15, x1 - 0.3, max(y, y + n * 0.9), z)        # pelat balkon
            g.box(st, x0 + 0.3, y + n * 0.85 - 0.03, z, x1 - 0.3, y + n * 0.85 + 0.03, z + 1.1)             # teralis
            for i in range(int((x1 - x0 - 0.6) / 0.15)):
                xx = x0 + 0.35 + i * 0.15
                g.box(st, xx, y + n * 0.85 - 0.015, z, xx + 0.02, y + n * 0.85 + 0.015, z + 1.1) if i % 2 == 0 else None
        ax = x0 + (x1 - x0) * (0.25 + 0.5 * (seed % 1))
        za = fl * (1.75 if floors >= 3 else 1.4)
        g.box(ac, ax - 0.4, min(y, y + n * 0.35), za, ax + 0.4, max(y, y + n * 0.35), za + 0.55)
        ty = y - n * 3.0
        if seed % 1 > 0.25:
            g.cyl(tank, (x0 + x1) / 2, ty, h, h + 1.3, 0.55, seg=10)
    else:
        x = x0 if front == "-x" else x1; n = -1 if front == "-x" else 1
        for yy in (y0, y1):
            g.box(cap, x if n > 0 else x - 0.2, yy - 0.15, 0.0, x + 0.2 if n > 0 else x, yy + 0.15, h + 0.3)
        g.box(cap, min(x, x + n * 0.3), y0, h - 0.1, max(x, x + n * 0.3), y1, h + 0.3)
        if floors >= 2:
            z = fl
            g.box(cap, min(x, x + n * 0.9), y0 + 0.3, z - 0.15, max(x, x + n * 0.9), y1 - 0.3, z)
            g.box(st, x + n * 0.85 - 0.03, y0 + 0.3, z, x + n * 0.85 + 0.03, y1 - 0.3, z + 1.1)
        ay = y0 + (y1 - y0) * (0.25 + 0.5 * (seed % 1))
        za = fl * (1.75 if floors >= 3 else 1.4)
        g.box(ac, min(x, x + n * 0.35), ay - 0.4, za, max(x, x + n * 0.35), ay + 0.4, za + 0.55)
        if seed % 1 > 0.25:
            g.cyl(tank, x - n * 3.0, (y0 + y1) / 2, h, h + 1.3, 0.55, seg=10)


# ---- bangunan desa ----

def mushola(g, cx, cy, m, w=8.0, d=8.0, front="-y"):
    """Mushola desa: lantai panggung rendah, dinding putih, atap tumpang dua tingkat (limasan bersusun) dengan
    mustaka di puncak, serambi depan beratap, menara kecil di sudut."""
    wall, rf = m["wall"], m["roof"]
    x0, y0, x1, y1 = cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2
    g.box(m.get("plinth", wall), x0 - 1.5, y0 - 3.0, 0, x1 + 1.5, y1 + 0.5, 0.6)
    g.box(wall, x0, y0, 0.6, x1, y1, 4.2)
    _openings(g, x0, y0, x1, y1, front, 0.6, m.get("window", wall), m.get("door", wall))
    for s in ("-x", "+x"): _openings(g, x0, y0, x1, y1, s, 0.6, m.get("window", wall), None)
    g.hip(rf, x0, y0, x1, y1, 4.2, 5.6, over=1.0)
    g.box(wall, cx - w * 0.28, cy - d * 0.28, 5.4, cx + w * 0.28, cy + d * 0.28, 6.4)          # leher atap kedua
    g.pyramid(rf, cx, cy, w * 0.75, d * 0.75, 6.4, 8.2)
    g.cyl(m.get("finial", rf), cx, cy, 8.1, 8.9, 0.18, seg=8)                                   # mustaka
    g.box(rf, x0 - 1.0, y0 - 3.0, 3.0, x1 + 1.0, y0, 3.15)                                       # serambi
    for px in (x0 - 0.6, x1 + 0.6):
        g.box(wall, px - 0.15, y0 - 2.8, 0.6, px + 0.15, y0 - 2.5, 3.0)
    mx, my = x1 + 1.2, y0 - 2.0                                                                  # menara
    g.box(wall, mx - 0.7, my - 0.7, 0, mx + 0.7, my + 0.7, 9.5)
    g.box(wall, mx - 0.95, my - 0.95, 9.5, mx + 0.95, my + 0.95, 10.0)
    g.pyramid(rf, mx, my, 1.9, 1.9, 10.0, 11.4)


def pos_ronda(g, cx, cy, m):
    """Pos ronda: gubuk terbuka 3x2,5 m, lantai papan panggung, empat tiang, atap seng pelana, kentongan."""
    wood, rf = m["wood"], m["roof"]
    x0, y0, x1, y1 = cx - 1.5, cy - 1.25, cx + 1.5, cy + 1.25
    for px, py in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        g.box(wood, px - 0.07, py - 0.07, 0, px + 0.07, py + 0.07, 2.4)
    g.box(wood, x0, y0, 0.45, x1, y1, 0.55)
    g.box(wood, x0, y1 - 0.05, 0.55, x1, y1, 1.2)          # sandaran belakang
    g.gable(rf, x0, y0, x1, y1, 2.4, 3.1, axis="x", over=0.35)
    g.cyl(wood, x1 + 0.25, cy, 1.0, 1.8, 0.09, seg=8)          # kentongan


def warung(g, x0, y0, x1, y1, m, front="-y"):
    """Warung kelontong: bangunan bata kecil, etalase depan, kanopi seng condong, papan nama."""
    wall, rf = m["wall"], m["roof"]
    g.box(wall, x0, y0, 0, x1, y1, 3.2)
    g.gable(rf, x0, y0, x1, y1, 3.2, 4.3, axis="x" if (x1 - x0) >= (y1 - y0) else "y", over=0.5, gable_mat=wall)
    if front == "-y":
        g.box(m.get("window", wall), x0 + 0.5, y0 - 0.04, 0.9, x1 - 0.5, y0, 2.4)
        g.box(m.get("counter", wall), x0 + 0.3, y0 - 0.7, 0, x1 - 0.3, y0, 0.95)
        g.box(m.get("awning", rf), x0 - 0.3, y0 - 2.0, 2.7, x1 + 0.3, y0, 2.8)
        for px in (x0 - 0.1, x1 + 0.1): g.box(m.get("post", wall), px - 0.05, y0 - 1.9, 0, px + 0.05, y0 - 1.8, 2.7)
        g.box(m.get("sign", wall), x0 + 0.4, y0 - 0.06, 2.9, x1 - 0.4, y0 - 0.02, 3.5)


# ---- resor Bali ----

def basin(g, mat, x0, y0, x1, y1, z_floor, z_top, t=0.25):
    """Bak kolam berongga: lantai dan empat dinding (air diletakkan terpisah)."""
    g.box(mat, x0, y0, z_floor - t, x1, y1, z_floor)
    g.ring(mat, x0, y0, x1, y1, z_floor - t, z_top, t)


def frame_minus(g, mat, x0, y0, x1, y1, z0, z1, hx0, hy0, hx1, hy1):
    """Kotak (x0..x1, y0..y1) dikurangi lubang persegi (hx0..hx1, hy0..hy1): empat kotak di sekeliling lubang."""
    g.box(mat, x0, y0, z0, x1, hy0, z1); g.box(mat, x0, hy1, z0, x1, y1, z1)
    g.box(mat, x0, hy0, z0, hx0, hy1, z1); g.box(mat, hx1, hy0, z0, x1, hy1, z1)


def balinese_roof(g, mat, x0, y0, x1, y1, z0, height, tiers=3, over=1.0, neck=None, finial=None):
    """Atap tumpang khas Bali (wantilan): limasan bersusun, tiap tingkat lebih kecil dengan leher dinding pendek."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, d = x1 - x0, y1 - y0
    hs = [0.45, 0.33, 0.22][:tiers] if tiers == 3 else ([0.6, 0.4] if tiers == 2 else [1.0])
    gap = 0.08 * height
    z = z0
    for i in range(tiers):
        k = 1.0 - 0.38 * i
        th = height * hs[i] - (gap if i < tiers - 1 else 0)
        top = z + th
        if i == tiers - 1:
            g.pyramid(mat, cx, cy, w * k + 2 * over * k, d * k + 2 * over * k, z, top)
        else:
            g.hip(mat, cx - w * k / 2, cy - d * k / 2, cx + w * k / 2, cy + d * k / 2, z, top, over=over * k)
            nk = k - 0.38
            g.box(neck or mat, cx - w * nk / 2, cy - d * nk / 2, top - th * 0.35, cx + w * nk / 2, cy + d * nk / 2, top + gap)
        z = top + gap
    if finial:
        g.cyl(finial, cx, cy, z - 0.1, z + 0.9, 0.15, seg=8)
    return z


def bale(g, cx, cy, z, m, size=3.2):
    """Bale (paviliun terbuka): lantai panggung 0,5 m, empat tiang kayu, atap jerami limas."""
    s = size / 2
    g.box(m.get("base", m["wood"]), cx - s, cy - s, z, cx + s, cy + s, z + 0.5)
    for px, py in ((cx - s + 0.2, cy - s + 0.2), (cx + s - 0.2, cy - s + 0.2), (cx + s - 0.2, cy + s - 0.2), (cx - s + 0.2, cy + s - 0.2)):
        g.box(m["wood"], px - 0.1, py - 0.1, z + 0.5, px + 0.1, py + 0.1, z + 2.6)
    g.pyramid(m["roof"], cx, cy, size + 1.2, size + 1.2, z + 2.6, z + 4.4)


def angkul(g, cx, cy, z, m, axis="x"):
    """Angkul-angkul: gerbang bata merah beratap kecil, lebar bukaan 1,2 m."""
    brick, rf = m["brick"], m["roof"]
    if axis == "x":   # bukaan menghadap y
        g.box(brick, cx - 1.6, cy - 0.5, z, cx - 0.6, cy + 0.5, z + 2.6)
        g.box(brick, cx + 0.6, cy - 0.5, z, cx + 1.6, cy + 0.5, z + 2.6)
        g.box(brick, cx - 1.6, cy - 0.5, z + 2.6, cx + 1.6, cy + 0.5, z + 3.0)
        g.hip(rf, cx - 1.6, cy - 0.5, cx + 1.6, cy + 0.5, z + 3.0, z + 4.0, over=0.35)
    else:
        g.box(brick, cx - 0.5, cy - 1.6, z, cx + 0.5, cy - 0.6, z + 2.6)
        g.box(brick, cx - 0.5, cy + 0.6, z, cx + 0.5, cy + 1.6, z + 2.6)
        g.box(brick, cx - 0.5, cy - 1.6, z + 2.6, cx + 0.5, cy + 1.6, z + 3.0)
        g.hip(rf, cx - 0.5, cy - 1.6, cx + 0.5, cy + 1.6, z + 3.0, z + 4.0, over=0.35)


def terraced_hotel(g, x0, y0, x1, y1, base_z, m, floors=3, fl=3.3, step=2.0, side="-y", ground_h=3.5):
    """Hotel berundak menghadap laut (sisi `side`): lantai dasar batu dengan kolom dan kaca lobi, lantai atas mundur
    `step` m per lantai dengan teras berpot tanaman dan pagar kayu. Mengembalikan (z atap, kotak atap)."""
    stone, conc, gl, wood = m["stone"], m["concrete"], m["glass"], m["wood"]
    plant = m.get("planter", stone)
    z = base_z
    g.box(gl, x0 + 0.6, y0 + 0.6, z, x1 - 0.6, y1 - 0.6, z + ground_h - 0.3)
    nc = max(2, int((x1 - x0) / 4.5))
    for i in range(nc + 1):
        cx = x0 + 0.3 + i * (x1 - x0 - 0.6) / nc
        for cy in (y0 + 0.3, y1 - 0.3):
            g.box(stone, cx - 0.35, cy - 0.35, z, cx + 0.35, cy + 0.35, z + ground_h)
    g.box(stone, x0, y0, z + ground_h - 0.3, x1, y1, z + ground_h)
    z += ground_h
    bx0, by0, bx1, by1 = x0, y0, x1, y1
    for k in range(floors):
        s = step * (k + 1)
        if side == "-y": by0 = y0 + s
        elif side == "+y": by1 = y1 - s
        elif side == "-x": bx0 = x0 + s
        else: bx1 = x1 - s
        g.box(gl, bx0 + 0.25, by0 + 0.25, z, bx1 - 0.25, by1 - 0.25, z + fl - 0.25)
        g.box(conc, bx0, by0, z + fl - 0.3, bx1, by1, z + fl)                     # pelat lantai
        ncol = max(2, int((bx1 - bx0) / 4.5))
        for i in range(ncol + 1):                                                    # sekat kamar / kolom
            cx = bx0 + 0.15 + i * (bx1 - bx0 - 0.3) / ncol
            g.box(conc, cx - 0.15, by0, z, cx + 0.15, by1, z + fl - 0.3) if side in ("-y", "+y") else None
        # teras di depan lantai ini (di atas lantai bawahnya): pot tanaman dan pagar kayu
        if side == "-y":
            g.box(plant, bx0, by0 - step, z, bx1, by0 - step + 0.6, z + 0.6)
            g.box(wood, bx0, by0 - step + 0.6, z + 0.9, bx1, by0 - step + 0.7, z + 1.0)
        elif side == "+y":
            g.box(plant, bx0, by1 + step - 0.6, z, bx1, by1 + step, z + 0.6)
        g.ring(conc, bx0, by0, bx1, by1, z, z + 0.3, 0.3)
        z += fl
    g.ring(conc, bx0, by0, bx1, by1, z - 0.3, z + 1.0, 0.3)                        # parapet atap
    return z, (bx0, by0, bx1, by1)


# ---- interior gedung terbakar ----

def wall_with_doors(g, mat, x0, y0, z0, x1, y1, z1, door_w=1.2, door_h=2.1, every=6.0, min_len=3.0):
    """Partisi lurus dengan bukaan pintu tiap `every` m (ambang di atas pintu tetap ada)."""
    alongx = (x1 - x0) >= (y1 - y0)
    L = (x1 - x0) if alongx else (y1 - y0)
    if L < min_len:
        g.box(mat, x0, y0, z0, x1, y1, z1); return 0
    n = max(1, int(L / every))
    cuts = [L * (k + 0.5) / n for k in range(n)]
    s0, made = 0.0, 0
    for c in cuts:
        a, b = c - door_w / 2, c + door_w / 2
        if alongx:
            g.box(mat, x0 + s0, y0, z0, x0 + a, y1, z1); g.box(mat, x0 + a, y0, z0 + door_h, x0 + b, y1, z1)
        else:
            g.box(mat, x0, y0 + s0, z0, x1, y0 + a, z1); g.box(mat, x0, y0 + a, z0 + door_h, x1, y0 + b, z1)
        s0 = b; made += 1
    if alongx: g.box(mat, x0 + s0, y0, z0, x1, y1, z1)
    else: g.box(mat, x0, y0 + s0, z0, x1, y1, z1)
    return made


def person(g, cx, cy, z, m, lying=False, yaw=0.0):
    """Korban: badan, kepala, kaki sederhana (rompi oranye / baju sipil). Berdiri 1,7 m atau berbaring."""
    body, skin, legs = m["body"], m.get("skin", m["body"]), m.get("legs", m["body"])
    c, s = math.cos(yaw), math.sin(yaw)
    def bx(mat, a0, b0, h0, a1, b1, h1):   # kotak di bingkai lokal (a = kanan, b = depan), diputar yaw
        pts = [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
        P = [(cx + a * c - b * s, cy + a * s + b * c) for a, b in pts]
        lo, hi = z + h0, z + h1
        quads = [P[0], P[1], P[2], P[3]]
        g.face(mat, [(p[0], p[1], hi) for p in quads])
        g.face(mat, [(p[0], p[1], lo) for p in reversed(quads)])
        for i in range(4):
            p, q = quads[i], quads[(i + 1) % 4]
            g.face(mat, [(p[0], p[1], lo), (q[0], q[1], lo), (q[0], q[1], hi), (p[0], p[1], hi)])
    if lying:
        bx(legs, -0.18, -0.9, 0.0, 0.18, -0.1, 0.22)
        bx(body, -0.22, -0.1, 0.0, 0.22, 0.55, 0.26)
        bx(skin, -0.11, 0.58, 0.02, 0.11, 0.82, 0.24)
    else:
        bx(legs, -0.17, -0.12, 0.0, 0.17, 0.12, 0.85)
        bx(body, -0.22, -0.14, 0.85, 0.22, 0.14, 1.45)
        bx(skin, -0.11, -0.11, 1.48, 0.11, 0.11, 1.72)
        bx(body, -0.32, -0.08, 0.95, -0.22, 0.08, 1.42); bx(body, 0.22, -0.08, 0.95, 0.32, 0.08, 1.42)


# ---- inspeksi ----

def ladder(g, mat, x, y0, y1, z0, z1, face_x, rung=0.4):
    """Tangga monyet di muka bidang x = face_x (menonjol 0,25 m ke arah tanda face_x - x), dua rel dan anak tangga."""
    d = 0.25 if face_x > x else -0.25
    xa, xb = (x, x + d) if d > 0 else (x + d, x)
    g.box(mat, xa, y0, z0, xb, y0 + 0.06, z1); g.box(mat, xa, y1 - 0.06, z0, xb, y1, z1)
    n = int((z1 - z0) / rung)
    xr0, xr1 = (x + d - 0.04, x + d) if d > 0 else (x + d, x + d + 0.04)
    for i in range(1, n):
        z = z0 + i * rung
        g.box(mat, min(xr0, xr1), y0, z, max(xr0, xr1), y1, z + 0.04)


def street_lamp(g, mat, x, y, z, h=8.0, arm_dir=(0, 1), arm=1.6, lamp_mat=None):
    g.cyl(mat, x, y, z, z + h, 0.09, seg=8)
    ax, ay = arm_dir
    x1, y1 = x + ax * arm, y + ay * arm
    g.box(mat, min(x, x1) - 0.05, min(y, y1) - 0.05, z + h - 0.12, max(x, x1) + 0.05, max(y, y1) + 0.05, z + h)
    g.box(lamp_mat or mat, x1 - 0.25, y1 - 0.12, z + h - 0.25, x1 + 0.25, y1 + 0.12, z + h - 0.1)


def bmu(g, m, x0, y0, x1, y1, z):
    """Gondola pembersih fasad (building maintenance unit): rel keliling atap, troli, tiang dan lengan jib."""
    rail = m["rail"]; body = m["body"]
    g.ring(rail, x0 + 1.0, y0 + 1.0, x1 - 1.0, y1 - 1.0, z, z + 0.25, 0.2)
    tx, ty = x0 + 2.0, (y0 + y1) / 2
    g.box(body, tx - 1.0, ty - 1.4, z + 0.25, tx + 1.0, ty + 1.4, z + 1.6)       # troli
    g.box(body, tx - 0.35, ty - 0.35, z + 1.6, tx + 0.35, ty + 0.35, z + 4.2)    # tiang
    g.box(body, tx - 0.25, ty - 0.25, z + 3.9, tx + 0.25 - (tx - x0) - 1.2, ty + 0.25, z + 4.3)  # jib keluar ke tepi barat


def entrance_canopy(g, m, x0, x1, y_face, z, depth=3.5, front=-1):
    """Kanopi kaca berangka baja di depan pintu masuk, dua tiang di ujung luar."""
    y1 = y_face + front * depth
    ya, yb = min(y_face, y1), max(y_face, y1)
    g.box(m["frame"], x0, ya, z, x1, yb, z + 0.25)
    g.box(m["glass"], x0 + 0.2, ya + 0.2, z + 0.25, x1 - 0.2, yb - 0.2, z + 0.3)
    for px in (x0 + 0.3, x1 - 0.3):
        g.box(m["frame"], px - 0.12, y1 - front * 0.3 - 0.12, 0, px + 0.12, y1 - front * 0.3 + 0.12, z)
