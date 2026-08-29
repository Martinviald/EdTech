"""Generador sintetico de hojas para tests: renderiza una pagina desde un LayoutSpec.

Sigue EXACTAMENTE la convencion del rectangulo fiducial de app/geometry.py
(la misma que debe usar el impresor, workstream A1):

- Rectangulo fiducial = esquinas EXTERIORES de los 4 cuadrados; las
  coordenadas del spec son fracciones 0-1 de ese rectangulo.
- marginRatio = margen de pagina al borde EXTERIOR del cuadrado, y sizeRatio
= lado del cuadrado, ambos en fracciones del ANCHO de
  pagina (igual en los 4 lados); los cuadrados se dibujan hacia adentro.
- radius de burbuja es fraccion del ANCHO del rectangulo fiducial.

Todo es deterministico: lo aleatorio recibe un `numpy.random.Generator` con
semilla fija. Ningun fixture se comitea como binario: se construye en el test.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import zxingcpp

from app.geometry import PAPER_SIZES_MM

DEFAULT_PAGE_WIDTH = 1240
PAPER_GRAY = 235
INK_GRAY = 40
LETTER_GRAY = 110
PENCIL_GRAY = 75

INSTRUMENT_ID = "9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33"
SHEET_ID = "1c9a7e55-2d40-4b8a-9f31-6a0d8c4e7b21"
LAYOUT_HASH_16 = "a3f9c1e70b4d2856"


def qr_payload(page_index: int, page_count: int, sheet_id: str = SHEET_ID) -> str:
    return f"academos:v1:{sheet_id}:{LAYOUT_HASH_16}:{page_index}:{page_count}"


def make_layout_spec(
    *,
    fields_per_page: int = 8,
    page_count: int = 1,
    alternatives: tuple[str, ...] = ("A", "B", "C", "D"),
    paper: str = "letter",
) -> dict[str, Any]:
    fields = []
    for page in range(page_count):
        for row in range(fields_per_page):
            number = page * fields_per_page + row + 1
            y = 0.22 + row * 0.07
            bubbles = [
                {
                    "value": value,
                    "center": {"x": 0.14 + column * 0.06, "y": y},
                    "radius": 0.013,
                }
                for column, value in enumerate(alternatives)
            ]
            fields.append(
                {
                    "fieldId": f"f_{number:03d}",
                    "kind": "bubble_group",
                    "printedNumber": str(number),
                    "pageIndex": page,
                    "selectMode": "single",
                    "bubbles": bubbles,
                    "region": None,
                }
            )
    return {
        "specVersion": 1,
        "instrumentId": INSTRUMENT_ID,
        "pageCount": page_count,
        "paper": paper,
        "fiducials": {"kind": "corner_squares", "sizeRatio": 0.02, "marginRatio": 0.03},
        "identity": {
            "mode": "qr",
            "region": {
                "topLeft": {"x": 0.74, "y": 0.01},
                "bottomRight": {"x": 0.99, "y": 0.15},
            },
        },
        "fields": fields,
    }


def render_page(
    spec: dict[str, Any],
    page_index: int,
    *,
    marks: dict[str, str | list[str]] | None = None,
    coverage: dict[str, float] | None = None,
    qr_text: str | None = "auto",
    page_width: int = DEFAULT_PAGE_WIDTH,
    paper_gray: int = PAPER_GRAY,
    pencil_gray: int = PENCIL_GRAY,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    rng = rng or np.random.default_rng(7)
    marks = marks or {}
    coverage = coverage or {}

    paper_w_mm, paper_h_mm = PAPER_SIZES_MM[spec["paper"]]
    page_height = round(page_width * paper_h_mm / paper_w_mm)
    page = np.full((page_height, page_width), paper_gray, dtype=np.uint8)

    margin = spec["fiducials"]["marginRatio"] * page_width
    side = spec["fiducials"]["sizeRatio"] * page_width
    inset = margin + side / 2
    rect_x0, rect_y0 = inset, inset
    rect_w = page_width - 2 * inset
    rect_h = page_height - 2 * inset

    _draw_fiducials(page, side, rect_x0, rect_y0, rect_w, rect_h)
    if qr_text is not None and spec["identity"]["mode"] == "qr":
        payload = qr_payload(page_index, spec["pageCount"]) if qr_text == "auto" else qr_text
        _draw_qr(page, spec, payload, rect_x0, rect_y0, rect_w, rect_h)

    for field in spec["fields"]:
        if field["pageIndex"] != page_index:
            continue
        chosen = marks.get(field["fieldId"])
        chosen_values = [chosen] if isinstance(chosen, str) else (chosen or [])
        for bubble in field["bubbles"]:
            center = (
                round(rect_x0 + bubble["center"]["x"] * rect_w),
                round(rect_y0 + bubble["center"]["y"] * rect_h),
            )
            radius = max(2, round(bubble["radius"] * rect_w))
            _draw_bubble(page, bubble["value"], center, radius)
            if bubble["value"] in chosen_values:
                fill_coverage = coverage.get(field["fieldId"], 1.0)
                _fill_bubble(page, center, radius, fill_coverage, pencil_gray, rng)
    return page


def _draw_fiducials(
    page: np.ndarray, side: float, x0: float, y0: float, rect_w: float, rect_h: float
) -> None:
    x1 = x0 + rect_w
    y1 = y0 + rect_h
    half = side / 2
    for center_x, center_y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
        top_left = (round(center_x - half), round(center_y - half))
        bottom_right = (round(center_x + half), round(center_y + half))
        cv2.rectangle(page, top_left, bottom_right, INK_GRAY, thickness=-1)


def _draw_qr(
    page: np.ndarray,
    spec: dict[str, Any],
    payload: str,
    x0: float,
    y0: float,
    rect_w: float,
    rect_h: float,
) -> None:
    region = spec["identity"]["region"]
    box_x0 = round(x0 + region["topLeft"]["x"] * rect_w)
    box_y0 = round(y0 + region["topLeft"]["y"] * rect_h)
    box_x1 = round(x0 + region["bottomRight"]["x"] * rect_w)
    box_y1 = round(y0 + region["bottomRight"]["y"] * rect_h)

    barcode = zxingcpp.create_barcode(payload, zxingcpp.BarcodeFormat.QRCode, ec_level="M")
    modules = np.array(zxingcpp.write_barcode_to_image(barcode, scale=1))
    box_side = min(box_x1 - box_x0, box_y1 - box_y0)
    scale = max(1, box_side // modules.shape[0])
    qr = np.kron(modules, np.ones((scale, scale), dtype=np.uint8))

    offset_x = box_x0 + (box_x1 - box_x0 - qr.shape[1]) // 2
    offset_y = box_y0 + (box_y1 - box_y0 - qr.shape[0]) // 2
    target = page[offset_y : offset_y + qr.shape[0], offset_x : offset_x + qr.shape[1]]
    target[:] = np.where(qr < 128, INK_GRAY, 255)


def _draw_bubble(
    page: np.ndarray, letter: str, center: tuple[int, int], radius: int
) -> None:
    cv2.circle(page, center, radius, INK_GRAY, thickness=max(1, radius // 7))
    font_scale = radius / 28
    (text_w, text_h), _ = cv2.getTextSize(letter, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
    origin = (center[0] - text_w // 2, center[1] + text_h // 2)
    cv2.putText(page, letter, origin, cv2.FONT_HERSHEY_SIMPLEX, font_scale, LETTER_GRAY, 1)


def _fill_bubble(
    page: np.ndarray,
    center: tuple[int, int],
    radius: int,
    fill_coverage: float,
    pencil_gray: int,
    rng: np.random.Generator,
) -> None:
    jitter = 0 if fill_coverage >= 1.0 else round(radius * 0.15)
    offset = (
        center[0] + int(rng.integers(-jitter, jitter + 1)) if jitter else center[0],
        center[1] + int(rng.integers(-jitter, jitter + 1)) if jitter else center[1],
    )
    fill_radius = max(1, round(radius * 0.92 * float(np.sqrt(fill_coverage))))
    cv2.circle(page, offset, fill_radius, pencil_gray, thickness=-1)


def to_bgr(gray: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def on_canvas(gray: np.ndarray, pad_frac: float = 0.08, background: int = 210) -> np.ndarray:
    height, width = gray.shape
    pad = round(width * pad_frac)
    canvas = np.full((height + 2 * pad, width + 2 * pad), background, dtype=np.uint8)
    canvas[pad : pad + height, pad : pad + width] = gray
    return canvas


def rotate(gray: np.ndarray, degrees: float, border_gray: int = 245) -> np.ndarray:
    height, width = gray.shape
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), degrees, 1.0)
    return cv2.warpAffine(
        gray, matrix, (width, height), borderMode=cv2.BORDER_CONSTANT, borderValue=border_gray
    )


def perspective(gray: np.ndarray, strength: float, rng: np.random.Generator) -> np.ndarray:
    height, width = gray.shape
    reach = strength * width
    src = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    dst = src + rng.uniform(0, reach, size=(4, 2)).astype(np.float32)
    dst[1][0] -= 2 * rng.uniform(0, reach)
    dst[2] -= 2 * rng.uniform(0, reach, size=2).astype(np.float32)
    dst[3][1] -= 2 * rng.uniform(0, reach)
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(
        gray, matrix, (width, height), borderMode=cv2.BORDER_CONSTANT, borderValue=245
    )


def blur(gray: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(gray, (0, 0), sigma)


def diagonal_shadow(gray: np.ndarray, strength: float) -> np.ndarray:
    height, width = gray.shape
    xs = np.linspace(0, 1, width, dtype=np.float32)
    ys = np.linspace(0, 1, height, dtype=np.float32)
    gradient = 1.0 - strength * (xs[np.newaxis, :] + ys[:, np.newaxis]) / 2
    return np.clip(gray.astype(np.float32) * gradient, 0, 255).astype(np.uint8)


def add_noise(gray: np.ndarray, std: float, rng: np.random.Generator) -> np.ndarray:
    noise = rng.normal(0, std, size=gray.shape)
    return np.clip(gray.astype(np.float32) + noise, 0, 255).astype(np.uint8)


def rescale(gray: np.ndarray, factor: float) -> np.ndarray:
    height, width = gray.shape
    return cv2.resize(
        gray, (round(width * factor), round(height * factor)), interpolation=cv2.INTER_AREA
    )


def photocopy_gray(gray: np.ndarray) -> np.ndarray:
    return np.clip(80 + gray.astype(np.float32) * 0.6, 0, 255).astype(np.uint8)


def glare_spot(
    gray: np.ndarray, center_frac: tuple[float, float], radius_frac: float
) -> np.ndarray:
    height, width = gray.shape
    out = gray.copy()
    center = (round(center_frac[0] * width), round(center_frac[1] * height))
    cv2.circle(out, center, round(radius_frac * width), 255, thickness=-1)
    return out


def png_bytes(gray: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".png", to_bgr(gray))
    assert ok
    return encoded.tobytes()
