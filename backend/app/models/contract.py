"""The wire format, as the simulator speaks it (contract v0.2). Times are t_ms, units are metres."""

import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# int or float, so a stored log keeps the numbers exactly as they arrived
Millis = Annotated[int | float, Field(ge=0, allow_inf_nan=False)]
Number = Annotated[int | float, Field(allow_inf_nan=False)]
Vector = Annotated[list[Number], Field(min_length=3, max_length=3)]
FinishReason = Literal["completed", "timeout", "battery", "crashed", "drowned", "out_of_area"]


class RunCreate(BaseModel):
    mission_id: str = Field(min_length=1, max_length=40)
    variant: str | None = Field(default=None, max_length=40)
    player: str = Field(default="anon", min_length=1, max_length=40)


class RunCreated(BaseModel):
    api_version: str = "1"
    run_id: str
    seed: int
    config: dict


def _finite(value) -> bool:
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(_finite(v) for v in value.values())
    if isinstance(value, list):
        return all(_finite(v) for v in value)
    return True


class Event(BaseModel):
    """A mission event (photo, mark, drop, spray, wind, ...). Extra fields are kept as sent."""

    model_config = ConfigDict(extra="allow")

    t_ms: Millis
    type: str = Field(min_length=1, max_length=40)

    @model_validator(mode="before")
    @classmethod
    def no_nan(cls, data):
        if not _finite(data):
            raise ValueError("numbers must be finite")
        return data


class Ok(BaseModel):
    api_version: str = "1"
    ok: bool = True


class TelemetryFrame(BaseModel):
    """One 10 Hz WebSocket frame."""

    t_ms: Millis
    pos: Vector
    vel: Vector
    yaw: Number
    roll: Number = 0
    pitch: Number = 0
    gimbal: Number = -10
    battery: Number = 100
    payload_kg: Number = 0
    spraying: bool = False
    collision: bool = False


class Finish(BaseModel):
    t_ms: Millis
    battery: Annotated[int | float, Field(ge=0, le=100, allow_inf_nan=False)]
    reason: FinishReason
    progress: Number | None = None


class Component(BaseModel):
    name: str
    points: float
    max: float
    note: str


class ScoreResult(BaseModel):
    """Score of a run. Missions add their own fields (details, report, found, ...)."""

    model_config = ConfigDict(extra="allow")

    api_version: str = "1"
    score: int
    grade: Literal["gold", "silver", "bronze", "none"]
    breakdown: list[Component]


class InspectionReport(BaseModel):
    api_version: str = "1"
    defects: list[dict]
    coverage: float
    panels: dict
    wrong_marks: int


class RunSummary(BaseModel):
    run_id: str
    mission_id: str
    variant: str
    player: str
    created_at: str
    finished: bool
    score: int | None
    state: str | None
    reason: str | None


class RunDetail(BaseModel):
    api_version: str = "1"
    run_id: str
    mission_id: str
    variant: str
    player: str
    seed: int
    created_at: str
    finished: bool
    state: str
    reason: str | None
    transitions: list[dict]
    finish: dict | None
    result: dict | None
    config: dict
    limits: dict


class RunLog(BaseModel):
    api_version: str = "1"
    run_id: str
    log: list[dict]


class Replay(BaseModel):
    api_version: str = "1"
    run_id: str
    identical: bool
    result: dict


# ---- planner (role B), contract v0.1 ----
Action = Literal["fly", "spray", "drop", "capture", "hover"]


class Waypoint(BaseModel):
    id: int
    x: Number
    y: Number
    z: Number
    speed: Annotated[int | float, Field(ge=0, allow_inf_nan=False)]
    action: Action
    params: dict = {}


class PlanRequest(BaseModel):
    scenario: str = Field(min_length=1, max_length=40)  # a mission id
    world: dict
    goal: dict | list
    params: dict = {}


class PlanStats(BaseModel):
    length_m: Number
    est_time_s: Number
    est_energy: Number
    coverage_pct: Number
    compute_ms: Number


class PlanResponse(BaseModel):
    waypoints: list[Waypoint]
    stats: PlanStats


# ---- AI services (role C) ----
class CameraPose(BaseModel):
    pos: Vector
    quat: Annotated[list[Number], Field(min_length=4, max_length=4)]
    fov: Number


class DetectRequest(BaseModel):
    image: str = Field(min_length=1, max_length=8_000_000)  # base64 JPEG, 640 x 360
    mode: Literal["normal", "thermal"] = "normal"
    camera_pose: CameraPose | None = None


class Detection(BaseModel):
    """One detection as the detector sends it; bbox in pixels of the image."""

    cls: str
    conf: Number
    bbox: Annotated[list[Number], Field(min_length=4, max_length=4)]
    world_pos: Vector | None = None


class DetectorReply(BaseModel):
    frame_id: str
    detections: list[Detection]
    model: str = "detector"


class DetectedObject(BaseModel):
    """One detection as the simulator reads it; box = [x, y, w, h] in 0..1."""

    label: str
    score: float
    box: list[float]
    world_pos: list[float] | None = None


class DetectResponse(BaseModel):
    api_version: str = "1"
    objects: list[DetectedObject]
    latency_ms: float
    model: str


class CommandRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    context: dict = {}


class DecideRequest(BaseModel):
    obs: list[Number] = Field(max_length=4096)


class MissionSummary(BaseModel):
    id: str
    title: str
    variants: list[str]
    par_time_s: float


class LeaderboardRow(BaseModel):
    rank: int
    player: str
    score: int
