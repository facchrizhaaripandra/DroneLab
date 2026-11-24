# S6 kawasan perkotaan: kantor, menara landmark, rumah sakit, gudang, atap pasar dan rumah dibangun ulang dengan
# bld_geom; deretan ruko diberi detail per unit. Lahan dan tinggi atap tetap (helipad menara tetap di 39,6-40,2 m).
# Blender (CLI):  exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\s6_upgrade.py").read()); res = run()
exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\bld_lib.py").read())
import math

SRC = r"C:\Users\darip\Documents\DroneLab3D\S6_kota_pengiriman\kota_pengiriman_v06.blend"
DST = r"C:\Users\darip\Documents\DroneLab3D\S6_kota_pengiriman\kota_pengiriman_v07.blend"
NEW = {  # material baru (yang belum ada di file): warna, kekasaran, logam
    "mat_frame_alu_dark": ((0.16, 0.17, 0.18, 1), 0.4, 0.8),
    "mat_lobby_glass": ((0.35, 0.45, 0.5, 1), 0.08, 0.2),
    "mat_skylight": ((0.8, 0.85, 0.88, 1), 0.2, 0.0),
    "mat_steel_portal": ((0.42, 0.45, 0.48, 1), 0.5, 0.7),
    "mat_house_plinth": ((0.45, 0.43, 0.40, 1), 0.9, 0.0),
    "mat_house_post": ((0.92, 0.92, 0.9, 1), 0.7, 0.0),
}


def front_toward_center(x0, y0, x1, y1):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if abs(cx) > abs(cy): return "-x" if cx > 0 else "+x"
    return "-y" if cy > 0 else "+y"


def mats_of(ob):
    return [s.material.name for s in ob.material_slots if s.material]


def run():
    for k, v in NEW.items(): material(k, *v)
    stats = {}
    styles = ["curtain", "fins", "grid"]
    # ---- kantor ----
    for i in range(1, 8):
        base = f"building_office_{i:02d}"
        fa, gl, rf = (bpy.data.objects.get(base + s) for s in ("_facade", "_glass", "_roof"))
        if not fa: continue
        x0, y0, z0, x1, y1, h = world_bbox(fa)
        coll = fa.users_collection[0]
        m = {"facade": mats_of(fa)[0], "glass": mats_of(gl)[0] if gl else "mat_glass_dark", "roof": "mat_roof_concrete",
             "frame": "mat_frame_alu_dark", "lobby_glass": "mat_lobby_glass", "ac": "mat_ac_unit", "plant": "mat_roof_concrete"}
        g = Geo()
        bld_geom.office(g, x0, y0, x1, y1, h, m, style=styles[(i - 1) % 3], front=front_toward_center(x0, y0, x1, y1))
        remove([base + "_facade", base + "_glass", base + "_roof"])
        to_object(g, base, coll); stats[base] = g.tris
    # ---- menara landmark (helipad tetap) ----
    fa = bpy.data.objects.get("building_landmark_tower_facade")
    if fa:
        x0, y0, _, x1, y1, h = world_bbox(fa); coll = fa.users_collection[0]
        g = Geo()
        bld_geom.tower(g, x0, y0, x1, y1, h, {"facade": "mat_facade_cladding", "glass": "mat_glass_reflective_blue", "roof": "mat_roof_concrete",
                                              "frame": "mat_frame_alu_dark", "lobby_glass": "mat_lobby_glass"}, roof_z=39.6)
        remove(["building_landmark_tower_facade", "building_landmark_tower_glass", "building_landmark_tower_roof"])
        to_object(g, "building_landmark_tower", coll); stats["tower"] = g.tris
    # ---- rumah sakit ----
    for part in ("main", "wing"):
        fa = bpy.data.objects.get(f"building_hospital_{part}_facade")
        if not fa: continue
        x0, y0, _, x1, y1, h = world_bbox(fa); coll = fa.users_collection[0]
        g = Geo()
        bld_geom.hospital(g, x0, y0, x1, y1, h, {"facade": "mat_facade_hospital_white", "glass": "mat_glass_dark", "roof": "mat_roof_concrete",
                                                 "frame": "mat_facade_hospital_white", "ac": "mat_ac_unit"})
        remove([f"building_hospital_{part}_{s}" for s in ("facade", "glass", "roof")])
        to_object(g, f"building_hospital_{part}", coll); stats["hospital_" + part] = g.tris
    # ---- gudang logistik: pintu muat di sisi +y tetap terlihat ----
    wh = bpy.data.objects.get("building_logistics_warehouse")
    if wh:
        x0, y0, _, x1, y1, h = world_bbox(wh); coll = wh.users_collection[0]
        g = Geo()
        bld_geom.warehouse(g, x0, y0, x1, y1 - 0.55, h, {"wall": "mat_warehouse_metal_sheet", "roof": "mat_roof_zinc", "steel": "mat_steel_portal",
                                                         "skylight": "mat_skylight", "plinth": "mat_concrete_facade_moldy"}, eave=9.0, axis="x")
        remove(["building_logistics_warehouse"])
        to_object(g, "building_logistics_warehouse", coll); stats["warehouse"] = g.tris
    # ---- atap pasar ----
    mr = bpy.data.objects.get("building_market_roof_zinc")
    if mr:
        x0, y0, z0, x1, y1, z1 = world_bbox(mr); coll = mr.users_collection[0]
        g = Geo()
        bld_geom.market_roof(g, x0 + 0.6, y0 + 0.6, x1 - 0.6, y1 - 0.6, z0, z1, {"roof": "mat_roof_zinc_rusty", "steel": "mat_steel_portal"}, bays=5)
        remove(["building_market_roof_zinc"])
        to_object(g, "building_market_roof_zinc", coll); stats["market"] = g.tris
    # ---- rumah ----
    n = 0
    for ob in [o for o in bpy.data.objects if o.name.startswith("building_house_")]:
        x0, y0, _, x1, y1, h = world_bbox(ob); coll = ob.users_collection[0]
        ms = mats_of(ob)
        wall = next((x for x in ms if "wall" in x), "mat_ruko_wall_1")
        roof = next((x for x in ms if "roof" in x), "mat_roof_clay_tile")
        if "zinc" in roof and n % 2 == 0: roof = "mat_roof_clay_tile"     # kebanyakan rumah kota memakai genteng
        name = ob.name
        g = Geo()
        bld_geom.house(g, x0 + 0.5, y0 + 0.5, x1 - 0.5, y1 - 0.5,
                       {"wall": wall, "roof": roof, "window": "mat_window_dark", "door": "mat_door_wood", "plinth": "mat_house_plinth", "post": "mat_house_post"},
                       front=front_toward_center(x0, y0, x1, y1), floors=2 if h > 7.5 else 1, roof="limasan" if n % 3 == 1 else "pelana")
        bpy.data.objects.remove(ob, do_unlink=True)
        to_object(g, name, coll); n += 1
    stats["houses"] = n
    # ---- detail ruko ----
    rows = sorted({o.name.split("_walls")[0] for o in bpy.data.objects if o.name.startswith("ruko_row_") and "_walls" in o.name})
    units = 0
    for r in rows:
        walls = [o for o in bpy.data.objects if o.name.startswith(r + "_walls")]
        aw = bpy.data.objects.get(r + "_awnings")
        if not walls or not aw: continue
        allb = [world_bbox(o) for o in walls]
        bx0, by0, bx1, by1 = min(b[0] for b in allb), min(b[1] for b in allb), max(b[3] for b in allb), max(b[4] for b in allb)
        a = world_bbox(aw); ax, ay = (a[0] + a[3]) / 2, (a[1] + a[4]) / 2
        if a[4] <= by0 + 0.3: front = "-y"
        elif a[1] >= by1 - 0.3: front = "+y"
        elif a[3] <= bx0 + 0.3: front = "-x"
        else: front = "+x"
        g = Geo()
        for o in walls:
            for (x0, y0, z0, x1, y1, z1) in loose_boxes(o):
                w, d = x1 - x0, y1 - y0
                if min(w, d) < 2.5 or z1 - z0 < 5: continue
                units += 1
                bld_geom.ruko_unit_details(g, x0, y0, x1, y1, z1, front,
                                           {"steel": "mat_balcony_rail_steel", "ac": "mat_ac_unit", "cap": "mat_curb_concrete",
                                            "tank": "mat_water_tank_orange" if (units % 3) else "mat_water_tank_blue"}, seed=(x0 * 0.137 + y0 * 0.071))
        if g.f: to_object(g, r + "_details", walls[0].users_collection[0])
    stats["ruko_units"] = units
    save_as(DST)
    return stats
