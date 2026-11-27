"""Recomputes a finished run from its stored log. The same log must give the same result."""

import json

from app.db.repo import Repo, dumps
from app.errors import ApiError
from app.mission.engine import run_engine
from app.scoring import score_run


def replay_run(repo: Repo, run_id: str) -> dict:
    """Returns {"result", "identical"}: identical compares score, states and reason."""
    run = repo.get_run(run_id)
    if run is None:
        raise ApiError(404, "unknown_run", "Run tidak ditemukan")
    if not run["finished"]:
        raise ApiError(409, "run_not_finished", "Run belum selesai")
    log = repo.get_log(run_id)
    mission, finish = run["mission"], run["finish"]
    engine = run_engine(
        mission["scorer"], mission["par_time_s"], run["config"], run["limits"], log, finish
    )
    result = score_run(mission, run["config"], log, {**finish, "reason": engine.reason})
    result = json.loads(dumps(result))  # compare in the form it is stored in
    identical = (result, engine.reason, engine.transitions) == (
        run["result"],
        run["reason"],
        run["transitions"],
    )
    return {"result": result, "identical": identical}
