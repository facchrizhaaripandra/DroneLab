# S7b jembatan gantung: balok portal tengah di tiap menara, tangga inspeksi di satu kaki tiap menara, lampu jalan di
# sepanjang dek, lampu tanda penerbangan merah di puncak menara.
exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\bld_lib.py").read())
SRC = r"C:\Users\darip\Documents\DroneLab3D\S7b_inspeksi_jembatan\inspeksi_jembatan_v06.blend"
DST = r"C:\Users\darip\Documents\DroneLab3D\S7b_inspeksi_jembatan\inspeksi_jembatan_v07.blend"


def run():
    towers = bpy.data.objects.get("bridge_towers_concrete")
    deck = world_bbox(bpy.data.objects.get("bridge_deck_slab"))
    legs = [b for b in loose_boxes(towers) if b[5] - b[2] > 30]
    material("mat_lamp_head", (0.95, 0.93, 0.85, 1), 0.3)
    material("mat_aviation_red", (0.9, 0.08, 0.05, 1), 0.4)
    g = Geo()
    for side in (-1, 1):
        ls = sorted([b for b in legs if (b[0] + b[3]) / 2 * side > 0], key=lambda b: b[1])
        if len(ls) < 2: continue
        a, b = ls[0], ls[-1]
        x0, x1 = max(a[0], b[0]) + 0.1, min(a[3], b[3]) - 0.1
        g.box("mat_bridge_concrete", x0, a[4], 28.0, x1, b[1], 29.8)                       # balok portal tengah
        out = a[0] if side < 0 else a[3]
        bld_geom.ladder(g, "mat_steel_painted_peeling", out, a[1] + 0.6, a[1] + 1.2, deck[5] + 1.0, 40.8, out + side)
        for leg in ls:
            g.cyl("mat_aviation_red", (leg[0] + leg[3]) / 2, (leg[1] + leg[4]) / 2, 44.4, 44.8, 0.18, seg=8)
    for k in range(-3, 4):
        x = k * 14.0 + 7.0
        if abs(x) > deck[3] - 3: continue
        for sy in (-1, 1):
            bld_geom.street_lamp(g, "mat_steel_painted_peeling", x, sy * (deck[4] - 0.35), deck[5] + 0.25, h=7.5, arm_dir=(0, -sy), arm=1.5, lamp_mat="mat_lamp_head")
    to_object(g, "bridge_details_portal_lamps", towers.users_collection[0])
    save_as(DST)
    return {"legs": len(legs), "tris": g.tris}
