"""Mide la firma de la grilla por poblacion sobre un banco de capturas reales.

    python -m tools.measure_grid_signature <dir> --spec spec.json q0 q1 ...
    python -m tools.measure_grid_signature <dir> --spec spec3.json N0 N1 N2 HOJA0 L0 L1

Es el instrumental con que se midieron los umbrales GRID_SIGNATURE_FILL_FLOOR y
GRID_SIGNATURE_MIN_FRACTION de app/pipeline.py (ver su docstring con la
distribucion). Para cada captura reporta la firma de: la primera pasada, las 3
rotaciones (homografia equivocada por construccion) y — si detecta 4 fiduciales —
las 4 reconstrucciones leave-one-out. Correr de nuevo si cambia la cadena de
captura esperada o el generador de hojas: el umbral vale lo que valga esta
medicion.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

OMR_ROOT = Path(__file__).resolve().parents[1]
if str(OMR_ROOT) not in sys.path:
    sys.path.insert(0, str(OMR_ROOT))

from app.pipeline import (  # noqa: E402
    GRID_SIGNATURE_FILL_FLOOR,
    _spec_bubbles,
)
from app.readers import sample_bubble_fills  # noqa: E402
from app.rectify import (  # noqa: E402
    RectifiedPage,
    leave_one_out_rectifications,
    rectify,
)

ROTATIONS = [
    (90, cv2.ROTATE_90_CLOCKWISE),
    (180, cv2.ROTATE_180),
    (270, cv2.ROTATE_90_COUNTERCLOCKWISE),
]


def signature(rectified: RectifiedPage, spec: dict) -> tuple[float, float]:
    fills = np.array(sample_bubble_fills(rectified, _spec_bubbles(spec, 0)))
    return float((fills > GRID_SIGNATURE_FILL_FLOOR).mean()), float(np.median(fills))


def report(label: str, rectified: object, spec: dict) -> None:
    if not isinstance(rectified, RectifiedPage):
        print(f"  {label:<14} no rectifica")
        return
    kind = "RECON" if rectified.reconstructed else "     "
    frac, median = signature(rectified, spec)
    print(f"  {label:<14} {kind} frac={frac:.3f} mediana={median:.3f}")


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m tools.measure_grid_signature")
    parser.add_argument("directory", type=Path)
    parser.add_argument("names", nargs="+")
    parser.add_argument("--spec", required=True, type=Path)
    args = parser.parse_args()

    spec = json.loads((args.directory / args.spec).read_text(encoding="utf-8"))
    for name in args.names:
        path = args.directory / f"{name}.png"
        bgr = cv2.imread(str(path))
        if bgr is None:
            print(f"{name}: no pude leer {path}")
            continue
        print(name)
        report("0deg", rectify(bgr, spec, allow_reconstruction=True), spec)
        for degrees, code in ROTATIONS:
            rotated = cv2.rotate(bgr, code)
            report(f"{degrees}deg", rectify(rotated, spec, allow_reconstruction=True), spec)
        for drop, page in enumerate(leave_one_out_rectifications(bgr, spec)):
            report(f"loo drop={drop}", page, spec)
    return 0


if __name__ == "__main__":
    sys.exit(main())
