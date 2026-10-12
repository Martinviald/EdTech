"""Forma del cuadrilatero fiducial: lo que puede ser una hoja y lo que no.

`fiducial_quad_consistent` filtra las combinaciones de la busqueda por firma y
acepta (o no) la rectificacion de la hoja encuadrada. Con pocas burbujas la firma
no discrimina: en IMG_2199 (1 pregunta, 4 burbujas, foto nativa 2268x4032) la
busqueda eligio una homografia que mapeaba media hoja al espacio de trabajo y la
B rellena salia `likely_blank`.
"""

from __future__ import annotations

import json

import pytest

from app.geometry import fiducial_rect_mm
from app.pipeline import _rectify_oriented
from app.rectify import RectifiedPage, fiducial_quad_consistent
from tests import synthetic as syn
from tests.test_phone_framing import FIXTURES, load_photo


@pytest.fixture(scope="module")
def photo_spec() -> dict:
    return json.loads((FIXTURES / "layout-spec.json").read_text())


def test_signature_search_never_elects_a_quad_that_cannot_be_the_sheet(photo_spec: dict) -> None:
    """IMG_2199 a resolucion nativa, sin encuadre: la busqueda por firma era el unico rescate.

    Con 4 burbujas la firma no discrimina y la busqueda eligio una homografia que
    mapeaba media hoja al espacio de trabajo (P1 salia `likely_blank`). Sin
    encuadre la pagina puede seguir sin rescatarse, pero nunca con un
    cuadrilatero imposible.
    """
    bgr = load_photo("IMG_2199", native=True)

    _, rectified, _, _ = _rectify_oriented(bgr, photo_spec, 0)

    if isinstance(rectified, RectifiedPage) and rectified.searched:
        assert rectified.corners is not None
        assert fiducial_quad_consistent(rectified.corners, photo_spec)


def letter_quad(spec: dict, *, scale: float = 10.0) -> tuple[tuple[float, float], ...]:
    width, height = (side * scale for side in fiducial_rect_mm(spec))
    return (
        (100.0, 100.0),
        (100.0 + width, 100.0),
        (100.0 + width, 100.0 + height),
        (100.0, 100.0 + height),
    )


def test_quad_of_the_sheet_proportion_is_consistent() -> None:
    spec = syn.make_layout_spec()

    assert fiducial_quad_consistent(letter_quad(spec), spec)


def test_quad_with_moderate_phone_perspective_is_consistent() -> None:
    spec = syn.make_layout_spec()
    tl, tr, br, bl = letter_quad(spec)
    tilted = ((tl[0] + 120, tl[1]), (tr[0] - 120, tr[1]), br, bl)

    assert fiducial_quad_consistent(tilted, spec)


@pytest.mark.parametrize(
    "deform",
    [
        "media-hoja",
        "cruzado",
        "trapecio-extremo",
    ],
)
def test_quad_that_cannot_be_the_sheet_is_rejected(deform: str) -> None:
    spec = syn.make_layout_spec()
    tl, tr, br, bl = letter_quad(spec)
    quads = {
        "media-hoja": (tl, tr, (br[0], (tr[1] + br[1]) / 2), (bl[0], (tl[1] + bl[1]) / 2)),
        "cruzado": (tl, tr, bl, br),
        "trapecio-extremo": ((tl[0] + 600, tl[1]), (tr[0] - 600, tr[1]), br, bl),
    }

    assert not fiducial_quad_consistent(quads[deform], spec)
