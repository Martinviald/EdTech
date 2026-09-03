"""Reintento con iluminacion aplanada: cuando corre, cuando NO, y que no rompe.

La propiedad que mas importa no es que rescate una hoja: es que una pagina que
hoy se lee bien NO cambie de ruta. Por eso la mitad de los tests son de
no-regresion (el reintento ni siquiera se invoca) y el resto verifica que un
rechazo que el aplanado no arregla siga siendo el rechazo ORIGINAL.

El rescate en si esta medido sobre fotos reales (ver app/illumination.py): la
hoja sintetica de la suite no se puede sombrear hasta romperla sin inventar una
degradacion que no se parece a ninguna captura observada — se probaron rampas
multiplicativas (piso 0.6 a 0.1, en x, y y diagonal) y veladuras que ademas
aplastan el contraste (keep 0.5 a 0.12), y las 36 combinaciones siguen leyendo
las 7 marcas correctas. Asi que la POLITICA del reintento se prueba en su
costura, con `_classify_once` reemplazado por un doble determinista, y el
aplanado se prueba por sus propiedades sobre imagenes reales del generador.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import pytest

from app import pipeline
from app.illumination import flatten_gray, flatten_illumination
from app.pipeline import _should_retry_flattened, classify_page_debug, process_page
from tests import synthetic as syn

SCANNER_PROFILE = {
    "source": "scanner",
    "normalizeIllumination": False,
    "minSharpness": 0.45,
    "maxGlare": 0.35,
    "expectedDpi": 300,
}


def make_page(reject_reason: str | None, *, flattened: bool, sha: str) -> dict[str, Any]:
    return {
        "pageIndex": 0,
        "imageSha256": sha,
        "quality": {
            "ok": reject_reason is None,
            "sharpness": 0.9,
            "glare": 0.0,
            "fiducialsFound": 4,
            "rejectReason": reject_reason,
            "illuminationFlattened": flattened,
        },
        "identity": {"mode": "qr", "raw": "academos:v1:x", "confidence": 1.0},
        "marks": [],
        "pageThumbJpegBase64": None,
    }


class ClassifySpy:
    """Doble de `_classify_once`: devuelve un veredicto por pasada y cuenta llamadas."""

    def __init__(self, *verdicts: str | None) -> None:
        self.verdicts = list(verdicts)
        self.calls: list[bool] = []

    def __call__(
        self,
        bgr: np.ndarray,
        page_index: int,
        spec: dict[str, Any],
        profile: dict[str, Any],
        *,
        flattened: bool,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        self.calls.append(flattened)
        reason = self.verdicts[len(self.calls) - 1]
        sha = "flat" + "0" * 60 if flattened else "orig" + "0" * 60
        page = make_page(reason, flattened=flattened, sha=sha)
        return page, {"pageIndex": page_index, "illuminationFlattened": flattened}


@pytest.fixture
def phone_page(spec: dict, marks_abcd: dict) -> np.ndarray:
    gray = syn.render_page(spec, 0, marks=marks_abcd, rng=np.random.default_rng(42))
    return syn.to_bgr(gray)


# ── Cuando el reintento debe correr, y cuando no ─────────────────────────────


@pytest.mark.parametrize(
    ("reason", "normalize", "expected"),
    [
        ("no_separable_marks", True, True),
        ("no_separable_marks", False, False),
        ("blurry", True, False),
        ("glare", True, False),
        ("fiducials_missing", True, False),
        ("cropped", True, False),
        (None, True, False),
    ],
)
def test_solo_reintenta_marcas_no_separables_con_el_perfil_que_lo_pide(
    reason: str | None, normalize: bool, expected: bool
) -> None:
    page = make_page(reason, flattened=False, sha="x" * 64)
    profile = {"normalizeIllumination": normalize}
    assert _should_retry_flattened(page, profile) is expected


def test_un_perfil_sin_la_bandera_no_reintenta() -> None:
    page = make_page("no_separable_marks", flattened=False, sha="x" * 64)
    assert _should_retry_flattened(page, {}) is False


# ── La politica del reintento, en su costura ─────────────────────────────────


def test_el_reintento_aplanado_rescata_la_pagina(
    monkeypatch: pytest.MonkeyPatch, phone_page: np.ndarray, spec: dict, profile: dict
) -> None:
    spy = ClassifySpy("no_separable_marks", None)
    monkeypatch.setattr(pipeline, "_classify_once", spy)

    page, debug = classify_page_debug(phone_page, 0, spec, profile)

    assert spy.calls == [False, True]
    assert page["quality"]["ok"] is True
    assert page["quality"]["illuminationFlattened"] is True
    assert debug["illuminationFlattened"] is True


def test_el_reintento_conserva_el_sha_de_la_captura_original(
    monkeypatch: pytest.MonkeyPatch, phone_page: np.ndarray, spec: dict, profile: dict
) -> None:
    """La idempotencia D13/CD-3 identifica lo que ENTRO, no lo que se leyo."""
    spy = ClassifySpy("no_separable_marks", None)
    monkeypatch.setattr(pipeline, "_classify_once", spy)

    page, _ = classify_page_debug(phone_page, 0, spec, profile)

    assert page["imageSha256"] == "orig" + "0" * 60


def test_un_rechazo_que_el_aplanado_no_arregla_conserva_el_rechazo_original(
    monkeypatch: pytest.MonkeyPatch, phone_page: np.ndarray, spec: dict, profile: dict
) -> None:
    spy = ClassifySpy("no_separable_marks", "no_separable_marks")
    monkeypatch.setattr(pipeline, "_classify_once", spy)

    page, debug = classify_page_debug(phone_page, 0, spec, profile)

    assert spy.calls == [False, True]
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "no_separable_marks"
    assert page["quality"]["illuminationFlattened"] is False
    assert debug["illuminationFlattened"] is False


def test_el_reintento_nunca_convierte_un_motivo_en_otro(
    monkeypatch: pytest.MonkeyPatch, phone_page: np.ndarray, spec: dict, profile: dict
) -> None:
    """Si el segundo pase falla por otra cosa, gana el diagnostico del primero."""
    spy = ClassifySpy("no_separable_marks", "fiducials_missing")
    monkeypatch.setattr(pipeline, "_classify_once", spy)

    page, _ = classify_page_debug(phone_page, 0, spec, profile)

    assert page["quality"]["rejectReason"] == "no_separable_marks"


def test_una_pagina_legible_no_paga_el_segundo_pase(
    monkeypatch: pytest.MonkeyPatch, phone_page: np.ndarray, spec: dict, profile: dict
) -> None:
    spy = ClassifySpy(None)
    monkeypatch.setattr(pipeline, "_classify_once", spy)

    classify_page_debug(phone_page, 0, spec, profile)

    assert spy.calls == [False]


def test_el_perfil_de_escaner_no_reintenta_nunca(
    monkeypatch: pytest.MonkeyPatch, phone_page: np.ndarray, spec: dict
) -> None:
    spy = ClassifySpy("no_separable_marks", None)
    monkeypatch.setattr(pipeline, "_classify_once", spy)

    page, _ = classify_page_debug(phone_page, 0, spec, dict(SCANNER_PROFILE))

    assert spy.calls == [False]
    assert page["quality"]["rejectReason"] == "no_separable_marks"


# ── No regresion sobre el camino feliz, con el pipeline de verdad ────────────


def test_una_hoja_limpia_se_lee_igual_y_sin_aplanar(
    phone_page: np.ndarray, spec: dict, profile: dict, marks_abcd: dict
) -> None:
    page = process_page(phone_page, 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["quality"]["illuminationFlattened"] is False
    read = {mark["fieldId"]: mark["value"] for mark in page["marks"] if mark["state"] == "marked"}
    assert read == marks_abcd


def test_leer_la_captura_ya_aplanada_da_las_mismas_marcas(
    phone_page: np.ndarray, spec: dict, profile: dict, marks_abcd: dict
) -> None:
    """El aplanado no corrompe una captura sana: es la garantia del reintento."""
    page = process_page(flatten_illumination(phone_page), 0, spec, profile)

    assert page["quality"]["ok"] is True
    read = {mark["fieldId"]: mark["value"] for mark in page["marks"] if mark["state"] == "marked"}
    assert read == marks_abcd


# ── Propiedades del aplanado ─────────────────────────────────────────────────


def test_el_aplanado_quita_el_gradiente_de_fondo() -> None:
    """Se mide el interior: el desenfoque no tiene fondo mas alla del borde.

    En los ~sigma pixeles del margen la estimacion del fondo se apoya en el
    borde replicado y queda sesgada; ahi el aplanado desteñe. No importa: los
    fiduciales viven adentro, no pegados al borde de la captura (una esquina
    cortada ya se rechaza como `cropped`).
    """
    height, width = 400, 300
    yy, xx = np.mgrid[0:height, 0:width]
    gradient = (200 - 150 * (yy / height + xx / width) / 2).astype(np.uint8)

    flat = flatten_gray(gradient)
    interior = flat[60:-60, 60:-60]

    assert float(np.std(gradient)) > 20
    assert float(np.std(interior)) < 2


def test_el_aplanado_conserva_la_tinta_sobre_su_papel() -> None:
    """Una marca en la zona oscura y otra en la clara quedan igual de oscuras."""
    height, width = 400, 300
    yy, _ = np.mgrid[0:height, 0:width]
    gray = (220 - 140 * (yy / height)).astype(np.uint8)
    gray[50:70, 50:70] = (gray[50:70, 50:70] * 0.25).astype(np.uint8)
    gray[330:350, 50:70] = (gray[330:350, 50:70] * 0.25).astype(np.uint8)

    flat = flatten_gray(gray)
    clara = float(np.mean(flat[55:65, 55:65]))
    oscura = float(np.mean(flat[335:345, 55:65]))

    assert abs(clara - oscura) < 12
    assert clara < float(np.mean(flat[200:220, 200:220]))


def test_el_aplanado_devuelve_una_captura_bgr_del_mismo_tamano(
    phone_page: np.ndarray,
) -> None:
    flat = flatten_illumination(phone_page)

    assert flat.shape == phone_page.shape
    assert flat.dtype == np.uint8
    assert np.array_equal(flat[:, :, 0], flat[:, :, 2])


def test_el_aplanado_no_satura_el_papel_a_blanco_puro(phone_page: np.ndarray) -> None:
    """PAPER_LEVEL 200 deja aire para un papel mas claro que el promedio."""
    gray = cv2.cvtColor(phone_page, cv2.COLOR_BGR2GRAY)

    paper = float(np.median(flatten_gray(gray)))

    assert 150 < paper < 255
