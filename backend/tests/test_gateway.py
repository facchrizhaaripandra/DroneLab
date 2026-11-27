"""The REST API the simulator uses."""

import pytest
from api_helpers import delivery_events, finish, send_event, start, world_file

VARIANTS = [
    ("m1_sar", "gedung"),
    ("m1_sar", "hutan"),
    ("m1_sar", "gedung-acak"),
    ("m1_sar", "hutan-acak"),
    ("m2_foto", "hotel"),
    ("m2_foto", "gunung"),
    ("m2_foto", "hotel-acak"),
    ("m2_foto", "gunung-acak"),
    ("m3_agri", "sawah"),
    ("m3_agri", "lahan"),
    ("m4_delivery", "kota"),
    ("m4_delivery", "acak"),
    ("m5_inspeksi", "gedung"),
    ("m5_inspeksi", "jembatan"),
    ("m5_inspeksi", "gedung-acak"),
    ("m5_inspeksi", "jembatan-acak"),
]


def test_missions_list(client):
    missions = client.get("/api/v1/missions").json()
    assert len(missions) == 5
    m5 = next(m for m in missions if m["id"] == "m5_inspeksi")
    assert m5["variants"] == ["gedung", "jembatan", "gedung-acak", "jembatan-acak"]
    assert m5["par_time_s"] == 300 and m5["title"]


@pytest.mark.parametrize(("mission_id", "variant"), VARIANTS)
def test_every_variant_returns_its_exported_world(client, mission_id, variant):
    run = start(client, mission_id, variant)
    assert run["api_version"] == "1" and run["seed"] == 42
    assert run["config"] == world_file(mission_id, variant)["config"]


def test_unknown_variant_falls_back_to_the_first(client):
    expected = world_file("m1_sar", "gedung")["config"]
    assert start(client, "m1_sar", "bulan")["config"] == expected
    assert start(client, "m1_sar")["config"] == expected


def test_unknown_mission(client):
    r = client.post("/api/v1/runs", json={"mission_id": "latihan_terbang"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_mission"


def test_bad_bodies_use_the_error_format(client):
    json_header = {"Content-Type": "application/json"}
    r = client.post("/api/v1/runs", content="{oops", headers=json_header)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_json"
    r = client.post("/api/v1/runs", json={"player": "x"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"
    run = start(client)
    r = client.post(
        f"/api/v1/runs/{run['run_id']}/events",
        content='{"t_ms": 1, "type": "photo", "speed": NaN}',
        headers=json_header,
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"
    r = client.post(
        f"/api/v1/runs/{run['run_id']}/finish",
        json={"t_ms": 1, "battery": 80, "reason": "bored"},
    )
    assert r.status_code == 400


def test_full_delivery_run(client):
    run = start(client, "m4_delivery", "kota")
    for e in delivery_events(run["config"]):
        assert send_event(client, run["run_id"], e).json() == {"api_version": "1", "ok": True}
    result = finish(client, run["run_id"])
    assert result["score"] >= 85 and result["grade"] == "gold"
    assert len(result["breakdown"]) == 5 and result["completed"] is True
    assert result["api_version"] == "1"


def test_report_only_for_inspection(client):
    run = start(client, "m5_inspeksi", "jembatan")
    report = client.get(f"/api/v1/runs/{run['run_id']}/report").json()
    assert len(report["defects"]) == len(run["config"]["mission"]["defects"])
    assert report["coverage"] == 0 and report["api_version"] == "1"
    delivery = start(client)
    r = client.get(f"/api/v1/runs/{delivery['run_id']}/report")
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_report"
    assert client.get("/api/v1/runs/r_999/report").status_code == 404


def test_leaderboard_orders_and_filters_finished_runs(client):
    good = start(client, "m4_delivery", "kota", player="ani")
    for e in delivery_events(good["config"]):
        send_event(client, good["run_id"], e)
    finish(client, good["run_id"])
    finish(client, start(client, "m4_delivery", "acak", player="budi")["run_id"])
    finish(client, start(client, "m3_agri", "lahan", player="cici")["run_id"])
    start(client, "m4_delivery", "kota", player="belum")  # never finished

    def board(**params):
        return client.get("/api/v1/leaderboard", params=params).json()

    everyone = board()
    assert len(everyone) == 3 and everyone[0]["player"] == "ani"
    assert [r["rank"] for r in everyone] == [1, 2, 3]
    assert [r["score"] for r in everyone] == sorted((r["score"] for r in everyone), reverse=True)
    assert [r["player"] for r in board(mission_id="m4_delivery")] == ["ani", "budi"]
    assert [r["player"] for r in board(mission_id="m4_delivery", variant="acak")] == ["budi"]
    assert len(board(limit=1)) == 1
    assert client.get("/api/v1/leaderboard", params={"limit": 0}).status_code == 400
