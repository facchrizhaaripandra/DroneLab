"""Stored results, the telemetry log and replay."""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from api_helpers import delivery_events, finish, frame, send_event, start

BACKEND = Path(__file__).resolve().parents[1]
MISSIONS = ["m1_sar", "m2_foto", "m3_agri", "m4_delivery", "m5_inspeksi"]


def played_delivery(client):
    run = start(client, "m4_delivery", "kota")
    for e in delivery_events(run["config"]):
        send_event(client, run["run_id"], e)
    with client.websocket_connect(f"/ws/v1/runs/{run['run_id']}") as ws:
        ws.send_json(frame(0, (0, 0, 0)))
        ws.send_json(frame(1000, (0, 4, 0)))
    return run["run_id"]


def test_run_detail_follows_the_mission_state(client):
    run_id = played_delivery(client)
    live = client.get(f"/api/v1/runs/{run_id}").json()
    assert live["finished"] is False and live["state"] == "kembali" and live["result"] is None
    result = finish(client, run_id)
    done = client.get(f"/api/v1/runs/{run_id}").json()
    assert (done["state"], done["reason"], done["finished"]) == ("mendarat", "completed", True)
    assert [t["state"] for t in done["transitions"]] == [
        "siap",
        "lepas_landas",
        "menjalankan",
        "kembali",
        "mendarat",
    ]
    assert done["result"]["score"] == result["score"]
    assert done["mission_id"] == "m4_delivery" and done["player"] == "tes"
    listed = client.get("/api/v1/runs").json()
    assert listed[0]["run_id"] == run_id and listed[0]["score"] == result["score"]


def test_telemetry_returns_the_stored_log_in_time_order(client):
    run_id = played_delivery(client)
    body = client.get(f"/api/v1/runs/{run_id}/telemetry").json()
    assert [e["t_ms"] for e in body["log"]] == [0, 0, 1000, 40000, 90000]
    assert [e["type"] for e in body["log"]][:2] == ["takeoff", "sample"]
    for path in ("", "/telemetry"):
        assert client.get(f"/api/v1/runs/r_999{path}").status_code == 404


def load_case(client, mission_id, index):
    case = json.loads((BACKEND / "tests" / "parity" / f"{mission_id}.json").read_text("utf-8"))
    case = case[index]
    variant = case["name"].removeprefix(f"{mission_id}-").rsplit("-", 1)[0]
    run = start(client, mission_id, variant)
    client.app.state.repo.add_entries(run["run_id"], case["log"])
    body = case["finish"]
    r = client.post(f"/api/v1/runs/{run['run_id']}/finish", json=body)
    assert r.status_code == 200, r.text
    return run["run_id"], r.json()


@pytest.mark.parametrize("mission_id", MISSIONS)
def test_ten_replays_give_the_identical_score(client, mission_id):
    run_id, official = load_case(client, mission_id, 8)
    replies = [client.post(f"/api/v1/runs/{run_id}/replay").json() for _ in range(10)]
    assert all(r == replies[0] for r in replies)
    assert replies[0]["identical"] is True
    assert replies[0]["result"]["score"] == official["score"]
    assert replies[0]["result"]["breakdown"] == official["breakdown"]


def test_replay_needs_a_finished_run(client):
    run = start(client)
    r = client.post(f"/api/v1/runs/{run['run_id']}/replay")
    assert r.status_code == 409 and r.json()["error"]["code"] == "run_not_finished"
    assert client.post("/api/v1/runs/r_999/replay").status_code == 404


def test_replay_notices_a_log_that_was_changed(client, settings):
    run_id, _ = load_case(client, "m4_delivery", 8)

    def tool():
        command = [sys.executable, "tools/replay.py", "--db", settings.db_path, "--run-id", run_id]
        return subprocess.run([*command, "--times", "3"], cwd=BACKEND, capture_output=True)

    ok = tool()
    assert ok.returncode == 0, ok.stderr
    extra = [{"t_ms": i, "type": "collision"} for i in range(5)]
    client.app.state.repo.add_entries(run_id, extra)
    assert client.post(f"/api/v1/runs/{run_id}/replay").json()["identical"] is False
    assert tool().returncode == 1
