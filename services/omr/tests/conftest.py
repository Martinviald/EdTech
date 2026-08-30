"""Fixtures compartidas: todas las hojas se construyen en el test, sin binarios.

`marks_abcd` deja f_008 sin marcar a proposito: la suite necesita distinguir
`blank` (el alumno no marco ESTE campo) de una pagina rechazada (G3).
"""

from __future__ import annotations

import numpy as np
import pytest

from app.pipeline import process_page
from app.sources import SourceDownloadError
from tests import synthetic as syn

DEFAULT_PROFILE = {
    "source": "phone",
    "normalizeIllumination": True,
    "minSharpness": 0.35,
    "maxGlare": 0.25,
    "expectedDpi": None,
}

MARKS_ABCD = {f"f_{index:03d}": value for index, value in zip(range(1, 8), "ABCDABC", strict=True)}


@pytest.fixture(scope="session")
def profile() -> dict:
    return dict(DEFAULT_PROFILE)


@pytest.fixture(scope="session")
def spec() -> dict:
    return syn.make_layout_spec(fields_per_page=8)


@pytest.fixture(scope="session")
def marks_abcd() -> dict[str, str]:
    return dict(MARKS_ABCD)


@pytest.fixture(scope="session")
def clean_gray(spec: dict, marks_abcd: dict) -> np.ndarray:
    return syn.render_page(spec, 0, marks=marks_abcd, rng=np.random.default_rng(42))


@pytest.fixture(scope="session")
def clean_result(spec: dict, clean_gray: np.ndarray, profile: dict) -> dict:
    return process_page(syn.to_bgr(clean_gray), 0, spec, profile)


@pytest.fixture
def stub_fetch(monkeypatch: pytest.MonkeyPatch):
    def install(pages_by_url: dict[str, bytes]) -> None:
        def fake_fetch(url: str) -> bytes:
            if url not in pages_by_url:
                raise SourceDownloadError(url, "sin stub para esa URL (test sin red)")
            return pages_by_url[url]

        monkeypatch.setattr("app.pipeline.fetch_url", fake_fetch)

    return install
