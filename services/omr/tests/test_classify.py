"""MarkClassifier (C21): umbral relativo por hoja, separabilidad y estados de marca."""

from __future__ import annotations

import numpy as np
import pytest

from app.classify import AMBIGUITY_MARGIN, margin_of, page_threshold
from app.pipeline import process_page
from tests import synthetic as syn


def marks_by_number(page: dict) -> dict[str, dict]:
    return {mark["printedNumber"]: mark for mark in page["marks"]}


def test_page_threshold_separates_bimodal_fills() -> None:
    fills = [0.08, 0.1, 0.12, 0.09, 0.11, 0.88, 0.92, 0.85]
    result = page_threshold(fills)
    assert result.separable is True
    assert 0.3 < result.threshold < 0.7


def test_page_threshold_rejects_all_blank_fills() -> None:
    fills = [0.08, 0.1, 0.12, 0.09, 0.11, 0.1, 0.09, 0.1]
    result = page_threshold(fills)
    assert result.separable is False


def test_page_threshold_rejects_constant_fills() -> None:
    assert page_threshold([0.1] * 20).separable is False
    assert page_threshold([0.1]).separable is False


def test_margin_formula_is_relative_to_threshold() -> None:
    assert margin_of(0.82, 0.46) == pytest.approx(abs(0.82 - 0.46) / 0.46)
    assert margin_of(0.46, 0.46) == 0.0


def test_clean_sheet_reads_marked_and_blank_correctly(
    clean_result: dict, marks_abcd: dict
) -> None:
    by_number = marks_by_number(clean_result)
    assert len(by_number) == 8
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
        assert mark["margin"] >= AMBIGUITY_MARGIN
        assert mark["cropJpegBase64"] is None
    unmarked = by_number["8"]
    assert unmarked["state"] == "blank"
    assert unmarked["value"] is None
    assert unmarked["fill"] < unmarked["threshold"]


def test_double_mark_is_multiple_with_crop_evidence(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(
        spec, 0, marks={**marks_abcd, "f_002": ["B", "D"]}, rng=np.random.default_rng(2)
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    mark = marks_by_number(page)["2"]
    assert mark["state"] == "multiple"
    assert mark["value"] is None
    assert mark["cropJpegBase64"] is not None
    assert marks_by_number(page)["1"]["state"] == "marked"


def test_half_erased_mark_is_ambiguous_within_the_band(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(
        spec, 0, marks=marks_abcd, coverage={"f_003": 0.35}, rng=np.random.default_rng(3)
    )
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    mark = marks_by_number(page)["3"]
    assert mark["state"] == "ambiguous"
    assert mark["value"] is None
    assert mark["margin"] < AMBIGUITY_MARGIN
    assert mark["cropJpegBase64"] is not None


def test_fully_blank_page_is_rejected_never_read_as_blank(
    spec: dict, profile: dict
) -> None:
    gray = syn.render_page(spec, 0, marks={}, rng=np.random.default_rng(1))
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "no_separable_marks"
    assert page["marks"] == []
    assert page["pageThumbJpegBase64"] is not None


def test_diagonal_shadow_read_thanks_to_relative_threshold(
    spec: dict, profile: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    shadowed = syn.diagonal_shadow(clean_gray, 0.35)
    page = process_page(syn.to_bgr(shadowed), 0, spec, profile)
    assert page["quality"]["ok"] is True
    _assert_expected_marks(page, marks_abcd)


def test_gray_photocopy_read_thanks_to_relative_threshold(
    spec: dict, profile: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    photocopy = syn.photocopy_gray(clean_gray)
    page = process_page(syn.to_bgr(photocopy), 0, spec, profile)
    assert page["quality"]["ok"] is True
    _assert_expected_marks(page, marks_abcd)


def test_rotated_photo_reads_correctly(
    spec: dict, profile: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    rotated = syn.rotate(syn.on_canvas(clean_gray), 3)
    page = process_page(syn.to_bgr(rotated), 0, spec, profile)
    assert page["quality"]["ok"] is True
    _assert_expected_marks(page, marks_abcd)


def test_perspective_photo_reads_correctly(
    spec: dict, profile: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    warped = syn.perspective(syn.on_canvas(clean_gray), 0.02, np.random.default_rng(5))
    page = process_page(syn.to_bgr(warped), 0, spec, profile)
    assert page["quality"]["ok"] is True
    _assert_expected_marks(page, marks_abcd)


def test_low_resolution_rescale_reads_correctly(
    spec: dict, profile: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    small = syn.rescale(clean_gray, 0.55)
    page = process_page(syn.to_bgr(small), 0, spec, profile)
    assert page["quality"]["ok"] is True
    _assert_expected_marks(page, marks_abcd)


def test_noisy_shadowed_photo_reads_correctly(
    spec: dict, profile: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    messy = syn.add_noise(
        syn.diagonal_shadow(clean_gray, 0.3), 5, np.random.default_rng(8)
    )
    page = process_page(syn.to_bgr(messy), 0, spec, profile)
    assert page["quality"]["ok"] is True
    _assert_expected_marks(page, marks_abcd)


def _assert_expected_marks(page: dict, marks_abcd: dict) -> None:
    by_number = marks_by_number(page)
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
    assert by_number["8"]["state"] == "blank"
