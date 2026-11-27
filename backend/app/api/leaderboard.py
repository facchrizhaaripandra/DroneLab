from fastapi import APIRouter, Query, Request

from app.models.contract import LeaderboardRow

router = APIRouter(prefix="/api/v1/leaderboard", tags=["leaderboard"])


@router.get("", response_model=list[LeaderboardRow])
async def leaderboard(
    request: Request,
    mission_id: str | None = None,
    variant: str | None = None,
    limit: int = Query(default=10, ge=1, le=100),
):
    return request.app.state.repo.leaderboard(mission_id, variant, limit)
