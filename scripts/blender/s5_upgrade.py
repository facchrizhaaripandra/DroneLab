# S5 sawah: rumah petani diperbarui (teras, genteng, pintu, jendela) dan desa diberi mushola, pos ronda dan warung.
# Tiap bangunan baru hanya dipasang bila lahannya kosong (tidak menabrak objek lain) dan tanahnya datar.
exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\bld_lib.py").read())
from mathutils import Vector
SRC = r"C:\Users\darip\Documents\DroneLab3D\S5_sawah\sawah_v05.blend"
DST = r"C:\Users\darip\Documents\DroneLab3D\S5_sawah\sawah_v06.blend"
IGNORE = ("wire", "ground_", "terrain_", "road_", "paddy_", "path_", "decal", "grass", "rice_", "water", "ditch", "irrigation", "bund", "pematang", "dike")


def blockers():
    out = []
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.visible_get() or any(k in o.name for k in IGNORE): continue
        b = world_bbox(o)
        if max(b[3] - b[0], b[4] - b[1]) > 25:   # objek memanjang (tiang listrik, pagar, rumpun bambu): per bagian lepas
            out += [(o.name, lb) for lb in loose_boxes(o)]
        else:
            out.append((o.name, b))
    return out


def free(rect, obs, margin=0.8):
    x0, y0, x1, y1 = rect
    for name, b in obs:
        if b[0] < x1 + margin and b[3] > x0 - margin and b[1] < y1 + margin and b[4] > y0 - margin and b[5] > 0.3 and b[2] < 5.0:
            return name
    return None


def ground_z(x, y):
    dg = bpy.context.evaluated_depsgraph_get()
    hit = bpy.context.scene.ray_cast(dg, Vector((x, y, 200)), Vector((0, 0, -1)))
    return hit[1].z if hit[0] else 0.0


def flat_z(rect):
    x0, y0, x1, y1 = rect
    zs = [ground_z(x, y) for x in (x0, (x0 + x1) / 2, x1) for y in (y0, (y0 + y1) / 2, y1)]
    return max(zs), max(zs) - min(zs)


def place(build, rects, obs, report, name):
    for rect in rects:
        hit = free(rect, obs)
        if hit: report[name + "_skip"] = report.get(name + "_skip", []) + [hit]; continue
        z, slope = flat_z(rect)
        if slope > 0.6: report[name + "_skip"] = report.get(name + "_skip", []) + ["miring"]; continue
        g = Geo(); build(g, rect); g.move(0, 0, z)
        to_object(g, name, coll_of("building_farmer_house"))
        obs.append((name, (rect[0], rect[1], z, rect[2], rect[3], z + 10)))
        report[name] = [round(v, 1) for v in rect]; return True
    return False


def run():
    report = {}
    for k, v in {"mat_mushola_green": ((0.18, 0.42, 0.3, 1), 0.7), "mat_finial_gold": ((0.85, 0.65, 0.2, 1), 0.35, 0.8),
                 "mat_warung_sign": ((0.85, 0.15, 0.12, 1), 0.6), "mat_house_post": ((0.92, 0.92, 0.9, 1), 0.7)}.items():
        material(k, *v)
    fh = bpy.data.objects.get("building_farmer_house")
    if fh:
        b = world_bbox(fh); c = fh.users_collection[0]
        g = Geo()
        bld_geom.house(g, b[0] + 0.3, b[1] + 0.3, b[3] - 0.3, b[4] - 0.3, {"wall": "mat_house_plaster_white", "roof": "mat_roof_clay_tile",
                       "window": "mat_window_dark", "door": "mat_door_wood", "post": "mat_wood_rough", "plinth": "mat_yard_packed_dirt"},
                       front="-y", roof="limasan")
        g.move(0, 0, b[2])
        remove(["building_farmer_house"]); to_object(g, "building_farmer_house", c)
    obs = blockers()
    M = {"wall": "mat_house_plaster_white", "roof": "mat_mushola_green", "window": "mat_window_dark", "door": "mat_door_wood", "finial": "mat_finial_gold",
         "plinth": "mat_yard_packed_dirt"}
    def mus(g, r): bld_geom.mushola(g, (r[0] + r[2]) / 2 - 0.6, (r[1] + r[3]) / 2 + 1.25, M)
    place(mus, [(-96.0, 41.6, -83.5, 53.0), (-62.0, 46.0, -49.5, 57.4), (-112.0, 30.0, -99.5, 41.4)], obs, report, "building_mushola")
    def pos(g, r): bld_geom.pos_ronda(g, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, {"wood": "mat_wood_rough", "roof": "mat_roof_zinc_rusty"})
    place(pos, [(-85.5, 68.0, -82.0, 71.5), (-86.0, 34.0, -82.5, 37.5), (-75.5, 46.0, -72.0, 49.5), (-86.0, 46.0, -82.5, 49.5), (-76.0, -73.0, -72.5, -69.5)], obs, report, "building_pos_ronda")
    def war(g, r): bld_geom.warung(g, r[0], r[1] + 2.0, r[2], r[3], {"wall": "mat_house_plaster_white", "roof": "mat_roof_zinc_rusty", "window": "mat_window_dark",
                                                                        "counter": "mat_wood_rough", "awning": "mat_roof_zinc_rusty", "post": "mat_wood_rough", "sign": "mat_warung_sign"})
    place(war, [(-103.0, -73.5, -97.0, -67.0), (-60.0, -73.5, -54.0, -67.0), (30.0, -73.5, 36.0, -67.0)], obs, report, "building_warung")
    save_as(DST)
    return report
