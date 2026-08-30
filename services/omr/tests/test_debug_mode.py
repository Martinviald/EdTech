"""Modo debug (B2/T4, opt-in para el conjunto de oro O4).

`POST /v1/read?debug=1` -> { result: ScanResult, debug: { pages: [...] } }.
Sin `?debug=1` la respuesta sigue siendo el ScanResult puro del contrato.
`classify_page_debug` es importable para el harness de O4 (F4)."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from app.contracts import validate
from app.main import app
from app.pipeline import FILL_HISTOGRAM_BINS, classify_page_debug
from tests import synthetic as syn
from tests.conftest import DEFAULT_PROFILE

client = TestClient(app)


def request_body(spec: dict) -> dict:
    return {
        "layoutSpec": spec,
        "captureProfile": dict(DEFAULT_PROFILE),
        "source": {"kind": "images", "pdfUrl": None, "imageUrls": ["https://x/p.png"]},
    }


def test_read_without_debug_returns_the_pure_scan_result(
    spec: dict, clean_gray: np.ndarray, stub_fetch
) -> None:
    stub_fetch({"https://x/p.png": syn.png_bytes(clean_gray)})

    response = client.post("/v1/read", json=request_body(spec))

    assert response.status_code == 200
    body = response.json()
    assert validate("scan-result", body) == []
    assert set(body.keys()) == {"pages"}


def test_read_with_debug_wraps_result_and_adds_per_page_metrics(
    spec: dict, clean_gray: np.ndarray, stub_fetch
) -> None:
    stub_fetch({"https://x/p.png": syn.png_bytes(clean_gray)})

    response = client.post("/v1/read?debug=1", json=request_body(spec))

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"result", "debug"}
    assert validate("scan-result", body["result"]) == []

    [debug_page] = body["debug"]["pages"]
    assert debug_page["pageIndex"] == 0
    assert len(debug_page["fillHistogram"]) == FILL_HISTOGRAM_BINS
    assert sum(debug_page["fillHistogram"]) == debug_page["fillCount"] == 32
    assert 0.0 < debug_page["threshold"] < 1.0
    assert debug_page["separable"] is True
    assert debug_page["allMarked"] is False
    assert debug_page["gap"] > 0.25
    assert debug_page["stdLow"] >= 0.0
    assert debug_page["stdHigh"] >= 0.0
    assert debug_page["stateCounts"] == {
        "marked": 7,
        "blank": 1,
        "multiple": 0,
        "ambiguous": 0,
    }
    assert debug_page["sharpness"] > 0.5
    assert debug_page["glare"] < 0.25
    assert debug_page["orientationDegrees"] == 0
    for stage in ("rectify", "quality", "identity", "classify", "total"):
        assert debug_page["timingsMs"][stage] >= 0.0


def test_classify_page_debug_is_importable_for_the_golden_set_harness(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    page, debug = classify_page_debug(syn.to_bgr(clean_gray), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert debug["fillCount"] == 32
    assert debug["rejectReason"] is None


def test_debug_on_rejected_page_still_reports_the_fill_distribution(
    spec: dict, profile: dict
) -> None:
    blank = syn.render_page(spec, 0, marks={}, rng=np.random.default_rng(1))
    _, debug = classify_page_debug(syn.to_bgr(blank), 0, spec, profile)

    assert debug["rejectReason"] == "no_separable_marks"
    assert debug["separable"] is False
    assert debug["allMarked"] is False
    assert sum(debug["fillHistogram"]) == debug["fillCount"] == 32
    assert debug["stateCounts"] == {"marked": 0, "blank": 0, "multiple": 0, "ambiguous": 0}
