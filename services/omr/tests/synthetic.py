"""Generador sintetico de hojas para tests: renderiza una pagina desde un LayoutSpec.

Sigue EXACTAMENTE la convencion del rectangulo fiducial de app/geometry.py
(CD-5, la misma que usa el impresor, workstream A1):

- Rectangulo fiducial = CENTROS de los 4 cuadrados fiduciales; las
  coordenadas del spec son fracciones 0-1 de ese rectangulo.
- marginRatio = margen de pagina al borde EXTERIOR del cuadrado, y sizeRatio
  = lado del cuadrado, ambos en fracciones del ANCHO de pagina (igual en los
  4 lados); los cuadrados se dibujan centrados en las esquinas del rectangulo.
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

CORNER_QR_REGION = {
    "topLeft": {"x": 0.78, "y": 0.02},
    "bottomRight": {"x": 0.98, "y": 0.16},
}


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


Chosen = str | list[str] | dict[int, str | list[str]]


def render_page(
    spec: dict[str, Any],
    page_index: int,
    *,
    marks: dict[str, Chosen] | None = None,
    coverage: dict[str, float] | None = None,
    styles: dict[str, str] | None = None,
    identity_marks: dict[int, str | list[str]] | None = None,
    mark_offsets: dict[str, tuple[int, int]] | None = None,
    qr_text: str | None = "auto",
    page_width: int = DEFAULT_PAGE_WIDTH,
    paper_gray: int = PAPER_GRAY,
    pencil_gray: int = PENCIL_GRAY,
    fiducial_roughness: float = 0.0,
    fiducial_inks: dict[int, int] | None = None,
    drop_fiducials: tuple[int, ...] = (),
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    rng = rng or np.random.default_rng(7)
    marks = marks or {}
    coverage = coverage or {}
    styles = styles or {}
    mark_offsets = mark_offsets or {}

    paper_w_mm, paper_h_mm = PAPER_SIZES_MM[spec["paper"]]
    page_height = round(page_width * paper_h_mm / paper_w_mm)
    page = np.full((page_height, page_width), paper_gray, dtype=np.uint8)

    margin = spec["fiducials"]["marginRatio"] * page_width
    side = spec["fiducials"]["sizeRatio"] * page_width
    inset = margin + side / 2
    rect_x0, rect_y0 = inset, inset
    rect_w = page_width - 2 * inset
    rect_h = page_height - 2 * inset

    _draw_fiducials(
        page,
        side,
        rect_x0,
        rect_y0,
        rect_w,
        rect_h,
        roughness=fiducial_roughness,
        inks=fiducial_inks or {},
        drop=drop_fiducials,
        rng=rng,
    )
    if qr_text is not None and spec["identity"]["mode"] in ("qr", "rut_bubbles"):
        payload = qr_payload(page_index, spec["pageCount"]) if qr_text == "auto" else qr_text
        region = (
            spec["identity"]["region"]
            if spec["identity"]["mode"] == "qr"
            else CORNER_QR_REGION
        )
        _draw_qr(page, region, payload, rect_x0, rect_y0, rect_w, rect_h)

    transform = (rect_x0, rect_y0, rect_w, rect_h)
    if spec["identity"]["mode"] == "rut_bubbles" and spec["identity"].get("bubbles"):
        _draw_bubble_set(
            page,
            spec["identity"]["bubbles"],
            "identity",
            identity_marks,
            coverage,
            styles,
            mark_offsets,
            transform,
            pencil_gray,
            rng,
        )

    for field in spec["fields"]:
        if field["pageIndex"] != page_index:
            continue
        _draw_bubble_set(
            page,
            field["bubbles"],
            field["fieldId"],
            marks.get(field["fieldId"]),
            coverage,
            styles,
            mark_offsets,
            transform,
            pencil_gray,
            rng,
        )
    return page


def _draw_bubble_set(
    page: np.ndarray,
    bubbles: list[dict[str, Any]],
    owner_id: str,
    chosen: Chosen | None,
    coverage: dict[str, float],
    styles: dict[str, str],
    mark_offsets: dict[str, tuple[int, int]],
    transform: tuple[float, float, float, float],
    pencil_gray: int,
    rng: np.random.Generator,
) -> None:
    rect_x0, rect_y0, rect_w, rect_h = transform
    offset = mark_offsets.get(owner_id, (0, 0))
    for bubble in bubbles:
        center = (
            round(rect_x0 + bubble["center"]["x"] * rect_w),
            round(rect_y0 + bubble["center"]["y"] * rect_h),
        )
        radius = max(2, round(bubble["radius"] * rect_w))
        _draw_bubble(page, bubble["value"], center, radius)
        if _bubble_chosen(chosen, bubble):
            keys = _bubble_keys(owner_id, bubble)
            fill_coverage = _first_match(coverage, keys, 1.0)
            style = _first_match(styles, keys, "fill")
            mark_center = (center[0] + offset[0], center[1] + offset[1])
            _mark_bubble(page, style, mark_center, radius, fill_coverage, pencil_gray, rng)


def _bubble_chosen(chosen: Chosen | None, bubble: dict[str, Any]) -> bool:
    if chosen is None:
        return False
    if isinstance(chosen, dict):
        group_chosen = chosen.get(bubble.get("group"))
        values = [group_chosen] if isinstance(group_chosen, str) else (group_chosen or [])
        return bubble["value"] in values
    values = [chosen] if isinstance(chosen, str) else chosen
    return bubble["value"] in values


def _bubble_keys(owner_id: str, bubble: dict[str, Any]) -> list[str]:
    keys = []
    if bubble.get("group") is not None:
        keys.append(f"{owner_id}:{bubble['group']}:{bubble['value']}")
    keys.append(f"{owner_id}:{bubble['value']}")
    keys.append(owner_id)
    return keys


def _first_match(mapping: dict[str, Any], keys: list[str], default: Any) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return default


def digit_grid_bubbles(
    *,
    origin: tuple[float, float],
    digit_count: int,
    column_step: float = 0.05,
    row_step: float = 0.016,
    radius: float = 0.01,
    last_group_extra: str = "",
) -> list[dict[str, Any]]:
    bubbles = []
    for group in range(digit_count):
        values = "0123456789" + (last_group_extra if group == digit_count - 1 else "")
        for row, value in enumerate(values):
            bubbles.append(
                {
                    "value": value,
                    "center": {
                        "x": origin[0] + group * column_step,
                        "y": origin[1] + row * row_step,
                    },
                    "radius": radius,
                    "group": group,
                }
            )
    return bubbles


def make_digit_grid_field(
    field_id: str,
    printed_number: str,
    *,
    page_index: int = 0,
    digit_count: int = 3,
    origin: tuple[float, float] = (0.6, 0.3),
) -> dict[str, Any]:
    return {
        "fieldId": field_id,
        "kind": "digit_grid",
        "printedNumber": printed_number,
        "pageIndex": page_index,
        "selectMode": "single",
        "bubbles": digit_grid_bubbles(origin=origin, digit_count=digit_count),
        "region": None,
    }


def make_crop_region_field(
    field_id: str,
    printed_number: str,
    *,
    page_index: int = 0,
    top_left: tuple[float, float] = (0.1, 0.75),
    bottom_right: tuple[float, float] = (0.9, 0.95),
) -> dict[str, Any]:
    return {
        "fieldId": field_id,
        "kind": "crop_region",
        "printedNumber": printed_number,
        "pageIndex": page_index,
        "selectMode": "single",
        "bubbles": [],
        "region": {
            "topLeft": {"x": top_left[0], "y": top_left[1]},
            "bottomRight": {"x": bottom_right[0], "y": bottom_right[1]},
        },
    }


def make_rut_identity(*, body_digits: int = 8) -> dict[str, Any]:
    return {
        "mode": "rut_bubbles",
        "region": {
            "topLeft": {"x": 0.06, "y": 0.02},
            "bottomRight": {"x": 0.52, "y": 0.21},
        },
        "bubbles": digit_grid_bubbles(
            origin=(0.08, 0.035),
            digit_count=body_digits + 1,
            column_step=0.045,
            row_step=0.015,
            radius=0.009,
            last_group_extra="K",
        ),
    }


def rut_marks(rut: str) -> dict[int, str]:
    return {group: value for group, value in enumerate(rut)}


def spec_point_px(
    spec: dict[str, Any],
    point: dict[str, float],
    page_width: int = DEFAULT_PAGE_WIDTH,
) -> tuple[int, int]:
    paper_w_mm, paper_h_mm = PAPER_SIZES_MM[spec["paper"]]
    page_height = round(page_width * paper_h_mm / paper_w_mm)
    inset = (spec["fiducials"]["marginRatio"] + spec["fiducials"]["sizeRatio"] / 2) * page_width
    rect_w = page_width - 2 * inset
    rect_h = page_height - 2 * inset
    return round(inset + point["x"] * rect_w), round(inset + point["y"] * rect_h)


def bubble_center_px(
    spec: dict[str, Any],
    field_id: str,
    value: str,
    page_width: int = DEFAULT_PAGE_WIDTH,
) -> tuple[int, int]:
    field = next(f for f in spec["fields"] if f["fieldId"] == field_id)
    bubble = next(b for b in field["bubbles"] if b["value"] == value)
    return spec_point_px(spec, bubble["center"], page_width)


def bubble_radius_px(spec: dict[str, Any], page_width: int = DEFAULT_PAGE_WIDTH) -> int:
    inset = (spec["fiducials"]["marginRatio"] + spec["fiducials"]["sizeRatio"] / 2) * page_width
    rect_w = page_width - 2 * inset
    radius = max(bubble["radius"] for field in spec["fields"] for bubble in field["bubbles"])
    return max(2, round(radius * rect_w))


def _draw_fiducials(
    page: np.ndarray,
    side: float,
    x0: float,
    y0: float,
    rect_w: float,
    rect_h: float,
    *,
    roughness: float = 0.0,
    inks: dict[int, int] | None = None,
    drop: tuple[int, ...] = (),
    rng: np.random.Generator | None = None,
) -> None:
    """Dibuja los 4 cuadrados fiduciales en las esquinas del rectangulo fiducial.

    `roughness` desborda el borde como lo hace la tinta impresa y escaneada: con
    0.0 sale el cuadrado perfecto (solidez 1.00, compacidad 16.0) que usan los
    tests unitarios; con 0.028-0.040 la solidez cae a 0.87-0.93 y la compacidad
    sube a 16.5-17.8, que es donde vive el papel real (ver
    `goldset/fiducial_metrics.py` y el README del barrido). Un generador que
    solo sabe dibujar el cuadrado perfecto no sirve para calibrar el gate de
    forma: es exactamente como el umbral de solidez termino en 0.88 rechazando
    capturas limpias.

    `inks` pinta una esquina mas clara que el resto (el escaner que lava un
    fiducial: interior 125 o 182 sobre papel 255, con el papel verificado a
    mano). `drop` omite esquinas enteras (fiducial fuera de la captura).
    """
    inks = inks or {}
    x1 = x0 + rect_w
    y1 = y0 + rect_h
    half = side / 2
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for index, (center_x, center_y) in enumerate(corners):
        if index in drop:
            continue
        ink = inks.get(index, INK_GRAY)
        if roughness <= 0.0:
            top_left = (round(center_x - half), round(center_y - half))
            bottom_right = (round(center_x + half), round(center_y + half))
            cv2.rectangle(page, top_left, bottom_right, ink, thickness=-1)
            continue
        polygon = _rough_square_polygon(
            (center_x, center_y), side, roughness, rng or np.random.default_rng(11)
        )
        cv2.fillPoly(page, [polygon], ink)


ROUGH_SQUARE_SMOOTHING = 5


def _rough_square_polygon(
    center: tuple[float, float], side: float, roughness: float, rng: np.random.Generator
) -> np.ndarray:
    """Cuadrado con el borde dentado: ruido radial suavizado sobre el perimetro.

    El suavizado importa tanto como la amplitud — ruido pixel a pixel dispara la
    compacidad muy por encima de lo que se mide en papel; promediado sobre 5
    muestras da la mordida gruesa de la tinta, que es la forma real.
    """
    samples = max(8, int(side))
    half = side / 2
    points = np.empty((4 * samples, 2), dtype=np.float32)
    for index in range(4 * samples):
        edge, along = divmod(index, samples)
        travel = -half + side * along / samples
        points[index] = [
            (travel, -half),
            (half, travel),
            (-travel, half),
            (-half, -travel),
        ][edge]

    noise = rng.normal(0, roughness * side, size=len(points)).astype(np.float32)
    window = np.ones(ROUGH_SQUARE_SMOOTHING, dtype=np.float32) / ROUGH_SQUARE_SMOOTHING
    padded = np.concatenate(
        [noise[-ROUGH_SQUARE_SMOOTHING:], noise, noise[:ROUGH_SQUARE_SMOOTHING]]
    )
    noise = np.convolve(padded, window, mode="same")[
        ROUGH_SQUARE_SMOOTHING:-ROUGH_SQUARE_SMOOTHING
    ]
    outward = points / np.maximum(np.abs(points).max(axis=1, keepdims=True), 1e-6)
    displaced = points + outward * noise[:, np.newaxis]
    return np.round(displaced + np.array(center, dtype=np.float32)).astype(np.int32)


def _draw_qr(
    page: np.ndarray,
    region: dict[str, dict[str, float]],
    payload: str,
    x0: float,
    y0: float,
    rect_w: float,
    rect_h: float,
) -> None:
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


def _mark_bubble(
    page: np.ndarray,
    style: str,
    center: tuple[int, int],
    radius: int,
    fill_coverage: float,
    pencil_gray: int,
    rng: np.random.Generator,
) -> None:
    if style == "cross":
        _cross_bubble(page, center, radius, pencil_gray)
    elif style == "tick":
        _tick_bubble(page, center, radius, pencil_gray)
    elif style == "overflow":
        cv2.circle(page, center, round(radius * 1.5), pencil_gray, thickness=-1)
    else:
        _fill_bubble(page, center, radius, fill_coverage, pencil_gray, rng)


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


def _cross_bubble(page: np.ndarray, center: tuple[int, int], radius: int, pencil_gray: int) -> None:
    reach = round(radius * 0.9)
    thickness = max(2, round(radius * 0.45))
    for sign in (1, -1):
        cv2.line(
            page,
            (center[0] - reach, center[1] - sign * reach),
            (center[0] + reach, center[1] + sign * reach),
            pencil_gray,
            thickness,
        )


def _tick_bubble(page: np.ndarray, center: tuple[int, int], radius: int, pencil_gray: int) -> None:
    thickness = max(2, round(radius * 0.5))
    low = (center[0] - round(radius * 0.3), center[1] + round(radius * 0.6))
    cv2.line(
        page, (center[0] - round(radius * 0.9), center[1]), low, pencil_gray, thickness
    )
    cv2.line(
        page,
        low,
        (center[0] + round(radius * 0.9), center[1] - round(radius * 0.8)),
        pencil_gray,
        thickness,
    )


def smudge(
    gray: np.ndarray,
    center_px: tuple[int, int],
    radius_px: int,
    smudge_gray: int,
    rng: np.random.Generator,
) -> np.ndarray:
    out = gray.copy()
    for _ in range(4):
        offset = (
            center_px[0] + int(rng.integers(-radius_px, radius_px + 1)),
            center_px[1] + int(rng.integers(-radius_px, radius_px + 1)),
        )
        blob_radius = max(1, round(radius_px * float(rng.uniform(0.5, 0.9))))
        cv2.circle(out, offset, blob_radius, smudge_gray, thickness=-1)
    return out


def to_bgr(gray: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def on_canvas(gray: np.ndarray, pad_frac: float = 0.08, background: int = 210) -> np.ndarray:
    height, width = gray.shape
    pad = round(width * pad_frac)
    canvas = np.full((height + 2 * pad, width + 2 * pad), background, dtype=np.uint8)
    canvas[pad : pad + height, pad : pad + width] = gray
    return canvas


def background_square(
    gray: np.ndarray,
    corner: int,
    distance_frac: float,
    side_frac: float = 0.02,
    ink: int = INK_GRAY,
) -> np.ndarray:
    """Un cuadrado oscuro DISTRACTOR en el fondo, entre la esquina y el fiducial.

    Reproduce el modo de falla medido sobre fotos reales: `_best_square` corona
    el cuadrado mas cercano a la esquina de la IMAGEN, asi que cualquier objeto
    del fondo que quede mas cerca del borde que el fiducial verdadero le gana la
    esquina — una sombra, la junta de una mesa de vidrio o, lo observado en
    `IMG_1614`, otra hoja de respuestas del monton con sus propios fiduciales.
    El fiducial verdadero sigue ahi y el detector lo encuentra; simplemente lo
    descarta.

    La receta correcta NO es "hoja chica y rotada" —eso no reproduce nada, y las
    hojas del conjunto de oro siempre dieron 4/4 sobre fondo limpio— sino este
    cuadrado. `distance_frac` es la distancia del distractor a la esquina de la
    imagen en fracciones del lado corto, y lo que importa es que sea MENOR que
    la del fiducial verdadero: ahi el detector se equivoca. Se varia para no
    calcar una foto: el mecanismo es la posicion relativa, no una distancia.

    Se dibuja del tamano de un fiducial a proposito. Un distractor que el gate
    de forma o de area rechazara no probaria nada: la falla es que el objeto
    ES un cuadrado oscuro aceptable, y solo la firma de la grilla puede decir
    que no es el fiducial de ESTA hoja.
    """
    height, width = gray.shape
    short = min(width, height)
    offset = round(distance_frac * short / (2**0.5))
    side = max(3, round(side_frac * width / 2))
    x = offset if corner in (0, 3) else width - 1 - offset
    y = offset if corner in (0, 1) else height - 1 - offset
    out = gray.copy()
    cv2.rectangle(out, (x - side, y - side), (x + side, y + side), ink, thickness=-1)
    return out


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


def alias_resample(gray: np.ndarray, scale: float, phase_px: int = 0) -> np.ndarray:
    """Reduccion sin pasa-bajos: el remuestreo del escaner que voltea modulos.

    INTER_NEAREST descarta filas y columnas enteras, igual que el escaner que
    captura nativo y reduce a ~240 dpi sin filtrar (doc 07 §2 — la causa raiz
    del QR erratico). `phase_px` corre la grilla de muestreo para explorar la
    loteria de fase. Ojo: sobre un simbolo sintetico LIMPIO zxing sobrevive a
    esto (medido: v5 con dot-gain + blur 3.5 + realce 2.5 + NN 0.40 + JPEG 82
    decodifica 4/4 fases) — la muerte real necesita la cadena fisica completa;
    por eso el guardarrail del canal es el piso de 12 px/modulo del impresor y
    esta receta cubre la LECTURA DE MARCAS bajo remuestreo, no el kill del QR.
    """
    shifted = gray[phase_px:, phase_px:]
    height, width = shifted.shape
    return cv2.resize(
        shifted,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_NEAREST,
    )


def wrinkle(gray: np.ndarray, amplitude_px: float, waves: float = 2.5) -> np.ndarray:
    height, width = gray.shape
    xs, ys = np.meshgrid(
        np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32)
    )
    map_x = xs + amplitude_px * np.sin(2 * np.pi * waves * ys / height)
    map_y = ys + amplitude_px * np.sin(2 * np.pi * waves * xs / width)
    return cv2.remap(
        gray,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=245,
    )


def side_shadow(gray: np.ndarray, band_frac: float, strength: float) -> np.ndarray:
    out = gray.astype(np.float32)
    band = round(gray.shape[1] * band_frac)
    out[:, :band] *= 1.0 - strength
    return np.clip(out, 0, 255).astype(np.uint8)


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


def clip_corner(gray: np.ndarray, corner: int, depth_frac: float = 0.06) -> np.ndarray:
    """Recorta en diagonal una esquina de la captura, como el auto-crop del escaner.

    Parte el cuadrado fiducial al medio y deja el trozo pegado al borde de la
    imagen, con el centroide sesgado — el modo de falla que `_corner_looks_clipped`
    distingue de "aca no hay ningun fiducial". Las esquinas van en el orden
    TL, TR, BR, BL, igual que en `app/rectify.py`.
    """
    height, width = gray.shape
    out = gray.copy()
    reach_x = round(width * depth_frac)
    reach_y = round(height * depth_frac)
    corner_point = [(0, 0), (width, 0), (width, height), (0, height)][corner]
    sign_x = 1 if corner_point[0] == 0 else -1
    sign_y = 1 if corner_point[1] == 0 else -1
    triangle = np.array(
        [
            corner_point,
            (corner_point[0] + sign_x * reach_x, corner_point[1]),
            (corner_point[0], corner_point[1] + sign_y * reach_y),
        ],
        dtype=np.int32,
    )
    cv2.fillPoly(out, [triangle], 255)
    return out


def motion_blur_region(
    gray: np.ndarray,
    region: tuple[float, float, float, float],
    length_px: int = 9,
) -> np.ndarray:
    """Empasta horizontalmente una region: el QR movido mientras el resto es nitido.

    `region` es (x0, y0, x1, y1) en fracciones de la imagen. Reproduce la captura
    donde el QR queda ilegible pero la pagina entera mide `sharpness = 1.0`, asi
    que ningun gate global de nitidez la ve venir.
    """
    height, width = gray.shape
    x0, y0, x1, y1 = region
    left, right = round(x0 * width), round(x1 * width)
    top, bottom = round(y0 * height), round(y1 * height)
    out = gray.copy()
    kernel = np.zeros((length_px, length_px), dtype=np.float32)
    kernel[length_px // 2, :] = 1.0 / length_px
    patch = out[top:bottom, left:right]
    if patch.size:
        out[top:bottom, left:right] = cv2.filter2D(patch, -1, kernel)
    return out


def reflow(gray: np.ndarray, aspect_ratio: float) -> np.ndarray:
    """Reestira la captura a otra proporcion (carta 1.294 llega como A4 1.414).

    Mantiene el ancho y mueve el alto: la hoja sigue siendo legible pero el
    rectangulo fiducial deja de tener la forma que el spec declara.
    """
    width = gray.shape[1]
    return cv2.resize(
        gray, (width, round(width * aspect_ratio)), interpolation=cv2.INTER_AREA
    )


def png_bytes(gray: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".png", to_bgr(gray))
    assert ok
    return encoded.tobytes()


def radial_distortion(gray: np.ndarray, k1: float) -> np.ndarray:
    """Distorsion de barril de una lente de telefono: las esquinas se acercan al centro
    mas que el interior, y una homografia de 4 fiduciales deja cada burbuja corrida.

    r' = r (1 + k1 r^2) con r normalizado a la media diagonal. Con k1 = 0.02 en una hoja
    de 1655 px el desajuste interior queda en ~8-10 px, el rango medido en fotos reales
    (goldset/README-registro.md).
    """
    height, width = gray.shape
    center_x, center_y = width / 2.0, height / 2.0
    radius = float(np.hypot(center_x, center_y))
    xs, ys = np.meshgrid(
        np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32)
    )
    xn = (xs - center_x) / radius
    yn = (ys - center_y) / radius
    factor = 1.0 + k1 * (xn * xn + yn * yn)
    map_x = (center_x + (xs - center_x) * factor).astype(np.float32)
    map_y = (center_y + (ys - center_y) * factor).astype(np.float32)
    return cv2.remap(
        gray,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=245,
    )


def cylinder_curl(gray: np.ndarray, amplitude_px: float) -> np.ndarray:
    """Hoja abombada sobre la mesa: las filas del medio se corren en x, las esquinas no.

    x' = x + a sin(pi y / H). Los fiduciales (arriba y abajo) casi no se mueven, asi que
    la homografia sale "bien" y aun asi las burbujas del centro quedan a `a` pixeles.
    """
    height, width = gray.shape
    xs, ys = np.meshgrid(
        np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32)
    )
    map_x = xs - amplitude_px * np.sin(np.pi * ys / height)
    return cv2.remap(
        gray,
        map_x.astype(np.float32),
        ys,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=245,
    )


def shift_fiducials(
    gray: np.ndarray,
    size_ratio: float,
    margin_ratio: float,
    shifts: tuple[tuple[int, int], ...],
) -> np.ndarray:
    """Corre cada cuadrado fiducial (dx, dy) pixeles: un centroide sesgado por esquina.

    La tinta de la hoja no se mueve, solo los 4 cuadrados; la homografia que sale de
    ellos deja el interior corrido con un campo que varia suave por la pagina, como el
    sesgo consistente medido en las fotos reales. Orden de esquinas como en
    `_draw_fiducials`: TL, TR, BR, BL.
    """
    height, width = gray.shape
    side = size_ratio * width
    inset = margin_ratio * width + side / 2
    corners = [(inset, inset), (width - inset, inset), (width - inset, height - inset),
               (inset, height - inset)]
    out = gray.copy()
    reach = round(side * 0.9)
    paper = int(np.median(gray))
    for (center_x, center_y), (dx, dy) in zip(corners, shifts, strict=True):
        cx, cy = round(center_x), round(center_y)
        y0, y1 = max(0, cy - reach), min(height, cy + reach + 1)
        x0, x1 = max(0, cx - reach), min(width, cx + reach + 1)
        patch = gray[y0:y1, x0:x1].copy()
        out[y0:y1, x0:x1] = paper
        ty0, tx0 = y0 + dy, x0 + dx
        ty1, tx1 = ty0 + patch.shape[0], tx0 + patch.shape[1]
        if ty0 < 0 or tx0 < 0 or ty1 > height or tx1 > width:
            continue
        out[ty0:ty1, tx0:tx1] = patch
    return out
