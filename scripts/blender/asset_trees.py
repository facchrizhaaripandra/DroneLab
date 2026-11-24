# DroneLab3D: realistic card trees for every scene (replaces the old low-poly cones and balls).
# Leaf textures are photographed leaves (Poly Haven island_tree_01/02, fern_02, shrub_03, CC0) composited into
# dense cluster cards; bark is a tiling photo bark. Needs s4v07_trees.py (Geo, card_material) and
# s4v07_clusters.py (cluster compositing) loaded into `tr` and `cl`.
import bpy, numpy as np, math, random, os
from mathutils import Vector

TEX = r"C:\Users\darip\Documents\DroneLab3D\A2_aset_realistis\textures"
S4TEX = r"C:\Users\darip\Documents\DroneLab3D\S4_gunung_danau\textures"
# single leaves in the island_tree leaf atlas (u0, v0, u1, v1), stem at the bottom
TROP = [((0.01, 0.50, 0.15, 0.98), 'B'), ((0.16, 0.50, 0.34, 0.98), 'B'), ((0.36, 0.52, 0.49, 0.98), 'B'),
        ((0.51, 0.52, 0.66, 0.98), 'B'), ((0.69, 0.52, 0.82, 0.98), 'B'), ((0.01, 0.0, 0.19, 0.42), 'B'),
        ((0.21, 0.0, 0.36, 0.42), 'B'), ((0.42, 0.0, 0.56, 0.42), 'B')]
FRONDS = [((0.09, 0.05, 0.22, 0.89), 'B'), ((0.31, 0.11, 0.47, 0.98), 'B')]
HEART = [((0.0, 0.62, 0.22, 0.98), 'B'), ((0.27, 0.66, 0.46, 0.94), 'B'), ((0.0, 0.29, 0.22, 0.6), 'B'), ((0.51, 0.04, 0.72, 0.44), 'B')]


def load(path):
    stem = os.path.splitext(os.path.basename(path))[0]
    im = bpy.data.images.get(stem)
    if im is None:
        im = bpy.data.images.load(path, check_existing=True); im.name = stem
    return im


def rgba(name, diff, alpha):
    """Combine a diffuse and an alpha map into one RGBA image, colour dilated into the empty area."""
    im = bpy.data.images.get(name)
    if im:
        return im
    d = load(diff); a = load(alpha)
    D = np.empty(len(d.pixels), np.float32); d.pixels.foreach_get(D); D = D.reshape(d.size[1], d.size[0], 4)
    A = np.empty(len(a.pixels), np.float32); a.pixels.foreach_get(A); A = A.reshape(a.size[1], a.size[0], 4)[..., 0]
    m = (A > 0.5).astype(np.float32); col = D[..., :3] * m[..., None]
    for _ in range(12):
        s = np.zeros_like(col); w = np.zeros_like(m)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            s += np.roll(np.roll(col, dy, 0), dx, 1); w += np.roll(np.roll(m, dy, 0), dx, 1)
        new = (w > 0) & (m == 0); col[new] = s[new] / w[new][..., None]; m[new] = 1
    im = bpy.data.images.new(name, d.size[0], d.size[1], alpha=True)
    im.pixels.foreach_set(np.concatenate([col, A[..., None]], -1).ravel())
    im.filepath_raw = os.path.join(TEX, name + ".png"); im.file_format = 'PNG'; im.alpha_mode = 'STRAIGHT'; im.save(); im.reload()
    return im


def textures(cl):
    rgba("leaf_tropical", os.path.join(TEX, "island_tree_02_leaves_diff_1k.png"), os.path.join(TEX, "island_tree_02_leaves_alpha_1k.png"))
    for n in ("card_fern", "card_shrub"):
        load(os.path.join(S4TEX, n + ".png"))
    C = cl["cluster"]
    out = {}
    out["green"] = C("cluster_tropical_green", "leaf_tropical", TROP, n=170, mode='round', seed=11, tint=(1.55, 1.7, 1.25), scale_rng=(0.15, 0.22), spread=0.4)
    out["light"] = C("cluster_tropical_light", "leaf_tropical", TROP, n=150, mode='round', seed=12, tint=(1.4, 1.55, 0.95), scale_rng=(0.15, 0.22), spread=0.4)
    out["dry"] = C("cluster_tropical_dry", "leaf_tropical", TROP, n=90, mode='round', seed=13, tint=(2.1, 1.6, 0.8), scale_rng=(0.15, 0.22), spread=0.4)
    out["scorched"] = C("cluster_tropical_scorched", "leaf_tropical", TROP, n=55, mode='round', seed=14, tint=(1.0, 0.62, 0.32), scale_rng=(0.15, 0.22), spread=0.4)
    out["shrub"] = C("cluster_shrub_heart", "card_shrub", HEART, n=90, mode='round', seed=15, tint=(0.8, 0.95, 0.7), scale_rng=(0.18, 0.26), spread=0.22)
    out["charred"] = C("cluster_shrub_charred", "card_shrub", HEART, n=50, mode='round', seed=16, tint=(0.28, 0.2, 0.14), scale_rng=(0.18, 0.26), spread=0.22)
    return out


def materials(tr):
    cm, bm = tr["card_material"], tr["bark_material"]
    I = bpy.data.images
    bark = load(os.path.join(TEX, "island_tree_02_branches_diff_1k.png"))
    palm = load(os.path.join(TEX, "palm_tree_bark_Diffuse_1k.png"))
    M = {k: cm("mat_leaves_" + k, I["cluster_tropical_" + k]) for k in ("green", "light", "dry", "scorched")}
    M["shrub"] = cm("mat_leaves_shrub", I["cluster_shrub_heart"]); M["charred"] = cm("mat_leaves_charred", I["cluster_shrub_charred"])
    fr = tr["tinted_copy"]("card_fern", "card_palm_frond", (1.05, 1.12, 0.7)); M["frond"] = cm("mat_palm_frond", fr)
    bam = tr["tinted_copy"]("card_fern", "card_bamboo_leaf", (1.15, 1.2, 0.75)); M["bamboo_leaf"] = cm("mat_bamboo_leaf", bam)
    M["bark"] = bm("mat_bark_tropical", bark.name); M["bark_burnt"] = bm("mat_bark_burnt", bark.name, (0.22, 0.2, 0.19))
    M["bark_palm"] = bm("mat_bark_palm", palm.name)
    M["bamboo"] = bm("mat_bamboo_culm", bark.name, (0.75, 0.9, 0.45))
    return M


# ------------------------------------------------------------------ species
def _trunk_limbs(g, r, H, trunk_frac, lean, limbs, crown_r, crown_z, rad=0.32, bark=1):
    th = H * trunk_frac
    pts = [lean * (k / 4) ** 2 + Vector((0, 0, th * k / 4)) for k in range(5)]
    g.tube(pts, [rad * 1.25, rad, rad * 0.85, rad * 0.75, rad * 0.65], 7, bark, uv_rep=3)
    top = pts[-1]; ends = []
    for b in range(limbs):
        az = b * 2 * math.pi / limbs + r.uniform(-0.35, 0.35)
        e = Vector((top.x, top.y, crown_z)) + Vector((math.cos(az) * crown_r * 0.65, math.sin(az) * crown_r * 0.65, r.uniform(-0.3, 1.0)))
        g.tube([top, top.lerp(e, 0.5) + Vector((0, 0, 0.6)), e], [rad * 0.6, rad * 0.4, rad * 0.18], 5, bark)
        ends.append(e)
    return top, ends


def _crown(g, r, cc, R, Rz, n, size, mat=0, subs=3, ymin=-0.5):
    subc = [cc + Vector((r.uniform(-1, 1) * R * 0.35, r.uniform(-1, 1) * R * 0.35, r.uniform(-0.2, 0.5) * Rz)) for _ in range(subs)]
    for k in range(n):
        sc = subc[k % subs]
        zf = max(ymin, 1 - 1.7 * ((k * 7) % n + 0.5) / n)
        rr = math.sqrt(max(0, 1 - zf * zf)); az = k * 2.39996 + r.uniform(-0.3, 0.3)
        d = Vector((rr * math.cos(az), rr * math.sin(az), zf)).normalized()
        p = sc + Vector((d.x * R * 0.62, d.y * R * 0.62, d.z * Rz * 0.7))
        nrm = (d + Vector((r.uniform(-.35, .35), r.uniform(-.35, .35), 0.25))).normalized()
        g.quad(p, nrm, size * r.uniform(0.85, 1.15), r.uniform(0, 6.28), mat, cc)


def tropical(tr, M, seed, leaves="green", H=(10, 14), spread=1.0, trunk=0.45, n=30, name=None, bark="bark"):
    r = random.Random(seed); g = tr["Geo"]()
    Hh = r.uniform(*H); R = Hh * 0.36 * spread; Rz = Hh * 0.26
    cz = Hh * trunk + Rz * 0.9
    lean = Vector((r.uniform(-.5, .5), r.uniform(-.5, .5), 0))
    top, _ = _trunk_limbs(g, r, Hh, trunk, lean, 5, R, cz, rad=0.06 * Hh ** 0.9 / 2 + 0.12)
    _crown(g, r, Vector((top.x, top.y, cz)), R, Rz, n, max(2.6, R * 0.95))
    return g.mesh(name or "tree_%s_%d" % (leaves, seed), [M[leaves], M[bark]])


def frangipani(tr, M, seed):
    r = random.Random(seed); g = tr["Geo"](); H = r.uniform(4.5, 6)
    base = Vector((0, 0, 0)); g.tube([base, Vector((0.1, 0, 1.4))], [0.16, 0.13], 6, 1)
    fork = Vector((0.1, 0, 1.4)); cc = Vector((0, 0, H * 0.75))
    for b in range(6):                       # candelabra branches, leaf rosettes only at the tips
        az = b * 1.05 + r.uniform(-.3, .3); e = fork + Vector((math.cos(az) * 1.8, math.sin(az) * 1.8, H * 0.55 + r.uniform(-0.4, 0.6)))
        mid = fork.lerp(e, 0.5) + Vector((math.cos(az) * 0.4, math.sin(az) * 0.4, -0.3))
        g.tube([fork, mid, e], [0.11, 0.08, 0.05], 5, 1)
        for k in range(3):
            g.quad(e + Vector((r.uniform(-.3, .3), r.uniform(-.3, .3), 0.2)), Vector((math.cos(az + k * 2), math.sin(az + k * 2), 0.9)), 1.8, r.uniform(0, 6), 0, cc)
    return g.mesh("tree_frangipani_%d" % seed, [M["light"], M["bark"]])


def dead(tr, M, seed, H=(8, 12), leaves=None):
    """Burnt / dead tree: forked bare branches (three levels), optionally a few scorched leaf cards."""
    r = random.Random(seed); g = tr["Geo"](); Hh = r.uniform(*H)
    def branch(p, d, L, rad, lvl):
        e = p + d * L
        g.tube([p, p.lerp(e, 0.5) + Vector((r.uniform(-.2, .2), r.uniform(-.2, .2), 0)), e], [rad, rad * 0.8, rad * 0.55], 5 if lvl == 0 else 4, 1)
        if lvl < 2:
            for _ in range(2 if lvl else 4):
                nd = (d + Vector((r.uniform(-.9, .9), r.uniform(-.9, .9), r.uniform(0.0, 0.6)))).normalized()
                branch(p.lerp(e, r.uniform(0.6, 1.0)), nd, L * r.uniform(0.45, 0.65), rad * 0.5, lvl + 1)
        elif leaves:
            g.quad(e, d + Vector((0, 0, 0.5)), 1.6, r.uniform(0, 6), 0, e - d)
    branch(Vector((0, 0, 0)), Vector((r.uniform(-.1, .1), r.uniform(-.1, .1), 1)).normalized(), Hh * 0.55, 0.28, 0)
    return g.mesh("tree_dead_%s_%d" % (leaves or "bare", seed), [M[leaves or "scorched"], M["bark_burnt"]])


def palm(tr, M, seed):
    """Coconut palm: curved ringed trunk, 14 long drooping fronds, a coconut cluster."""
    r = random.Random(seed); g = tr["Geo"](); H = r.uniform(9, 14)
    lean = Vector((r.uniform(-1, 1), r.uniform(-1, 1), 0)).normalized() * r.uniform(0.6, 2.2)
    pts = [lean * (k / 8) ** 1.6 + Vector((0, 0, H * k / 8)) for k in range(9)]
    g.tube(pts, [0.24, 0.2] + [0.17] * 7, 7, 1, uv_rep=5)
    top = pts[-1]
    for k in range(14):
        az = k * 2.39996; up = r.uniform(0.15, 0.9) if k % 3 else r.uniform(-0.3, 0.2)
        d = Vector((math.cos(az), math.sin(az), up)).normalized()
        rect, stem = FRONDS[k % 2]
        g.card(top, d, Vector((-math.sin(az), math.cos(az), 0.25)), r.uniform(3.6, 4.6), rect, stem, 0, top - Vector((0, 0, 1)), segs=4, droop=0.30, width=1.25)
    return g.mesh("tree_coconut_palm_%d" % seed, [M["frond"], M["bark_palm"]])


def shrub(tr, M, seed, leaves="shrub", size=(1.4, 2.0), wide=1.0):
    r = random.Random(seed); g = tr["Geo"](); c = Vector((0, 0, 0.4)); sz = r.uniform(*size)
    for k in range(6):
        az = k * math.pi / 6 + r.uniform(-.2, .2)
        g.quad(Vector((r.uniform(-.25, .25) * wide, r.uniform(-.25, .25), sz * 0.42)), Vector((math.cos(az), math.sin(az), r.uniform(0.0, 0.5))), sz, r.uniform(0, 6.28), 0, c)
    g.quad(Vector((0, 0, sz * 0.75)), Vector((0.1, 0.1, 1)), sz * 0.9, r.uniform(0, 6), 0, c)
    me = g.mesh("shrub_%s_%d" % (leaves, seed), [M[leaves]])
    return me


def bamboo(tr, M, seed):
    """Bamboo clump: 14 culms leaning out, leaf sprays on the upper half."""
    r = random.Random(seed); g = tr["Geo"](); H = r.uniform(9, 13); cc = Vector((0, 0, H * 0.6))
    for k in range(14):
        az = r.uniform(0, 6.28); rr = r.uniform(0, 0.8); base = Vector((math.cos(az) * rr, math.sin(az) * rr, 0))
        lean = Vector((math.cos(az), math.sin(az), 0)) * r.uniform(1.0, 3.5)
        h = H * r.uniform(0.75, 1.05)
        pts = [base + lean * (t / 5) ** 2 + Vector((0, 0, h * t / 5)) for t in range(6)]
        g.tube(pts, [0.06] * 6, 5, 1, uv_rep=6)
        for t in (3, 4, 5):
            p = pts[t]; d = (pts[t] - pts[t - 1]).normalized()
            for s in (-1, 1):
                side = Vector((-d.y, d.x, 0)).normalized() * s
                rect, stem = FRONDS[(k + t) % 2]
                g.card(p, (side + Vector((0, 0, -0.2))).normalized(), Vector((0, 0, 1)), r.uniform(1.6, 2.4), rect, stem, 0, cc, segs=2, droop=0.35, width=0.7)
    return g.mesh("bamboo_clump_%d" % seed, [M["bamboo_leaf"], M["bamboo"]])


def build_library(tr, M):
    L = {}
    L["tropical"] = [tropical(tr, M, s, "green", (9, 13), 1.1, name="tree_tropical_%d" % s) for s in (1, 2, 3, 4)]
    L["tall"] = [tropical(tr, M, s, "green", (17, 23), 0.75, trunk=0.58, n=34, name="tree_forest_tall_%d" % s) for s in (5, 6, 7)]
    L["street"] = [tropical(tr, M, s, "light", (6, 8.5), 1.0, trunk=0.40, n=24, name="tree_street_%d" % s) for s in (8, 9, 10)]
    L["dry"] = [tropical(tr, M, s, "dry", (8, 12), 1.0, n=20, name="tree_dry_%d" % s) for s in (11, 12)]
    L["frangipani"] = [frangipani(tr, M, s) for s in (13, 14)]
    L["scorched"] = [dead(tr, M, s, leaves="scorched") for s in (15, 16)]
    L["dead"] = [dead(tr, M, s) for s in (17, 18, 19)]
    L["palm"] = [palm(tr, M, s) for s in (20, 21, 22)]
    L["shrub"] = [shrub(tr, M, s) for s in (23, 24, 25)]
    L["charred"] = [shrub(tr, M, s, "charred") for s in (26, 27)]
    L["hedge"] = [shrub(tr, M, s, "shrub", (1.2, 1.5), wide=3.0) for s in (28,)]
    L["bamboo"] = [bamboo(tr, M, s) for s in (29, 30)]
    for k, ms in L.items():
        for m in ms:
            m.use_fake_user = True
    return L


# which library group replaces which scene object (by name prefix, longest first)
MAP = [("tree_withered", "dry"), ("tree_transition_dry", "dry"), ("tree_scorched", "scorched"), ("tree_burnt", "dead"),
       ("tree_tall", "tall"), ("tree_mid", "tropical"), ("tree_green", "tropical"), ("tree_edge", "tropical"),
       ("tree_hill", "tropical"), ("tree_big", "tropical"), ("tree_bank", "tropical"), ("tree_park", "tropical"),
       ("tree_site", "street"), ("tree_sidewalk", "street"), ("tree_median", "street"), ("tree_frangipani", "frangipani"),
       ("tree_palm", "palm"), ("tree_coconut", "palm"), ("backdrop_tree_palm", "palm"), ("backdrop_tree_hill", "tropical"),
       ("shrub_charred", "charred"), ("shrub_hedge", "hedge"), ("shrub", "shrub"), ("bamboo_cluster", "bamboo")]


def group_for(name):
    for pre, grp in MAP:
        if name.startswith(pre):
            return grp
    return None
