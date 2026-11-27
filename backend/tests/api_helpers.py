"""Shared steps for tests that talk to the gateway like the simulator does."""

import json
from pathlib import Path

WORLDS = Path(__file__).resolve().parents[1] / "worlds"


def world_file(mission_id: str, variant: str) -> dict:
    return json.loads((WORLDS / f"{mission_id}__{variant}.json").read_text(encoding="utf-8"))


def start(client, mission_id="m4_delivery", variant=None, player="tes") -> dict:
    body = {"mission_id": mission_id, "player": player}
    if variant:
        body["variant"] = variant
    r = client.post("/api/v1/runs", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def send_event(client, run_id: str, event: dict):
    return client.post(f"/api/v1/runs/{run_id}/events", json=event)


def finish(client, run_id: str, t_ms=90_000, battery=80, reason="completed") -> dict:
    body = {"t_ms": t_ms, "battery": battery, "reason": reason}
    r = client.post(f"/api/v1/runs/{run_id}/finish", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _pose(point: dict) -> dict:
    return {"pos": [point["x"], 1.5, point["z"]], "yaw": 0, "pitch": -10, "roll": 0}


def delivery_events(config: dict) -> list[dict]:
    m = config["mission"]
    return [
        {"t_ms": 0, "type": "takeoff", "pose": _pose({"x": 0, "z": 0})},
        {"t_ms": 40_000, "type": "pickup", "pose": _pose(m["pickup"])},
        {"t_ms": 90_000, "type": "drop", "pose": _pose(m["drop"])},
    ]


def frame(t_ms, pos, vel=(0, 0, 0), **extra) -> dict:
    """A telemetry frame exactly as src/main.js sends it."""
    base = {
        "t_ms": t_ms,
        "pos": list(pos),
        "vel": list(vel),
        "yaw": 90,
        "roll": 0,
        "pitch": 0,
        "gimbal": -10,
        "battery": 80,
        "payload_kg": 0,
        "spraying": False,
        "collision": False,
    }
    return {**base, **extra}
