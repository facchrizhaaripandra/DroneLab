"""The mock drone flies every mission from start to finish against a real server."""

import httpx
import pytest
from api_helpers import WORLDS

from tools.mock_drone import fly_mission

VARIANTS = sorted(p.stem.split("__") for p in WORLDS.glob("*__*.json"))


@pytest.mark.parametrize(("mission_id", "variant"), VARIANTS, ids=["-".join(v) for v in VARIANTS])
async def test_mock_drone_completes_the_mission(live_server, mission_id, variant):
    flown = await fly_mission(live_server, mission_id, variant)
    assert (flown["state"], flown["reason"]) == ("mendarat", "completed")
    assert flown["result"]["score"] >= 50, flown["result"]["breakdown"]
    async with httpx.AsyncClient(base_url=live_server) as client:
        detail = (await client.get(f"/api/v1/runs/{flown['run_id']}")).json()
        assert [t["state"] for t in detail["transitions"]] == [
            "siap",
            "lepas_landas",
            "menjalankan",
            "kembali",
            "mendarat",
        ]
        replay = (await client.post(f"/api/v1/runs/{flown['run_id']}/replay")).json()
        assert replay["identical"] is True


async def test_default_variant_and_a_faster_telemetry_rate(live_server):
    flown = await fly_mission(live_server, "m4_delivery", hz=20)
    assert flown["state"] == "mendarat"
    async with httpx.AsyncClient(base_url=live_server) as client:
        log = (await client.get(f"/api/v1/runs/{flown['run_id']}/telemetry")).json()["log"]
    times = [e["t_ms"] for e in log if e["type"] == "sample"]
    assert times[1] - times[0] == 50
