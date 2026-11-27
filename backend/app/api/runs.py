from fastapi import APIRouter, Query, Request

from app.models.contract import (
    Event,
    Finish,
    InspectionReport,
    Ok,
    Replay,
    RunCreate,
    RunCreated,
    RunDetail,
    RunLog,
    RunSummary,
    ScoreResult,
)
from app.replay import replay_run

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


@router.get("", response_model=list[RunSummary])
async def list_runs(request: Request, limit: int = Query(default=50, ge=1, le=500)):
    return request.app.state.repo.list_runs(limit)


@router.post("", response_model=RunCreated)
async def start_run(body: RunCreate, request: Request):
    return request.app.state.service.start(body.mission_id, body.variant, body.player)


@router.get("/{run_id}", response_model=RunDetail)
async def run_detail(run_id: str, request: Request):
    return request.app.state.service.detail(run_id)


@router.post("/{run_id}/events", response_model=Ok)
async def add_event(run_id: str, event: Event, request: Request):
    request.app.state.service.add_event(run_id, event.model_dump())
    return Ok()


@router.post("/{run_id}/finish", response_model=ScoreResult)
async def finish_run(run_id: str, body: Finish, request: Request):
    return await request.app.state.service.finish(run_id, body.model_dump(exclude_none=True))


@router.get("/{run_id}/report", response_model=InspectionReport)
async def report(run_id: str, request: Request):
    return request.app.state.service.report(run_id)


@router.get("/{run_id}/telemetry", response_model=RunLog)
async def telemetry_log(run_id: str, request: Request):
    return {"run_id": run_id, "log": request.app.state.service.entries(run_id)}


@router.post("/{run_id}/replay", response_model=Replay)
async def replay(run_id: str, request: Request):
    request.app.state.hub.flush(run_id)
    return {"run_id": run_id, **replay_run(request.app.state.repo, run_id)}
