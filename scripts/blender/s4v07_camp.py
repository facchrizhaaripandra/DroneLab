# S4 v07: camp on the lake meadow (tents, hut, fire pit, jetty, helipad), the trail mesh with a dirt texture,
# a wooden footbridge where the trail crosses water, scattered Poly Haven rocks, and a mountain backdrop.
import bpy, bmesh, numpy as np, math, random, os
from mathutils import Vector, Matrix

V06 = r"C:\Users\darip\Documents\DroneLab3D\S4_gunung_danau\gunung_danau_v06.blend"
ROOT = r"C:\Users\darip\Documents\DroneLab3D\S4_gunung_danau\assets_polyhaven"


def sampler(H, ext=600.0, cell=5.0):
    n = H.shape[0]

    def th(X, Y):
        X = np.asarray(X, float); Y = np.asarray(Y, float)
        fx = np.clip((X + ext) / cell, 0, n - 1.0001); fy = np.clip((Y + ext) / cell, 0, n - 1.0001)
        i0 = fx.astype(int); j0 = fy.astype(int); tx = fx - i0; ty = fy - j0
        return (H[j0, i0] * (1 - tx) + H[j0, i0 + 1] * tx) * (1 - ty) + (H[j0 + 1, i0] * (1 - tx) + H[j0 + 1, i0 + 1] * tx) * ty
    return th


def append_from_v06(names, coll):
    with bpy.data.libraries.load(V06) as (src, dst):
        dst.objects = [n for n in src.objects if n in names]
    C = bpy.data.collections[coll]; out = {}
    for o in dst.objects:
        if o is None:
            continue
        old = bpy.data.objects.get(o.name.split('.')[0] + "_v07")
        if old:
            bpy.data.objects.remove(old)
        o.name = o.name.split('.')[0] + "_v07"
        C.objects.link(o); out[o.name] = o
    return out


def seat(ob, th, x, y, rot=0.0, lift=0.0):
    """Move an object so its lowest point sits on the ground at (x, y)."""
    mw = ob.matrix_world.copy()
    bb = [mw @ Vector(c) for c in ob.bound_box]
    cx = sum(p.x for p in bb) / 8; cy = sum(p.y for p in bb) / 8; zmin = min(p.z for p in bb)
    ob.location.x += x - cx; ob.location.y += y - cy
    ob.rotation_euler.z += rot
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    gz = max(float(th(np.array([p.x]), np.array([p.y]))[0]) for p in bb)
    ob.location.z += gz - min(p.z for p in bb) + lift - 0.05


def flatten(H, x, y, r, z, blend=8.0, cell=5.0, ext=600.0):
    n = H.shape[0]; xs = np.linspace(-ext, ext, n); X, Y = np.meshgrid(xs, xs)
    d = np.hypot(X - x, Y - y); t = np.clip((d - r) / blend, 0, 1); w = 1 - t * t * (3 - 2 * t)
    return H * (1 - w) + z * w


def trail_mesh(P, th, width=1.8, name="trail_hiking_path", coll="04_camp_trail"):
    T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9; N = np.stack([-T[:, 1], T[:, 0]], 1)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    verts, uvs, faces = [], [], []
    for k in range(len(P)):
        for j, o in enumerate((-0.5, 0.5)):
            q = P[k] + N[k] * o * width
            verts.append((q[0], q[1], float(th(np.array([q[0]]), np.array([q[1]]))[0]) + 0.08)); uvs.append((o + 0.5, arc[k] / 3.0))
    for k in range(len(P) - 1):
        faces.append((2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2))
    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name); me.clear_geometry(); me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for lp in me.loops:
        uvl.data[lp.index].uv = uvs[lp.vertex_index]
    m = bpy.data.materials.get("mat_trail_dirt") or bpy.data.materials.new("mat_trail_dirt")
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled'); t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images["ph_rocky_trail_diff"]; nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(b.outputs[0], o.inputs[0])
    b.inputs['Roughness'].default_value = 0.95
    if not me.materials:
        me.materials.append(m)
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    if not ob.users_collection:
        bpy.data.collections[coll].objects.link(ob)
    return ob, arc[-1]


def helipad(th, x, y, coll="04_camp_trail"):
    """Concrete pad with an orange H: the drone starts here (named ground_ so the exporter treats it as ground)."""
    z = float(th(np.array([x]), np.array([y]))[0]) + 0.15
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=32, radius=4.2)
    me = bpy.data.meshes.get("ground_helipad_camp") or bpy.data.meshes.new("ground_helipad_camp"); bm.to_mesh(me); bm.free()
    m = bpy.data.materials.get("mat_helipad_concrete") or bpy.data.materials.new("mat_helipad_concrete")
    m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.55, 0.52, 1)
    me.materials.clear(); me.materials.append(m)
    ob = bpy.data.objects.get("ground_helipad_camp") or bpy.data.objects.new("ground_helipad_camp", me)
    if not ob.users_collection:
        bpy.data.collections[coll].objects.link(ob)
    ob.location = (x, y, z)
    # the H: three thin boxes
    hm = bpy.data.materials.get("mat_helipad_orange") or bpy.data.materials.new("mat_helipad_orange")
    hm.use_nodes = True; hm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1.0, 0.25, 0.02, 1)
    bm = bmesh.new()
    for (cx, cy, sx, sy) in ((-1.1, 0, 0.35, 2.6), (1.1, 0, 0.35, 2.6), (0, 0, 1.9, 0.35)):
        r = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sy, 0.02), verts=r['verts']); bmesh.ops.translate(bm, vec=(cx, cy, 0.01), verts=r['verts'])
    me2 = bpy.data.meshes.get("helipad_marking_h") or bpy.data.meshes.new("helipad_marking_h"); bm.to_mesh(me2); bm.free()
    me2.materials.clear(); me2.materials.append(hm)
    o2 = bpy.data.objects.get("helipad_marking_h") or bpy.data.objects.new("helipad_marking_h", me2)
    if not o2.users_collection:
        bpy.data.collections[coll].objects.link(o2)
    o2.location = (x, y, z + 0.005)
    return z


def import_rocks():
    out = []
    for a in ("rock_moss_set_01", "rock_07"):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, a, a + ".gltf"))
        new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        for o in new:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            out.append(o.data)
        for o in [o for o in bpy.data.objects if o not in before]:
            bpy.data.objects.remove(o)
    return out


def scatter_rocks(meshes, H, A, th, river, trail, camp, n=900, seed=4, coll="05_rocks"):
    rr = random.Random(seed); C = bpy.data.collections[coll]
    for o in [o for o in C.objects if o.name.startswith("rock_")]:
        bpy.data.objects.remove(o)
    gy, gx = np.gradient(H, 5.0); slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    k = 0; tries = 0
    while k < n and tries < 40000:
        tries += 1
        x, y = rr.uniform(-590, 590), rr.uniform(-590, 590)
        i, j = int((x + 600) / 5), int((y + 600) / 5)
        h = H[j, i]; sl = slope[j, i]; la = math.log(A[j, i])
        p = 0.04 + 0.5 * (sl > 28) + 0.5 * (h > 330) + 0.6 * (la > 11)          # cliffs, scree, stream beds
        if h < 30.5 or rr.random() > p or math.hypot(x - camp[0], y - camp[1]) < 60:
            continue
        me = meshes[k % len(meshes)]
        ob = bpy.data.objects.new("rock_%04d" % k, me); C.objects.link(ob)
        big = rr.random() < 0.15
        s = rr.uniform(4, 9) if big else rr.uniform(1.2, 3.5)
        ob.scale = (s, s, s * rr.uniform(0.6, 1.0)); ob.rotation_euler = (rr.uniform(-.3, .3), rr.uniform(-.3, .3), rr.uniform(0, 6.28))
        ob.location = (x, y, float(th(np.array([x]), np.array([y]))[0]) - 0.25 * s)
        k += 1
    return k


def backdrop(wb, th, coll="99_backdrop"):
    ss, mix, srgb = wb["ss"], wb["mix"], wb["srgb"]
    def z(X, Y):
        dx = np.maximum(np.abs(X) - 600, 0); dy = np.maximum(np.abs(Y) - 600, 0); d = np.hypot(dx, dy)
        edge = th(np.clip(X, -600, 600), np.clip(Y, -600, 600))
        far = 120 + 520 * (wb["ridged"](X, Y, 1000, 4, seed=12) / 2.2) ** 1.5 + 60 * wb["fbm"](X, Y, 300, 3, seed=13)
        far *= 0.5 + 0.5 * ss(d, 300, 1400)
        out = edge + (far - edge) * ss(d, 0, 650)
        inside = (np.abs(X) < 600) & (np.abs(Y) < 600)
        return np.where(inside, th(X, Y) - 2.0, out)
    fa, fb, rock, high = (np.array(srgb(*c)) for c in ((44, 62, 36), (68, 82, 46), (102, 96, 86), (150, 146, 136)))
    def col(X, Y, Z):
        n = wb["fbm"](X, Y, 150, 3, seed=14) * 0.5 + 0.5; c = mix(fa, fb, np.clip(n, 0, 1))
        gy, gx = np.gradient(Z, 30.0); sl = np.hypot(gx, gy)
        c = mix(c, rock, np.clip(ss(sl, 0.55, 0.95) + ss(Z, 360, 500), 0, 1)); c = mix(c, high, ss(Z, 520, 640))
        return np.concatenate([c, np.ones(c.shape[:-1] + (1,), np.float32)], -1)
    mat = wb["vcol_material"]("mat_backdrop_land", roughness=1.0)
    return wb["grid_mesh"]("backdrop_mountains", -2700, 2700, -2700, 2700, 30.0, z, col,
                           keep=lambda cx, cy, zc: (np.abs(cx) > 585) | (np.abs(cy) > 585), coll=coll, material=mat)
