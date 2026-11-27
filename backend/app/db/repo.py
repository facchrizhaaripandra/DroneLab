"""All database access. Callers get and give plain dicts."""

import json
import re
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, event, insert
from sqlmodel import Session, SQLModel, create_engine, select

from app.db.tables import EventRow, MissionRow, RunRow, ScoreRow, TelemetryRow, WorldRow

RUN_ID = re.compile(r"r_([1-9][0-9]{0,15})")


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def world_id(mission_id: str, variant: str) -> str:
    return f"{mission_id}__{variant}"


def _number(run_id: str) -> int | None:
    match = RUN_ID.fullmatch(run_id)
    return int(match.group(1)) if match else None


def _mission(row: MissionRow) -> dict:
    return {**json.loads(row.data), "builtin": row.builtin}


def _world(row: WorldRow) -> dict:
    head = {"id": row.id, "mission_id": row.mission_id, "variant": row.variant}
    return {**head, **json.loads(row.data), "builtin": row.builtin}


class Repo:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
        )

        @event.listens_for(self.engine, "connect")
        def pragmas(connection, _):
            cursor = connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")  # readers do not block the telemetry writer
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        SQLModel.metadata.create_all(self.engine)

    def close(self) -> None:
        self.engine.dispose()

    def _session(self) -> Session:
        return Session(self.engine)

    # ---- missions and worlds ----
    def seed_builtins(self, worlds_dir: str) -> None:
        """Loads the files exported from the simulator. Edited built-in missions are kept."""
        folder = Path(worlds_dir)
        missions = json.loads((folder / "missions.json").read_text(encoding="utf-8"))
        with self._session() as s:
            for m in missions:
                row = s.get(MissionRow, m["id"])
                if row is None:
                    s.add(MissionRow(id=m["id"], builtin=True, data=dumps(m)))
                elif row.builtin and not row.edited:
                    row.data = dumps(m)
                    s.add(row)
            for path in sorted(folder.glob("*__*.json")):
                w = json.loads(path.read_text(encoding="utf-8"))
                key = world_id(w["mission_id"], w["variant"])
                data = dumps({k: w[k] for k in ("seed", "limits", "config")})
                row = s.get(WorldRow, key) or WorldRow(
                    id=key, mission_id=w["mission_id"], variant=w["variant"], data=data
                )
                row.builtin, row.data = True, data
                s.add(row)
            s.commit()

    def list_missions(self) -> list[dict]:
        with self._session() as s:
            return [_mission(r) for r in s.exec(select(MissionRow).order_by(MissionRow.id))]

    def get_mission(self, mission_id: str) -> dict | None:
        with self._session() as s:
            row = s.get(MissionRow, mission_id)
            return _mission(row) if row else None

    def list_worlds(self, mission_id: str | None = None) -> list[dict]:
        query = select(WorldRow).order_by(WorldRow.id)
        if mission_id:
            query = query.where(WorldRow.mission_id == mission_id)
        with self._session() as s:
            return [_world(r) for r in s.exec(query)]

    def get_world_by_id(self, key: str) -> dict | None:
        with self._session() as s:
            row = s.get(WorldRow, key)
            return _world(row) if row else None

    def get_world(self, mission_id: str, variant: str) -> dict | None:
        found = self.get_world_by_id(world_id(mission_id, variant))
        return found if found and found["mission_id"] == mission_id else None

    def create_mission(self, mission: dict) -> bool:
        """False when the id is already taken."""
        with self._session() as s:
            if s.get(MissionRow, mission["id"]):
                return False
            s.add(MissionRow(id=mission["id"], builtin=False, data=dumps(mission)))
            s.commit()
            return True

    def update_mission(self, mission: dict) -> None:
        with self._session() as s:
            row = s.get(MissionRow, mission["id"])
            row.data, row.edited = dumps(mission), True
            s.add(row)
            s.commit()

    def delete_mission(self, mission_id: str) -> None:
        """Removes a mission and its worlds. Finished runs keep their own copy."""
        with self._session() as s:
            s.exec(delete(WorldRow).where(WorldRow.mission_id == mission_id))
            s.exec(delete(MissionRow).where(MissionRow.id == mission_id))
            s.commit()

    def create_world(self, mission_id: str, variant: str, data: dict) -> str | None:
        """Returns the new id, or None when this mission and variant already exist."""
        key = world_id(mission_id, variant)
        with self._session() as s:
            if s.get(WorldRow, key):
                return None
            row = WorldRow(id=key, mission_id=mission_id, variant=variant, data=dumps(data))
            s.add(row)
            s.commit()
            return key

    def update_world(self, key: str, data: dict) -> None:
        with self._session() as s:
            row = s.get(WorldRow, key)
            row.data = dumps(data)
            s.add(row)
            s.commit()

    def delete_world(self, key: str) -> None:
        with self._session() as s:
            s.exec(delete(WorldRow).where(WorldRow.id == key))
            s.commit()

    # ---- runs ----
    def create_run(
        self,
        mission_id: str,
        variant: str,
        player: str,
        seed: int,
        config: dict,
        limits: dict,
        mission: dict,
    ) -> str:
        row = RunRow(
            mission_id=mission_id,
            variant=variant,
            player=player,
            seed=seed,
            created_at=datetime.now(UTC).isoformat(timespec="seconds"),
            config=dumps(config),
            limits=dumps(limits),
            mission=dumps(mission),
        )
        with self._session() as s:
            s.add(row)
            s.commit()
            return f"r_{row.id}"

    def get_run(self, run_id: str) -> dict | None:
        number = _number(run_id)
        if number is None:
            return None
        with self._session() as s:
            row = s.get(RunRow, number)
            if row is None:
                return None
            run = row.model_dump(exclude={"id", "score"})
        for key in ("config", "limits", "mission", "finish", "result", "transitions"):
            run[key] = None if run[key] is None else json.loads(run[key])
        return {"run_id": run_id, **run}

    def run_status(self, run_id: str) -> bool | None:
        """None when the run does not exist, otherwise whether it is finished (cheap query)."""
        number = _number(run_id)
        if number is None:
            return None
        with self._session() as s:
            return s.exec(select(RunRow.finished).where(RunRow.id == number)).first()

    def list_runs(self, limit: int = 50) -> list[dict]:
        columns = (
            RunRow.id,
            RunRow.mission_id,
            RunRow.variant,
            RunRow.player,
            RunRow.created_at,
            RunRow.finished,
            RunRow.score,
            RunRow.state,
            RunRow.reason,
        )
        with self._session() as s:
            rows = s.exec(select(*columns).order_by(RunRow.id.desc()).limit(limit)).all()
        return [
            {
                "run_id": f"r_{r.id}",
                "mission_id": r.mission_id,
                "variant": r.variant,
                "player": r.player,
                "created_at": r.created_at,
                "finished": r.finished,
                "score": r.score,
                "state": r.state,
                "reason": r.reason,
            }
            for r in rows
        ]

    def add_entries(self, run_id: str, entries: list[dict]) -> None:
        """Stores log entries: telemetry samples and events go to their own tables.

        One bulk insert per table: a flush runs on the gateway's event loop, so it must be quick.
        """
        number = _number(run_id)
        samples, events = [], []
        for e in entries:
            row = {"run_id": number, "t_ms": e["t_ms"], "data": dumps(e)}
            if e["type"] == "sample":
                samples.append(row)
            else:
                events.append({**row, "type": e["type"]})
        with self.engine.begin() as connection:
            if samples:
                connection.execute(insert(TelemetryRow), samples)
            if events:
                connection.execute(insert(EventRow), events)

    def get_log(self, run_id: str) -> list[dict]:
        """Events then samples, each in arrival order (scoring sorts them by time)."""
        number = _number(run_id)
        log = []
        with self._session() as s:
            for table in (EventRow, TelemetryRow):
                query = select(table.data).where(table.run_id == number).order_by(table.id)
                log.extend(json.loads(data) for data in s.exec(query))
        return log

    def save_result(
        self,
        run_id: str,
        finish: dict,
        result: dict,
        state: str,
        reason: str,
        transitions: list[dict],
    ) -> None:
        number = _number(run_id)
        with self._session() as s:
            row = s.get(RunRow, number)
            row.finished = True
            row.finish, row.result = dumps(finish), dumps(result)
            row.score = result["score"]
            row.state, row.reason = state, reason
            row.transitions = dumps(transitions)
            s.add(row)
            s.exec(delete(ScoreRow).where(ScoreRow.run_id == number))
            for c in result["breakdown"]:
                s.add(
                    ScoreRow(
                        run_id=number,
                        name=c["name"],
                        points=c["points"],
                        max_points=c["max"],
                        note=c["note"],
                    )
                )
            s.commit()

    def leaderboard(
        self, mission_id: str | None = None, variant: str | None = None, limit: int = 10
    ) -> list[dict]:
        query = select(RunRow.player, RunRow.score).where(RunRow.finished)
        if mission_id:
            query = query.where(RunRow.mission_id == mission_id)
        if variant:
            query = query.where(RunRow.variant == variant)
        query = query.order_by(RunRow.score.desc(), RunRow.id).limit(limit)
        with self._session() as s:
            rows = s.exec(query).all()
        return [{"rank": i + 1, "player": r.player, "score": r.score} for i, r in enumerate(rows)]
