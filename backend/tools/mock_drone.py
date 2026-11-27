"""A pretend drone: flies a mission through the gateway API, so the backend can be tested alone.

python tools/mock_drone.py --mission all
python tools/mock_drone.py --mission m4_delivery --variant acak --drones 3 --realtime

The route is built from the world the gateway returns. There is no physics: the drone moves in
straight lines, inside the map limits, and reports what its camera would see.
"""

import argparse
import asyncio
import json
import math
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402
from websockets.asyncio.client import connect  # noqa: E402

from app.scoring.camera import ASPECT, TAN, bearing, in_frame, project  # noqa: E402

SPEED = 8.0  # m/s in the mission area
TRANSIT = 14.0  # m/s between far apart places
DRAIN = 0.1  # battery percent per second
MISSIONS = ["m1_sar", "m2_foto", "m3_agri", "m4_delivery", "m5_inspeksi"]


def visible(pose: dict, objects: list[dict]) -> list[dict]:
    """What the camera sees, in the shape the simulator sends."""
    seen = []
    for o in objects:
        p = project(pose, o)
        if p and p["dist"] <= o.get("range", 60) and in_frame(p):
            seen.append(
                {
                    "label": o["label"],
                    "id": o["id"],
                    "dist": round(p["dist"], 1),
                    "area": round(p["area"], 4),
                    "box": [round(v, 3) for v in p["box"]],
                }
            )
    return seen


class Pilot:
    """Builds the flight as a list of ("frame" | "event", data) in time order."""

    def __init__(self, limits: dict, hz: int):
        self.limits, self.step_ms = limits, round(1000 / hz)
        self.t = 0
        self.pos = [0.0, 0.0, 0.0]
        self.yaw, self.gimbal = 0.0, -10.0
        self.spraying = False
        self.items: list[tuple[str, dict]] = []

    def clamp(self, pos) -> list[float]:
        lim = self.limits
        return [
            min(max(pos[0], lim["minX"]), lim["maxX"]),
            max(pos[1], 0.0),
            min(max(pos[2], lim["minZ"]), lim["maxZ"]),
        ]

    def frame(self, pos, vel=(0, 0, 0)) -> None:
        self.pos = self.clamp(pos)
        self.items.append(
            (
                "frame",
                {
                    "t_ms": self.t,
                    "pos": [round(v, 3) for v in self.pos],
                    "vel": [round(v, 3) for v in vel],
                    "yaw": round(self.yaw, 1),
                    "roll": 0,
                    "pitch": 0,
                    "gimbal": round(self.gimbal, 1),
                    "battery": round(max(20.0, 100 - self.t / 1000 * DRAIN)),
                    "payload_kg": 0,
                    "spraying": self.spraying,
                    "collision": False,
                },
            )
        )
        self.t += self.step_ms

    def fly(self, target, speed: float = SPEED) -> None:
        start, end = list(self.pos), self.clamp(target)
        delta = [end[i] - start[i] for i in range(3)]
        length = math.hypot(*delta)
        steps = max(1, math.ceil(length / speed * 1000 / self.step_ms))
        vel = [d / (steps * self.step_ms / 1000) for d in delta]
        for k in range(1, steps + 1):
            self.frame([start[i] + delta[i] * k / steps for i in range(3)], vel)

    def hover(self, seconds: float) -> None:
        for _ in range(max(1, round(seconds * 1000 / self.step_ms))):
            self.frame(self.pos)

    def pose(self) -> dict:
        return {"pos": list(self.pos), "yaw": self.yaw, "pitch": self.gimbal, "roll": 0, "zoom": 1}

    def event(self, kind: str, **extra) -> None:
        self.items.append(("event", {"t_ms": self.t, "type": kind, "pose": self.pose(), **extra}))

    def look_at(self, point) -> None:
        dx, dy, dz = (point[i] - self.pos[i] for i in range(3))
        self.yaw = bearing(self.pos[0], self.pos[2], point[0], point[2])
        self.gimbal = max(-90, min(30, math.degrees(math.atan2(dy, math.hypot(dx, dz)))))

    def take_off(self) -> None:
        self.frame([0, 0, 0])
        self.event("takeoff")
        self.fly([0, 5, 0], 3)

    def land_home(self) -> None:
        self.fly([0, max(self.pos[1], 20), 0], TRANSIT)
        self.fly([0, 0, 0], 4)


def fly_sar(pilot: Pilot, config: dict) -> None:
    for v in config["mission"]["victims"]:
        y = v.get("y", 0)
        pilot.fly([v["x"], y + 4, v["z"] + 3])
        pilot.look_at([v["x"], y + 0.9, v["z"]])
        pilot.hover(1)
        target = {"label": "person", "id": v["id"], "x": v["x"], "y": y + 0.9, "z": v["z"]}
        pilot.event("mark", visible=visible(pilot.pose(), [{**target, "hx": 0.4, "hy": 0.9}]))
    pilot.land_home()


def _viewpoint(lm: dict, area: float, yaw: float) -> tuple[list[float], float]:
    """A camera position from which the landmark fills `area` of the frame, looking along yaw."""
    distance = math.sqrt(lm["hx"] * lm["hy"] / (area * TAN * TAN * ASPECT))
    a = math.radians(yaw)
    height = max(2.0, lm["y"] + 0.1 * distance)
    pos = [lm["x"] - math.sin(a) * distance, height, lm["z"] + math.cos(a) * distance]
    return pos, distance


def _inside(pilot: Pilot, points: list[list[float]]) -> bool:
    return all(pilot.clamp(p) == p for p in points)


def fly_photo(pilot: Pilot, config: dict) -> None:
    m = config["mission"]
    objects = [{"label": "landmark", **lm} for lm in m["landmarks"]]
    by_id = {lm["id"]: lm for lm in m["landmarks"]}
    away_from_sun = (m["sun"]["az"] + 180) % 360
    for n, shot in enumerate(s for s in m["shots"] if s["type"] == "photo"):
        lm = by_id[shot["subject"]]
        lo, hi = shot.get("areaRange", [0.1, 0.6])
        pos, _ = _viewpoint(lm, math.sqrt(lo * hi), away_from_sun + 40 * n)
        pilot.fly(pos, TRANSIT)
        pilot.look_at([lm["x"], lm["y"], lm["z"]])
        pilot.hover(1.5)
        pilot.event("photo", visible=visible(pilot.pose(), objects), speed=0, yaw_rate=0)
    for shot in (s for s in m["shots"] if s["type"] == "video"):
        lm = by_id[shot["subject"]]
        seconds = (shot["minDur"] + shot["maxDur"]) / 2
        pos, distance = _viewpoint(lm, 0.2, away_from_sun)
        height = pos[1]
        count = round(seconds * 1000 / pilot.step_ms)
        reveal = shot.get("kind") == "reveal"

        def path(start_deg, lm=lm, distance=distance, height=height, count=count, reveal=reveal):
            points = []
            for k in range(count + 1):
                f = k / count
                angle = math.radians(start_deg + (0 if reveal else 100 * f))
                radius = distance + (8 * f if reveal else 0)
                climb = 12 * f if reveal else 0
                points.append(
                    [
                        lm["x"] + math.sin(angle) * radius,
                        height + climb,
                        lm["z"] - math.cos(angle) * radius,
                    ]
                )
            return points

        starts = range(0, 360, 10)
        points = next((p for p in map(path, starts) if _inside(pilot, p)), path(0))
        pilot.fly(points[0], TRANSIT)
        pilot.look_at([lm["x"], lm["y"], lm["z"]])
        pilot.hover(1)
        pilot.event("record_start")
        dt = pilot.step_ms / 1000
        for k in range(count):
            vel = [(points[k + 1][i] - points[k][i]) / dt for i in range(3)]
            pilot.pos = pilot.clamp(points[k])
            pilot.look_at([lm["x"], lm["y"], lm["z"]])
            pilot.frame(points[k], vel)
        pilot.event("record_stop")
    pilot.land_home()


def fly_agri(pilot: Pilot, config: dict) -> None:
    """Rows over the field at 4 m and 3 m/s; goes home to refill before the tank runs dry."""
    field, dose = config["mission"]["field"], config["mission"]["dose"]
    wind = {"speed": 1.0, "dir": 90, "gust": 0.2}
    pilot.items.insert(0, ("event", {"t_ms": 0, "type": "wind", "wind": wind}))
    height, speed = 4.0, 3.0
    drift = height / 4 * wind["speed"]  # the spray lands this far toward +X
    per_second = dose["flow"]
    spacing = per_second / (speed * (dose["lo"] + dose["hi"]) / 2)
    depth = field["max"][1] - field["min"][1]
    rows = max(1, round(depth / spacing))
    left, right = field["min"][0] - drift, field["max"][0] - drift
    tank = dose["capacity"]
    for row in range(rows):
        z = field["min"][1] + depth * (row + 0.5) / rows
        a, b = (left, right) if row % 2 == 0 else (right, left)
        x = a
        while abs(b - x) > 1e-6:
            if tank < per_second:  # refill at home
                pilot.land_home()
                pilot.event("refill")
                tank = dose["capacity"]
                pilot.fly([0, 5, 0], 4)
            leg = min(abs(b - x), speed * (tank / per_second))
            nx = x + math.copysign(leg, b - x)
            pilot.fly([x, height, z], TRANSIT)
            pilot.spraying = True
            pilot.event("spray", on=True)
            before = pilot.t
            pilot.fly([nx, height, z], speed)
            pilot.spraying = False
            pilot.event("spray", on=False)
            tank -= (pilot.t - before) / 1000 * per_second
            x = nx
    pilot.land_home()


def fly_delivery(pilot: Pilot, config: dict) -> None:
    m = config["mission"]
    pilot.fly([m["pickup"]["x"], 2, m["pickup"]["z"]])
    pilot.event("pickup")
    pilot.fly([m["pickup"]["x"], 35, m["pickup"]["z"]])
    pilot.fly([m["drop"]["x"], 35, m["drop"]["z"]], TRANSIT)
    pilot.fly([m["drop"]["x"], 2, m["drop"]["z"]])
    pilot.event("drop")  # the mission ends at the drop, like in the simulator


def fly_inspection(pilot: Pilot, config: dict) -> None:
    m = config["mission"]
    objects = [
        {
            "label": "defect",
            "id": d["id"],
            "x": d["x"],
            "y": d["y"],
            "z": d["z"],
            "hx": d["size"] / 2,
            "hy": d["size"] / 2,
        }
        for d in m["defects"]
    ]

    def normal_of(d):
        nearest = min(m["panels"], key=lambda p: math.dist((p["x"], p["z"]), (d["x"], d["z"])))
        return d.get("nx", nearest["nx"]), d.get("nz", nearest["nz"])

    def shoot(point, normal, mark: bool):
        pilot.fly([point["x"] + normal[0] * 5, point["y"], point["z"] + normal[1] * 5])
        pilot.look_at([point["x"], point["y"], point["z"]])
        pilot.hover(0.6)
        seen = visible(pilot.pose(), objects)
        pilot.event("photo", visible=seen, speed=0, yaw_rate=0)
        if mark:
            pilot.event("mark", visible=[v for v in seen if v["id"] == point["id"]])

    for panel in m["panels"]:
        shoot(panel, (panel["nx"], panel["nz"]), mark=False)
    for defect in m["defects"]:
        shoot(defect, normal_of(defect), mark=True)
    pilot.land_home()


ROUTES = {
    "m1_sar": fly_sar,
    "m2_foto": fly_photo,
    "m3_agri": fly_agri,
    "m4_delivery": fly_delivery,
    "m5_inspeksi": fly_inspection,
}


async def fly_mission(
    base_url: str,
    mission_id: str,
    variant: str | None = None,
    hz: int = 10,
    realtime: bool = False,
    player: str = "mock",
) -> dict:
    """Flies one run and returns {"run_id", "result", "state", "reason"}."""
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        body = {"mission_id": mission_id, "variant": variant, "player": player}
        response = await client.post("/api/v1/runs", json=body)
        response.raise_for_status()
        run = response.json()
        run_id = run["run_id"]
        limits = await _limits(client, run_id)
        pilot = Pilot(limits, hz)
        pilot.take_off()
        ROUTES[mission_id](pilot, run["config"])

        socket_url = base_url.replace("http", "ws", 1) + f"/ws/v1/runs/{run_id}"
        async with connect(socket_url) as socket:
            for kind, data in pilot.items:
                if kind == "frame":
                    await socket.send(_json(data))
                    if realtime:
                        await asyncio.sleep(pilot.step_ms / 1000)
                else:
                    (
                        await client.post(f"/api/v1/runs/{run_id}/events", json=data)
                    ).raise_for_status()

        battery = round(max(20.0, 100 - pilot.t / 1000 * DRAIN))
        finish = {"t_ms": pilot.t, "battery": battery, "reason": "completed"}
        response = await client.post(f"/api/v1/runs/{run_id}/finish", json=finish)
        response.raise_for_status()
        result = response.json()
        detail = (await client.get(f"/api/v1/runs/{run_id}")).json()
    return {
        "run_id": run_id,
        "result": result,
        "state": detail["state"],
        "reason": detail["reason"],
    }


async def _limits(client: httpx.AsyncClient, run_id: str) -> dict:
    response = await client.get(f"/api/v1/runs/{run_id}")
    response.raise_for_status()
    return response.json()["limits"]


def _json(data: dict) -> str:
    return json.dumps(data, separators=(",", ":"))


async def _main(args) -> int:
    missions = MISSIONS if args.mission == "all" else [args.mission]
    failures = 0
    for mission_id in missions:
        flights = await asyncio.gather(
            *(
                fly_mission(
                    args.url, mission_id, args.variant, args.hz, args.realtime, f"mock-{i + 1}"
                )
                for i in range(args.drones)
            )
        )
        for f in flights:
            print(
                f"{mission_id:12} {f['run_id']:6} {f['state']:9} {f['reason']:10} "
                f"skor {f['result']['score']:3} ({f['result']['grade']})"
            )
            failures += f["state"] != "mendarat"
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mission", default="all", choices=["all", *MISSIONS])
    parser.add_argument("--variant")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--hz", type=int, default=10)
    parser.add_argument("--drones", type=int, default=1)
    parser.add_argument("--realtime", action="store_true", help="send frames at real speed")
    try:
        return asyncio.run(_main(parser.parse_args()))
    except (httpx.HTTPError, OSError) as e:
        print(f"Gateway tidak bisa dihubungi: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
