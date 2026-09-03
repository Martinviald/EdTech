"""Elegir los fiduciales por firma de grilla en vez de por cercania a la esquina.

`_best_square` corona el cuadrado mas cercano a la esquina de la IMAGEN, y esa
politica pierde el fiducial verdadero de dos maneras distintas:

    el tope de distancia lo corta       hoja de lado, o que no llena el
                                        encuadre: la esquina sale vacia

    un objeto del fondo se lo gana      una sombra, la junta de la mesa, otra
                                        hoja del monton: el detector reporta
                                        4/4 y la homografia sale corrida

La segunda es la dominante en el corpus real y ningun ajuste del radio la
arregla: en `blanco_1604` el fiducial verdadero estaba a 0.209, DENTRO del tope
de 0.22, y lo desplazo un borron de la mesa. La politica que se prueba aca:
cuando el camino estricto no confirma, se enumeran los candidatos de cada
esquina y se elige la COMBINACION cuya homografia maximiza la firma de la
grilla, que ademas debe llegar al corte de siempre para aceptarse.

El test que manda es `test_cuadrado_falso_lejano_no_se_acepta`: la firma pasa de
vetar a ELEGIR, asi que la red que impide leer mal con confianza importa mas,
no menos.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.pipeline import process_page
from app.rectify import (
    MAX_CORNER_DISTANCE_FRACTION,
    SEARCH_CANDIDATES_PER_CORNER,
    SEARCH_MAX_COMBINATIONS,
    WIDE_CORNER_DISTANCE_FRACTION,
    _find_fiducials_with_clipping,
    _trim_to_combination_budget,
    search_rectification,
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


def always_confirms(_page: object) -> float:
    return 1.0


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


def test_la_busqueda_usa_fiduciales_reales_no_geometria(
    spec: dict, marks_abcd: dict
) -> None:
    """La candidata no completa ninguna esquina cerrando el paralelogramo.

    Es la diferencia con `_complete_parallelogram`, cuya estimacion se corre
    bajo perspectiva fuerte (296 px medidos en la foto de lado real).
    """
    gray = wide_margin_page(spec, marks_abcd)
    found = search_rectification(syn.to_bgr(gray), spec, always_confirms)

    assert found is not None
    candidate, _score, _evaluated = found
    assert candidate.reconstructed is False
    assert candidate.fiducials_found == 4
    assert candidate.searched is True


def test_el_camino_feliz_no_llama_a_la_busqueda(
    spec: dict, profile: dict, clean_gray: np.ndarray, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Costo cero en la pagina sana: ni un warp ni un umbralizado de mas."""

    def boom(*args: object, **kwargs: object) -> None:
        raise AssertionError("la busqueda no debe correr si la estricta ya confirma")

    monkeypatch.setattr("app.pipeline.search_rectification", boom)
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


def test_la_evidencia_de_la_busqueda_queda_registrada(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    from app.pipeline import classify_page_debug

    gray = wide_margin_page(spec, marks_abcd)
    _, debug = classify_page_debug(syn.to_bgr(gray), 0, spec, profile)

    assert debug["fiducialRescue"], "la pagina rescatada debe decir que salio de la busqueda"


def test_la_pagina_sana_no_reporta_rescate(
    spec: dict, profile: dict, clean_gray: np.ndarray
) -> None:
    from app.pipeline import classify_page_debug

    _, debug = classify_page_debug(syn.to_bgr(clean_gray), 0, spec, profile)
    assert debug["fiducialRescue"] is None


def test_el_presupuesto_de_combinaciones_recorta_la_esquina_mas_poblada() -> None:
    """El camino de salida del tope: recortar, nunca abandonar la busqueda.

    Abandonar perderia justo las paginas dificiles, que son las unicas que
    llegan hasta aca. Se recorta la esquina con MAS candidatos —donde la
    cercania discrimina menos— y por el final, asi que los que sobreviven son
    siempre los mas cercanos a la esquina de la imagen.
    """
    corner = [((0.0, 0.0), (float(i), 0.0)) for i in range(SEARCH_CANDIDATES_PER_CORNER)]
    trimmed = _trim_to_combination_budget([list(corner) for _ in range(4)])

    total = 1
    for candidates in trimmed:
        total *= len(candidates)
    assert total <= SEARCH_MAX_COMBINATIONS
    assert all(candidates for candidates in trimmed), "nunca deja una esquina vacia"
    assert trimmed[0][0] == corner[0], "sobrevive el mas cercano a la esquina"


def test_cuadrado_falso_lejano_no_se_acepta(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    """Si la firma de la grilla no confirma, la candidata se descarta.

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
    found = search_rectification(syn.to_bgr(base), spec, always_confirms)
    assert found is not None, "con un puntaje ciego la busqueda si corona la mancha"

    # La candidata existe y es MALA. El pipeline no la debe usar: o lee la
    # pagina por el camino de siempre (paralelogramo confirmado), o la rechaza.
    # Lo que jamas puede pasar es leerla mal con confianza.
    page = process_page(syn.to_bgr(base), 0, spec, profile)
    if page["quality"]["ok"]:
        assert_marks_match(page, marks_abcd)
    else:
        assert page["marks"] == []


def distractor_page(
    spec: dict, marks_abcd: dict, spots: tuple[tuple[int, float], ...]
) -> np.ndarray:
    base = syn.render_page(
        spec, 0, marks=marks_abcd, qr_text=None, rng=np.random.default_rng(42)
    )
    gray = syn.on_canvas(base, 0.07)
    for corner, distance_frac in spots:
        gray = syn.background_square(gray, corner, distance_frac)
    return gray


# Dos esquinas y no una: con un solo distractor la pagina se recupera sola
# (`leave_one_out_rectifications` descarta esa esquina y cierra el paralelogramo
# con las otras tres), asi que una receta de un distractor pasa igual ANTES y
# DESPUES y no prueba nada. Es tambien lo que pasa en las fotos: la otra hoja
# del monton aporta MAS DE UN fiducial propio.
#
# La distancia (0.03 del lado corto, contra ~0.12 del fiducial verdadero) no es
# libre, y conviene saber por que antes de moverla. El distractor CERCA del
# fiducial verdadero corre la homografia solo unos pixeles: la firma de la
# grilla la sigue aceptando, el camino estricto "confirma" y el reintento —donde
# vive esta busqueda— NO LLEGA A CORRER. Medido sobre esta misma hoja, con el
# distractor a 0.035-0.07 la pagina se lee MAL con la firma en verde, igual
# antes y despues de la busqueda. Eso es un hueco del CORTE de la firma
# (`GRID_SIGNATURE_MIN_FRACTION`), no de que fiduciales se eligen, y esta
# busqueda no puede taparlo: cuando la firma aprueba, nadie la llama.
DISTRACTOR_SPOTS = ((0, 0.03), (1, 0.03))


def test_el_distractor_le_roba_la_esquina_al_fiducial_verdadero(
    spec: dict, marks_abcd: dict
) -> None:
    """El mecanismo, antes de probar el arreglo: sin esto lo demas no prueba nada.

    El fiducial verdadero esta en la imagen y el detector lo encuentra — lo que
    falla es la POLITICA de elegir por cercania a la esquina de la imagen.
    """
    clean = syn.on_canvas(
        syn.render_page(
            spec, 0, marks=marks_abcd, qr_text=None, rng=np.random.default_rng(42)
        ),
        0.07,
    )
    dirty = distractor_page(spec, marks_abcd, DISTRACTOR_SPOTS)

    honest, _ = _find_fiducials_with_clipping(clean)
    fooled, _ = _find_fiducials_with_clipping(dirty)

    for corner, _distance in DISTRACTOR_SPOTS:
        assert honest[corner] is not None, "sin distractor la esquina se detecta bien"
        assert fooled[corner] is not None, "el distractor SI se corona como fiducial"
        moved = abs(fooled[corner][0][0] - honest[corner][0][0]) + abs(
            fooled[corner][0][1] - honest[corner][0][1]
        )
        assert moved > 3, f"la esquina {corner} debe quedar en el distractor"


def test_la_hoja_con_distractores_se_lee_igual(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    """El arreglo: la firma de grilla elige la combinacion correcta y la hoja se lee.

    Es la receta que en `dev` produce lecturas INCORRECTAS CON CONFIANZA — el
    unico error que el criterio de aceptacion del MVP declara inadmisible — y
    aca tiene que salir marca por marca igual que la hoja sin distractores.
    """
    gray = distractor_page(spec, marks_abcd, DISTRACTOR_SPOTS)
    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert_marks_match(page, marks_abcd)
