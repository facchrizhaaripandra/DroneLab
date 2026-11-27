"""Mission state machine: siap -> lepas_landas -> menjalankan -> kembali -> mendarat | gagal."""

import pytest

from app.mission.engine import MissionEngine, run_engine

LIMITS = {"minX": -100, "maxX": 100, "minZ": -100, "maxZ": 100}
CONFIG = {"mission": {"pickup": {"x": 0, "z": 0, "r": 3}, "drop": {"x": 50, "z": 0, "r": 4}}}
PAR = 180


def takeoff(t=0):
    return {"t_ms": t, "type": "takeoff"}


def at(t, x=0.0, y=0.0, z=0.0):
    return {"t_ms": t, "type": "sample", "pos": [x, y, z], "vel": [0, 0, 0]}


def drop(t=3000):
    return {"t_ms": t, "type": "drop", "pose": {"pos": [50, 2, 0]}}


def fin(t=5000, reason="completed"):
    return {"t_ms": t, "battery": 80, "reason": reason}


def engine(log=(), finish=None, config=CONFIG, key="delivery"):
    return run_engine(key, PAR, config, LIMITS, list(log), finish)


def states(e):
    return [t["state"] for t in e.transitions]


FLIGHT = [takeoff(), at(0, y=0), at(1000, y=1.0), at(2000, y=2.0)]


def test_full_delivery_run_visits_every_state():
    e = engine([*FLIGHT, drop()], fin())
    assert states(e) == ["siap", "lepas_landas", "menjalankan", "kembali", "mendarat"]
    assert (e.state, e.reason) == ("mendarat", "completed")
    assert [t["t_ms"] for t in e.transitions] == [0, 0, 2000, 3000, 5000]


def test_running_starts_two_metres_above_the_first_sample():
    e = engine([takeoff(), at(0, y=7.0), at(100, y=8.9)])
    assert e.state == "lepas_landas"
    e.feed(at(200, y=9.0))
    assert e.state == "menjalankan"


def test_without_takeoff_the_run_stays_ready():
    assert engine([at(0, y=0), at(100, y=5)]).state == "siap"


def test_ending_early_lands_straight_from_running():
    e = engine(FLIGHT, fin())
    assert states(e) == ["siap", "lepas_landas", "menjalankan", "mendarat"]


@pytest.mark.parametrize("reason", ["timeout", "battery", "crashed", "drowned", "out_of_area"])
def test_failure_reasons_end_in_gagal(reason):
    e = engine(FLIGHT, fin(reason=reason))
    assert (e.state, e.reason) == ("gagal", reason)


def test_completed_after_twice_par_becomes_timeout():
    assert engine(FLIGHT, fin(t=2 * PAR * 1000 + 1000)).reason == "completed"
    late = engine(FLIGHT, fin(t=2 * PAR * 1000 + 1001))
    assert (late.state, late.reason) == ("gagal", "timeout")


def test_leaving_the_map_by_more_than_a_metre_fails_the_run():
    assert engine([*FLIGHT, at(2500, x=101.0, y=3)], fin()).reason == "completed"
    out = engine([*FLIGHT, at(2500, x=101.01, y=3)], fin())
    assert (out.state, out.reason) == ("gagal", "out_of_area")
    assert engine([*FLIGHT, at(2500, z=-101.5, y=3)], fin()).reason == "out_of_area"


def test_a_failure_reason_from_the_simulator_is_kept():
    e = engine([*FLIGHT, at(2500, x=500, y=3)], fin(reason="crashed"))
    assert e.reason == "crashed"


def test_collisions_alone_do_not_fail_the_mission():
    hits = [{"t_ms": 2100 + i, "type": "collision"} for i in range(20)]
    assert engine([*FLIGHT, *hits], fin()).state == "mendarat"


def test_nothing_changes_after_the_end():
    e = engine(FLIGHT, fin(reason="crashed"))
    before = list(e.transitions)
    e.feed(drop(9000))
    assert e.finish(fin(9000)) == "crashed"
    assert (e.state, e.transitions) == ("gagal", before)


def test_broken_entries_are_ignored():
    e = MissionEngine("delivery", PAR, CONFIG, LIMITS)
    e.feed({"type": "sample"})
    e.feed({"t_ms": 1, "type": "sample", "pos": [1]})
    assert e.state == "siap"


def test_spray_mission_returns_once_the_field_is_covered():
    config = {
        "mission": {
            "field": {"min": [0, 0], "max": [4, 2], "cell": 2},
            "noSpray": [],
            "dose": {"lo": 0.4, "hi": 1.2, "flow": 10, "capacity": 200},
        }
    }
    spraying = [
        {
            "t_ms": 2000 + i * 100,
            "type": "sample",
            "pos": [2, 5, 1],
            "vel": [0, 0, 0],
            "spraying": True,
        }
        for i in range(19)
    ]
    off = {"t_ms": 4000, "type": "spray", "on": False}
    e = engine([*FLIGHT, *spraying, off], config=config, key="agri")
    assert e.state == "kembali"
    assert e.transitions[-1]["t_ms"] == 4000
