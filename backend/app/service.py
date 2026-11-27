"""Run lifecycle: start, collect the log, finish and score."""

import asyncio

from app.config import Settings
from app.db.repo import Repo
from app.errors import ApiError
from app.mission.engine import run_engine
from app.scoring import score_run
from app.scoring.m5_inspection import inspection_report
from app.telemetry import TelemetryHub


class RunService:
    def __init__(self, repo: Repo, hub: TelemetryHub, settings: Settings):
        self.repo, self.hub, self.settings = repo, hub, settings
        self._locks: dict[str, asyncio.Lock] = {}

    def require_run(self, run_id: str) -> dict:
        run = self.repo.get_run(run_id)
        if run is None:
            raise ApiError(404, "unknown_run", "Run tidak ditemukan")
        return run

    def start(self, mission_id: str, variant: str | None, player: str) -> dict:
        mission = self.repo.get_mission(mission_id)
        if mission is None:
            raise ApiError(404, "unknown_mission", "Misi tidak dikenal")
        world = self.repo.get_world(mission_id, variant) if variant else None
        if world is None:  # an unknown variant means the first one
            world = self.repo.get_world(mission_id, mission["variants"][0])
        if world is None:
            raise ApiError(404, "unknown_world", "Dunia untuk misi ini belum ada")
        run_id = self.repo.create_run(
            mission_id,
            world["variant"],
            player,
            world["seed"],
            world["config"],
            world["limits"],
            mission,
        )
        return {"run_id": run_id, "seed": world["seed"], "config": world["config"]}

    def add_event(self, run_id: str, event: dict) -> None:
        finished = self.repo.run_status(run_id)
        if finished is None:
            raise ApiError(404, "unknown_run", "Run tidak ditemukan")
        if finished:
            raise ApiError(409, "run_finished", "Run sudah selesai")
        self.repo.add_entries(run_id, [event])

    def log(self, run_id: str) -> list[dict]:
        self.hub.flush(run_id)
        return self.repo.get_log(run_id)

    def detail(self, run_id: str) -> dict:
        run = self.require_run(run_id)
        if not run["finished"]:  # live state, derived from the log so far
            mission = run["mission"]
            engine = run_engine(
                mission["scorer"],
                mission["par_time_s"],
                run["config"],
                run["limits"],
                self.log(run_id),
            )
            run.update(state=engine.state, transitions=engine.transitions)
        return run

    def entries(self, run_id: str) -> list[dict]:
        self.require_run(run_id)
        return sorted(self.log(run_id), key=lambda e: (e["t_ms"], e["type"] == "sample"))

    async def finish(self, run_id: str, finish: dict) -> dict:
        """Scores the run once. Later calls return the stored result."""
        self.require_run(run_id)
        async with self._locks.setdefault(run_id, asyncio.Lock()):
            run = self.require_run(run_id)
            if run["finished"]:
                return run["result"]
            await self.hub.wait_closed(run_id, self.settings.ws_drain_s)
            log = self.log(run_id)
            mission = run["mission"]
            engine = run_engine(
                mission["scorer"],
                mission["par_time_s"],
                run["config"],
                run["limits"],
                log,
                finish,
            )
            result = score_run(mission, run["config"], log, {**finish, "reason": engine.reason})
            self.repo.save_result(
                run_id, finish, result, engine.state, engine.reason, engine.transitions
            )
            self.hub.seal(run_id)
            return result

    def report(self, run_id: str) -> dict:
        run = self.require_run(run_id)
        if run["mission"]["scorer"] != "inspection":
            raise ApiError(404, "no_report", "Laporan hanya untuk inspeksi")
        return inspection_report(run["config"], self.log(run_id))
