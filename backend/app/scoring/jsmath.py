"""Number behaviour of JavaScript, so that Python scores equal the simulator's scores."""

import math
import struct
from decimal import ROUND_HALF_UP, Decimal


def js_round(x: float) -> int:
    """Math.round: halves go up (toward +infinity)."""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


def round1(x: float) -> float:
    return js_round(x * 10) / 10


def clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def js_fixed(x: float, digits: int) -> str:
    """Number.prototype.toFixed: rounds the exact binary value, ties away from zero."""
    return str(Decimal(x).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def js_num(x: float) -> str:
    """How a template string prints a number: no trailing ".0"."""
    return str(int(x)) if float(x).is_integer() else repr(float(x))


def f32(x: float) -> float:
    """The value a Float32Array element would hold."""
    return struct.unpack("f", struct.pack("f", x))[0]
