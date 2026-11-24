# S4 procedural ground zones for bake_terrain(extra=...). Height bands with noisy borders, lake shore, dry patches.
import numpy as np
def make_s4_extra(ns, seed=11):
    N = ns["_Noise"]; rng = np.random.default_rng(seed)
    n1, n2, n3, n4 = N(rng, 8, 5), N(rng, 14, 4), N(rng, 10, 4), N(rng, 20, 4)
    ss = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    def extra(wx, wy, h, Wc, names, U, V):
        i = {n: k for k, n in enumerate(names)}
        a, b, c, d = n1(U, V), n2(U, V), n3(U, V), n4(U, V)
        P = np.zeros_like(Wc)
        low = 1 - ss(h, 62 + 25 * a, 92 + 25 * a)
        clear = ss(b, 0.56, 0.72)
        P[i["mat_forest_floor"]] = low * (1 - 0.7 * clear)
        mid = ss(h, 55 + 20 * a, 85 + 20 * a) * (1 - ss(h, 148 + 18 * a, 178 + 18 * a))
        dry = ss(c, 0.52, 0.66)
        P[i["mat_mountain_grass"]] = (mid + 0.7 * low * clear) * (1 - 0.8 * dry)
        P[i["mat_savanna_dry_grass"]] = (mid + 0.5 * low * clear) * dry
        band = ss(h, 125 + 70 * d, 160 + 70 * d) * (1 - ss(h, 212 + 10 * a, 236 + 10 * a))
        patch = ss(b, 0.45, 0.62)
        P[i["mat_mountain_soil_gravel"]] = band * patch
        P[i["mat_mountain_grass"]] += band * (1 - patch) * 0.6
        P[i["mat_savanna_dry_grass"]] += band * (1 - patch) * 0.5
        P[i["mat_volcanic_rock"]] += ss(h, 205 + 14 * a, 232 + 14 * a) * (0.7 + 0.5 * d)
        P[i["mat_volcanic_sand"]] = ss(h, 240 + 12 * b, 262 + 6 * b) * 1.4
        shore = 1 - ss(h, 24.0 + 1.5 * d, 28.5 + 2.0 * d)
        P = P * (1 - shore)
        P[i["mat_lake_shore_pebbles"]] = shore * 2.0
        W = 0.3 * Wc + P
        # steep ground: mossy rock low down, volcanic rock higher up (slope weight sits in Wc[rock])
        r, m = i["mat_volcanic_rock"], i["mat_moss_rock"]
        lowfac = 1 - ss(h, 95, 135)
        W[m] = W[m] + W[r] * lowfac; W[r] = W[r] * (1 - lowfac)
        return W
    return extra
