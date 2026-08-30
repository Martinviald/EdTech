"""Rectifier (C19): deteccion de fiduciales y homografia, con y sin perturbaciones."""

from __future__ import annotations

import numpy as np

from app.geometry import point_to_px, workspace_size
from app.rectify import FiducialFailure, RectifiedPage, rectify
from tests import synthetic as syn


def test_clean_page_rectifies_to_workspace(spec: dict, clean_gray: np.ndarray) -> None:
    result = rectify(syn.to_bgr(clean_gray), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4
    width, height = workspace_size(spec)
    assert result.gray.shape == (height, width)
    assert not result.touches_border


def test_rotated_page_still_finds_four_fiducials(spec: dict, clean_gray: np.ndarray) -> None:
    rotated = syn.rotate(syn.on_canvas(clean_gray), 3)
    result = rectify(syn.to_bgr(rotated), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4


def test_perspective_page_still_finds_four_fiducials(spec: dict, clean_gray: np.ndarray) -> None:
    warped = syn.perspective(syn.on_canvas(clean_gray), 0.02, np.random.default_rng(5))
    result = rectify(syn.to_bgr(warped), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4


def test_missing_fiducial_is_a_failure(spec: dict, clean_gray: np.ndarray) -> None:
    erased = clean_gray.copy()
    erased[:80, :80] = syn.PAPER_GRAY
    result = rectify(syn.to_bgr(erased), spec)
    assert isinstance(result, FiducialFailure)
    assert result.fiducials_found == 3


def test_rectified_space_maps_bubbles_where_the_spec_says(
    spec: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    rotated = syn.rotate(syn.on_canvas(clean_gray), -4)
    result = rectify(syn.to_bgr(rotated), spec)
    assert isinstance(result, RectifiedPage)
    field = next(f for f in spec["fields"] if f["fieldId"] == "f_001")
    marked = next(b for b in field["bubbles"] if b["value"] == marks_abcd["f_001"])
    blank = next(b for b in field["bubbles"] if b["value"] != marks_abcd["f_001"])
    marked_px = point_to_px(marked["center"], result.size)
    blank_px = point_to_px(blank["center"], result.size)
    assert result.gray[marked_px[1], marked_px[0]] < 140
    assert result.gray[blank_px[1], blank_px[0]] > 180
