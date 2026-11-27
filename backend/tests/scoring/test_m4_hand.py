"""M4 delivery, calculated by hand.

Weights: accuracy 30, cargo 20, time 20, battery 15, zones 15. Par time 180 s.
  accuracy = 1 - (drop distance - 1) / 7        cargo   = 1 - collisions / 3
  time     = 2 - seconds / 180 (only if dropped) battery = min(1, battery / 60)
  zones    = 1 - ms in no-fly / 5000
Without a drop, cargo, battery and zones are halved. The total is rounded half up.
Base run: drop at the centre, 100 s, battery 80, no collision -> 30+20+20+15+15 = 100.
"""

import pytest
from helpers import event, finish, points, run

CONFIG = {"mission": {"pickup": {"x": 0, "z": 0, "r": 3}, "drop": {"x": 50, "z": 0, "r": 4}}}


def drop(distance=0.0, t=99_000):
    return event(t, "drop", pos=(50 + distance, 2, 0))


def collisions(n):
    return [event(1000 + i, "collision") for i in range(n)]


NOFLY = [event(1000, "zone_enter", kind="nofly"), event(3500, "zone_exit", kind="nofly")]

CASES = [
    # name, log, finish, expected score
    ("base", [drop()], finish(100_000), 100),
    # accuracy 1 - 3.5/7 = 0.5 -> 15; 15+20+20+15+15 = 85
    ("drop 4.5 m", [drop(4.5)], finish(100_000), 85),
    # accuracy 1 - 7/7 = 0; 70
    ("drop 8 m", [drop(8)], finish(100_000), 70),
    # time 2 - 270/180 = 0.5 -> 10; 90
    ("270 s", [drop()], finish(270_000), 90),
    # time 0; 80
    ("360 s", [drop()], finish(360_000), 80),
    # battery 30/60 = 0.5 -> 7.5; 92.5 -> 93
    ("battery 30", [drop()], finish(100_000, battery=30), 93),
    # cargo 2/3 -> 13.3; 93.3 -> 93
    ("1 collision", [drop(), *collisions(1)], finish(100_000), 93),
    # cargo 0; 80
    ("3 collisions", [drop(), *collisions(3)], finish(100_000), 80),
    # zones 1 - 2500/5000 = 0.5 -> 7.5; 92.5 -> 93
    ("2.5 s in no-fly", [drop(), *NOFLY], finish(100_000), 93),
    # no drop: accuracy 0, cargo 20*0.5=10, time 0, battery 7.5, zones 7.5 -> 25
    ("no delivery, battery empty", [], finish(100_000, battery=60, reason="battery"), 25),
]


@pytest.mark.parametrize(("name", "log", "fin", "score"), CASES, ids=[c[0] for c in CASES])
def test_m4_hand(name, log, fin, score):
    assert run("m4_delivery", CONFIG, log, fin)["score"] == score


def test_grades_and_breakdown():
    gold = run("m4_delivery", CONFIG, [drop()], finish(100_000))
    assert gold["grade"] == "gold" and gold["completed"] is True
    assert [row["max"] for row in gold["breakdown"]] == [30, 20, 20, 15, 15]
    assert points(gold)["Ketepatan"] == 30
    assert run("m4_delivery", CONFIG, [], finish(1, 60, "battery"))["grade"] == "none"


def test_entry_order_does_not_change_the_score():
    log = [drop(), *collisions(2), *NOFLY]
    a = run("m4_delivery", CONFIG, log, finish(100_000))
    b = run("m4_delivery", CONFIG, list(reversed(log)), finish(100_000))
    assert a == b


def test_broken_entries_are_ignored_instead_of_crashing():
    broken = [
        {"t_ms": 5, "type": "drop"},  # no pose
        {"t_ms": 6, "type": "drop", "pose": {"pos": [1, 2]}},  # pose too short
        {"t_ms": "7", "type": "collision"},  # t_ms is not a number
        {"type": "collision"},
    ]
    result = run("m4_delivery", CONFIG, broken, finish(100_000, 60, "battery"))
    assert result["score"] == 25
