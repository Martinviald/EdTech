"""QualityGate (C20): una captura mala se rechaza ANTES de leerse."""

from __future__ import annotations

import numpy as np

from app.pipeline import process_page
from app.quality import sharpness_score
from app.rectify import RectifiedPage, rectify
from tests import synthetic as syn


def test_clean_page_is_sharp(clean_result: dict) -> None:
    assert clean_result["quality"]["ok"] is True
    assert clean_result["quality"]["rejectReason"] is None
    assert clean_result["quality"]["sharpness"] > 0.5


def test_blurred_page_rejected_as_blurry(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    blurred = syn.blur(clean_gray, 2.5)
    page = process_page(syn.to_bgr(blurred), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "blurry"
    assert page["quality"]["sharpness"] < 0.2
    assert page["marks"] == []
    assert page["pageThumbJpegBase64"] is not None


def test_sharpness_separates_clean_from_blurred(spec: dict, clean_gray: np.ndarray) -> None:
    clean_rectified = rectify(syn.to_bgr(clean_gray), spec)
    blurred_rectified = rectify(syn.to_bgr(syn.blur(clean_gray, 2.5)), spec)
    assert isinstance(clean_rectified, RectifiedPage)
    assert isinstance(blurred_rectified, RectifiedPage)
    assert sharpness_score(clean_rectified.gray) > 0.5
    assert sharpness_score(blurred_rectified.gray) < 0.2


def test_glare_spot_rejected_as_glare(spec: dict, clean_gray: np.ndarray, profile: dict) -> None:
    shiny = syn.glare_spot(clean_gray, (0.5, 0.5), 0.3)
    page = process_page(syn.to_bgr(shiny), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "glare"
    assert page["quality"]["glare"] > profile["maxGlare"]
    assert page["marks"] == []


def test_fiducial_glued_to_border_rejected_as_cropped(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    cropped = clean_gray[35:, 35:]
    page = process_page(syn.to_bgr(cropped), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "cropped"


def test_missing_fiducials_rejected_with_count(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    erased = clean_gray.copy()
    erased[:80, :80] = syn.PAPER_GRAY
    page = process_page(syn.to_bgr(erased), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "fiducials_missing"
    assert page["quality"]["fiducialsFound"] == 3
    assert page["marks"] == []
    assert page["pageThumbJpegBase64"] is not None
