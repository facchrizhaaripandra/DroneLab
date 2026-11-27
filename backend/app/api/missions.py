"""Mission list for the simulator, and mission CRUD."""

from fastapi import APIRouter, Request

from app.errors import ApiError
from app.models.contract import MissionSummary, Ok
from app.models.mission import Mission, MissionCreate, MissionUpdate
from app.scoring import SCORERS

router = APIRouter(prefix="/api/v1/missions", tags=["missions"])


def _require(request: Request, mission_id: str) -> dict:
    mission = request.app.state.repo.get_mission(mission_id)
    if mission is None:
        raise ApiError(404, "unknown_mission", "Misi tidak dikenal")
    return mission


def _check(mission: dict) -> None:
    scorer = SCORERS.get(mission["scorer"])
    if scorer is None:
        raise ApiError(400, "invalid_request", f"scorer harus salah satu dari {sorted(SCORERS)}")
    missing = [k for k in scorer.weight_keys if k not in mission["weights"]]
    if missing:
        raise ApiError(400, "invalid_request", f"bobot belum diisi: {', '.join(missing)}")


@router.get("", response_model=list[MissionSummary])
async def list_missions(request: Request):
    return request.app.state.repo.list_missions()


@router.get("/{mission_id}", response_model=Mission)
async def get_mission(mission_id: str, request: Request):
    return _require(request, mission_id)


@router.post("", response_model=Mission, status_code=201)
async def create_mission(body: MissionCreate, request: Request):
    mission = body.model_dump()
    _check(mission)
    if not request.app.state.repo.create_mission(mission):
        raise ApiError(409, "conflict", "Id misi sudah dipakai")
    return _require(request, body.id)


@router.put("/{mission_id}", response_model=Mission)
async def update_mission(mission_id: str, body: MissionUpdate, request: Request):
    mission = _require(request, mission_id)
    mission.pop("builtin")
    mission.update(body.model_dump(exclude_none=True))
    _check(mission)
    request.app.state.repo.update_mission(mission)
    return _require(request, mission_id)


@router.delete("/{mission_id}", response_model=Ok)
async def delete_mission(mission_id: str, request: Request):
    if _require(request, mission_id)["builtin"]:
        raise ApiError(403, "read_only", "Misi bawaan tidak bisa dihapus")
    request.app.state.repo.delete_mission(mission_id)
    return Ok()
