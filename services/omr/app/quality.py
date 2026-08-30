"""QualityGate (C20): rechaza una captura ANTES de leerla.

sharpness = min(1, varianza del laplaciano / SHARPNESS_FULL_SCALE), medida
sobre el gris llevado al ancho de trabajo (misma escala siempre). Calibrado
con los fixtures sinteticos: nitida > 0.5, borrosa < 0.2.

glare = fraccion de pixeles saturados RELATIVA AL PAPEL: cuenta pixeles mas
brillantes que mediana + GLARE_DELTA (piso GLARE_SATURATION_LEVEL). Un reflejo
especular satura el sensor muy por encima del blanco del papel; un papel
blanco puro (PDF rasterizado, escaner bien calibrado) NO es glare aunque toda
la pagina supere 250.

Los umbrales minSharpness/maxGlare vienen del CaptureProfile: son datos, no
codigo (D2). `no_separable_marks` lo aporta el clasificador (C21) y se aplica
en el pipeline.

`cropped` vs `fiducials_missing`: los dos significan "no hay 4 esquinas", pero
piden acciones distintas — reescanear sin auto-recorte, o revisar que la hoja
sea de esta tirada. El rectificador distingue el caso mirando si quedo tinta
oscura pegada al borde de la captura donde deberia estar el fiducial
(`clipped_corners`). Antes los dos casos salian como `fiducials_missing` y el
motivo no le decia nada al usuario: `cropped` existia en el enum pero era
INALCANZABLE cuando el recorte era justo lo que rompia la deteccion, porque
`touches_border` solo mira los fiduciales ENCONTRADOS.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .geometry import WORK_WIDTH
from .rectify import FiducialFailure, RectifiedPage

SHARPNESS_FULL_SCALE = 60.0
GLARE_SATURATION_LEVEL = 250
GLARE_DELTA = 15


def sharpness_score(gray: np.ndarray) -> float:
    normalized = _at_work_width(gray)
    variance = float(cv2.Laplacian(normalized, cv2.CV_64F).var())
    return min(1.0, variance / SHARPNESS_FULL_SCALE)


def glare_score(gray: np.ndarray) -> float:
    paper = float(np.median(gray))
    threshold = max(GLARE_SATURATION_LEVEL, paper + GLARE_DELTA)
    if threshold >= 255:
        return 0.0
    saturated = int(np.count_nonzero(gray > threshold))
    return saturated / gray.size


def assess(
    original_gray: np.ndarray,
    rectified: RectifiedPage | FiducialFailure,
    capture_profile: dict[str, Any],
) -> dict[str, Any]:
    measured = rectified.gray if isinstance(rectified, RectifiedPage) else original_gray
    sharpness = sharpness_score(measured)
    glare = glare_score(measured)
    reject_reason = _reject_reason(rectified, sharpness, glare, capture_profile)
    return {
        "ok": reject_reason is None,
        "sharpness": round(sharpness, 4),
        "glare": round(glare, 4),
        "fiducialsFound": rectified.fiducials_found,
        "rejectReason": reject_reason,
    }


def _reject_reason(
    rectified: RectifiedPage | FiducialFailure,
    sharpness: float,
    glare: float,
    capture_profile: dict[str, Any],
) -> str | None:
    if isinstance(rectified, FiducialFailure):
        return "cropped" if rectified.clipped_corners > 0 else "fiducials_missing"
    if rectified.touches_border:
        return "cropped"
    if sharpness < capture_profile["minSharpness"]:
        return "blurry"
    if glare > capture_profile["maxGlare"]:
        return "glare"
    return None


def _at_work_width(gray: np.ndarray) -> np.ndarray:
    height, width = gray.shape
    if width == WORK_WIDTH:
        return gray
    scale = WORK_WIDTH / width
    return cv2.resize(gray, (WORK_WIDTH, round(height * scale)), interpolation=cv2.INTER_AREA)
