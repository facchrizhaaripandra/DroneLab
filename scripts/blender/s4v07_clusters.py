# Composite dense leaf-cluster card textures from single-leaf atlas regions (numpy, inverse affine sampling).
import bpy, numpy as np, math, random

TEX = r"C:\Users\darip\Documents\DroneLab3D\S4_gunung_danau\textures"


def _img(name):
    im = bpy.data.images[name]; px = np.empty(len(im.pixels), np.float32); im.pixels.foreach_get(px)
    return px.reshape(im.size[1], im.size[0], 4)


def _crop(A, rect):
    h, w, _ = A.shape; u0, v0, u1, v1 = rect
    return A[int(v0 * h):int(v1 * h), int(u0 * w):int(u1 * w)]


def stamp(canvas, src, cx, cy, ang, scale, stem, shade=1.0):
    """Paste src (H,W,4) so that its stem end sits at (cx, cy) pointing along `ang`; alpha-over, darkened by shade."""
    sh, sw, _ = src.shape; H, W, _ = canvas.shape
    L = (sw if stem in 'LR' else sh) * scale; Wd = (sh if stem in 'LR' else sw) * scale
    ca, sa = math.cos(ang), math.sin(ang)
    # bounding box of the stamped quad
    corners = []
    for a in (0, L):
        for b in (-Wd / 2, Wd / 2):
            corners.append((cx + a * ca - b * sa, cy + a * sa + b * ca))
    xs = [c[0] for c in corners]; ys = [c[1] for c in corners]
    x0, x1 = max(0, int(min(xs))), min(W, int(max(xs)) + 1); y0, y1 = max(0, int(min(ys))), min(H, int(max(ys)) + 1)
    if x1 <= x0 or y1 <= y0:
        return
    Y, X = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx, dy = X - cx, Y - cy
    a = (dx * ca + dy * sa) / scale; b = (-dx * sa + dy * ca) / scale       # along / across, in source pixels
    if stem == 'L':
        u, v = a, b + sh / 2
    elif stem == 'R':
        u, v = sw - a, b + sh / 2
    else:  # 'B': stem at the bottom row of the source (image row 0 = bottom in Blender)
        u, v = b + sw / 2, a
    m = (u >= 0) & (u < sw - 1) & (v >= 0) & (v < sh - 1)
    if not m.any():
        return
    s = src[np.clip(v.astype(int), 0, sh - 1), np.clip(u.astype(int), 0, sw - 1)]
    al = s[..., 3] * m
    reg = canvas[y0:y1, x0:x1]
    reg[..., :3] = reg[..., :3] * (1 - al[..., None]) + s[..., :3] * shade * al[..., None]
    reg[..., 3] = reg[..., 3] + al * (1 - reg[..., 3])


def cluster(name, atlas, parts, n=30, size=1024, mode='round', seed=1, tint=(1, 1, 1), scale_rng=(0.27, 0.37), spread=0.12):
    rng = random.Random(seed); A = _img(atlas)
    srcs = [(_crop(A, r), st) for r, st in parts]
    can = np.zeros((size, size, 4), np.float32)
    c = size / 2
    for k in range(n):
        f = k / n
        src, st = srcs[k % len(srcs)]
        if mode == 'round':                           # radial burst, inner (early) stamps darker = depth
            ang = rng.uniform(0, 2 * math.pi); r0 = size * spread * math.sqrt(rng.random())
            cx, cy = c + r0 * math.cos(ang), c + r0 * math.sin(ang)
            scale = size * rng.uniform(*scale_rng) / max(src.shape[:2])
            shade = 0.55 + 0.45 * f
        else:                                         # 'hang': sprays hanging down from the top centre (cemara)
            cx, cy = c + rng.uniform(-size * 0.14, size * 0.14), size * rng.uniform(0.6, 0.88)
            ang = -math.pi / 2 + rng.uniform(-0.55, 0.55)
            scale = size * rng.uniform(0.34, 0.46) / max(src.shape[:2])
            shade = 0.55 + 0.45 * f
        stamp(can, src, cx, cy, ang, scale, st, shade)
    can[..., :3] *= np.array(tint, np.float32)
    # dilate colour into empty pixels (no dark fringes when mip-mapped)
    m = (can[..., 3] > 0.5).astype(np.float32); col = can[..., :3] * m[..., None]
    for _ in range(10):
        s = np.zeros_like(col); w = np.zeros_like(m)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            s += np.roll(np.roll(col, dy, 0), dx, 1); w += np.roll(np.roll(m, dy, 0), dx, 1)
        new = (w > 0) & (m == 0); col[new] = s[new] / w[new][..., None]; m[new] = 1
    can[..., :3] = np.where(m[..., None] > 0, col, can[..., :3])
    im = bpy.data.images.get(name) or bpy.data.images.new(name, size, size, alpha=True)
    im.pixels.foreach_set(np.clip(can, 0, 1).ravel()); im.filepath_raw = TEX + "\\" + name + ".png"; im.file_format = 'PNG'
    im.alpha_mode = 'STRAIGHT'; im.save(); im.reload()
    return float((can[..., 3] > 0.5).mean())
