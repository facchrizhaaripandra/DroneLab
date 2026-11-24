# S4 v07 vegetation: light card-based trees with real leaf photos (Poly Haven fern_02, jacaranda_tree, shrub_03
# leaf atlases, combined with their alpha maps), 3 variants per species, scattered by ecological rules.
# Species: montane broadleaf tree, cemara gunung (dark, drooping tiers), tree fern, shrub, ground fern.
import bpy, numpy as np, math, random, heapq
from mathutils import Vector, Matrix

TEX = r"C:\Users\darip\Documents\DroneLab3D\S4_gunung_danau\textures"
EXT, CELL = 600.0, 5.0
# UV rectangles in the atlases (u0, v0, u1, v1) and which end is the stem: 'L', 'R' or 'B'
SPRAYS = [((0.16, 0.53, 0.99, 0.98), 'L'), ((0.00, 0.31, 0.43, 0.68), 'L'), ((0.24, 0.10, 1.00, 0.41), 'R')]
FRONDS = [((0.09, 0.05, 0.22, 0.89), 'B'), ((0.31, 0.11, 0.47, 0.98), 'B')]
SHRUB = [((0.00, 0.04, 0.74, 1.00), 'B')]


# ---------------------------------------------------------------- materials
def tinted_copy(src, name, mul):
    im = bpy.data.images.get(name)
    if im is None:
        s = bpy.data.images[src]; px = np.empty(len(s.pixels), np.float32); s.pixels.foreach_get(px); px = px.reshape(-1, 4)
        px[:, :3] = np.clip(px[:, :3] * np.array(mul, np.float32), 0, 1)
        im = bpy.data.images.new(name, s.size[0], s.size[1], alpha=True); im.pixels.foreach_set(px.ravel())
        im.filepath_raw = TEX + "\\" + name + ".png"; im.file_format = 'PNG'; im.save(); im.reload()
    return im


def card_material(name, img, rough=0.75):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    g = nt.nodes.new('ShaderNodeMath'); g.operation = 'GREATER_THAN'; g.inputs[1].default_value = 0.5   # -> glTF alphaMode MASK
    nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(t.outputs['Alpha'], g.inputs[0])
    nt.links.new(g.outputs[0], b.inputs['Alpha']); nt.links.new(b.outputs[0], o.inputs[0])
    b.inputs['Roughness'].default_value = rough
    m.use_backface_culling = False
    if hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'DITHERED'
    return m


def bark_material(name, img, mul=(1, 1, 1)):
    im = tinted_copy(img, img + "_t" + "".join(str(int(v * 10)) for v in mul), mul) if mul != (1, 1, 1) else bpy.data.images[img]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
    nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(b.outputs[0], o.inputs[0])
    b.inputs['Roughness'].default_value = 0.9
    return m


def materials():
    leaves = bpy.data.images["card_leaves"]
    return {
        "broad": card_material("mat_leaves_broadleaf", bpy.data.images["card_cluster_broad"]),
        "cemara": card_material("mat_leaves_cemara", bpy.data.images["card_cluster_cemara"]),
        "fern": card_material("mat_fern_fronds", bpy.data.images["card_fern"]),
        "shrub": card_material("mat_shrub_leaves", tinted_copy("card_cluster_broad", "card_cluster_shrub", (0.8, 0.92, 0.7))),
        "bark": bark_material("mat_bark_montane", "jacaranda_tree_trunk_diff"),
        "bark_dark": bark_material("mat_bark_fern", "jacaranda_tree_trunk_diff", (0.45, 0.4, 0.35)),
    }


# ---------------------------------------------------------------- geometry builder
class Geo:
    def __init__(self):
        self.v, self.f, self.uv, self.mi, self.n = [], [], [], [], []

    def tube(self, pts, radii, sides, mi, uv_rep=1.0):
        base = len(self.v); ring = []
        for k, (p, r) in enumerate(zip(pts, radii)):
            p = Vector(p)
            d = (Vector(pts[min(k + 1, len(pts) - 1)]) - Vector(pts[max(k - 1, 0)])).normalized()
            a = d.orthogonal().normalized(); b = d.cross(a)
            for s in range(sides + 1):
                ang = 2 * math.pi * s / sides
                nrm = a * math.cos(ang) + b * math.sin(ang)
                self.v.append(tuple(p + nrm * r)); self.n.append(tuple(nrm))
            ring.append(k)
        for k in range(len(pts) - 1):
            for s in range(sides):
                a0 = base + k * (sides + 1) + s
                q = (a0, a0 + 1, a0 + sides + 2, a0 + sides + 1)
                self.f.append(q); self.mi.append(mi)
                self.uv.append([(s / sides, k / (len(pts) - 1) * uv_rep), ((s + 1) / sides, k / (len(pts) - 1) * uv_rep),
                                ((s + 1) / sides, (k + 1) / (len(pts) - 1) * uv_rep), (s / sides, (k + 1) / (len(pts) - 1) * uv_rep)])

    def card(self, p0, d, up, length, rect, stem, mi, center, segs=2, droop=0.25, width=None):
        """A leaf card from p0 along direction d (bending down by `droop`), plane spanned by d and `up` x d."""
        u0, v0, u1, v1 = rect
        asp = (v1 - v0) / (u1 - u0) if stem in 'LR' else (u1 - u0) / (v1 - v0)
        w = width or length * asp
        side = d.cross(up).normalized()
        if side.length < 1e-4:
            side = d.orthogonal().normalized()
        pts = []; p = Vector(p0); dd = Vector(d).normalized()
        for s in range(segs + 1):
            pts.append(p.copy())
            dd = (dd + Vector((0, 0, -droop))).normalized()
            p = p + dd * (length / segs)
        base = len(self.v)
        for s, q in enumerate(pts):
            t = s / segs
            for e in (-0.5, 0.5):
                vtx = q + side * (e * w)
                self.v.append(tuple(vtx))
                nn = (vtx - Vector(center)); nn = (nn.normalized() * 0.7 + Vector((0, 0, 0.3))).normalized()
                self.n.append(tuple(nn))
        def uvof(t, e):
            if stem == 'L':
                return (u0 + (u1 - u0) * t, v0 + (v1 - v0) * (e + 0.5))
            if stem == 'R':
                return (u1 - (u1 - u0) * t, v0 + (v1 - v0) * (e + 0.5))
            return (u0 + (u1 - u0) * (e + 0.5), v0 + (v1 - v0) * t)
        for s in range(segs):
            a0 = base + s * 2
            self.f.append((a0, a0 + 1, a0 + 3, a0 + 2)); self.mi.append(mi)
            self.uv.append([uvof(s / segs, -0.5), uvof(s / segs, 0.5), uvof((s + 1) / segs, 0.5), uvof((s + 1) / segs, -0.5)])

    def quad(self, c, nrm, size, rot, mi, center, rect=(0, 0, 1, 1)):
        """A square cluster card centred at c, facing `nrm`, rotated by `rot` in its plane."""
        nrm = Vector(nrm).normalized(); a = nrm.orthogonal().normalized(); b = nrm.cross(a)
        ca, sa = math.cos(rot), math.sin(rot); ax = a * ca + b * sa; ay = -a * sa + b * ca
        base = len(self.v); u0, v0, u1, v1 = rect
        for (ex, ey) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            vtx = Vector(c) + ax * ex * size / 2 + ay * ey * size / 2
            self.v.append(tuple(vtx))
            nn = (vtx - Vector(center)); nn = (nn.normalized() * 0.75 + Vector((0, 0, 0.35))).normalized()
            self.n.append(tuple(nn))
        self.f.append((base, base + 1, base + 2, base + 3)); self.mi.append(mi)
        self.uv.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])

    def mesh(self, name, mats):
        me = bpy.data.meshes.get(name)
        if me:
            me.clear_geometry(); me.materials.clear()
        else:
            me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        for m in mats:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', np.array(self.mi, np.int32))
        uvl = me.uv_layers.new(name='UVMap')
        k = 0
        for p, uvs in zip(me.polygons, self.uv):
            for li, uv in zip(p.loop_indices, uvs):
                uvl.data[li].uv = uv
        me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
        me.normals_split_custom_set_from_vertices(self.n)
        me.update()
        return me


def broadleaf(seed, M):
    r = random.Random(seed); g = Geo()
    H = r.uniform(13, 18); trunk_h = H * r.uniform(0.42, 0.52)
    lean = Vector((r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), 0))
    pts = [lean * (k / 4) ** 2 + Vector((0, 0, trunk_h * k / 4)) for k in range(5)]
    g.tube(pts, [0.42, 0.34, 0.28, 0.24, 0.2], 6, 1, uv_rep=3)
    top = pts[-1]; cc = top + Vector((0, 0, (H - trunk_h) * 0.45))
    R = (H - trunk_h) * 0.55; Rz = (H - trunk_h) * 0.42
    for b in range(5):                                            # primary limbs into the crown
        az = b * 2 * math.pi / 5 + r.uniform(-0.3, 0.3)
        e = cc + Vector((math.cos(az) * R * 0.7, math.sin(az) * R * 0.7, r.uniform(-0.5, 1.2)))
        g.tube([top, top.lerp(e, 0.5) + Vector((0, 0, 0.8)), e], [0.2, 0.13, 0.06], 4, 1)
    # 3-4 sub-crowns (lumpy, not a perfect ball), cluster cards facing outward
    subs = [cc + Vector((r.uniform(-1, 1) * R * 0.35, r.uniform(-1, 1) * R * 0.35, r.uniform(-0.3, 0.6) * Rz)) for _ in range(r.randint(3, 4))]
    n = 26
    for k in range(n):
        sc = subs[k % len(subs)]
        zf = 1 - 1.7 * ((k * 7) % n + 0.5) / n; zf = max(-0.55, zf)
        rr = math.sqrt(max(0, 1 - zf * zf)); az = k * 2.39996 + r.uniform(-0.3, 0.3)
        dirv = Vector((rr * math.cos(az), rr * math.sin(az), zf)).normalized()
        p = sc + Vector((dirv.x * R * 0.62, dirv.y * R * 0.62, dirv.z * Rz * 0.7))
        nrm = (dirv + Vector((r.uniform(-.35, .35), r.uniform(-.35, .35), 0.25))).normalized()
        g.quad(p, nrm, r.uniform(3.6, 4.6), r.uniform(0, 6.28), 0, cc)
    return g.mesh("tree_montane_broadleaf_%d" % seed, [M["broad"], M["bark"]])


def cemara(seed, M):
    r = random.Random(seed); g = Geo()
    H = r.uniform(16, 22)
    pts = [Vector((r.uniform(-.15, .15) * k, r.uniform(-.15, .15) * k, H * 0.86 * k / 5)) for k in range(6)]
    g.tube(pts, [0.36, 0.3, 0.24, 0.18, 0.12, 0.06], 6, 1, uv_rep=4)
    tiers = 6; cc = Vector((0, 0, H * 0.62))
    for t in range(tiers):
        f = t / (tiers - 1); z = H * (0.36 + 0.56 * f)
        reach = 2.6 * (1 - f) ** 0.8 + 0.6
        tp = pts[min(5, int(f * 5))]
        cnt = 4 if t < tiers - 1 else 3
        for k in range(cnt):
            az = k * 2 * math.pi / cnt + t * 0.9 + r.uniform(-0.3, 0.3)
            dirv = Vector((math.cos(az), math.sin(az), 0))
            p = Vector((tp.x, tp.y, z - 0.6)) + dirv * reach * 0.62
            g.quad(p, dirv + Vector((0, 0, 0.12)), reach * 1.25 + 1.0, r.uniform(-0.15, 0.15), 0, cc)
    g.quad(Vector((pts[5].x, pts[5].y, H * 0.95)), Vector((0.3, 1, 0.2)), 2.4, 0, 0, cc)
    g.quad(Vector((pts[5].x, pts[5].y, H * 0.95)), Vector((1, -0.3, 0.2)), 2.4, 0, 0, cc)
    return g.mesh("tree_cemara_%d" % seed, [M["cemara"], M["bark"]])


def tree_fern(seed, M):
    r = random.Random(seed); g = Geo()
    Ht = r.uniform(2.5, 5.0)
    pts = [Vector((math.sin(k * 0.6) * 0.15, 0, Ht * k / 3)) for k in range(4)]
    g.tube(pts, [0.2, 0.16, 0.15, 0.17], 6, 1, uv_rep=2)
    top = pts[-1]
    for k in range(11):
        az = k * 2 * math.pi / 11 + r.uniform(-0.2, 0.2)
        d = Vector((math.cos(az), math.sin(az), r.uniform(0.5, 1.0))).normalized()
        rect, stem = FRONDS[k % 2]
        g.card(top, d, Vector((0, 0, 1)) if k % 2 else Vector((-math.sin(az), math.cos(az), 0.3)), r.uniform(2.4, 3.0), rect, stem, 0,
               top + Vector((0, 0, -0.5)), segs=3, droop=0.42, width=0.75)
    return g.mesh("tree_fern_%d" % seed, [M["fern"], M["bark_dark"]])


def shrub(seed, M):
    r = random.Random(seed); g = Geo(); c = Vector((0, 0, 0.4))
    sz = r.uniform(1.4, 2.0)
    for k in range(5):
        az = k * math.pi / 5 + r.uniform(-0.2, 0.2)
        g.quad(Vector((r.uniform(-.2, .2), r.uniform(-.2, .2), sz * 0.42)), Vector((math.cos(az), math.sin(az), r.uniform(0.0, 0.5))),
               sz, r.uniform(0, 6.28), 0, c)
    return g.mesh("shrub_highland_%d" % seed, [M["shrub"]])


def ground_fern(seed, M):
    r = random.Random(seed); g = Geo(); c = Vector((0, 0, -0.3))
    for k in range(8):
        az = k * 2 * math.pi / 8 + r.uniform(-0.25, 0.25)
        d = Vector((math.cos(az), math.sin(az), r.uniform(0.7, 1.3))).normalized()
        rect, stem = FRONDS[k % 2]
        g.card(Vector((0, 0, 0)), d, Vector((-math.sin(az), math.cos(az), 0.2)), r.uniform(0.9, 1.3), rect, stem, 0, c, segs=2, droop=0.35, width=0.32)
    return g.mesh("fern_ground_%d" % seed, [M["fern"]])


# ---------------------------------------------------------------- trail (A*), needed before scattering
def trail_path(H, start, goal, slope_w=900.0):
    """Hiking trail: least-cost path where steep steps are very expensive -> natural switchbacks."""
    n = H.shape[0]
    gi = lambda x, y: (int(round((y + EXT) / CELL)), int(round((x + EXT) / CELL)))
    s0, g0 = gi(*start), gi(*goal)
    NB = [(dj, di) for dj in (-1, 0, 1) for di in (-1, 0, 1) if dj or di] + [(2, 1), (1, 2), (-1, 2), (-2, 1), (-2, -1), (-1, -2), (1, -2), (2, -1)]
    dist = {s0: 0.0}; prev = {}; pq = [(0.0, s0)]
    gj, gii = g0
    while pq:
        dc, (j, i) = heapq.heappop(pq)
        if (j, i) == g0:
            break
        if dc > dist.get((j, i), 1e18):
            continue
        for dj, di in NB:
            jj, ii = j + dj, i + di
            if not (1 < jj < n - 2 and 1 < ii < n - 2):
                continue
            step = math.hypot(dj, di) * CELL
            gr = abs(H[jj, ii] - H[j, i]) / step
            if H[jj, ii] < 30.8:            # no walking in the lake
                continue
            c = step * (1 + slope_w * max(0.0, gr - 0.08) ** 2) + step * 0.2
            nd = dc + c
            if nd < dist.get((jj, ii), 1e18):
                dist[(jj, ii)] = nd; prev[(jj, ii)] = (j, i); heapq.heappush(pq, (nd, (jj, ii)))
    path = [g0]
    while path[-1] != s0:
        path.append(prev[path[-1]])
    path.reverse()
    P = np.array([(-EXT + i * CELL, -EXT + j * CELL) for j, i in path], float)
    for _ in range(4):
        P[1:-1] = (P[:-2] + 2 * P[1:-1] + P[2:]) / 4
    return P


def poly_dist(px, py, P):
    d = np.full(np.shape(px), 1e9)
    for k in range(len(P) - 1):
        ax, ay = P[k]; bx, by = P[k + 1]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy + 1e-9
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1)
        d = np.minimum(d, np.hypot(px - ax - t * dx, py - ay - t * dy))
    return d


# ---------------------------------------------------------------- scatter
def scatter(H, A, river, trail, camp, lake=30.0, seed=3):
    rng = np.random.default_rng(seed)
    n = H.shape[0]
    gy, gx = np.gradient(H, CELL); slope = np.degrees(np.arctan(np.hypot(gx, gy))); LA = np.log(A)

    def at(G, x, y):
        fx = np.clip((x + EXT) / CELL, 0, n - 1.001); fy = np.clip((y + EXT) / CELL, 0, n - 1.001)
        i0 = fx.astype(int); j0 = fy.astype(int); tx = fx - i0; ty = fy - j0
        return (G[j0, i0] * (1 - tx) + G[j0, i0 + 1] * tx) * (1 - ty) + (G[j0 + 1, i0] * (1 - tx) + G[j0 + 1, i0 + 1] * tx) * ty
    from mathutils import noise as mn
    def clump(x, y, s, sd):
        return np.array([mn.noise(Vector((a / s + sd, b / s - sd, 0.5))) for a, b in zip(x, y)])
    ss = lambda v, a, b: np.clip((v - a) / (b - a), 0, 1)
    K = 420000
    x = rng.uniform(-EXT + 8, EXT - 8, K); y = rng.uniform(-EXT + 8, EXT - 8, K)
    h = at(H, x, y); sl = at(slope, x, y); la = at(LA, x, y)
    dr = poly_dist(x, y, river); dt = poly_dist(x, y, trail); dc = np.hypot(x - camp[0], y - camp[1])
    ok = (h > lake + 1.2) & (dr > 9) & (dt > 4.5) & (dc > 45)
    meadow = ss(dc, 90, 160)                                     # thin out toward the camp meadow
    cl = clump(x, y, 90, 1.3)
    dens = {}
    valley = np.clip(ss(la, 6.3, 8.3) + (1 - ss(h, 60, 110)) * 0.6, 0, 1)   # forest fills valleys and the low ground
    dens["broad"] = ok * (1 - ss(h, 190, 250)) * (1 - ss(sl, 32, 42)) * meadow * (0.08 + 0.92 * valley) * (0.6 + 0.4 * ss(cl, -0.3, 0.3))
    dens["cemara"] = ok * ss(h, 120, 190) * (1 - ss(h, 330, 380)) * (1 - ss(sl, 36, 46)) * (0.1 + 0.9 * ss(cl, -0.05, 0.35)) * (0.35 + 0.65 * ss(la, 6.0, 8.0)) * meadow
    dens["cemara"] += ok * (np.hypot(x + 250, y + 210) < 330) * ss(h, 34, 40) * (1 - ss(h, 90, 120)) * 0.25 * meadow  # some round the lake
    dens["fern"] = ok * ss(la, 8.5, 10.5) * (1 - ss(h, 200, 240)) * (1 - ss(sl, 30, 40)) * 0.9 * meadow
    dens["shrub"] = ok * (ss(h, 220, 260) * (1 - ss(h, 400, 430)) * (1 - ss(sl, 34, 44)) * 0.8 + (1 - meadow) * ss(dc, 70, 130) * 0.6)
    dens["gfern"] = ok * (1 - ss(h, 200, 240)) * (1 - ss(sl, 30, 40)) * ss(la, 7.5, 9.5) * 0.7 * meadow
    target = {"broad": 3000, "cemara": 1800, "fern": 380, "shrub": 1300, "gfern": 1300}
    spacing = {"broad": 6.5, "cemara": 5.5, "fern": 4.0, "shrub": 2.5, "gfern": 2.0}
    occ = {}
    out = {}
    order = rng.permutation(K)
    for sp in ("broad", "cemara", "fern", "shrub", "gfern"):
        pts = []; pr = dens[sp] / max(1e-6, dens[sp].max())
        sp_ = spacing[sp]
        for k in order:
            if len(pts) >= target[sp]:
                break
            if rng.random() > pr[k]:
                continue
            key = (int(x[k] // 6), int(y[k] // 6)); clash = False
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    for (qx, qy, qs) in occ.get((key[0] + di, key[1] + dj), ()):
                        if math.hypot(qx - x[k], qy - y[k]) < max(sp_, qs) * 0.8:
                            clash = True; break
                    if clash: break
                if clash: break
            if clash:
                continue
            occ.setdefault(key, []).append((x[k], y[k], sp_))
            pts.append((float(x[k]), float(y[k]), float(h[k])))
        out[sp] = pts
    return out


def place(points, meshes, prefix, coll="03_vegetation", scale=(0.85, 1.25), seed=11, sink=0.25):
    rr = random.Random(seed); C = bpy.data.collections[coll]
    for o in [o for o in C.objects if o.name.startswith(prefix)]:
        bpy.data.objects.remove(o)
    for k, (x, y, z) in enumerate(points):
        me = meshes[k % len(meshes)]
        ob = bpy.data.objects.new("%s_%04d" % (prefix, k), me)
        s = rr.uniform(*scale)
        ob.location = (x, y, z - sink); ob.rotation_euler = (rr.uniform(-0.04, 0.04), rr.uniform(-0.04, 0.04), rr.random() * 6.283)
        ob.scale = (s, s, s * rr.uniform(0.92, 1.1))
        C.objects.link(ob)
    return len(points)
