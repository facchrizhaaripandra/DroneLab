"""Telemetry over WebSocket."""

import pytest
from api_helpers import finish, frame, start
from starlette.websockets import WebSocketDisconnect


def url(run_id, query=""):
    return f"/ws/v1/runs/{run_id}{query}"


def test_spray_telemetry_counts_in_the_official_score(client):
    run = start(client, "m3_agri", "lahan")
    field = run["config"]["mission"]["field"]
    middle = (field["min"][1] + field["max"][1]) / 2
    with client.websocket_connect(url(run["run_id"])) as ws:
        for i in range(81):
            pos = (field["min"][0] + i * 0.3, 5, middle)
            ws.send_json(frame((i + 1) * 100, pos, vel=(3, 0, 0), spraying=True))
    result = finish(client, run["run_id"], t_ms=8100)
    rows = {r["name"]: r["points"] for r in result["breakdown"]}
    assert rows["Cakupan"] > 0 and rows["Manajemen tangki"] == 10


def test_low_battery_hint_is_sent_once(client):
    run = start(client)
    with client.websocket_connect(url(run["run_id"], "?ack=1")) as ws:
        for i, battery in enumerate([20, 15, 10]):
            ws.send_json(frame(i * 100, (0, 1, 0), battery=battery))
        messages = [ws.receive_json() for _ in range(4)]
    assert [m for m in messages if m["type"] == "hint"] == [
        {"type": "hint", "text": "Baterai rendah"}
    ]
    assert [m["t_ms"] for m in messages if m["type"] == "ack"] == [0, 100, 200]


def test_no_acks_unless_asked(client):
    run = start(client)
    with client.websocket_connect(url(run["run_id"])) as ws:
        ws.send_json(frame(0, (0, 1, 0), battery=90))
        ws.send_json(frame(100, (0, 1, 0), battery=20))
        assert ws.receive_json()["type"] == "hint"  # the first thing ever received


def test_unknown_run_is_refused(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(url("r_999")) as ws:
            ws.receive_text()


def test_foreign_origin_is_refused(client):
    run = start(client)
    with pytest.raises(WebSocketDisconnect) as refused:
        with client.websocket_connect(
            url(run["run_id"]), headers={"origin": "http://evil.test"}
        ) as ws:
            ws.receive_text()
    assert refused.value.code == 1008
    allowed = {"origin": "http://localhost:5173"}
    with client.websocket_connect(url(run["run_id"], "?ack=1"), headers=allowed) as ws:
        ws.send_json(frame(0, (0, 0, 0)))
        assert ws.receive_json()["type"] == "ack"


def test_finish_while_the_socket_is_still_open_keeps_the_frames(client):
    run = start(client)
    with client.websocket_connect(url(run["run_id"], "?ack=1")) as ws:
        ws.send_json(frame(100, (0, 1, 0)))
        assert ws.receive_json()["type"] == "ack"
        finish(client, run["run_id"])
    log = client.app.state.repo.get_log(run["run_id"])
    assert [e["t_ms"] for e in log if e["type"] == "sample"] == [100]
