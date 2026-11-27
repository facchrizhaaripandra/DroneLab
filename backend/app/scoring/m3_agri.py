"""M3: spraying and fertilising."""

from app.scoring.agri import Agri, apply_entry, replay_agri
from app.scoring.base import Scorer, ScoringContext, register, sort_log, time_factor
from app.scoring.jsmath import clamp01, js_round

COVERAGE_GOAL = 0.9


class AgriTracker:
    """One spray model fed once per entry, so a long flight is not replayed on every event."""

    def __init__(self, config: dict):
        self.agri, self.wind = Agri(config["mission"]), config.get("wind")
        self.met = False

    def feed(self, entry: dict) -> None:
        if entry["type"] == "wind":
            self.wind = entry["wind"]
        apply_entry(self.agri, entry, self.wind)
        if not self.met and entry["type"] in ("spray", "refill"):
            self.met = self.agri.summary()["coverage"] >= COVERAGE_GOAL


@register
class AgriScorer(Scorer):
    key = "agri"
    weight_keys = ("coverage", "waste", "efficiency", "envelope", "tank")

    def score(self, ctx: ScoringContext) -> dict:
        a = replay_agri(ctx.config, ctx.log)
        s, fin = a.summary(), ctx.finish
        ctx.add(
            "coverage",
            "Cakupan",
            s["coverage"],
            f"{js_round(s['coverage'] * 100)}% sel lahan dosisnya tepat",
        )
        ctx.add(
            "waste",
            "Pemborosan",
            0 if s["waste"] >= 1 else 1 - s["waste"],
            f"{js_round(s['waste'] * 100)}% dosis terbuang (luar lahan, zona terlarang, berlebih)",
        )
        # Efficiency only counts in proportion to the work done.
        effort = 0.5 * time_factor(fin["t_ms"], ctx.par_time_s) + 0.5 * clamp01(fin["battery"] / 40)
        ctx.add(
            "efficiency",
            "Efisiensi",
            effort * s["coverage"],
            "waktu dan baterai terhadap acuan",
        )
        ctx.add(
            "envelope",
            "Ketinggian dan kecepatan",
            s["envelope"],
            f"{js_round(s['envelope'] * 100)}% waktu semprot dalam 3-8 m dan ≤ 4 m/s",
        )
        ctx.add(
            "tank",
            "Manajemen tangki",
            1 - 0.5 * a.empties if a.total > 0 else 0,
            f"{a.empties} kali tangki kosong, {a.refills} kali isi ulang di H",
        )
        return {"coverage": s["coverage"], "empties": a.empties, "refills": a.refills}

    def objectives_met(self, config: dict, log: list[dict]) -> bool:
        return replay_agri(config, sort_log(log)).summary()["coverage"] >= COVERAGE_GOAL

    def tracker(self, config: dict) -> AgriTracker:
        return AgriTracker(config)
