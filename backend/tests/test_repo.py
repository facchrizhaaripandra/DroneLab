import pytest

from app.db.repo import Repo


@pytest.fixture
def repo(tmp_path, settings):
    r = Repo(str(tmp_path / "repo.db"))
    r.seed_builtins(settings.worlds_dir)
    yield r
    r.close()


def new_run(repo):
    mission = repo.get_mission("m4_delivery")
    world = repo.get_world("m4_delivery", "kota")
    return repo.create_run(
        "m4_delivery", "kota", "tes", 42, world["config"], world["limits"], mission
    )


def test_builtins_are_loaded_once(repo, settings):
    repo.seed_builtins(settings.worlds_dir)
    assert [m["id"] for m in repo.list_missions()] == [
        "m1_sar",
        "m2_foto",
        "m3_agri",
        "m4_delivery",
        "m5_inspeksi",
    ]
    assert repo.get_world("m5_inspeksi", "jembatan")["builtin"] is True
    assert len(repo.list_worlds()) == 16


def test_run_ids_count_up_and_the_log_keeps_arrival_order(repo):
    a, b = new_run(repo), new_run(repo)
    assert (a, b) == ("r_1", "r_2")
    repo.add_entries(a, [{"t_ms": 5, "type": "collision"}])
    repo.add_entries(a, [{"t_ms": 1, "type": "sample", "pos": [0, 0, 0], "vel": [0, 0, 0]}])
    repo.add_entries(a, [{"t_ms": 2, "type": "takeoff"}])
    assert [e["type"] for e in repo.get_log(a)] == ["collision", "takeoff", "sample"]
    assert repo.get_log(b) == []


def test_unknown_run_ids_are_not_found(repo):
    new_run(repo)
    for bad in ["r_99", "x", "r_", "r_1x", "../r_1", "r_-1", "r_01", "r_99999999999999999999"]:
        assert repo.get_run(bad) is None, bad


def test_data_survives_reopening(tmp_path, settings):
    path = str(tmp_path / "keep.db")
    first = Repo(path)
    first.seed_builtins(settings.worlds_dir)
    run_id = new_run(first)
    first.save_result(
        run_id,
        {"t_ms": 1, "battery": 1, "reason": "completed"},
        {"score": 3, "grade": "none", "breakdown": []},
        "mendarat",
        "completed",
        [],
    )
    first.close()
    again = Repo(path)
    run = again.get_run(run_id)
    assert run["finished"] is True and run["result"]["score"] == 3
    assert run["mission"]["scorer"] == "delivery"
    again.close()
