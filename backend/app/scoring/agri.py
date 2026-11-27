"""M3 spray model, the same as src/agri.js.

The field is a grid of square cells. Spray lands in a circle under the drone and is pushed
by the wind while it falls. Doses are kept with 32-bit precision, like the Float32Array in
the simulator.
"""

import math

from app.scoring.jsmath import f32, js_round

DEG = math.pi / 180
ENV_ALT = (3, 8)  # m, the "good spraying" height band
ENV_SPEED = 4  # m/s
HOME_R = 3


def swath_width(alt: float) -> float:
    return min(max(alt * 0.8, 2), 7)  # m, wider when flying higher


class Agri:
    def __init__(self, mission: dict):
        self.m = mission
        f = mission["field"]
        self.cell = f["cell"]
        self.nx = js_round((f["max"][0] - f["min"][0]) / self.cell)
        self.nz = js_round((f["max"][1] - f["min"][1]) / self.cell)
        self.kind = [0] * (self.nx * self.nz)  # 0 = target cell, 1 = no-spray (house, river)
        for i in range(self.nx):
            for j in range(self.nz):
                x = f["min"][0] + (i + 0.5) * self.cell
                z = f["min"][1] + (j + 0.5) * self.cell
                for r in mission["noSpray"]:
                    inside_x = r["min"][0] <= x <= r["max"][0]
                    if inside_x and r["min"][1] <= z <= r["max"][1]:
                        self.kind[i * self.nz + j] = 1
        self.targets = self.kind.count(0)
        self.dose = [0.0] * (self.nx * self.nz)
        self.tank = mission["dose"]["capacity"]
        self.total = self.outside = self.no_spray_dose = 0.0
        self.empties = self.refills = 0
        self.spray_ms = self.good_ms = 0.0
        self.last_ms = -1
        self.empty = False

    def refill(self) -> None:
        capacity = self.m["dose"]["capacity"]
        if self.tank < capacity:
            self.tank = capacity
            self.refills += 1
        self.empty = False

    def spray_step(self, sample: dict, wind: dict | None) -> None:
        """One telemetry sample {t_ms, pos, vel, spraying}."""
        t_ms = sample["t_ms"]
        dt = 0 if self.last_ms < 0 else min(0.3, (t_ms - self.last_ms) / 1000)
        self.last_ms = t_ms
        if not sample.get("spraying") or dt <= 0:
            return
        f, c = self.m["field"], self.cell
        amount = self.m["dose"]["flow"] * dt
        if self.tank <= 0:
            return  # dry: nothing comes out (running dry was counted when it happened)
        amount = min(amount, self.tank)
        self.tank -= amount
        if self.tank <= 1e-9 and not self.empty:
            self.empty = True
            self.empties += 1
        alt = sample["pos"][1]
        speed = math.hypot(*sample["vel"])
        self.spray_ms += dt * 1000
        if ENV_ALT[0] <= alt <= ENV_ALT[1] and speed <= ENV_SPEED:
            self.good_ms += dt * 1000
        # Landing point: pushed downwind for the time it takes to fall (about alt / 4 m/s).
        cx, cz = sample["pos"][0], sample["pos"][2]
        if wind:
            fall = (alt / 4) * wind["speed"]
            cx += math.sin(wind["dir"] * DEG) * fall
            cz -= math.cos(wind["dir"] * DEG) * fall
        rr = swath_width(alt) / 2 + c * 0.35
        i0 = math.floor((cx - rr - f["min"][0]) / c)
        i1 = math.floor((cx + rr - f["min"][0]) / c)
        j0 = math.floor((cz - rr - f["min"][1]) / c)
        j1 = math.floor((cz + rr - f["min"][1]) / c)
        hit = [  # every cell centre under the circle, including cells outside the field
            (i, j)
            for i in range(i0, i1 + 1)
            for j in range(j0, j1 + 1)
            if math.hypot(f["min"][0] + (i + 0.5) * c - cx, f["min"][1] + (j + 0.5) * c - cz) <= rr
        ]
        self.total += amount
        if not hit:
            self.outside += amount
            return
        share = amount / len(hit)
        for i, j in hit:
            if i < 0 or j < 0 or i >= self.nx or j >= self.nz:
                self.outside += share
            elif self.kind[i * self.nz + j] == 1:
                self.no_spray_dose += share
            else:
                k = i * self.nz + j
                self.dose[k] = f32(self.dose[k] + share)

    def summary(self) -> dict:
        area = self.cell * self.cell
        lo, hi = self.m["dose"]["lo"] * area, self.m["dose"]["hi"] * area
        good, excess = 0, 0.0
        for i, d in enumerate(self.dose):
            if self.kind[i] == 1:
                continue
            if lo <= d <= hi:
                good += 1
            if d > hi:
                excess += d - hi
        wasted = self.outside + self.no_spray_dose + excess
        return {
            "coverage": good / self.targets if self.targets else 0,
            "waste": min(1, wasted / self.total) if self.total > 0 else 1,
            "envelope": self.good_ms / self.spray_ms if self.spray_ms > 0 else 0,
            "total": self.total,
        }


def apply_entry(a: Agri, entry: dict, wind: dict | None) -> None:
    """Feeds one log entry to the spray model: samples spray, a refill near home fills the tank."""
    if entry["type"] == "refill":
        pos = entry["pose"]["pos"]
        if math.hypot(pos[0], pos[2]) <= HOME_R + 2:
            a.refill()
    elif entry["type"] == "sample":
        a.spray_step(entry, wind)


def replay_agri(config: dict, log: list[dict]) -> Agri:
    """Runs the spray model over a stored log. The run's wind event wins over the config."""
    a = Agri(config["mission"])
    wind = next((e["wind"] for e in log if e["type"] == "wind"), config.get("wind"))
    for e in log:
        apply_entry(a, e, wind)
    return a
