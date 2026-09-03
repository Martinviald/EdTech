"""Rescate por radio ampliado cuando el tope de distancia corta fiduciales VERDADEROS.

`MAX_CORNER_DISTANCE_FRACTION` existe para que `_best_square` no corone un
borron lejano, y sigue siendo el tope de la busqueda normal. Pero una hoja
fotografiada de lado, o que no llena el encuadre, aleja sus esquinas de las de
la imagen y el mismo tope empieza a descartar cuadrados legitimos. Medido sobre
19 fotos reales a 1650x2200: el peor fiducial VERDADERO estaba a 0.316 del lado
corto, y 5 de 7 fotos de una hoja en blanco encontraban solo 2 de 4.

La politica que se prueba aca: si la busqueda estricta encuentra MENOS de 4, se
re-buscan las esquinas faltantes con `WIDE_CORNER_DISTANCE_FRACTION`, y la
rectificacion resultante se acepta SOLO si la firma de la grilla la confirma.
Si no confirma, la pagina sigue el camino de antes.

El test que manda es `test_cuadrado_falso_lejano_no_se_acepta`: es el agujero
que el tope tapaba, y aca queda tapado por un validador independiente en vez de
por la distancia.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.pipeline import process_page
from app.rectify import (
    MAX_CORNER_DISTANCE_FRACTION,
    WIDE_CORNER_DISTANCE_FRACTION,
    _find_fiducials_with_clipping,
    widened_rectification,
)
from tests import synthetic as syn

# Margen de fondo que aleja los fiduciales del borde: con 0.22 la busqueda
# estricta pierde esquinas, con 0.35 las encuentra todas. Es el equivalente
# sintetico de la hoja que no llena el encuadre.
WIDE_MARGIN = 0.22


def strict_found(gray: np.ndarray) -> int:
    detections, _ = _find_fiducials_with_clipping(gray)
    return sum(1 for d in detections if d is not None)


def assert_marks_match(page: dict, marks_abcd: dict) -> None:
    by_number = {mark["printedNumber"]: mark for mark in page["marks"]}
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
    assert by_number["8"]["state"] == "blank"


def wide_margin_page(spec: dict, marks_abcd: dict) -> np.ndarray:
    base = syn.render_page(
        spec, 0, marks=marks_abcd, qr_text=None, rng=np.random.default_rng(42)
    )
    return syn.on_canvas(base, pad_frac=WIDE_MARGIN)


def test_el_tope_ampliado_es_mayor_que_el_estricto() -> None:
    assert WIDE_CORNER_DISTANCE_FRACTION > MAX_CORNER_DISTANCE_FRACTION


def test_hoja_con_mucho_fondo_pierde_esquinas_con_el_tope_estricto(
    spec: dict, marks_abcd: dict
) -> None:
    """Sin esto los demas tests podrian estar pasando por el camino normal."""
    assert strict_found(wide_margin_page(spec, marks_abcd)) < 4


def test_hoja_con_mucho_fondo_se_rescata_y_se_lee(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = wide_margin_page(spec, marks_abcd)
    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["quality"]["fiducialsFound"] == 4
    assert_marks_match(page, marks_abcd)


def test_el_rescate_usa_fiduciales_reales_no_geometria(
    spec: dict, marks_abcd: dict
) -> None:
    """La candidata ampliada no completa ninguna esquina cerrando el paralelogramo.

    Es la diferencia con `_complete_parallelogram`, cuya estimacion se corre
    bajo perspectiva fuerte (296 px medidos en la foto de lado real).
    """
    gray = wide_margin_page(spec, marks_abcd)
    candidate = widened_rectification(syn.to_bgr(gray), spec)

    assert candidate is not None
    assert candidate.reconstructed is False
    assert candidate.fiducials_found == 4
    assert candidate.widened_corners


def test_sin_esquinas_faltantes_no_hay_candidata(
    spec: dict, clean_gray: np.ndarray
) -> None:
    """El camino feliz no paga nada: `widened_rectification` corta de inmediato."""
    assert strict_found(clean_gray) == 4
    assert widened_rectification(syn.to_bgr(clean_gray), spec) is None


def test_el_camino_feliz_no_llama_a_la_busqueda_ampliada(
    spec: dict, profile: dict, clean_gray: np.ndarray, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Costo cero en la pagina sana: ni un warp ni un umbralizado de mas."""

    def boom(*args: object, **kwargs: object) -> None:
        raise AssertionError("la busqueda ampliada no debe correr con 4 fiduciales")

    monkeypatch.setattr("app.pipeline.widened_rectification", boom)
    page = process_page(syn.to_bgr(clean_gray), 0, spec, profile)

    assert page["quality"]["ok"] is True


def test_dos_esquinas_faltantes_tambien_se_rescatan(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    """Con 2 fiduciales no hay paralelogramo que cerrar: el reintento es la unica via.

    Es el modo de falla DOMINANTE en las fotos de celular medidas (5 de 7 fotos
    de una hoja en blanco encontraban solo 2 de 4), y la razon por la que la
    politica dispara con "menos de 4" y no con "exactamente 3".
    """
    gray = wide_margin_page(spec, marks_abcd)
    detections, _ = _find_fiducials_with_clipping(gray)
    missing = [i for i, d in enumerate(detections) if d is None]
    assert len(missing) >= 2, f"el fixture debe perder 2+ esquinas, perdio {missing}"

    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    assert page["quality"]["ok"] is True
    assert_marks_match(page, marks_abcd)


def test_la_evidencia_del_rescate_queda_registrada(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    from app.pipeline import classify_page_debug

    gray = wide_margin_page(spec, marks_abcd)
    _, debug = classify_page_debug(syn.to_bgr(gray), 0, spec, profile)

    assert debug["fiducialRescue"], "la pagina rescatada debe decir que esquinas amplio"


def test_la_pagina_sana_no_reporta_rescate(
    spec: dict, profile: dict, clean_gray: np.ndarray
) -> None:
    from app.pipeline import classify_page_debug

    _, debug = classify_page_debug(syn.to_bgr(clean_gray), 0, spec, profile)
    assert debug["fiducialRescue"] is None


def test_cuadrado_falso_lejano_no_se_acepta(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    """Si la firma de la grilla no confirma, la candidata ampliada se descarta.

    Es el riesgo por el que existe el tope de distancia: una mancha con forma de
    cuadrado, mas alla de 0.22 pero dentro de 0.35, gana la esquina y la
    homografia sale deformada. Aca se pinta esa mancha a proposito y se exige
    que la pagina NO se lea con esa homografia — el tope ya no la contiene, la
    contiene la firma.
    """
    base = syn.render_page(
        spec,
        0,
        marks=marks_abcd,
        qr_text=None,
        drop_fiducials=(0,),
        rng=np.random.default_rng(42),
    )
    height, width = base.shape
    short = min(width, height)
    # Un cuadrado oscuro sobre la diagonal de la esquina TL, entre los dos topes.
    offset = round(0.28 * short / (2**0.5))
    side = 12
    cv2.rectangle(
        base,
        (offset - side, offset - side),
        (offset + side, offset + side),
        syn.INK_GRAY,
        thickness=-1,
    )

    detections, _ = _find_fiducials_with_clipping(base)
    assert detections[0] is None, "el tope estricto debe seguir ignorando la mancha"
    candidate = widened_rectification(syn.to_bgr(base), spec)
    assert candidate is not None, "el radio ampliado si debe coronar la mancha"

    # La candidata existe y es MALA. El pipeline no la debe usar: o lee la
    # pagina por el camino de siempre (paralelogramo confirmado), o la rechaza.
    # Lo que jamas puede pasar es leerla mal con confianza.
    page = process_page(syn.to_bgr(base), 0, spec, profile)
    if page["quality"]["ok"]:
        assert_marks_match(page, marks_abcd)
    else:
        assert page["marks"] == []
