"""The Python scorer must round and format numbers exactly like the JavaScript one."""

from app.scoring.jsmath import clamp01, f32, js_fixed, js_num, js_round, round1


def test_round_goes_half_up_like_math_round():
    assert js_round(2.5) == 3
    assert js_round(-2.5) == -2
    assert js_round(0.49999999999999994) == 0
    assert round1(13.35) == 13.4  # 133.5 -> 134


def test_fixed_matches_to_fixed():
    assert js_fixed(0.25, 1) == "0.3"
    assert js_fixed(1.005, 2) == "1.00"  # the binary value is just below 1.005
    assert js_fixed(3, 1) == "3.0"


def test_numbers_print_like_template_strings():
    assert js_num(180.0) == "180"
    assert js_num(180) == "180"
    assert js_num(1.5) == "1.5"


def test_clamp_and_float32():
    assert (clamp01(-1), clamp01(0.5), clamp01(2)) == (0.0, 0.5, 1.0)
    assert f32(0.1) != 0.1
    assert f32(0.5) == 0.5
