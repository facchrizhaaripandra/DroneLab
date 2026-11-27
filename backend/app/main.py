"""DroneLab3D gateway (role A). Run: uvicorn app.main:app --port 8000"""

import asyncio
import contextlib
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import ai, health, leaderboard, missions, runs, worlds, ws
from app.clients.detector import DetectorClient
from app.clients.planner import PlannerClient
from app.config import Settings
from app.db.repo import Repo
from app.errors import install_error_handlers
from app.service import RunService
from app.telemetry import TelemetryHub

ROOT = Path(__file__).resolve().parent.parent  # backend/: relative paths start here


def create_app(
    settings: Settings | None = None,
    ai_transport: httpx.AsyncBaseTransport | None = None,
    planner_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """The transports are for tests: they stand in for the services of roles B and C."""
    settings = settings or Settings.from_env()

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        repo = Repo(str(ROOT / settings.db_path))
        repo.seed_builtins(str(ROOT / settings.worlds_dir))
        hub = TelemetryHub(repo, settings.flush_interval_s)
        app.state.repo, app.state.hub = repo, hub
        app.state.service = RunService(repo, hub, settings)
        detector = DetectorClient(settings.detector_url, settings, ai_transport)
        planner = PlannerClient(settings.planner_url, settings, planner_transport)
        app.state.detector, app.state.planner = detector, planner

        async def flush_regularly():  # frames of a drone that stopped sending still get stored
            while True:
                await asyncio.sleep(settings.flush_interval_s)
                hub.flush_idle()

        flusher = asyncio.create_task(flush_regularly())
        try:
            yield
        finally:
            flusher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await flusher
            hub.flush_all()
            repo.close()
            await detector.close()
            await planner.close()

    app = FastAPI(title="DroneLab3D Gateway", version="0.2.0", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    install_error_handlers(app)
    for module in (health, missions, worlds, runs, leaderboard, ai, ws):
        app.include_router(module.router)
    return app


app = create_app()
