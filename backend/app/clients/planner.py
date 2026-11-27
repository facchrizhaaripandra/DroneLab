"""Client for the path planner (role B)."""

import asyncio

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.errors import ApiError
from app.models.contract import PlanRequest, PlanResponse


class PlannerClient:
    def __init__(
        self,
        base_url: str,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.settings = settings
        self.http = httpx.AsyncClient(base_url=base_url, transport=transport)

    async def close(self) -> None:
        await self.http.aclose()

    async def plan(self, request: PlanRequest) -> PlanResponse:
        limit = self.settings.planner_timeout_s
        try:
            response = await asyncio.wait_for(
                self.http.post("/plan", json=request.model_dump(), timeout=limit), limit
            )
            response.raise_for_status()
        except (httpx.HTTPError, TimeoutError) as e:
            raise ApiError(503, "planner_down", "Layanan perencana jalur tidak aktif") from e
        try:
            return PlanResponse.model_validate_json(response.content)
        except ValidationError as e:
            raise ApiError(
                502, "planner_bad_response", "Jawaban perencana tidak sesuai kontrak"
            ) from e
