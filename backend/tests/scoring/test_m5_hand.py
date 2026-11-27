"""M5 inspection, calculated by hand.

Weights: facade 30, defects 30, safe distance 15, photo quality 10, report 15.
  facade   = panels photographed / panels
  defects  = (defects photographed and marked) / defects - 0.1 * wrong marks
  distance = samples 3..8 m from the structure / samples within 15 m of it
  quality  = mean of 0.5 * sharpness + 0.5 * min(1, area / 0.003) over photographed defects
  report   = (marked + photographed + either) summed over defects / (3 * defects)
A run that does not end as completed halves distance and report.
World: block 10 x 10 x 10 m centred at z = -20, two panels on its south face, two defects.
The photo is taken 5 m in front of that face and sees both panels.
"""

import pytest
from helpers import event, finish, run, sample

from app.scoring.m5_inspection import inspection_report

STRUCTURE = {"x": 0, "z": -20, "w": 10, "d": 10, "y0": 0, "y1": 10}
SOUTH = [{"id": i + 1, "x": x, "y": 5, "z": -14.9, "nx": 0, "nz": 1} for i, x in enumerate((-2, 2))]
NORTH = [
    {"id": i + 3, "x": x, "y": 5, "z": -25.1, "nx": 0, "nz": -1} for i, x in enumerate((-2, 2))
]
DEFECTS = [
    {"id": 1, "kind": "retak", "face": "S", "x": -2, "y": 5, "z": -15, "size": 1.6},
    {"id": 2, "kind": "karat", "face": "S", "x": 2, "y": 5, "z": -15, "size": 0.5},
]


def world(panels=SOUTH):
    return {
        "mission": {
            "structure": STRUCTURE,
            "panels": panels,
            "defects": DEFECTS,
            "safe": {"min": 3, "max": 8},
        }
    }


def seen(ids, area=0.003):
    return [{"label": "defect", "id": i, "dist": 5, "area": area} for i in ids]


def photo(ids=(1, 2), area=0.003, speed=0):
    return event(1000, "photo", pos=(0, 5, -9.9), visible=seen(ids, area), speed=speed, yaw_rate=0)


def mark(ids=(1, 2), t=2000):
    return event(t, "mark", pos=(0, 5, -9.9), visible=seen(ids))


SAFE = [sample(100, (0, 5, -10))]  # 5 m from the face
CLOSE = [sample(200, (0, 5, -13))]  # 2 m from the face
FULL = [photo(), mark(), *SAFE]

CASES = [
    ("base", world(), FULL, finish(100_000), 100),
    ("nothing happened", world(), [], finish(100_000), 0),
    # facade 2/4 -> 15; 85
    ("two panels never seen", world([*SOUTH, *NORTH]), FULL, finish(100_000), 85),
    # defects 15, report 3/6 -> 7.5: 30 + 15 + 15 + 10 + 7.5 = 77.5 -> 78
    ("one of two defects", world(), [photo((1,)), mark((1,)), *SAFE], finish(100_000), 78),
    # defects 1 - .1 -> 27; 97
    ("one wrong mark", world(), [*FULL, mark((), t=3000)], finish(100_000), 97),
    # defects 0, report 4/6 -> 10: 30 + 0 + 15 + 10 + 10 = 65
    ("photo without marks", world(), [photo(), *SAFE], finish(100_000), 65),
    # distance .5 -> 7.5: 92.5 -> 93
    ("half the time too close", world(), [*FULL, *CLOSE], finish(100_000), 93),
    # sharp .5 -> quality .75 -> 7.5: 97.5 -> 98
    ("photo while moving", world(), [photo(speed=1.75), mark(), *SAFE], finish(100_000), 98),
    # area .0015 -> quality .75 -> 98
    ("small defects in frame", world(), [photo(area=0.0015), mark(), *SAFE], finish(100_000), 98),
    # distance 7.5 + report 7.5: 85
    ("battery empty", world(), FULL, finish(100_000, reason="battery"), 85),
]


@pytest.mark.parametrize(
    ("name", "config", "log", "fin", "score"), CASES, ids=[c[0] for c in CASES]
)
def test_m5_hand(name, config, log, fin, score):
    assert run("m5_inspeksi", config, log, fin)["score"] == score


def test_report_lists_every_defect_with_severity():
    report = inspection_report(world(), [photo((1,)), mark((1,))])
    assert [d["severity"] for d in report["defects"]] == ["berat", "ringan"]
    assert report["defects"][0]["photo"] == "t=1000"
    assert report["defects"][1]["photo"] is None
    assert report["panels"] == {"covered": 2, "total": 2}
    assert report["wrong_marks"] == 0
