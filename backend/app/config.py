"""Gateway settings. Every value can be overridden with an environment variable."""

import os
from dataclasses import dataclass, field, fields

DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


@dataclass
class Settings:
    db_path: str = "data/dronelab.db"
    worlds_dir: str = "worlds"
    allowed_origins: list[str] = field(default_factory=lambda: list(DEFAULT_ORIGINS))
    planner_url: str = "http://localhost:8001"
    detector_url: str = "http://localhost:8002"
    ai_timeout_s: float = 2.0
    llm_timeout_s: float = 10.0
    planner_timeout_s: float = 10.0
    health_timeout_s: float = 0.5
    flush_interval_s: float = 1.0
    ws_drain_s: float = 0.5

    @classmethod
    def from_env(cls) -> "Settings":
        values = {}
        for f in fields(cls):
            raw = os.environ.get(f.name.upper())
            if raw is None or raw == "":
                continue
            if f.name == "allowed_origins":
                values[f.name] = [o.strip() for o in raw.split(",") if o.strip()]
            elif f.type is float:
                values[f.name] = float(raw)
            else:
                values[f.name] = raw
        return cls(**values)
