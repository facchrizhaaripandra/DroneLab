# S4 v07 ground colour rules for bake_terrain(extra=...). Zones come from height, slope (handled by the
# bake's slope zone), aspect (sun-facing slopes are drier), drainage area (gullies, stream beds) and noise.
import bpy, numpy as np

ZONES = [  # (material name, diffuse image, tile metres, tint, contrast)
    ("mat_forest_floor", "mat_forest_floor_t2_diff", 14, (1.55, 1.45, 1.55), 1.0),
    ("mat_mountain_grass", "mat_mountain_grass_t_diff", 10, (0.80, 0.84, 1.15), 0.9),
    ("mat_savanna_dry_grass", "mat_savanna_dry_grass_t2_diff", 12, (0.84, 0.84, 0.92), 0.9),
    ("mat_volcanic_rock", "ph_rocky_terrain_03_diff", 18, (0.95, 1.0, 1.3), 0.75),
    ("mat_volcanic_sand", "mat_volcanic_sand_t_diff", 10, (1.1, 1.04, 0.95), 1.0),
    ("mat_lake_shore_pebbles", "mat_lake_shore_pebbles_t2_diff", 6, (1.05, 1.02, 0.98), 1.0),
    ("mat_mountain_soil_gravel", "mat_mountain_soil_gravel_t2_diff", 12, (0.92, 1.0, 1.1), 0.55),
    ("mat_moss_rock", "mat_moss_rock_t_diff", 12, (1.25, 1.25, 1.3), 1.0),
]


def make_zone_materials(ter):
    me = ter.data; me.materials.clear()
    for name, img, *_ in ZONES:
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
        o = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images[img]
        nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(b.outputs[0], o.inputs[0])
        me.materials.append(m)
    me.polygons.foreach_set('material_index', np.zeros(len(me.polygons), np.int32))


def make_extra(ns, flow_path, ext=600.0, cell=5.0, lake=30.0, seed=21, camp=(-60.0, -372.0)):
    A = np.load(flow_path); n = A.shape[0]
    LA = np.log(A)
    N_ = ns["_Noise"]; rng = np.random.default_rng(seed)
    n1, n2, n3, n4 = N_(rng, 8, 5), N_(rng, 16, 4), N_(rng, 10, 4), N_(rng, 24, 4)
    bil = ns["_bilinear"]
    ss = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    Hg = np.load(flow_path.replace('flow', 'height'))
    gy, gx = np.gradient(Hg, cell)
    north = -gy / (np.hypot(gx, gy) + 1e-6)           # +1 where the slope faces north (sunny, southern hemisphere)
    conv = Hg - ns["_blur"](Hg, 2.0)                 # >0 on crests, <0 in hollows

    def extra(wx, wy, h, Wc, names, U, V):
        i = {nm: k for k, nm in enumerate(names)}
        fx = (wx + ext) / cell; fy = (wy + ext) / cell
        la = bil(LA, fy, fx); nf = bil(north, fy, fx); cv = bil(conv, fy, fx)
        a, b, c, d = n1(U, V), n2(U, V), n3(U, V), n4(U, V)
        P = np.zeros_like(Wc)
        hh = h + 25 * (a - 0.5)                        # noisy height for every band edge
        forest = (1 - ss(hh, 190, 260)) * ss(hh, lake + 1.5, lake + 5)
        alpine = ss(hh, 180, 250) * (1 - ss(hh, 360, 410))
        scree = ss(hh, 370, 420)
        dry = ss(nf * 0.6 + (c - 0.5) * 1.4, 0.15, 0.55)
        clear = ss(b, 0.6, 0.75)                       # clearings in the forest
        under = ss(d, 0.42, 0.62)                      # green undergrowth patches between the trees
        P[i["mat_forest_floor"]] = forest * (1 - 0.8 * clear) * (1 - 0.6 * under)
        P[i["mat_mountain_grass"]] = alpine * (1 - 0.7 * dry) + forest * clear * (1 - dry) * 0.9 + forest * under * 0.75
        P[i["mat_savanna_dry_grass"]] = alpine * dry * 0.9 + forest * clear * dry * 0.9
        P[i["mat_mountain_soil_gravel"]] = ss(cv, 0.6, 2.0) * ss(hh, 180, 260) * 1.2 + alpine * ss(d, 0.62, 0.75) * 0.8
        P[i["mat_volcanic_sand"]] = scree * (0.7 + 0.6 * d)
        P[i["mat_volcanic_rock"]] += scree * 0.5 * ss(b, 0.5, 0.7)
        # gullies and stream beds: wet moss in small gullies, pebbles in the big ones
        gully = ss(la, 8.5, 10.0) * (1 - ss(la, 11.5, 12.5))
        bed = ss(la, 11.3, 12.4)
        P[i["mat_moss_rock"]] += gully * 0.7 * (1 - scree)
        P[i["mat_lake_shore_pebbles"]] += bed * 1.6
        # lake shore band
        shore = (1 - ss(h, lake + 0.8 + 0.8 * d, lake + 2.6 + 1.2 * d)) * ss(h, lake - 6, lake - 2)
        under_w = 1 - ss(h, lake - 2, lake + 0.2)
        P = P * (1 - np.maximum(shore, under_w))
        P[i["mat_lake_shore_pebbles"]] += shore * 2.0 + under_w * 1.0
        W = P
        r, m = i["mat_volcanic_rock"], i["mat_moss_rock"]
        W[r] = W[r] + Wc[r]                            # Wc[r] = steep-slope weight from the bake
        # the camp meadow is grass (with dry patches), never rock
        mead = (1 - ss(np.hypot(wx - camp[0], wy - camp[1]), 70, 135)) * (1 - shore) * (1 - under_w)
        W = W * (1 - mead)
        W[i["mat_mountain_grass"]] += mead * (1 - 0.6 * ss(c, 0.55, 0.7))
        W[i["mat_savanna_dry_grass"]] += mead * 0.6 * ss(c, 0.55, 0.7)
        low = 1 - ss(h, 150, 220)
        W[m] = W[m] + W[r] * low * 0.8; W[r] = W[r] * (1 - low * 0.8)
        return W
    return extra
