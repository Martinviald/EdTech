"""POST /v1/assess (CD-11): rectificacion + QualityGate + identidad, sin clasificar.

El veredicto llega ANTES de aceptar la foto (D3): el presupuesto es <1s por
imagen y la respuesta valida contra assess-result.schema.json.
"""

from __future__ import annotations

import base64
import hashlib
import time

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.contracts import validate
from app.main import app
from tests import synthetic as syn
from tests.conftest import DEFAULT_PROFILE, MARKS_ABCD

client = TestClient(app)

ASSESS_BUDGET_S = 1.0


def assess_body(spec: dict, gray: np.ndarray, profile: dict | None = None) -> dict:
    return {
        "layoutSpec": spec,
        "captureProfile": profile or dict(DEFAULT_PROFILE),
        "imageBase64": base64.b64encode(syn.png_bytes(gray)).decode("ascii"),
    }


def canonical_sha256(gray: np.ndarray) -> str:
    ok, encoded = cv2.imencode(".png", syn.to_bgr(gray))
    assert ok
    return hashlib.sha256(encoded.tobytes()).hexdigest()


def test_assess_good_capture_within_budget(spec: dict, clean_gray: np.ndarray) -> None:
    body = assess_body(spec, clean_gray)

    started = time.perf_counter()
    response = client.post("/v1/assess", json=body)
    elapsed = time.perf_counter() - started

    assert response.status_code == 200
    result = response.json()
    assert validate("assess-result", result) == []
    assert result["imageSha256"] == canonical_sha256(clean_gray)
    assert result["quality"]["ok"] is True
    assert result["quality"]["rejectReason"] is None
    assert result["identity"]["raw"] == syn.qr_payload(0, 1)
    assert "marks" not in result
    assert elapsed < ASSESS_BUDGET_S, f"assess tardo {elapsed:.3f}s (presupuesto <1s)"


def test_assess_blurry_capture_reports_reject_reason(
    spec: dict, clean_gray: np.ndarray
) -> None:
    body = assess_body(spec, syn.blur(clean_gray, 2.5))

    response = client.post("/v1/assess", json=body)

    assert response.status_code == 200
    result = response.json()
    assert validate("assess-result", result) == []
    assert result["quality"]["ok"] is False
    assert result["quality"]["rejectReason"] == "blurry"


def test_assess_capture_without_fiducials_reports_reject_reason(spec: dict) -> None:
    featureless = np.full((1600, 1240), 235, dtype=np.uint8)
    body = assess_body(spec, featureless)

    response = client.post("/v1/assess", json=body)

    assert response.status_code == 200
    result = response.json()
    assert result["quality"]["ok"] is False
    assert result["quality"]["rejectReason"] == "fiducials_missing"
    assert result["identity"]["raw"] is None


def test_assess_reads_rut_identity_without_classifying(profile: dict) -> None:
    spec = syn.make_layout_spec(fields_per_page=4)
    spec["identity"] = syn.make_rut_identity()
    gray = syn.render_page(
        spec,
        0,
        marks={"f_001": "A", "f_002": "B"},
        identity_marks=syn.rut_marks("12345678K"),
        rng=np.random.default_rng(16),
    )

    response = client.post("/v1/assess", json=assess_body(spec, gray))

    assert response.status_code == 200
    result = response.json()
    assert validate("assess-result", result) == []
    assert result["identity"]["mode"] == "rut_bubbles"
    assert result["identity"]["raw"] == "12345678K"
    assert 0.0 < result["identity"]["confidence"] <= 1.0


def test_assess_rejects_invalid_request_with_422(spec: dict, clean_gray: np.ndarray) -> None:
    body = assess_body(spec, clean_gray)
    del body["captureProfile"]

    response = client.post("/v1/assess", json=body)

    assert response.status_code == 422
    assert response.json()["errors"]


def test_assess_rejects_undecodable_image_with_422(spec: dict) -> None:
    body = {
        "layoutSpec": spec,
        "captureProfile": dict(DEFAULT_PROFILE),
        "imageBase64": base64.b64encode(b"esto no es una imagen").decode("ascii"),
    }

    response = client.post("/v1/assess", json=body)

    assert response.status_code == 422
    assert response.json()["errors"]


def test_read_still_accepts_ambiguity_margin_in_profile(
    spec: dict, clean_gray: np.ndarray, stub_fetch
) -> None:
    stub_fetch({"https://x/pagina-0.png": syn.png_bytes(clean_gray)})
    profile = {**DEFAULT_PROFILE, "ambiguityMargin": 0.3}
    body = {
        "layoutSpec": spec,
        "captureProfile": profile,
        "source": {"kind": "images", "pdfUrl": None, "imageUrls": ["https://x/pagina-0.png"]},
    }

    response = client.post("/v1/read", json=body)

    assert response.status_code == 200
    [page] = response.json()["pages"]
    read_values = {
        mark["printedNumber"]: mark["value"]
        for mark in page["marks"]
        if mark["state"] == "marked"
    }
    assert read_values == {str(int(k.removeprefix("f_"))): v for k, v in MARKS_ABCD.items()}
