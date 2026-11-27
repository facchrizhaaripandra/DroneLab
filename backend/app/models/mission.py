"""Mission definitions (worlds/missions.json and the mission CRUD)."""

from typing import Annotated

from pydantic import BaseModel, Field

Weight = Annotated[float, Field(ge=0, le=1000, allow_inf_nan=False)]
Variants = Annotated[
    list[Annotated[str, Field(pattern=r"^[A-Za-z0-9-]{1,40}$")]], Field(min_length=1)
]


class MissionCreate(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9_]{1,40}$")
    title: str = Field(min_length=1, max_length=120)
    desc: str = Field(default="", max_length=1000)
    scorer: str
    par_time_s: float = Field(gt=0, le=36_000, allow_inf_nan=False)
    variants: Variants
    weights: dict[str, Weight]
    gugur: list[str] = []


class MissionUpdate(BaseModel):
    """Everything but the id and the scorer can change."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    desc: str | None = Field(default=None, max_length=1000)
    par_time_s: float | None = Field(default=None, gt=0, le=36_000, allow_inf_nan=False)
    variants: Variants | None = None
    weights: dict[str, Weight] | None = None
    gugur: list[str] | None = None


class Mission(MissionCreate):
    builtin: bool
