"""M1 search and rescue, calculated by hand.

Weights: found 40, time 20, coverage 15, safety 15, precision 10. Par time 300 s.
  found     = victims marked / victims
  time      = (2 - seconds / 300) * found ratio
  coverage  = 10 m cells flown over (height >= 0.5 m) / cells in the area
  safety    = 1 - (collisions * 0.2 + seconds in fire / 10 * 0.2)
  precision = 1 - wrong marks / marks (0 without marks)
A run that does not end as completed halves time and coverage.
World: area -20..20 (4 x 4 = 16 cells), 2 victims.
Base run: both marked with 2 marks, 200 s, all 16 cells, no hazard -> 100.
"""

import pytest
from helpers import event, finish, run, sample

CONFIG = {
    "mission": {
        "area": {"min": [-20, -20], "max": [20, 20]},
        "victims": [{"id": 1, "x": -10, "z": -10}, {"id": 2, "x": 10, "z": 10}],
        "markRadius": 5,
    }
}


def mark(t, x, z, seen):
    visible = [{"label": "person", "id": seen}] if seen else []
    return event(t, "mark", pos=(x, 3, z), visible=visible)


def cells(n, height=3.0):
    """One sample in the middle of each of the first n cells."""
    middles = [-15, -5, 5, 15]
    spots = [(x, z) for x in middles for z in middles]
    return [sample(100 + i, (x, height, z)) for i, (x, z) in enumerate(spots[:n])]


BOTH = [mark(1000, -10, -10, 1), mark(2000, 10, 10, 2)]
WRONG = mark(3000, 0, 0, None)
HITS = [event(4000, "collision"), event(4100, "collision")]
FIRE = [event(5000, "zone_enter", kind="fire"), event(15000, "zone_exit", kind="fire")]

CASES = [
    ("base", [*BOTH, *cells(16)], finish(200_000), 100),
    # found .5 -> 20; time 1 * .5 -> 10; 15 + 15 + 10 -> 70
    ("one of two victims", [BOTH[0], *cells(16)], finish(200_000), 70),
    # found 0, time 0, precision 0 -> 15 + 15
    ("no marks", cells(16), finish(200_000), 30),
    # precision 1 - 1/3 -> 6.7; 96.7 -> 97
    ("one wrong mark", [*BOTH, WRONG, *cells(16)], finish(200_000), 97),
    # coverage .5 -> 7.5; 92.5 -> 93
    ("half the cells", [*BOTH, *cells(8)], finish(200_000), 93),
    # safety .6 -> 9; 94
    ("two collisions", [*BOTH, *cells(16), *HITS], finish(200_000), 94),
    # safety .8 -> 12; 97
    ("10 s in fire", [*BOTH, *cells(16), *FIRE], finish(200_000), 97),
    # time 2 - 450/300 = .5 -> 10; 90
    ("450 s", [*BOTH, *cells(16)], finish(450_000), 90),
    # coverage 0 -> 85
    ("flying below 0.5 m", [*BOTH, *cells(16, height=0.4)], finish(200_000), 85),
    # time 20 -> 10, coverage 15 -> 7.5: 82.5 -> 83
    ("crashed", [*BOTH, *cells(16)], finish(200_000, reason="crashed"), 83),
]


@pytest.mark.parametrize(("name", "log", "fin", "score"), CASES, ids=[c[0] for c in CASES])
def test_m1_hand(name, log, fin, score):
    assert run("m1_sar", CONFIG, log, fin)["score"] == score


def test_extra_fields_report_the_marks():
    result = run("m1_sar", CONFIG, [*BOTH, WRONG], finish(200_000))
    assert (result["found"], result["total"], result["marks"], result["wrong"]) == (2, 2, 3, 1)
