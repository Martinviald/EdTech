"""Perfil de recorte (S2) e `inkRatio` descontando la plantilla impresa (S1).

Paginas rectificadas sinteticas: papel con ruido, casillas impresas como
rectangulos de 2 px y trazos de lapiz. Nada se comitea como binario.
"""

from __future__ import annotations

import hashlib

import cv2
import numpy as np
import pytest

from app.classify import crop_region_jpeg
from app.crop import (
    CROP_PROFILES,
    LEGACY_CROP_PROFILE,
    CropProfile,
    crop_with_profile,
    resolve_crop_profile,
)
from app.geometry import point_to_px
from app.ink import measure_ink
from app.rectify import RectifiedPage

PAGE_SIZE = (1600, 2000)
PAPER = 235
PRINT = 40
PENCIL = 80
BOX_W = 0.04
BOX_H = 0.04
ROW_Y = 0.40
FIRST_X = 0.30
PART_IDS = ("c1", "c2", "sep", "c3")


def blank_gray(seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 3, (PAGE_SIZE[1], PAGE_SIZE[0]))
    return np.clip(PAPER + noise, 0, 255).astype(np.uint8)


def boxes_spec() -> list[dict]:
    boxes = []
    for index, part_id in enumerate(PART_IDS):
        x0 = FIRST_X + index * (BOX_W + 0.01)
        boxes.append(
            {
                "partId": part_id,
                "role": "decimal_separator" if part_id == "sep" else "char",
                "region": {
                    "topLeft": {"x": x0, "y": ROW_Y},
                    "bottomRight": {"x": x0 + BOX_W, "y": ROW_Y + BOX_H},
                },
            }
        )
    return boxes


def field_region() -> dict:
    boxes = boxes_spec()
    return {
        "topLeft": {"x": boxes[0]["region"]["topLeft"]["x"] - 0.01, "y": ROW_Y - 0.01},
        "bottomRight": {
            "x": boxes[-1]["region"]["bottomRight"]["x"] + 0.01,
            "y": ROW_Y + BOX_H + 0.01,
        },
    }


def box_px(box: dict) -> tuple[int, int, int, int]:
    x0, y0 = point_to_px(box["region"]["topLeft"], PAGE_SIZE)
    x1, y1 = point_to_px(box["region"]["bottomRight"], PAGE_SIZE)
    return x0, y0, x1, y1


def draw_boxes(gray: np.ndarray, *, shift_px: tuple[int, int] = (0, 0)) -> None:
    for box in boxes_spec():
        x0, y0, x1, y1 = box_px(box)
        cv2.rectangle(
            gray,
            (x0 + shift_px[0], y0 + shift_px[1]),
            (x1 + shift_px[0], y1 + shift_px[1]),
            PRINT,
            2,
        )


def page_of(gray: np.ndarray) -> RectifiedPage:
    return RectifiedPage(gray=gray, size=PAGE_SIZE, fiducials_found=4, touches_border=False)


def box_center(part_id: str) -> tuple[int, int]:
    box = next(b for b in boxes_spec() if b["partId"] == part_id)
    x0, y0, x1, y1 = box_px(box)
    return (x0 + x1) // 2, (y0 + y1) // 2


def draw_one(gray: np.ndarray, part_id: str) -> None:
    cx, cy = box_center(part_id)
    cv2.line(gray, (cx + 4, cy - 22), (cx + 2, cy + 22), PENCIL, 5)
    cv2.line(gray, (cx + 4, cy - 22), (cx - 8, cy - 10), PENCIL, 5)


def decode(jpeg: np.ndarray) -> np.ndarray:
    return cv2.imdecode(jpeg, cv2.IMREAD_GRAYSCALE)


def test_empty_boxes_have_no_ink_despite_printed_borders() -> None:
    gray = blank_gray()
    draw_boxes(gray)

    ink = measure_ink(page_of(gray), field_region(), boxes_spec())

    assert ink.ratio < 0.002
    assert ink.by_part is not None
    assert set(ink.by_part) == set(PART_IDS)
    assert max(ink.by_part.values()) < 0.002


def test_empty_boxes_misregistered_by_the_homography_still_read_empty() -> None:
    gray = blank_gray()
    draw_boxes(gray, shift_px=(9, -7))

    ink = measure_ink(page_of(gray), field_region(), boxes_spec())

    assert ink.ratio < 0.005
    assert ink.by_part is not None
    assert max(ink.by_part.values()) < 0.01


def test_empty_region_without_boxes_discounts_its_printed_frame() -> None:
    gray = blank_gray()
    x0, y0 = point_to_px(field_region()["topLeft"], PAGE_SIZE)
    x1, y1 = point_to_px(field_region()["bottomRight"], PAGE_SIZE)
    cv2.rectangle(gray, (x0 + 5, y0 + 4), (x1 + 5, y1 + 4), PRINT, 2)

    ink = measure_ink(page_of(gray), field_region())

    assert ink.ratio < 0.002
    assert ink.by_part is None


def test_a_single_stroke_lands_only_in_its_box() -> None:
    gray = blank_gray()
    draw_boxes(gray)
    draw_one(gray, "c2")

    ink = measure_ink(page_of(gray), field_region(), boxes_spec())

    assert ink.by_part is not None
    assert ink.by_part["c2"] > 0.05
    assert ink.by_part["c1"] < 0.002
    assert ink.by_part["c3"] < 0.002
    assert ink.ratio > 0.005


def test_small_decimal_point_survives_the_measure_and_the_jpeg() -> None:
    gray = blank_gray()
    draw_boxes(gray)
    cx, cy = box_center("sep")
    cv2.circle(gray, (cx, cy + 12), 3, PENCIL, -1)
    region = field_region()

    ink = measure_ink(page_of(gray), region, boxes_spec())
    assert ink.by_part is not None
    assert ink.by_part["sep"] > 0.001

    profile = CROP_PROFILES["short-answer@1"]
    image = crop_with_profile(page_of(gray), region, profile)
    crop = decode(image.jpeg)
    rx0, ry0 = point_to_px(region["topLeft"], PAGE_SIZE)
    rx1, ry1 = point_to_px(region["bottomRight"], PAGE_SIZE)
    pad = round(profile.bleed_ratio * max(rx1 - rx0 + 1, ry1 - ry0 + 1))
    scale = crop.shape[1] / (rx1 - rx0 + 1 + 2 * pad)
    px = round((cx - rx0 + pad) * scale)
    py = round((cy + 12 - ry0 + pad) * scale)
    neighborhood = crop[py - 4 : py + 5, px - 4 : px + 5]
    assert int(neighborhood.min()) < PAPER - 80


def test_ink_outside_the_box_shows_up_in_the_bleed_but_not_in_ink_ratio() -> None:
    gray = blank_gray()
    draw_boxes(gray)
    region = field_region()
    rx0, ry0 = point_to_px(region["topLeft"], PAGE_SIZE)
    rx1, _ = point_to_px(region["bottomRight"], PAGE_SIZE)
    stroke_y = ry0 - 20
    cv2.line(gray, (rx0 + 30, stroke_y), (rx0 + 90, stroke_y - 6), PENCIL, 5)

    ink = measure_ink(page_of(gray), region, boxes_spec())
    assert ink.ratio < 0.002

    profile = CROP_PROFILES["short-answer@1"]
    bled = decode(crop_with_profile(page_of(gray), region, profile).jpeg)
    pad = round(profile.bleed_ratio * (rx1 - rx0 + 1))
    scale = bled.shape[1] / (rx1 - rx0 + 1 + 2 * pad)
    top_band = bled[: round((pad - 10) * scale), :]
    assert int(top_band.min()) < PAPER - 80

    legacy = decode(crop_region_jpeg(page_of(gray), region))
    assert int(legacy[:6, :].min()) > PAPER - 40


def test_hard_phone_shadow_is_not_ink_and_light_pencil_still_is() -> None:
    gray = blank_gray().astype(np.float32)
    region = field_region()
    shadow_x = box_center("sep")[0]
    gray[:, shadow_x:] *= 0.55
    shadowed = np.clip(gray, 0, 255).astype(np.uint8)
    draw_boxes(shadowed)

    empty = measure_ink(page_of(shadowed.copy()), region, boxes_spec())
    assert empty.ratio < 0.005

    cx, cy = box_center("c3")
    cv2.line(shadowed, (cx, cy - 20), (cx, cy + 20), int(PAPER * 0.55) - 35, 4)
    written = measure_ink(page_of(shadowed), region, boxes_spec())
    assert written.by_part is not None
    assert written.by_part["c3"] > 0.03


@pytest.mark.parametrize("key", sorted(CROP_PROFILES))
def test_profile_sets_output_width_and_keeps_aspect(key: str) -> None:
    gray = blank_gray()
    region = field_region()
    profile = CROP_PROFILES[key]

    image = crop_with_profile(page_of(gray), region, profile)
    crop = decode(image.jpeg)

    assert (image.width_px, image.height_px) == (crop.shape[1], crop.shape[0])
    assert image.width_px == profile.target_width_px
    rx0, ry0 = point_to_px(region["topLeft"], PAGE_SIZE)
    rx1, ry1 = point_to_px(region["bottomRight"], PAGE_SIZE)
    sides = (rx1 - rx0 + 1, ry1 - ry0 + 1)
    side = max(sides) if profile.bleed_basis == "longer_side" else min(sides)
    pad = round(profile.bleed_ratio * side)
    expected = (rx1 - rx0 + 1 + 2 * pad) / (ry1 - ry0 + 1 + 2 * pad)
    assert image.width_px / image.height_px == pytest.approx(expected, rel=0.02)


def test_bleed_is_clipped_to_the_rectified_page() -> None:
    gray = blank_gray()
    region = {"topLeft": {"x": 0.0, "y": 0.0}, "bottomRight": {"x": 0.2, "y": 0.05}}
    profile = CROP_PROFILES["short-answer@1"]

    image = crop_with_profile(page_of(gray), region, profile)

    x1, y1 = point_to_px(region["bottomRight"], PAGE_SIZE)
    pad = round(profile.bleed_ratio * (x1 + 1))
    expected = (x1 + 1 + pad) / (y1 + 1 + pad)
    assert image.width_px / image.height_px == pytest.approx(expected, rel=0.02)


def test_clahe_contrast_is_optional_and_keeps_the_size() -> None:
    gray = blank_gray()
    draw_boxes(gray)
    draw_one(gray, "c1")
    base = CROP_PROFILES["short-answer@1"]
    clahe = CropProfile(base.id, base.version, base.bleed_ratio, 800, 85, "clahe")

    plain = crop_with_profile(page_of(gray), field_region(), base)
    enhanced = crop_with_profile(page_of(gray), field_region(), clahe)

    assert enhanced.width_px == 800
    assert enhanced.sha256 != plain.sha256


def test_sha256_is_stable_for_the_same_input() -> None:
    profile = CROP_PROFILES["free-text@1"]
    first = crop_with_profile(page_of(blank_gray(5)), field_region(), profile)
    second = crop_with_profile(page_of(blank_gray(5)), field_region(), profile)
    other = crop_with_profile(page_of(blank_gray(6)), field_region(), profile)

    assert first.sha256 == second.sha256
    assert first.sha256 == hashlib.sha256(first.jpeg.tobytes()).hexdigest()
    assert len(first.sha256) == 64
    assert other.sha256 != first.sha256


def test_without_profile_the_crop_is_byte_identical_to_the_historic_one() -> None:
    gray = blank_gray()
    draw_boxes(gray)
    draw_one(gray, "c1")
    region = field_region()
    x0, y0 = point_to_px(region["topLeft"], PAGE_SIZE)
    x1, y1 = point_to_px(region["bottomRight"], PAGE_SIZE)
    historic = gray[y0 : y1 + 1, x0 : x1 + 1]
    resized = cv2.resize(
        historic,
        (600, max(1, round(historic.shape[0] * 600 / historic.shape[1]))),
        interpolation=cv2.INTER_AREA,
    )
    _, expected = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 70])

    assert crop_region_jpeg(page_of(gray), region).tobytes() == expected.tobytes()


def test_unknown_or_missing_profile_falls_back_to_the_historic_one() -> None:
    assert resolve_crop_profile(None) is LEGACY_CROP_PROFILE
    assert resolve_crop_profile("no-existe@9") is LEGACY_CROP_PROFILE
    assert resolve_crop_profile("short-answer@1") is CROP_PROFILES["short-answer@1"]
    assert LEGACY_CROP_PROFILE.key not in CROP_PROFILES
