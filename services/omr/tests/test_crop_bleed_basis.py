"""Margen del recorte por lado menor y con tope por vecino (perfiles v2).

En las fotos reales del 2026-10-12, con `short-answer@1` (margen = 0.15 x lado
MAYOR) un campo ancho y bajo (P8: 0.87 x 0.06 del rectangulo fiducial) traia un
margen vertical de mas de una altura de campo y el recorte incluia la pregunta
de abajo; los lectores la transcribian. Los perfiles v2 miden el margen sobre el
lado MENOR y lo limitan a una fraccion de la distancia al campo vecino de cada
lado. Replica `cropBleedBox` de packages/types (crop.schema.ts). Los v1 no
cambian.
"""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

from app.crop import (
    CROP_PROFILES,
    bleed_box_px,
    field_footprint_px,
    printed_label_footprints_px,
)
from app.pipeline import process_page
from tests import synthetic as syn

PAGE = (1600, 2000)


def test_v1_profiles_declare_the_historical_semantics() -> None:
    for key in ("short-answer@1", "free-text@1"):
        contract = CROP_PROFILES[key].to_contract()
        assert contract["bleedBasis"] == "longer_side"
        assert contract["neighborGapFraction"] is None


@pytest.mark.parametrize(
    ("key", "bleed", "width", "quality"),
    [("short-answer@2", 0.3, 1000, 85), ("free-text@2", 0.1, 1400, 85)],
)
def test_v2_profiles_match_the_types_package(
    key: str, bleed: float, width: int, quality: int
) -> None:
    assert CROP_PROFILES[key].to_contract() == {
        "id": key.split("@")[0],
        "version": 2,
        "bleedRatio": bleed,
        "bleedBasis": "shorter_side",
        "neighborGapFraction": 0.5,
        "printedLabelGapFraction": None,
        "targetWidthPx": width,
        "jpegQuality": quality,
        "contrast": "none",
    }


def test_longer_side_keeps_the_v1_margin() -> None:
    box = (100, 500, 499, 539)

    assert bleed_box_px(box, CROP_PROFILES["short-answer@1"], PAGE) == (40, 440, 559, 599)


def test_shorter_side_margin_follows_the_height_of_a_wide_field() -> None:
    box = (100, 500, 499, 539)

    assert bleed_box_px(box, CROP_PROFILES["short-answer@2"], PAGE) == (88, 488, 511, 551)


def test_neighbor_below_caps_the_bottom_margin() -> None:
    box = (100, 500, 499, 539)
    below = (100, 550, 499, 589)

    x0, y0, x1, y1 = bleed_box_px(box, CROP_PROFILES["short-answer@2"], PAGE, [below])

    assert (x0, y0, x1) == (88, 488, 511)
    assert y1 == 539 + 5


def test_neighbor_only_caps_the_side_it_shares_an_axis_with() -> None:
    box = (100, 500, 499, 539)
    diagonal = (600, 545, 700, 600)

    assert bleed_box_px(box, CROP_PROFILES["short-answer@2"], PAGE, [diagonal]) == (
        88,
        488,
        511,
        551,
    )


def test_overlapping_neighbor_does_not_cap() -> None:
    box = (100, 500, 499, 539)
    overlapping = (300, 520, 700, 560)

    assert bleed_box_px(box, CROP_PROFILES["short-answer@2"], PAGE, [overlapping]) == (
        88,
        488,
        511,
        551,
    )


def test_v1_ignores_neighbors() -> None:
    box = (100, 500, 499, 539)
    below = (100, 550, 499, 589)

    assert bleed_box_px(box, CROP_PROFILES["short-answer@1"], PAGE, [below]) == (
        40,
        440,
        559,
        599,
    )


def test_bubble_field_footprint_is_the_box_of_its_bubbles() -> None:
    field = {
        "kind": "bubble_group",
        "region": None,
        "bubbles": [
            {"value": "A", "center": {"x": 0.25, "y": 0.5}, "radius": 0.01},
            {"value": "B", "center": {"x": 0.5, "y": 0.5}, "radius": 0.01},
        ],
    }

    x0, y0, x1, y1 = field_footprint_px(field, PAGE)

    assert (x0, x1) == pytest.approx((400 - 16, 800 + 16), abs=1)
    assert (y0, y1) == pytest.approx((1000 - 16, 1000 + 16), abs=1)


def crop_height(page: dict, field_id: str) -> int:
    mark = next(m for m in page["marks"] if m["fieldId"] == field_id)
    jpeg = np.frombuffer(base64.b64decode(mark["cropJpegBase64"]), dtype=np.uint8)
    return int(cv2.imdecode(jpeg, cv2.IMREAD_GRAYSCALE).shape[0])


@pytest.mark.parametrize("profile_id", ["short-answer@1", "short-answer@2"])
def test_wide_field_crop_with_v2_stops_before_the_next_question(
    profile_id: str, profile: dict
) -> None:
    spec = syn.make_layout_spec(fields_per_page=1)
    wide = syn.make_crop_region_field(
        "f_ancho", "2", top_left=(0.08, 0.40), bottom_right=(0.95, 0.46)
    )
    wide["response"] = {"cropProfileId": profile_id}
    below = syn.make_crop_region_field(
        "f_abajo", "3", top_left=(0.08, 0.475), bottom_right=(0.95, 0.535)
    )
    spec["fields"].extend([wide, below])
    gray = syn.render_page(spec, 0, marks={"f_001": "A"}, rng=np.random.default_rng(3))

    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    height = crop_height(page, "f_ancho")
    width_px = 1000
    if profile_id == "short-answer@1":
        assert height > 0.3 * width_px
    else:
        assert height < 0.15 * width_px


LABEL_LEFT_OF_BOX = (70, 505, 89, 525)


def test_v3_profile_adds_the_printed_label_cap() -> None:
    assert "free-text@3" not in CROP_PROFILES
    assert CROP_PROFILES["short-answer@3"].to_contract() == {
        "id": "short-answer",
        "version": 3,
        "bleedRatio": 0.3,
        "bleedBasis": "shorter_side",
        "neighborGapFraction": 0.5,
        "printedLabelGapFraction": 0.5,
        "targetWidthPx": 1000,
        "jpegQuality": 85,
        "contrast": "none",
    }


def test_v3_left_margin_stops_before_the_printed_question_number() -> None:
    box = (100, 500, 499, 539)

    x0, y0, x1, y1 = bleed_box_px(
        box, CROP_PROFILES["short-answer@3"], PAGE, printed_labels=[LABEL_LEFT_OF_BOX]
    )

    assert x0 == 100 - 5
    assert x0 > LABEL_LEFT_OF_BOX[2]
    assert (y0, x1, y1) == (488, 511, 551)


@pytest.mark.parametrize("key", ["short-answer@1", "short-answer@2", "free-text@2"])
def test_v1_and_v2_ignore_printed_labels(key: str) -> None:
    box = (100, 500, 499, 539)
    profile = CROP_PROFILES[key]

    assert bleed_box_px(box, profile, PAGE, printed_labels=[LABEL_LEFT_OF_BOX]) == bleed_box_px(
        box, profile, PAGE
    )


def test_v3_without_printed_labels_crops_like_v2() -> None:
    box = (100, 500, 499, 539)

    assert bleed_box_px(box, CROP_PROFILES["short-answer@3"], PAGE) == bleed_box_px(
        box, CROP_PROFILES["short-answer@2"], PAGE
    )


def test_printed_label_footprints_come_from_the_response_of_each_field() -> None:
    fields = [
        {"fieldId": "f_001", "kind": "bubble_group", "bubbles": [], "region": None},
        {
            "fieldId": "f_002",
            "kind": "crop_region",
            "response": {
                "cropProfileId": "short-answer@3",
                "printedLabelRegion": {
                    "topLeft": {"x": 0.25, "y": 0.5},
                    "bottomRight": {"x": 0.0625, "y": 0.25},
                },
            },
        },
    ]

    assert printed_label_footprints_px(fields, PAGE) == [(100, 500, 400, 1000)]


def numbered_crop_height(profile_id: str, profile: dict) -> int:
    spec = syn.make_layout_spec(fields_per_page=1)
    field = syn.make_crop_region_field(
        "f_numero", "2", top_left=(0.20, 0.40), bottom_right=(0.60, 0.50)
    )
    field["response"] = {
        "cropProfileId": profile_id,
        "printedLabelRegion": {
            "topLeft": {"x": 0.17, "y": 0.42},
            "bottomRight": {"x": 0.19, "y": 0.44},
        },
    }
    spec["fields"].append(field)
    gray = syn.render_page(spec, 0, marks={"f_001": "A"}, rng=np.random.default_rng(3))
    return crop_height(process_page(syn.to_bgr(gray), 0, spec, profile), "f_numero")


def test_crop_with_v3_is_narrower_on_the_side_of_the_question_number(profile: dict) -> None:
    assert numbered_crop_height("short-answer@3", profile) > numbered_crop_height(
        "short-answer@2", profile
    )
