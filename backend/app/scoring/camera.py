"""Drone camera geometry, the same model as src/camera-model.js.

Nose mounted camera, yaw follows the drone, pitch is the gimbal angle, 16:9, vertical FOV 70.
Roll is not used for projection. math.fmod keeps the sign rules of JavaScript's `%`.
"""

import math

DEG = math.pi / 180
VFOV = 70
ASPECT = 16 / 9
TAN = math.tan((VFOV / 2) * DEG)


def project(pose: dict, obj: dict) -> dict | None:
    """Projects {x, y, z, hx, hy} into the frame. None when it is behind the camera."""
    yaw, pit = pose["yaw"] * DEG, pose["pitch"] * DEG
    sy, cy, sp, cp = math.sin(yaw), math.cos(yaw), math.sin(pit), math.cos(pit)
    dx = obj["x"] - pose["pos"][0]
    dy = obj["y"] - pose["pos"][1]
    dz = obj["z"] - pose["pos"][2]
    z = dx * sy * cp + dy * sp - dz * cy * cp  # depth along the view direction
    if z < 0.5:
        return None
    x = dx * cy + dz * sy  # right
    y = -dx * sy * sp + dy * cp + dz * cy * sp  # up
    t = TAN / (pose.get("zoom") or 1)  # zoom narrows the field of view
    u = 0.5 + x / (z * t * ASPECT) / 2
    v = 0.5 - y / (z * t) / 2
    w = (obj.get("hx") or 0.01) / (z * t * ASPECT)
    h = (obj.get("hy") or 0.01) / (z * t)
    x0, x1 = max(0, u - w / 2), min(1, u + w / 2)
    y0, y1 = max(0, v - h / 2), min(1, v + h / 2)
    cw, ch = max(0, x1 - x0), max(0, y1 - y0)
    return {
        "dist": math.hypot(dx, dy, dz),
        "box": [x0, y0, cw, ch],
        "area": cw * ch,
        "full": w * h,
        "center": [u, v],
    }


def in_frame(p: dict | None) -> bool:
    """At least half of the object's box is inside the frame."""
    return bool(p) and p["full"] > 0 and p["area"] / p["full"] >= 0.5


def bearing(ax: float, az: float, bx: float, bz: float) -> float:
    """Direction from A to B in degrees 0..360 (0 = -Z, clockwise)."""
    return math.fmod(math.atan2(bx - ax, -(bz - az)) / DEG + 360, 360)


def ang_diff(a: float, b: float) -> float:
    """Smallest signed difference between two angles, -180..180."""
    return math.fmod(a - b + 540, 360) - 180
