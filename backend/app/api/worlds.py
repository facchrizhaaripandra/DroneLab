"""CRUD for worlds. A world is one (mission_id, variant) pair; the exported ones are read-only."""

from fastapi import APIRouter, Request

from app.errors import ApiError
from app.models.contract import Ok
from app.models.world import World, WorldCreate, WorldUpdate, check_world_config

router = APIRouter(prefix="/api/v1/worlds", tags=["worlds"])


def _require(request: Request, world_id: str) -> dict:
    world = request.app.state.repo.get_world_by_id(world_id)
    if world is None:
        raise ApiError(404, "unknown_world", "Dunia tidak ditemukan")
    return world


def _writable(world: dict) -> dict:
    if world["builtin"]:
        raise ApiError(403, "read_only", "Dunia bawaan tidak bisa diubah atau dihapus")
    return world


def _check(request: Request, mission_id: str, config: dict) -> None:
    mission = request.app.state.repo.get_mission(mission_id)
    if mission is None:
        raise ApiError(404, "unknown_mission", "Misi tidak dikenal")
    try:
        check_world_config(mission["scorer"], config)
    except ValueError as e:
        raise ApiError(400, "invalid_world", str(e)) from e


@router.get("", response_model=list[World])
async def list_worlds(request: Request, mission_id: str | None = None):
    return request.app.state.repo.list_worlds(mission_id)


@router.get("/{world_id}", response_model=World)
async def get_world(world_id: str, request: Request):
    return _require(request, world_id)


@router.post("", response_model=World, status_code=201)
async def create_world(body: WorldCreate, request: Request):
    _check(request, body.mission_id, body.config)
    data = {"seed": body.seed, "limits": body.limits.model_dump(), "config": body.config}
    key = request.app.state.repo.create_world(body.mission_id, body.variant, data)
    if key is None:
        raise ApiError(409, "conflict", "Misi dan varian ini sudah ada")
    return _require(request, key)


@router.put("/{world_id}", response_model=World)
async def update_world(world_id: str, body: WorldUpdate, request: Request):
    world = _writable(_require(request, world_id))
    data = {k: world[k] for k in ("seed", "limits", "config")}
    data.update(body.model_dump(exclude_none=True))
    _check(request, world["mission_id"], data["config"])
    request.app.state.repo.update_world(world_id, data)
    return _require(request, world_id)


@router.delete("/{world_id}", response_model=Ok)
async def delete_world(world_id: str, request: Request):
    _writable(_require(request, world_id))
    request.app.state.repo.delete_world(world_id)
    return Ok()
