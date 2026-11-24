# DroneLab3D: water surfaces with depth colour, and distant backdrop land so a map has no visible edge.
# Run inside Blender:  wb = {}; exec(open(r"D:\...\scripts\blender\water_backdrop.py").read(), wb)
# Colours live in vertex colours (exported as glTF COLOR_0, multiplied with the base colour in three.js),
# so a whole sea or lake is one cheap mesh. Water gets a tiled ripple normal map (KHR_texture_transform).
# Backdrop meshes are named "backdrop_*": the exporter skips them for ground and colliders.
import bpy, bmesh, numpy as np, os, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def ground_bvh(names):
    dg = bpy.context.evaluated_depsgraph_get(); verts, polys, off = [], [], 0
    for n in names:
        o = bpy.data.objects[n]; ev = o.evaluated_get(dg); me = ev.to_mesh(); mw = o.matrix_world
        verts += [tuple(mw @ v.co) for v in me.vertices]
        polys += [tuple(i + off for i in p.vertices) for p in me.polygons]
        off += len(me.vertices); ev.to_mesh_clear()
    bvh = BVHTree.FromPolygons(verts, polys)

    def gz(x, y, default=None):
        h = bvh.ray_cast(Vector((x, y, 5000)), Vector((0, 0, -1)))
        return h[0].z if h[0] else default
    return gz


def water_normal_png(path, size=512, seed=1, waves=26, strength=1.0):
    """Tileable ripple normal map: a sum of sine waves with integer frequencies."""
    rng = np.random.default_rng(seed)
    u = np.arange(size) / size; U, V = np.meshgrid(u, u)
    dx = np.zeros((size, size)); dy = np.zeros((size, size))
    for _ in range(waves):
        kx, ky = rng.integers(-9, 10, 2)
        if kx == 0 and ky == 0:
            continue
        a = 1.0 / math.hypot(kx, ky) ** 1.2; ph = rng.random() * 6.283
        c = np.cos(6.283 * (kx * U + ky * V) + ph) * a * 6.283
        dx += c * kx; dy += c * ky
    s = strength / max(np.abs(dx).max(), np.abs(dy).max())
    n = np.stack([-dx * s, -dy * s, np.ones_like(dx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    px = np.concatenate([n * 0.5 + 0.5, np.ones((size, size, 1))], -1).astype(np.float32)
    name = os.path.splitext(os.path.basename(path))[0]
    img = bpy.data.images.get(name) or bpy.data.images.new(name, size, size, alpha=False)
    img.pixels.foreach_set(px.ravel()); img.filepath_raw = path; img.file_format = 'PNG'
    os.makedirs(os.path.dirname(path), exist_ok=True); img.save(); img.reload()
    img.colorspace_settings.name = 'Non-Color'
    return img


def vcol_material(name, roughness=0.9, normal_img=None, normal_rep=1.0, normal_strength=0.5, alpha=False, metallic=0.0, uv='UVMap'):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); o.location = (500, 0)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); b.location = (200, 0)
    b.inputs['Roughness'].default_value = roughness; b.inputs['Metallic'].default_value = metallic
    nt.links.new(b.outputs[0], o.inputs[0])
    ca = nt.nodes.new('ShaderNodeVertexColor'); ca.location = (-200, 200); ca.layer_name = 'Col'
    nt.links.new(ca.outputs['Color'], b.inputs['Base Color'])
    if alpha:
        nt.links.new(ca.outputs['Alpha'], b.inputs['Alpha'])
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED'
        else:
            m.blend_method = 'BLEND'
    if normal_img is not None:
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = uv; uvn.location = (-800, -200)
        mp = nt.nodes.new('ShaderNodeMapping'); mp.location = (-600, -200); mp.inputs['Scale'].default_value = (normal_rep, normal_rep, 1)
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = normal_img; tn.location = (-300, -200)
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (0, -200); nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(uvn.outputs['UV'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], tn.inputs['Vector'])
        nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


def _link(ob, coll):
    c = bpy.data.collections.get(coll)
    if c is None:
        c = bpy.data.collections.new(coll); bpy.context.scene.collection.children.link(c)
    c.objects.link(ob)


def grid_mesh(name, x0, x1, y0, y1, cell, zfn, colfn, keep=None, coll="99_backdrop", uv_scale=None, material=None):
    """Regular grid over [x0,x1]x[y0,y1]. zfn(X, Y) -> Z arrays, colfn(X, Y, Z) -> (N,4) colours,
    keep(cx, cy, zc) -> bool array per face (default all). UV = metres / uv_scale (or 0..1 if None)."""
    nx = int(round((x1 - x0) / cell)) + 1; ny = int(round((y1 - y0) / cell)) + 1
    xs = np.linspace(x0, x1, nx); ys = np.linspace(y0, y1, ny)
    X, Y = np.meshgrid(xs, ys); Z = zfn(X, Y)
    C = colfn(X, Y, Z)
    vid = np.arange(nx * ny).reshape(ny, nx)
    a = vid[:-1, :-1].ravel(); b = vid[:-1, 1:].ravel(); c = vid[1:, 1:].ravel(); d = vid[1:, :-1].ravel()
    faces = np.stack([a, b, c, d], 1)
    if keep is not None:
        cx = (X[:-1, :-1] + X[1:, 1:]).ravel() / 2; cy = (Y[:-1, :-1] + Y[1:, 1:]).ravel() / 2
        zc = (Z[:-1, :-1] + Z[1:, 1:] + Z[:-1, 1:] + Z[1:, :-1]).ravel() / 4
        faces = faces[keep(cx, cy, zc)]
    used = np.unique(faces); remap = -np.ones(nx * ny, np.int64); remap[used] = np.arange(len(used))
    verts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)[used]; faces = remap[faces]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    me.validate()
    loops = np.empty(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', loops)
    col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    col.data.foreach_set('color', np.asarray(C).reshape(-1, 4)[used][loops].astype(np.float32).ravel())
    uvl = me.uv_layers.new(name='UVMap')
    V = verts[loops]
    if uv_scale:
        uvs = V[:, :2] / uv_scale
    else:
        uvs = np.stack([(V[:, 0] - x0) / (x1 - x0), (V[:, 1] - y0) / (y1 - y0)], 1)
    uvl.data.foreach_set('uv', uvs.astype(np.float32).ravel())
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.get(name)
    if ob:
        old = ob.data; ob.data = me; bpy.data.meshes.remove(old)
    else:
        ob = bpy.data.objects.new(name, me); _link(ob, coll)
    if material:
        me.materials.append(material)
    return ob


def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def mix(c0, c1, t):
    c0 = np.asarray(c0, np.float32); c1 = np.asarray(c1, np.float32)
    return c0 + (c1 - c0) * np.asarray(t)[..., None]


def srgb(*c):
    """sRGB 0..255 -> linear (vertex colours are stored linear)."""
    return tuple(((v / 255.0 + 0.055) / 1.055) ** 2.4 if v / 255.0 > 0.04045 else v / 255.0 / 12.92 for v in c)


def fbm(X, Y, scale, octaves=4, seed=0):
    from mathutils import noise
    out = np.empty(X.shape)
    fx = X.ravel() / scale; fy = Y.ravel() / scale; r = out.ravel()
    for k in range(len(fx)):
        r[k] = noise.fractal(Vector((fx[k] + seed * 13.7, fy[k] - seed * 7.1, 0.5)), 0.6, 2.0, octaves, noise_basis='PERLIN_ORIGINAL')
    return r.reshape(X.shape)


def ridged(X, Y, scale, octaves=4, seed=0):
    from mathutils import noise
    out = np.empty(X.shape)
    fx = X.ravel() / scale; fy = Y.ravel() / scale; r = out.ravel()
    for k in range(len(fx)):
        r[k] = noise.ridged_multi_fractal(Vector((fx[k] + seed * 13.7, fy[k] - seed * 7.1, 0.5)), 0.9, 2.1, octaves, 1.0, 2.0,
                                          noise_basis='PERLIN_ORIGINAL')
    return r.reshape(X.shape)
