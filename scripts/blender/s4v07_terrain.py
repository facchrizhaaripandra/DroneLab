# DroneLab3D S4 v07 "Pegunungan dan danau", built from scratch: heightmap with a volcano and crater, foothill
# ridges, stream-power erosion (dendritic valleys), a lake basin, a river valley with a waterfall step and a flat
# camp meadow. Blender X = east, Y = north, metres. Pure numpy + mathutils.noise.
import bpy, numpy as np, math
from mathutils import Vector, noise

EXT = 600.0          # playable half-size (1.2 km square)
CELL = 5.0
N = int(2 * EXT / CELL) + 1   # 241
LAKE_LEVEL = 30.0
PEAK = (170.0, 250.0)
LAKE_C = (-250.0, -210.0)
CAMP = (-60.0, -372.0)
# river: spring on the volcano's west flank -> valleys found by least-cost routing -> lip on the shelf above the
# lake's north shore -> ~85 m waterfall into the lake. RIVER / FALL_LIP are filled in by build().
SPRING = (40.0, 215.0)
LIP = (-300.0, -24.0)
RIVER = []
FALL_LIP = 0


def grid():
    xs = np.linspace(-EXT, EXT, N)
    return np.meshgrid(xs, xs)  # X[j, i], Y[j, i]


def _noise_field(X, Y, scale, kind='fbm', octaves=5, seed=0, H=0.55, lac=2.05):
    out = np.empty(X.size); fx = X.ravel() / scale; fy = Y.ravel() / scale
    off = Vector((seed * 31.7, seed * -17.3, seed * 3.1))
    for k in range(X.size):
        p = Vector((fx[k], fy[k], 0.37)) + off
        if kind == 'ridged':
            out[k] = noise.ridged_multi_fractal(p, 0.95, lac, octaves, 1.0, 2.2, noise_basis='PERLIN_ORIGINAL')
        else:
            out[k] = noise.fractal(p, H, lac, octaves, noise_basis='PERLIN_ORIGINAL')
    return out.reshape(X.shape)


def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def seg_dist(X, Y, pts):
    """Distance from each grid point to a polyline, plus the fractional index along it."""
    best = np.full(X.shape, 1e9); along = np.zeros(X.shape)
    for k in range(len(pts) - 1):
        ax, ay = pts[k]; bx, by = pts[k + 1]
        dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / L2, 0, 1)
        d = np.hypot(X - (ax + t * dx), Y - (ay + t * dy))
        m = d < best; best[m] = d[m]; along[m] = (k + t)[m]
    return best, along


def base_height(X, Y):
    # domain warp so nothing is perfectly round
    wx = _noise_field(X, Y, 420, 'fbm', 3, seed=1) * 70
    wy = _noise_field(X, Y, 420, 'fbm', 3, seed=2) * 70
    Xw, Yw = X + wx, Y + wy
    # volcano: concave profile (steeper near the top), crater, breach to the south-west
    r = np.hypot(Xw - PEAK[0], Yw - PEAK[1])
    cone = 520 * np.exp(-(r / 300.0) ** 1.35)
    ang = np.arctan2(Yw - PEAK[1], Xw - PEAK[0])
    rim = 1 - 0.35 * ss(np.cos(ang - math.radians(225)), 0.6, 1.0)          # lower rim toward the south-west
    crater = 85 * (1 - ss(r, 35, 95)) * rim
    h = 40 + cone - crater
    # radial ridges on the cone (lava ribs), stronger mid-slope
    ribs = _noise_field(Xw * 0.6 + np.cos(ang) * 180, Yw * 0.6 + np.sin(ang) * 180, 70, 'ridged', 4, seed=3)
    h += ribs * 7 * ss(r, 90, 150) * (1 - ss(r, 260, 380))
    # foothill ridges everywhere else
    hills = _noise_field(Xw, Yw, 230, 'ridged', 5, seed=4)
    h += 55 * (hills / 2.0) ** 1.5 * (1 - 0.6 * np.exp(-(r / 260.0) ** 2))
    h += 7 * _noise_field(X, Y, 70, 'fbm', 4, seed=5)
    # a second, smaller peak to the east and a high ridge closing the north-west
    h += 150 * np.exp(-(np.hypot(Xw - 470, Yw - (-40)) / 170.0) ** 1.6)
    h += 120 * np.exp(-(np.hypot(Xw + 430, Yw - 330) / 220.0) ** 1.8)
    return h


def receivers(H):
    """D8 steepest-descent receiver index for every cell (self for pits/edges)."""
    n = H.shape[0]; idx = np.arange(H.size).reshape(H.shape)
    best = np.zeros(H.shape); rec = idx.copy()
    P = np.pad(H, 1, mode='edge'); I = np.pad(idx, 1, mode='edge')
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            if dj == 0 and di == 0:
                continue
            d = math.hypot(dj, di) * CELL
            nb = P[1 + dj:1 + dj + n, 1 + di:1 + di + n]
            s = (H - nb) / d
            m = s > best
            best[m] = s[m]; rec[m] = I[1 + dj:1 + dj + n, 1 + di:1 + di + n][m]
    return rec.ravel(), best.ravel()


NB = [(dj, di) for dj in (-1, 0, 1) for di in (-1, 0, 1) if dj or di]


def mfd_accumulate(H, p=1.3):
    """Multiple-flow-direction accumulation: each cell passes its water to every lower neighbour in proportion
    to slope^p (no D8 grid bias, so valleys branch naturally)."""
    n = H.shape[0]; P = np.pad(H, 1, mode='edge')
    W = np.zeros((8,) + H.shape)
    for k, (dj, di) in enumerate(NB):
        s = (H - P[1 + dj:1 + dj + n, 1 + di:1 + di + n]) / (math.hypot(dj, di) * CELL)
        W[k] = np.maximum(s, 0) ** p
    tot = W.sum(0); W = np.where(tot > 0, W / np.maximum(tot, 1e-12), 0)
    Wl = [W[k].ravel().tolist() for k in range(8)]
    offs = [dj * n + di for dj, di in NB]
    A = [CELL * CELL] * (n * n)
    order = np.argsort(-H.ravel(), kind='stable').tolist()
    for c in order:
        a = A[c]; j, i = divmod(c, n)
        if j == 0 or i == 0 or j == n - 1 or i == n - 1:
            continue
        for k in range(8):
            w = Wl[k][c]
            if w:
                A[c + offs[k]] += a * w
    return np.array(A).reshape(H.shape)


def _blur3(E):
    P = np.pad(E, 1, mode='edge')
    return (4 * E + P[:-2, 1:-1] + P[2:, 1:-1] + P[1:-1, :-2] + P[1:-1, 2:]) / 8.0


def erode(H, iters=14, k=0.0009, m=0.5, dt=40.0, diff=0.18, keep=None):
    """Implicit stream-power incision (Braun & Willett 2013: unconditionally stable, no terraces) with drainage
    area from multiple-flow routing, plus isotropic hillslope diffusion. `keep` (0..1) protects cells."""
    n = H.shape[0]
    kf = np.full(H.size, k) if keep is None else (k * (1 - keep)).ravel()
    for it in range(iters):
        A = mfd_accumulate(H).ravel()
        rec, _ = receivers(H)
        h = H.ravel().copy()
        order = np.argsort(h, kind='stable').tolist()   # receivers before donors
        recl = rec.tolist(); Al = A.tolist(); kl = kf.tolist(); hl = h.tolist()
        for c in order:
            r = recl[c]
            if r == c:
                continue
            dj = abs(r // n - c // n); di = abs(r % n - c % n)
            dist = CELL * (1.41421356 if (dj and di) else 1.0)
            F = kl[c] * (Al[c] ** m) * dt / dist
            hl[c] = (hl[c] + F * hl[r]) / (1 + F)
        H = np.array(hl).reshape(H.shape)
        # hillslope diffusion (8-neighbour Laplacian): rounds ridges, fills single-cell spikes
        P = np.pad(H, 1, mode='edge')
        lap = (P[:-2, 1:-1] + P[2:, 1:-1] + P[1:-1, :-2] + P[1:-1, 2:]) * 0.2 + (P[:-2, :-2] + P[:-2, 2:] + P[2:, :-2] + P[2:, 2:]) * 0.05 - H
        H = H + diff * lap * (1 - (0 if keep is None else keep))
    return H, mfd_accumulate(H)


def river_path(H, A, start, goal):
    """Least-cost path on the grid that follows drainage (cheap where flow is high) and avoids climbing."""
    import heapq
    n = H.shape[0]; LA = np.log(A)
    gi = lambda x, y: (int(round((y + EXT) / CELL)), int(round((x + EXT) / CELL)))
    s0 = gi(*start); g0 = gi(*goal)
    dist = {s0: 0.0}; prev = {}; pq = [(0.0, s0)]
    while pq:
        dcur, (j, i) = heapq.heappop(pq)
        if (j, i) == g0:
            break
        if dcur > dist.get((j, i), 1e18):
            continue
        for dj, di in NB:
            jj, ii = j + dj, i + di
            if not (0 < jj < n - 1 and 0 < ii < n - 1):
                continue
            step = math.hypot(dj, di) * CELL
            up = max(0.0, H[jj, ii] - H[j, i])
            c = step / (1.0 + 0.35 * max(0.0, LA[jj, ii] - 5.0)) + 25.0 * up
            nd = dcur + c
            if nd < dist.get((jj, ii), 1e18):
                dist[(jj, ii)] = nd; prev[(jj, ii)] = (j, i); heapq.heappush(pq, (nd, (jj, ii)))
    path = [g0]
    while path[-1] != s0:
        path.append(prev[path[-1]])
    path.reverse()
    pts = [(-EXT + i * CELL, -EXT + j * CELL) for j, i in path]
    # smooth (moving average) and thin to ~12 m spacing
    P = np.array(pts, float)
    for _ in range(3):
        P[1:-1] = (P[:-2] + 2 * P[1:-1] + P[2:]) / 4
    out = [tuple(P[0])]
    acc = 0.0
    for k in range(1, len(P)):
        acc += np.linalg.norm(P[k] - P[k - 1])
        if acc >= 12.0 or k == len(P) - 1:
            out.append(tuple(P[k])); acc = 0.0
    return out


def carve(H, X, Y, A=None):
    """Lake basin, camp meadow, river valley with a waterfall step."""
    # lake: rotated ellipse, smooth floor to ~16 m below the water, cliffs on the north-west shore
    c, s_ = math.cos(math.radians(25)), math.sin(math.radians(25))
    u = ((X - LAKE_C[0]) * c + (Y - LAKE_C[1]) * s_) / 250.0
    v = (-(X - LAKE_C[0]) * s_ + (Y - LAKE_C[1]) * c) / 165.0
    q = np.hypot(u, v) + 0.08 * _noise_field(X, Y, 60, 'fbm', 3, seed=8)
    floor = LAKE_LEVEL - 17 * (1 - ss(q, 0.0, 0.95)) - 1.5
    shore_w = 1 - ss(q, 0.9, 1.45)
    nw = ss(-(X - LAKE_C[0]) * 0.7 + (Y - LAKE_C[1]) * 0.7, 40, 160)    # north-west side keeps its cliffs
    lake_mask = shore_w * (1 - 0.75 * nw * ss(q, 0.95, 1.2))
    target = np.where(q < 1.0, floor, LAKE_LEVEL + (q - 1.0) * 40)
    H = H * (1 - lake_mask) + np.minimum(H, target) * lake_mask
    # camp meadow: gently sloping terrace a few metres above the water
    dc = np.hypot(X - CAMP[0], Y - CAMP[1])
    meadow = 1 - ss(dc, 55, 125)
    H = H * (1 - meadow) + (LAKE_LEVEL + 3.5 + (dc / 125.0) * 5 + 0.5 * _noise_field(X, Y, 30, 'fbm', 2, seed=9)) * meadow
    # river: route along the drainage, then a monotone bed, a vertical cliff at the lip and a plunge pool
    global RIVER, FALL_LIP
    route = river_path(H, A, SPRING, LIP)
    lc = np.array(LAKE_C); lp = np.array(route[-1]); dirv = (lc - lp) / np.linalg.norm(lc - lp)
    tail = [tuple(lp + dirv * s) for s in (6.0, 16.0, 30.0)]
    RIVER = route + tail; FALL_LIP = len(route) - 1
    d, along = seg_dist(X, Y, RIVER)
    zs = []
    for (x, y) in RIVER:
        i = int(round((x + EXT) / CELL)); j = int(round((y + EXT) / CELL)); zs.append(float(H[j, i]))
    zs = np.array(zs)
    prof = zs.copy()
    prof[:FALL_LIP + 1] = np.minimum.accumulate(zs[:FALL_LIP + 1]) - 1.0     # always downhill, slightly incised
    lipz = prof[FALL_LIP]
    prof[FALL_LIP + 1:] = LAKE_LEVEL - 3.0
    bed = np.interp(along, np.arange(len(RIVER)), prof)
    after = along > FALL_LIP
    t_ = np.clip((along - FALL_LIP) / 0.35, 0, 1)                              # drop within ~2 m of the lip
    bed = np.where(after, lipz + (LAKE_LEVEL - 3.0 - lipz) * t_, bed)
    width = np.where(after, 16.0, 6.0 + 4.0 * (along / max(1, FALL_LIP)))
    valley = bed - 1.6 + (np.maximum(d - width * 0.5, 0) ** 1.12) * np.where(after, 2.5, 0.6)
    w = 1 - ss(d, width, width + np.where(after, 14, 60))
    H = H * (1 - w) + np.minimum(H, valley) * w
    # plunge pool basin at the foot of the fall
    foot = lp + dirv * 20.0
    dp = np.hypot(X - foot[0], Y - foot[1])
    H = np.minimum(H, np.where(dp < 16, LAKE_LEVEL - 6 + (dp / 16) ** 2 * 6, 1e9))
    # soften the shore band and the meadow (they kept raw noise because erosion was held back there)
    sm = np.clip(np.maximum(ss(q, 0.75, 1.0) * (1 - ss(q, 1.5, 1.9)), meadow), 0, 1) * (1 - w)
    for _ in range(8):
        P = np.pad(H, 1, mode='edge')
        lap = (P[:-2, 1:-1] + P[2:, 1:-1] + P[1:-1, :-2] + P[1:-1, 2:]) * 0.25 - H
        H = H + 0.5 * lap * sm
    return H, bed, d, along


def build_mesh(H, name="terrain_highland", coll="01_terrain"):
    X, Y = grid()
    n = N
    verts = np.stack([X.ravel(), Y.ravel(), H.ravel()], 1)
    idx = np.arange(n * n).reshape(n, n)
    faces = np.stack([idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()], 1)
    me = bpy.data.meshes.get(name)
    if me is None:
        me = bpy.data.meshes.new(name)
    else:
        me.clear_geometry()
    me.from_pydata(verts.tolist(), [], faces.tolist())
    uv = me.uv_layers.new(name='UVMap') if not me.uv_layers else me.uv_layers[0]
    lp = np.empty(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lp)
    V = verts[lp]
    uv.data.foreach_set('uv', np.stack([(V[:, 0] + EXT) / (2 * EXT), (V[:, 1] + EXT) / (2 * EXT)], 1).astype(np.float32).ravel())
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    me.update()
    ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    if not ob.users_collection:
        c = bpy.data.collections.get(coll) or bpy.data.collections.new(coll)
        if c.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(c)
        c.objects.link(ob)
    return ob


def build():
    X, Y = grid()
    H = base_height(X, Y)
    # protect lake + camp area from erosion noise (they get carved after)
    dl = np.hypot(X - LAKE_C[0], Y - LAKE_C[1]); dc = np.hypot(X - CAMP[0], Y - CAMP[1])
    keep = np.maximum(1 - ss(dl, 200, 320), 1 - ss(dc, 90, 160))
    H, A = erode(H, keep=keep * 0.7)
    H, bed, d, along = carve(H, X, Y, A)
    np.save(bpy.path.abspath("//s4v07_river.npy"), np.array(RIVER + [(FALL_LIP, 0)], float))
    np.save(bpy.path.abspath("//s4v07_height.npy"), H)
    np.save(bpy.path.abspath("//s4v07_flow.npy"), A)
    ob = build_mesh(H)
    return {"min": round(float(H.min()), 1), "max": round(float(H.max()), 1), "N": N}
