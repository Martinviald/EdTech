"""Catalogo de suciedad real (B2/T1, ~2.700 escaneos GradeCam documentados).

Cada test declara el comportamiento CORRECTO del clasificador ante un defecto
real. Principio rector: ante la duda, dudar (ambiguous/multiple -> cola) o
rechazar la pagina — JAMAS decidir mal con confianza (criterio MVP: cero
marcas incorrectas decididas con confianza alta).
"""

from __future__ import annotations

import numpy as np
import pytest

from app.pipeline import process_page
from tests import synthetic as syn

UNDECIDED_STATES = {"multiple", "ambiguous"}


def marks_by_number(page: dict) -> dict[str, dict]:
    return {mark["printedNumber"]: mark for mark in page["marks"]}


def test_double_bubble_with_unequal_fills_never_confident_marked(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(
        spec,
        0,
        marks={**marks_abcd, "f_002": ["B", "D"]},
        coverage={"f_002:D": 0.4},
        rng=np.random.default_rng(2),
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    mark = marks_by_number(page)["2"]
    assert mark["state"] in UNDECIDED_STATES
    assert mark["value"] is None
    assert mark["cropJpegBase64"] is not None
    assert marks_by_number(page)["1"]["state"] == "marked"


def test_half_erased_then_remarked_is_ambiguous_without_clear_separation(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(
        spec,
        0,
        marks={**marks_abcd, "f_003": ["C", "A"]},
        coverage={"f_003:C": 0.3},
        rng=np.random.default_rng(3),
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    mark = marks_by_number(page)["3"]
    assert mark["state"] == "ambiguous"
    assert mark["value"] is None
    assert mark["cropJpegBase64"] is not None


def test_well_erased_then_remarked_is_marked_with_the_new_value(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(
        spec,
        0,
        marks={**marks_abcd, "f_003": ["C", "A"]},
        coverage={"f_003:C": 0.08},
        rng=np.random.default_rng(3),
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    mark = marks_by_number(page)["3"]
    assert mark["state"] == "marked"
    assert mark["value"] == "A"


def test_very_light_pencil_whole_sheet_absorbed_by_relative_cutoff(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(
        spec, 0, marks=marks_abcd, pencil_gray=200, rng=np.random.default_rng(42)
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    assert page["quality"]["ok"] is True
    by_number = marks_by_number(page)
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
    assert by_number["8"]["state"] == "blank"


@pytest.mark.parametrize("style", ["cross", "tick"])
def test_cross_or_tick_instead_of_fill_never_confident_blank(
    spec: dict, profile: dict, marks_abcd: dict, style: str
) -> None:
    gray = syn.render_page(
        spec, 0, marks=marks_abcd, styles={"f_004": style}, rng=np.random.default_rng(4)
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    mark = marks_by_number(page)["4"]
    assert mark["state"] in {"marked", "ambiguous"}
    if mark["state"] == "marked":
        assert mark["value"] == "D"
    for number in ("1", "2", "3", "5", "6", "7"):
        assert marks_by_number(page)[number]["state"] == "marked"


def test_overflowed_fill_outside_the_circle_is_still_marked(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(
        spec, 0, marks=marks_abcd, styles={"f_005": "overflow"}, rng=np.random.default_rng(5)
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    by_number = marks_by_number(page)
    assert by_number["5"]["state"] == "marked"
    assert by_number["5"]["value"] == "A"
    assert by_number["1"]["state"] == "marked"
    assert by_number["6"]["state"] == "marked"


def test_smudge_over_unmarked_bubble_never_confident_marked(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(spec, 0, marks=marks_abcd, rng=np.random.default_rng(8))
    center = syn.bubble_center_px(spec, "f_008", "B")
    radius = syn.bubble_radius_px(spec)
    smudged = syn.smudge(
        gray,
        (center[0] + radius, center[1] - radius // 2),
        round(radius * 0.8),
        120,
        np.random.default_rng(9),
    )
    page = process_page(syn.to_bgr(smudged), 0, spec, profile)
    mark = marks_by_number(page)["8"]
    assert mark["state"] in {"blank", "ambiguous"}
    assert mark["value"] is None


def test_wrinkled_sheet_reads_correctly(spec: dict, profile: dict, marks_abcd: dict) -> None:
    gray = syn.wrinkle(
        syn.render_page(spec, 0, marks=marks_abcd, rng=np.random.default_rng(42)), 3.0
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    assert page["quality"]["ok"] is True
    _assert_expected_marks(page, marks_abcd)


def test_hard_side_shadow_band_reads_correctly(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.side_shadow(
        syn.render_page(spec, 0, marks=marks_abcd, rng=np.random.default_rng(42)), 0.35, 0.45
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    assert page["quality"]["ok"] is True
    _assert_expected_marks(page, marks_abcd)


@pytest.mark.parametrize(
    "few_marks",
    [{"f_001": "A"}, {"f_001": "A", "f_005": "C"}],
    ids=["one-mark", "two-marks"],
)
def test_page_with_one_or_two_marks_reads_without_inventing_threshold(
    spec: dict, profile: dict, few_marks: dict
) -> None:
    gray = syn.render_page(spec, 0, marks=few_marks, rng=np.random.default_rng(6))
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    assert page["quality"]["ok"] is True
    by_number = marks_by_number(page)
    for field_id, expected in few_marks.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
    unmarked = [m for m in page["marks"] if m["printedNumber"] not in
                {str(int(k.removeprefix("f_"))) for k in few_marks}]
    assert all(mark["state"] == "blank" for mark in unmarked)


def test_all_bubbles_marked_yields_multiple_per_field_not_page_reject(
    spec: dict, profile: dict
) -> None:
    all_marks = {
        field["fieldId"]: [bubble["value"] for bubble in field["bubbles"]]
        for field in spec["fields"]
    }
    gray = syn.render_page(spec, 0, marks=all_marks, rng=np.random.default_rng(6))
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    assert page["quality"]["ok"] is True
    assert len(page["marks"]) == 8
    for mark in page["marks"]:
        assert mark["state"] == "multiple"
        assert mark["value"] is None
        assert mark["cropJpegBase64"] is not None


def _assert_expected_marks(page: dict, marks_abcd: dict) -> None:
    by_number = marks_by_number(page)
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
    assert by_number["8"]["state"] == "blank"
