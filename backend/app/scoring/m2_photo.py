"""M2: photography and videography."""

import math

from app.scoring.base import Scorer, ScoringContext, is_number, register, visible_of
from app.scoring.camera import DEG, ang_diff, bearing, in_frame, project
from app.scoring.jsmath import clamp01, round1

PHOTO_KEYS = [
    ("subject", "Subjek terlihat"),
    ("thirds", "Komposisi sepertiga"),
    ("horizon", "Horizon rata"),
    ("sharp", "Ketajaman"),
    ("light", "Pencahayaan"),
    ("variation", "Variasi"),
]
VIDEO_KEYS = [
    ("vsubject", "Subjek dalam bingkai"),
    ("smooth", "Kehalusan"),
    ("cinematic", "Gerakan sinematik"),
    ("duration", "Durasi sesuai"),
    ("vsafety", "Keselamatan video"),
]
THIRDS = [(1 / 3, 1 / 3), (2 / 3, 1 / 3), (1 / 3, 2 / 3), (2 / 3, 2 / 3)]
JERK_REF = 8  # m/s^3, a jerk this large means a jerky clip


def _landmark(config: dict, landmark_id: str) -> dict:
    return next(lm for lm in config["mission"]["landmarks"] if lm["id"] == landmark_id)


def _sees(item: dict, subject: str) -> bool:
    box = item.get("box")
    return (
        item["label"] == "landmark"
        and item.get("id") == subject
        and is_number(item.get("area"))
        and isinstance(box, list)
        and len(box) == 4
        and all(is_number(v) for v in box)
    )


def _number_or(value, default: float) -> float:
    return value if is_number(value) else default


def photo_factors(photo: dict, shot: dict, config: dict, prev: dict | None) -> dict:
    """Photo components, each 0..1. `prev` is the previous photo (for the variation part)."""
    m = config["mission"]
    lm = _landmark(config, shot["subject"])
    v = next((o for o in visible_of(photo) if _sees(o, shot["subject"])), None)
    lo, hi = shot.get("areaRange") or [0.10, 0.60]
    pose = photo["pose"]
    f = {}
    if not v:
        f["subject"] = 0
    elif v["area"] < lo:
        f["subject"] = v["area"] / lo
    elif v["area"] > hi:
        f["subject"] = clamp01((1 - v["area"]) / (1 - hi))
    else:
        f["subject"] = 1
    if v:
        cx, cy = v["box"][0] + v["box"][2] / 2, v["box"][1] + v["box"][3] / 2
        nearest = min(math.hypot(cx - tx, cy - ty) for tx, ty in THIRDS)
        f["thirds"] = clamp01(1 - nearest / 0.4714)
    else:
        f["thirds"] = 0
    roll = abs(_number_or(pose.get("roll"), 0))
    f["horizon"] = 1 if roll <= 3 else clamp01(1 - (roll - 3) / 12)
    speed = _number_or(photo.get("speed"), 0)
    yaw_rate = abs(_number_or(photo.get("yaw_rate"), 0))
    f["sharp"] = min(
        1 if speed <= 0.5 else clamp01(1 - (speed - 0.5) / 2.5),
        1 if yaw_rate <= 10 else clamp01(1 - (yaw_rate - 10) / 50),
    )
    # Light: the sun azimuth is where the light comes from. Looking toward it is worst.
    dot = math.cos(ang_diff(pose["yaw"], m["sun"]["az"]) * DEG)
    f["light"] = 1 if dot <= 0.3 else clamp01(1 - (dot - 0.3) / 0.7)
    # Variation: the view direction around the subject differs 30 degrees or more.
    b = bearing(lm["x"], lm["z"], pose["pos"][0], pose["pos"][2])
    if prev:
        before = bearing(lm["x"], lm["z"], prev["pose"]["pos"][0], prev["pose"]["pos"][2])
        f["variation"] = clamp01(abs(ang_diff(b, before)) / 30)
    else:
        f["variation"] = 1
    return f


def video_factors(clip: dict, shot: dict, config: dict, collisions: int) -> dict:
    """Video components for one shot, each 0..1. clip: {samples, dur_s}."""
    lm = _landmark(config, shot["subject"])
    box = {"x": lm["x"], "y": lm["y"], "z": lm["z"], "hx": lm.get("hx"), "hy": lm.get("hy")}
    samples, f = clip["samples"], {}
    in_view = 0
    for s in samples:
        pose = {
            "pos": s["pos"],
            "yaw": _number_or(s.get("yaw"), 0),
            "pitch": _number_or(s.get("gimbal"), -10),
        }
        if in_frame(project(pose, box)):
            in_view += 1
    f["vsubject"] = in_view / len(samples) if samples else 0
    # Jerk = change of acceleration, from the velocity samples.
    jerk, n, previous = 0.0, 0, None
    for i in range(2, len(samples)):
        dt = (samples[i]["t_ms"] - samples[i - 1]["t_ms"]) / 1000
        if dt <= 0:
            continue
        a = [(samples[i]["vel"][k] - samples[i - 1]["vel"][k]) / dt for k in range(3)]
        if previous:
            jerk += math.hypot(*(a[k] - previous[k] for k in range(3))) / dt
            n += 1
        previous = a
    f["smooth"] = clamp01(1 - jerk / n / JERK_REF) if n else 0
    # Cinematic move: orbit (90 degrees around the subject) or reveal (climb while backing off).
    swept = 0.0
    for before, after in zip(samples, samples[1:], strict=False):
        swept += abs(
            ang_diff(
                bearing(lm["x"], lm["z"], after["pos"][0], after["pos"][2]),
                bearing(lm["x"], lm["z"], before["pos"][0], before["pos"][2]),
            )
        )
    orbit = clamp01(swept / 90)
    reveal = 0
    if len(samples) > 1:
        a, b = samples[0]["pos"], samples[-1]["pos"]
        away = math.hypot(b[0] - lm["x"], b[2] - lm["z"]) - math.hypot(
            a[0] - lm["x"], a[2] - lm["z"]
        )
        reveal = clamp01((b[1] - a[1]) / 10) * clamp01(away / 5)
    kind = shot.get("kind")
    f["cinematic"] = (
        orbit if kind == "orbit" else reveal if kind == "reveal" else max(orbit, reveal)
    )
    dur, lo, hi = clip["dur_s"], shot["minDur"], shot["maxDur"]
    if lo <= dur <= hi:
        f["duration"] = 1
    else:
        off = lo - dur if dur < lo else dur - hi
        f["duration"] = clamp01(1 - off / (0.5 * (lo if dur < lo else hi)))
    f["vsafety"] = 1 if collisions == 0 else 0
    return f


def clips_of(log: list[dict], fin_ms: float) -> list[dict]:
    """Recorded clips. A clip still open ends at the finish."""
    clips, current = [], None
    for e in log:
        if e["type"] == "record_start" and current is None:
            current = {"start": e["t_ms"]}
        elif e["type"] == "record_stop" and current is not None:
            clips.append({**current, "end": e["t_ms"]})
            current = None
    if current is not None:
        clips.append({**current, "end": fin_ms})
    for c in clips:
        inside = [e for e in log if c["start"] <= e["t_ms"] <= c["end"]]
        c["dur_s"] = (c["end"] - c["start"]) / 1000
        c["samples"] = [e for e in inside if e["type"] == "sample"]
        c["collisions"] = sum(1 for e in inside if e["type"] == "collision")
    return clips


@register
class PhotoScorer(Scorer):
    key = "photo"
    weight_keys = (*(k for k, _ in PHOTO_KEYS), *(k for k, _ in VIDEO_KEYS), "photoShare")
    progress_events = frozenset({"photo", "record_stop"})

    def score(self, ctx: ScoringContext) -> dict:
        config, log = ctx.config, ctx.log
        shots = config["mission"]["shots"]
        photo_shots = [s for s in shots if s["type"] == "photo"]
        video_shots = [s for s in shots if s["type"] == "video"]

        def total(keys, f):
            return sum(ctx.w(k) * f[k] for k, _ in keys)

        # Photos in time order; variation compares each photo with the one before it.
        photos, prev = [], None
        for e in log:
            if e["type"] != "photo":
                continue
            per = {s["id"]: photo_factors(e, s, config, prev) for s in photo_shots}
            photos.append({"e": e, "per": per})
            prev = e

        # The best unused photo or clip for each shot, in shot list order.
        results, used = [], set()
        for shot in photo_shots:
            best, best_score = None, None
            for i, p in enumerate(photos):
                value = total(PHOTO_KEYS, p["per"][shot["id"]])
                if i not in used and (best is None or value > best_score):
                    best, best_score = i, value
            if best is not None:
                used.add(best)
            f = None if best is None else photos[best]["per"][shot["id"]]
            results.append({"shot": shot, "kind": "photo", "f": f})
        clips, used_clips = clips_of(log, ctx.finish["t_ms"]), set()
        for shot in video_shots:
            best, best_f, best_score = None, None, -1.0
            for i, clip in enumerate(clips):
                if i in used_clips:
                    continue
                f = video_factors(clip, shot, config, clip["collisions"])
                value = total(VIDEO_KEYS, f)
                if value > best_score:
                    best, best_f, best_score = i, f, value
            if best is not None:
                used_clips.add(best)
            results.append({"shot": shot, "kind": "video", "f": best_f})

        n_photo, n_video = len(photo_shots), len(video_shots)
        if n_photo and n_video:
            share = ctx.w("photoShare")
            video_share = 1 - share
        else:
            share, video_share = (1 if n_photo else 0), (1 if n_video else 0)

        def rows(keys, kind, part, n):
            if not n:
                return
            for key, name in keys:
                got = 0
                for r in results:
                    if r["kind"] == kind and r["f"]:
                        got += ctx.w(key) * r["f"][key]
                kind_name = "foto" if kind == "photo" else "video"
                ctx.comp.append(
                    {
                        "key": key,
                        "name": name,
                        "points": round1((part * got) / n),
                        "max": round1(part * ctx.w(key)),
                        "note": f"rata-rata {kind_name} terbaik tiap butir",
                    }
                )

        rows(PHOTO_KEYS, "photo", share, n_photo)
        rows(VIDEO_KEYS, "video", video_share, n_video)
        details = []
        for r in results:
            keys = PHOTO_KEYS if r["kind"] == "photo" else VIDEO_KEYS
            item = {"id": r["shot"]["id"], "type": r["kind"]}
            if "label" in r["shot"]:
                item["label"] = r["shot"]["label"]
            item["done"] = r["f"] is not None
            item["score"] = round1(total(keys, r["f"])) if r["f"] else 0
            details.append(item)
        return {"details": details}

    def objectives_met(self, config: dict, log: list[dict]) -> bool:
        shots = config["mission"]["shots"]
        photos = sum(1 for e in log if e.get("type") == "photo")
        clips = sum(1 for e in log if e.get("type") == "record_stop")
        return photos >= sum(s["type"] == "photo" for s in shots) and clips >= sum(
            s["type"] == "video" for s in shots
        )
