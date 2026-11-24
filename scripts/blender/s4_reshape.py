# S4: give the upper mountain ridges and gullies (it was a smooth pyramid), then re-seat everything on it.
# Only ground above ~95 m changes, so the camp, jetty, lake and waterfall area stay where they were.
import bpy, numpy as np
from mathutils import Vector, noise


def reshape_s4(amp=16.0, scale=95.0, fine_amp=4.5, fine_scale=32.0, h0=95.0, h1=150.0, seed=3):
    ter = bpy.data.objects['terrain_mountain']; me = ter.data
    nv = len(me.vertices)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    xs = np.unique(np.round(co[:, 0], 3)); ys = np.unique(np.round(co[:, 1], 3))
    nx, ny = len(xs), len(ys); x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]
    ii = np.rint((co[:, 0] - x0) / (x1 - x0) * (nx - 1)).astype(int)
    jj = np.rint((co[:, 1] - y0) / (y1 - y0) * (ny - 1)).astype(int)
    H = np.zeros((ny, nx)); H[jj, ii] = co[:, 2]
    off = Vector((seed * 17.3, seed * 5.1, 0))
    D = np.zeros_like(H)
    for j in range(ny):
        for i in range(nx):
            h = H[j, i]
            if h < h0:
                continue
            t = min(1.0, (h - h0) / (h1 - h0)); m = t * t * (3 - 2 * t)
            p = Vector((xs[i] / scale, ys[j] / scale, 0.0)) + off
            r = noise.ridged_multi_fractal(p, 0.9, 2.1, 4, 1.0, 2.0, noise_basis='PERLIN_ORIGINAL')
            f = noise.noise(Vector((xs[i] / fine_scale, ys[j] / fine_scale, 1.7)) + off, noise_basis='PERLIN_ORIGINAL')
            D[j, i] = m * (amp * (r / 2.2 - 0.55) + fine_amp * f)
    # soften the very top so the summit/crater keeps its shape
    D *= np.clip(1.0 - (H - 255.0) / 25.0, 0.35, 1.0)
    Hn = H + D
    co[:, 2] = Hn[jj, ii]
    me.vertices.foreach_set('co', co.ravel()); me.update()

    def delta(x, y):
        fx = np.clip((np.asarray(x) - x0) / (x1 - x0) * (nx - 1), 0, nx - 1.0001)
        fy = np.clip((np.asarray(y) - y0) / (y1 - y0) * (ny - 1), 0, ny - 1.0001)
        i0 = fx.astype(int); j0 = fy.astype(int); tx = fx - i0; ty = fy - j0
        a = D[j0, i0]; b = D[j0, i0 + 1]; c = D[j0 + 1, i0]; d = D[j0 + 1, i0 + 1]
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

    moved_obj = moved_mesh = 0
    for o in bpy.data.objects:
        if o.type != 'MESH' or o is ter or '00_environment_preview' in [c.name for c in o.users_collection]:
            continue
        dims = max(o.dimensions.x, o.dimensions.y)
        if o.data.users > 1 or dims < 15:
            dz = float(delta(o.matrix_world.translation.x, o.matrix_world.translation.y))
            if abs(dz) > 1e-3:
                o.location.z += dz; moved_obj += 1
        else:
            m = o.data; n = len(m.vertices)
            lc = np.empty(n * 3); m.vertices.foreach_get('co', lc); lc = lc.reshape(-1, 3)
            mw = np.array(o.matrix_world); wc = (mw[:3, :3] @ lc.T).T + mw[:3, 3]
            dz = delta(wc[:, 0], wc[:, 1])
            if np.abs(dz).max() < 1e-3:
                continue
            wc[:, 2] += dz
            inv = np.linalg.inv(mw); lc = (inv[:3, :3] @ wc.T).T + inv[:3, 3]
            m.vertices.foreach_set('co', lc.ravel()); m.update(); moved_mesh += 1
    return {"dz": [round(float(D.min()), 1), round(float(D.max()), 1)], "objects": moved_obj, "meshes": moved_mesh}
