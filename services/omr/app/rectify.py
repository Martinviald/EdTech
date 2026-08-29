"""Rectifier (C19): detecta los 4 fiduciales y rectifica por homografia.

Corre SIEMPRE, incluso en un escaneo plano donde la homografia sale
casi-identidad (D2): un solo camino de codigo. Menos de 4 fiduciales =>
`FiducialFailure`, que el QualityGate traduce a `fiducials_missing`.

La busqueda es por cuadrante de esquina: en cada uno se buscan contornos
cuadrados, solidos y sin agujeros (los finder patterns del QR tienen agujero,
esto los descarta) y se elige el candidato cuya esquina exterior queda mas
cerca de la esquina de la imagen.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from .geometry import workspace_size

CORNER_REGION_FRACTION = 0.45
MIN_SQUARE_AREA_PX = 60
MAX_SQUARE_PAGE_FRACTION = 0.01
MIN_SOLIDITY = 0.88
MAX_ASPECT = 1.7
BORDER_TOUCH_PX = 2


@dataclass(frozen=True)
class RectifiedPage:
    gray: np.ndarray
    size: tuple[int, int]
    fiducials_found: int
    touches_border: bool


@dataclass(frozen=True)
class FiducialFailure:
    fiducials_found: int
    touches_border: bool


def rectify(page_bgr: np.ndarray, spec: dict[str, Any]) -> RectifiedPage | FiducialFailure:
    gray = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2GRAY)
    corners = _find_fiducial_outer_corners(gray)
    found = sum(1 for corner in corners if corner is not None)
    touches = _any_touches_border(corners, gray.shape)
    if found < 4:
        return FiducialFailure(fiducials_found=found, touches_border=touches)

    size = workspace_size(spec)
    width, height = size
    src = np.array(corners, dtype=np.float32)
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32
    )
    homography = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(gray, homography, size, flags=cv2.INTER_LINEAR)
    return RectifiedPage(gray=warped, size=size, fiducials_found=4, touches_border=touches)


def _find_fiducial_outer_corners(gray: np.ndarray) -> list[tuple[float, float] | None]:
    height, width = gray.shape
    binary = cv2.adaptiveThreshold(
        cv2.GaussianBlur(gray, (5, 5), 0),
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        51,
        10,
    )
    region_w = round(width * CORNER_REGION_FRACTION)
    region_h = round(height * CORNER_REGION_FRACTION)
    regions = [
        (0, 0),
        (width - region_w, 0),
        (width - region_w, height - region_h),
        (0, height - region_h),
    ]
    image_corners = [(0, 0), (width - 1, 0), (width - 1, height - 1), (0, height - 1)]

    corners: list[tuple[float, float] | None] = []
    for (offset_x, offset_y), image_corner in zip(regions, image_corners, strict=True):
        crop = binary[offset_y : offset_y + region_h, offset_x : offset_x + region_w]
        local_target = (image_corner[0] - offset_x, image_corner[1] - offset_y)
        local = _best_square_outer_corner(crop, local_target, width * height)
        corners.append(None if local is None else (local[0] + offset_x, local[1] + offset_y))
    return corners


def _best_square_outer_corner(
    binary_crop: np.ndarray, target: tuple[int, int], page_area: float
) -> tuple[float, float] | None:
    contours, hierarchy = cv2.findContours(binary_crop, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return None
    best: tuple[float, tuple[float, float]] | None = None
    for contour, node in zip(contours, hierarchy[0], strict=True):
        is_top_level = node[3] == -1
        has_child = node[2] != -1
        if not is_top_level or has_child:
            continue
        candidate = _square_candidate(contour, page_area)
        if candidate is None:
            continue
        outer = min(
            candidate, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2
        )
        distance = (outer[0] - target[0]) ** 2 + (outer[1] - target[1]) ** 2
        if best is None or distance < best[0]:
            best = (distance, outer)
    return None if best is None else best[1]


def _square_candidate(contour: np.ndarray, page_area: float) -> list[tuple[float, float]] | None:
    area = cv2.contourArea(contour)
    if area < MIN_SQUARE_AREA_PX or area > page_area * MAX_SQUARE_PAGE_FRACTION:
        return None
    perimeter = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.05 * perimeter, True)
    if len(approx) != 4 or not cv2.isContourConvex(approx):
        return None
    (_, _), (rect_w, rect_h), _ = cv2.minAreaRect(contour)
    if min(rect_w, rect_h) == 0 or max(rect_w, rect_h) / min(rect_w, rect_h) > MAX_ASPECT:
        return None
    if area / (rect_w * rect_h) < MIN_SOLIDITY:
        return None
    return [(float(point[0][0]), float(point[0][1])) for point in approx]


def _any_touches_border(
    corners: list[tuple[float, float] | None], shape: tuple[int, ...]
) -> bool:
    height, width = shape[:2]
    return any(
        corner is not None
        and (
            corner[0] <= BORDER_TOUCH_PX
            or corner[1] <= BORDER_TOUCH_PX
            or corner[0] >= width - 1 - BORDER_TOUCH_PX
            or corner[1] >= height - 1 - BORDER_TOUCH_PX
        )
        for corner in corners
    )
