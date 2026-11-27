"""Client for the AI service (role C): detection, plus the optional command and decide calls."""

import asyncio
import itertools
import time

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.errors import ApiError
from app.models.contract import CameraPose, DetectorReply

IMAGE_W, IMAGE_H = 640, 360  # the simulator sends frames of this size


class DetectorClient:
    def __init__(
        self,
        base_url: str,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.settings = settings
        self.http = httpx.AsyncClient(base_url=base_url, transport=transport)
        self._frames = itertools.count(1)

    async def close(self) -> None:
        await self.http.aclose()

    async def healthy(self) -> bool:
        """Never raises and never takes longer than the health timeout."""
        limit = self.settings.health_timeout_s
        try:
            response = await asyncio.wait_for(self.http.get("/health", timeout=limit), limit)
        except (httpx.HTTPError, TimeoutError):
            return False
        return response.status_code == 200

    async def _post(self, path: str, body: dict, limit: float) -> dict:
        try:
            response = await asyncio.wait_for(self.http.post(path, json=body, timeout=limit), limit)
            response.raise_for_status()
        except (httpx.HTTPError, TimeoutError) as e:
            raise ApiError(503, "ai_down", "Layanan AI tidak aktif") from e
        try:
            data = response.json()
        except ValueError:
            data = None
        if not isinstance(data, dict):
            raise ApiError(502, "ai_bad_response", "Jawaban layanan AI tidak dikenali")
        return data

    async def detect(self, image: str, camera_pose: CameraPose | None) -> dict:
        """Sends a frame in the contract format and returns it in the simulator's format."""
        body = {
            "frame_id": f"f_{next(self._frames)}",
            "image_b64": image,
            "camera_pose": camera_pose.model_dump() if camera_pose else None,
        }
        started = time.perf_counter()
        data = await self._post("/detect", body, self.settings.ai_timeout_s)
        latency = (time.perf_counter() - started) * 1000
        try:
            reply = DetectorReply.model_validate(data)
        except ValidationError as e:
            raise ApiError(502, "ai_bad_response", "Jawaban detektor tidak sesuai kontrak") from e
        objects = [
            {
                "label": d.cls,
                "score": d.conf,
                "box": [
                    round(d.bbox[0] / IMAGE_W, 4),
                    round(d.bbox[1] / IMAGE_H, 4),
                    round((d.bbox[2] - d.bbox[0]) / IMAGE_W, 4),
                    round((d.bbox[3] - d.bbox[1]) / IMAGE_H, 4),
                ],
                "world_pos": d.world_pos,
            }
            for d in reply.detections
        ]
        return {"objects": objects, "latency_ms": round(latency, 1), "model": reply.model}

    async def command(self, body: dict) -> dict:
        return await self._post("/command", body, self.settings.llm_timeout_s)

    async def decide(self, body: dict) -> dict:
        return await self._post("/decide", body, self.settings.ai_timeout_s)
