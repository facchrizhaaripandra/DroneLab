"""Same log, same score: the Python scorers against cases scored by the JavaScript reference."""

import json
from pathlib import Path

import pytest
from helpers import mission

from app.scoring import score_run

CASES = [
    (path.stem, case)
    for path in sorted((Path(__file__).resolve().parents[1] / "parity").glob("*.json"))
    for case in json.loads(path.read_text(encoding="utf-8"))
]


def assert_same(actual, expected, where="result"):
    if isinstance(expected, bool) or expected is None or isinstance(expected, str):
        assert actual == expected and type(actual) is type(expected), where
    elif isinstance(expected, int | float):
        assert actual == pytest.approx(expected, abs=1e-9), where
    elif isinstance(expected, list):
        assert len(actual) == len(expected), where
        for i, (a, e) in enumerate(zip(actual, expected, strict=True)):
            assert_same(a, e, f"{where}[{i}]")
    else:
        assert sorted(actual) == sorted(expected), where
        for key, value in expected.items():
            assert_same(actual[key], value, f"{where}.{key}")


def test_there_are_cases_for_all_five_missions():
    assert sorted({m for m, _ in CASES}) == [
        "m1_sar",
        "m2_foto",
        "m3_agri",
        "m4_delivery",
        "m5_inspeksi",
    ]


@pytest.mark.parametrize(("mission_id", "case"), CASES, ids=[c["name"] for _, c in CASES])
def test_parity(mission_id, case):
    definition = mission(mission_id)
    assert_same(
        score_run(definition, case["config"], case["log"], case["finish"]), case["expected"]
    )
