"""Catalogo sucio v1 (V2-P2): grillas de digitos, RUT y fotos de camara.

Equivalente v1 del catalogo GradeCam del MVP: cada test declara el
comportamiento correcto ante un defecto real de grilla o de captura con
camara. Principio rector sin excepciones: ante la duda, dudar (ambiguous /
identidad no detectada / rechazo por calidad) — JAMAS un digito incorrecto
confiado. El DV del RUT NO se valida aca: el servicio lee verbatim y el
backend (RutBubbleResolver) decide.
"""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.contracts import validate
from app.main import app
from app.pipeline import process_page
from tests import synthetic as syn
from tests.conftest import DEFAULT_PROFILE

client = TestClient(app)

RUT = "12345678K"
RUT_WRONG_DV = "123456789"
ANSWER_MARKS = {"f_001": "A", "f_002": "C", "f_003": "B", "f_004": "D"}
GRID_MARKS = {0: "4", 1: "0", 2: "7"}
GRID_VALUE = "407"


@pytest.fixture(scope="module")
def dirty_spec() -> dict:
    spec = syn.make_layout_spec(fields_per_page=4)
    spec["fields"].append(
        syn.make_digit_grid_field("f_num", "5", digit_count=3, origin=(0.6, 0.25))
    )
    spec["identity"] = syn.make_rut_identity()
    return spec


def render_dirty(spec: dict, *, seed: int = 21, **render_kwargs) -> np.ndarray:
    render_kwargs.setdefault("marks", {**ANSWER_MARKS, "f_num": dict(GRID_MARKS)})
    render_kwargs.setdefault("identity_marks", syn.rut_marks(RUT))
    return syn.render_page(spec, 0, rng=np.random.default_rng(seed), **render_kwargs)


def read_dirty(spec: dict, profile: dict, *, seed: int = 21, **render_kwargs) -> dict:
    gray = render_dirty(spec, seed=seed, **render_kwargs)
    return process_page(syn.to_bgr(gray), 0, spec, profile)


def grid_mark(page: dict) -> dict:
    return next(mark for mark in page["marks"] if mark["fieldId"] == "f_num")


def answer_values(page: dict) -> dict[str, str]:
    return {
        mark["fieldId"]: mark["value"]
        for mark in page["marks"]
        if mark["state"] == "marked" and mark["fieldId"] in ANSWER_MARKS
    }


def camera_photo(gray: np.ndarray, *, blur_sigma: float = 0.5, seed: int = 5) -> np.ndarray:
    warped = syn.perspective(syn.on_canvas(gray), 0.02, np.random.default_rng(seed))
    return syn.blur(syn.diagonal_shadow(warped, 0.25), blur_sigma)


def assess_body(spec: dict, gray: np.ndarray) -> dict:
    return {
        "layoutSpec": spec,
        "captureProfile": dict(DEFAULT_PROFILE),
        "imageBase64": base64.b64encode(syn.png_bytes(gray)).decode("ascii"),
    }


def decode_crop(mark: dict) -> np.ndarray:
    crop = cv2.imdecode(
        np.frombuffer(base64.b64decode(mark["cropJpegBase64"]), dtype=np.uint8),
        cv2.IMREAD_GRAYSCALE,
    )
    assert crop is not None
    return crop


def test_half_erased_digit_plus_remark_in_same_column_is_ambiguous(
    dirty_spec: dict, profile: dict
) -> None:
    page = read_dirty(
        dirty_spec,
        profile,
        marks={**ANSWER_MARKS, "f_num": {0: "4", 1: ["0", "8"], 2: "7"}},
        coverage={"f_num:1:0": 0.3},
    )
    mark = grid_mark(page)
    assert mark["state"] == "ambiguous"
    assert mark["value"] is None
    assert decode_crop(mark).size > 0


def test_well_erased_digit_plus_remark_reads_the_new_digit(
    dirty_spec: dict, profile: dict
) -> None:
    page = read_dirty(
        dirty_spec,
        profile,
        marks={**ANSWER_MARKS, "f_num": {0: "4", 1: ["0", "8"], 2: "7"}},
        coverage={"f_num:1:0": 0.08},
    )
    mark = grid_mark(page)
    assert mark["state"] == "marked"
    assert mark["value"] == "487"


def test_two_full_marks_in_one_column_make_field_ambiguous_while_identity_reads(
    dirty_spec: dict, profile: dict
) -> None:
    page = read_dirty(
        dirty_spec, profile, marks={**ANSWER_MARKS, "f_num": {0: "4", 1: ["0", "8"], 2: "7"}}
    )
    mark = grid_mark(page)
    assert mark["state"] == "ambiguous"
    assert mark["value"] is None
    assert page["identity"]["raw"] == RUT
    assert answer_values(page) == ANSWER_MARKS


def test_rut_with_inconsistent_dv_is_read_verbatim_with_confidence(
    dirty_spec: dict, profile: dict
) -> None:
    page = read_dirty(dirty_spec, profile, identity_marks=syn.rut_marks(RUT_WRONG_DV))
    assert page["identity"]["mode"] == "rut_bubbles"
    assert page["identity"]["raw"] == RUT_WRONG_DV
    assert 0.0 < page["identity"]["confidence"] <= 1.0


@pytest.mark.parametrize(
    "offset", [(2, 2), (-2, -2), (4, 4), (-4, -4)], ids=["+2px", "-2px", "+4px", "-4px"]
)
def test_globally_offset_marks_read_exactly_or_doubt_never_wrong(
    dirty_spec: dict, profile: dict, offset: tuple[int, int]
) -> None:
    page = read_dirty(
        dirty_spec, profile, mark_offsets={"f_num": offset, "identity": offset}
    )
    mark = grid_mark(page)
    assert mark["state"] in {"marked", "ambiguous"}
    if mark["state"] == "marked":
        assert mark["value"] == GRID_VALUE
    assert page["identity"]["raw"] in (RUT, None)


def test_weak_pencil_grid_marks_read_or_doubt_never_wrong(
    dirty_spec: dict, profile: dict
) -> None:
    page = read_dirty(dirty_spec, profile, pencil_gray=200, coverage={"f_num": 0.75})
    mark = grid_mark(page)
    assert mark["state"] in {"marked", "ambiguous"}
    if mark["state"] == "marked":
        assert mark["value"] == GRID_VALUE
    assert page["identity"]["raw"] in (RUT, None)


def test_blank_rut_grid_with_marked_answers_reads_answers_normally(
    dirty_spec: dict, profile: dict
) -> None:
    page = read_dirty(dirty_spec, profile, identity_marks=None)
    assert page["identity"]["raw"] is None
    assert page["identity"]["confidence"] == 0.0
    assert page["quality"]["ok"] is True
    assert answer_values(page) == ANSWER_MARKS
    mark = grid_mark(page)
    assert mark["state"] == "marked"
    assert mark["value"] == GRID_VALUE


def test_assess_camera_photo_rectifies_and_reads_rut(dirty_spec: dict) -> None:
    photo = camera_photo(render_dirty(dirty_spec))
    response = client.post("/v1/assess", json=assess_body(dirty_spec, photo))
    assert response.status_code == 200
    result = response.json()
    assert validate("assess-result", result) == []
    assert result["quality"]["ok"] is True
    assert result["identity"]["raw"] == RUT
    assert 0.0 < result["identity"]["confidence"] <= 1.0


def test_assess_heavily_blurred_camera_photo_is_rejected_not_misread(
    dirty_spec: dict,
) -> None:
    photo = camera_photo(render_dirty(dirty_spec), blur_sigma=3.0)
    response = client.post("/v1/assess", json=assess_body(dirty_spec, photo))
    assert response.status_code == 200
    result = response.json()
    assert result["quality"]["ok"] is False
    assert result["quality"]["rejectReason"] == "blurry"
    assert result["identity"]["raw"] in (RUT, None)


def test_read_camera_photo_reads_grid_rut_and_answers_exactly(
    dirty_spec: dict, stub_fetch
) -> None:
    photo = camera_photo(render_dirty(dirty_spec))
    stub_fetch({"https://x/foto-0.png": syn.png_bytes(photo)})
    body = {
        "layoutSpec": dirty_spec,
        "captureProfile": dict(DEFAULT_PROFILE),
        "source": {"kind": "images", "pdfUrl": None, "imageUrls": ["https://x/foto-0.png"]},
    }
    response = client.post("/v1/read", json=body)
    assert response.status_code == 200
    [page] = response.json()["pages"]
    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] == RUT
    assert answer_values(page) == ANSWER_MARKS
    mark = grid_mark(page)
    assert mark["state"] == "marked"
    assert mark["value"] == GRID_VALUE


def test_crop_region_on_perspective_photo_returns_the_right_region_content(
    profile: dict,
) -> None:
    spec = syn.make_layout_spec(fields_per_page=4)
    spec["fields"].append(syn.make_crop_region_field("f_dev", "5"))
    gray = syn.render_page(spec, 0, marks=dict(ANSWER_MARKS), rng=np.random.default_rng(23))
    pattern_center = syn.spec_point_px(spec, {"x": 0.3, "y": 0.85})
    cv2.circle(gray, pattern_center, 18, syn.INK_GRAY, thickness=-1)
    photo = camera_photo(gray)

    page = process_page(syn.to_bgr(photo), 0, spec, profile)
    assert page["quality"]["ok"] is True
    mark = next(m for m in page["marks"] if m["fieldId"] == "f_dev")
    crop = decode_crop(mark)

    dark_ys, dark_xs = np.nonzero(crop < 128)
    assert dark_xs.size > 0
    assert float(dark_xs.mean()) / crop.shape[1] == pytest.approx(0.25, abs=0.08)
    assert float(dark_ys.mean()) / crop.shape[0] == pytest.approx(0.5, abs=0.08)
