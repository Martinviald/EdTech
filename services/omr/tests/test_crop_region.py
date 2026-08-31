"""CropRegionReader (CD-9): el recorte ES la respuesta — siempre presente."""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

from app.contracts import validate
from app.geometry import fiducial_rect_mm
from app.pipeline import process_page
from tests import synthetic as syn


@pytest.fixture(scope="module")
def crop_spec() -> dict:
    spec = syn.make_layout_spec(fields_per_page=4)
    spec["fields"].append(syn.make_crop_region_field("f_dev", "5"))
    return spec


def test_crop_region_always_returns_decodable_jpeg(crop_spec: dict, profile: dict) -> None:
    gray = syn.render_page(
        crop_spec, 0, marks={"f_001": "A", "f_003": "C"}, rng=np.random.default_rng(13)
    )
    page = process_page(syn.to_bgr(gray), 0, crop_spec, profile)

    assert page["quality"]["ok"] is True
    mark = next(m for m in page["marks"] if m["fieldId"] == "f_dev")
    assert mark["state"] == "marked"
    assert mark["value"] is None
    assert mark["fill"] == 0.0
    assert mark["threshold"] == 0.5
    assert mark["margin"] == 1.0
    crop = cv2.imdecode(
        np.frombuffer(base64.b64decode(mark["cropJpegBase64"]), dtype=np.uint8),
        cv2.IMREAD_GRAYSCALE,
    )
    assert crop is not None
    rect_w_mm, rect_h_mm = fiducial_rect_mm(crop_spec)
    region_aspect = ((0.9 - 0.1) * rect_w_mm) / ((0.95 - 0.75) * rect_h_mm)
    assert crop.shape[1] / crop.shape[0] == pytest.approx(region_aspect, rel=0.05)

    assert validate("scan-result", {"pages": [page]}) == []


def test_page_with_only_crop_regions_is_not_rejected(profile: dict) -> None:
    spec = syn.make_layout_spec(fields_per_page=1)
    spec["fields"] = [syn.make_crop_region_field("f_dev", "1")]
    gray = syn.render_page(spec, 0, rng=np.random.default_rng(14))

    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["quality"]["rejectReason"] is None
    [mark] = page["marks"]
    assert mark["fieldId"] == "f_dev"
    assert mark["state"] == "marked"
    assert mark["cropJpegBase64"] is not None
