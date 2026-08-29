"""Convencion del rectangulo fiducial (compartida con el impresor, workstream A1).

Todas las coordenadas del LayoutSpec (centros de burbuja, regiones, QR) son
fracciones 0-1 del RECTANGULO FIDUCIAL, definido asi:

1. El rectangulo fiducial es el rectangulo alineado a la pagina cuyas esquinas
   son las ESQUINAS EXTERIORES de los 4 cuadrados fiduciales (la esquina de
   cada cuadrado mas cercana a su esquina de pagina). (0,0) = esquina exterior
   del cuadrado superior-izquierdo; (1,1) = esquina exterior del inferior-derecho.
   `x` es fraccion del ANCHO del rectangulo; `y` es fraccion de su ALTO.
2. `fiducials.marginRatio` = distancia de cada borde de pagina al rectangulo
   fiducial, expresada como fraccion del ANCHO DE PAGINA (el mismo margen
   fisico en los 4 lados; los cuadrados se dibujan hacia adentro del rectangulo).
3. `fiducials.sizeRatio` y todo `radius` de burbuja son fracciones del ANCHO
   del rectangulo fiducial.

El espacio de trabajo rectificado tiene WORK_WIDTH px de ancho y una altura
que preserva la proporcion fisica del rectangulo segun `paper`.
"""

from __future__ import annotations

from typing import Any

WORK_WIDTH = 1600

PAPER_SIZES_MM: dict[str, tuple[float, float]] = {
    "letter": (215.9, 279.4),
    "a4": (210.0, 297.0),
    "legal": (215.9, 355.6),
}


def fiducial_rect_mm(spec: dict[str, Any]) -> tuple[float, float]:
    paper_w, paper_h = PAPER_SIZES_MM[spec["paper"]]
    margin = spec["fiducials"]["marginRatio"] * paper_w
    return paper_w - 2 * margin, paper_h - 2 * margin


def workspace_size(spec: dict[str, Any], width: int = WORK_WIDTH) -> tuple[int, int]:
    rect_w, rect_h = fiducial_rect_mm(spec)
    return width, round(width * rect_h / rect_w)


def point_to_px(point: dict[str, float], size: tuple[int, int]) -> tuple[int, int]:
    width, height = size
    return round(point["x"] * (width - 1)), round(point["y"] * (height - 1))


def radius_to_px(radius: float, size: tuple[int, int]) -> int:
    return max(1, round(radius * size[0]))
