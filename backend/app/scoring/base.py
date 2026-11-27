"""Scorer interface and the part of scoring shared by every mission (mirrors scoreFromEvents).

A score is deterministic: it depends only on the mission definition, the world config,
the stored log and the finish record. No randomness and no clock.
"""

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import ClassVar

from app.scoring.jsmath import clamp01, js_round, round1


@dataclass
class ScoringContext:
    config: dict
    log: list[dict]
    finish: dict
    par_time_s: float
    weights: dict
    gugur: list[str]
    comp: list[dict] = field(default_factory=list)

    def w(self, key: str) -> float:
        return self.weights[key]

    def add(self, key: str, name: str, factor: float, note: str) -> None:
        points = round1(self.w(key) * clamp01(factor))
        self.comp.append(
            {"key": key, "name": name, "points": points, "max": self.w(key), "note": note}
        )


class ObjectiveTracker:
    """Follows a run entry by entry and answers "are the mission goals reached?"."""

    def __init__(self, scorer: "Scorer", config: dict):
        self.scorer, self.config, self.log = scorer, config, []
        self.met = False

    def feed(self, entry: dict) -> None:
        # The goals depend only on the progress events, so the thousands of samples are not kept.
        if not self.met and entry["type"] in self.scorer.progress_events:
            self.log.append(entry)
            self.met = self.scorer.objectives_met(self.config, self.log)


class Scorer(ABC):
    key: ClassVar[str]
    weight_keys: ClassVar[tuple[str, ...]]  # every weight score() reads
    progress_events: ClassVar[frozenset[str]] = frozenset()  # events that can complete the goals

    @abstractmethod
    def score(self, ctx: ScoringContext) -> dict:
        """Adds the score components to ctx and returns extra result fields."""

    @abstractmethod
    def objectives_met(self, config: dict, log: list[dict]) -> bool:
        """True when the mission goals are reached (used by the mission state machine)."""

    def tracker(self, config: dict) -> ObjectiveTracker:
        return ObjectiveTracker(self, config)


SCORERS: dict[str, Scorer] = {}


def register(cls: type[Scorer]) -> type[Scorer]:
    SCORERS[cls.key] = cls()
    return cls


def is_number(v) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)


def _vector(v) -> bool:
    return isinstance(v, list | tuple) and len(v) == 3 and all(is_number(x) for x in v)


def is_usable(entry: dict) -> bool:
    """False for entries a scorer could not read. They are ignored, never an error."""
    if not isinstance(entry, dict) or not is_number(entry.get("t_ms")):
        return False
    kind = entry.get("type")
    if not isinstance(kind, str):
        return False
    if kind == "sample":
        return _vector(entry.get("pos")) and _vector(entry.get("vel"))
    if kind == "wind":
        wind = entry.get("wind")
        return (
            isinstance(wind, dict) and is_number(wind.get("speed")) and is_number(wind.get("dir"))
        )
    if kind in ("photo", "mark", "drop", "refill"):
        pose = entry.get("pose")
        if not isinstance(pose, dict) or not _vector(pose.get("pos")):
            return False
        if kind in ("photo", "mark"):
            return is_number(pose.get("yaw")) and is_number(pose.get("pitch"))
    return True


def visible_of(event: dict) -> list[dict]:
    """The objects a photo or mark saw. Malformed items are skipped."""
    items = event.get("visible")
    if not isinstance(items, list):
        return []
    return [v for v in items if isinstance(v, dict) and "label" in v]


def sort_log(log: list[dict]) -> list[dict]:
    """By time; at the same time events come before samples; otherwise arrival order."""
    usable = (e for e in log if is_usable(e))
    return sorted(usable, key=lambda e: (e["t_ms"], e["type"] == "sample"))


def time_factor(t_ms: float, par_s: float) -> float:
    """1 at par time, 0 at twice the par time."""
    return clamp01(2 - t_ms / 1000 / par_s)


def zone_ms(log: list[dict], kind: str, fin_ms: float) -> float:
    """Time inside zones of one kind. An interval still open ends at the finish."""
    ms, since = 0.0, -1.0
    for e in log:
        if e.get("kind") != kind:
            continue
        if e["type"] == "zone_enter":
            since = e["t_ms"]
        elif e["type"] == "zone_exit" and since >= 0:
            ms += e["t_ms"] - since
            since = -1.0
    return ms + fin_ms - since if since >= 0 else ms


def grade_of(score: float) -> str:
    if score >= 85:
        return "gold"
    if score >= 70:
        return "silver"
    return "bronze" if score >= 50 else "none"


def score_run(mission: dict, config: dict, log: list[dict], finish: dict) -> dict:
    """Scores one run. `mission` is a definition from worlds/missions.json."""
    ctx = ScoringContext(
        config=config,
        log=sort_log(log),
        finish=finish,
        par_time_s=mission["par_time_s"],
        weights={**mission["weights"], **(config.get("weights") or {})},
        gugur=mission.get("gugur") or [],
    )
    extra = SCORERS[mission["scorer"]].score(ctx) or {}
    # "Gugur": the run did not end as completed, so these components are cut in half.
    if finish["reason"] != "completed":
        for c in ctx.comp:
            if c["key"] in ctx.gugur:
                c["points"] = round1(c["points"] / 2)
                c["note"] += " (gugur: dipotong 50%)"
    total = js_round(sum(c["points"] for c in ctx.comp))
    breakdown = [{k: c[k] for k in ("name", "points", "max", "note")} for c in ctx.comp]
    return {"score": total, "grade": grade_of(total), "breakdown": breakdown, **extra}
