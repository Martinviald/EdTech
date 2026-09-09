"""Contrato v2 (pendientes fase 4): suggestedValue, doubtReason y nullConfidence.

Los tres campos son aditivos: state/value no cambian, y con OMR_CONTRACT_V2=0
las claves no se emiten (siguen siendo opcionales en el JSON Schema).
"""

from __future__ import annotations

import numpy as np
import pytest

from app.classify import PageThreshold
from app.contracts import validate
from app.readers import (
    ENV_CONTRACT_V2,
    NULL_CONFIDENCE_CONTRAST_SCALE,
    BubbleGroupReader,
    BubbleSample,
    DigitGridReader,
    null_confidence,
)
from app.rectify import RectifiedPage
from tests.test_ambiguity_margin import bubble_field, digit_field, fake_page

THRESHOLD = PageThreshold(
    threshold=0.45,
    separable=True,
    gap=0.8,
    low_mean=0.1,
    high_mean=0.9,
    std_low=0.01,
    std_high=0.01,
)
V2_KEYS = ("suggestedValue", "doubtReason", "nullConfidence")


def four_option_field(select_mode: str = "single") -> dict:
    field = bubble_field()
    field["selectMode"] = select_mode
    field["bubbles"] = [
        {"value": value, "center": {"x": 0.2 + 0.2 * index, "y": 0.5}, "radius": 0.05}
        for index, value in enumerate("ABCD")
    ]
    return field


def read(fills: list[float], field: dict | None = None) -> dict:
    return BubbleGroupReader().read(fake_page(), field or four_option_field(), fills, THRESHOLD)


def test_marked_and_blank_carry_the_keys_as_null() -> None:
    marked = read([0.9, 0.05, 0.05, 0.05])
    blank = read([0.05, 0.05, 0.05, 0.05])
    assert marked["state"] == "marked"
    assert blank["state"] == "blank"
    for mark in (marked, blank):
        assert {key: mark[key] for key in V2_KEYS} == dict.fromkeys(V2_KEYS)


def test_ambiguous_by_margin_suggests_the_only_bubble_over_threshold() -> None:
    mark = read([0.9, 0.40, 0.05, 0.05])
    assert mark["state"] == "ambiguous"
    assert mark["suggestedValue"] == "A"
    assert mark["doubtReason"] == "margin"
    assert mark["nullConfidence"] is None


def test_ambiguous_borderline_bubble_is_itself_the_suggestion() -> None:
    mark = read([0.55, 0.05, 0.05, 0.05])
    assert mark["state"] == "ambiguous"
    assert mark["suggestedValue"] == "A"
    assert mark["doubtReason"] == "margin"


def test_ambiguous_by_band_reports_band() -> None:
    assert THRESHOLD.is_in_no_mans_land(0.65)
    mark = read([0.65, 0.05, 0.05, 0.05])
    assert mark["state"] == "ambiguous"
    assert mark["margin"] >= 0.25
    assert mark["suggestedValue"] == "A"
    assert mark["doubtReason"] == "band"


def test_ambiguous_without_a_bubble_over_threshold_has_no_suggestion() -> None:
    mark = read([0.40, 0.05, 0.05, 0.05])
    assert mark["state"] == "ambiguous"
    assert mark["suggestedValue"] is None
    assert mark["doubtReason"] == "margin"


def test_ambiguous_with_two_bubbles_over_threshold_has_no_suggestion() -> None:
    mark = read([0.9, 0.9, 0.40, 0.05])
    assert mark["state"] == "ambiguous"
    assert mark["suggestedValue"] is None


def test_select_mode_multiple_suggests_every_bubble_over_threshold() -> None:
    mark = read([0.9, 0.05, 0.9, 0.40], four_option_field("multiple"))
    assert mark["state"] == "ambiguous"
    assert mark["suggestedValue"] == "AC"


def test_two_equally_dark_bubbles_give_a_high_null_confidence() -> None:
    mark = read([0.92, 0.05, 0.90, 0.05])
    assert mark["state"] == "multiple"
    assert mark["suggestedValue"] is None
    assert mark["doubtReason"] == "multiple"
    assert mark["nullConfidence"] >= 0.7


def test_a_clear_and_a_faint_bubble_give_a_low_null_confidence() -> None:
    mark = read([1.0, 0.05, 0.81, 0.05])
    assert mark["state"] == "multiple"
    assert mark["nullConfidence"] <= 0.25


def _over(fill: float, threshold: float = 0.45) -> BubbleSample:
    return BubbleSample(
        value="X", fill=fill, margin=(fill - threshold) / threshold, uncertain=False
    )


def expected_confidence(fills: list[float], threshold: float) -> float:
    strength = (min(fills) - threshold) / (1.0 - threshold)
    contrast = (max(fills) - min(fills)) / NULL_CONFIDENCE_CONTRAST_SCALE
    return max(0.0, min(1.0, strength) * (1.0 - contrast))


@pytest.mark.parametrize(
    ("fills", "threshold"),
    [([1.0, 1.0], 0.62), ([0.9, 0.9], 0.45), ([0.9, 0.775], 0.3), ([0.56, 0.56], 0.45)],
)
def test_null_confidence_follows_strength_times_contrast(
    fills: list[float], threshold: float
) -> None:
    samples = [_over(fill, threshold) for fill in fills]
    assert null_confidence(samples, threshold) == pytest.approx(
        expected_confidence(fills, threshold)
    )


def test_two_full_bubbles_reach_full_confidence_whatever_the_page_threshold() -> None:
    assert null_confidence([_over(1.0, 0.62), _over(1.0, 0.62)], 0.62) == pytest.approx(1.0)
    assert null_confidence([_over(1.0, 0.3), _over(1.0, 0.3)], 0.3) == pytest.approx(1.0)


def test_a_contrast_of_the_full_scale_zeroes_the_confidence() -> None:
    faint = 1.0 - NULL_CONFIDENCE_CONTRAST_SCALE
    assert null_confidence([_over(1.0, 0.3), _over(faint, 0.3)], 0.3) == 0.0


def test_null_confidence_needs_two_bubbles_over_threshold() -> None:
    single = [_over(0.9), BubbleSample("B", 0.05, 0.9, False)]
    assert null_confidence(single, 0.45) == 0.0


def test_digit_grid_emits_the_keys_as_null() -> None:
    mark = DigitGridReader().read(fake_page(), digit_field(), [0.55, 0.02, 0.95, 0.02], THRESHOLD)
    assert mark["state"] == "ambiguous"
    assert {key: mark[key] for key in V2_KEYS} == dict.fromkeys(V2_KEYS)


def test_flag_off_omits_the_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ENV_CONTRACT_V2, "0")
    mark = read([0.9, 0.40, 0.05, 0.05])
    assert mark["state"] == "ambiguous"
    assert not any(key in mark for key in V2_KEYS)
    digit = DigitGridReader().read(fake_page(), digit_field(), [0.95, 0.02, 0.95, 0.02], THRESHOLD)
    assert not any(key in digit for key in V2_KEYS)


def _page_with(mark: dict) -> dict:
    return {
        "pages": [
            {
                "pageIndex": 0,
                "imageSha256": "a" * 64,
                "quality": {
                    "ok": True,
                    "sharpness": 0.7,
                    "glare": 0.05,
                    "fiducialsFound": 4,
                    "rejectReason": None,
                },
                "identity": {"mode": "qr", "raw": None, "confidence": 0.0},
                "marks": [mark],
                "pageThumbJpegBase64": None,
            }
        ]
    }


def test_readings_validate_against_the_contract_with_and_without_v2(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with_v2 = read([0.92, 0.05, 0.90, 0.05])
    assert validate("scan-result", _page_with(with_v2)) == []
    monkeypatch.setenv(ENV_CONTRACT_V2, "0")
    without_v2 = read([0.92, 0.05, 0.90, 0.05])
    assert validate("scan-result", _page_with(without_v2)) == []


def test_fake_page_is_a_rectified_page() -> None:
    page = fake_page()
    assert isinstance(page, RectifiedPage)
    assert isinstance(page.gray, np.ndarray)
