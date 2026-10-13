"""Fotos de celular donde la hoja no llena el cuadro (fixtures reales del 2026-10-12).

Las 6 fotos (`tests/fixtures/fotos-celular/`, reducidas a 2200 px de alto, como las
sube la app) son 3 hojas de 2 paginas de la prueba sintetica de respuestas abiertas,
fotografiadas sobre una mesa con ropa a cuadros alrededor. Antes del encuadre de la
hoja (app/framing.py) el resultado dependia de la resolucion: a la de la app 2 de 6
salian `cropped`, a la nativa 4 de 6 se rechazaban (`cropped` o `likely_blank` con
una homografia equivocada que la busqueda por firma eligio con solo 4 burbujas).
La resolucion nativa se reproduce reescalando el fixture a 2268x4032.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.contracts import validate
from app.pipeline import _rectify_oriented, process_page
from app.rectify import RectifiedPage
from app.sources import ImagePageSource
from tests import synthetic as syn

FIXTURES = Path(__file__).parent / "fixtures" / "fotos-celular"
NATIVE_SIZE = (2268, 4032)

PHONE_PROFILE = {
    "source": "phone",
    "normalizeIllumination": True,
    "minSharpness": 0.35,
    "maxGlare": 0.25,
    "expectedDpi": None,
    "ambiguityMargin": None,
}
SCANNER_PROFILE = {
    "source": "scanner",
    "normalizeIllumination": False,
    "minSharpness": 0.45,
    "maxGlare": 0.35,
    "expectedDpi": 300,
    "ambiguityMargin": None,
}

PHOTOS = {
    "IMG_2197": ("AC:B0EDD5C2:0", "D", 8),
    "IMG_2198": ("AC:B0EDD5C2:1", None, 2),
    "IMG_2199": ("AC:9D358A85:0", "B", 8),
    "IMG_2200": ("AC:9D358A85:1", None, 2),
    "IMG_2201": ("AC:FD285330:0", "C", 8),
    "IMG_2202": ("AC:FD285330:1", None, 2),
}


@pytest.fixture(scope="module")
def photo_spec() -> dict:
    return json.loads((FIXTURES / "layout-spec.json").read_text())


def load_photo(name: str, *, native: bool) -> np.ndarray:
    _, bgr = next(iter(ImagePageSource([(FIXTURES / f"{name}.jpg").read_bytes()]).pages()))
    if not native:
        return bgr
    return cv2.resize(bgr, NATIVE_SIZE, interpolation=cv2.INTER_CUBIC)


@pytest.mark.parametrize("native", [False, True], ids=["app-2200", "nativa-4032"])
@pytest.mark.parametrize("name", sorted(PHOTOS))
def test_phone_photo_with_background_is_read(name: str, native: bool, photo_spec: dict) -> None:
    qr, first_bubble, crop_count = PHOTOS[name]
    page = process_page(load_photo(name, native=native), 0, photo_spec, PHONE_PROFILE)

    assert page["quality"]["ok"] is True, page["quality"]
    assert page["quality"]["rejectReason"] is None
    assert page["identity"]["raw"] == qr
    crops = [mark for mark in page["marks"] if mark.get("crop") is not None]
    assert len(crops) == crop_count
    bubble = next((mark for mark in page["marks"] if mark["printedNumber"] == "1"), None)
    if first_bubble is None:
        assert bubble is None
    else:
        assert bubble is not None
        assert (bubble["state"], bubble["value"]) == ("marked", first_bubble)
    assert validate("scan-result", {"pages": [page]}) == []


def crop_only_spec() -> dict:
    spec = syn.make_layout_spec(fields_per_page=1)
    spec["fields"] = [
        syn.make_crop_region_field("f_dev", "1", top_left=(0.1, 0.3), bottom_right=(0.9, 0.5))
    ]
    return spec


SHEET_PAD_FRAC = 0.3


def sheet_on_a_table(spec: dict, *, distractors: bool) -> np.ndarray:
    """Hoja al centro del cuadro sobre un fondo oscuro; opcionalmente con cuadrados del fondo.

    Los fiduciales quedan a ~0.30 del lado menor de la esquina de la imagen, fuera
    del tope estricto (0.22). Los distractores imitan la tela a cuadros de las fotos
    reales: cuadrados oscuros pegados a las esquinas de la IMAGEN, que la pasada
    estricta corona como fiduciales.
    """
    gray = syn.render_page(spec, 0, rng=np.random.default_rng(31))
    canvas = syn.on_canvas(gray, pad_frac=SHEET_PAD_FRAC, background=90)
    if distractors:
        for corner in range(4):
            canvas = syn.background_square(canvas, corner, 0.04, ink=20)
    return canvas


def sheet_bounds(spec: dict) -> tuple[float, float, float, float]:
    gray = syn.render_page(spec, 0, rng=np.random.default_rng(31))
    height, width = gray.shape
    pad = round(width * SHEET_PAD_FRAC)
    return pad, pad, pad + width, pad + height


@pytest.mark.parametrize("distractors", [False, True], ids=["fondo-liso", "fondo-con-cuadrados"])
def test_sheet_that_does_not_fill_the_phone_frame_is_not_cropped(distractors: bool) -> None:
    spec = crop_only_spec()
    bgr = syn.to_bgr(sheet_on_a_table(spec, distractors=distractors))

    page = process_page(bgr, 0, spec, PHONE_PROFILE)

    assert page["quality"]["ok"] is True, page["quality"]
    assert page["quality"]["fiducialsFound"] == 4
    [mark] = page["marks"]
    assert mark["fieldId"] == "f_dev"


def test_framed_rectification_uses_the_fiducials_of_the_sheet_not_the_background() -> None:
    spec = crop_only_spec()
    bgr = syn.to_bgr(sheet_on_a_table(spec, distractors=True))
    oriented, rectified, _, _ = _rectify_oriented(bgr, spec, 0, frame_sheet_first=True)

    assert isinstance(rectified, RectifiedPage)
    assert rectified.corners is not None
    assert oriented.shape[:2] != bgr.shape[:2]
    canvas_corners = _rectify_oriented(bgr, spec, 0)[1]
    assert isinstance(canvas_corners, RectifiedPage)
    assert canvas_corners.corners is not None
    x0, y0, x1, y1 = sheet_bounds(spec)
    assert not all(x0 <= x <= x1 and y0 <= y <= y1 for x, y in canvas_corners.corners)


def test_scanner_profile_keeps_the_strict_corner_search() -> None:
    spec = crop_only_spec()

    page = process_page(
        syn.to_bgr(sheet_on_a_table(spec, distractors=False)), 0, spec, SCANNER_PROFILE
    )

    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] in ("cropped", "fiducials_missing")
