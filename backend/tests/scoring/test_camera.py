"""Camera geometry: the same projection the simulator uses."""

import pytest

from app.scoring.camera import ang_diff, bearing, in_frame, project

POSE = {"pos": [0, 0, 0], "yaw": 0, "pitch": 0}


def test_object_straight_ahead_is_centred():
    p = project(POSE, {"x": 0, "y": 0, "z": -10, "hx": 1, "hy": 1})
    assert p["center"] == pytest.approx([0.5, 0.5])
    assert p["dist"] == pytest.approx(10)
    assert in_frame(p)


def test_object_behind_the_camera_is_not_projected():
    assert project(POSE, {"x": 0, "y": 0, "z": 10, "hx": 1, "hy": 1}) is None
    assert not in_frame(None)


def test_zoom_makes_objects_larger():
    near = {"x": 0, "y": 0, "z": -10, "hx": 1, "hy": 1}
    assert project({**POSE, "zoom": 2}, near)["area"] > project(POSE, near)["area"]


def test_angles_follow_the_simulator_convention():
    assert ang_diff(10, 350) == 20
    assert ang_diff(350, 10) == -20
    assert bearing(0, 0, 0, -1) == 0
    assert bearing(0, 0, 1, 0) == 90
    assert bearing(0, 0, -1, 0) == 270
