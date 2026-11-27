"""Database tables. Structured values are stored as JSON text."""

from sqlmodel import Field, SQLModel


class MissionRow(SQLModel, table=True):
    __tablename__ = "missions"
    id: str = Field(primary_key=True)
    builtin: bool = False
    edited: bool = False  # a built-in mission changed through the API is no longer refreshed
    data: str


class WorldRow(SQLModel, table=True):
    __tablename__ = "worlds"
    id: str = Field(primary_key=True)  # "<mission_id>__<variant>"
    mission_id: str = Field(index=True)
    variant: str
    builtin: bool = False
    data: str  # seed, limits, config


class RunRow(SQLModel, table=True):
    __tablename__ = "runs"
    id: int | None = Field(default=None, primary_key=True)
    mission_id: str = Field(index=True)
    variant: str
    player: str
    seed: int
    created_at: str  # for listing only, never used for scoring
    config: str
    limits: str
    mission: str  # the mission definition at the time the run started
    finished: bool = False
    finish: str | None = None
    result: str | None = None
    score: int | None = Field(default=None, index=True)
    state: str | None = None
    reason: str | None = None
    transitions: str | None = None


class EventRow(SQLModel, table=True):
    __tablename__ = "events"
    id: int | None = Field(default=None, primary_key=True)
    run_id: int = Field(index=True, foreign_key="runs.id")
    t_ms: float
    type: str
    data: str


class TelemetryRow(SQLModel, table=True):
    __tablename__ = "telemetry"
    id: int | None = Field(default=None, primary_key=True)
    run_id: int = Field(index=True, foreign_key="runs.id")
    t_ms: float
    data: str


class ScoreRow(SQLModel, table=True):
    __tablename__ = "scores"
    id: int | None = Field(default=None, primary_key=True)
    run_id: int = Field(index=True, foreign_key="runs.id")
    name: str
    points: float
    max_points: float
    note: str
