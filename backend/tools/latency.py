"""Telemetry latency experiment: round trip of one frame (send -> stored by the gateway -> ack).

python tools/latency.py --drones 1 5 10 20 --hz 10 20 --duration 30 --out results

Run it against a gateway with its own database, for example DB_PATH=data/latency.db.
Writes latency.csv, latency.md and latency.png.
"""

import argparse
import asyncio
import csv
import json
import math
import platform
import sys
import time
from pathlib import Path

import httpx
from websockets.asyncio.client import connect

COLUMNS = ["drones", "hz", "frames", "lost", "p50_ms", "p95_ms"]
ACK_WAIT_S = 2.0  # how long to wait for the last acks
# categorical slots 1 and 2 of a colour-blind checked palette, and neutral inks
SERIES = [("p50", "p50_ms", "#2a78d6"), ("p95", "p95_ms", "#eb6834")]
SURFACE, INK, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"


def percentile(values: list[float], p: float) -> float:
    """Linear interpolation between the two nearest values."""
    if not values:
        raise ValueError("no values")
    ordered = sorted(values)
    k = (len(ordered) - 1) * p / 100
    low, high = math.floor(k), math.ceil(k)
    return ordered[low] + (ordered[high] - ordered[low]) * (k - low)


async def _drone(socket, count: int, hz: int, start_at: float) -> tuple[int, list[float]]:
    """Sends `count` frames at `hz` and returns (sent, round trip times in ms)."""
    sent_at: dict[int, float] = {}
    times: list[float] = []

    async def receive():
        while len(times) < count:
            message = json.loads(await socket.recv())
            if message.get("type") == "ack":
                times.append((time.perf_counter() - sent_at[message["t_ms"]]) * 1000)

    receiver = asyncio.create_task(receive())
    for k in range(count):
        await asyncio.sleep(max(0, start_at + k / hz - time.perf_counter()))
        t_ms = k * round(1000 / hz)
        frame = {"t_ms": t_ms, "pos": [0, 5, 0], "vel": [1, 0, 0], "yaw": 90, "battery": 90}
        sent_at[t_ms] = time.perf_counter()
        await socket.send(json.dumps(frame))
    try:
        await asyncio.wait_for(receiver, ACK_WAIT_S)
    except TimeoutError:
        pass  # the missing acks are counted as lost
    return count, times


async def measure(base_url: str, drones: int, hz: int, duration_s: float) -> dict:
    """Flies `drones` drones at once, each on its own run and socket."""
    count = max(1, round(hz * duration_s))
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        run_ids = []
        for i in range(drones):
            body = {"mission_id": "m4_delivery", "player": f"latency-{i + 1}"}
            response = await client.post("/api/v1/runs", json=body)
            response.raise_for_status()
            run_ids.append(response.json()["run_id"])
    socket_base = base_url.replace("http", "ws", 1)
    sockets = [await connect(f"{socket_base}/ws/v1/runs/{r}?ack=1") for r in run_ids]
    try:
        start_at = time.perf_counter() + 0.2
        flights = await asyncio.gather(
            # spread the drones over one frame period, as independent clients would be
            *(_drone(s, count, hz, start_at + i / hz / drones) for i, s in enumerate(sockets))
        )
    finally:
        for s in sockets:
            await s.close()
    times = [t for _, per_drone in flights for t in per_drone]
    frames = sum(sent for sent, _ in flights)
    return {
        "drones": drones,
        "hz": hz,
        "frames": frames,
        "lost": frames - len(times),
        "p50_ms": round(percentile(times, 50), 3),
        "p95_ms": round(percentile(times, 95), 3),
    }


def system_name() -> str:
    """Python 3.11 calls Windows 11 "10"; builds from 22000 on are Windows 11."""
    if platform.system() == "Windows" and sys.getwindowsversion().build >= 22000:
        return "Windows 11"
    return f"{platform.system()} {platform.release()}"


def _chart(rows: list[dict], path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rates = sorted({r["hz"] for r in rows})
    figure, axes = plt.subplots(
        1, len(rates), figsize=(4.6 * len(rates), 3.6), sharey=True, squeeze=False
    )
    figure.patch.set_facecolor(SURFACE)
    for axis, hz in zip(axes[0], rates, strict=True):
        own = sorted((r for r in rows if r["hz"] == hz), key=lambda r: r["drones"])
        x = [r["drones"] for r in own]
        for label, key, colour in SERIES:
            y = [r[key] for r in own]
            axis.plot(x, y, color=colour, linewidth=2, marker="o", markersize=7, label=label)
            axis.annotate(
                f"{label} {y[-1]:.1f}",
                (x[-1], y[-1]),
                textcoords="offset points",
                xytext=(0, 8),
                ha="right",
                fontsize=8,
                color=MUTED,
            )
        axis.set_title(f"Telemetri {hz} Hz", color=INK, fontsize=11, loc="left")
        axis.set_xlabel("Jumlah drone bersamaan", color=MUTED, fontsize=9)
        axis.set_xticks(x)
        axis.set_facecolor(SURFACE)
        axis.grid(axis="y", color=GRID, linewidth=0.8)
        axis.set_axisbelow(True)
        axis.tick_params(colors=MUTED, labelsize=8, length=0)
        for side in ("top", "right", "left"):
            axis.spines[side].set_visible(False)
        axis.spines["bottom"].set_color(GRID)
    top = max(r["p95_ms"] for r in rows)
    axes[0][0].set_ylim(0, top * 1.2 or 1)
    axes[0][0].set_ylabel("Waktu bolak-balik (ms)", color=MUTED, fontsize=9)
    axes[0][0].legend(frameon=False, fontsize=8, labelcolor=MUTED, loc="upper left")
    figure.tight_layout()
    figure.savefig(path, dpi=150, facecolor=SURFACE)
    plt.close(figure)


def write_results(rows: list[dict], out: Path, duration_s: float) -> None:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: (r["hz"], r["drones"]))
    with open(out / "latency.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    table = [
        "# Latensi telemetri",
        "",
        "Waktu bolak-balik satu bingkai: dikirim, diterima gateway, masuk antrean simpan, "
        "lalu dibalas `ack`.",
        f"Klien dan gateway di komputer yang sama. Durasi {duration_s:g} s per baris. "
        f"{system_name()}, Python {platform.python_version()}.",
        "",
        "| Hz | Drone | Bingkai | Hilang | p50 (ms) | p95 (ms) |",
        "|---|---|---|---|---|---|",
        *(
            f"| {r['hz']} | {r['drones']} | {r['frames']} | {r['lost']} "
            f"| {r['p50_ms']} | {r['p95_ms']} |"
            for r in rows
        ),
        "",
    ]
    (out / "latency.md").write_text("\n".join(table), encoding="utf-8")
    _chart(rows, out / "latency.png")


async def _main(args) -> None:
    rows = []
    for hz in args.hz:
        for drones in args.drones:
            row = await measure(args.url, drones, hz, args.duration)
            print(
                f"{hz:3} Hz, {drones:3} drone: p50 {row['p50_ms']:7.2f} ms, "
                f"p95 {row['p95_ms']:7.2f} ms, hilang {row['lost']}/{row['frames']}"
            )
            rows.append(row)
    write_results(rows, Path(args.out), args.duration)
    print(f"Hasil disimpan di {args.out}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--drones", type=int, nargs="+", default=[1, 5, 10, 20])
    parser.add_argument("--hz", type=int, nargs="+", default=[10])
    parser.add_argument("--duration", type=float, default=30)
    parser.add_argument("--out", default="results")
    try:
        asyncio.run(_main(parser.parse_args()))
    except (httpx.HTTPError, OSError) as e:
        print(f"Gateway tidak bisa dihubungi: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
