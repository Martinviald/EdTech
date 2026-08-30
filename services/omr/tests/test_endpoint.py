"""POST /v1/read de punta a punta con TestClient, sin red: descargador stubbeado."""

from __future__ import annotations

import time

import numpy as np
from fastapi.testclient import TestClient

from app import pipeline
from app.contracts import validate
from app.main import app
from tests import synthetic as syn
from tests.conftest import DEFAULT_PROFILE, MARKS_ABCD
from tests.test_sources import make_pdf_bytes

client = TestClient(app)


def request_body(spec: dict, source: dict) -> dict:
    return {"layoutSpec": spec, "captureProfile": dict(DEFAULT_PROFILE), "source": source}


def test_read_images_end_to_end(spec: dict, clean_gray: np.ndarray, stub_fetch) -> None:
    stub_fetch({"https://x/pagina-0.png": syn.png_bytes(clean_gray)})
    body = request_body(
        spec, {"kind": "images", "pdfUrl": None, "imageUrls": ["https://x/pagina-0.png"]}
    )

    response = client.post("/v1/read", json=body)

    assert response.status_code == 200
    result = response.json()
    assert validate("scan-result", result) == []
    [page] = result["pages"]
    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] == syn.qr_payload(0, 1)
    read_values = {
        mark["printedNumber"]: mark["value"]
        for mark in page["marks"]
        if mark["state"] == "marked"
    }
    expected = {str(int(k.removeprefix("f_"))): v for k, v in MARKS_ABCD.items()}
    assert read_values == expected


def test_read_multipage_pdf_end_to_end(stub_fetch) -> None:
    spec = syn.make_layout_spec(fields_per_page=4, page_count=2)
    page0 = syn.render_page(
        spec, 0, marks={"f_001": "A", "f_003": "D"}, rng=np.random.default_rng(20)
    )
    page1 = syn.render_page(
        spec, 1, marks={"f_006": "B", "f_008": "C"}, rng=np.random.default_rng(21)
    )
    stub_fetch({"https://x/lote.pdf": make_pdf_bytes([page0, page1])})
    body = request_body(spec, {"kind": "pdf", "pdfUrl": "https://x/lote.pdf", "imageUrls": None})

    response = client.post("/v1/read", json=body)

    assert response.status_code == 200
    result = response.json()
    assert validate("scan-result", result) == []
    assert [page["pageIndex"] for page in result["pages"]] == [0, 1]
    assert all(page["quality"]["ok"] for page in result["pages"])
    assert result["pages"][0]["identity"]["raw"] == syn.qr_payload(0, 2)
    assert result["pages"][1]["identity"]["raw"] == syn.qr_payload(1, 2)


def test_unreachable_source_returns_502(spec: dict, stub_fetch) -> None:
    stub_fetch({})
    body = request_body(
        spec, {"kind": "images", "pdfUrl": None, "imageUrls": ["https://x/inexistente.png"]}
    )

    response = client.post("/v1/read", json=body)

    assert response.status_code == 502
    assert response.json()["errors"]


def test_every_page_over_time_limit_returns_504(
    spec: dict, clean_gray: np.ndarray, stub_fetch, monkeypatch
) -> None:
    monkeypatch.setenv("OMR_PAGE_TIMEOUT_S", "0.05")

    def always_slow(bgr, page_index, page_spec, page_profile):
        time.sleep(1)
        return {}

    monkeypatch.setattr(pipeline, "process_page", always_slow)
    stub_fetch({"https://x/a.png": syn.png_bytes(clean_gray)})
    body = request_body(
        spec, {"kind": "images", "pdfUrl": None, "imageUrls": ["https://x/a.png"]}
    )

    response = client.post("/v1/read", json=body)

    assert response.status_code == 504
    assert response.json()["errors"]
