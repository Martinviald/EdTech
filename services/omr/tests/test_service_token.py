"""Auth minima del servicio (V3): X-OMR-Token compartido via OMR_SERVICE_TOKEN.

Solo se exige cuando la env var esta seteada: dev local sin token sigue
funcionando. Un token ausente o incorrecto responde 401 sin tocar el pipeline.
"""

from __future__ import annotations

import base64

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests import synthetic as syn
from tests.conftest import DEFAULT_PROFILE

client = TestClient(app)


def assess_body(spec: dict) -> dict:
    gray = syn.render_page(spec, 0, rng=np.random.default_rng(3))
    return {
        "layoutSpec": spec,
        "captureProfile": dict(DEFAULT_PROFILE),
        "imageBase64": base64.b64encode(syn.png_bytes(gray)).decode("ascii"),
    }


def test_without_env_var_no_token_is_required(
    spec: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OMR_SERVICE_TOKEN", raising=False)
    response = client.post("/v1/assess", json=assess_body(spec))
    assert response.status_code == 200


def test_wrong_token_is_rejected_with_401(spec: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMR_SERVICE_TOKEN", "secreto-compartido")
    response = client.post(
        "/v1/assess", json=assess_body(spec), headers={"X-OMR-Token": "otro"}
    )
    assert response.status_code == 401
    assert "X-OMR-Token" in response.json()["errors"][0]


def test_missing_token_is_rejected_with_401_on_read(
    spec: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OMR_SERVICE_TOKEN", "secreto-compartido")
    body = {
        "layoutSpec": spec,
        "captureProfile": dict(DEFAULT_PROFILE),
        "source": {"kind": "images", "pdfUrl": None, "imageUrls": ["http://x/1.png"]},
    }
    response = client.post("/v1/read", json=body)
    assert response.status_code == 401


def test_correct_token_passes(spec: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMR_SERVICE_TOKEN", "secreto-compartido")
    response = client.post(
        "/v1/assess",
        json=assess_body(spec),
        headers={"X-OMR-Token": "secreto-compartido"},
    )
    assert response.status_code == 200
