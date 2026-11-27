"""Writes the JSON schemas of the contract to contracts/schemas/.

python tools/export_schemas.py
"""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.models.contract import (  # noqa: E402
    DetectRequest,
    Event,
    Finish,
    PlanRequest,
    PlanResponse,
    TelemetryFrame,
    Waypoint,
)
from app.models.mission import Mission  # noqa: E402
from app.models.world import World  # noqa: E402

MODELS = [
    DetectRequest,
    Event,
    Finish,
    Mission,
    PlanRequest,
    PlanResponse,
    TelemetryFrame,
    Waypoint,
    World,
]


def build() -> dict[str, dict]:
    return {model.__name__: model.model_json_schema() for model in MODELS}


def main() -> None:
    out = BACKEND / "contracts" / "schemas"
    out.mkdir(parents=True, exist_ok=True)
    for name, schema in build().items():
        text = json.dumps(schema, indent=2, ensure_ascii=False) + "\n"
        (out / f"{name}.json").write_text(text, encoding="utf-8")
    print(f"{len(MODELS)} skema ditulis ke {out}")


if __name__ == "__main__":
    main()
