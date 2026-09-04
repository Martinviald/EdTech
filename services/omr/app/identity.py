"""Lectura de identidad: QR (T6) y grilla RUT (CD-10). Sin interpretar el payload.

El servicio NO valida DV ni matchea contra el roster: eso es del backend
(RutBubbleResolver). La unica excepcion es un peek estructural minimo
(`peek_logical_page_index`) para elegir que campos del spec buscar en un
bitmap: el pageIndex logico de la hoja viaja en el QR (CD-2), no en la
posicion dentro del archivo. Si el QR no se lee, se cae a
`posicion_en_archivo % pageCount`.

rut_bubbles: la grilla de `identity.bubbles` se lee como una digit_grid con la
misma regla de oro de CD-8 — cualquier grupo dudoso, doble o vacio => raw None
(identidad no detectada), jamas un RUT con un digito inventado. raw = digitos
concatenados ("12345678K"); confidence = minimo margin de los grupos ganadores,
recortado a [0,1]. El umbral se calcula sobre los fills de la grilla misma:
autocontenida, funciona igual en /v1/read y /v1/assess.

CD-15: la hoja generica ADEMAS imprime el QR de esquina (superior derecha) con
printedSheetId + layoutHash + pageIndex. En modo rut_bubbles se decodifica desde
el cuadrante superior derecho de la pagina rectificada y viaja en
identity.qrRaw; en modo qr, qrRaw duplica raw. El servicio sigue sin
interpretarlo: hash-check, idempotencia y pageIndex logico son del backend.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import zxingcpp

from .classify import AMBIGUITY_MARGIN, page_threshold
from .geometry import point_to_px
from .readers import read_digit_groups, sample_bubble_fills
from .rectify import RectifiedPage

QR_PAYLOAD_PREFIX = "academos"
QR_PAYLOAD_TOKENS = 6
QR_SHORT_PAYLOAD_RE = re.compile(r"^AC:[0-9A-F]{8}:(\d{1,2})$")
IDENTITY_REGION_PAD_RATIO = 0.03


def read_identity(
    rectified: RectifiedPage | None,
    original_gray: np.ndarray,
    spec: dict[str, Any],
    ambiguity_margin: float = AMBIGUITY_MARGIN,
) -> dict[str, Any]:
    mode = spec["identity"]["mode"]
    if mode == "qr":
        raw = _decode_qr(rectified, original_gray, spec)
        return {
            "mode": mode,
            "raw": raw,
            "confidence": 1.0 if raw is not None else 0.0,
            "qrRaw": raw,
        }
    if mode == "rut_bubbles" and rectified is not None:
        qr_raw = decode_corner_qr(rectified)
        return {**_read_rut_bubbles(rectified, spec, ambiguity_margin), "qrRaw": qr_raw}
    return {"mode": mode, "raw": None, "confidence": 0.0, "qrRaw": None}


def _read_rut_bubbles(
    rectified: RectifiedPage, spec: dict[str, Any], ambiguity_margin: float
) -> dict[str, Any]:
    undetected = {"mode": "rut_bubbles", "raw": None, "confidence": 0.0}
    bubbles = spec["identity"].get("bubbles")
    if not bubbles:
        return undetected
    fills = sample_bubble_fills(rectified, bubbles)
    threshold = page_threshold(fills)
    if not threshold.is_readable():
        return undetected
    groups = read_digit_groups(bubbles, fills, threshold, ambiguity_margin)
    if groups is None or any(group.state != "marked" for group in groups):
        return undetected
    raw = "".join(group.digit for group in groups if group.digit is not None)
    confidence = min(1.0, min(group.representative.margin for group in groups))
    return {"mode": "rut_bubbles", "raw": raw, "confidence": round(confidence, 4)}


def decode_corner_qr(rectified: RectifiedPage) -> str | None:
    width, height = rectified.size
    quadrant = rectified.gray[0 : height // 2, width // 2 : width]
    return _first_qr_text(quadrant)


def peek_logical_page_index(raw: str | None, file_page_index: int, page_count: int) -> int:
    """Pagina logica desde el payload del QR; sin QR, el orden del archivo.

    Espeja el parse minimo de los dos formatos de packages/types/src/utils/omr-qr.ts:
    corto (AC:<hex8>:<pagina>, el que se imprime desde la identidad robusta) y
    completo (academos:v1:..., hojas legadas). El servicio sigue sin interpretar
    identidad: solo necesita saber que campos del spec buscar en el bitmap.
    """
    if raw:
        short = QR_SHORT_PAYLOAD_RE.match(raw.strip())
        if short:
            page_index = int(short.group(1))
            if 0 <= page_index < page_count:
                return page_index
    tokens = raw.split(":") if raw else []
    if len(tokens) == QR_PAYLOAD_TOKENS and tokens[0] == QR_PAYLOAD_PREFIX:
        try:
            page_index = int(tokens[4])
        except ValueError:
            page_index = -1
        if 0 <= page_index < page_count:
            return page_index
    return file_page_index % page_count


def decode_region_qr(rectified: RectifiedPage, spec: dict[str, Any]) -> str | None:
    return _first_qr_text(_identity_region_crop(rectified, spec))


def _decode_qr(
    rectified: RectifiedPage | None, original_gray: np.ndarray, spec: dict[str, Any]
) -> str | None:
    candidates = []
    if rectified is not None:
        candidates.append(_identity_region_crop(rectified, spec))
        candidates.append(rectified.gray)
    candidates.append(original_gray)
    for candidate in candidates:
        raw = _first_qr_text(candidate)
        if raw is not None:
            return raw
    return None


def _identity_region_crop(rectified: RectifiedPage, spec: dict[str, Any]) -> np.ndarray:
    region = spec["identity"]["region"]
    width, height = rectified.size
    pad = round(IDENTITY_REGION_PAD_RATIO * width)
    x0, y0 = point_to_px(region["topLeft"], rectified.size)
    x1, y1 = point_to_px(region["bottomRight"], rectified.size)
    return rectified.gray[
        max(0, y0 - pad) : min(height, y1 + pad), max(0, x0 - pad) : min(width, x1 + pad)
    ]


def _first_qr_text(gray: np.ndarray) -> str | None:
    if gray.size == 0:
        return None
    results = zxingcpp.read_barcodes(
        np.ascontiguousarray(gray), formats=zxingcpp.BarcodeFormat.QRCode
    )
    for result in results:
        if result.valid and result.text:
            return result.text
    return None
