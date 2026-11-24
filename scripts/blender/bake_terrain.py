# DroneLab3D: bake a terrain's per-face material zones into one smooth colour map.
# Run inside Blender:
#   ns = {}; exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\bake_terrain.py").read(), ns)
#   ns["bake_terrain"]("terrain_mountain", r"C:\...\terrain_color.png", ...)
#
# The terrain must be a regular grid (as built for every DroneLab scene). Each face's material marks a zone.
# Zones are blurred, broken up with noise and re-sharpened, so borders become irregular and soft instead of
# following the grid (no stair-steps). Steep slopes can be pushed to a rock zone. Every zone samples its own
# tiled diffuse texture at world scale, so the result keeps real ground detail. The terrain then gets a single
# material: baked colour on a planar 0..1 UV plus a tiled detail normal map (exported as KHR_texture_transform).
import bpy, numpy as np, os, time


def _tex_array(img):
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[:, :, :3]


def _downscale(a, s):
    """Area-average a (H, W, 3) texture to (s, s, 3)."""
    h, w, _ = a.shape
    iy = (np.arange(h) * s // h); ix = (np.arange(w) * s // w)
    out = np.zeros((s, s, 3), np.float64)
    np.add.at(out, (iy[:, None], ix[None, :]), a)
    cnt = np.zeros((s, s)); np.add.at(cnt, (iy[:, None], ix[None, :]), 1)
    return (out / cnt[:, :, None]).astype(np.float32)


def _blur(g, sigma):
    if sigma <= 0:
        return g
    r = int(sigma * 3) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    p = np.pad(g, ((r, r), (0, 0)), mode='edge')
    g = sum(k[i] * p[i:i + g.shape[0]] for i in range(2 * r + 1))
    p = np.pad(g, ((0, 0), (r, r)), mode='edge')
    return sum(k[i] * p[:, i:i + g.shape[1]] for i in range(2 * r + 1))


def _bilinear(grid, fy, fx):
    """Sample grid (H, W) at float cell coords (clamped)."""
    h, w = grid.shape
    fy = np.clip(fy, 0, h - 1.0001); fx = np.clip(fx, 0, w - 1.0001)
    y0 = fy.astype(np.int32); x0 = fx.astype(np.int32); ty = fy - y0; tx = fx - x0
    a = grid[y0, x0]; b = grid[y0, x0 + 1]; c = grid[y0 + 1, x0]; d = grid[y0 + 1, x0 + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


class _Noise:
    """Fractal value noise on [0,1]^2, evaluated lazily per chunk."""
    def __init__(self, rng, base=6, octaves=5):
        self.lat = [rng.random((base * 2 ** o + 1, base * 2 ** o + 1)) for o in range(octaves)]

    def __call__(self, u, v):
        acc = 0.0; amp = 1.0; tot = 0.0
        for L in self.lat:
            n = L.shape[0] - 1
            fy = v * n; fx = u * n
            y0 = np.clip(fy.astype(np.int32), 0, n - 1); x0 = np.clip(fx.astype(np.int32), 0, n - 1)
            ty = fy - y0; tx = fx - x0
            ty = ty * ty * (3 - 2 * ty); tx = tx * tx * (3 - 2 * tx)
            a = L[y0, x0]; b = L[y0, x0 + 1]; c = L[y0 + 1, x0]; d = L[y0 + 1, x0 + 1]
            acc = acc + amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty)
            tot += amp; amp *= 0.5
        return acc / tot


def bake_terrain(obj_name, out_png, res=4096, tile=None, default_tile=10.0, blur=1.2, noise_amp=0.9, sharp=3.0,
                 slope_zone=None, slope_deg=(32.0, 48.0), cavity=0.0, macro=0.10, tint=None,
                 detail_normal=None, detail_tile=6.0, normal_strength=0.7, roughness=0.93, seed=7, extra=None, warp=3.0, slope_gain=2.0, contrast=None):
    """tile: {material_name: metres per texture repeat}. slope_zone: material name used on steep slopes.
    tint: {material_name: (r, g, b) multiplier}. extra(weights_fn) hook: callable(x, y, h, W) -> W for custom rules
    on one chunk (x, y, h are world coords in metres, W is (K, rows, res))."""
    t0 = time.time()
    rng = np.random.default_rng(seed)
    ob = bpy.data.objects[obj_name]; me = ob.data
    nv = len(me.vertices)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    xs = np.unique(np.round(co[:, 0], 3)); ys = np.unique(np.round(co[:, 1], 3))
    nx, ny = len(xs), len(ys)
    assert nx * ny == nv, "terrain is not a regular grid"
    x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]
    ii = np.rint((co[:, 0] - x0) / (x1 - x0) * (nx - 1)).astype(int)
    jj = np.rint((co[:, 1] - y0) / (y1 - y0) * (ny - 1)).astype(int)
    H = np.zeros((ny, nx)); H[jj, ii] = co[:, 2]

    mats = [m for m in me.materials]
    K = len(mats)
    fc = np.empty(len(me.polygons) * 3); me.polygons.foreach_get('center', fc); fc = fc.reshape(-1, 3)
    fm = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', fm)
    fi = np.clip(((fc[:, 0] - x0) / (x1 - x0) * (nx - 1)).astype(int), 0, nx - 2)
    fj = np.clip(((fc[:, 1] - y0) / (y1 - y0) * (ny - 1)).astype(int), 0, ny - 2)
    W = np.zeros((K, ny - 1, nx - 1)); W[fm, fj, fi] = 1.0
    W = np.stack([_blur(W[k], blur) for k in range(K)])

    # slope (degrees) and cavity on the vertex grid
    dx = (x1 - x0) / (nx - 1); dy = (y1 - y0) / (ny - 1)
    gy, gx = np.gradient(H, dy, dx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    cav = H - _blur(H, 3.0)  # negative in hollows
    cav = np.clip(-cav / (np.abs(cav).max() + 1e-6) * 4, 0, 1)

    # per-zone textures, prefiltered to the pixel footprint of one repeat
    ext = max(x1 - x0, y1 - y0)
    texs, tiles = [], []
    for m in mats:
        img = None
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and n.outputs['Color'].links:
                l = n.outputs['Color'].links[0]
                if l.to_socket.name == 'Base Color' or l.to_node.type in ('MIX', 'MIX_RGB', 'HUE_SAT', 'BRIGHTCONTRAST'):
                    img = n.image; break
        tl = (tile or {}).get(m.name, default_tile)
        s = int(max(8, min(1024, round(res / ext * tl))))
        if img is None:
            c = np.array(m.diffuse_color[:3], np.float32)
            a = np.tile(c, (s, s, 1))
        else:
            a = _downscale(_tex_array(img), s)
        if contrast and m.name in contrast:
            mu = a.reshape(-1, 3).mean(0); a = mu + contrast[m.name] * (a - mu)
        if tint and m.name in tint:
            a = a * np.array(tint[m.name], np.float32)
        texs.append(a); tiles.append(tl)

    noises = [_Noise(rng, base=10, octaves=5) for _ in range(K)]
    warp_x = _Noise(rng, base=5, octaves=4); warp_y = _Noise(rng, base=5, octaves=4)
    ang = np.radians(37.0); ca, sa = np.cos(ang), np.sin(ang)
    macro_n = _Noise(rng, base=3, octaves=4); hue_n = _Noise(rng, base=4, octaves=3)
    rock = [m.name for m in mats].index(slope_zone) if slope_zone else -1

    out = np.empty((res, res, 4), np.float32); out[:, :, 3] = 1.0
    CH = 256
    for r0 in range(0, res, CH):
        rows = np.arange(r0, min(res, r0 + CH))
        v = (rows + 0.5) / res; u = (np.arange(res) + 0.5) / res
        V, U = np.meshgrid(v, u, indexing='ij')
        wx = x0 + U * (x1 - x0); wy = y0 + V * (y1 - y0)
        # face-grid coords (cell centres at i+0.5) and vertex-grid coords
        # domain warp (in cells): zone borders wander instead of following the original straight edges
        wu = (warp_x(U, V) - 0.5) * 2 * warp; wv = (warp_y(U, V) - 0.5) * 2 * warp
        fcx = U * (nx - 1) - 0.5 + wu; fcy = V * (ny - 1) - 0.5 + wv
        vgx = U * (nx - 1); vgy = V * (ny - 1)
        Wc = np.stack([_bilinear(W[k], fcy, fcx) for k in range(K)])
        for k in range(K):
            Wc[k] = Wc[k] + noise_amp * (noises[k](U, V) - 0.5) * (Wc[k] > 0.02)
        hc = _bilinear(H, vgy, vgx)
        if rock >= 0:
            sl = _bilinear(slope, vgy, vgx)
            s = np.clip((sl - slope_deg[0]) / (slope_deg[1] - slope_deg[0]), 0, 1)
            Wc[rock] = Wc[rock] + slope_gain * s * s * (3 - 2 * s)
        if extra:
            Wc = extra(wx, wy, hc, Wc, [m.name for m in mats], U, V)
        Wc = np.clip(Wc, 0, None) ** sharp
        Wc /= Wc.sum(0, keepdims=True) + 1e-9
        col = np.zeros((len(rows), res, 3), np.float32)
        for k in range(K):
            if Wc[k].max() < 1e-4:
                continue
            a = texs[k]; s = a.shape[0]
            # two scales, the second rotated: hides the repeat of a single tile
            ty = ((wy / tiles[k]) * s).astype(np.int64) % s
            tx = ((wx / tiles[k]) * s).astype(np.int64) % s
            rx = (ca * wx - sa * wy) / (tiles[k] * 2.3); ry = (sa * wx + ca * wy) / (tiles[k] * 2.3)
            t2 = a[(ry * s).astype(np.int64) % s, (rx * s).astype(np.int64) % s]
            col += Wc[k][:, :, None] * (0.55 * a[ty, tx] + 0.45 * t2)
        m = 1.0 + macro * (macro_n(U, V) - 0.5) * 2
        hshift = (hue_n(U, V) - 0.5) * macro
        col *= m[:, :, None]
        col[:, :, 0] *= 1 + hshift; col[:, :, 2] *= 1 - hshift
        if cavity > 0:
            cv = _bilinear(cav, vgy, vgx)
            col *= (1 - cavity * cv)[:, :, None]
        out[rows, :, :3] = np.clip(col, 0, 1)

    name = os.path.splitext(os.path.basename(out_png))[0]
    img = bpy.data.images.get(name)
    if img and tuple(img.size) != (res, res):
        bpy.data.images.remove(img); img = None
    if img is None:
        img = bpy.data.images.new(name, res, res, alpha=False)
    img.pixels.foreach_set(out.ravel())
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    img.filepath_raw = out_png; img.file_format = 'PNG'; img.save()
    img.reload()

    # planar UV 0..1 over the terrain
    lu = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', lu)
    uv = np.stack([(co[lu, 0] - x0) / (x1 - x0), (co[lu, 1] - y0) / (y1 - y0)], 1).ravel()
    me.uv_layers[0].data.foreach_set('uv', uv)

    mat = bpy.data.materials.get('mat_' + name) or bpy.data.materials.new('mat_' + name)
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); o.location = (600, 0)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); b.location = (300, 0)
    b.inputs['Roughness'].default_value = roughness
    nt.links.new(b.outputs[0], o.inputs[0])
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = img; tc.location = (-200, 200)
    tc.interpolation = 'Linear'; tc.extension = 'EXTEND'
    nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
    if detail_normal:
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = me.uv_layers[0].name; uvn.location = (-800, -200)
        mp = nt.nodes.new('ShaderNodeMapping'); mp.location = (-600, -200)
        rep = ext / detail_tile
        mp.inputs['Scale'].default_value = (rep, rep, 1)
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images[detail_normal]; tn.location = (-200, -200)
        tn.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (100, -200); nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(uvn.outputs['UV'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], tn.inputs['Vector'])
        nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    me.materials.clear(); me.materials.append(mat)
    me.polygons.foreach_set('material_index', np.zeros(len(me.polygons), np.int32))
    me.update()
    return {"res": res, "grid": [nx, ny], "zones": [m.name for m in mats], "sec": round(time.time() - t0, 1), "png": out_png}
