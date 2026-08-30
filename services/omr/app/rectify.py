"""Rectifier (C19): detecta los 4 fiduciales y rectifica por homografia.

Corre SIEMPRE, incluso en un escaneo plano donde la homografia sale
casi-identidad (D2): un solo camino de codigo. Menos de 4 fiduciales =>
`FiducialFailure`, que el QualityGate traduce a `fiducials_missing`.

La busqueda es por cuadrante de esquina: en cada uno se buscan contornos
cuadrados y OSCUROS en el gris original. Un finder pattern del QR se descarta
por su estructura anillo-hueco-centro (nieto en la jerarquia RETR_TREE); un
fiducial ahuecado por el threshold adaptativo (cuadrado grande y solido: el
interior queda sobre la media local) solo tiene un hueco vacio, sin nieto, y
se acepta. Se elige el candidato cuya esquina exterior queda mas cerca de la
esquina de la imagen. La homografia mapea los CENTROIDES de los
cuadrados (CD-5: el marco fiducial son los centros); la esquina exterior solo
se usa para elegir candidato y detectar recorte.

El gate de forma se calibro contra hojas sinteticas, donde el cuadrado sale
perfecto, y en papel real rechazaba capturas limpias. Se miden dos cosas:

    solidez     = area / area de su minAreaRect   (1.00 cuadrado, 0.79 circulo)
    compacidad  = perimetro^2 / area              (16.0 cuadrado, 12.6 circulo)

Las dos se degradan, pero en regimenes OPUESTOS. Impreso y escaneado, la tinta
se desborda y el borde queda dentado: la solidez cae a 0.85 mientras la
compacidad sube a 17-18. Reescalado a baja resolucion pasa lo contrario: el
suavizado redondea las esquinas, la compacidad cae a 14.8 y la solidez se
mantiene en 0.98. Medido:

                         solidez        compacidad
    burbuja rellena      0.77 - 0.81    13.7 - 14.4
    fiducial 55% escala  0.98 - 0.99    14.8 - 14.9
    fiducial real        0.85 - 0.92    16.7 - 18.4   (28 esquinas, 2 lotes)

Por eso se acepta el candidato que pasa CUALQUIERA de los dos umbrales, y se
rechaza solo al que falla ambos. La burbuja rellena —el falso positivo que
importa, porque colarla arruina la homografia y produce una lectura mala con
confianza— es la unica forma que queda baja en las dos. Un umbral unico de
solidez no sirve: en 0.88 partia la poblacion real al medio (dos paginas
nitidas fallaron por 0.855 y 0.859) y bajarlo a 0.80 dejaba entrar la burbuja.

Tampoco se aprieta el epsilon de approxPolyDP, que seria lo obvio para separar
circulo de cuadrado: por debajo de 0.05 rechaza el cuadrado pixelado de una
captura de baja resolucion.

Las esquinas cortadas por el borde de la captura siguen rechazadas (0.78 de
solidez con 14.3 de compacidad, medido), que es lo que se quiere: sin las 4
esquinas no hay homografia confiable.
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
MIN_SOLIDITY = 0.83
MIN_COMPACTNESS = 15.0
MAX_ASPECT = 1.7
DARK_FIDUCIAL_MAX_MEAN = 110.0
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
    detections = _find_fiducials(gray)
    found = sum(1 for d in detections if d is not None)
    touches = _any_touches_border([d[1] for d in detections if d is not None], gray.shape)
    if found < 4:
        return FiducialFailure(fiducials_found=found, touches_border=touches)

    size = workspace_size(spec)
    width, height = size
    src = np.array([d[0] for d in detections], dtype=np.float32)
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32
    )
    homography = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(gray, homography, size, flags=cv2.INTER_LINEAR)
    return RectifiedPage(gray=warped, size=size, fiducials_found=4, touches_border=touches)


def _find_fiducials(
    gray: np.ndarray,
) -> list[tuple[tuple[float, float], tuple[float, float]] | None]:
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

    detections: list[tuple[tuple[float, float], tuple[float, float]] | None] = []
    for (offset_x, offset_y), image_corner in zip(regions, image_corners, strict=True):
        crop = binary[offset_y : offset_y + region_h, offset_x : offset_x + region_w]
        gray_crop = gray[offset_y : offset_y + region_h, offset_x : offset_x + region_w]
        local_target = (image_corner[0] - offset_x, image_corner[1] - offset_y)
        local = _best_square(crop, gray_crop, local_target, width * height)
        if local is None:
            detections.append(None)
        else:
            (cx, cy), (ox, oy) = local
            detections.append(((cx + offset_x, cy + offset_y), (ox + offset_x, oy + offset_y)))
    return detections


def _best_square(
    binary_crop: np.ndarray,
    gray_crop: np.ndarray,
    target: tuple[int, int],
    page_area: float,
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    contours, hierarchy = cv2.findContours(binary_crop, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return None
    hier = hierarchy[0]
    best: tuple[float, tuple[tuple[float, float], tuple[float, float]]] | None = None
    for idx, (contour, node) in enumerate(zip(contours, hier, strict=True)):
        if node[3] != -1:
            continue
        if _has_grandchild(hier, idx):
            continue
        candidate = _square_candidate(contour, page_area)
        if candidate is None:
            continue
        if _interior_mean(gray_crop, contour) > DARK_FIDUCIAL_MAX_MEAN:
            continue
        outer = min(
            candidate, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2
        )
        moments = cv2.moments(contour)
        if moments["m00"] == 0:
            continue
        centroid = (moments["m10"] / moments["m00"], moments["m01"] / moments["m00"])
        distance = (outer[0] - target[0]) ** 2 + (outer[1] - target[1]) ** 2
        if best is None or distance < best[0]:
            best = (distance, (centroid, outer))
    return None if best is None else best[1]


def _has_grandchild(hier: np.ndarray, idx: int) -> bool:
    child = hier[idx][2]
    while child != -1:
        if hier[child][2] != -1:
            return True
        child = hier[child][0]
    return False


def _interior_mean(gray_crop: np.ndarray, contour: np.ndarray) -> float:
    mask = np.zeros(gray_crop.shape, dtype=np.uint8)
    cv2.drawContours(mask, [contour], -1, 255, thickness=-1)
    if not mask.any():
        return 255.0
    return float(cv2.mean(gray_crop, mask=mask)[0])


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
    solidity = area / (rect_w * rect_h)
    compactness = perimeter * perimeter / area
    if solidity < MIN_SOLIDITY and compactness < MIN_COMPACTNESS:
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
