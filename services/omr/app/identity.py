"""Lectura de QR (T6). El servicio NO interpreta el payload: eso es del backend.

La unica excepcion es un peek estructural minimo (`peek_logical_page_index`)
para elegir que campos del spec buscar en un bitmap: el pageIndex logico de la
hoja viaja en el QR (CD-2), no en la posicion dentro del archivo. Si el QR no
se lee, se cae a `posicion_en_archivo % pageCount`.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import zxingcpp

from .geometry import point_to_px
from .rectify import RectifiedPage

QR_PAYLOAD_PREFIX = "academos"
QR_PAYLOAD_TOKENS = 6
IDENTITY_REGION_PAD_RATIO = 0.03


def read_identity(
    rectified: RectifiedPage | None,
    original_gray: np.ndarray,
    spec: dict[str, Any],
) -> dict[str, Any]:
    mode = spec["identity"]["mode"]
    raw = _decode_qr(rectified, original_gray, spec) if mode == "qr" else None
    return {"mode": mode, "raw": raw, "confidence": 1.0 if raw is not None else 0.0}


def peek_logical_page_index(raw: str | None, file_page_index: int, page_count: int) -> int:
    tokens = raw.split(":") if raw else []
    if len(tokens) == QR_PAYLOAD_TOKENS and tokens[0] == QR_PAYLOAD_PREFIX:
        try:
            page_index = int(tokens[4])
        except ValueError:
            page_index = -1
        if 0 <= page_index < page_count:
            return page_index
    return file_page_index % page_count


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
