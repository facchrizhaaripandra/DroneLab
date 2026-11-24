# S1 gedung perkantoran terbakar: partisi tiap lantai diberi bukaan pintu (drone bisa berpindah ruangan) dan korban
# ditempatkan di beberapa ruangan, di koridor, dan di atap. Atrium tetap kosong.
exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\bld_lib.py").read())

SRC = r"C:\Users\darip\Documents\DroneLab3D\S1_gedung_terbakar\gedung_terbakar_v08.blend"
DST = r"C:\Users\darip\Documents\DroneLab3D\S1_gedung_terbakar\gedung_terbakar_v09.blend"
# (lantai, x, y, berbaring, yaw) dalam koordinat Blender; z diambil dari lantai: L1 0, L2 3.5, L3 7.0, L4 10.5, atap 14.0
VICTIMS = [(1, -9.8, -8.0, False, 0.6), (2, 9.8, 8.5, True, 1.2), (2, -6.0, 13.8, False, 3.1), (3, 10.0, -13.6, True, 0.2),
           (3, -9.6, 0.5, False, 1.6), (4, 5.8, 13.6, True, 2.4), (5, 6.0, 6.0, False, 0.9)]
FLOOR_Z = {1: 0.05, 2: 3.5, 3: 7.0, 4: 10.5, 5: 14.0}


def run():
    material("mat_victim_vest", (0.95, 0.42, 0.08, 1), 0.6)
    material("mat_victim_shirt", (0.2, 0.32, 0.55, 1), 0.8)
    material("mat_victim_pants", (0.12, 0.12, 0.14, 1), 0.85)
    material("mat_victim_skin", (0.62, 0.45, 0.33, 1), 0.7)
    doors = 0
    for k in (1, 2, 3, 4):
        name = f"partitions_L{k}"
        ob = bpy.data.objects.get(name)
        if not ob: continue
        mat = ob.material_slots[0].material.name if ob.material_slots else "mat_interior_plaster"
        g = Geo()
        for (x0, y0, z0, x1, y1, z1) in loose_boxes(ob):
            if z1 - z0 < 0.5 or max(x1 - x0, y1 - y0) < 0.3: continue      # potongan kecil (list, sambungan)
            if x1 - x0 < 0.12: c = (x0 + x1) / 2; x0, x1 = c - 0.06, c + 0.06   # bidang tunggal -> dinding 12 cm
            if y1 - y0 < 0.12: c = (y0 + y1) / 2; y0, y1 = c - 0.06, c + 0.06
            doors += bld_geom.wall_with_doors(g, mat, x0, y0, z0, x1, y1, z1)
        c = ob.users_collection[0]
        remove([name]); to_object(g, name, c, min_part=0.0)
    g = Geo()
    for i, (fl, x, y, lying, yaw) in enumerate(VICTIMS):
        m = {"body": "mat_victim_vest" if i % 3 == 0 else "mat_victim_shirt", "skin": "mat_victim_skin", "legs": "mat_victim_pants"}
        bld_geom.person(g, x, y, FLOOR_Z[fl] + 0.02, m, lying=lying, yaw=yaw)
    to_object(g, "victims_people", coll_of("partitions_L2"))
    save_as(DST)
    return {"doors": doors, "victims": len(VICTIMS)}
