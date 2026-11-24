# DroneLab3D: export one Blender environment scene for the web simulator.
# Run inside Blender (Scripting tab or MCP):
#   exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\export_scene.py").read())
#   process("s1_gedung_terbakar", "Gedung perkantoran terbakar", (-5.0, -31.0))
#
# Writes public/scenes/<id>/scene.glb and scene.json:
#   scene.json = spawn offset, flight bounds, ground heightfield and AABB colliders,
#   all in simulator coordinates (Three.js: Y up, Blender +Y = -Z), shifted so the spawn point is (0, 0, 0).
import bpy, os, json, time
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT_ROOT = r"D:\DroneLabClaude\dronelab\public\scenes"
# Objects whose top surface is "ground" (the drone can land on it). Everything else becomes AABB colliders.
GROUND_PREFIX = ("terrain_", "ground_", "road_", "parking_lot", "sidewalk", "helipad_concrete", "path_", "trail_",
                 "paddy_", "pool_deck", "foundation_slab")
WATER_KEYS = ("water_surface", "sea_water", "lake_water", "river_water", "canal_water", "ditch_parit_water", "stream_small_river")
# Not solid for the drone (thin, decorative or too small).
SKIP_KEYS = ("decal", "weathering", "puddle", "shard", "marking", "tape", "ash", "rice_", "cables_L", "preview",
             "fallen_branches", "roots_hanging", "grass", "fern", "debris_glass", "animals_", "power_wires", "water",
             "backdrop", "foam", "bed_decal")
# Structural meshes keep one box per connected part (so window and door openings stay open).
# Other meshes merge touching parts into one box per object cluster (a car, a desk, a lamp).
STRUCT = ("wall_", "facade_", "partitions_", "floor_slab", "roof_slab", "roof_parapet", "building_", "hotel_", "piers_",
          "columns_", "stairs_", "atrium_", "villa_", "restaurant_structure", "restaurant_terrace", "bridge_", "truss_",
          "fence_", "cable_anchor", "infinity_pool", "irrigation", "ruko_", "waterfall_rock", "rocks_layered", "gate_candi",
          "fish_pond", "guard_booth", "camp_hiker", "fire_lookout", "delivery_yard", "park_", "school_", "warehouse_",
          "hospital_", "market", "ditch", "roof_machine", "power_cables")


FLAT_MAX = 0.8     # m: parts thinner than this are slabs (floors, roofs, decks)
MERGE_MAX = 7.0     # m: merged parts (a car, a desk) never grow wider than this, so a merged box cannot cover a hole
FLAT_AREA = 12.0   # m2: only large slabs can hide a hole (atrium, courtyard, stair well)


def footprint_boxes(co, tris, mn, mx, cell=0.5):
    """A big flat part (a floor with an atrium hole, a roof with a courtyard) is a ring: one bounding box would fill the hole
    and block the drone there. Rasterize the real triangles on an XY grid and return one box per run of covered cells
    (merged vertically), so holes stay open. Returns None when the part is solid (one box is right)."""
    nx = max(1, int(np.ceil((mx[0] - mn[0]) / cell))); ny = max(1, int(np.ceil((mx[1] - mn[1]) / cell)))
    if nx * ny > 400000:
        return None
    cx = mn[0] + (np.arange(nx) + 0.5) * cell; cy = mn[1] + (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(cx, cy, indexing="ij")
    cov = np.zeros((nx, ny), bool)
    for t in tris:
        a, b, c = co[t[0]], co[t[1]], co[t[2]]
        i0 = max(0, int((min(a[0], b[0], c[0]) - mn[0]) / cell) - 1); i1 = min(nx, int((max(a[0], b[0], c[0]) - mn[0]) / cell) + 2)
        j0 = max(0, int((min(a[1], b[1], c[1]) - mn[1]) / cell) - 1); j1 = min(ny, int((max(a[1], b[1], c[1]) - mn[1]) / cell) + 2)
        if i0 >= i1 or j0 >= j1:
            continue
        px = X[i0:i1, j0:j1]; py = Y[i0:i1, j0:j1]
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9:
            continue
        l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
        l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
        t = 0.3 * cell  # distance tolerance (m): thin triangles still mark the cells they touch
        ab = np.hypot(*(b[:2] - a[:2])); bc = np.hypot(*(c[:2] - b[:2])); ca = np.hypot(*(a[:2] - c[:2]))
        ad = abs(d)
        l3 = 1 - l1 - l2
        cov[i0:i1, j0:j1] |= (l1 >= -t * bc / ad) & (l2 >= -t * ca / ad) & (l3 >= -t * ab / ad)
    if cov.mean() >= 0.93:
        return None
    return decompose(cov, mn, cell, mn[2], mx[2]) or None


def decompose(cov, mn, cell, zlo, zhi):
    """Covered cells of an XY grid -> boxes: one per run of cells, merged vertically (holes stay open)."""
    nx, ny = cov.shape
    out = []; open_runs = {}
    for i in range(nx + 1):
        runs = []
        if i < nx:
            j = 0
            while j < ny:
                if cov[i, j]:
                    k = j
                    while k < ny and cov[i, k]:
                        k += 1
                    runs.append((j, k)); j = k
                else:
                    j += 1
        nxt = {}
        for (j, k) in runs:
            nxt[(j, k)] = open_runs.pop((j, k), i)
        for (j, k), i0 in open_runs.items():
            out.append([mn[0] + i0 * cell, mn[1] + j * cell, zlo, mn[0] + i * cell, mn[1] + k * cell, zhi])
        open_runs = nxt
    return out


def union_flat_boxes(flat, cell=0.5):
    """Many small flat parts (floor tiles, rooms) of one object: merging their bounding boxes would cover the atrium or
    courtyard between them. Rasterize the boxes themselves and rebuild the footprint, so only covered cells stay solid."""
    out = []
    flat = sorted(flat, key=lambda b: b[2])
    groups = []
    for b in flat:  # cluster by height
        if groups and b[2] - groups[-1][0][2] < 0.4:
            groups[-1].append(b)
        else:
            groups.append([b])
    for g in groups:
        x0 = min(b[0] for b in g); y0 = min(b[1] for b in g); x1 = max(b[3] for b in g); y1 = max(b[4] for b in g)
        nx = max(1, int(np.ceil((x1 - x0) / cell))); ny = max(1, int(np.ceil((y1 - y0) / cell)))
        if nx * ny > 400000:
            out += g; continue
        cov = np.zeros((nx, ny), bool)
        for b in g:
            i0 = int(np.floor((b[0] - x0) / cell + 0.2)); i1 = max(i0 + 1, int(np.ceil((b[3] - x0) / cell - 0.2)))
            j0 = int(np.floor((b[1] - y0) / cell + 0.2)); j1 = max(j0 + 1, int(np.ceil((b[4] - y0) / cell - 0.2)))
            cov[i0:i1, j0:j1] = True
        out += decompose(cov, (x0, y0), cell, min(b[2] for b in g), max(b[5] for b in g))
    return out


def is_ground(n):
    return n.startswith(GROUND_PREFIX) or any(k in n for k in WATER_KEYS)


def f2(v):
    return round(float(v), 2)


def process(scene_id, title, spawn_xy, cell=2.0, max_agl=120.0, notes=""):
    t0 = time.time()
    out = os.path.join(OUT_ROOT, scene_id)
    os.makedirs(out, exist_ok=True)
    dg = bpy.context.evaluated_depsgraph_get()
    preview = lambda o: "00_environment_preview" in [c.name for c in o.users_collection]
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.visible_get() and not preview(o)]
    ground = [o for o in meshes if is_ground(o.name)]

    # ---- ground surface (raycast target) ----
    verts, polys, off = [], [], 0
    for o in ground:
        ev = o.evaluated_get(dg); me = ev.to_mesh(); mw = o.matrix_world
        verts += [tuple(mw @ v.co) for v in me.vertices]
        polys += [tuple(i + off for i in p.vertices) for p in me.polygons]
        off += len(me.vertices); ev.to_mesh_clear()
    bvh = BVHTree.FromPolygons(verts, polys)

    def gz(x, y):
        h = bvh.ray_cast(Vector((x, y, 3000)), Vector((0, 0, -1)))
        return h[0].z if h[0] else None

    sz = gz(*spawn_xy)
    sz = sz if sz is not None else 0.0
    S = (float(spawn_xy[0]), float(spawn_xy[1]), float(sz))
    to_sim = lambda x, y, z: (x - S[0], z - S[2], -(y - S[1]))
    gv = np.array(verts)
    bx0, by0 = float(gv[:, 0].min()), float(gv[:, 1].min())
    bx1, by1 = float(gv[:, 0].max()), float(gv[:, 1].max())

    # ---- heightfield (sim coords). Row j runs along +Z (= Blender -Y), column i along +X. ----
    nx = int((bx1 - bx0) / cell) + 1
    nz = int((by1 - by0) / cell) + 1
    data, miss = [], 0
    for j in range(nz):
        y = by1 - j * cell
        for i in range(nx):
            h = gz(bx0 + i * cell, y)
            if h is None:
                miss += 1; h = sz - 5
            data.append(f2(h - sz))
    height = {"x0": f2(bx0 - S[0]), "z0": f2(-(by1 - S[1])), "cell": cell, "nx": nx, "nz": nz, "data": data}

    # ---- colliders ----
    cols = []
    for o in meshes:
        n = o.name
        if is_ground(n) or any(k in n for k in SKIP_KEYS):
            continue
        inst = o.data.users > 1 or n.startswith(("tree_", "shrub_", "bamboo_"))
        if inst:  # vegetation instance: trunk box + crown box from the bounding box
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            xs = [p.x for p in bb]; ys = [p.y for p in bb]; zs = [p.z for p in bb]
            w, d, hh = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
            if hh < 1.2:
                continue
            cx, cy, z0 = o.matrix_world.translation.x, o.matrix_world.translation.y, min(zs)
            if hh < 2.5:
                cols.append((cx - w * 0.4, cy - d * 0.4, z0, cx + w * 0.4, cy + d * 0.4, z0 + hh)); continue
            tw = min(1.2, max(0.4, 0.12 * min(w, d)))
            cols.append((cx - tw / 2, cy - tw / 2, z0, cx + tw / 2, cy + tw / 2, z0 + hh * 0.6))
            if not n.startswith(("tree_dead", "tree_burnt")):
                cols.append((cx - w * 0.33, cy - d * 0.33, z0 + hh * 0.5, cx + w * 0.33, cy + d * 0.33, z0 + hh))
            continue
        ev = o.evaluated_get(dg); me = ev.to_mesh(); mw = o.matrix_world
        nv = len(me.vertices)
        if nv == 0:
            ev.to_mesh_clear(); continue
        co = np.empty(nv * 3, np.float64); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        co = (np.array(mw)[:3, :3] @ co.T).T + np.array(mw.translation)
        ed = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2)
        me.calc_loop_triangles()
        tr = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get("vertices", tr); tr = tr.reshape(-1, 3)
        ev.to_mesh_clear()
        parent = np.arange(nv)

        def find(a):
            r = a
            while parent[r] != r:
                r = parent[r]
            while parent[a] != r:
                parent[a], a = r, parent[a]
            return r
        for a, b in ed:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
        roots = np.array([find(i) for i in range(nv)])
        order = np.argsort(roots, kind="stable"); rs = roots[order]; cs = co[order]
        boxes = []
        cuts = np.flatnonzero(np.diff(rs)) + 1
        troot = roots[tr[:, 0]] if len(tr) else np.empty(0, np.int64)
        for g, gi in zip(np.split(cs, cuts), np.split(order, cuts)):
            mn, mx = g.min(0), g.max(0)
            if (mx - mn).max() < 0.35:
                continue
            if mx[2] - mn[2] < FLAT_MAX and (mx[0] - mn[0]) * (mx[1] - mn[1]) >= FLAT_AREA and len(tr):
                fb = footprint_boxes(co, tr[troot == roots[gi[0]]], mn, mx)  # ring-shaped slab: keep the hole open
                if fb:
                    cols += [tuple(float(v) for v in b) for b in fb]
                    continue
            boxes.append([float(v) for v in (*mn, *mx)])
        if not n.startswith(STRUCT):
            # Floor-like parts (rooms, finishes, debris sheets) must not be merged with their neighbours: the merged box
            # would span the atrium or courtyard between them. Only small or tall parts (cars, desks, lamps) merge.
            flat = [b for b in boxes if b[5] - b[2] < FLAT_MAX and (b[3] - b[0]) * (b[4] - b[1]) >= 1.0]
            boxes = [b for b in boxes if not (b[5] - b[2] < FLAT_MAX and (b[3] - b[0]) * (b[4] - b[1]) >= 1.0)]
            if flat:
                cols += [tuple(float(v) for v in b) for b in union_flat_boxes(flat)]
        if not n.startswith(STRUCT) and len(boxes) > 1:
            merged = True
            while merged:
                merged = False; outb = []
                for b in sorted(boxes, key=lambda q: q[0]):
                    for m in outb[-40:]:
                        if all(b[k] <= m[k + 3] + 0.05 and b[k + 3] >= m[k] - 0.05 for k in range(3)) and all(
                                max(b[k + 3], m[k + 3]) - min(b[k], m[k]) <= MERGE_MAX for k in range(2)):  # never one box over a courtyard
                            for k in range(3):
                                m[k] = min(m[k], b[k]); m[k + 3] = max(m[k + 3], b[k + 3])
                            merged = True; break
                    else:
                        outb.append(b)
                boxes = outb
        cols += [tuple(b) for b in boxes]

    sim_cols = []
    for (x0, y0, z0, x1, y1, z1) in cols:
        a = to_sim(x0, y1, z0); b = to_sim(x1, y0, z1)
        sim_cols.append([f2(v) for v in (*a, *b)])
    mapb = [[round(float((c[0] + c[3]) / 2), 1), round(float((c[2] + c[5]) / 2), 1), round(float(c[3] - c[0]), 1), round(float(c[5] - c[2]), 1)]
            for c in sim_cols if (c[4] - c[1]) > 2.5 and (c[3] - c[0]) * (c[5] - c[2]) > 3 and c[1] < 20]
    bounds = {"minX": f2(bx0 - S[0] + 2), "maxX": f2(bx1 - S[0] - 2), "minZ": f2(-(by1 - S[1]) + 2), "maxZ": f2(-(by0 - S[1]) - 2)}
    meta = {"id": scene_id, "title": title, "notes": notes, "spawn_blender": [f2(v) for v in S],
            "offset": [-S[0], -S[2], S[1]], "bounds": bounds, "maxAgl": max_agl, "height": height,
            "colliders": sim_cols, "mapBoxes": mapb[:4000]}
    fp = os.path.normpath(os.path.join(out, "..", "..", "..", "scripts", "blender", "fires.json"))  # sumber api untuk animasi kebakaran
    if os.path.exists(fp):
        fires = json.load(open(fp)).get(scene_id)
        if fires: meta["fires"] = fires
    with open(os.path.join(out, "scene.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))

    # ---- GLB (everything visible except the preview camera, sun and ground disc) ----
    for o in bpy.data.objects:
        o.select_set(o.type in ('MESH', 'EMPTY') and o.visible_get() and not preview(o))
    glb = os.path.join(out, "scene.glb")
    kw = dict(filepath=glb, export_format='GLB', use_selection=True, export_cameras=False, export_lights=False,
              export_extras=False, export_apply=True)
    try:
        bpy.ops.export_scene.gltf(export_gpu_instances=True, export_image_format='WEBP', export_image_quality=80, **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    for o in bpy.data.objects:
        o.select_set(False)
    return {"id": scene_id, "colliders": len(sim_cols), "mapBoxes": len(mapb), "hf": [nx, nz], "miss": miss,
            "spawn_z": f2(sz), "json_kb": round(os.path.getsize(os.path.join(out, "scene.json")) / 1024),
            "glb_mb": round(os.path.getsize(glb) / 1e6, 1), "sec": round(time.time() - t0, 1), "bounds": bounds}
