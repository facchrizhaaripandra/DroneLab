# DroneLab3D: swap the old low-poly trees and cars of a scene for the realistic library models
# (A2_aset_realistis/aset_v01.blend). Trees keep their place, height and base; cars are found inside the old merged
# car objects (one cluster of loose parts per vehicle), replaced by a matching type, and the old object is hidden.
import bpy, numpy as np, math, random, zlib
from mathutils import Vector, Matrix

LIB = r"C:\Users\darip\Documents\DroneLab3D\A2_aset_realistis\aset_v01.blend"


def append_library():
    with bpy.data.libraries.load(LIB) as (src, dst):
        dst.meshes = [n for n in src.meshes if n.startswith(("tree_", "shrub_", "bamboo_", "car_"))]
    return {m.name: m for m in dst.meshes if m}


def lib_groups(meshes, at):
    G = {}
    pre = {"tropical": "tree_tropical_", "tall": "tree_forest_tall_", "street": "tree_street_", "dry": "tree_dry_",
           "frangipani": "tree_frangipani_", "scorched": "tree_dead_scorched_", "dead": "tree_dead_bare_",
           "palm": "tree_coconut_palm_", "shrub": "shrub_shrub_", "charred": "shrub_charred_", "bamboo": "bamboo_clump_"}
    for g, p in pre.items():
        G[g] = sorted([m for n, m in meshes.items() if n.startswith(p)], key=lambda m: m.name)
    G["hedge"] = [meshes[n] for n in meshes if n.startswith("shrub_shrub_28")] or G["shrub"]
    G["shrub"] = [m for m in G["shrub"] if not m.name.startswith("shrub_shrub_28")]
    return G


def _bbox(o):
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb), max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb))


def swap_trees(G, group_for):
    done = {}
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or not o.visible_get():
            continue
        g = group_for(o.name)
        if not g or not G.get(g):
            continue
        x0, y0, z0, x1, y1, z1 = _bbox(o)
        h = z1 - z0; w = max(x1 - x0, y1 - y0)
        if h < 0.3:
            continue
        rnd = random.Random(zlib.crc32(o.name.encode()))
        me = G[g][rnd.randrange(len(G[g]))]
        mz = max(0.1, me_dims(me)[2]); mw = max(0.1, max(me_dims(me)[:2]))
        s = h / mz
        sx = s if g not in ("shrub", "charred", "hedge") else min(3.0, max(0.4, w / mw))
        # base: centre of the old footprint, lowest point of the old object (trunk foot)
        o.data = me
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        o.location = ((x0 + x1) / 2, (y0 + y1) / 2, z0)
        o.rotation_euler = (0, 0, rnd.random() * 6.283)
        o.scale = (sx, sx, s)
        if g == "hedge":   # a hedge row keeps its long footprint
            o.rotation_euler = (0, 0, 0); o.scale = ((x1 - x0) / mw, (y1 - y0) / mw, s)
        done[g] = done.get(g, 0) + 1
    return done


_dims = {}
def me_dims(me):
    if me.name not in _dims:
        co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        _dims[me.name] = (np.ptp(co[:, 0]), np.ptp(co[:, 1]), np.ptp(co[:, 2]), co[:, 0].min(), co[:, 0].max())
    return _dims[me.name]


# ------------------------------------------------------------------ cars
def car_clusters(o):
    """World-space vertex groups, one per vehicle: loose parts merged when their footprints overlap."""
    dg = bpy.context.evaluated_depsgraph_get(); ev = o.evaluated_get(dg); me = ev.to_mesh()
    n = len(me.vertices); co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    mw = np.array(o.matrix_world); co = (mw[:3, :3] @ co.T).T + mw[:3, 3]
    ed = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get('vertices', ed); ed = ed.reshape(-1, 2)
    ev.to_mesh_clear()
    parent = np.arange(n)
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for a, b in ed:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(n)])
    isl = {}
    for i, r in enumerate(roots):
        isl.setdefault(r, []).append(i)
    boxes = []
    for idx in isl.values():
        p = co[idx]; boxes.append([p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max(), idx])
    # merge overlapping footprints (body + wheels + glass + lights of one car)
    merged = True
    while merged:
        merged = False; out = []
        for b in boxes:
            for m in out:
                if b[0] <= m[2] + 0.05 and b[2] >= m[0] - 0.05 and b[1] <= m[3] + 0.05 and b[3] >= m[1] - 0.05:
                    m[0] = min(m[0], b[0]); m[1] = min(m[1], b[1]); m[2] = max(m[2], b[2]); m[3] = max(m[3], b[3]); m[4] = m[4] + b[4]
                    merged = True; break
            else:
                out.append(b)
        boxes = out
    res = []
    for b in boxes:
        p = co[b[4]]
        c = p[:, :2].mean(0); q = p[:, :2] - c
        ev_, evec = np.linalg.eigh(q.T @ q)
        ax = evec[:, 1]; yaw = math.atan2(ax[1], ax[0])
        proj = q @ ax; side = q @ evec[:, 0]
        L = float(np.ptp(proj)); W = float(np.ptp(side)); H = float(np.ptp(p[:, 2]))
        if L < 1.2 or H < 0.6:
            continue
        cc = c + ax * (proj.max() + proj.min()) / 2 + evec[:, 0] * (side.max() + side.min()) / 2
        res.append(dict(x=float(cc[0]), y=float(cc[1]), z=float(p[:, 2].min()), yaw=yaw, L=float(L), W=float(W), H=float(H)))
    return res


def car_type(L, H):
    if L < 2.6:
        return "motor"
    if L > 8.0:
        return "bus"
    if L > 5.6:
        return "truck"
    if L > 4.9:
        return "pickup" if H < 1.75 else "suv"
    if L > 4.4:
        return "sedan" if H < 1.5 else ("suv" if H > 1.7 else "mpv")
    return "hatch" if H < 1.55 else "mpv"


PAINT_MIX = ["white", "white", "white", "silver", "silver", "black", "grey", "red", "blue"]


def swap_cars(meshes, names, burnt_names=(), coll_name="cars_realistic", seed=1):
    C = bpy.data.collections.get(coll_name) or bpy.data.collections.new(coll_name)
    if C.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(C)
    for o in list(C.objects):
        bpy.data.objects.remove(o)
    rnd = random.Random(seed); count = {}
    for n in names:
        o = bpy.data.objects.get(n)
        if not o:
            continue
        burnt = n in burnt_names
        for k, cdat in enumerate(car_clusters(o)):
            t = car_type(cdat["L"], cdat["H"])
            if t == "bus":
                paint = rnd.choice(["green", "orange", "blue", "white"])
            elif t == "truck":
                paint = rnd.choice(["white", "yellow", "blue"])
            elif t == "motor":
                paint = rnd.choice(["black", "red", "blue", "white"])
            else:
                paint = rnd.choice(PAINT_MIX + (["taxi"] if t == "sedan" else []))
            key = "car_%s_%s" % (t, paint)
            me = meshes.get(key) or next((m for nm, m in meshes.items() if nm.startswith("car_%s_" % t)), None)
            if me is None:
                continue
            if burnt:
                bn = me.name + "_burnt"
                if bn not in meshes:
                    b = me.copy(); b.name = bn
                    bm = bpy.data.materials.get("mat_car_burnt") or bpy.data.materials.new("mat_car_burnt")
                    bm.use_nodes = True; bm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.035, 0.03, 0.028, 1)
                    bm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
                    for i in range(len(b.materials)):
                        b.materials[i] = bm
                    meshes[bn] = b
                me = meshes[bn]
            d = me_dims(me)
            s = min(1.15, max(0.85, cdat["L"] / max(0.5, d[0])))
            ob = bpy.data.objects.new("vehicle_%s_%03d" % (t, len(C.objects)), me)
            C.objects.link(ob)
            ob.location = (cdat["x"], cdat["y"], cdat["z"]); ob.rotation_euler = (0, 0, cdat["yaw"] + (math.pi if rnd.random() < 0.5 else 0))
            ob.scale = (s, s, s)
            count[t] = count.get(t, 0) + 1
        o.hide_set(True); o.hide_viewport = True; o.hide_render = True   # kept (not deleted), just not shown or exported
    return count
