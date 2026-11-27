"""M1: search and rescue."""

import math

from app.scoring.base import (
    Scorer,
    ScoringContext,
    register,
    time_factor,
    visible_of,
    zone_ms,
)
from app.scoring.jsmath import js_fixed, js_num

CELL = 10  # m, size of one coverage cell


def marked_victim(config: dict, event: dict) -> dict | None:
    """The victim a mark counts for: in the camera frame and within the mark radius."""
    m = config["mission"]
    seen = [v.get("id") for v in visible_of(event) if v["label"] == "person"]
    pos = event["pose"]["pos"]
    radius = m.get("markRadius") or 5
    for v in m["victims"]:
        if v["id"] in seen and math.hypot(v["x"] - pos[0], v["z"] - pos[2]) <= radius:
            return v
    return None


def _found(config: dict, log: list[dict]) -> tuple[set, int, int]:
    found, marks, wrong = set(), 0, 0
    for e in log:
        if e["type"] != "mark":
            continue
        marks += 1
        victim = marked_victim(config, e)
        if victim:
            found.add(victim["id"])
        else:
            wrong += 1
    return found, marks, wrong


@register
class SarScorer(Scorer):
    key = "sar"
    weight_keys = ("found", "time", "coverage", "safety", "precision")
    progress_events = frozenset({"mark"})

    def score(self, ctx: ScoringContext) -> dict:
        m, fin, log = ctx.config["mission"], ctx.finish, ctx.log
        found, marks, wrong = _found(ctx.config, log)
        total = len(m["victims"])
        ratio = len(found) / total if total else 0
        # Coverage: area cells the drone flew over while airborne.
        area = m["area"]
        nx = math.ceil((area["max"][0] - area["min"][0]) / CELL)
        nz = math.ceil((area["max"][1] - area["min"][1]) / CELL)
        seen = set()
        for s in log:
            if s["type"] != "sample":
                continue
            x, y, z = s["pos"]
            inside = area["min"][0] <= x <= area["max"][0] and area["min"][1] <= z <= area["max"][1]
            if y < 0.5 or not inside:
                continue
            seen.add(
                math.floor((x - area["min"][0]) / CELL) * nz
                + math.floor((z - area["min"][1]) / CELL)
            )
        collisions = sum(1 for e in log if e["type"] == "collision")
        fire_s = zone_ms(log, "fire", fin["t_ms"]) / 1000
        ctx.add("found", "Korban ditemukan", ratio, f"{len(found)} dari {total} korban")
        # Time only counts for what was found: landing at once must not earn free points.
        ctx.add(
            "time",
            "Waktu",
            time_factor(fin["t_ms"], ctx.par_time_s) * ratio,
            f"acuan {js_num(ctx.par_time_s)} s",
        )
        ctx.add(
            "coverage",
            "Cakupan area",
            len(seen) / (nx * nz),
            f"{len(seen)} dari {nx * nz} sel dilewati",
        )
        ctx.add(
            "safety",
            "Keselamatan",
            1 - (collisions * 0.2 + (fire_s / 10) * 0.2),
            f"{collisions} tabrakan, {js_fixed(fire_s, 1)} s di zona api",
        )
        ctx.add(
            "precision",
            "Presisi",
            1 - wrong / marks if marks else 0,
            f"{wrong} dari {marks} tanda salah",
        )
        return {"found": len(found), "total": total, "marks": marks, "wrong": wrong}

    def objectives_met(self, config: dict, log: list[dict]) -> bool:
        found, _, _ = _found(config, log)
        return len(found) == len(config["mission"]["victims"])
