"""Ensambla el pipeline: PageSource -> Rectifier -> QualityGate -> FieldReader.

imageSha256 = sha256 de los bytes del PNG canonico de la pagina rasterizada,
ANTES de rectificar (cv2.imencode('.png', bgr)): identifica la captura tal
como entro, para la idempotencia D13/CD-3.

pageThumbJpegBase64 (~400 px de ancho, sobre la captura original) SOLO cuando
quality.ok es false o identity.raw es null (CD-1).

Tiempo limite por pagina: OMR_PAGE_TIMEOUT_S (default 20 s). Una pagina que lo
excede se OMITE del resultado y se loggea (el enum de rejectReason no tiene un
motivo honesto para timeout); si TODAS las paginas exceden, `AllPagesTimedOut`
=> 504.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Any

import cv2
import numpy as np

from .classify import page_threshold
from .identity import peek_logical_page_index, read_identity
from .quality import assess
from .readers import READERS
from .rectify import RectifiedPage, rectify
from .sources import Fetch, build_page_source, fetch_url

logger = logging.getLogger("omr.pipeline")

PAGE_THUMB_WIDTH_PX = 400


class AllPagesTimedOut(Exception):
    def __init__(self, page_count: int) -> None:
        super().__init__(f"Las {page_count} paginas excedieron el tiempo limite")


def page_timeout_s() -> float:
    return float(os.environ.get("OMR_PAGE_TIMEOUT_S", "20"))


def read_scan(request: dict[str, Any], fetch: Fetch | None = None) -> dict[str, Any]:
    source = build_page_source(request["source"], fetch if fetch is not None else fetch_url)
    spec = request["layoutSpec"]
    profile = request["captureProfile"]
    timeout = page_timeout_s()

    pages: list[dict[str, Any]] = []
    timed_out = 0
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        for page_index, bgr in source.pages():
            future = executor.submit(process_page, bgr, page_index, spec, profile)
            try:
                pages.append(future.result(timeout=timeout))
            except FutureTimeoutError:
                timed_out += 1
                executor.shutdown(wait=False, cancel_futures=True)
                executor = ThreadPoolExecutor(max_workers=1)
                logger.warning(
                    "Pagina %d omitida: excedio el tiempo limite de %.1fs", page_index, timeout
                )
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    if timed_out and not pages:
        raise AllPagesTimedOut(timed_out)
    return {"pages": pages}


def process_page(
    bgr: np.ndarray, page_index: int, spec: dict[str, Any], profile: dict[str, Any]
) -> dict[str, Any]:
    image_sha256 = _canonical_png_sha256(bgr)
    original_gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    rectified = rectify(bgr, spec)
    quality = assess(original_gray, rectified, profile)

    identity = read_identity(
        rectified if isinstance(rectified, RectifiedPage) else None, original_gray, spec
    )

    marks: list[dict[str, Any]] = []
    if quality["ok"] and isinstance(rectified, RectifiedPage):
        marks = _read_marks(rectified, spec, identity, page_index, quality)

    needs_thumb = not quality["ok"] or identity["raw"] is None
    return {
        "pageIndex": page_index,
        "imageSha256": image_sha256,
        "quality": quality,
        "identity": identity,
        "marks": marks,
        "pageThumbJpegBase64": _thumb_base64(original_gray) if needs_thumb else None,
    }


def _read_marks(
    rectified: RectifiedPage,
    spec: dict[str, Any],
    identity: dict[str, Any],
    file_page_index: int,
    quality: dict[str, Any],
) -> list[dict[str, Any]]:
    logical_page = peek_logical_page_index(identity["raw"], file_page_index, spec["pageCount"])
    readable = [
        field
        for field in spec["fields"]
        if field["pageIndex"] == logical_page and field["kind"] in READERS
    ]
    if not readable:
        _reject_page(quality, "no_separable_marks")
        return []

    fills_by_field = [
        READERS[field["kind"]].sample_fills(rectified, field) for field in readable
    ]
    all_fills = [fill for fills in fills_by_field for fill in fills]
    threshold = page_threshold(all_fills)
    if not threshold.separable:
        _reject_page(quality, "no_separable_marks")
        return []

    return [
        READERS[field["kind"]].read(rectified, field, fills, threshold.threshold)
        for field, fills in zip(readable, fills_by_field, strict=True)
    ]


def _reject_page(quality: dict[str, Any], reason: str) -> None:
    quality["ok"] = False
    quality["rejectReason"] = reason


def _canonical_png_sha256(bgr: np.ndarray) -> str:
    ok, encoded = cv2.imencode(".png", bgr)
    if not ok:
        raise RuntimeError("No se pudo codificar el PNG canonico")
    return hashlib.sha256(encoded.tobytes()).hexdigest()


def _thumb_base64(gray: np.ndarray, *, width_px: int = PAGE_THUMB_WIDTH_PX) -> str:
    scale = width_px / max(1, gray.shape[1])
    resized = cv2.resize(
        gray, (width_px, max(1, round(gray.shape[0] * scale))), interpolation=cv2.INTER_AREA
    )
    ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise RuntimeError("No se pudo codificar el thumb JPEG")
    return base64.b64encode(encoded.tobytes()).decode("ascii")
