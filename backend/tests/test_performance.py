"""The simulator gives up on /finish after 1.5 s: a long flight must be scored well within that."""

import time

import pytest
from api_helpers import finish, start


def long_flight(config: dict) -> list[dict]:
    """Ten minutes of telemetry at 10 Hz and 200 camera or spray actions."""
    m = config["mission"]
    spot = (m.get("panels") or m.get("victims") or [{"x": 0, "z": 0}])[0]
    log = [{"t_ms": 0, "type": "takeoff"}]
    for i in range(6000):
        log.append(
            {
                "t_ms": i * 100,
                "type": "sample",
                "pos": [spot["x"] + (i % 50) * 0.2, 5, spot["z"] + 5],
                "vel": [1, 0, 0],
                "yaw": 0,
                "spraying": True,
            }
        )
    pose = {"pos": [spot["x"], 5, spot["z"] + 5], "yaw": 0, "pitch": 0, "roll": 0}
    for i in range(200):
        kind = ("photo", "mark", "spray", "record_start", "record_stop")[i % 5]
        log.append({"t_ms": i * 3000, "type": kind, "pose": pose, "visible": []})
    return log


@pytest.mark.parametrize(
    ("mission_id", "variant"),
    [
        ("m1_sar", "gedung"),
        ("m2_foto", "hotel"),
        ("m3_agri", "sawah"),
        ("m5_inspeksi", "gedung"),
    ],
)
def test_a_ten_minute_flight_is_scored_within_the_client_limit(client, mission_id, variant):
    run = start(client, mission_id, variant)
    client.app.state.repo.add_entries(run["run_id"], long_flight(run["config"]))
    before = time.perf_counter()
    finish(client, run["run_id"], t_ms=599_900)
    assert time.perf_counter() - before < 1.0
