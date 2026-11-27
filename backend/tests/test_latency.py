"""The latency experiment: percentiles, a short measurement and the files it writes."""

import csv

import pytest

from tools.latency import measure, percentile, write_results


def test_percentile_interpolates_linearly():
    assert percentile([1, 2, 3, 4], 50) == 2.5
    assert percentile([4, 1, 3, 2], 95) == pytest.approx(3.85)
    assert percentile([7], 95) == 7
    with pytest.raises(ValueError):
        percentile([], 50)


async def test_every_frame_is_acknowledged_and_timed(live_server):
    row = await measure(live_server, drones=2, hz=10, duration_s=1.0)
    assert (row["drones"], row["hz"]) == (2, 10)
    assert row["frames"] >= 18 and row["lost"] == 0
    assert 0 < row["p50_ms"] <= row["p95_ms"]


def test_results_are_written_as_table_and_chart(tmp_path):
    rows = [
        {"drones": d, "hz": hz, "frames": 100, "lost": 0, "p50_ms": d * 0.5, "p95_ms": d * 1.0}
        for hz in (10, 20)
        for d in (1, 5)
    ]
    write_results(rows, tmp_path / "out", duration_s=3)
    with open(tmp_path / "out" / "latency.csv", newline="", encoding="utf-8") as f:
        read = list(csv.DictReader(f))
    assert len(read) == 4 and read[0]["drones"] == "1" and read[3]["p95_ms"] == "5.0"
    table = (tmp_path / "out" / "latency.md").read_text("utf-8")
    assert "| 20 | 5 |" in table and "p95" in table
    assert (tmp_path / "out" / "latency.png").read_bytes()[:4] == b"\x89PNG"
