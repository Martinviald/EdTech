"""Metricas de fiducial medidas sobre una captura, para calibrar el barrido.

Existe por una razon concreta: el umbral de solidez del rectificador estuvo en
0.88 porque en sintetico los cuadrados salian perfectos (1.00), mientras la
poblacion real vive entre 0.85 y 0.92 — y rechazaba capturas limpias. Un
generador sintetico solo sirve para calibrar si sus distribuciones SE SOLAPAN
con las del papel. Este modulo mide las mismas cuatro cifras que decide
`app/rectify.py` sobre cualquier imagen (sintetica o real) para poder
compararlas lado a lado:

    solidez      = area / area de su minAreaRect
    compacidad   = perimetro^2 / area
    oscuridad    = interior del cuadrado / mediana del papel local
    distancia    = de la esquina exterior a la esquina de la imagen,
                   en fracciones del lado menor

Uso:

    python -m goldset.fiducial_metrics /tmp/q0.png /tmp/L0.png       # medir
    python -m goldset.fiducial_metrics goldset/data --compare /tmp/q0.png

No es un test: es un instrumento. Los rangos reales medidos sobre 10 capturas
de dos escaneres y una camara estan en el README del barrido.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np

from app.rectify import CORNER_REGION_FRACTION, _interior_mean, _square_candidate

METRIC_NAMES = ("solidity", "compactness", "darkness", "cornerDistance")


@dataclass(frozen=True)
class FiducialMetrics:
    image: str
    corner: int
    solidity: float
    compactness: float
    darkness: float
    corner_distance: float
    width: int
    height: int


def measure_image(gray: np.ndarray, label: str) -> list[FiducialMetrics]:
    """Mide el mejor candidato a fiducial de cada una de las 4 esquinas.

    Replica la busqueda por cuadrante de `app.rectify` (mismo threshold, mismas
    regiones, mismo gate de forma) pero en vez de quedarse con el centroide
    devuelve las metricas. No aplica los umbrales de aceptacion: el punto es ver
    la distribucion completa, incluido lo que el rectificador rechazaria.
    """
    height, width = gray.shape[:2]
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
    minor_side = min(width, height)

    measured: list[FiducialMetrics] = []
    for corner, ((offset_x, offset_y), image_corner) in enumerate(
        zip(regions, image_corners, strict=True)
    ):
        crop = binary[offset_y : offset_y + region_h, offset_x : offset_x + region_w]
        gray_crop = gray[offset_y : offset_y + region_h, offset_x : offset_x + region_w]
        target = (image_corner[0] - offset_x, image_corner[1] - offset_y)
        best = _closest_square(crop, gray_crop, target, width * height)
        if best is None:
            continue
        contour, outer = best
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        (_, _), (rect_w, rect_h), _ = cv2.minAreaRect(contour)
        paper = float(np.median(gray_crop)) or 1.0
        distance = float(np.hypot(outer[0] - target[0], outer[1] - target[1]))
        measured.append(
            FiducialMetrics(
                image=label,
                corner=corner,
                solidity=area / (rect_w * rect_h),
                compactness=perimeter * perimeter / area,
                darkness=_interior_mean(gray_crop, contour) / paper,
                corner_distance=distance / minor_side,
                width=width,
                height=height,
            )
        )
    return measured


def _closest_square(
    binary_crop: np.ndarray,
    gray_crop: np.ndarray,
    target: tuple[int, int],
    page_area: float,
) -> tuple[np.ndarray, tuple[float, float]] | None:
    contours, hierarchy = cv2.findContours(
        binary_crop, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE
    )
    if hierarchy is None:
        return None
    best: tuple[float, np.ndarray, tuple[float, float]] | None = None
    for contour, node in zip(contours, hierarchy[0], strict=True):
        if node[3] != -1:
            continue
        candidate = _square_candidate(contour, page_area)
        if candidate is None:
            continue
        outer = min(
            candidate, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2
        )
        distance = (outer[0] - target[0]) ** 2 + (outer[1] - target[1]) ** 2
        if best is None or distance < best[0]:
            best = (distance, contour, outer)
    return None if best is None else (best[1], best[2])


def measure_paths(paths: list[Path]) -> list[FiducialMetrics]:
    measured: list[FiducialMetrics] = []
    for path in paths:
        gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise SystemExit(f"No se pudo leer la imagen {path}")
        measured.extend(measure_image(gray, path.name))
    return measured


def collect_images(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return sorted(
        path
        for path in target.rglob("*")
        if path.suffix.lower() in (".png", ".jpg", ".jpeg")
    )


def measure_targets(targets: list[str]) -> list[FiducialMetrics]:
    return measure_paths([p for t in targets for p in collect_images(Path(t))])


def summarize(measured: list[FiducialMetrics]) -> dict[str, dict[str, float]]:
    summary: dict[str, dict[str, float]] = {}
    for name in METRIC_NAMES:
        key = "corner_distance" if name == "cornerDistance" else name
        summary[name] = _range([getattr(m, key) for m in measured])
    summary["widthPx"] = _range([float(m.width) for m in measured])
    summary["n"] = {"count": float(len(measured))}
    return summary


def _range(values: list[float]) -> dict[str, float]:
    if not values:
        return {"min": float("nan"), "p50": float("nan"), "max": float("nan")}
    array = np.array(values, dtype=float)
    return {
        "min": round(float(array.min()), 4),
        "p50": round(float(np.median(array)), 4),
        "max": round(float(array.max()), 4),
    }


def overlaps(a: dict[str, float], b: dict[str, float]) -> bool:
    return a["min"] <= b["max"] and b["min"] <= a["max"]


def render_comparison(
    synthetic: list[FiducialMetrics], real: list[FiducialMetrics]
) -> str:
    left, right = summarize(synthetic), summarize(real)
    lines = [
        "| Metrica | sintetico (min/p50/max) | real (min/p50/max) | solapan |",
        "|---|---|---|---|",
    ]
    for name in (*METRIC_NAMES, "widthPx"):
        a, b = left[name], right[name]
        mark = "si" if overlaps(a, b) else "NO"
        lines.append(
            f"| {name} | {a['min']} / {a['p50']} / {a['max']} "
            f"| {b['min']} / {b['p50']} / {b['max']} | {mark} |"
        )
    lines.append(
        f"| esquinas medidas | {int(left['n']['count'])} | {int(right['n']['count'])} | |"
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m goldset.fiducial_metrics",
        description="Mide solidez/compacidad/oscuridad/distancia de los fiduciales",
    )
    parser.add_argument("paths", nargs="+", help="imagenes o directorios")
    parser.add_argument(
        "--compare",
        nargs="+",
        default=None,
        metavar="REAL",
        help="capturas reales contra las que comparar (imagenes o directorios)",
    )
    parser.add_argument("--json", action="store_true", help="volcar las medidas crudas")
    args = parser.parse_args(argv)

    synthetic = measure_targets(args.paths)
    if args.json:
        print(json.dumps([asdict(m) for m in synthetic], indent=2))
        return 0
    if args.compare:
        print(render_comparison(synthetic, measure_targets(args.compare)))
        return 0
    print(json.dumps(summarize(synthetic), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
