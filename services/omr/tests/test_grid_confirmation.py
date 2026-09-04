"""Confirmacion de homografia por firma de la grilla (F1 de identidad robusta).

El QR dejaba tres decisiones colgando de si decodifica: confirmar orientacion,
validar la 4a esquina reconstruida y (indirectamente) sobrevivir a un falso
fiducial. La firma de la grilla las confirma sin QR: en una homografia correcta
TODA posicion de burbuja del spec contiene al menos el anillo impreso; en una
equivocada, la mayoria muestrea papel.

Distribucion medida sobre las 14 capturas reales archivadas (una impresora,
cuatro cadenas de escaneo, tools/measure_grid_signature.py):

    homografia correcta   frac 1.000            (9 capturas legibles, incluidas
                                                 2 con esquina reconstruida)
    rotada 90/180/270     frac 0.000 - 0.168    (39 rectificaciones rotadas)
    falso fiducial (N2)   frac 0.439
    leave-one-out malo    frac 0.158 - 0.579    (reconstrucciones de la esquina
                                                 equivocada de N2)

Cada test de regresion de este archivo se verifico contra el codigo sin el
arreglo: rechazaba la pagina (o la dejaba en fiducials_missing) en vez de
leerla.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.geometry import workspace_size
from app.identity import decode_region_qr
from app.pipeline import (
    _grid_signature_confirmed,
    _homography_confirmed,
    process_page,
)
from app.rectify import RectifiedPage, _find_fiducials_with_clipping
from tests import synthetic as syn

ROTATION_CODES = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


def assert_marks_match(page: dict, marks_abcd: dict) -> None:
    by_number = {mark["printedNumber"]: mark for mark in page["marks"]}
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
    assert by_number["8"]["state"] == "blank"


@pytest.mark.parametrize("degrees", [90, 180, 270])
def test_rotated_sheet_without_qr_is_reoriented_by_grid_signature(
    spec: dict, profile: dict, marks_abcd: dict, degrees: int
) -> None:
    no_qr = syn.render_page(
        spec, 0, marks=marks_abcd, qr_text=None, rng=np.random.default_rng(42)
    )
    rotated = cv2.rotate(no_qr, ROTATION_CODES[degrees])
    page = process_page(syn.to_bgr(rotated), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] is None
    assert_marks_match(page, marks_abcd)


def test_reconstructed_corner_without_qr_is_accepted_when_grid_confirms(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    three_corners = syn.render_page(
        spec,
        0,
        marks=marks_abcd,
        qr_text=None,
        drop_fiducials=(0,),
        rng=np.random.default_rng(42),
    )
    page = process_page(syn.to_bgr(three_corners), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] is None
    assert_marks_match(page, marks_abcd)


def test_false_fiducial_is_arbitrated_by_leave_one_out(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(
        spec,
        0,
        marks=marks_abcd,
        qr_text=None,
        drop_fiducials=(0,),
        rng=np.random.default_rng(42),
    )
    cv2.rectangle(gray, (168, 128), (192, 152), syn.INK_GRAY, thickness=-1)
    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] is None
    assert_marks_match(page, marks_abcd)


def test_perspective_reconstruction_is_refined_before_reading(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    """El paralelogramo asume perspectiva nula; el afinado corrige el corrimiento.

    Con perspectiva 0.03 y una esquina fuera de cuadro, la esquina estimada
    queda corrida: la firma confirma igual (1.0) pero el muestreo descentrado
    lee los campos 4, 6 y 7 —marcas reales— como blank CONFIADO (verificado
    contra el codigo sin refine_reconstruction). El afinado que maximiza la
    brecha de separacion los recupera. Es el caso L0 del banco real: brecha
    0.354 sin afinar, 0.717 afinado, con las 19 marcas de la hoja.
    """
    base = syn.render_page(
        spec,
        0,
        marks=marks_abcd,
        qr_text=None,
        drop_fiducials=(2,),
        rng=np.random.default_rng(42),
    )
    warped = syn.perspective(syn.on_canvas(base), 0.03, np.random.default_rng(5))
    page = process_page(syn.to_bgr(warped), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] is None
    assert_marks_match(page, marks_abcd)
    assert all(mark["state"] != "ambiguous" for mark in page["marks"])


def test_single_page_sheet_without_qr_reads_page_zero_fields(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    no_qr = syn.render_page(
        spec, 0, marks=marks_abcd, qr_text=None, rng=np.random.default_rng(42)
    )
    page = process_page(syn.to_bgr(no_qr), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] is None
    assert_marks_match(page, marks_abcd)


def test_multipage_sheet_without_qr_derives_page_from_file_order(
    profile: dict,
) -> None:
    two_pages = syn.make_layout_spec(fields_per_page=4, page_count=2)
    marks = {"f_005": "A", "f_006": "B", "f_007": "C", "f_008": "D"}
    gray = syn.render_page(
        two_pages, 1, marks=marks, qr_text=None, rng=np.random.default_rng(42)
    )
    page = process_page(syn.to_bgr(gray), 1, two_pages, profile)

    assert page["quality"]["ok"] is True
    read_numbers = {mark["printedNumber"] for mark in page["marks"]}
    assert read_numbers == {"5", "6", "7", "8"}


def _rectified_from_corners(canvas: np.ndarray, corners: np.ndarray, spec: dict) -> RectifiedPage:
    size = workspace_size(spec)
    width, height = size
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    homography = cv2.getPerspectiveTransform(corners.astype(np.float32), dst)
    return RectifiedPage(
        gray=cv2.warpPerspective(canvas, homography, size, flags=cv2.INTER_LINEAR),
        size=size,
        fiducials_found=4,
        touches_border=False,
    )


def test_false_homography_whose_qr_decodes_is_rejected_by_the_gate(
    spec: dict, marks_abcd: dict
) -> None:
    """El QR decodifica sobre una homografia falsa; el gate igual la rechaza.

    Este es el hueco que cerro P1. `_homography_confirmed` aceptaba si el QR
    decodificaba O la firma validaba, y el QR no mira la geometria: se
    construye aca una homografia deliberadamente corrida —la esquina inferior
    izquierda desplazada un 8% de la separacion entre fiduciales, el modo de
    falla del falso fiducial— que deja el QR legible (esta en la esquina
    opuesta) y manda las burbujas fuera de sus anillos.

    Las tres aserciones cuentan la historia completa y ninguna sobra: el QR SI
    decodifica (si no, el caso no probaria nada), la firma NO valida (la
    geometria esta rota de verdad) y el gate rechaza. Contra el codigo de `dev`
    este test falla en la ultima linea: ahi el QR bastaba para aceptar.
    """
    gray = syn.render_page(spec, 0, marks=marks_abcd, qr_text="auto", rng=np.random.default_rng(42))
    canvas = syn.on_canvas(gray)
    detections, _ = _find_fiducials_with_clipping(canvas)
    corners = np.array([d[0] for d in detections], dtype=np.float32)

    honest = _rectified_from_corners(canvas, corners, spec)
    assert _homography_confirmed(honest, spec, 0) is True

    span = corners[1][0] - corners[0][0]
    displaced = corners.copy()
    displaced[3] += np.array([span * 0.08, -span * 0.08], dtype=np.float32)
    false_page = _rectified_from_corners(canvas, displaced, spec)

    assert decode_region_qr(false_page, spec) is not None
    assert _grid_signature_confirmed(false_page, spec, 0) is False
    assert _homography_confirmed(false_page, spec, 0) is False
