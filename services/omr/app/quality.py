"""QualityGate (C20): rechaza una captura ANTES de leerla.

sharpness = min(1, varianza del laplaciano / SHARPNESS_FULL_SCALE), medida
sobre el gris llevado al ancho de trabajo (misma escala siempre). Calibrado
con los fixtures sinteticos: nitida > 0.5, borrosa < 0.2.

glare = fraccion de pixeles saturados (> GLARE_SATURATION_LEVEL) sobre la
pagina; un papel normal fotografiado/escaneado queda por debajo de 250, un
reflejo especular satura el sensor.

Los umbrales minSharpness/maxGlare vienen del CaptureProfile: son datos, no
codigo (D2). `no_separable_marks` lo aporta el clasificador (C21) y se aplica
en el pipeline.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .geometry import WORK_WIDTH
from .rectify import FiducialFailure, RectifiedPage

SHARPNESS_FULL_SCALE = 60.0
GLARE_SATURATION_LEVEL = 250


def sharpness_score(gray: np.ndarray) -> float:
    normalized = _at_work_width(gray)
    variance = float(cv2.Laplacian(normalized, cv2.CV_64F).var())
    return min(1.0, variance / SHARPNESS_FULL_SCALE)


def glare_score(gray: np.ndarray) -> float:
    saturated = int(np.count_nonzero(gray > GLARE_SATURATION_LEVEL))
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
    if rectified.fiducials_found < 4:
        return "fiducials_missing"
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
