"""Convencion del rectangulo fiducial (compartida con el impresor, workstream A1).

Todas las coordenadas del LayoutSpec (centros de burbuja, regiones, QR) son
fracciones 0-1 del RECTANGULO FIDUCIAL, definido asi:

1. El rectangulo fiducial es el rectangulo alineado a la pagina cuyas esquinas
   son los CENTROS de los 4 cuadrados fiduciales (CD-5; identico a
   computeDrawPlan del impresor, apps/api/src/sheet-scanning/sheet-print.helpers.ts).
   (0,0) = centro del cuadrado superior-izquierdo; (1,1) = centro del
   inferior-derecho. `x` es fraccion del ANCHO del rectangulo; `y` de su ALTO.
2. `fiducials.sizeRatio` (lado del cuadrado) y `fiducials.marginRatio`
   (distancia del borde de pagina al BORDE EXTERIOR del cuadrado) son
   fracciones del ANCHO DE PAGINA, iguales en ambos ejes.
3. Todo `radius` de burbuja es fraccion del ANCHO del rectangulo fiducial.
4. El rectificador mapea los CENTROIDES detectados de los cuadrados a las
   esquinas del espacio de trabajo.

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
    inset = fiducial_inset_mm(spec)
    return paper_w - 2 * inset, paper_h - 2 * inset


def fiducial_inset_mm(spec: dict[str, Any]) -> float:
    paper_w, _ = PAPER_SIZES_MM[spec["paper"]]
    margin = spec["fiducials"]["marginRatio"] * paper_w
    side = spec["fiducials"]["sizeRatio"] * paper_w
    return margin + side / 2


def workspace_size(spec: dict[str, Any], width: int = WORK_WIDTH) -> tuple[int, int]:
    rect_w, rect_h = fiducial_rect_mm(spec)
    return width, round(width * rect_h / rect_w)


def point_to_px(point: dict[str, float], size: tuple[int, int]) -> tuple[int, int]:
    width, height = size
    return round(point["x"] * (width - 1)), round(point["y"] * (height - 1))


def radius_to_px(radius: float, size: tuple[int, int]) -> int:
    return max(1, round(radius * size[0]))
