"""World files: the part of a world config each scorer reads. Other fields pass through as they are.

The simulator builds the 3D world from the same config, so unknown fields are allowed.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

Number = Annotated[float, Field(allow_inf_nan=False)]
Positive = Annotated[float, Field(gt=0, allow_inf_nan=False)]
Point2 = Annotated[list[Number], Field(min_length=2, max_length=2)]
MAX_FIELD_CELLS = 100_000


class Open(BaseModel):
    model_config = ConfigDict(extra="allow")


class Rect(Open):
    min: Point2
    max: Point2


class Spot(Open):
    x: Number
    z: Number


class Zone(Spot):
    r: Positive


# ---- M1 ----
class Victim(Spot):
    id: int


class SarMission(Open):
    area: Rect
    victims: list[Victim] = Field(min_length=1)
    markRadius: Positive | None = None

    @model_validator(mode="after")
    def area_has_size(self):
        if any(lo >= hi for lo, hi in zip(self.area.min, self.area.max, strict=True)):
            raise ValueError("area.max must be larger than area.min")
        return self


# ---- M2 ----
class Landmark(Spot):
    id: str
    y: Number
    hx: Positive | None = None
    hy: Positive | None = None


class Shot(Open):
    id: str
    type: Literal["photo", "video"]
    subject: str
    kind: str | None = None
    areaRange: Point2 | None = None
    minDur: Positive | None = None
    maxDur: Positive | None = None

    @model_validator(mode="after")
    def complete(self):
        if self.type == "video" and (self.minDur is None or self.maxDur is None):
            raise ValueError("a video shot needs minDur and maxDur")
        if self.areaRange and not 0 < self.areaRange[0] <= self.areaRange[1] < 1:
            raise ValueError("areaRange must be 0 < low <= high < 1")
        return self


class Sun(Open):
    az: Number


class PhotoMission(Open):
    landmarks: list[Landmark] = Field(min_length=1)
    sun: Sun
    shots: list[Shot] = Field(min_length=1)

    @model_validator(mode="after")
    def subjects_exist(self):
        known = {lm.id for lm in self.landmarks}
        missing = {s.subject for s in self.shots} - known
        if missing:
            raise ValueError(f"unknown shot subject: {', '.join(sorted(missing))}")
        return self


# ---- M3 ----
class FieldGrid(Rect):
    cell: Positive


class Dose(Open):
    lo: Positive
    hi: Positive
    flow: Positive
    capacity: Positive


class AgriMission(Open):
    field: FieldGrid
    noSpray: list[Rect]
    dose: Dose

    @model_validator(mode="after")
    def field_is_reasonable(self):
        width, depth = (self.field.max[i] - self.field.min[i] for i in (0, 1))
        cells = (width / self.field.cell) * (depth / self.field.cell)
        if width <= 0 or depth <= 0 or cells > MAX_FIELD_CELLS:
            raise ValueError(f"the field needs a size and at most {MAX_FIELD_CELLS} cells")
        return self


# ---- M4 ----
class DeliveryMission(Open):
    pickup: Zone
    drop: Zone
    noFly: list[Rect] = []


# ---- M5 ----
class Structure(Spot):
    w: Positive
    d: Positive
    y0: Number
    y1: Number


class Panel(Spot):
    id: int
    y: Number
    nx: Number
    nz: Number


class Defect(Spot):
    id: int
    y: Number
    size: Positive


class SafeRange(Open):
    min: Number
    max: Number


class InspectionMission(Open):
    structure: Structure
    panels: list[Panel] = Field(min_length=1)
    defects: list[Defect] = Field(min_length=1)
    safe: SafeRange


MISSION_MODELS: dict[str, type[BaseModel]] = {
    "sar": SarMission,
    "photo": PhotoMission,
    "agri": AgriMission,
    "delivery": DeliveryMission,
    "inspection": InspectionMission,
}


class Wind(Open):
    speed: Number
    dir: Number


class WorldConfig(Open):
    mission: dict
    wind: Wind | None = None
    weights: dict[str, Number] | None = None


class Limits(BaseModel):
    """Map rectangle. Leaving it fails the mission."""

    minX: Number
    maxX: Number
    minZ: Number
    maxZ: Number

    @model_validator(mode="after")
    def ordered(self):
        if self.minX >= self.maxX or self.minZ >= self.maxZ:
            raise ValueError("limits must have min < max")
        return self


class WorldCreate(BaseModel):
    mission_id: str = Field(min_length=1, max_length=40)
    variant: str = Field(pattern=r"^[A-Za-z0-9-]{1,40}$")
    seed: int = 42
    limits: Limits
    config: dict


class WorldUpdate(BaseModel):
    seed: int | None = None
    limits: Limits | None = None
    config: dict | None = None


class World(WorldCreate):
    """A stored world, as the API returns it."""

    id: str
    builtin: bool


def check_world_config(scorer: str, config: dict) -> None:
    """Raises ValueError with a readable message when a scorer could not use this config."""
    try:
        world = WorldConfig.model_validate(config)
        MISSION_MODELS[scorer].model_validate(world.mission)
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise ValueError(f"{where}: {first['msg']}") from e
