"""Tinta de un campo `crop_region` descontando la plantilla impresa (diseno S1).

`inkRatio` = fraccion de pixeles de tinta dentro de la region del campo. Sirve
para detectar "en blanco" sin modelo, asi que una casilla vacia tiene que dar
~0 aunque sus bordes impresos sean oscuros.

Tinta = pixel mas oscuro que su fondo LOCAL por `max(16, 12% del fondo)`, el
mismo corte relativo que usa el clasificador de burbujas (classify.py). El
fondo local es el cierre morfologico del gris (borra trazos mas angostos que
el kernel y conserva sombras mas anchas que el), asi que una sombra dura de
celular no se cuenta como tinta. La imagen NO se binariza para entregarla: la
mascara de tinta solo existe para medir.

Plantilla impresa: las casillas vienen del LayoutSpec (`response.boxes`); sin
cajas, la region entera hace de casilla. Por cada casilla se descuenta:

- una banda fija pegada a su borde (`EDGE_BAND_RATIO` del lado menor, minimo
  `EDGE_BAND_MIN_PX`), que cubre el antialias de una linea bien registrada;
- las lineas rectas largas (>= `LINE_LENGTH_RATIO` del lado) que caen dentro de
  una banda de busqueda mas ancha alrededor del borde: la homografia de 4
  fiduciales deja la plantilla corrida varios px (6-15 medidos en fotos de
  telefono, ver README "Registro local de burbujas"), y la linea corrida tiene
  que salir igual. La busqueda se acota al cuarto del lado de la casilla para
  no comerse un trazo del alumno en casillas chicas.

La tinta que el alumno escribe entre casillas cuenta para `inkRatio` (si la
region la cubre) pero no para ninguna parte de `inkRatioByPart`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from .classify import DARK_CONTRAST_MIN_DELTA, DARK_CONTRAST_RATIO
from .crop import region_box_px
from .rectify import RectifiedPage

BACKGROUND_KERNEL_RATIO = 0.03
BACKGROUND_KERNEL_MIN_PX = 21
EDGE_BAND_RATIO = 0.04
EDGE_BAND_MIN_PX = 2
REGISTRATION_SLACK_RATIO = 0.01
SEARCH_BAND_MAX_SIDE_RATIO = 0.25
LINE_LENGTH_RATIO = 0.6

Box = tuple[int, int, int, int]


@dataclass(frozen=True)
class InkMeasure:
    ratio: float
    by_part: dict[str, float] | None


def measure_ink(
    page: RectifiedPage,
    region: dict[str, dict[str, float]],
    boxes: list[dict[str, Any]] | None = None,
) -> InkMeasure:
    region_box = region_box_px(region, page.size)
    parts = [(box["partId"], region_box_px(box["region"], page.size)) for box in boxes or []]
    template_boxes = [rect for _, rect in parts] or [region_box]

    window = _window(region_box, template_boxes, page.size)
    wx0, wy0, wx1, wy1 = window
    gray = page.gray[wy0 : wy1 + 1, wx0 : wx1 + 1]
    dark = _dark_mask(gray, page.size[0])
    template = _template_mask(dark, [_shift(rect, window) for rect in template_boxes], page.size[0])
    ink = dark & ~template

    ratio = _ratio(ink, template, _shift(region_box, window))
    by_part = (
        {part_id: _ratio(ink, template, _shift(rect, window)) for part_id, rect in parts}
        if parts
        else None
    )
    return InkMeasure(ratio, by_part)


def _window(region_box: Box, template_boxes: list[Box], size: tuple[int, int]) -> Box:
    reach = _background_kernel_px(size[0]) + _registration_slack_px(size[0])
    x0 = min([region_box[0]] + [rect[0] for rect in template_boxes]) - reach
    y0 = min([region_box[1]] + [rect[1] for rect in template_boxes]) - reach
    x1 = max([region_box[2]] + [rect[2] for rect in template_boxes]) + reach
    y1 = max([region_box[3]] + [rect[3] for rect in template_boxes]) + reach
    return max(0, x0), max(0, y0), min(size[0] - 1, x1), min(size[1] - 1, y1)


def _shift(rect: Box, window: Box) -> Box:
    return rect[0] - window[0], rect[1] - window[1], rect[2] - window[0], rect[3] - window[1]


def _background_kernel_px(page_width: int) -> int:
    size = max(BACKGROUND_KERNEL_MIN_PX, round(BACKGROUND_KERNEL_RATIO * page_width))
    return size | 1


def _registration_slack_px(page_width: int) -> int:
    return max(EDGE_BAND_MIN_PX, round(REGISTRATION_SLACK_RATIO * page_width))


def _dark_mask(gray: np.ndarray, page_width: int) -> np.ndarray:
    smoothed = cv2.GaussianBlur(gray, (3, 3), 0)
    kernel_px = _background_kernel_px(page_width)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_px, kernel_px))
    background = cv2.morphologyEx(smoothed, cv2.MORPH_CLOSE, kernel).astype(np.float32)
    delta = np.maximum(DARK_CONTRAST_MIN_DELTA, DARK_CONTRAST_RATIO * background)
    return (background - smoothed.astype(np.float32)) > delta


def _template_mask(dark: np.ndarray, rects: list[Box], page_width: int) -> np.ndarray:
    template = np.zeros_like(dark)
    dark_u8 = dark.astype(np.uint8)
    slack = _registration_slack_px(page_width)
    for rect in rects:
        width = rect[2] - rect[0] + 1
        height = rect[3] - rect[1] + 1
        side = min(width, height)
        edge = max(EDGE_BAND_MIN_PX, round(EDGE_BAND_RATIO * side))
        search = max(edge, min(slack, round(SEARCH_BAND_MAX_SIDE_RATIO * side)))
        template |= _edge_band(dark.shape, rect, edge)
        template |= _long_lines(dark_u8, width, height) & _edge_band(dark.shape, rect, search)
    return template


def _edge_band(shape: tuple[int, ...], rect: Box, band: int) -> np.ndarray:
    mask = np.zeros(shape[:2], dtype=bool)
    height, width = shape[:2]
    x0, y0, x1, y1 = rect
    rows = slice(max(0, y0 - band), min(height, y1 + band + 1))
    cols = slice(max(0, x0 - band), min(width, x1 + band + 1))
    mask[rows, cols] = True
    inner = (x0 + band + 1, y0 + band + 1, x1 - band - 1, y1 - band - 1)
    if inner[0] <= inner[2] and inner[1] <= inner[3]:
        mask[inner[1] : inner[3] + 1, inner[0] : inner[2] + 1] = False
    return mask


def _long_lines(dark_u8: np.ndarray, width: int, height: int) -> np.ndarray:
    length_h = max(3, round(LINE_LENGTH_RATIO * width))
    length_v = max(3, round(LINE_LENGTH_RATIO * height))
    horizontal = cv2.getStructuringElement(cv2.MORPH_RECT, (length_h, 1))
    vertical = cv2.getStructuringElement(cv2.MORPH_RECT, (1, length_v))
    lines = cv2.morphologyEx(dark_u8, cv2.MORPH_OPEN, horizontal) | cv2.morphologyEx(
        dark_u8, cv2.MORPH_OPEN, vertical
    )
    return cv2.dilate(lines, np.ones((3, 3), np.uint8)).astype(bool)


def _ratio(ink: np.ndarray, template: np.ndarray, rect: Box) -> float:
    x0, y0, x1, y1 = rect
    measured = ~template[y0 : y1 + 1, x0 : x1 + 1]
    total = int(measured.sum())
    if total == 0:
        return 0.0
    inked = int((ink[y0 : y1 + 1, x0 : x1 + 1] & measured).sum())
    return min(1.0, inked / total)
