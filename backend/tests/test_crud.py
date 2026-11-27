"""CRUD for worlds and missions."""

import pytest
from api_helpers import delivery_events, finish, send_event, start, world_file

from app.models.world import check_world_config

SQUARE = {"minX": -100, "maxX": 100, "minZ": -100, "maxZ": 100}


def custom_world(variant="uji", mission_id="m4_delivery"):
    config = world_file("m4_delivery", "acak")["config"]
    return {"mission_id": mission_id, "variant": variant, "limits": SQUARE, "config": config}


def error(r):
    return r.status_code, r.json()["error"]["code"]


def test_every_exported_world_passes_the_schema(client):
    worlds = client.get("/api/v1/worlds").json()
    assert len(worlds) == 16
    for w in worlds:
        scorer = client.get(f"/api/v1/missions/{w['mission_id']}").json()["scorer"]
        check_world_config(scorer, w["config"])
    assert len(client.get("/api/v1/worlds", params={"mission_id": "m3_agri"}).json()) == 2


def test_builtin_worlds_are_read_only(client):
    url = "/api/v1/worlds/m4_delivery__kota"
    assert client.get(url).json()["builtin"] is True
    assert error(client.put(url, json={"seed": 7})) == (403, "read_only")
    assert error(client.delete(url)) == (403, "read_only")


def test_custom_world_life_cycle(client):
    created = client.post("/api/v1/worlds", json=custom_world())
    assert created.status_code == 201
    assert created.json()["id"] == "m4_delivery__uji" and created.json()["builtin"] is False
    assert start(client, "m4_delivery", "uji")["config"] == custom_world()["config"]
    assert error(client.post("/api/v1/worlds", json=custom_world())) == (409, "conflict")

    changed = custom_world()["config"]
    changed["mission"]["drop"] = {"x": 1, "z": 2, "r": 4}
    url = "/api/v1/worlds/m4_delivery__uji"
    assert client.put(url, json={"config": changed}).json()["config"] == changed
    assert client.get(url).json()["limits"] == SQUARE
    assert client.delete(url).json() == {"api_version": "1", "ok": True}
    assert error(client.get(url)) == (404, "unknown_world")
    assert error(client.delete(url)) == (404, "unknown_world")


@pytest.mark.parametrize(
    "change",
    [
        {"config": {"seed": 1}},  # no mission
        {"config": {"mission": {"pickup": {"x": 0, "z": 0, "r": 3}}}},  # no drop zone
        {"limits": {"minX": 5, "maxX": -5, "minZ": 0, "maxZ": 1}},
        {"variant": "../x"},
    ],
)
def test_invalid_worlds_are_rejected(client, change):
    r = client.post("/api/v1/worlds", json={**custom_world(), **change})
    assert r.status_code == 400, r.text


def test_a_field_with_absurdly_many_cells_is_rejected(client):
    config = world_file("m3_agri", "lahan")["config"]
    config["mission"]["field"] = {"min": [0, 0], "max": [100000, 100000], "cell": 0.1}
    body = {"mission_id": "m3_agri", "variant": "raksasa", "limits": SQUARE, "config": config}
    assert error(client.post("/api/v1/worlds", json=body)) == (400, "invalid_world")


def test_world_for_an_unknown_mission(client):
    r = client.post("/api/v1/worlds", json=custom_world(mission_id="tidak_ada"))
    assert error(r) == (404, "unknown_mission")


def new_mission(**change):
    base = {
        "id": "kirim_cepat",
        "title": "Kirim cepat",
        "scorer": "delivery",
        "par_time_s": 60,
        "variants": ["kota"],
        "weights": {"accuracy": 60, "cargo": 10, "time": 10, "battery": 10, "zones": 10},
    }
    return {**base, **change}


def test_custom_mission_life_cycle(client):
    created = client.post("/api/v1/missions", json=new_mission())
    assert created.status_code == 201 and created.json()["builtin"] is False
    assert len(client.get("/api/v1/missions").json()) == 6
    assert error(client.post("/api/v1/missions", json=new_mission())) == (409, "conflict")
    # no world yet, then one
    r = client.post("/api/v1/runs", json={"mission_id": "kirim_cepat"})
    assert error(r) == (404, "unknown_world")
    client.post("/api/v1/worlds", json=custom_world("kota", "kirim_cepat"))
    run = start(client, "kirim_cepat")
    assert finish(client, run["run_id"])["breakdown"][0]["max"] == 60
    assert client.delete("/api/v1/missions/kirim_cepat").status_code == 200
    assert error(client.get("/api/v1/missions/kirim_cepat")) == (404, "unknown_mission")
    assert client.get("/api/v1/worlds", params={"mission_id": "kirim_cepat"}).json() == []
    # the finished run keeps its own copy of the definition
    assert client.post(f"/api/v1/runs/{run['run_id']}/replay").json()["identical"] is True


@pytest.mark.parametrize(
    "change",
    [
        {"scorer": "magic"},
        {"weights": {"accuracy": 100}},  # a weight the scorer needs is missing
        {"par_time_s": 0},
        {"variants": []},
        {"id": "Bad Id"},
    ],
)
def test_invalid_missions_are_rejected(client, change):
    assert client.post("/api/v1/missions", json=new_mission(**change)).status_code == 400


def test_builtin_missions_cannot_be_deleted_or_lose_weights(client):
    assert error(client.delete("/api/v1/missions/m4_delivery")) == (403, "read_only")
    r = client.put("/api/v1/missions/m4_delivery", json={"weights": {"accuracy": 100}})
    assert r.status_code == 400


def test_new_weights_apply_to_later_runs_only(client):
    old = start(client)
    for e in delivery_events(old["config"]):
        send_event(client, old["run_id"], e)
    before = finish(client, old["run_id"])
    weights = {"accuracy": 50, "cargo": 20, "time": 20, "battery": 5, "zones": 5}
    r = client.put("/api/v1/missions/m4_delivery", json={"weights": weights})
    assert r.status_code == 200 and r.json()["weights"] == weights

    new = start(client)
    assert finish(client, new["run_id"])["breakdown"][0]["max"] == 50
    replay = client.post(f"/api/v1/runs/{old['run_id']}/replay").json()
    assert replay["identical"] is True
    assert replay["result"]["breakdown"] == before["breakdown"]


def test_an_edited_builtin_mission_survives_a_restart(settings):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(settings)) as first:
        first.put("/api/v1/missions/m1_sar", json={"par_time_s": 111})
    with TestClient(create_app(settings)) as second:
        assert second.get("/api/v1/missions/m1_sar").json()["par_time_s"] == 111
        assert second.get("/api/v1/missions/m2_foto").json()["par_time_s"] == 300
