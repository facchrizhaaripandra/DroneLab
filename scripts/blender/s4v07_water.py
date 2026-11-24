# S4 v07 water: lake (depth colours), river in the carved valley (white water on steep runs, calm pools), the
# waterfall at the cliff step and foam where it lands. Needs water_backdrop.py in `wb` and s4v07_terrain.py in `t`.
import bpy, numpy as np, math, random
from mathutils import Vector

TEX = r"C:\Users\darip\Documents\DroneLab3D\S4_gunung_danau\textures"


def sampler(H, ext=600.0, cell=5.0):
    n = H.shape[0]

    def th(X, Y):
        X = np.asarray(X, float); Y = np.asarray(Y, float)
        fx = np.clip((X + ext) / cell, 0, n - 1.0001); fy = np.clip((Y + ext) / cell, 0, n - 1.0001)
        i0 = fx.astype(int); j0 = fy.astype(int); tx = fx - i0; ty = fy - j0
        return (H[j0, i0] * (1 - tx) + H[j0, i0 + 1] * tx) * (1 - ty) + (H[j0 + 1, i0] * (1 - tx) + H[j0 + 1, i0 + 1] * tx) * ty
    return th


def catmull(P, step=2.0):
    P = np.asarray(P, float); pts = []; idx = []
    for k in range(len(P) - 1):
        p0 = P[max(0, k - 1)]; p1 = P[k]; p2 = P[k + 1]; p3 = P[min(len(P) - 1, k + 2)]
        steps = max(1, int(np.linalg.norm(p2 - p1) / step))
        for s in range(steps):
            t = s / steps
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
            idx.append(k + t)
    pts.append(P[-1]); idx.append(len(P) - 1)
    return np.array(pts), np.array(idx)


def ribbon(name, C, Z, half_w, offsets, colfn, mat, coll="02_water", uv_len=6.0):
    """Strip along centreline C (L,2) at heights Z (L, n_offsets) -> mesh with per-vertex colours."""
    T = np.gradient(C, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
    Nn = np.stack([-T[:, 1], T[:, 0]], 1)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
    L = len(C); nj = len(offsets)
    verts, cols, uvs = [], [], []
    for k in range(L):
        for j, t in enumerate(offsets):
            xy = C[k] + Nn[k] * t * half_w[k]
            verts.append((xy[0], xy[1], Z[k, j])); cols.append(colfn(k, j)); uvs.append((t * half_w[k] / uv_len, arc[k] / uv_len))
    faces = [(k * nj + j, k * nj + j + 1, (k + 1) * nj + j + 1, (k + 1) * nj + j) for k in range(L - 1) for j in range(nj - 1)]
    me = bpy.data.meshes.get(name)
    if me:
        me.clear_geometry()
    else:
        me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    c = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for i, cc in enumerate(cols):
        c.data[i].color = cc
    uvl = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for lp in me.loops:
        uvl.data[lp.index].uv = uvs[lp.vertex_index]
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    if not me.materials:
        me.materials.append(mat)
    ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    if not ob.users_collection:
        bpy.data.collections[coll].objects.link(ob)
    return ob, Nn, arc


def build(wb, t, H):
    th = sampler(H)
    LAKE = t["LAKE_LEVEL"]; srgb, mix, ss = wb["srgb"], wb["mix"], wb["ss"]
    ripple = bpy.data.images.get("water_ripple_nor") or wb["water_normal_png"](TEX + r"\water_ripple_nor.png", 512, seed=8, waves=60, strength=0.6)

    # ---- lake ----
    mat_lake = wb["vcol_material"]("mat_lake_water_depth", roughness=0.06, normal_img=ripple, normal_rep=0.45, normal_strength=0.18)
    sh, mid, deep = srgb(120, 134, 100), srgb(44, 98, 98), srgb(13, 48, 62)
    lc = t["LAKE_C"]

    def lake_col(X, Y, Z):
        d = LAKE - th(X, Y)
        c = mix(sh, mid, ss(d, 0.3, 3.5)); c = mix(c, deep, ss(d, 4.0, 15.0))
        return np.concatenate([c, np.ones(c.shape[:-1] + (1,), np.float32)], -1)
    lake = wb["grid_mesh"]("lake_water_surface", lc[0] - 340, lc[0] + 340, lc[1] - 260, lc[1] + 300, 4.0,
                           lambda X, Y: np.full(X.shape, LAKE), lake_col,
                           keep=lambda cx, cy, zc: (th(cx, cy) < LAKE + 0.6) & (np.hypot(cx - lc[0], cy - lc[1]) < 330),
                           coll="02_water", uv_scale=14.0, material=mat_lake)

    # ---- river ----
    R = t["RIVER"]; lip = t["FALL_LIP"]
    C, along = catmull(R, 2.0)
    zc = th(C[:, 0], C[:, 1])
    up = along <= lip
    surf = zc + 0.35
    surf[up] = np.minimum.accumulate(surf[up])                       # never flows uphill
    k_lip = int(np.argmax(along > lip)) if (along > lip).any() else len(C)
    Cu = C[:k_lip]; su = surf[:k_lip]                                    # up to the lip (the fall starts there)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(Cu, axis=0), axis=1))])
    half = (3.2 + 2.2 * arc / arc[-1]) * (0.9 + 0.2 * np.sin(arc / 11.0))
    slope = np.abs(np.gradient(su)) / (np.gradient(arc) + 1e-6)
    water, foam, white = np.array(srgb(50, 92, 98)), np.array(srgb(198, 212, 212)), np.array(srgb(234, 241, 241))
    rnd = random.Random(7)
    rap = np.clip((slope - 0.1) / 0.45, 0, 1) * (0.6 + 0.4 * np.sin(arc / 5.0 + 0.7))

    def wcol(k, j):
        f = float(np.clip(rap[k] * (1.25 if j != 1 else 1.0) + 0.06, 0, 1))
        c = water + (foam - water) * f
        if f > 0.8:
            c = c + (white - c) * 0.5
        return (*c, 1.0)
    mat_st = wb["vcol_material"]("mat_river_whitewater", roughness=0.45, normal_img=ripple, normal_rep=1.0, normal_strength=0.7)
    offs = [-1.0, 0.0, 1.0]
    Tn = np.gradient(Cu, axis=0); Tn /= np.linalg.norm(Tn, axis=1, keepdims=True); Nn = np.stack([-Tn[:, 1], Tn[:, 0]], 1)
    Zr = np.zeros((len(Cu), 3))
    for j, o in enumerate(offs):
        P = Cu + Nn * (o * half)[:, None]
        Zr[:, j] = np.maximum(su - (0.05 if o == 0 else 0.0), np.minimum(su, th(P[:, 0], P[:, 1]) + 0.12))
    river, _, _ = ribbon("river_water_surface", Cu, Zr, half, offs, wcol, mat_st)
    # wet rock bed (decal) under the stream, fading out at the edges
    mat_bed = wb["vcol_material"]("mat_stream_bed", roughness=0.55, alpha=True)
    bedc = srgb(46, 43, 38); offb = [-2.3, -1.1, 1.1, 2.3]
    Zb = np.zeros((len(Cu), 4))
    for j, o in enumerate(offb):
        P = Cu + Nn * (o * half)[:, None]; Zb[:, j] = th(P[:, 0], P[:, 1]) + 0.07
    ribbon("river_bed_decal", Cu, Zb, half, offb, lambda k, j: (*bedc, 0.0 if j in (0, 3) else 0.85), mat_bed)

    # ---- waterfall: free-falling sheet (ballistic arc away from the cliff), streaked, thicker at the bottom ----
    p_lip = Cu[-1]; d = Cu[-1] - Cu[-2]; d /= np.linalg.norm(d)
    top = su[-1]; drop = top - LAKE
    nu, rows, wfall = 12, 18, half[-1] * 2.0
    nrm = np.array([-d[1], d[0]])
    rr = random.Random(5); streak = [rr.random() for _ in range(nu + 1)]
    verts, cols, faces = [], [], []
    v0 = 2.2                                                          # m/s over the lip
    for j in range(rows + 1):
        tt = j / rows
        dz = drop * tt; tfall = math.sqrt(2 * max(dz, 0) / 9.81)
        out = 0.6 + v0 * tfall
        q = p_lip + d * out
        for i in range(nu + 1):
            s_ = i / nu - 0.5
            p = q + nrm * s_ * wfall * (1 + 0.35 * tt)
            verts.append((p[0], p[1], top - dz + 0.05))
            w = 0.74 + 0.26 * streak[i] - 0.12 * (1 - tt)
            edge = 1 - abs(s_) * 2
            cols.append((w, min(1, w + 0.03), min(1, w + 0.05), (0.55 + 0.4 * tt) * min(1, edge * 3 + 0.2)))
    for j in range(rows):
        for i in range(nu):
            a_ = j * (nu + 1) + i; faces.append((a_, a_ + 1, a_ + nu + 2, a_ + nu + 1))
    mat_fall = wb["vcol_material"]("mat_waterfall_streaks", roughness=0.3, alpha=True)
    me = bpy.data.meshes.get("waterfall_water_sheet") or bpy.data.meshes.new("waterfall_water_sheet")
    me.clear_geometry(); me.from_pydata(verts, [], faces)
    c = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for i, cc in enumerate(cols):
        c.data[i].color = cc
    if not me.materials:
        me.materials.append(mat_fall)
    ob = bpy.data.objects.get("waterfall_water_sheet") or bpy.data.objects.new("waterfall_water_sheet", me)
    if not ob.users_collection:
        bpy.data.collections["02_water"].objects.link(ob)
    prof = [(p_lip + d * (0.6 + v0 * math.sqrt(2 * drop / 9.81)), LAKE)]
    base = prof[-1][0]
    mat_foam = wb["vcol_material"]("mat_water_foam", roughness=0.6, alpha=True)

    def foam_col(X, Y, Z):
        r = np.hypot(X - base[0], Y - base[1])
        a = np.clip(1 - r / 11.0, 0, 1) ** 1.4 * 0.85
        return np.stack([np.full(X.shape, 0.92), np.full(X.shape, 0.95), np.full(X.shape, 0.96), a], -1)
    wb["grid_mesh"]("waterfall_foam_pool", base[0] - 12, base[0] + 12, base[1] - 12, base[1] + 12, 1.0,
                    lambda X, Y: np.full(X.shape, LAKE + 0.04), foam_col, coll="02_water", material=mat_foam)
    return {"lake_faces": len(lake.data.polygons), "river_pts": len(Cu), "fall_drop": round(float(drop), 1),
            "lip_z": round(float(top), 1), "fall_xy": [round(float(p_lip[0])), round(float(p_lip[1]))]}
