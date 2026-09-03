"""MarkClassifier (C21): decide si una burbuja esta marcada, y sabe cuando no lo sabe.

fill = fraccion de pixeles oscuros dentro del 78% interior del circulo (el
contorno impreso queda afuera). "Oscuro" es relativo al fondo local: mediana
de un anillo alrededor de la burbuja, para que sombras diagonales y fotocopias
grises no muevan la medida (D8). El corte es fondo - max(16, 12% del fondo):
un delta relativo suave que ve lapiz MUY claro (el corte multiplicativo
anterior, 72% del fondo, volvia invisible cualquier trazo mas claro que eso
y rechazaba la hoja entera — catalogo GradeCam, caso lapiz claro).

threshold = punto medio entre las medias de los dos grupos que separa Otsu
sobre los fills de TODAS las burbujas de la pagina.

Separabilidad: con gap = mean_alto - mean_bajo, la pagina es legible solo si
gap >= MIN_FILL_GAP y gap >= MIN_GAP_SPREAD_RATIO * (std_bajo + std_alto).
Si no, la pagina completa se rechaza `no_separable_marks`: una hoja sin
ninguna marca NO tiene dos grupos y JAMAS debe leerse como todo en blanco
(el error GradeCam ya documentado).

Excepcion (T1-j): una hoja con TODAS las burbujas marcadas tampoco tiene dos
grupos, pero es distinguible del caso en blanco porque el fill es relativo al
fondo local: un cluster unico con TODOS los fills >= ALL_MARKED_MIN_FILL es
tinta real, no ruido. Re-escanear no lo arregla (es la hoja, no la captura),
asi que en vez de rechazar la pagina se lee con un umbral bajo el cluster:
cada campo single sale `multiple` (cola de revision con evidencia, C21) y
ningun campo se decide mal con confianza.

Hoja en blanco vs hoja ilegible (E22/gate movil): las dos rinden el mismo
`no_separable_marks` — un solo grupo — pero piden acciones opuestas. Repetir la
foto de una hoja que el alumno dejo sin marcar no sirve; repetir la de una hoja
con tinta desparramada por una sombra si. Se distinguen por el MISMO
razonamiento del caso simetrico de arriba: si NINGUNA burbuja de la pagina
llega a tinta real (max(fill) < BLANK_SHEET_MAX_FILL) no hay nada que rescatar,
la hoja esta en blanco; si alguna si llega, hay tinta que la captura no dejo
leer y la pagina es ilegible. Ver readability_verdict.

margin = |fill - threshold| / threshold (formula congelada en el contrato);
margin < AMBIGUITY_MARGIN => ambiguous. Ademas, un fill en tierra de nadie
— lejos de AMBOS grupos (banda `ambiguity_band`) — tambien es ambiguous
aunque su margin sea alto: un tick al 40% en una hoja de rellenos completos
quedaba como blank CONFIADO, el unico defecto que la cola no compensa.
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
DARK_CONTRAST_MIN_DELTA = 16.0
DARK_CONTRAST_RATIO = 0.12
CLUSTER_BAND_STD_FACTOR = 2.0
CLUSTER_BAND_MIN_WIDTH = 0.12
ALL_MARKED_MIN_FILL = 0.5
BLANK_SHEET_MAX_FILL = 0.5

MARKS_READABLE = "readable"
MARKS_LIKELY_BLANK = "likely_blank"
MARKS_UNREADABLE = "unreadable"


@dataclass(frozen=True)
class PageThreshold:
    threshold: float
    separable: bool
    all_marked: bool = False
    gap: float = 0.0
    low_mean: float = 0.0
    high_mean: float = 1.0
    std_low: float = 0.0
    std_high: float = 0.0

    def is_readable(self) -> bool:
        return self.separable or self.all_marked

    def ambiguity_band(self) -> tuple[float, float]:
        low_edge = self.low_mean + max(
            CLUSTER_BAND_STD_FACTOR * self.std_low, CLUSTER_BAND_MIN_WIDTH
        )
        high_edge = self.high_mean - max(
            CLUSTER_BAND_STD_FACTOR * self.std_high, CLUSTER_BAND_MIN_WIDTH
        )
        return min(low_edge, self.threshold), max(high_edge, self.threshold)

    def is_in_no_mans_land(self, fill: float) -> bool:
        low_edge, high_edge = self.ambiguity_band()
        return low_edge < fill < high_edge


def bubble_fill(page: RectifiedPage, center: dict[str, float], radius: float) -> float:
    center_px = point_to_px(center, page.size)
    radius_px = radius_to_px(radius, page.size)
    patch, local_center = _patch_around(page.gray, center_px, radius_px)
    background = _local_background(patch, local_center, radius_px)
    inner = _circle_pixels(patch, local_center, max(1, round(radius_px * INNER_RADIUS_RATIO)))
    if inner.size == 0:
        return 0.0
    dark_cutoff = background - max(DARK_CONTRAST_MIN_DELTA, DARK_CONTRAST_RATIO * background)
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
    if not separable and float(values.min()) >= ALL_MARKED_MIN_FILL:
        return _all_marked_threshold(values)
    threshold = float((low.mean() + high.mean()) / 2)
    return PageThreshold(
        threshold=min(1.0, max(0.0, threshold)),
        separable=separable,
        gap=gap,
        low_mean=float(low.mean()),
        high_mean=float(high.mean()),
        std_low=float(low.std()),
        std_high=float(high.std()),
    )


def _all_marked_threshold(values: np.ndarray) -> PageThreshold:
    return PageThreshold(
        threshold=float(values.min()) / 2,
        separable=False,
        all_marked=True,
        gap=0.0,
        low_mean=0.0,
        high_mean=float(values.mean()),
        std_low=0.0,
        std_high=float(values.std()),
    )


def readability_verdict(threshold: PageThreshold, fills: list[float]) -> str:
    """Por que la pagina no se puede leer: en blanco o ilegible (y si se puede, legible).

    Es LA politica compartida: el gate del telefono (POST /v1/assess) y el
    procesamiento del lote (POST /v1/read) la llaman sobre los mismos fills de
    la misma pagina rectificada, para que jamas den veredictos distintos sobre
    la misma foto. Corre DESPUES del reintento con la iluminacion aplanada: una
    pagina que el aplanado rescata nunca llega aca a que le pregunten nada.

    El discriminador es cuan oscura es la burbuja MAS oscura de la pagina, el
    mismo razonamiento de ALL_MARKED_MIN_FILL para el caso simetrico (un solo
    grupo, pero de tinta real). Si ni el maximo llega a tinta real, no hay marca
    que rescatar: es la hoja, no la captura, y repetir la foto no sirve.

    OJO: BLANK_SHEET_MAX_FILL NO ESTA CALIBRADO. Medidas disponibles al escribir
    esto (fotos reales de telefono, spec de 57 burbujas):

        hoja en blanco (proxy)      max fill 0.462
        hoja ilegible con tinta     max fill 0.791
        otras paginas rechazadas    max fill 0.132 - 0.579

    El unico punto de "en blanco" es un PROXY (las burbujas vacias de una foto
    buena), no una hoja real sin marcar, y el limite queda apretado. Falta
    calibrarlo con fotos reales de hojas sin responder. Por eso el valor elegido
    es el del precedente (0.5 = tinta real) y el empate cae del lado ILEGIBLE:
    invitar a repetir una foto que no lo necesitaba cuesta 10 segundos, decirle
    "esta en blanco" a una hoja que si tenia respuestas cuesta la nota del
    alumno.
    """
    if threshold.is_readable():
        return MARKS_READABLE
    if fills and max(fills) < BLANK_SHEET_MAX_FILL:
        return MARKS_LIKELY_BLANK
    return MARKS_UNREADABLE


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
    return _encode_crop_jpeg(page.gray[y0:y1, x0:x1], width_px, jpeg_quality)


def crop_region_jpeg(
    page: RectifiedPage,
    region: dict[str, dict[str, float]],
    *,
    width_px: int = 600,
    jpeg_quality: int = 70,
) -> np.ndarray:
    x0, y0 = point_to_px(region["topLeft"], page.size)
    x1, y1 = point_to_px(region["bottomRight"], page.size)
    crop = page.gray[min(y0, y1) : max(y0, y1) + 1, min(x0, x1) : max(x0, x1) + 1]
    return _encode_crop_jpeg(crop, width_px, jpeg_quality)


def _encode_crop_jpeg(crop: np.ndarray, width_px: int, jpeg_quality: int) -> np.ndarray:
    scale = width_px / max(1, crop.shape[1])
    resized = cv2.resize(
        crop, (width_px, max(1, round(crop.shape[0] * scale))), interpolation=cv2.INTER_AREA
    )
    ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not ok:
        raise RuntimeError("No se pudo codificar el recorte JPEG")
    return encoded
