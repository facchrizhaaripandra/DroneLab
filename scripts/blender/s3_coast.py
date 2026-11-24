# S3: one depth-coloured sea instead of three flat strips, breaking-wave foam along the shore, wet sand,
# and backdrop land (beach continuing both ways, headlands closing a bay, green hills inland) so the 300 m map
# has no edge. Needs water_backdrop.py loaded into `wb`.
import bpy, numpy as np, random
from mathutils import Vector

TEX = r"C:\Users\darip\Documents\DroneLab3D\S3_resor_hotel\textures"


def terrain_grid(name='terrain_coast'):
    me = bpy.data.objects[name].data; nv = len(me.vertices)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    xs = np.unique(np.round(co[:, 0], 3)); ys = np.unique(np.round(co[:, 1], 3)); nx, ny = len(xs), len(ys)
    ii = np.rint((co[:, 0] - xs[0]) / (xs[-1] - xs[0]) * (nx - 1)).astype(int)
    jj = np.rint((co[:, 1] - ys[0]) / (ys[-1] - ys[0]) * (ny - 1)).astype(int)
    H = np.zeros((ny, nx)); H[jj, ii] = co[:, 2]

    def h(X, Y):
        X = np.asarray(X, float); Y = np.asarray(Y, float)
        fx = np.clip((X - xs[0]) / (xs[-1] - xs[0]) * (nx - 1), 0, nx - 1.0001)
        fy = np.clip((Y - ys[0]) / (ys[-1] - ys[0]) * (ny - 1), 0, ny - 1.0001)
        i0 = fx.astype(int); j0 = fy.astype(int); tx = fx - i0; ty = fy - j0
        return (H[j0, i0] * (1 - tx) + H[j0, i0 + 1] * tx) * (1 - ty) + (H[j0 + 1, i0] * (1 - tx) + H[j0 + 1, i0 + 1] * tx) * ty
    prof_y = ys; prof_z = H.mean(1)  # the beach/cliff/plateau profile along y, averaged over x
    return h, prof_y, prof_z


def hide(name):
    o = bpy.data.objects.get(name)
    if o:
        o.hide_set(True); o.hide_render = True; o.hide_viewport = True


def build(wb):
    th, py, pz = terrain_grid()
    ss, mix, srgb, fbm, ridged = wb["ss"], wb["mix"], wb["srgb"], wb["fbm"], wb["ridged"]

    def profile(Y):
        z = np.interp(Y, py, pz)
        z = np.where(Y < py[0], pz[0] - (py[0] - Y) * 0.10, z)          # shelf keeps deepening offshore
        z = np.where(Y > py[-1], pz[-1] + (Y - py[-1]) * 0.12, z)        # hills keep rising inland
        return np.maximum(z, -32.0)

    def land(X, Y):
        """Height outside the 300 m square: the same beach profile, pushed seaward into headlands, plus hills."""
        ax = np.abs(X)
        shift = -150 * ss(ax, 320, 950) + 9 * fbm(X, Y * 0.2, 90, 2, seed=3)
        Yl = Y - shift
        z = profile(Yl)
        inland = ss(Yl, -30, 160)
        hills = 25 + 150 * (ridged(X, Y, 520, 4, seed=6) / 2.2) ** 1.4 + 18 * fbm(X, Y, 120, 3, seed=8)
        hills *= ss(ax + np.maximum(Y - 150, 0) * 1.5, 150, 600)
        z = z + inland * hills
        # match the playable terrain along its border
        dx = np.maximum(ax - 150, 0); dy = np.maximum(np.abs(Y) - 150, 0); d = np.hypot(dx, dy)
        edge = th(np.clip(X, -150, 150), np.clip(Y, -150, 150))
        w = ss(d, 0, 90)
        z = edge + (z - edge) * w
        inside = (ax < 150) & (np.abs(Y) < 150)
        return np.where(inside, th(X, Y) - 1.5, z)

    def height(X, Y):  # terrain inside, land outside (for depth and foam)
        X = np.asarray(X, float); Y = np.asarray(Y, float)
        inside = (np.abs(X) <= 150) & (np.abs(Y) <= 150)
        return np.where(inside, th(X, Y), land(X, Y))

    ripple = wb["water_normal_png"](TEX + r"\sea_ripple_nor.png", 512, seed=12, waves=60, strength=0.7)
    sh, turq, mid, deep = srgb(150, 205, 190), srgb(64, 178, 182), srgb(26, 124, 150), srgb(12, 66, 104)

    def sea_col(depth):
        c = mix(sh, turq, ss(depth, 0.2, 1.6)); c = mix(c, mid, ss(depth, 2.0, 6.0)); c = mix(c, deep, ss(depth, 7.0, 18.0))
        return np.concatenate([c, np.ones(c.shape[:-1] + (1,), np.float32)], -1)

    mat_sea = wb["vcol_material"]("mat_sea_water_depth", roughness=0.07, normal_img=ripple, normal_rep=1.0, normal_strength=0.22)
    sea = wb["grid_mesh"]("sea_water_surface", -170, 170, -260, -64, 2.5, lambda X, Y: np.zeros(X.shape),
                          lambda X, Y, Z: sea_col(-height(X, Y)), keep=lambda cx, cy, zc: height(cx, cy) < 0.5,
                          coll="01_terrain_sea", uv_scale=18.0, material=mat_sea)
    for n in ("sea_water_shallow", "sea_water_mid", "sea_water_deep"):
        hide(n)
    far = wb["grid_mesh"]("backdrop_sea_far", -2400, 2400, -2400, 600, 40.0, lambda X, Y: np.full(X.shape, -0.25),
                          lambda X, Y, Z: sea_col(-land(X, Y)), keep=lambda cx, cy, zc: land(cx, cy) < 1.0,
                          coll="99_backdrop", uv_scale=18.0, material=mat_sea)

    # ---- backdrop land ----
    sand, sand_w = np.array(srgb(214, 196, 160)), np.array(srgb(170, 150, 118))
    f1, f2, rock = np.array(srgb(38, 74, 36)), np.array(srgb(66, 98, 46)), np.array(srgb(108, 100, 86))
    mat_land = wb["vcol_material"]("mat_backdrop_land", roughness=1.0)

    def land_col(X, Y, Z):
        n = fbm(X, Y, 110, 3, seed=11) * 0.5 + 0.5
        c = mix(f1, f2, np.clip(n, 0, 1))
        gy, gx = np.gradient(Z, 20.0); sl = np.hypot(gx, gy)
        c = mix(c, rock, ss(sl, 0.6, 1.0))
        beach = 1 - ss(Z, 1.6, 3.2)
        c = mix(c, sand, beach); c = mix(c, sand_w, 1 - ss(Z, 0.1, 0.8))
        return np.concatenate([c, np.ones(c.shape[:-1] + (1,), np.float32)], -1)
    bd = wb["grid_mesh"]("backdrop_land", -2400, 2400, -900, 2400, 20.0, land, land_col,
                         keep=lambda cx, cy, zc: ((np.abs(cx) > 140) | (np.abs(cy) > 140)) & (zc > -4.0),
                         coll="99_backdrop", material=mat_land)

    # ---- foam: shore break + a softer line further out, along the whole bay ----
    xs = np.arange(-1150, 1150.1, 3.0)
    ysr = np.arange(-650, 40, 0.5)
    wl = []
    for x in xs:
        z = height(np.full(ysr.shape, x), ysr)
        k = np.argmax(z > 0.0)
        wl.append(ysr[k] if z[k] > 0 else np.nan)
    wl = np.array(wl)
    good = ~np.isnan(wl)
    xs, wl = xs[good], wl[good]
    # a normal pointing out to sea (perpendicular to the waterline)
    tx = np.gradient(xs); ty = np.gradient(wl); L = np.hypot(tx, ty); nxv, nyv = ty / L, -tx / L
    rnd = np.random.default_rng(5)
    wave = np.convolve(rnd.random(len(xs)), np.ones(9) / 9, mode='same')
    mat_foam = wb["vcol_material"]("mat_sea_foam", roughness=0.7, alpha=True)

    def strip(name, dist, widths, alphas, amod):
        verts, cols, faces = [], [], []
        nj = len(widths)
        for k in range(len(xs)):
            for j in range(nj):
                o = dist + widths[j] + 2.5 * (wave[k] - 0.5)
                verts.append((xs[k] + nxv[k] * o, wl[k] + nyv[k] * o, 0.04))
                a = alphas[j] * (amod[0] + amod[1] * wave[k])
                cols.append((0.95, 0.97, 0.97, float(np.clip(a, 0, 1))))
        for k in range(len(xs) - 1):
            if abs(wl[k + 1] - wl[k]) > 25:
                continue
            for j in range(nj - 1):
                a = k * nj + j; faces.append((a, a + 1, a + nj + 1, a + nj))
        m = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
        m.clear_geometry(); m.from_pydata(verts, [], faces)
        c = m.color_attributes.get('Col') or m.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
        for i, cc in enumerate(cols):
            c.data[i].color = cc
        if not m.materials:
            m.materials.append(mat_foam)
        ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, m)
        if not ob.users_collection:
            bpy.data.collections["01_terrain_sea"].objects.link(ob)
        return len(faces)
    nf1 = strip("sea_foam_shore", 0.0, [-0.6, 1.0, 2.6, 5.0], [0.0, 0.9, 0.55, 0.0], (0.55, 0.6))
    nf2 = strip("sea_foam_offshore", 11.0, [0.0, 1.6, 3.4], [0.0, 0.45, 0.0], (0.2, 0.8))

    # ---- palms along the backdrop beaches, trees on the backdrop hills (linked copies -> GPU instances) ----
    coll = bpy.data.collections["99_backdrop"]
    for o in [o for o in coll.objects if o.name.startswith("backdrop_tree")]:
        bpy.data.objects.remove(o)
    palms = list({o.data.name: o.data for o in bpy.data.objects if o.name.startswith("tree_coconut_beach")}.values())[:4]
    hill = list({o.data.name: o.data for o in bpy.data.objects if o.name.startswith("tree_hill")}.values())[:5]
    rr = random.Random(17); n_p = n_h = 0
    for k in range(0, len(xs), 2):
        if abs(xs[k]) < 160 or rr.random() < 0.35:
            continue
        o = 14 + rr.uniform(0, 22)
        x, y = xs[k] - nxv[k] * o, wl[k] - nyv[k] * o
        z = float(height(np.array([x]), np.array([y]))[0])
        if z < 0.6 or z > 6:
            continue
        ob = bpy.data.objects.new("backdrop_tree_palm_%04d" % n_p, palms[n_p % len(palms)])
        ob.location = (x, y, z - 0.2); ob.rotation_euler = (rr.uniform(-0.12, 0.12), rr.uniform(-0.12, 0.12), rr.random() * 6.283)
        s = rr.uniform(0.85, 1.2); ob.scale = (s, s, s); coll.objects.link(ob); n_p += 1
    tries = 0
    while n_h < 1600 and tries < 30000:
        tries += 1
        x = rr.uniform(-700, 700); y = rr.uniform(-450, 700)
        if abs(x) < 158 and abs(y) < 158:
            continue
        z = float(height(np.array([x]), np.array([y]))[0])
        if z < 4.0 or z > 170:
            continue
        ob = bpy.data.objects.new("backdrop_tree_hill_%04d" % n_h, hill[n_h % len(hill)])
        ob.location = (x, y, z - 0.3); ob.rotation_euler.z = rr.random() * 6.283
        s = rr.uniform(0.9, 1.5); ob.scale = (s, s, s * rr.uniform(0.9, 1.2)); coll.objects.link(ob); n_h += 1
    return {"sea": len(sea.data.polygons), "far_sea": len(far.data.polygons), "land": len(bd.data.polygons),
            "foam": [nf1, nf2], "palms": n_p, "hill_trees": n_h}


def wet_sand(img_name, h_fn, x0=-150, x1=150, y0=-150, y1=150, lo=-0.3, hi=0.9, dark=0.72):
    """Darken the baked colour where sand is wet (just above the waterline)."""
    img = bpy.data.images[img_name]; w, hh = img.size
    px = np.empty(w * hh * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(hh, w, 4)
    for r0 in range(0, hh, 512):
        rows = np.arange(r0, min(hh, r0 + 512))
        V, U = np.meshgrid((rows + 0.5) / hh, (np.arange(w) + 0.5) / w, indexing='ij')
        z = h_fn(x0 + U * (x1 - x0), y0 + V * (y1 - y0))
        t = np.clip((z - lo) / (hi - lo), 0, 1); f = dark + (1 - dark) * t * t * (3 - 2 * t)
        px[rows, :, :3] *= f[..., None]
    img.pixels.foreach_set(px.ravel()); img.save()
    return True
