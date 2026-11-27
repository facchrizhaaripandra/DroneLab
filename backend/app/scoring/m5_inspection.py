"""M5: building and bridge inspection, with the inspection report."""

import math

from app.scoring.base import Scorer, ScoringContext, is_number, register, sort_log, visible_of
from app.scoring.camera import project
from app.scoring.jsmath import clamp01, js_num, js_round

MARK_RANGE = 10  # m, how close a defect must be to count
PANEL_RANGE = 12  # m
NEAR = 15  # m from the surface: samples inside this count for the safe distance


def severity_of(defect: dict) -> str:
    if defect["size"] >= 1.5:
        return "berat"
    return "sedang" if defect["size"] >= 0.8 else "ringan"


def _seen_defects(event: dict) -> list[dict]:
    return [
        v
        for v in visible_of(event)
        if v["label"] == "defect" and is_number(v.get("dist")) and v["dist"] <= MARK_RANGE
    ]


def inspection_state(config: dict, log: list[dict]) -> dict:
    """Which defects were photographed or marked, which panels were photographed."""
    panels_all = config["mission"]["panels"]
    photographed, marked, panels = {}, set(), set()
    wrong, marks, quality_sum, quality_n = 0, 0, 0.0, 0
    for e in log:
        if e["type"] == "photo":
            pos = e["pose"]["pos"]
            for p in panels_all:
                pr = project(e["pose"], {"x": p["x"], "y": p["y"], "z": p["z"], "hx": 1, "hy": 1})
                facing = (pos[0] - p["x"]) * p["nx"] + (pos[2] - p["z"]) * p["nz"] > 0
                if (
                    pr
                    and pr["dist"] <= PANEL_RANGE
                    and facing
                    and 0 <= pr["center"][0] <= 1
                    and 0 <= pr["center"][1] <= 1
                ):
                    panels.add(p["id"])
            speed = e.get("speed") if is_number(e.get("speed")) else 0
            yaw_rate = abs(e["yaw_rate"]) if is_number(e.get("yaw_rate")) else 0
            for v in _seen_defects(e):
                photographed.setdefault(v.get("id"), e["t_ms"])
                sharp = min(
                    1 if speed <= 0.5 else clamp01(1 - (speed - 0.5) / 2.5),
                    1 if yaw_rate <= 10 else clamp01(1 - (yaw_rate - 10) / 50),
                )
                area = v.get("area") if is_number(v.get("area")) else 0
                quality_sum += 0.5 * sharp + 0.5 * clamp01(area / 0.003)
                quality_n += 1
        elif e["type"] == "mark":
            marks += 1
            seen = _seen_defects(e)
            if seen:
                marked.update(v.get("id") for v in seen)
            else:
                wrong += 1
    return {
        "photographed": photographed,
        "marked": marked,
        "panels": panels,
        "wrong": wrong,
        "marks": marks,
        "quality": quality_sum / quality_n if quality_n else 0,
    }


def _report(config: dict, state: dict) -> dict:
    m = config["mission"]
    defects = []
    for d in m["defects"]:
        item = {"id": d["id"], "pos": [d["x"], d["y"], d["z"]], "severity": severity_of(d)}
        item.update({k: d[k] for k in ("kind", "face") if k in d})
        taken = state["photographed"].get(d["id"])
        item["photographed"] = taken is not None
        item["marked"] = d["id"] in state["marked"]
        item["photo"] = None if taken is None else f"t={js_num(taken)}"
        defects.append(item)
    total = len(m["panels"])
    return {
        "defects": defects,
        "coverage": len(state["panels"]) / total if total else 0,
        "panels": {"covered": len(state["panels"]), "total": total},
        "wrong_marks": state["wrong"],
    }


def inspection_report(config: dict, log: list[dict]) -> dict:
    return _report(config, inspection_state(config, sort_log(log)))


@register
class InspectionScorer(Scorer):
    key = "inspection"
    weight_keys = ("facade", "defects", "distance", "quality", "report")
    progress_events = frozenset({"photo", "mark"})

    def score(self, ctx: ScoringContext) -> dict:
        m = ctx.config["mission"]
        state = inspection_state(ctx.config, ctx.log)
        s = m["structure"]
        n = len(m["defects"])
        photographed, marked = state["photographed"], state["marked"]
        found = sum(1 for d in m["defects"] if d["id"] in photographed and d["id"] in marked)
        total_panels = len(m["panels"])
        ctx.add(
            "facade",
            "Cakupan fasad",
            len(state["panels"]) / total_panels if total_panels else 0,
            f"{len(state['panels'])} dari {total_panels} panel terfoto",
        )
        ctx.add(
            "defects",
            "Cacat ditemukan",
            found / n - state["wrong"] * 0.1 if n else 0,
            f"{found} dari {n} cacat difoto dan ditandai, {state['wrong']} tanda salah",
        )
        # Safe distance: share of the time near the structure spent 3..8 m from its surface.
        near = safe = 0
        for e in ctx.log:
            if e["type"] != "sample" or e["pos"][1] < 0.5:
                continue
            x, y, z = e["pos"]
            dx = max(s["x"] - s["w"] / 2 - x, 0, x - (s["x"] + s["w"] / 2))
            dy = max(s["y0"] - y, 0, y - s["y1"])
            dz = max(s["z"] - s["d"] / 2 - z, 0, z - (s["z"] + s["d"] / 2))
            d = math.hypot(dx, dy, dz)
            if d > NEAR:
                continue
            near += 1
            if m["safe"]["min"] <= d <= m["safe"]["max"]:
                safe += 1
        share = js_round((safe / near) * 100) if near else 0
        ctx.add(
            "distance",
            "Jarak aman",
            safe / near if near else 0,
            f"{share}% waktu dekat struktur di jarak "
            f"{js_num(m['safe']['min'])}-{js_num(m['safe']['max'])} m",
        )
        ctx.add(
            "quality",
            "Kualitas foto",
            state["quality"],
            "rata-rata ketajaman dan ukuran cacat di bingkai",
        )
        # Report: each defect needs a position (marked), a photo and a severity.
        done = 0
        for d in m["defects"]:
            mk, ph = d["id"] in marked, d["id"] in photographed
            done += mk + ph + (mk or ph)
        ctx.add(
            "report",
            "Kelengkapan laporan",
            done / (3 * n) if n else 0,
            "tiap cacat: posisi, foto, tingkat keparahan",
        )
        return {"found": found, "total": n, "report": _report(ctx.config, state)}

    def objectives_met(self, config: dict, log: list[dict]) -> bool:
        m = config["mission"]
        state = inspection_state(config, sort_log(log))
        return len(state["panels"]) == len(m["panels"]) and all(
            d["id"] in state["photographed"] and d["id"] in state["marked"] for d in m["defects"]
        )
