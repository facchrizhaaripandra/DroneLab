# S3 resor hotel: hotel diturunkan ke batas 15 m Bali dan dibuat berundak ke arah laut, atap tumpang untuk lobi dan
# restoran, villa dengan atap jerami limasan, bale dan angkul-angkul, kolam villa dan kolam infinity jadi bak berongga
# 1,4 m, kolam atap hotel dinaikkan (bak 1,2 m di atas atap).
exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\bld_lib.py").read())

SRC = r"C:\Users\darip\Documents\DroneLab3D\S3_resor_hotel\resor_hotel_v07.blend"
DST = r"C:\Users\darip\Documents\DroneLab3D\S3_resor_hotel\resor_hotel_v08.blend"
POOL_DEPTH = 1.4


def bb(name):
    ob = bpy.data.objects.get(name)
    return world_bbox(ob) if ob else None


def move_obj(name, dx, dy, dz):
    ob = bpy.data.objects.get(name)
    if ob: ob.location.x += dx; ob.location.y += dy; ob.location.z += dz


def run():
    stats = {}
    coll = coll_of("hotel_main_block_concrete")
    M = {"stone": "mat_natural_stone", "concrete": "mat_concrete_white", "glass": "mat_glass_tinted", "wood": "mat_wood_teak", "planter": "mat_natural_stone"}
    # ---- hotel utama: lantai dasar + 3 lantai mundur ke arah laut (-y) ----
    hb = bb("hotel_main_block_concrete"); base = bb("hotel_main_block_stone_base_columns")
    if hb and base:
        x0, y0, x1, y1 = hb[0], hb[1], hb[3], hb[4]
        g = Geo()
        roof_z, (rx0, ry0, rx1, ry1) = bld_geom.terraced_hotel(g, x0, y0, x1, y1, base[2], M, floors=3, fl=3.3, step=2.0, side="-y")
        remove(["hotel_main_block_concrete", "hotel_main_block_glass", "hotel_main_block_planters_stone", "hotel_main_block_railings_wood",
                "hotel_main_block_stone_base_columns"])
        to_object(g, "hotel_main_block", coll); stats["hotel_main"] = (g.tris, round(roof_z, 2), round(roof_z + 1.0 - base[2], 2))
        # atap: taman, dek, pergola dan kolam turun ke atap baru (dan bergeser masuk ke atas lantai teratas)
        old_roof = bb("hotel_roof_deck")[2]
        dz, dy = roof_z - old_roof, max(0.0, ry0 + 0.3 - bb("hotel_roof_garden_lawn")[1])
        for n in ("hotel_roof_deck", "hotel_roof_garden_lawn", "hotel_roof_pergola", "hotel_roof_pool_tiles", "hotel_roof_pool_water"):
            move_obj(n, 0, dy, dz)
        bpy.context.view_layer.update()
        t, w = bb("hotel_roof_pool_tiles"), bpy.data.objects.get("hotel_roof_pool_water")
        if t and w:
            deck_top = bb("hotel_roof_deck")[5]
            wz = deck_top + 1.2
            w.location.z += wz - bb("hotel_roof_pool_water")[5]
            g = Geo(); bld_geom.basin(g, "mat_pool_tile", t[0], t[1], t[3], t[4], deck_top + 0.05, wz + 0.1, t=0.25)
            remove(["hotel_roof_pool_tiles"]); to_object(g, "hotel_roof_pool_tiles", coll)
    # ---- sayap barat: 2 lantai + atap genteng limasan ----
    wb = bb("hotel_west_wing_concrete"); wbase = bb("hotel_west_wing_stone_base_columns")
    if wb and wbase:
        x0, y0, x1, y1 = wb[0], wb[1], wb[3], wb[4]
        g = Geo()
        rz, _ = bld_geom.terraced_hotel(g, x0, y0, x1, y1, wbase[2], M, floors=2, fl=3.3, step=0.0, side="-x")
        g.hip("mat_roof_clay_tile", x0, y0, x1, y1, rz - 0.3, rz + 3.2, over=1.0)
        remove(["hotel_west_wing_concrete", "hotel_west_wing_glass", "hotel_west_wing_roof_clay", "hotel_west_wing_stone_base_columns"])
        to_object(g, "hotel_west_wing", coll); stats["west_wing_top"] = round(rz + 3.2 - wbase[2], 2)
    # ---- atap tumpang: lobi (3 tingkat), restoran (2 tingkat) ----
    for name, tiers in (("hotel_lobby_roof_clay", 3), ("restaurant_roof_clay", 2)):
        r = bb(name)
        if not r: continue
        c = coll_of(name)
        g = Geo()
        top = bld_geom.balinese_roof(g, "mat_roof_clay_tile", r[0] + 1.0, r[1] + 1.0, r[3] - 1.0, r[4] - 1.0, r[2], r[5] - r[2] + 0.6, tiers=tiers,
                                     over=1.0, neck="mat_wood_teak", finial="mat_red_brick_temple")
        remove([name]); to_object(g, name, c); stats[name] = round(top, 2)
    # ---- villa ----
    VM = {"wall": "mat_concrete_white", "roof": "mat_roof_thatch", "window": "mat_window_dark", "door": "mat_door_wood", "plinth": "mat_natural_stone", "post": "mat_wood_teak"}
    nv = 0
    for i in range(1, 9):
        v = f"villa_{i:02d}"
        P, T, D, H = bb(v + "_stone_podium"), bb(v + "_pool_tiles"), bb(v + "_deck"), bpy.data.objects.get(v + "_house")
        W = bpy.data.objects.get(v + "_pool_water")
        if not (P and T and D and H and W): continue
        c = H.users_collection[0]
        wz = world_bbox(W)[5]
        floor_z = wz - POOL_DEPTH
        hx0, hy0, hx1, hy1 = T[0], T[1], T[3], T[4]
        g = Geo()
        bld_geom.frame_minus(g, "mat_natural_stone", P[0], P[1], P[3], P[4], P[2], D[2], hx0, hy0, hx1, hy1)
        g.box("mat_natural_stone", hx0, hy0, P[2], hx1, hy1, floor_z - 0.25)
        remove([v + "_stone_podium"]); to_object(g, v + "_stone_podium", c)
        g = Geo(); bld_geom.basin(g, "mat_pool_tile", hx0, hy0, hx1, hy1, floor_z, D[5] + 0.05, t=0.2)
        remove([v + "_pool_tiles"]); to_object(g, v + "_pool_tiles", c)
        g = Geo(); bld_geom.frame_minus(g, "mat_wood_deck", D[0], D[1], D[3], D[4], D[2], D[5], hx0 - 0.2, hy0 - 0.2, hx1 + 0.2, hy1 + 0.2)
        remove([v + "_deck"]); to_object(g, v + "_deck", c)
        # rumah: dinding asli, atap jerami limasan, teras menghadap kolam
        parts = sorted(loose_boxes(H), key=lambda b: -((b[3] - b[0]) * (b[4] - b[1])))
        wall = min(parts[:2], key=lambda b: b[2])
        front = "-y" if (T[1] + T[4]) / 2 < (wall[1] + wall[4]) / 2 else "+y"
        g = Geo()
        ty0, ty1 = (wall[1] - 2.2, wall[4]) if front == "-y" else (wall[1], wall[4] + 2.2)
        bld_geom.house(g, wall[0], ty0, wall[3], ty1, VM, front=front, roof="limasan")
        g.move(0, 0, wall[2])
        remove([v + "_house"]); to_object(g, v + "_house", c)
        # bale di sisi kolam, angkul-angkul di tepi podium
        g = Geo()
        free_x0, free_x1 = (hx1 + 0.3, D[3]) if D[3] - hx1 > hx0 - D[0] else (D[0], hx0 - 0.3)
        if free_x1 - free_x0 > 3.4:
            bld_geom.bale(g, (free_x0 + free_x1) / 2, (D[1] + D[4]) / 2, D[5], {"wood": "mat_wood_teak", "roof": "mat_roof_thatch", "base": "mat_natural_stone"},
                          size=min(3.2, free_x1 - free_x0 - 0.4))
        gx = P[0] + 0.6 if free_x0 < hx0 else P[3] - 0.6
        bld_geom.angkul(g, gx, (P[1] + P[4]) / 2 + 2.0, D[5] - 0.1, {"brick": "mat_red_brick_temple", "roof": "mat_roof_clay_tile"}, axis="y")
        to_object(g, v + "_bale_gate", c)
        nv += 1
    stats["villas"] = nv
    # ---- kolam infinity: bak berongga ----
    t, w = bb("infinity_pool_basin_tiles"), bpy.data.objects.get("infinity_pool_water")
    if t and w:
        wz = world_bbox(w)[5]
        g = Geo(); bld_geom.basin(g, "mat_pool_tile", t[0], t[1], t[3], t[4], max(t[2] + 0.25, wz - POOL_DEPTH), wz - 0.02, t=0.3)
        c = coll_of("infinity_pool_basin_tiles"); remove(["infinity_pool_basin_tiles"]); to_object(g, "infinity_pool_basin_tiles", c)
    save_as(DST)
    return stats
