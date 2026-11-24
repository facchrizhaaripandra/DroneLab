# DroneLab3D: smooth, real-proportioned vehicles built from lofted cross-sections (Indonesian street mix):
# sedan, hatchback, MPV, SUV, pickup, taxi, minibus/bus, box truck, motorbike. Each body is one mesh with
# paint, tinted glass, trim (bumpers, sills), lights, tyres and rims; wheel arches are cut into the sill line.
import bpy, bmesh, math, numpy as np
from mathutils import Vector

# ------------------------------------------------------------------ materials
def pbr(name, color, rough=0.5, metal=0.0, coat=0.0, emit=None, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = 0.05
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 0.6
    return m


PAINTS = {"white": (0.80, 0.80, 0.79), "silver": (0.55, 0.56, 0.57), "black": (0.02, 0.02, 0.022), "red": (0.50, 0.03, 0.03),
          "blue": (0.04, 0.12, 0.38), "grey": (0.22, 0.23, 0.24), "taxi": (0.02, 0.24, 0.62), "yellow": (0.75, 0.50, 0.02),
          "green": (0.05, 0.22, 0.10), "orange": (0.70, 0.22, 0.02)}


def materials():
    M = {k: pbr("mat_car_paint_" + k, c, rough=0.28, metal=0.55 if k in ("silver", "grey", "blue") else 0.15, coat=0.8) for k, c in PAINTS.items()}
    M["glass"] = pbr("mat_car_glass_tinted", (0.03, 0.045, 0.055), rough=0.06, metal=0.2)
    M["trim"] = pbr("mat_car_trim_black", (0.025, 0.025, 0.027), rough=0.7)
    M["tyre"] = pbr("mat_car_tyre", (0.018, 0.018, 0.018), rough=0.9)
    M["rim"] = pbr("mat_car_rim_alloy", (0.62, 0.63, 0.64), rough=0.3, metal=1.0)
    M["head"] = pbr("mat_car_headlight", (0.75, 0.76, 0.74), rough=0.08, metal=0.6)
    M["tail"] = pbr("mat_car_taillight", (0.55, 0.02, 0.02), rough=0.2, emit=(0.4, 0.0, 0.0))
    M["burnt"] = pbr("mat_car_burnt", (0.035, 0.03, 0.028), rough=0.95)
    M["rust"] = pbr("mat_car_rust", (0.18, 0.07, 0.03), rough=0.95)
    M["cargo"] = pbr("mat_truck_box_white", (0.75, 0.75, 0.73), rough=0.6)
    M["seat"] = pbr("mat_moto_seat", (0.03, 0.03, 0.03), rough=0.6)
    return M


SLOTS = ["paint", "glass", "trim", "tyre", "rim", "head", "tail", "cargo"]


# ------------------------------------------------------------------ body loft
def interp(keys, t):
    ts = [k[0] for k in keys]; vs = [k[1] for k in keys]
    return float(np.interp(t, ts, vs))


def section(w, z0, belt, z1, tumble, M=22):
    """Closed cross-section (y, z) points, counter-clockwise, bottom centre first. tumble = roof width / body width."""
    pts = []
    r = min(0.12, (z1 - z0) * 0.25)
    # bottom (flat) -> lower side -> shoulder at belt -> greenhouse -> roof
    prof = [(0.0, z0), (w * 0.82, z0), (w * 0.97, z0 + r * 0.6), (w, z0 + r * 1.6), (w, belt - 0.05), (w * 0.985, belt),
            (w * tumble * 1.04, z1 - r * 1.2), (w * tumble * 0.93, z1 - r * 0.25), (w * tumble * 0.6, z1), (0.0, z1)]
    right = prof
    left = [(-y, z) for (y, z) in reversed(prof[1:-1])]
    return right + left  # 10 + 8 = 18 points, a loop starting at bottom centre


def loft(name, L, W, keys_top, keys_belt, keys_tumble, axles, wheel_r, z_floor=0.30, glass_t=None, bpillars=(),
         lights=True, open_bed=None, K=40):
    """keys_*: [(t, value)] along the length, t = 0 front bumper, 1 rear bumper. glass_t: (t0, t1) of the cabin glass."""
    bm = bmesh.new()
    rings = []
    ts = [0.5 * (1 - math.cos(math.pi * k / (K - 1))) for k in range(K)]  # denser at the ends
    for t in ts:
        x = L / 2 - t * L
        z1 = interp(keys_top, t); belt = min(interp(keys_belt, t), z1 - 0.02); tum = interp(keys_tumble, t)
        # sill line: lifted into an arch over each axle
        z0 = z_floor + 0.06 * (1 - min(1, 4 * min(t, 1 - t)))
        for ax in axles:
            d = abs(x - ax) / (wheel_r * 1.25)
            if d < 1:
                z0 = max(z0, wheel_r + (wheel_r * 1.12) * math.sqrt(1 - d * d) - 0.05)
        endw = 1 - 0.12 * (1 - min(1, 7 * min(t, 1 - t))) ** 2               # rounded nose and tail in plan
        sec = section(W / 2 * endw, z0, belt, z1, tum)
        rings.append([bm.verts.new((x, y, z)) for (y, z) in sec])
    n = len(rings[0])
    faces = []
    for k in range(K - 1):
        for i in range(n):
            a, b = rings[k][i], rings[k][(i + 1) % n]; c, d = rings[k + 1][(i + 1) % n], rings[k + 1][i]
            f = bm.faces.new((a, b, c, d)); faces.append((f, ts[k], ts[k + 1], i))
    fcap = bm.faces.new(list(reversed(rings[0]))); rcap = bm.faces.new(rings[-1])
    bm.normal_update()
    # materials by position
    for f, t0, t1, i in faces:
        c = f.calc_center_median(); tm = (t0 + t1) / 2
        belt = interp(keys_belt, tm); z1 = interp(keys_top, tm)
        slot = 0
        if c.z < belt - 0.02 and c.z < z_floor + 0.22:
            slot = 2                                                          # sills / lower trim
        if (tm < 0.035 or tm > 0.965) and c.z < belt - 0.08:
            slot = 2                                                          # bumpers
        zr = max(v for _, v in keys_top)
        if glass_t and glass_t[0] < tm < glass_t[1] and belt + 0.03 < c.z < zr - 0.07 and abs(f.normal.z) < 0.93:
            slot = 1
            for p in bpillars:
                if abs(tm - p) < 0.012:
                    slot = 0
        f.material_index = slot
    fcap.material_index = 2; rcap.material_index = 2
    # lights: faces on the nose / tail just under the belt, at the outer corners
    if lights:
        for f, t0, t1, i in faces:
            c = f.calc_center_median(); tm = (t0 + t1) / 2; belt = interp(keys_belt, tm)
            if belt - 0.13 < c.z < belt - 0.04 and abs(c.y) > W * 0.32:
                if tm < 0.014:
                    f.material_index = 5
                elif tm > 0.986:
                    f.material_index = 6
    me = bpy.data.meshes.new(name)
    for _ in SLOTS:
        me.materials.append(None)          # slots first, or to_mesh clamps every material index to 0
    bm.to_mesh(me); bm.free()
    return me


def add_wheels(bm, axles, track, r, width=0.22):
    for ax in axles:
        for s in (-1, 1):
            y = s * (track / 2)
            tyre = bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r, radius2=r, depth=width)
            bmesh.ops.rotate(bm, verts=tyre['verts'], cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2, 3, 'X'))
            bmesh.ops.translate(bm, verts=tyre['verts'], vec=(ax, y, r))
            for f in {f for v in tyre['verts'] for f in v.link_faces}:
                f.material_index = 3
            rim = bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=r * 0.62, radius2=r * 0.62, depth=0.02)
            bmesh.ops.rotate(bm, verts=rim['verts'], cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2, 3, 'X'))
            bmesh.ops.translate(bm, verts=rim['verts'], vec=(ax, y + s * (width / 2 + 0.005), r))
            for f in {f for v in rim['verts'] for f in v.link_faces}:
                f.material_index = 4


def box(bm, x0, x1, y0, y1, z0, z1, slot, bevel=0.0):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=r['verts'])
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=r['verts'])
    fs = list({f for v in r['verts'] for f in v.link_faces})
    for f in fs:
        f.material_index = slot
    if bevel:
        es = list({e for v in r['verts'] for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=es, offset=bevel, segments=2, affect='EDGES', profile=0.5)
    return r


def finish(me, M, paint, axles, track, wr, extra=None):
    if len(me.materials) < len(SLOTS):
        for _ in range(len(SLOTS) - len(me.materials)):
            me.materials.append(None)
    # one Catmull-Clark level on the body: smooth panels and rounded edges instead of facets
    tmp = bpy.data.objects.new("_tmp_subd", me); bpy.context.scene.collection.objects.link(tmp)
    sd = tmp.modifiers.new("s", 'SUBSURF'); sd.levels = 1; sd.boundary_smooth = 'PRESERVE_CORNERS'
    dg = bpy.context.evaluated_depsgraph_get(); sm = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp); nm = me.name; bpy.data.meshes.remove(me); me = sm; me.name = nm
    bm = bmesh.new(); bm.from_mesh(me)
    add_wheels(bm, axles, track, wr)
    if extra:
        extra(bm)
    bm.to_mesh(me); bm.free()
    for k, s in enumerate(SLOTS):
        me.materials[k] = M[paint] if s == "paint" else M[s]
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    me.update()
    return me


# ------------------------------------------------------------------ vehicle types (metres, front = +X)
def sedan(M, paint, name):
    L, W = 4.55, 1.76
    top = [(0, 0.66), (0.04, 0.80), (0.28, 0.93), (0.31, 0.96), (0.46, 1.43), (0.68, 1.44), (0.84, 1.05), (0.96, 1.00), (1, 0.78)]
    belt = [(0, 0.66), (0.04, 0.80), (0.28, 0.93), (0.32, 0.95), (0.84, 0.98), (0.96, 0.97), (1, 0.78)]
    tum = [(0, 1), (0.3, 1), (0.46, 0.80), (0.68, 0.80), (0.84, 0.95), (1, 1)]
    ax = [L / 2 - 0.88, L / 2 - 0.88 - 2.62]
    me = loft(name, L, W, top, belt, tum, ax, 0.31, glass_t=(0.31, 0.845), bpillars=(0.565,))
    return finish(me, M, paint, ax, W - 0.24, 0.31)


def hatch(M, paint, name):
    L, W = 3.85, 1.70
    top = [(0, 0.68), (0.05, 0.82), (0.24, 0.95), (0.27, 0.98), (0.45, 1.50), (0.86, 1.48), (0.97, 1.05), (1, 0.82)]
    belt = [(0, 0.68), (0.05, 0.82), (0.24, 0.95), (0.28, 0.97), (0.9, 1.02), (1, 0.82)]
    tum = [(0, 1), (0.26, 1), (0.45, 0.80), (0.86, 0.82), (1, 0.95)]
    ax = [L / 2 - 0.75, L / 2 - 0.75 - 2.45]
    me = loft(name, L, W, top, belt, tum, ax, 0.30, glass_t=(0.27, 0.95), bpillars=(0.6,))
    return finish(me, M, paint, ax, W - 0.24, 0.30)


def mpv(M, paint, name):
    L, W = 4.40, 1.73
    top = [(0, 0.72), (0.05, 0.86), (0.2, 1.0), (0.23, 1.04), (0.40, 1.68), (0.95, 1.66), (0.99, 1.2), (1, 0.85)]
    belt = [(0, 0.72), (0.05, 0.86), (0.2, 1.0), (0.24, 1.03), (0.95, 1.08), (1, 0.85)]
    tum = [(0, 1), (0.22, 1), (0.40, 0.84), (0.95, 0.86), (1, 0.95)]
    ax = [L / 2 - 0.85, L / 2 - 0.85 - 2.66]
    me = loft(name, L, W, top, belt, tum, ax, 0.32, glass_t=(0.23, 0.985), bpillars=(0.5, 0.75))
    return finish(me, M, paint, ax, W - 0.24, 0.32)


def suv(M, paint, name):
    L, W = 4.75, 1.86
    top = [(0, 0.86), (0.05, 1.0), (0.24, 1.10), (0.27, 1.14), (0.40, 1.80), (0.96, 1.78), (0.99, 1.3), (1, 0.95)]
    belt = [(0, 0.86), (0.05, 1.0), (0.24, 1.10), (0.28, 1.13), (0.96, 1.18), (1, 0.95)]
    tum = [(0, 1), (0.26, 1), (0.40, 0.86), (0.96, 0.88), (1, 0.97)]
    ax = [L / 2 - 0.92, L / 2 - 0.92 - 2.78]
    me = loft(name, L, W, top, belt, tum, ax, 0.38, z_floor=0.40, glass_t=(0.27, 0.975), bpillars=(0.55, 0.8))
    return finish(me, M, paint, ax, W - 0.26, 0.38)


def pickup(M, paint, name):
    L, W = 5.10, 1.80
    top = [(0, 0.80), (0.05, 0.95), (0.22, 1.06), (0.25, 1.10), (0.36, 1.78), (0.55, 1.78), (0.56, 1.10), (1, 1.08)]
    belt = [(0, 0.80), (0.05, 0.95), (0.22, 1.06), (0.26, 1.09), (1, 1.08)]
    tum = [(0, 1), (0.24, 1), (0.36, 0.86), (0.55, 0.86), (0.57, 1), (1, 1)]
    ax = [L / 2 - 0.95, L / 2 - 0.95 - 3.08]
    me = loft(name, L, W, top, belt, tum, ax, 0.36, z_floor=0.42, glass_t=(0.25, 0.555), bpillars=(0.45,))
    def bed(bm):  # dark bed floor recessed between the side walls
        box(bm, -L / 2 + 0.12, L / 2 - 0.56 * L, -W / 2 + 0.1, W / 2 - 0.1, 1.04, 1.10, 2)
    return finish(me, M, paint, ax, W - 0.24, 0.36, bed)


def bus(M, paint, name, L=11.0):
    W, H = 2.48, 3.15
    top = [(0, 1.0), (0.01, 2.6), (0.03, H), (0.98, H), (1, 1.2)]
    belt = [(0, 1.0), (0.01, 1.1), (0.03, 1.2), (0.98, 1.2), (1, 1.1)]
    tum = [(0, 1), (0.03, 0.95), (0.98, 0.95), (1, 1)]
    ax = [L / 2 - 2.3, -L / 2 + 2.9]
    pil = tuple(0.1 + k * 0.105 for k in range(9))
    me = loft(name, L, W, top, belt, tum, ax, 0.50, z_floor=0.55, glass_t=(0.005, 0.985), bpillars=pil, K=56)
    return finish(me, M, paint, ax, W - 0.30, 0.50)


def truck(M, paint, name):
    L, W = 6.8, 2.2
    cab = 0.27
    top = [(0, 1.1), (0.01, 2.2), (0.04, 2.6), (cab, 2.6), (cab + 0.005, 1.15), (1, 1.15)]
    belt = [(0, 1.1), (0.01, 1.25), (0.04, 1.4), (cab, 1.4), (cab + 0.005, 1.15), (1, 1.15)]
    tum = [(0, 1), (0.04, 0.95), (cab, 0.95), (cab + 0.01, 1), (1, 1)]
    ax = [L / 2 - 1.2, -L / 2 + 1.6]
    me = loft(name, L, W, top, belt, tum, ax, 0.50, z_floor=0.6, glass_t=(0.008, cab - 0.06), bpillars=(), K=44)
    def cargo(bm):
        box(bm, -L / 2 + 0.05, L / 2 - cab * L - 0.15, -W / 2 + 0.02, W / 2 - 0.02, 1.15, 3.35, 7, bevel=0.04)
    return finish(me, M, paint, ax, W - 0.32, 0.50, cargo)


def motorbike(M, paint, name):
    bm = bmesh.new()
    me = bpy.data.meshes.new(name)
    for _ in SLOTS:
        me.materials.append(None)
    add_wheels(bm, [0.68, -0.62], 0.0, 0.30, width=0.1)
    # frame / tank / body / seat / rider
    def ell(cx, cz, rx, ry, rz, slot, cy=0.0):
        r = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        bmesh.ops.scale(bm, vec=(rx, ry, rz), verts=r['verts']); bmesh.ops.translate(bm, vec=(cx, cy, cz), verts=r['verts'])
        for f in {f for v in r['verts'] for f in v.link_faces}:
            f.material_index = slot
    ell(0.15, 0.55, 0.55, 0.16, 0.18, 0)      # body / scooter panels
    ell(0.55, 0.82, 0.18, 0.2, 0.2, 0)        # front fairing
    ell(-0.15, 0.80, 0.38, 0.15, 0.07, 7)     # seat (cargo slot = dark grey here)
    ell(-0.12, 1.25, 0.16, 0.2, 0.3, 2)       # rider torso
    ell(-0.05, 1.68, 0.12, 0.12, 0.13, 0)     # helmet (paint)
    box(bm, 0.5, 0.56, -0.32, 0.32, 1.02, 1.05, 2)  # handlebar
    bm.to_mesh(me); bm.free()
    for k, s in enumerate(SLOTS):
        me.materials[k] = M[paint] if s == "paint" else (M["seat"] if s == "cargo" else M[s])
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    return me


BUILDERS = {"sedan": sedan, "hatch": hatch, "mpv": mpv, "suv": suv, "pickup": pickup, "bus": bus, "truck": truck, "motor": motorbike}


def burnt(me):
    """Burnt wreck: every surface charred, glass gone dark, a little rust."""
    b = me.copy(); b.name = me.name + "_burnt"
    M = materials()
    for k, s in enumerate(SLOTS):
        b.materials[k] = M["rust"] if s == "rim" else M["burnt"]
    return b
