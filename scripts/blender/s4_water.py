# S4: lake with depth colour, white-water mountain streams, a streaked waterfall with foam, and a ring of
# distant mountains so the 1 km map has no edge. Needs water_backdrop.py loaded into `wb`.
import bpy, numpy as np, math, random
from mathutils import Vector

TEX = r"C:\Users\darip\Documents\DroneLab3D\S4_gunung_danau\textures"
LAKE = 25.0


def terrain_grid():
    me = bpy.data.objects['terrain_mountain'].data; nv = len(me.vertices)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    xs = np.unique(np.round(co[:, 0], 3)); ys = np.unique(np.round(co[:, 1], 3)); nx, ny = len(xs), len(ys)
    ii = np.rint((co[:, 0] - xs[0]) / (xs[-1] - xs[0]) * (nx - 1)).astype(int)
    jj = np.rint((co[:, 1] - ys[0]) / (ys[-1] - ys[0]) * (ny - 1)).astype(int)
    H = np.zeros((ny, nx)); H[jj, ii] = co[:, 2]

    def h(X, Y):
        fx = np.clip((X - xs[0]) / (xs[-1] - xs[0]) * (nx - 1), 0, nx - 1.0001)
        fy = np.clip((Y - ys[0]) / (ys[-1] - ys[0]) * (ny - 1), 0, ny - 1.0001)
        i0 = fx.astype(int); j0 = fy.astype(int); tx = fx - i0; ty = fy - j0
        return (H[j0, i0] * (1 - tx) + H[j0, i0 + 1] * tx) * (1 - ty) + (H[j0 + 1, i0] * (1 - tx) + H[j0 + 1, i0 + 1] * tx) * ty
    return h


def hide(name):
    o = bpy.data.objects.get(name)
    if o:
        o.hide_set(True); o.hide_render = True; o.hide_viewport = True


def build(wb):
    th = terrain_grid()
    ripple = wb["water_normal_png"](TEX + r"\water_ripple_nor.png", 512, seed=4)

    # ---- lake: one grid, coloured by depth; the old flat fan and the plunge pool quad are hidden ----
    mat_lake = wb["vcol_material"]("mat_lake_water_depth", roughness=0.06, normal_img=ripple, normal_rep=1.0, normal_strength=0.35)
    shallow, mid, deep = wb["srgb"](118, 132, 98), wb["srgb"](46, 98, 96), wb["srgb"](14, 50, 64)

    def lake_col(X, Y, Z):
        d = LAKE - th(X, Y)
        c = wb["mix"](shallow, mid, wb["ss"](d, 0.3, 3.5))
        c = wb["mix"](c, deep, wb["ss"](d, 4.0, 14.0))
        return np.concatenate([c, np.ones(c.shape[:-1] + (1,), np.float32)], -1)
    lake = wb["grid_mesh"]("lake_water_surface_depth", -452, 112, -352, 12, 4.0, lambda X, Y: np.full(X.shape, LAKE), lake_col,
                           keep=lambda cx, cy, zc: th(cx, cy) < LAKE + 0.6, coll="02_lake_river", uv_scale=14.0, material=mat_lake)
    hide("lake_water_surface"); hide("waterfall_plunge_pool")

    # ---- mountain streams: hug the ground, 30% narrower, white water on steep runs ----
    mat_st = wb["vcol_material"]("mat_stream_whitewater", roughness=0.18, normal_img=ripple, normal_rep=1.0, normal_strength=0.5)
    water, foam = np.array(wb["srgb"](58, 104, 108)), np.array(wb["srgb"](226, 236, 236))
    for n in ("river_water_surface", "waterfall_upper_stream"):
        o = bpy.data.objects[n]; me = o.data; mw = o.matrix_world; inv = mw.inverted()
        W = [mw @ v.co for v in me.vertices]
        pairs = [(i, i + 1) for i in range(0, len(W) - 1, 2)]
        mids = []
        for a, b in pairs:
            m = (W[a] + W[b]) / 2
            for k in (a, b):
                W[k] = m + (W[k] - m) * 0.7
            mids.append(m)
        for v in W:
            v.z = float(th(np.array([v.x]), np.array([v.y]))[0]) + 0.22
        slope = []
        for k, (a, b) in enumerate(pairs):
            p, q = mids[max(0, k - 1)], mids[min(len(mids) - 1, k + 1)]
            pz = (W[pairs[max(0, k - 1)][0]].z + W[pairs[max(0, k - 1)][1]].z) / 2
            qz = (W[pairs[min(len(mids) - 1, k + 1)][0]].z + W[pairs[min(len(mids) - 1, k + 1)][1]].z) / 2
            run = max(0.5, math.hypot(p.x - q.x, p.y - q.y)); slope.append(abs(pz - qz) / run)
        for i, v in enumerate(me.vertices):
            v.co = inv @ W[i]
        col = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
        for k, (a, b) in enumerate(pairs):
            f = float(np.clip((slope[k] - 0.12) / 0.45, 0, 1)); f = f * f * (3 - 2 * f)
            for idx, edge in ((a, 0.25), (b, 0.25)):
                c = water + (foam - water) * min(1.0, f + edge * f)
                col.data[idx].color = (*c, 1.0)
        if not me.uv_layers:
            me.uv_layers.new(name='UVMap')
        uvl = me.uv_layers[0]
        for lp in me.loops:
            w = W[lp.vertex_index]; uvl.data[lp.index].uv = (w.x / 10.0, w.y / 10.0)
        me.materials.clear(); me.materials.append(mat_st); me.update()

    # ---- waterfall: streaked sheet + foam where it lands ----
    o = bpy.data.objects["waterfall_water_sheet"]; me = o.data; mw = o.matrix_world
    P = [mw @ v.co for v in me.vertices]  # quad: top-left, top-right, bottom-right, bottom-left
    top = sorted(P, key=lambda v: -v.z)[:2]; bot = sorted(P, key=lambda v: v.z)[:2]
    top.sort(key=lambda v: v.x); bot.sort(key=lambda v: v.x)
    nu, nv_ = 14, 10
    rnd = random.Random(5)
    streak = [rnd.random() for _ in range(nu + 1)]
    verts, cols, faces = [], [], []
    for j in range(nv_ + 1):
        t = j / nv_
        L = top[0].lerp(bot[0], t); R = top[1].lerp(bot[1], t)
        for i in range(nu + 1):
            s = i / nu; p = L.lerp(R, s)
            p = p + Vector((0, 0, 0)) + (Vector((0, -0.6, 0)) * math.sin(t * math.pi))  # slight bulge outwards
            verts.append(tuple(p))
            w = 0.72 + 0.28 * streak[i] - 0.15 * (1 - t)
            a = 0.55 + 0.4 * t
            cols.append((w, min(1, w + 0.03), min(1, w + 0.05), a))
    for j in range(nv_):
        for i in range(nu):
            a = j * (nu + 1) + i; faces.append((a, a + 1, a + nu + 2, a + nu + 1))
    mat_fall = wb["vcol_material"]("mat_waterfall_streaks", roughness=0.3, alpha=True)
    m2 = bpy.data.meshes.new("waterfall_water_sheet_streaks"); m2.from_pydata(verts, [], faces)
    c = m2.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for i, cc in enumerate(cols):
        c.data[i].color = cc
    m2.materials.append(mat_fall)
    ob = bpy.data.objects.new("waterfall_water_sheet_streaks", m2); bpy.data.collections["02_lake_river"].objects.link(ob)
    hide("waterfall_water_sheet")
    base = (bot[0] + bot[1]) / 2
    mat_foam = wb["vcol_material"]("mat_water_foam", roughness=0.6, alpha=True)

    def foam_col(X, Y, Z):
        r = np.hypot(X - base.x, (Y - base.y) * 1.3)
        a = np.clip(1 - r / 7.0, 0, 1) ** 1.5 * 0.85
        return np.stack([np.full(X.shape, 0.92), np.full(X.shape, 0.95), np.full(X.shape, 0.96), a], -1)
    wb["grid_mesh"]("waterfall_foam_pool", base.x - 8, base.x + 8, base.y - 8, base.y + 8, 1.0,
                    lambda X, Y: np.full(X.shape, LAKE + 0.04), foam_col, coll="02_lake_river", material=mat_foam)

    # ---- distant mountains: a 2.2 km ring that starts exactly at the terrain border ----
    mat_bd = wb["vcol_material"]("mat_backdrop_land", roughness=1.0)

    def bd_z(X, Y):
        dx = np.maximum(np.abs(X) - 500, 0); dy = np.maximum(np.abs(Y) - 500, 0); d = np.hypot(dx, dy)
        edge = th(np.clip(X, -500, 500), np.clip(Y, -500, 500))
        far = 70 + 420 * (wb["ridged"](X, Y, 900, 4, seed=2) / 2.2) ** 1.6 + 45 * wb["fbm"](X, Y, 260, 3, seed=5)
        far *= 0.55 + 0.45 * wb["ss"](d, 300, 1100)
        z = edge + (far - edge) * wb["ss"](d, 0, 520)
        inside = (np.abs(X) < 500) & (np.abs(Y) < 500)
        return np.where(inside, th(X, Y) - 1.5, z)

    forest_a, forest_b = np.array(wb["srgb"](48, 66, 38)), np.array(wb["srgb"](70, 84, 46))
    rock, high = np.array(wb["srgb"](104, 96, 84)), np.array(wb["srgb"](150, 144, 132))

    def bd_col(X, Y, Z):
        n = wb["fbm"](X, Y, 140, 3, seed=9) * 0.5 + 0.5
        c = wb["mix"](forest_a, forest_b, np.clip(n, 0, 1))
        gy, gx = np.gradient(Z, 25.0)
        sl = np.hypot(gx, gy)
        c = wb["mix"](c, rock, np.clip(wb["ss"](sl, 0.55, 0.95) + wb["ss"](Z, 300, 420), 0, 1))
        c = wb["mix"](c, high, wb["ss"](Z, 430, 520))
        return np.concatenate([c, np.ones(c.shape[:-1] + (1,), np.float32)], -1)
    bd = wb["grid_mesh"]("backdrop_mountains", -2200, 2200, -2200, 2200, 25.0, bd_z, bd_col,
                         keep=lambda cx, cy, zc: (np.abs(cx) > 485) | (np.abs(cy) > 485), coll="99_backdrop", material=mat_bd)

    # ---- trees on the near backdrop (linked copies -> GPU instances) ----
    srcs = [o for o in bpy.data.objects if o.name.startswith(("tree_forest_", "tree_cemara_")) and o.type == 'MESH']
    datas = list({o.data.name: o.data for o in srcs}.values())[:6]
    rnd = random.Random(21); placed = 0; coll = bpy.data.collections["99_backdrop"]
    tries = 0
    while placed < 1400 and tries < 20000:
        tries += 1
        x = rnd.uniform(-900, 900); y = rnd.uniform(-900, 900)
        if max(abs(x), abs(y)) < 508:
            continue
        z = float(bd_z(np.array([[x]]), np.array([[y]]))[0, 0])
        if z > 300:
            continue
        ob = bpy.data.objects.new("backdrop_tree_%04d" % placed, datas[placed % len(datas)])
        ob.location = (x, y, z - 0.3); ob.rotation_euler.z = rnd.random() * 6.283
        s = rnd.uniform(0.8, 1.35); ob.scale = (s, s, s * rnd.uniform(0.9, 1.15))
        coll.objects.link(ob); placed += 1
    return {"lake_faces": len(lake.data.polygons), "backdrop_faces": len(bd.data.polygons), "trees": placed}
