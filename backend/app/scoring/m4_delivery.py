"""M4: parcel delivery."""

import math

from app.scoring.base import Scorer, ScoringContext, register, time_factor, zone_ms
from app.scoring.jsmath import js_fixed, js_num, js_round


@register
class DeliveryScorer(Scorer):
    key = "delivery"
    weight_keys = ("accuracy", "cargo", "time", "battery", "zones")
    progress_events = frozenset({"drop"})

    def score(self, ctx: ScoringContext) -> dict:
        m, fin = ctx.config["mission"], ctx.finish
        completed = fin["reason"] == "completed"
        collisions = sum(1 for e in ctx.log if e["type"] == "collision")
        drop = next((e for e in ctx.log if e["type"] == "drop"), None)
        dist = math.inf
        if drop:
            pos = drop["pose"]["pos"]
            dist = math.hypot(pos[0] - m["drop"]["x"], pos[2] - m["drop"]["z"])
        no_fly_ms = zone_ms(ctx.log, "nofly", fin["t_ms"])
        half = 1 if drop else 0.5  # without a delivery the other components are halved
        ctx.add(
            "accuracy",
            "Ketepatan",
            1 - (dist - 1) / 7 if drop else 0,
            f"jatuh {js_fixed(dist, 1)} m dari pusat zona" if drop else "paket belum dijatuhkan",
        )
        ctx.add("cargo", "Kondisi barang", (1 - collisions / 3) * half, f"{collisions} tabrakan")
        ctx.add(
            "time",
            "Waktu",
            time_factor(fin["t_ms"], ctx.par_time_s) if drop else 0,
            f"acuan {js_num(ctx.par_time_s)} s",
        )
        ctx.add(
            "battery",
            "Baterai tersisa",
            min(1, fin["battery"] / 60) * half,
            f"{js_round(fin['battery'])}% tersisa",
        )
        ctx.add(
            "zones",
            "Kepatuhan zona",
            (1 - no_fly_ms / 5000) * half,
            f"{js_fixed(no_fly_ms / 1000, 1)} s di zona terlarang",
        )
        return {"completed": completed}

    def objectives_met(self, config: dict, log: list[dict]) -> bool:
        return any(e.get("type") == "drop" for e in log)
