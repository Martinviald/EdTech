"""CropRegionReader (CD-9): el recorte ES la respuesta — siempre presente."""

from __future__ import annotations

import base64
import hashlib

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


def response_field(field_id: str, profile_id: str) -> dict:
    field = syn.make_crop_region_field(
        field_id, "6", top_left=(0.3, 0.8), bottom_right=(0.62, 0.9)
    )
    boxes = []
    for index, part_id in enumerate(("c1", "c2", "c3")):
        x0 = 0.32 + index * 0.1
        boxes.append(
            {
                "partId": part_id,
                "role": "char",
                "region": {
                    "topLeft": {"x": x0, "y": 0.82},
                    "bottomRight": {"x": x0 + 0.08, "y": 0.88},
                },
            }
        )
    field["response"] = {
        "itemId": "5b1f2a3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
        "format": {"kind": "integer"},
        "boxes": boxes,
        "cropProfileId": profile_id,
    }
    return field


def render_with_boxes(spec: dict, field: dict, *, written: str | None) -> np.ndarray:
    gray = syn.render_page(spec, 0, marks={"f_001": "A"}, rng=np.random.default_rng(21))
    for box in field["response"]["boxes"]:
        x0, y0 = syn.spec_point_px(spec, box["region"]["topLeft"])
        x1, y1 = syn.spec_point_px(spec, box["region"]["bottomRight"])
        cv2.rectangle(gray, (x0, y0), (x1, y1), syn.INK_GRAY, 2)
        if box["partId"] == written:
            cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
            cv2.line(gray, (cx, cy - 18), (cx, cy + 18), syn.PENCIL_GRAY, 4)
    return gray


def crop_spec_with(field: dict) -> dict:
    spec = syn.make_layout_spec(fields_per_page=4)
    spec["fields"].append(field)
    return spec


def test_crop_region_with_profile_reports_crop_evidence(profile: dict) -> None:
    field = response_field("f_num", "short-answer@1")
    spec = crop_spec_with(field)
    gray = render_with_boxes(spec, field, written="c2")

    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    mark = next(m for m in page["marks"] if m["fieldId"] == "f_num")
    crop = mark["crop"]
    jpeg = base64.b64decode(mark["cropJpegBase64"])
    decoded = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    assert crop["cropProfileId"] == "short-answer@1"
    assert (crop["widthPx"], crop["heightPx"]) == (decoded.shape[1], decoded.shape[0])
    assert crop["widthPx"] == 1000
    assert crop["sha256"] == hashlib.sha256(jpeg).hexdigest()
    assert set(crop["inkRatioByPart"]) == {"c1", "c2", "c3"}
    assert crop["inkRatioByPart"]["c2"] > 0.02
    assert crop["inkRatioByPart"]["c1"] < 0.005
    assert crop["inkRatioByPart"]["c3"] < 0.005
    assert validate("scan-result", {"pages": [page]}) == []


def test_empty_boxes_on_a_real_page_read_without_ink(profile: dict) -> None:
    field = response_field("f_num", "short-answer@1")
    spec = crop_spec_with(field)
    gray = render_with_boxes(spec, field, written=None)

    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    crop = next(m for m in page["marks"] if m["fieldId"] == "f_num")["crop"]
    assert crop["inkRatio"] < 0.005
    assert max(crop["inkRatioByPart"].values()) < 0.005


def test_crop_region_without_profile_keeps_the_historic_crop(
    crop_spec: dict, profile: dict
) -> None:
    gray = syn.render_page(crop_spec, 0, marks={"f_001": "A"}, rng=np.random.default_rng(13))

    page = process_page(syn.to_bgr(gray), 0, crop_spec, profile)

    mark = next(m for m in page["marks"] if m["fieldId"] == "f_dev")
    assert mark["crop"]["cropProfileId"] == "crop-region-legacy@1"
    assert mark["crop"]["widthPx"] == 600
    assert "inkRatioByPart" not in mark["crop"]
    assert mark["crop"]["inkRatio"] < 0.005


def test_contract_v1_omits_crop_evidence(monkeypatch, profile: dict) -> None:
    monkeypatch.setenv("OMR_CONTRACT_V2", "0")
    field = response_field("f_num", "free-text@1")
    spec = crop_spec_with(field)
    gray = render_with_boxes(spec, field, written="c1")

    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    mark = next(m for m in page["marks"] if m["fieldId"] == "f_num")
    assert "crop" not in mark
    decoded = cv2.imdecode(
        np.frombuffer(base64.b64decode(mark["cropJpegBase64"]), dtype=np.uint8),
        cv2.IMREAD_GRAYSCALE,
    )
    assert decoded.shape[1] == 1400
