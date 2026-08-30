"""Ensambla el pipeline: PageSource -> Rectifier -> QualityGate -> FieldReader.

imageSha256 = sha256 de los bytes del PNG canonico de la pagina rasterizada,
tal como entro (ANTES de rectificar y ANTES de corregir orientacion):
identifica la captura original, para la idempotencia D13/CD-3.

Orientacion (hoja escaneada de lado o invertida): si la rectificacion de la
primera pasada no se confirma — menos de 4 fiduciales, o el QR no decodifica
desde su region esperada — se prueban las rotaciones 90/180/270. Una rotacion
alternativa SOLO se acepta si el QR decodifica desde la region del spec: los
4 fiduciales solos no distinguen orientaciones (un cuadrado rotado sigue
siendo un cuadrado) y aceptar una correspondencia equivocada podria leer mal
con confianza. Sin prueba, se conserva el resultado de la primera pasada.

pageThumbJpegBase64 (~400 px de ancho, sobre la captura ya orientada) SOLO
cuando quality.ok es false o identity.raw es null (CD-1).

Modo debug (T4/O4): el ScanResult NO cambia (scan-result.schema.json tiene
additionalProperties:false en todos los niveles — verificado). Las metricas
de diagnostico salen por `read_scan_debug` / `classify_page_debug`, que el
endpoint expone como `POST /v1/read?debug=1` -> { result, debug }.

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
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from contextlib import contextmanager
from typing import Any

import cv2
import numpy as np

from .classify import page_threshold
from .identity import decode_region_qr, peek_logical_page_index, read_identity
from .quality import assess
from .readers import READERS
from .rectify import FiducialFailure, RectifiedPage, rectify
from .sources import Fetch, build_page_source, fetch_url

logger = logging.getLogger("omr.pipeline")

PAGE_THUMB_WIDTH_PX = 400
FILL_HISTOGRAM_BINS = 10
MARK_STATES = ("marked", "blank", "multiple", "ambiguous")
ORIENTATION_ROTATIONS: tuple[tuple[int, int], ...] = (
    (90, cv2.ROTATE_90_CLOCKWISE),
    (180, cv2.ROTATE_180),
    (270, cv2.ROTATE_90_COUNTERCLOCKWISE),
)

PageWorker = Callable[
    [np.ndarray, int, dict[str, Any], dict[str, Any]],
    tuple[dict[str, Any], dict[str, Any] | None],
]


class AllPagesTimedOut(Exception):
    def __init__(self, page_count: int) -> None:
        super().__init__(f"Las {page_count} paginas excedieron el tiempo limite")


def page_timeout_s() -> float:
    return float(os.environ.get("OMR_PAGE_TIMEOUT_S", "20"))


def read_scan(request: dict[str, Any], fetch: Fetch | None = None) -> dict[str, Any]:
    result, _ = _read_scan(request, fetch, _page_without_debug)
    return result


def read_scan_debug(
    request: dict[str, Any], fetch: Fetch | None = None
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return _read_scan(request, fetch, classify_page_debug)


def _read_scan(
    request: dict[str, Any], fetch: Fetch | None, worker: PageWorker
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source = build_page_source(request["source"], fetch if fetch is not None else fetch_url)
    spec = request["layoutSpec"]
    profile = request["captureProfile"]
    timeout = page_timeout_s()

    pages: list[dict[str, Any]] = []
    debug_pages: list[dict[str, Any]] = []
    timed_out = 0
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        for page_index, bgr in source.pages():
            future = executor.submit(worker, bgr, page_index, spec, profile)
            try:
                page, debug = future.result(timeout=timeout)
                pages.append(page)
                if debug is not None:
                    debug_pages.append(debug)
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
    return {"pages": pages}, debug_pages


def _page_without_debug(
    bgr: np.ndarray, page_index: int, spec: dict[str, Any], profile: dict[str, Any]
) -> tuple[dict[str, Any], None]:
    return process_page(bgr, page_index, spec, profile), None


def process_page(
    bgr: np.ndarray, page_index: int, spec: dict[str, Any], profile: dict[str, Any]
) -> dict[str, Any]:
    page, _ = classify_page_debug(bgr, page_index, spec, profile)
    return page


def classify_page_debug(
    bgr: np.ndarray, page_index: int, spec: dict[str, Any], profile: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    timings_ms: dict[str, float] = {}
    started = time.perf_counter()
    image_sha256 = _canonical_png_sha256(bgr)

    with _stage(timings_ms, "rectify"):
        oriented_bgr, rectified, orientation_degrees = _rectify_oriented(bgr, spec)
    oriented_gray = cv2.cvtColor(oriented_bgr, cv2.COLOR_BGR2GRAY)

    with _stage(timings_ms, "quality"):
        quality = assess(oriented_gray, rectified, profile)

    with _stage(timings_ms, "identity"):
        identity = read_identity(
            rectified if isinstance(rectified, RectifiedPage) else None, oriented_gray, spec
        )

    marks: list[dict[str, Any]] = []
    classify_debug = _empty_classify_debug()
    if quality["ok"] and isinstance(rectified, RectifiedPage):
        with _stage(timings_ms, "classify"):
            marks, classify_debug = _read_marks(rectified, spec, identity, page_index, quality)

    needs_thumb = not quality["ok"] or identity["raw"] is None
    timings_ms["total"] = (time.perf_counter() - started) * 1000
    page = {
        "pageIndex": page_index,
        "imageSha256": image_sha256,
        "quality": quality,
        "identity": identity,
        "marks": marks,
        "pageThumbJpegBase64": _thumb_base64(oriented_gray) if needs_thumb else None,
    }
    debug = {
        "pageIndex": page_index,
        "orientationDegrees": orientation_degrees,
        "sharpness": quality["sharpness"],
        "glare": quality["glare"],
        "fiducialsFound": quality["fiducialsFound"],
        "rejectReason": quality["rejectReason"],
        "stateCounts": {
            state: sum(1 for mark in marks if mark["state"] == state) for state in MARK_STATES
        },
        "timingsMs": {stage: round(elapsed, 1) for stage, elapsed in timings_ms.items()},
        **classify_debug,
    }
    return page, debug


@contextmanager
def _stage(timings_ms: dict[str, float], name: str) -> Iterator[None]:
    started = time.perf_counter()
    try:
        yield
    finally:
        timings_ms[name] = (time.perf_counter() - started) * 1000


def _rectify_oriented(
    bgr: np.ndarray, spec: dict[str, Any]
) -> tuple[np.ndarray, RectifiedPage | FiducialFailure, int]:
    qr_mode = spec["identity"]["mode"] == "qr"
    first = rectify(bgr, spec, allow_reconstruction=qr_mode)
    if _orientation_confirmed(first, spec):
        return bgr, first, 0
    if not qr_mode:
        return bgr, first, 0
    for degrees, rotation_code in ORIENTATION_ROTATIONS:
        rotated = cv2.rotate(bgr, rotation_code)
        candidate = rectify(rotated, spec, allow_reconstruction=True)
        if isinstance(candidate, RectifiedPage) and decode_region_qr(candidate, spec):
            return rotated, candidate, degrees
    return bgr, _discard_unconfirmed_reconstruction(bgr, spec, first), 0


def _discard_unconfirmed_reconstruction(
    bgr: np.ndarray, spec: dict[str, Any], rectified: RectifiedPage | FiducialFailure
) -> RectifiedPage | FiducialFailure:
    """Una reconstruccion que el QR no confirmo vuelve a ser un fallo de fiduciales.

    Reconstruir la 4a esquina recupera paginas que antes se perdian, pero solo
    vale si algo independiente confirma que la homografia quedo bien. Esa prueba
    es el QR decodificando desde la region del spec. Si no decodifico en ninguna
    orientacion, la pagina se rechaza como antes: cero lecturas incorrectas
    confiadas manda sobre recuperar una hoja mas.
    """
    if not isinstance(rectified, RectifiedPage) or not rectified.reconstructed:
        return rectified
    return rectify(bgr, spec)


def _orientation_confirmed(
    rectified: RectifiedPage | FiducialFailure, spec: dict[str, Any]
) -> bool:
    if not isinstance(rectified, RectifiedPage):
        return False
    if spec["identity"]["mode"] != "qr":
        return True
    return decode_region_qr(rectified, spec) is not None


def _empty_classify_debug() -> dict[str, Any]:
    return {
        "fillHistogram": [0] * FILL_HISTOGRAM_BINS,
        "fillCount": 0,
        "threshold": None,
        "separable": None,
        "allMarked": None,
        "gap": None,
        "stdLow": None,
        "stdHigh": None,
    }


def _read_marks(
    rectified: RectifiedPage,
    spec: dict[str, Any],
    identity: dict[str, Any],
    file_page_index: int,
    quality: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    logical_page = peek_logical_page_index(identity["raw"], file_page_index, spec["pageCount"])
    readable = [
        field
        for field in spec["fields"]
        if field["pageIndex"] == logical_page and field["kind"] in READERS
    ]
    if not readable:
        _reject_page(quality, "no_separable_marks")
        return [], _empty_classify_debug()

    fills_by_field = [
        READERS[field["kind"]].sample_fills(rectified, field) for field in readable
    ]
    all_fills = [fill for fills in fills_by_field for fill in fills]
    threshold = page_threshold(all_fills)
    histogram, _ = np.histogram(all_fills, bins=FILL_HISTOGRAM_BINS, range=(0.0, 1.0))
    classify_debug = {
        "fillHistogram": [int(count) for count in histogram],
        "fillCount": len(all_fills),
        "threshold": round(threshold.threshold, 4),
        "separable": threshold.separable,
        "allMarked": threshold.all_marked,
        "gap": round(threshold.gap, 4),
        "stdLow": round(threshold.std_low, 4),
        "stdHigh": round(threshold.std_high, 4),
    }
    if not threshold.is_readable():
        _reject_page(quality, "no_separable_marks")
        return [], classify_debug

    marks = [
        READERS[field["kind"]].read(rectified, field, fills, threshold)
        for field, fills in zip(readable, fills_by_field, strict=True)
    ]
    return marks, classify_debug


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
