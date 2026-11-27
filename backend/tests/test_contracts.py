"""The files in contracts/ are the shared source of truth; they must match the Pydantic models."""

import json
from pathlib import Path

from tools.export_schemas import build

CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"
NAMES = [
    "DetectRequest",
    "Event",
    "Finish",
    "Mission",
    "PlanRequest",
    "PlanResponse",
    "TelemetryFrame",
    "Waypoint",
    "World",
]


def test_version():
    assert (CONTRACTS / "VERSION").read_text("utf-8").strip() == "0.2"


def test_schema_files_match_the_models():
    schemas = build()
    assert sorted(schemas) == NAMES
    files = sorted(p.stem for p in (CONTRACTS / "schemas").glob("*.json"))
    assert files == NAMES
    for name, schema in schemas.items():
        stored = json.loads((CONTRACTS / "schemas" / f"{name}.json").read_text("utf-8"))
        assert stored == schema, f"run tools/export_schemas.py ({name} is stale)"


def test_world_schema_describes_the_map_limits():
    assert "Limits" in build()["World"]["$defs"]
