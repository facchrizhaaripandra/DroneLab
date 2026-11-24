# DroneLab3D: adapter bld_geom.Geo -> objek Blender, dan bantu kecil untuk skrip peningkatan peta.
# Dipakai di Blender:  exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\bld_lib.py").read())
import bpy, sys, os
from mathutils import Vector

HERE = r"D:\DroneLabClaude\dronelab\scripts\blender"
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import importlib, bld_geom
importlib.reload(bld_geom)
Geo = bld_geom.Geo


def material(name, color=(0.7, 0.7, 0.7, 1.0), rough=0.8, metal=0.0, alpha=1.0):
    """Material yang sudah ada di file dipakai apa adanya (bertekstur); kalau belum ada, dibuat Principled polos."""
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = 'BLEND'
    return m


def to_object(geo, name, coll, colors=None, min_part=0.3):
    """Geo -> objek mesh baru (nama unik, menggantikan objek lama bernama sama)."""
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new(name)
    me.from_pydata(geo.v, [], geo.f)
    names = []
    for mn in geo.fm:
        if mn not in names: names.append(mn)
    for mn in names:
        me.materials.append(material(mn, *(colors or {}).get(mn, ())))
    idx = {mn: i for i, mn in enumerate(names)}
    for p, mn in zip(me.polygons, geo.fm):
        p.material_index = idx[mn]
    uvl = me.uv_layers.new(name="UVMap")
    li = 0
    for p, uvs in zip(me.polygons, geo.uv):
        for k in range(p.loop_total):
            uvl.data[p.loop_start + k].uv = uvs[k]
    me.validate(); me.update()
    ob = bpy.data.objects.new(name, me)
    ob["dl_min_part"] = min_part   # export_scene.py: bagian lebih tipis dari ini (rangka, teralis, tiang) bukan collider
    coll.objects.link(ob)
    return ob


def world_bbox(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return (min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts),
            max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))


def loose_boxes(ob, weld=0.01):
    """Kotak dunia per bagian lepas sebuah mesh (unit-unit ruko dalam satu objek dinding). Titik yang berimpit
    (dalam `weld` m) dianggap satu, jadi kotak yang tersusun dari bidang-bidang terpisah tetap satu bagian."""
    me = ob.data; mw = ob.matrix_world
    pts = [mw @ v.co for v in me.vertices]
    key, rep = {}, []
    for p in pts:
        k = (round(p.x / weld), round(p.y / weld), round(p.z / weld))
        rep.append(key.setdefault(k, len(key)))
    parent = list(range(len(key)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for e in me.edges:
        a, b = find(rep[e.vertices[0]]), find(rep[e.vertices[1]])
        if a != b: parent[a] = b
    groups = {}
    for i, p in enumerate(pts):
        r = find(rep[i])
        g = groups.setdefault(r, [1e9, 1e9, 1e9, -1e9, -1e9, -1e9])
        g[0] = min(g[0], p.x); g[1] = min(g[1], p.y); g[2] = min(g[2], p.z)
        g[3] = max(g[3], p.x); g[4] = max(g[4], p.y); g[5] = max(g[5], p.z)
    return list(groups.values())


def remove(names):
    n = 0
    for nm in names:
        ob = bpy.data.objects.get(nm)
        if ob: bpy.data.objects.remove(ob, do_unlink=True); n += 1
    return n


def coll_of(name, fallback="Collection"):
    ob = bpy.data.objects.get(name)
    if ob and ob.users_collection: return ob.users_collection[0]
    c = bpy.data.collections.get(fallback)
    if not c:
        c = bpy.data.collections.new(fallback); bpy.context.scene.collection.children.link(c)
    return c


def save_as(path):
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=False)
