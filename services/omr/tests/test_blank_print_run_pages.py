"""Paginas reales en blanco de la tirada sintetica de respuestas abiertas.

`tests/fixtures/tirada-en-blanco/` trae las paginas 1, 3, 5 y 7 de la tirada
`ec5ddecc` (PNG rasterizados del PDF impreso, sin marcar) y su `layout-spec.json`.
Cada una tiene UNA pregunta de alternativas (f_001) y 8 recortes de respuesta
escrita. Son los casos de la auditoria de alternativas (2026-10-14, hallazgo 1):
la base las rechazaba con `no_separable_marks`; desde la lectura por vision se
aceptan para no perder los recortes, y la burbuja sale `ambiguous` sin valor.

Este archivo fija ese contrato con imagenes reales: con recortes, la burbuja
indecidible va a revision (nunca `blank` ni un valor confiado); sin recortes, la
misma imagen se sigue rechazando con `no_separable_marks`. Que una burbuja
`ambiguous` sin revisar no termine en 0 lo protege la API al confirmar el lote.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import numpy as np
import pytest

from app.classify import MARKS_LIKELY_BLANK
from app.contracts import validate
from app.pipeline import process_page
from app.sources import ImagePageSource

FIXTURES = Path(__file__).parent / "fixtures" / "tirada-en-blanco"
PAGES = ["p-1", "p-3", "p-5", "p-7"]
CROPS_PER_PAGE = 8

PROFILES = {
    "phone": {
        "source": "phone",
        "normalizeIllumination": True,
        "minSharpness": 0.35,
        "maxGlare": 0.25,
        "expectedDpi": None,
        "ambiguityMargin": None,
    },
    "scanner": {
        "source": "scanner",
        "normalizeIllumination": False,
        "minSharpness": 0.45,
        "maxGlare": 0.35,
        "expectedDpi": 300,
        "ambiguityMargin": None,
    },
}


@pytest.fixture(scope="module")
def layout_spec() -> dict:
    return json.loads((FIXTURES / "layout-spec.json").read_text())


@pytest.fixture(scope="module")
def bubbles_only_spec(layout_spec: dict) -> dict:
    spec = copy.deepcopy(layout_spec)
    spec["fields"] = [field for field in spec["fields"] if field["kind"] != "crop_region"]
    return spec


def load_page(name: str) -> np.ndarray:
    _, bgr = next(iter(ImagePageSource([(FIXTURES / f"{name}.png").read_bytes()]).pages()))
    return bgr


@pytest.mark.parametrize("profile_name", sorted(PROFILES))
@pytest.mark.parametrize("name", PAGES)
def test_blank_page_with_crops_sends_the_bubble_to_review(
    name: str, profile_name: str, layout_spec: dict
) -> None:
    page = process_page(load_page(name), 0, layout_spec, PROFILES[profile_name])

    assert page["quality"]["ok"] is True, page["quality"]
    assert page["quality"]["marksReadability"] == MARKS_LIKELY_BLANK
    bubbles = [mark for mark in page["marks"] if mark.get("crop") is None]
    crops = [mark for mark in page["marks"] if mark.get("crop") is not None]
    assert [(m["fieldId"], m["state"], m["value"]) for m in bubbles] == [
        ("f_001", "ambiguous", None)
    ]
    assert bubbles[0]["suggestedValue"] is None
    assert len(crops) == CROPS_PER_PAGE
    assert validate("scan-result", {"pages": [page]}) == []


@pytest.mark.parametrize("profile_name", sorted(PROFILES))
@pytest.mark.parametrize("name", PAGES)
def test_same_blank_page_without_crops_is_still_rejected(
    name: str, profile_name: str, bubbles_only_spec: dict
) -> None:
    page = process_page(load_page(name), 0, bubbles_only_spec, PROFILES[profile_name])

    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "no_separable_marks"
    assert page["marks"] == []
