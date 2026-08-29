"""MarkClassifier (C21): decide si una burbuja esta marcada, y sabe cuando no lo sabe.

fill = fraccion de pixeles oscuros dentro del 78% interior del circulo (el
contorno impreso queda afuera). "Oscuro" es relativo al fondo local: mediana
de un anillo alrededor de la burbuja, para que sombras diagonales y fotocopias
grises no muevan la medida (D8).

threshold = punto medio entre las medias de los dos grupos que separa Otsu
sobre los fills de TODAS las burbujas de la pagina.

Separabilidad: con gap = mean_alto - mean_bajo, la pagina es legible solo si
gap >= MIN_FILL_GAP y gap >= MIN_GAP_SPREAD_RATIO * (std_bajo + std_alto).
Si no, la pagina completa se rechaza `no_separable_marks`: una hoja sin
ninguna marca NO tiene dos grupos y JAMAS debe leerse como todo en blanco
(el error GradeCam ya documentado).

margin = |fill - threshold| / threshold; margin < AMBIGUITY_MARGIN => ambiguous.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .geometry import point_to_px, radius_to_px
from .rectify import RectifiedPage

AMBIGUITY_MARGIN = 0.25
MIN_FILL_GAP = 0.25
MIN_GAP_SPREAD_RATIO = 2.0
INNER_RADIUS_RATIO = 0.78
ANNULUS_INNER_RATIO = 1.7
ANNULUS_OUTER_RATIO = 2.4
DARK_FRACTION_OF_BACKGROUND = 0.72


@dataclass(frozen=True)
class PageThreshold:
    threshold: float
    separable: bool


def bubble_fill(page: RectifiedPage, center: dict[str, float], radius: float) -> float:
    center_px = point_to_px(center, page.size)
    radius_px = radius_to_px(radius, page.size)
    patch, local_center = _patch_around(page.gray, center_px, radius_px)
    background = _local_background(patch, local_center, radius_px)
    inner = _circle_pixels(patch, local_center, max(1, round(radius_px * INNER_RADIUS_RATIO)))
    if inner.size == 0:
        return 0.0
    dark_cutoff = background * DARK_FRACTION_OF_BACKGROUND
    return float(np.count_nonzero(inner < dark_cutoff)) / inner.size


def page_threshold(fills: list[float]) -> PageThreshold:
    values = np.asarray(fills, dtype=np.float64)
    if values.size < 2:
        return PageThreshold(threshold=0.5, separable=False)
    split = _otsu_split(values)
    if split is None:
        return PageThreshold(threshold=0.5, separable=False)
    low, high = split
    gap = float(high.mean() - low.mean())
    spread = float(low.std() + high.std())
    separable = gap >= MIN_FILL_GAP and gap >= MIN_GAP_SPREAD_RATIO * spread
    threshold = float((low.mean() + high.mean()) / 2)
    return PageThreshold(threshold=min(1.0, max(0.0, threshold)), separable=separable)


def margin_of(fill: float, threshold: float) -> float:
    if threshold <= 0:
        return 0.0
    return abs(fill - threshold) / threshold


def _otsu_split(values: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    ordered = np.sort(values)
    best_gain = -1.0
    best_cut = 0
    total_mean = ordered.mean()
    for cut in range(1, ordered.size):
        low, high = ordered[:cut], ordered[cut:]
        weight_low = cut / ordered.size
        weight_high = 1 - weight_low
        gain = weight_low * (low.mean() - total_mean) ** 2
        gain += weight_high * (high.mean() - total_mean) ** 2
        if gain > best_gain:
            best_gain = gain
            best_cut = cut
    if best_cut == 0:
        return None
    return ordered[:best_cut], ordered[best_cut:]


def _patch_around(
    gray: np.ndarray, center_px: tuple[int, int], radius_px: int
) -> tuple[np.ndarray, tuple[int, int]]:
    height, width = gray.shape
    reach = round(radius_px * ANNULUS_OUTER_RATIO) + 2
    x0 = max(0, center_px[0] - reach)
    y0 = max(0, center_px[1] - reach)
    x1 = min(width, center_px[0] + reach + 1)
    y1 = min(height, center_px[1] + reach + 1)
    return gray[y0:y1, x0:x1], (center_px[0] - x0, center_px[1] - y0)


def _local_background(
    patch: np.ndarray, center: tuple[int, int], radius_px: int
) -> float:
    yy, xx = np.ogrid[: patch.shape[0], : patch.shape[1]]
    distance_sq = (xx - center[0]) ** 2 + (yy - center[1]) ** 2
    inner = (radius_px * ANNULUS_INNER_RATIO) ** 2
    outer = (radius_px * ANNULUS_OUTER_RATIO) ** 2
    ring = patch[(distance_sq >= inner) & (distance_sq <= outer)]
    if ring.size == 0:
        return 255.0
    return float(np.median(ring))


def _circle_pixels(patch: np.ndarray, center: tuple[int, int], radius_px: int) -> np.ndarray:
    yy, xx = np.ogrid[: patch.shape[0], : patch.shape[1]]
    distance_sq = (xx - center[0]) ** 2 + (yy - center[1]) ** 2
    return patch[distance_sq <= radius_px**2]


def crop_field_jpeg(
    page: RectifiedPage, bubbles: list[dict], *, width_px: int = 250, jpeg_quality: int = 70
) -> np.ndarray:
    radius_px = max(radius_to_px(bubble["radius"], page.size) for bubble in bubbles)
    centers = [point_to_px(bubble["center"], page.size) for bubble in bubbles]
    pad = round(radius_px * 1.5)
    x0 = max(0, min(c[0] for c in centers) - radius_px - pad)
    y0 = max(0, min(c[1] for c in centers) - radius_px - pad)
    x1 = min(page.size[0], max(c[0] for c in centers) + radius_px + pad)
    y1 = min(page.size[1], max(c[1] for c in centers) + radius_px + pad)
    crop = page.gray[y0:y1, x0:x1]
    scale = width_px / max(1, crop.shape[1])
    resized = cv2.resize(
        crop, (width_px, max(1, round(crop.shape[0] * scale))), interpolation=cv2.INTER_AREA
    )
    ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not ok:
        raise RuntimeError("No se pudo codificar el recorte JPEG")
    return encoded
