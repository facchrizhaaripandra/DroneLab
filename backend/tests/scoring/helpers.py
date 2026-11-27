"""Small builders for hand-calculated scoring cases."""

import json
from pathlib import Path

from app.scoring import score_run

WORLDS = Path(__file__).resolve().parents[2] / "worlds"


def mission(mission_id: str) -> dict:
    missions = json.loads((WORLDS / "missions.json").read_text(encoding="utf-8"))
    return next(m for m in missions if m["id"] == mission_id)


def event(t_ms, type_, pos=(0, 0, 0), yaw=0.0, pitch=0.0, roll=0.0, **extra) -> dict:
    pose = {"pos": list(pos), "yaw": yaw, "pitch": pitch, "roll": roll}
    return {"t_ms": t_ms, "type": type_, "pose": pose, **extra}


def sample(t_ms, pos, vel=(0, 0, 0), **extra) -> dict:
    return {"t_ms": t_ms, "type": "sample", "pos": list(pos), "vel": list(vel), **extra}


def finish(t_ms, battery=80, reason="completed") -> dict:
    return {"t_ms": t_ms, "battery": battery, "reason": reason}


def run(mission_id: str, config: dict, log: list, fin: dict) -> dict:
    return score_run(mission(mission_id), config, log, fin)


def points(result: dict) -> dict:
    return {row["name"]: row["points"] for row in result["breakdown"]}
