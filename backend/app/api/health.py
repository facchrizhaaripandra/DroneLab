from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: str = "ok"
    api_version: str = "1"
    ai: str = "down"  # "ok" or "down": is the AI service behind the gateway alive


@router.get("/health", response_model=Health)
async def health(request: Request) -> Health:
    alive = await request.app.state.detector.healthy()
    return Health(ai="ok" if alive else "down")
