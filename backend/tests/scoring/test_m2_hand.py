"""M2 photography and video, calculated by hand.

Photo weights: subject 30, thirds 20, horizon 10, sharp 15, light 10, variation 15 (= 100).
Video weights: in frame 30, smooth 30, cinematic 20, duration 10, safety 10 (= 100).
With only photo shots (or only video shots) that kind counts for the whole mission.
Photo base: subject centred on a thirds point, area .16 (range .10..60), level, still,
sun behind the camera (sun azimuth 0, camera yaw 180) -> 100.
"""

import math

import pytest
from helpers import event, finish, points, run, sample

SUBJECT = {"id": "a", "name": "A", "x": 0, "y": 0, "z": 0, "hx": 1, "hy": 1}


def world(*shots):
    return {"mission": {"landmarks": [SUBJECT], "sun": {"az": 0, "el": 40}, "shots": list(shots)}}


def photo_shot(i=1):
    return {"id": f"p{i}", "type": "photo", "subject": "a", "areaRange": [0.10, 0.60]}


ORBIT = {"id": "v1", "type": "video", "kind": "orbit", "subject": "a", "minDur": 8, "maxDur": 16}
ON_THIRD = [1 / 3 - 0.2, 1 / 3 - 0.2, 0.4, 0.4]


def photo(t=1000, area=0.16, box=ON_THIRD, roll=0, speed=0, yaw_rate=0, yaw=180, seen=True):
    visible = [{"label": "landmark", "id": "a", "area": area, "box": box}] if seen else []
    return event(
        t,
        "photo",
        pos=(0, 0, 10),
        yaw=yaw,
        roll=roll,
        visible=visible,
        speed=speed,
        yaw_rate=yaw_rate,
    )


CASES = [
    ("base", photo(), 100),
    # subject 0, thirds 0 -> 10 + 15 + 10 + 15 = 50
    ("subject not visible", photo(seen=False), 50),
    # subject .05/.10 = .5 -> 15; 85
    ("too small", photo(area=0.05), 85),
    # subject (1-.8)/(1-.6) = .5 -> 15; 85
    ("too large", photo(area=0.8), 85),
    # horizon 1 - 6/12 = .5 -> 5; 95
    ("roll 9 degrees", photo(roll=9), 95),
    # sharp 1 - 1.25/2.5 = .5 -> 7.5; 92.5 -> 93
    ("moving 1.75 m/s", photo(speed=1.75), 93),
    # sharp 1 - 25/50 = .5 -> 93
    ("turning 35 deg/s", photo(yaw_rate=35), 93),
    # looking into the sun: light 0 -> 90
    ("against the sun", photo(yaw=0), 90),
    # centre is .2357 from a thirds point, /.4714 = .5 -> 10; 90
    ("subject centred", photo(box=[0.3, 0.3, 0.4, 0.4]), 90),
]


@pytest.mark.parametrize(("name", "entry", "score"), CASES, ids=[c[0] for c in CASES])
def test_m2_photo_hand(name, entry, score):
    assert run("m2_foto", world(photo_shot()), [entry], finish(60_000))["score"] == score


def test_no_photo_scores_zero():
    result = run("m2_foto", world(photo_shot()), [], finish(60_000))
    assert result["score"] == 0
    assert result["details"] == [{"id": "p1", "type": "photo", "done": False, "score": 0}]


def test_two_photos_from_the_same_direction_lose_variation():
    # first photo 100, second 85 (variation 0): variation row (15 + 0) / 2 = 7.5 -> 92.5 -> 93
    result = run(
        "m2_foto", world(photo_shot(1), photo_shot(2)), [photo(1000), photo(2000)], finish(60_000)
    )
    assert points(result)["Variasi"] == 7.5
    assert result["score"] == 93


def orbit_clip(sweep=100, seconds=10):
    """Circles the subject at 20 m, camera on it, constant velocity (so no jerk)."""
    log = [event(0, "record_start")]
    for i in range(seconds + 1):
        a = math.radians(sweep * i / seconds)
        pos = (20 * math.sin(a), 0, -20 * math.cos(a))
        yaw = (math.degrees(math.atan2(-pos[0], pos[2])) + 360) % 360
        log.append(sample(i * 1000, pos, vel=(1, 0, 0), yaw=yaw, gimbal=0))
    return [*log, event(seconds * 1000, "record_stop")]


def test_perfect_orbit_video():
    assert run("m2_foto", world(ORBIT), orbit_clip(), finish(60_000))["score"] == 100


def test_half_orbit_and_missing_clip():
    # sweep 45 of 90 degrees -> cinematic 10 of 20 -> 90
    assert run("m2_foto", world(ORBIT), orbit_clip(sweep=45), finish(60_000))["score"] == 90
    assert run("m2_foto", world(ORBIT), [], finish(60_000))["score"] == 0
