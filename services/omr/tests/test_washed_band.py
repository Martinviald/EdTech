"""Banda lavada: la limitacion conocida que la identidad robusta expone mas.

En la captura real N0 la banda inferior lavada dejo 4 marcas reales (filas
20-23, fills 0.26-0.40) al nivel de los anillos vacios (0.33-0.43) y salieron
como blank CONFIADO (doc 07 §6). Antes el rechazo accidental por identidad las
tapaba; con la identidad robusta la hoja se lee y el error queda expuesto.

Este test codifica el comportamiento DESEADO — una marca lavada jamas sale
blank con confianza; a revision o rechazo de pagina, nunca un blank firme — y
esta xfail hasta que exista una senal que separe anillo de marca lavada (p.
ej. oscuridad del anillo por burbuja) con su propia medicion. Si un dia pasa
(xpass), la limitacion se arreglo: retirar el xfail y promover el test.

Receta calibrada sobre el sintetico: multiplicar la tinta de la banda
y=0.45-0.85 por keep=0.12 hacia el papel deja las filas marcadas 5-7 con fill
0.0 => blank confiado (medido; con keep 0.18 todavia leen marked 1.0 — el
colapso es abrupto porque el umbral interno de bubble_fill es relativo al
papel).
"""

from __future__ import annotations

import numpy as np
import pytest

from app.pipeline import process_page
from tests import synthetic as syn

SCANNER_PROFILE = {
    "source": "scanner",
    "normalizeIllumination": False,
    "minSharpness": 0.45,
    "maxGlare": 0.35,
    "expectedDpi": 300,
}


def wash_band(gray: np.ndarray, y0_frac: float, y1_frac: float, keep: float) -> np.ndarray:
    out = gray.astype(np.float32)
    height = gray.shape[0]
    paper = float(np.median(gray))
    band = out[int(height * y0_frac) : int(height * y1_frac)]
    out[int(height * y0_frac) : int(height * y1_frac)] = paper - (paper - band) * keep
    return np.clip(out, 0, 255).astype(np.uint8)


@pytest.mark.xfail(
    reason="limitacion conocida (doc 07 §6): marcas lavadas al nivel del anillo salen blank confiado",
    strict=False,
)
def test_washed_band_marks_never_read_as_confident_blank(
    spec: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(spec, 0, marks=marks_abcd, rng=np.random.default_rng(42))
    washed = wash_band(gray, 0.45, 0.85, keep=0.12)
    page = process_page(syn.to_bgr(washed), 0, spec, SCANNER_PROFILE)

    if not page["quality"]["ok"]:
        return
    by_number = {mark["printedNumber"]: mark for mark in page["marks"]}
    for number in ("5", "6", "7"):
        assert by_number[number]["state"] != "blank"
