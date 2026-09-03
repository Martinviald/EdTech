"""Ensambla el pipeline: PageSource -> Rectifier -> QualityGate -> FieldReader.

imageSha256 = sha256 de los bytes del PNG canonico de la pagina rasterizada,
tal como entro (ANTES de rectificar y ANTES de corregir orientacion):
identifica la captura original, para la idempotencia D13/CD-3.

Orientacion y homografia (F1 de identidad robusta): la rectificacion se
confirma con una escalera de dos pruebas independientes — el QR decodificando
desde la region del spec (la via rapida y mas fuerte), o la firma de la
grilla: en una homografia correcta TODA posicion de burbuja del spec contiene
al menos su anillo impreso, en una equivocada la mayoria muestrea papel. Los
4 fiduciales solos no distinguen orientaciones (un cuadrado rotado sigue
siendo un cuadrado), asi que sin alguna de las dos pruebas jamas se acepta
una rotacion ni una esquina reconstruida. Si la primera pasada no se
confirma, se prueban las rotaciones 90/180/270 y despues las rectificaciones
leave-one-out (falso fiducial: una mancha cuadrada gana una esquina y corre
la homografia con 4/4 detectados — capturado en papel real, captura N2).

M1/CD-15: en specs rut_bubbles la orientacion se confirma con el QR de esquina
(cuadrante superior derecho) o con la firma de la grilla — la grilla RUT del
propio spec es parte de la firma. Si ninguna orientacion se confirma, la
pagina se rechaza por calidad (no_separable_marks) SIN leer identidad ni
clasificar marcas: una grilla RUT leida con la correspondencia equivocada
matchearia al alumno incorrecto con confianza. Con firma confirmada y QR de
esquina ilegible la pagina SI se lee (qrRaw null): el modo pensado para no
depender del QR ya no depende del QR.

Reintento con iluminacion aplanada: una pagina rechazada por
`no_separable_marks` se vuelve a leer COMPLETA sobre la captura con el
gradiente de luz quitado (app/illumination.py), y el segundo resultado se
conserva solo si queda legible. Es un reintento y no un preproceso del camino
feliz a proposito: una hoja que hoy se lee bien no cambia de ruta. Se activa
con `normalizeIllumination` del CaptureProfile (true en `phone`, false en
`scanner`). Queda registrado en `quality.illuminationFlattened`.

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

assess_page (CD-11): subset de process_page para POST /v1/assess —
rectificacion + QualityGate + identidad (QR o grilla RUT), SIN clasificar
marcas. Presupuesto <1s por imagen.
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

from .classify import AMBIGUITY_MARGIN, PageThreshold, page_threshold
from .identity import (
    decode_corner_qr,
    decode_region_qr,
    peek_logical_page_index,
    read_identity,
)
from .illumination import flatten_illumination
from .quality import assess
from .readers import READERS, sample_bubble_fills
from .rectify import (
    FiducialFailure,
    RectifiedPage,
    leave_one_out_rectifications,
    rectify,
    refine_reconstruction,
    widened_rectification,
)
from .sources import Fetch, build_page_source, fetch_url

logger = logging.getLogger("omr.pipeline")

PAGE_THUMB_WIDTH_PX = 400
FILL_HISTOGRAM_BINS = 10
GRID_SIGNATURE_FILL_FLOOR = 0.08
GRID_SIGNATURE_MIN_FRACTION = 0.9
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
    """Lee la pagina y, si se rechazo por `no_separable_marks`, la reintenta aplanada.

    El reintento es un segundo pase COMPLETO sobre la captura con el gradiente
    de iluminacion quitado (ver app/illumination.py): re-rectifica, vuelve a
    confirmar la homografia y reclasifica. Va aca y no dentro de `_read_marks`
    porque la causa medida esta antes de clasificar — en la deteccion de
    fiduciales — y porque asi cubre los DOS puntos que emiten ese motivo (el de
    `_read_marks` y el veredicto de orientacion) sin duplicar nada.

    El resultado aplanado solo se conserva si la pagina termina LEGIBLE. Un
    rechazo sigue siendo un rechazo: el reintento nunca convierte un motivo en
    otro ni relaja el gate, que corre igual sobre el segundo pase.

    `imageSha256` se conserva el de la captura ORIGINAL: identifica lo que
    entro, y es la pieza de la idempotencia D13/CD-3. El aplanado es un detalle
    interno de como se leyo, no otra captura.
    """
    page, debug = _classify_once(bgr, page_index, spec, profile, flattened=False)
    if not _should_retry_flattened(page, profile):
        return page, debug

    retry_page, retry_debug = _classify_once(
        flatten_illumination(bgr), page_index, spec, profile, flattened=True
    )
    if not retry_page["quality"]["ok"]:
        return page, debug
    retry_page["imageSha256"] = page["imageSha256"]
    return retry_page, retry_debug


def _should_retry_flattened(page: dict[str, Any], profile: dict[str, Any]) -> bool:
    """Solo una pagina rechazada por marcas no separables, y solo si el perfil lo pide.

    `normalizeIllumination` ya existia en el CaptureProfile (D2: los umbrales de
    captura son datos, no codigo) y esto es exactamente lo que nombraba. El
    perfil `phone` lo trae en true y el `scanner` en false: un escaneo plano no
    tiene gradiente que aplanar, y no paga el costo.
    """
    return page["quality"]["rejectReason"] == "no_separable_marks" and bool(
        profile.get("normalizeIllumination", False)
    )


def _classify_once(
    bgr: np.ndarray,
    page_index: int,
    spec: dict[str, Any],
    profile: dict[str, Any],
    *,
    flattened: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    timings_ms: dict[str, float] = {}
    started = time.perf_counter()
    image_sha256 = _canonical_png_sha256(bgr)

    with _stage(timings_ms, "rectify"):
        oriented_bgr, rectified, orientation_degrees, orientation_confirmed = _rectify_oriented(
            bgr, spec, page_index
        )
    oriented_gray = cv2.cvtColor(oriented_bgr, cv2.COLOR_BGR2GRAY)

    with _stage(timings_ms, "quality"):
        quality = assess(oriented_gray, rectified, profile)
    quality["illuminationFlattened"] = flattened
    _apply_orientation_verdict(quality, spec, orientation_confirmed)

    with _stage(timings_ms, "identity"):
        identity = read_identity(
            _identity_rectified(rectified, spec, orientation_confirmed),
            oriented_gray,
            spec,
            _ambiguity_margin(profile),
        )

    marks: list[dict[str, Any]] = []
    classify_debug = _empty_classify_debug()
    if quality["ok"] and isinstance(rectified, RectifiedPage):
        with _stage(timings_ms, "classify"):
            marks, classify_debug = _read_marks(
                rectified, spec, identity, page_index, quality, _ambiguity_margin(profile)
            )

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
        "illuminationFlattened": flattened,
        "fiducialRescue": _rescue_evidence(rectified),
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


def assess_page(
    bgr: np.ndarray, spec: dict[str, Any], profile: dict[str, Any]
) -> dict[str, Any]:
    image_sha256 = _canonical_png_sha256(bgr)
    oriented_bgr, rectified, _, orientation_confirmed = _rectify_oriented(bgr, spec, 0)
    oriented_gray = cv2.cvtColor(oriented_bgr, cv2.COLOR_BGR2GRAY)
    quality = assess(oriented_gray, rectified, profile)
    _apply_orientation_verdict(quality, spec, orientation_confirmed)
    identity = read_identity(
        _identity_rectified(rectified, spec, orientation_confirmed),
        oriented_gray,
        spec,
        _ambiguity_margin(profile),
    )
    return {"imageSha256": image_sha256, "quality": quality, "identity": identity}


def _rectify_oriented(
    bgr: np.ndarray, spec: dict[str, Any], file_page_index: int
) -> tuple[np.ndarray, RectifiedPage | FiducialFailure, int, bool]:
    logical_page = file_page_index % spec["pageCount"]
    confirmable = spec["identity"]["mode"] in ("qr", "rut_bubbles")
    first = rectify(bgr, spec, allow_reconstruction=confirmable)
    if first.fiducials_found < 4:
        rescued = _rescue_with_wide_radius(bgr, spec, logical_page)
        if rescued is not None:
            return bgr, rescued, 0, True
    if _homography_confirmed(first, spec, logical_page):
        return bgr, _refine_accepted(bgr, spec, first, logical_page), 0, True
    if not confirmable:
        return bgr, first, 0, True
    for degrees, rotation_code in ORIENTATION_ROTATIONS:
        rotated = cv2.rotate(bgr, rotation_code)
        candidate = rectify(rotated, spec, allow_reconstruction=True)
        if candidate.fiducials_found < 4:
            rescued = _rescue_with_wide_radius(rotated, spec, logical_page)
            if rescued is not None:
                return rotated, rescued, degrees, True
        if _homography_confirmed(candidate, spec, logical_page):
            return rotated, _refine_accepted(rotated, spec, candidate, logical_page), degrees, True
    for candidate in leave_one_out_rectifications(bgr, spec):
        if _homography_confirmed(candidate, spec, logical_page):
            return bgr, _refine_accepted(bgr, spec, candidate, logical_page), 0, True
    return bgr, _discard_unconfirmed_reconstruction(bgr, spec, first), 0, False


def _rescue_evidence(rectified: RectifiedPage | FiducialFailure) -> list[int] | None:
    """Que esquinas se recuperaron con radio ampliado, para poder auditarlo despues.

    Va en el payload de debug y no en `quality`, que es contrato cerrado
    (`additionalProperties: false` en scan-result.schema.json) y cambiarlo
    arrastraria al backend. None cuando la pagina no paso por este camino, que
    es el caso normal.
    """
    if not isinstance(rectified, RectifiedPage) or not rectified.widened_corners:
        return None
    return list(rectified.widened_corners)


def _rescue_with_wide_radius(
    bgr: np.ndarray, spec: dict[str, Any], logical_page: int
) -> RectifiedPage | None:
    """Recupera una pagina a la que el tope de distancia le corto fiduciales VERDADEROS.

    Una hoja fotografiada de lado, o que no llena el encuadre, aleja sus
    esquinas de las de la imagen y `MAX_CORNER_DISTANCE_FRACTION` descarta
    cuadrados legitimos. Medido sobre 19 fotos reales: la foto de lado perdia
    una esquina por 61 px, y 5 de 7 fotos de una hoja en blanco encontraban
    solo 2 de 4. Con 2 fiduciales no hay siquiera paralelogramo que cerrar, asi
    que el reintento ampliado es la unica via.

    El gate es `_grid_signature_confirmed` y NO `_homography_confirmed`, y esa
    distincion es todo el punto. Medido sobre la foto de lado:

                                         QR decodifica   firma de grilla
        paralelogramo, 3 fiduciales           si               NO
        4 fiduciales reales (radio ampliado)  si               si

    El QR tolera una homografia torcida — salia con confianza 1.0 mientras las
    burbujas no calzaban y la pagina moria en `no_separable_marks`. Aceptar por
    QR una rectificacion de radio ampliado seria aceptar justo lo que no
    distingue los dos casos. La firma si los separa, y es el mismo validador
    independiente que ya contiene el riesgo de coronar una mancha.

    Corre solo cuando la busqueda estricta encontro menos de 4, asi que el
    camino feliz no paga nada.
    """
    candidate = widened_rectification(bgr, spec)
    if candidate is None:
        return None
    if not _grid_signature_confirmed(candidate, spec, logical_page):
        return None
    return candidate


def _refine_accepted(
    bgr: np.ndarray,
    spec: dict[str, Any],
    rectified: RectifiedPage | FiducialFailure,
    logical_page: int,
) -> RectifiedPage | FiducialFailure:
    """Una esquina reconstruida ya confirmada se afina antes de leer marcas.

    La confirmacion prueba que la homografia es LA correcta (la firma o el QR
    calzan); el afinado corrige cuanto se corrio la estimacion del paralelogramo
    dentro del tope topologico de refine_reconstruction. El puntaje es la brecha
    de separacion de la propia pagina: mas brecha = burbujas mejor centradas,
    jamas un mapeo distinto. Si el resultado afinado dejara de confirmar, se
    conserva el original.
    """
    if not isinstance(rectified, RectifiedPage) or rectified.reconstructed_corner is None:
        return rectified
    bubbles = _spec_bubbles(spec, logical_page)
    if not bubbles:
        return rectified

    def separation_gap(page: RectifiedPage) -> float:
        return page_threshold(sample_bubble_fills(page, bubbles)).gap

    refined = refine_reconstruction(
        bgr, spec, rectified.reconstructed_corner, separation_gap
    )
    if refined is None or not _homography_confirmed(refined, spec, logical_page):
        return rectified
    return refined


def _discard_unconfirmed_reconstruction(
    bgr: np.ndarray, spec: dict[str, Any], rectified: RectifiedPage | FiducialFailure
) -> RectifiedPage | FiducialFailure:
    """Una reconstruccion que nada confirmo vuelve a ser un fallo de fiduciales.

    Reconstruir la 4a esquina recupera paginas que antes se perdian, pero solo
    vale si algo independiente confirma que la homografia quedo bien: el QR
    decodificando desde la region del spec, o la firma de la grilla. Si ninguna
    de las dos pruebas paso en ninguna orientacion, la pagina se rechaza como
    antes: cero lecturas incorrectas confiadas manda sobre recuperar una hoja
    mas.
    """
    if not isinstance(rectified, RectifiedPage) or not rectified.reconstructed:
        return rectified
    return rectify(bgr, spec)


def _homography_confirmed(
    rectified: RectifiedPage | FiducialFailure, spec: dict[str, Any], logical_page: int
) -> bool:
    if not isinstance(rectified, RectifiedPage):
        return False
    mode = spec["identity"]["mode"]
    if mode == "qr" and decode_region_qr(rectified, spec) is not None:
        return True
    if mode == "rut_bubbles" and decode_corner_qr(rectified) is not None:
        return True
    if mode not in ("qr", "rut_bubbles"):
        return True
    return _grid_signature_confirmed(rectified, spec, logical_page)


def _grid_signature_confirmed(
    rectified: RectifiedPage, spec: dict[str, Any], logical_page: int
) -> bool:
    """El spec "calza": cada posicion de burbuja contiene al menos su anillo.

    Fraccion de burbujas del spec (campos de la pagina logica + grilla de
    identidad) con fill sobre el piso. Distribucion medida con piso 0.08
    (instrumental: tools/measure_grid_signature.py) sobre las capturas reales
    archivadas (una impresora, cuatro cadenas de escaneo) y las hojas
    sinteticas de la suite, incluida la grilla RUT cuyos anillos finos rinden
    fills de 0.10-0.15:

        homografia correcta    1.000            (8 capturas legibles reales con
                                                 2 esquinas reconstruidas, + 3
                                                 sinteticas: qr, rut, rut blanca)
        rotada 90/180/270      max 0.491        (33 rectificaciones reales + 9
                                                 sinteticas)
        falso fiducial (N2)    0.456
        leave-one-out malo     0.175 - 0.632    (esquina equivocada de N2)

    El corte en 0.9 deja 0.27 de margen contra la peor homografia equivocada
    medida y 0.10 contra la peor correcta. Con piso 0.12 la grilla RUT
    sintetica caia a 0.85 (por eso 0.08); con 0.05 las equivocadas suben sin
    ganar nada en las correctas.

    La pagina logica para elegir los campos sale del orden del archivo — la
    misma regla que usa _read_marks cuando el QR no esta. Una captura tipo
    CamScanner que lava los anillos da firma baja: por eso la firma es el
    fallback y el QR la via primaria, nunca al reves.
    """
    bubbles = _spec_bubbles(spec, logical_page)
    if not bubbles:
        return False
    fills = sample_bubble_fills(rectified, bubbles)
    over = sum(1 for fill in fills if fill > GRID_SIGNATURE_FILL_FLOOR)
    return over / len(fills) >= GRID_SIGNATURE_MIN_FRACTION


def _spec_bubbles(spec: dict[str, Any], logical_page: int) -> list[dict[str, Any]]:
    bubbles: list[dict[str, Any]] = []
    for field in spec["fields"]:
        if field["pageIndex"] == logical_page:
            bubbles.extend(field.get("bubbles") or [])
    identity_bubbles = spec["identity"].get("bubbles")
    if identity_bubbles:
        bubbles.extend(identity_bubbles)
    return bubbles


def _apply_orientation_verdict(
    quality: dict[str, Any], spec: dict[str, Any], orientation_confirmed: bool
) -> None:
    if spec["identity"]["mode"] != "rut_bubbles" or orientation_confirmed:
        return
    if quality["ok"]:
        _reject_page(quality, "no_separable_marks")


def _identity_rectified(
    rectified: RectifiedPage | FiducialFailure,
    spec: dict[str, Any],
    orientation_confirmed: bool,
) -> RectifiedPage | None:
    if not isinstance(rectified, RectifiedPage):
        return None
    if spec["identity"]["mode"] == "rut_bubbles" and not orientation_confirmed:
        return None
    return rectified


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


def _ambiguity_margin(profile: dict[str, Any]) -> float:
    margin = profile.get("ambiguityMargin")
    return AMBIGUITY_MARGIN if margin is None else float(margin)


def _read_marks(
    rectified: RectifiedPage,
    spec: dict[str, Any],
    identity: dict[str, Any],
    file_page_index: int,
    quality: dict[str, Any],
    ambiguity_margin: float,
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
    if not all_fills:
        marks = [
            READERS[field["kind"]].read(
                rectified, field, fills, PageThreshold(threshold=0.5, separable=False),
                ambiguity_margin,
            )
            for field, fills in zip(readable, fills_by_field, strict=True)
        ]
        return marks, _empty_classify_debug()

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
        READERS[field["kind"]].read(rectified, field, fills, threshold, ambiguity_margin)
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
