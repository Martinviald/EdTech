"""El gate del telefono tambien pregunta si las marcas se van a poder leer.

Hasta E22 `POST /v1/assess` media fiduciales, nitidez, reflejo e identidad, pero
nunca clasificaba: el telefono aceptaba hojas que el PC despues rechazaba por
`no_separable_marks`, con el alumno ya lejos. Lo que se prueba aca es la
propiedad dura de ese arreglo: gate y lote dan el MISMO veredicto sobre la misma
captura, incluido el reintento con la iluminacion aplanada.

Y la segunda mitad: distinguir la hoja en blanco (repetir la foto no sirve) de
la ilegible (repetir si puede servir), con el discriminador de
`readability_verdict` — cuan oscura es la burbuja mas oscura de la pagina.
"""

from __future__ import annotations

import base64
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import pipeline
from app.classify import (
    BLANK_SHEET_MAX_FILL,
    MARKS_LIKELY_BLANK,
    MARKS_READABLE,
    MARKS_UNREADABLE,
    PageThreshold,
    readability_verdict,
)
from app.contracts import validate
from app.main import app
from app.pipeline import assess_page, process_page
from tests import synthetic as syn
from tests.conftest import DEFAULT_PROFILE

client = TestClient(app)

SEPARABLE = PageThreshold(threshold=0.4, separable=True, gap=0.5)
NOT_SEPARABLE = PageThreshold(threshold=0.4, separable=False, gap=0.05)


def assess_body(spec: dict, gray: np.ndarray) -> dict:
    return {
        "layoutSpec": spec,
        "captureProfile": dict(DEFAULT_PROFILE),
        "imageBase64": base64.b64encode(syn.png_bytes(gray)).decode("ascii"),
    }


@pytest.fixture
def blank_gray(spec: dict) -> np.ndarray:
    return syn.render_page(spec, 0, marks={}, rng=np.random.default_rng(7))


# ── El discriminador, aislado ────────────────────────────────────────────────


def test_una_pagina_separable_es_legible_aunque_todo_sea_claro() -> None:
    assert readability_verdict(SEPARABLE, [0.02, 0.05, 0.9]) == MARKS_READABLE


def test_sin_tinta_real_en_ninguna_burbuja_la_hoja_esta_en_blanco() -> None:
    assert readability_verdict(NOT_SEPARABLE, [0.05, 0.12, 0.46]) == MARKS_LIKELY_BLANK


def test_con_tinta_real_desparramada_la_hoja_es_ilegible() -> None:
    assert readability_verdict(NOT_SEPARABLE, [0.10, 0.40, 0.79]) == MARKS_UNREADABLE


def test_el_empate_cae_del_lado_ilegible() -> None:
    """Invitar a repetir una foto cuesta segundos; decir "en blanco" cuesta la nota."""
    assert readability_verdict(NOT_SEPARABLE, [0.1, BLANK_SHEET_MAX_FILL]) == MARKS_UNREADABLE


def test_una_pagina_sin_fills_no_se_declara_en_blanco() -> None:
    assert readability_verdict(NOT_SEPARABLE, []) == MARKS_UNREADABLE


# ── Los casos limite medidos, con los numeros de las capturas reales ─────────

BLANCAS_REALES_MAX_FILL = {
    "blanco_1604": 0.310,
    "blanco_1605": 0.334,
    "blanco_1606": 0.432,
    "blanco_1607": 0.297,
    "blanco_1608": 0.303,
    "blanco_1609": 0.440,
    "blanco_1610": 0.375,
}

CON_TINTA_MAX_FILL = {
    "superseded__Escobar_Leon__8": 0.501,
    "quality_rejected__Escobar_Leon__7": 0.579,
    "RECHAZADA": 0.791,
}


@pytest.mark.parametrize(("foto", "max_fill"), sorted(BLANCAS_REALES_MAX_FILL.items()))
def test_las_siete_hojas_en_blanco_reales_se_declaran_en_blanco(
    foto: str, max_fill: float
) -> None:
    """La misma hoja SIN marcar, 7 capturas con distintos angulos e iluminacion."""
    assert readability_verdict(NOT_SEPARABLE, [0.02, max_fill]) == MARKS_LIKELY_BLANK


@pytest.mark.parametrize(("foto", "max_fill"), sorted(CON_TINTA_MAX_FILL.items()))
def test_las_hojas_con_tinta_medidas_se_declaran_ilegibles(foto: str, max_fill: float) -> None:
    assert readability_verdict(NOT_SEPARABLE, [0.02, max_fill]) == MARKS_UNREADABLE


def test_la_captura_mala_de_la_hoja_en_blanco_cae_del_lado_ilegible() -> None:
    """0.498: por encima de las 7 blancas reales (max 0.440). El bucle converge.

    Repetir la foto es exactamente lo que el veredicto ilegible pide, y la otra
    captura de esa MISMA hoja mide 0.424 — o sea, en blanco con el "subir igual".
    """
    assert readability_verdict(NOT_SEPARABLE, [0.02, 0.498]) == MARKS_UNREADABLE
    assert readability_verdict(NOT_SEPARABLE, [0.02, 0.424]) == MARKS_LIKELY_BLANK


def test_el_corte_deja_margen_a_los_dos_lados_del_hueco_medido() -> None:
    """0.440 (peor blanca) < 0.470 < 0.501 (mejor con tinta)."""
    assert max(BLANCAS_REALES_MAX_FILL.values()) < BLANK_SHEET_MAX_FILL
    assert BLANK_SHEET_MAX_FILL < min(CON_TINTA_MAX_FILL.values())


# ── El gate y el lote comparten criterio ─────────────────────────────────────


def test_el_gate_acepta_la_hoja_que_el_lote_lee(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    gate = assess_page(syn.to_bgr(clean_gray), spec, profile)
    lote = process_page(syn.to_bgr(clean_gray), 0, spec, profile)

    assert gate["quality"]["ok"] is True
    assert gate["quality"]["marksReadability"] == MARKS_READABLE
    assert lote["quality"]["ok"] is True
    assert gate["quality"]["rejectReason"] == lote["quality"]["rejectReason"]


def test_el_gate_rechaza_la_hoja_que_el_lote_rechaza(
    spec: dict, blank_gray: np.ndarray, profile: dict
) -> None:
    gate = assess_page(syn.to_bgr(blank_gray), spec, profile)
    lote = process_page(syn.to_bgr(blank_gray), 0, spec, profile)

    assert gate["quality"]["ok"] is False
    assert gate["quality"]["rejectReason"] == "no_separable_marks"
    assert lote["quality"]["ok"] is False
    assert lote["quality"]["rejectReason"] == "no_separable_marks"
    assert gate["quality"]["marksReadability"] == lote["quality"]["marksReadability"]


def test_la_hoja_sin_marcar_se_declara_en_blanco_y_no_ilegible(
    spec: dict, blank_gray: np.ndarray, profile: dict
) -> None:
    gate = assess_page(syn.to_bgr(blank_gray), spec, profile)

    assert gate["quality"]["marksReadability"] == MARKS_LIKELY_BLANK


def test_el_gate_no_devuelve_marcas(spec: dict, clean_gray: np.ndarray, profile: dict) -> None:
    """Muestrea fills para el veredicto, pero jamas registra respuestas."""
    gate = assess_page(syn.to_bgr(clean_gray), spec, profile)

    assert "marks" not in gate


# ── El reintento aplanado corre ANTES de clasificar en blanco/ilegible ───────


class AssessSpy:
    def __init__(self, *verdicts: str | None) -> None:
        self.verdicts = list(verdicts)
        self.calls: list[bool] = []

    def __call__(
        self,
        bgr: np.ndarray,
        spec: dict[str, Any],
        profile: dict[str, Any],
        *,
        flattened: bool,
    ) -> dict[str, Any]:
        self.calls.append(flattened)
        reason = self.verdicts[len(self.calls) - 1]
        return {
            "imageSha256": ("flat" if flattened else "orig") + "0" * 60,
            "quality": {
                "ok": reason is None,
                "sharpness": 0.9,
                "glare": 0.0,
                "fiducialsFound": 4,
                "rejectReason": reason,
                "illuminationFlattened": flattened,
                "marksReadability": MARKS_READABLE if reason is None else MARKS_UNREADABLE,
            },
            "identity": {"mode": "qr", "raw": "academos:v1:x", "confidence": 1.0},
        }


def test_el_gate_reintenta_aplanado_y_acepta_lo_que_el_aplanado_rescata(
    monkeypatch: pytest.MonkeyPatch, spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    spy = AssessSpy("no_separable_marks", None)
    monkeypatch.setattr(pipeline, "_assess_once", spy)

    result = assess_page(syn.to_bgr(clean_gray), spec, profile)

    assert spy.calls == [False, True]
    assert result["quality"]["ok"] is True
    assert result["quality"]["illuminationFlattened"] is True
    assert result["imageSha256"] == "orig" + "0" * 60


def test_el_gate_conserva_el_rechazo_si_el_aplanado_no_lo_arregla(
    monkeypatch: pytest.MonkeyPatch, spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    spy = AssessSpy("no_separable_marks", "no_separable_marks")
    monkeypatch.setattr(pipeline, "_assess_once", spy)

    result = assess_page(syn.to_bgr(clean_gray), spec, profile)

    assert spy.calls == [False, True]
    assert result["quality"]["rejectReason"] == "no_separable_marks"
    assert result["quality"]["illuminationFlattened"] is False


def test_una_captura_aceptada_no_paga_el_segundo_pase(
    monkeypatch: pytest.MonkeyPatch, spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    spy = AssessSpy(None)
    monkeypatch.setattr(pipeline, "_assess_once", spy)

    assess_page(syn.to_bgr(clean_gray), spec, profile)

    assert spy.calls == [False]


# ── El contrato admite los campos nuevos ─────────────────────────────────────


def test_la_respuesta_del_endpoint_valida_con_los_campos_nuevos(
    spec: dict, blank_gray: np.ndarray
) -> None:
    response = client.post("/v1/assess", json=assess_body(spec, blank_gray))

    assert response.status_code == 200
    result = response.json()
    assert validate("assess-result", result) == []
    assert result["quality"]["marksReadability"] == MARKS_LIKELY_BLANK
