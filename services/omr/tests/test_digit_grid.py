"""DigitGridReader (CD-8): regla de oro — cualquier grupo dudoso => campo ambiguous.

Un numero con un digito inventado es invisible aguas abajo (45 != 46), asi que
el lector jamas emite un valor si algun grupo duda, esta doble o queda vacio
entre grupos marcados. Todos los grupos vacios y claros => blank.
"""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

from app.contracts import validate
from app.pipeline import process_page
from tests import synthetic as syn

BUBBLE_MARKS = {"f_001": "A", "f_002": "C", "f_003": "B", "f_004": "D"}


@pytest.fixture(scope="module")
def grid_spec() -> dict:
    spec = syn.make_layout_spec(fields_per_page=4)
    spec["fields"].append(
        syn.make_digit_grid_field("f_num", "5", digit_count=3, origin=(0.6, 0.25))
    )
    return spec


def read_grid_mark(grid_spec: dict, profile: dict, **render_kwargs) -> dict:
    gray = syn.render_page(grid_spec, 0, rng=np.random.default_rng(11), **render_kwargs)
    page = process_page(syn.to_bgr(gray), 0, grid_spec, profile)
    assert page["quality"]["ok"] is True
    return next(mark for mark in page["marks"] if mark["fieldId"] == "f_num")


def test_clean_multi_digit_grid_reads_concatenated_value(grid_spec: dict, profile: dict) -> None:
    mark = read_grid_mark(
        grid_spec, profile, marks={**BUBBLE_MARKS, "f_num": {0: "4", 1: "0", 2: "7"}}
    )
    assert mark["state"] == "marked"
    assert mark["value"] == "407"
    assert mark["cropJpegBase64"] is None


def test_double_marked_digit_makes_whole_field_ambiguous(
    grid_spec: dict, profile: dict
) -> None:
    mark = read_grid_mark(
        grid_spec, profile, marks={**BUBBLE_MARKS, "f_num": {0: "4", 1: ["0", "8"], 2: "7"}}
    )
    assert mark["state"] == "ambiguous"
    assert mark["value"] is None
    crop = cv2.imdecode(
        np.frombuffer(base64.b64decode(mark["cropJpegBase64"]), dtype=np.uint8),
        cv2.IMREAD_GRAYSCALE,
    )
    assert crop is not None
    assert crop.size > 0


def test_blank_digit_between_marked_digits_makes_field_ambiguous(
    grid_spec: dict, profile: dict
) -> None:
    mark = read_grid_mark(grid_spec, profile, marks={**BUBBLE_MARKS, "f_num": {0: "4", 2: "7"}})
    assert mark["state"] == "ambiguous"
    assert mark["value"] is None
    assert mark["cropJpegBase64"] is not None


def test_partially_filled_digit_makes_field_ambiguous(grid_spec: dict, profile: dict) -> None:
    mark = read_grid_mark(
        grid_spec,
        profile,
        marks={**BUBBLE_MARKS, "f_num": {0: "4", 1: "0", 2: "7"}},
        coverage={"f_num:1:0": 0.5},
    )
    assert mark["state"] == "ambiguous"
    assert mark["value"] is None


def test_all_blank_digit_grid_is_blank(grid_spec: dict, profile: dict) -> None:
    mark = read_grid_mark(grid_spec, profile, marks=dict(BUBBLE_MARKS))
    assert mark["state"] == "blank"
    assert mark["value"] is None


@pytest.mark.parametrize("shift_px", [2, -2])
def test_column_shifted_marks_still_read_exactly(
    grid_spec: dict, profile: dict, shift_px: int
) -> None:
    mark = read_grid_mark(
        grid_spec,
        profile,
        marks={**BUBBLE_MARKS, "f_num": {0: "4", 1: "0", 2: "7"}},
        mark_offsets={"f_num": (shift_px, 0)},
    )
    assert mark["state"] == "marked"
    assert mark["value"] == "407"


def test_digit_grid_page_validates_against_scan_result_contract(
    grid_spec: dict, profile: dict
) -> None:
    gray = syn.render_page(
        grid_spec,
        0,
        marks={**BUBBLE_MARKS, "f_num": {0: "1", 1: "2", 2: "3"}},
        rng=np.random.default_rng(12),
    )
    page = process_page(syn.to_bgr(gray), 0, grid_spec, profile)
    assert validate("scan-result", {"pages": [page]}) == []
