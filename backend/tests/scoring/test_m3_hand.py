"""M3 spraying, calculated by hand.

Weights: coverage 40, waste 20, efficiency 20, envelope 10, tank 10. Par time 300 s.
World: field 4 x 2 m = 2 cells of 4 m2, target dose 0.4..1.2 per m2 = 1.6..4.8 per cell,
flow 10 units/s, tank 200, no wind. The drone hovers at (2, 5, 1), one sample per 100 ms.
At 5 m the spray circle (radius 2.7 m) covers 6 cell centres: 2 in the field, 4 outside.
With k spraying intervals each field cell receives k/6 and 4/6 of the spray is wasted.
  coverage   = cells inside the target range / cells
  waste      = 1 - (outside + no-spray + excess) / total
  efficiency = (0.5 * time factor + 0.5 * min(1, battery/40)) * coverage
  envelope   = share of spray time at 3..8 m and <= 4 m/s
  tank       = 1 - 0.5 * times the tank ran dry (0 when nothing was sprayed)
A run that does not end as completed halves efficiency and tank.
Base: k = 18 (dose 3.0), battery 40: 40 + 6.7 + 20 + 10 + 10 = 86.7 -> 87.
"""

import pytest
from helpers import event, finish, run, sample

from app.scoring.m3_agri import replay_agri


def world(capacity=200, no_spray=()):
    return {
        "mission": {
            "field": {"min": [0, 0], "max": [4, 2], "cell": 2},
            "noSpray": list(no_spray),
            "dose": {"lo": 0.4, "hi": 1.2, "flow": 10, "capacity": capacity},
        }
    }


def spray(k=18, speed=0):
    return [sample(i * 100, (2, 5, 1), vel=(speed, 0, 0), spraying=True) for i in range(k + 1)]


HOUSE = {"min": [2, 0], "max": [4, 2]}

CASES = [
    ("base", world(), spray(), finish(1800, 40), 87),
    # nothing sprayed: waste counts as 100%, tank 0
    ("no samples", world(), [], finish(1800, 40), 0),
    # dose 0.83 < 1.6: coverage 0, efficiency 0; 6.7 + 10 + 10 = 26.7 -> 27
    ("too little", world(), spray(5), finish(500, 40), 27),
    # dose 6.0 > 4.8: excess 2.4 of 36, wasted 26.4/36 -> 5.3; 5.3 + 10 + 10 -> 25
    ("too much", world(), spray(36), finish(3600, 40), 25),
    # efficiency 0.5 + 0.25 -> 15; 81.7 -> 82
    ("battery 20", world(), spray(), finish(1800, 20), 82),
    # time factor 0.5 -> efficiency 15; 82
    ("450 s", world(), spray(), finish(450_000, 40), 82),
    # envelope 0; 76.7 -> 77
    ("too fast", world(), spray(speed=5), finish(1800, 40), 77),
    # efficiency 10, tank 5; 71.7 -> 72
    ("timeout", world(), spray(), finish(1800, 40, "timeout"), 72),
    # one target cell, waste 5/6 -> 3.3; 40 + 3.3 + 20 + 10 + 10 = 83.3 -> 83
    ("house on one cell", world(no_spray=[HOUSE]), spray(), finish(1800, 40), 83),
    # 10 units then dry: dose 1.67, tank 5; 81.7 -> 82
    ("tank runs dry", world(capacity=10), spray(), finish(1800, 40), 82),
]


@pytest.mark.parametrize(
    ("name", "config", "log", "fin", "score"), CASES, ids=[c[0] for c in CASES]
)
def test_m3_hand(name, config, log, fin, score):
    assert run("m3_agri", config, log, fin)["score"] == score


def test_refill_only_counts_near_home():
    far = event(5000, "refill", pos=(30, 0, 30))
    near = event(5000, "refill", pos=(1, 0, 1))
    assert replay_agri(world(), [*spray(), far]).refills == 0
    assert replay_agri(world(), [*spray(), near]).refills == 1


def test_wind_event_wins_over_config_and_bad_wind_is_ignored():
    gale = {"t_ms": 0, "type": "wind", "wind": {"speed": 8, "dir": 90}}
    calm = run("m3_agri", world(), spray(), finish(1800, 40))
    blown = run("m3_agri", world(), [gale, *spray()], finish(1800, 40))
    assert blown["coverage"] == 0 and calm["coverage"] == 1
    broken = {"t_ms": 0, "type": "wind", "wind": {"speed": "strong"}}
    assert run("m3_agri", world(), [broken, *spray()], finish(1800, 40)) == calm
