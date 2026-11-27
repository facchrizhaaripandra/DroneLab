"""The gateway in front of the detector (role C) and the planner (role B)."""

import asyncio
import json
import time
from contextlib import contextmanager

import httpx
import pytest
from api_helpers import start
from fastapi.testclient import TestClient

from app.main import create_app

PLAN = {"scenario": "m3_agri", "world": {"seed": 42}, "goal": {"x": 1}, "params": {}}
PLAN_REPLY = {
    "waypoints": [{"id": 0, "x": 0, "y": 10, "z": 0, "speed": 3, "action": "fly", "params": {}}],
    "stats": {
        "length_m": 10,
        "est_time_s": 4,
        "est_energy": 1,
        "coverage_pct": 50,
        "compute_ms": 2,
    },
}


@contextmanager
def gateway(settings, ai=None, planner=None):
    """A gateway whose AI services are answered by the given functions."""

    def refuse(request):
        raise httpx.ConnectError("refused", request=request)

    app = create_app(
        settings,
        ai_transport=httpx.MockTransport(ai or refuse),
        planner_transport=httpx.MockTransport(planner or refuse),
    )
    with TestClient(app) as client:
        yield client


def error(r):
    return r.status_code, r.json()["error"]["code"]


def detector(seen: list):
    def handle(request: httpx.Request):
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        body = json.loads(request.content)
        seen.append((request.url.path, body))
        if request.url.path == "/detect":
            found = {"cls": "person", "conf": 0.9, "bbox": [64, 36, 128, 108], "world_pos": None}
            return httpx.Response(200, json={"frame_id": body["frame_id"], "detections": [found]})
        return httpx.Response(200, json={"script": "photo();", "echo": body})

    return handle


def test_health_reports_a_living_detector(settings):
    with gateway(settings, ai=detector([])) as client:
        assert client.get("/health").json()["ai"] == "ok"


def test_detect_translates_between_the_two_formats(settings):
    seen = []
    pose = {"pos": [1, 2, 3], "quat": [0, 0, 0, 1], "fov": 70}
    with gateway(settings, ai=detector(seen)) as client:
        body = {"image": "abc", "mode": "thermal", "camera_pose": pose}
        result = client.post("/api/v1/detect", json=body).json()
        client.post("/api/v1/detect", json={"image": "def"})
    (path, first), (_, second) = seen
    assert path == "/detect"
    assert first["image_b64"] == "abc" and first["camera_pose"] == pose
    assert first["frame_id"] != second["frame_id"] and second["camera_pose"] is None
    assert result["api_version"] == "1"
    assert result["objects"] == [
        {"label": "person", "score": 0.9, "box": [0.1, 0.1, 0.1, 0.2], "world_pos": None}
    ]
    assert result["latency_ms"] >= 0 and result["model"]


def test_command_and_decide_are_passed_through(settings):
    seen = []
    with gateway(settings, ai=detector(seen)) as client:
        sent = {"text": "foto hotel", "context": {"battery": 80}}
        command = client.post("/api/v1/command", json=sent).json()
        client.post("/api/v1/decide", json={"obs": [0, 1]})
    assert command["script"] == "photo();" and command["api_version"] == "1"
    assert seen == [("/command", sent), ("/decide", {"obs": [0, 1]})]


@pytest.mark.parametrize("path", ["detect", "command", "decide"])
def test_a_dead_ai_service_is_reported_as_ai_down(settings, path):
    body = {"image": "a", "text": "b", "obs": [0]}
    with gateway(settings) as client:
        assert client.get("/health").json()["ai"] == "down"
        assert error(client.post(f"/api/v1/{path}", json=body)) == (503, "ai_down")
    with gateway(settings, ai=lambda r: httpx.Response(500)) as client:
        assert error(client.post(f"/api/v1/{path}", json=body)) == (503, "ai_down")


def test_a_detector_answer_in_the_wrong_shape(settings):
    reply = lambda r: httpx.Response(200, json={"detections": [{"cls": "person"}]})  # noqa: E731
    with gateway(settings, ai=reply) as client:
        r = client.post("/api/v1/detect", json={"image": "a"})
    assert error(r) == (502, "ai_bad_response")


def test_plan_is_forwarded_in_contract_form(settings):
    seen = []

    def planner(request):
        seen.append((request.url.path, json.loads(request.content)))
        return httpx.Response(200, json=PLAN_REPLY)

    with gateway(settings, planner=planner) as client:
        result = client.post("/api/v1/plan", json=PLAN).json()
    assert seen == [("/plan", PLAN)]
    assert result["waypoints"][0]["action"] == "fly" and result["stats"]["length_m"] == 10


def test_planner_errors(settings):
    bad = {**PLAN_REPLY, "waypoints": [{**PLAN_REPLY["waypoints"][0], "action": "explode"}]}
    with gateway(settings, planner=lambda r: httpx.Response(200, json=bad)) as client:
        assert error(client.post("/api/v1/plan", json=PLAN)) == (502, "planner_bad_response")
    with gateway(settings, planner=lambda r: httpx.Response(200, text="oops")) as client:
        assert error(client.post("/api/v1/plan", json=PLAN)) == (502, "planner_bad_response")
    with gateway(settings) as client:
        assert error(client.post("/api/v1/plan", json=PLAN)) == (503, "planner_down")
        assert error(client.post("/api/v1/plan", json={})) == (400, "invalid_request")


def test_hanging_services_do_not_slow_the_simulator_down(settings):
    async def hang(request):
        await asyncio.sleep(5)
        return httpx.Response(200, json={})

    with gateway(settings, ai=hang, planner=hang) as client:
        before = time.perf_counter()
        assert client.get("/health").json()["ai"] == "down"
        assert time.perf_counter() - before < 1
        before = time.perf_counter()
        start(client)
        assert time.perf_counter() - before < 1
