"""Mission state machine.

    siap -> lepas_landas -> menjalankan -> kembali -> mendarat
    (any state before the end) -> gagal

The engine only reads the run log and the finish record, so replaying a stored run gives the
same states. Collisions do not fail a mission on their own: the drone has to crash, exactly as
in the simulator.
"""

from app.scoring import SCORERS, sort_log
from app.scoring.base import is_usable

TAKEOFF_HEIGHT = 2.0  # m above the first sample: the mission is now running
TIME_GRACE_MS = 1000  # tolerance on the "twice the par time" limit
MAP_GRACE_M = 1.0
END_STATES = ("mendarat", "gagal")


class MissionEngine:
    def __init__(self, scorer_key: str, par_time_s: float, config: dict, limits: dict):
        self.par_time_s, self.limits = par_time_s, limits
        self.goals = SCORERS[scorer_key].tracker(config)
        self.state = "siap"
        self.reason: str | None = None
        self.transitions = [{"t_ms": 0, "state": "siap"}]
        self.start_y: float | None = None
        self.out_of_area = False

    def _go(self, state: str, t_ms: float) -> None:
        self.state = state
        self.transitions.append({"t_ms": t_ms, "state": state})

    def _check_goals(self, t_ms: float) -> None:
        if self.goals.met and self.state in ("lepas_landas", "menjalankan"):
            if self.state == "lepas_landas":
                self._go("menjalankan", t_ms)
            self._go("kembali", t_ms)

    def feed(self, entry: dict) -> None:
        if self.state in END_STATES or not is_usable(entry):
            return
        t_ms, kind = entry["t_ms"], entry["type"]
        self.goals.feed(entry)
        if kind == "takeoff" and self.state == "siap":
            self._go("lepas_landas", t_ms)
        elif kind == "sample":
            x, y, z = entry["pos"]
            if self.start_y is None:
                self.start_y = y
            lim, g = self.limits, MAP_GRACE_M
            if not (
                lim["minX"] - g <= x <= lim["maxX"] + g and lim["minZ"] - g <= z <= lim["maxZ"] + g
            ):
                self.out_of_area = True
            if self.state == "lepas_landas" and y - self.start_y >= TAKEOFF_HEIGHT:
                self._go("menjalankan", t_ms)
        else:
            self._check_goals(t_ms)

    def finish(self, finish: dict) -> str:
        """Ends the run and returns the final reason. A second call changes nothing."""
        if self.state in END_STATES:
            return self.reason
        reason = finish["reason"]
        if reason == "completed":
            if finish["t_ms"] > 2 * self.par_time_s * 1000 + TIME_GRACE_MS:
                reason = "timeout"
            elif self.out_of_area:
                reason = "out_of_area"
        self.reason = reason
        if reason == "completed":
            self._check_goals(finish["t_ms"])
            self._go("mendarat", finish["t_ms"])
        else:
            self._go("gagal", finish["t_ms"])
        return reason


def run_engine(
    scorer_key: str,
    par_time_s: float,
    config: dict,
    limits: dict,
    log: list[dict],
    finish: dict | None = None,
) -> MissionEngine:
    """Feeds a stored log in scoring order, then the finish record if there is one."""
    engine = MissionEngine(scorer_key, par_time_s, config, limits)
    for entry in sort_log(log):
        engine.feed(entry)
    if finish is not None:
        engine.finish(finish)
    return engine
