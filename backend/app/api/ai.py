"""Requests the gateway forwards: the simulator and tools never call B or C directly."""

from fastapi import APIRouter, Request

from app.models.contract import (
    CommandRequest,
    DecideRequest,
    DetectRequest,
    DetectResponse,
    PlanRequest,
    PlanResponse,
)

router = APIRouter(prefix="/api/v1", tags=["ai"])


@router.post("/detect", response_model=DetectResponse)
async def detect(body: DetectRequest, request: Request):
    return await request.app.state.detector.detect(body.image, body.camera_pose)


@router.post("/command")
async def command(body: CommandRequest, request: Request) -> dict:
    reply = await request.app.state.detector.command(body.model_dump())
    return {**reply, "api_version": "1"}


@router.post("/decide")
async def decide(body: DecideRequest, request: Request) -> dict:
    reply = await request.app.state.detector.decide(body.model_dump())
    return {**reply, "api_version": "1"}


@router.post("/plan", response_model=PlanResponse)
async def plan(body: PlanRequest, request: Request):
    return await request.app.state.planner.plan(body)
