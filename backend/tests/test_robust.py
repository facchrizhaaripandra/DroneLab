"""Things a real client does wrong: broken frames, repeats, late data, a gateway restart."""

from api_helpers import delivery_events, finish, frame, send_event, start
from fastapi.testclient import TestClient

from app.main import create_app

BROKEN = [
    "bukan json",
    '{"t_ms": 1}',
    '{"t_ms": 2, "pos": [1, 2], "vel": [0, 0, 0], "yaw": 0}',
    '{"t_ms": 3, "pos": [NaN, 0, 0], "vel": [0, 0, 0], "yaw": 0}',
    '{"t_ms": 4, "pos": [0, 0, 0], "vel": null, "yaw": 0}',
    '{"t_ms": -5, "pos": [0, 0, 0], "vel": [0, 0, 0], "yaw": 0}',
    "[1, 2, 3]",
]


def test_broken_frames_are_ignored_and_the_socket_stays_open(client):
    run = start(client)
    with client.websocket_connect(f"/ws/v1/runs/{run['run_id']}?ack=1") as ws:
        for text in BROKEN:
            ws.send_text(text)
        ws.send_bytes(b"\x00\x01")
        ws.send_json(frame(500, (0, 1, 0)))
        assert ws.receive_json() == {"type": "ack", "t_ms": 500}
    log = client.app.state.repo.get_log(run["run_id"])
    assert [e["t_ms"] for e in log] == [500]
    finish(client, run["run_id"])


def test_finish_without_data_and_twice(client):
    run = start(client, "m2_foto", "hotel")
    first = finish(client, run["run_id"], t_ms=0, battery=100)
    assert 0 <= first["score"] <= 100
    second = finish(client, run["run_id"], t_ms=999_999, battery=1, reason="crashed")
    assert second == first
    r = client.post(
        "/api/v1/runs/r_999/finish", json={"t_ms": 1, "battery": 1, "reason": "completed"}
    )
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_run"
    assert send_event(client, "r_999", {"t_ms": 1, "type": "photo"}).status_code == 404


def test_nothing_is_added_after_finish(client):
    run = start(client)
    result = finish(client, run["run_id"])
    r = send_event(client, run["run_id"], {"t_ms": 5, "type": "drop"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "run_finished"
    with client.websocket_connect(f"/ws/v1/runs/{run['run_id']}") as ws:
        ws.send_json(frame(100, (0, 1, 0)))
    assert client.app.state.repo.get_log(run["run_id"]) == []
    assert finish(client, run["run_id"]) == result


def play(client, run):
    for e in delivery_events(run["config"]):
        send_event(client, run["run_id"], e)
    with client.websocket_connect(f"/ws/v1/runs/{run['run_id']}") as ws:
        ws.send_json(frame(1000, (0, 3, 0)))


def test_a_restarted_gateway_can_finish_the_run(settings):
    with TestClient(create_app(settings)) as before:
        run = start(before)
        play(before, run)
    with TestClient(create_app(settings)) as after:
        result = finish(after, run["run_id"])
        fresh = start(after)
        play(after, fresh)
        assert result == finish(after, fresh["run_id"])
        assert len(after.app.state.repo.get_log(run["run_id"])) == 4
