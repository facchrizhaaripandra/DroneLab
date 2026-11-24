# S7 gedung inspeksi: kanopi pintu masuk, rangka kaca lobi, gondola BMU di atap. Fasad (tempat cacat) tidak disentuh.
exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\bld_lib.py").read())
SRC = r"C:\Users\darip\Documents\DroneLab3D\S7_inspeksi_gedung\inspeksi_gedung_v06.blend"
DST = r"C:\Users\darip\Documents\DroneLab3D\S7_inspeksi_gedung\inspeksi_gedung_v07.blend"


def run():
    lob, ent, slab = (bpy.data.objects.get(n) for n in ("building_podium_lobby", "building_podium_entrance_glass", "building_roof_slab"))
    L, E, R = world_bbox(lob), world_bbox(ent), world_bbox(slab)
    material("mat_bmu_white", (0.86, 0.87, 0.86, 1), 0.5, 0.3)
    g = Geo()
    bld_geom.entrance_canopy(g, {"frame": "mat_window_frame_alu", "glass": "mat_window_glass"}, E[0] - 1.0, E[3] + 1.0, L[1], L[5] - 0.3, depth=3.5, front=-1)
    n = 8
    for i in range(n + 1):   # rangka kaca lobi
        x = E[0] + i * (E[3] - E[0]) / n
        g.box("mat_window_frame_alu", x - 0.05, E[1] - 0.08, E[2], x + 0.05, E[1], E[5])
    g.box("mat_window_frame_alu", E[0], E[1] - 0.08, 2.3, E[3], E[1], 2.4)
    to_object(g, "building_podium_canopy", lob.users_collection[0])
    g = Geo()
    bld_geom.bmu(g, {"rail": "mat_steel_frame_rusty", "body": "mat_bmu_white"}, R[0], R[1], R[3], R[4], R[5])
    to_object(g, "roof_bmu_gondola", coll_of("roof_ac_units"))
    save_as(DST)
    return {"ok": True}
