"""Telemetry is written in batches without stalling the gateway."""

import time

from app.db.repo import Repo
from app.telemetry import TelemetryHub


def sample(i):
    return {"t_ms": i * 100, "type": "sample", "pos": [0, 1, 0], "vel": [0, 0, 0]}


class Recorder:
    def __init__(self):
        self.written: list[tuple[str, int]] = []

    def add_entries(self, run_id, entries):
        self.written.append((run_id, len(entries)))


def test_writing_a_batch_of_samples_is_fast(tmp_path, settings):
    repo = Repo(str(tmp_path / "fast.db"))
    repo.seed_builtins(settings.worlds_dir)
    mission, world = repo.get_mission("m4_delivery"), repo.get_world("m4_delivery", "kota")
    run = repo.create_run("m4_delivery", "kota", "p", 42, world["config"], world["limits"], mission)
    before = time.perf_counter()
    repo.add_entries(run, [sample(i) for i in range(4000)])
    elapsed = time.perf_counter() - before
    assert len(repo.get_log(run)) == 4000
    repo.close()
    assert elapsed < 0.15, f"{elapsed:.3f} s blocks every other drone for that long"


def test_the_periodic_flush_leaves_active_runs_to_their_own_batches():
    repo = Recorder()
    hub = TelemetryHub(repo, flush_interval_s=0.05)
    hub.ingest("r_1", sample(0))
    time.sleep(0.12)  # r_1 has stopped sending
    hub.ingest("r_2", sample(0))
    hub.flush_idle()
    assert repo.written == [("r_1", 1)]
    hub.flush_all()
    assert repo.written == [("r_1", 1), ("r_2", 1)]
