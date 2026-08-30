"""ambiguityMargin por request (CD-12): datos, no codigo.

Un fill limite (margin 0.22, fuera de la tierra de nadie) cambia de veredicto
segun el margen del CaptureProfile: con el default 0.25 es ambiguous, con una
banda mas angosta es marked. `null` u omitido => el default del MVP.
"""

from __future__ import annotations

import numpy as np

from app.classify import AMBIGUITY_MARGIN, PageThreshold
from app.pipeline import process_page
from app.readers import BubbleGroupReader, DigitGridReader
from app.rectify import RectifiedPage
from tests import synthetic as syn

BORDERLINE_THRESHOLD = PageThreshold(
    threshold=0.45,
    separable=True,
    gap=0.3,
    low_mean=0.3,
    high_mean=0.6,
    std_low=0.01,
    std_high=0.01,
)
BORDERLINE_FILL = 0.55


def fake_page() -> RectifiedPage:
    return RectifiedPage(
        gray=np.full((200, 200), 235, dtype=np.uint8),
        size=(200, 200),
        fiducials_found=4,
        touches_border=False,
    )


def bubble_field() -> dict:
    return {
        "fieldId": "f_001",
        "kind": "bubble_group",
        "printedNumber": "1",
        "pageIndex": 0,
        "selectMode": "single",
        "bubbles": [
            {"value": "A", "center": {"x": 0.3, "y": 0.5}, "radius": 0.05},
            {"value": "B", "center": {"x": 0.6, "y": 0.5}, "radius": 0.05},
        ],
        "region": None,
    }


def digit_field() -> dict:
    return {
        "fieldId": "f_num",
        "kind": "digit_grid",
        "printedNumber": "2",
        "pageIndex": 0,
        "selectMode": "single",
        "bubbles": [
            {"value": "0", "center": {"x": 0.3, "y": 0.3}, "radius": 0.05, "group": 0},
            {"value": "1", "center": {"x": 0.3, "y": 0.6}, "radius": 0.05, "group": 0},
            {"value": "0", "center": {"x": 0.6, "y": 0.3}, "radius": 0.05, "group": 1},
            {"value": "1", "center": {"x": 0.6, "y": 0.6}, "radius": 0.05, "group": 1},
        ],
        "region": None,
    }


def test_borderline_fill_is_outside_no_mans_land() -> None:
    assert not BORDERLINE_THRESHOLD.is_in_no_mans_land(BORDERLINE_FILL)


def test_default_margin_doubts_the_borderline_bubble() -> None:
    mark = BubbleGroupReader().read(
        fake_page(), bubble_field(), [BORDERLINE_FILL, 0.02], BORDERLINE_THRESHOLD
    )
    assert mark["state"] == "ambiguous"
    assert mark["value"] is None


def test_narrower_margin_flips_the_borderline_bubble_to_marked() -> None:
    mark = BubbleGroupReader().read(
        fake_page(), bubble_field(), [BORDERLINE_FILL, 0.02], BORDERLINE_THRESHOLD, 0.15
    )
    assert mark["state"] == "marked"
    assert mark["value"] == "A"


def test_margin_flip_applies_to_digit_grid_groups() -> None:
    fills = [BORDERLINE_FILL, 0.02, 0.95, 0.02]

    default_mark = DigitGridReader().read(
        fake_page(), digit_field(), fills, BORDERLINE_THRESHOLD
    )
    narrow_mark = DigitGridReader().read(
        fake_page(), digit_field(), fills, BORDERLINE_THRESHOLD, 0.15
    )

    assert default_mark["state"] == "ambiguous"
    assert default_mark["value"] is None
    assert narrow_mark["state"] == "marked"
    assert narrow_mark["value"] == "00"


def test_null_margin_in_profile_behaves_like_the_default(
    spec: dict, clean_gray: np.ndarray, marks_abcd: dict, profile: dict
) -> None:
    explicit_null = {**profile, "ambiguityMargin": None}
    explicit_default = {**profile, "ambiguityMargin": AMBIGUITY_MARGIN}

    bgr = syn.to_bgr(clean_gray)
    baseline = process_page(bgr, 0, spec, dict(profile))
    with_null = process_page(bgr, 0, spec, explicit_null)
    with_default = process_page(bgr, 0, spec, explicit_default)

    assert with_null["marks"] == baseline["marks"]
    assert with_default["marks"] == baseline["marks"]
    marked = {m["fieldId"]: m["value"] for m in baseline["marks"] if m["state"] == "marked"}
    assert marked == marks_abcd
