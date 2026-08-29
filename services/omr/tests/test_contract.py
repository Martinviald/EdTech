"""Tests de contrato del esqueleto F0 (siguen verdes sobre el pipeline real).

Verifican que los ejemplos compartidos validan contra los JSON Schema generados
desde Zod, y que el endpoint /v1/read respeta el contrato de entrada/salida.
Los mismos ejemplos se validan con Zod en packages/types
(omr-contract-examples.spec.ts): un origen de verdad, dos validadores.

Las URLs del ejemplo no existen: el descargador se stubbea con paginas
sinteticas renderizadas desde el MISMO layoutSpec del ejemplo (sin red).
"""

import json
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from app.contracts import validate
from app.main import app
from tests import synthetic as syn

EXAMPLES = Path(__file__).resolve().parent.parent / "contracts" / "examples"

client = TestClient(app)


def load_example(name: str) -> dict:
    return json.loads((EXAMPLES / f"{name}.example.json").read_text())


def stub_example_pages(monkeypatch) -> None:
    request = load_example("read-request")
    spec = request["layoutSpec"]
    rendered = {
        url: syn.png_bytes(
            syn.render_page(
                spec,
                page_index,
                marks={"f_001": "C"} if page_index == 0 else {"f_019_1": "V"},
                rng=np.random.default_rng(30 + page_index),
            )
        )
        for page_index, url in enumerate(request["source"]["imageUrls"])
    }
    monkeypatch.setattr("app.pipeline.fetch_url", lambda url: rendered[url])


def test_read_request_example_validates() -> None:
    assert validate("read-request", load_example("read-request")) == []


def test_scan_result_example_validates() -> None:
    assert validate("scan-result", load_example("scan-result")) == []


def test_layout_spec_example_validates() -> None:
    assert validate("layout-spec", load_example("read-request")["layoutSpec"]) == []


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_read_returns_valid_scan_result(monkeypatch) -> None:
    stub_example_pages(monkeypatch)
    response = client.post("/v1/read", json=load_example("read-request"))
    assert response.status_code == 200
    body = response.json()
    assert validate("scan-result", body) == []
    assert len(body["pages"]) == 2


def test_read_rejects_invalid_request_with_422() -> None:
    request = load_example("read-request")
    del request["layoutSpec"]["fields"]
    response = client.post("/v1/read", json=request)
    assert response.status_code == 422
    assert response.json()["errors"]


def test_read_rejects_out_of_range_coordinates() -> None:
    request = load_example("read-request")
    request["layoutSpec"]["fields"][0]["bubbles"][0]["center"]["x"] = 1.5
    response = client.post("/v1/read", json=request)
    assert response.status_code == 422
