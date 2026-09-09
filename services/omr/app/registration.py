"""Registro local de burbujas: encontrar el anillo impreso antes de muestrear el fill.

La homografia de los 4 fiduciales deja cada burbuja a varios pixeles de donde el spec
dice que esta. Medido sobre 9 fotos reales de telefono (goldset/real, ver
goldset/README-registro.md): mediana 6-8 px, 15 px en la peor, con gradiente suave de
arriba a abajo (lente y papel no plano) mas un sesgo consistente que nace en la
captura — el PDF rasterizado da 0 px, asi que impresor y spec coinciden. El anillo
mide 17.6 px de radio y el disco de muestreo 14 px: con 5 px de error el anillo negro
entra al disco (las vacias suben), con 15 px la mitad del disco queda fuera de la marca
(las marcadas bajan). Eso, y no la letra ni el criterio, era el origen de las lecturas
`blank` confiadas sobre marcas reales y de la cola de revision del lote demo.

Lo que hace este modulo es lo que hace toda la industria antes de leer una marca:
localizar la burbuja en la imagen (timing marks por fila en los lectores de escaner,
posicionamiento por marcas de esquina en AMC, correlacion con plantilla en Loke 2018,
realineado local en la patente US 6,741,738). Aca el objetivo es conocido y facil: un
anillo negro de radio conocido, a menos de un radio de donde se lo espera.

    fix = correlacion normalizada (TM_CCORR_NORMED con mascara anular) entre la imagen
          invertida y una plantilla de anillo del mismo radio, buscada en una ventana
          acotada W alrededor de la posicion del spec

Tres reglas hacen que fallar sea seguro:

1. `W = min(0.9 R, 0.4 * distancia minima entre burbujas del grupo)`: engancharse al
   anillo vecino es geometricamente imposible (en el layout de 22 preguntas: R 17.6,
   distancia 80 -> W 16; en la grilla RUT: R 14, distancia 22 -> W 8). Un ajuste que
   cae en el BORDE de la ventana esta recortado (la foto del 2026-09-05 dio 17.7 px
   con W 16: 3 de 88 burbujas saturadas, fill 0.94 en vez de 1.0); para esos se hace
   una segunda pasada centrada en lo que predice la recta del grupo, solo donde 2W
   mas la mascara siguen sin tocar al vecino (`second_pass_allowed`; en la grilla
   RUT no corre).
2. Consistencia por grupo, LINEAL: dentro de un campo el desplazamiento no es constante
   sino un gradiente suave a lo largo de la fila (medido en diego-1624, pregunta 5:
   A -13, B -10, C -7, D -5 px; lo mismo en todas las hojas), porque lo que queda tras la
   homografia es distorsion de lente y papel, no una traslacion. Los ajustes confiables
   (`score >= SCORE_MIN`) se resumen con una recta robusta (Theil-Sen: mediana de las
   pendientes entre pares) sobre el eje en que el grupo se extiende; una burbuja cuyo
   ajuste se aparta mas de `GROUP_TOLERANCE_PX` de esa recta (marca gruesa que tapa el
   anillo, trazo suelto) hereda el valor de la recta en vez de irse sola. Una mediana
   constante NO sirve: con tolerancia 3 px dejaba a la columna A 4-5 px corta y el
   anillo volvia a entrar al disco (piso p95 0.28-0.33 en 4 de 9 hojas).
3. Sin ajuste confiable en todo el grupo, se muestrea donde dice el spec: exactamente lo
   que hacia el motor hasta hoy (`source == "spec"`, contado como fallback en el debug).

Calibracion medida (tools/measure_registration.py, que puntua la plantilla tanto
sobre cada anillo como sobre papel sin anillo a la derecha de cada fila):

    anillo real, burbuja vacia (648)                min 0.677   p1 0.737
    anillo real, burbuja marcada (144)              min 0.695   p1 0.713
    papel real, 792 posiciones en 9 fotos           max 0.586   p99 0.584
    anillo sintetico limpio (phone/scanner)         min 0.69 (marcadas) - 0.79 (vacias)
    anillo sintetico con marca sucia (dirty)        min 0.57: la marca tapa el anillo y
                                                    ESA burbuja debe heredar del grupo
    papel sintetico                                 max 0.544
    SCORE_MIN 0.63                                  a 0.045 del peor anillo real y a
                                                    0.045 del papel real; el 0.70
                                                    anterior tocaba el anillo (3 vacias
                                                    y 1 marcada reales por debajo)
    fallback (grupo entero sin anillo confiable)    0 % en 13 fotos reales y 48 sinteticas
    ajuste crudo vs localizador independiente       < 1 px en las 9 fotos
    pendiente del gradiente dentro de una fila      0.02-0.04 px/px (MAX_SLOPE 0.10)
    residuo contra un localizador independiente     ver tools/measure_registration.py

La firma de grilla (`pipeline._grid_signature_fraction`) y `_refine_accepted` NO usan
este modulo: la firma es la prueba de que la homografia es la correcta, y una busqueda
local que la "ayudara" dejaria de probarlo. El registro corrige el residuo de una
homografia ya confirmada, nunca la elige.

Interruptor: `OMR_LOCAL_REGISTRATION`. Encendido por defecto desde la fase 6 del plan
(validado en las fases 1-5 con el interruptor explicito: corte real con verdad 121/29/4
-> 150/4/0, demo 44/44, sintetico sin regresion). `OMR_LOCAL_REGISTRATION=0` es el
apagado de emergencia mientras dure la observacion en produccion; despues se retira.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

import cv2
import numpy as np

from .geometry import point_to_px, radius_to_px
from .rectify import RectifiedPage

ENV_FLAG = "OMR_LOCAL_REGISTRATION"
DEFAULT_ENABLED = True

SCORE_MIN = 0.63
FALLBACK_MAX_RATIO = 0.25
GROUP_TOLERANCE_PX = 3
MAX_SLOPE = 0.10
RING_WIDTH_PX = 2.6
TEMPLATE_BLUR_SIGMA = 0.8
TEMPLATE_PAD_PX = 4
MASK_INNER_RATIO = 0.72
MASK_OUTER_RATIO = 1.35
WINDOW_RADIUS_RATIO = 0.9
WINDOW_SPACING_RATIO = 0.4
WINDOW_MIN_PX = 2

SOURCE_OWN = "own"
SOURCE_GROUP = "group"
SOURCE_SPEC = "spec"


@dataclass(frozen=True)
class RingFix:
    dx: int
    dy: int
    score: float
    source: str
    saturated: bool = False

    @property
    def fallback(self) -> bool:
        return self.source == SOURCE_SPEC

    @property
    def offset_px(self) -> float:
        return math.hypot(self.dx, self.dy)


def local_registration_enabled() -> bool:
    raw = os.environ.get(ENV_FLAG)
    if raw is None:
        return DEFAULT_ENABLED
    return raw.strip().lower() in ("1", "true", "yes", "on")


_TEMPLATES: dict[int, tuple[np.ndarray, np.ndarray, int]] = {}


def ring_template(radius_px: int) -> tuple[np.ndarray, np.ndarray, int]:
    """Plantilla de anillo (imagen invertida: anillo brillante) y su mascara anular."""
    cached = _TEMPLATES.get(radius_px)
    if cached is not None:
        return cached
    half = int(round(radius_px * MASK_OUTER_RATIO)) + TEMPLATE_PAD_PX
    side = 2 * half + 1
    yy, xx = np.mgrid[:side, :side]
    distance = np.hypot(xx - half, yy - half)
    template = np.zeros((side, side), np.float32)
    template[np.abs(distance - radius_px) <= RING_WIDTH_PX / 2] = 255.0
    template = cv2.GaussianBlur(template, (0, 0), TEMPLATE_BLUR_SIGMA)
    mask = (
        (distance >= radius_px * MASK_INNER_RATIO) & (distance <= radius_px * MASK_OUTER_RATIO)
    ).astype(np.float32)
    _TEMPLATES[radius_px] = (template, mask, half)
    return template, mask, half


def locate_ring(
    gray: np.ndarray, center_px: tuple[int, int], radius_px: int, window_px: int
) -> tuple[int, int, float]:
    """Desplazamiento (dx, dy) del anillo respecto de `center_px` y score de la correlacion.

    Si la ventana se sale de la imagen (burbuja cerca del borde del marco fiducial),
    lo que falta se rellena con papel: el anillo que si esta adentro se correlaciona
    igual, con un score algo menor. Una burbuja con el centro fuera de la imagen no
    tiene evidencia y devuelve (0, 0, 0.0).
    """
    template, mask, half = ring_template(radius_px)
    reach = half + window_px
    height, width = gray.shape
    if not (0 <= center_px[0] < width and 0 <= center_px[1] < height):
        return 0, 0, 0.0
    x0, y0 = center_px[0] - reach, center_px[1] - reach
    x1, y1 = center_px[0] + reach + 1, center_px[1] + reach + 1
    inside = gray[max(0, y0) : min(height, y1), max(0, x0) : min(width, x1)]
    patch = cv2.copyMakeBorder(
        inside,
        max(0, -y0),
        max(0, y1 - height),
        max(0, -x0),
        max(0, x1 - width),
        cv2.BORDER_CONSTANT,
        value=int(np.median(inside)),
    )
    inverted = (255 - patch).astype(np.float32)
    response = cv2.matchTemplate(inverted, template, cv2.TM_CCORR_NORMED, mask=mask)
    _, best, _, location = cv2.minMaxLoc(response)
    return int(location[0] + half - reach), int(location[1] + half - reach), float(best)


def min_spacing_px(centers_px: list[tuple[int, int]], radius_px: int) -> float:
    if len(centers_px) > 1:
        return min(
            math.hypot(a[0] - b[0], a[1] - b[1])
            for index, a in enumerate(centers_px)
            for b in centers_px[index + 1 :]
        )
    return 4.0 * radius_px


def search_window_px(centers_px: list[tuple[int, int]], radius_px: int) -> int:
    spacing = min_spacing_px(centers_px, radius_px)
    window = min(
        math.floor(WINDOW_RADIUS_RATIO * radius_px), math.floor(WINDOW_SPACING_RATIO * spacing)
    )
    return max(WINDOW_MIN_PX, int(window))


def second_pass_allowed(spacing_px: float, window_px: int, radius_px: int) -> bool:
    """La segunda pasada llega hasta 2W: solo si ni asi la mascara toca el anillo vecino.

    Primera pasada centrada en el spec (alcance W), segunda centrada en lo que
    predice la recta del grupo (otro W): en total 2W mas el radio exterior de la
    mascara tienen que quedar antes del borde interior del anillo vecino
    (`spacing - R`). En el layout de preguntas (R 17.6, distancia 80) sobra; en
    la grilla RUT (R 14, distancia 22) no, y ahi la segunda pasada no corre.
    """
    return 2 * window_px + MASK_OUTER_RATIO * radius_px < spacing_px - radius_px


def _saturated(fix: tuple[int, int, float], window_px: int) -> bool:
    return abs(fix[0]) >= window_px or abs(fix[1]) >= window_px


def register_group(page: RectifiedPage, bubbles: list[dict]) -> list[RingFix]:
    """Un RingFix por burbuja del grupo (un campo, o una columna de la grilla RUT)."""
    if not bubbles:
        return []
    centers = [point_to_px(bubble["center"], page.size) for bubble in bubbles]
    radius_px = radius_to_px(bubbles[0]["radius"], page.size)
    spacing = min_spacing_px(centers, radius_px)
    window = search_window_px(centers, radius_px)
    raw = [locate_ring(page.gray, center, radius_px, window) for center in centers]
    positions = _group_axis_positions(centers)
    saturated = [index for index, fix in enumerate(raw) if _saturated(fix, window)]
    confident = [index for index, (_, _, score) in enumerate(raw) if score >= SCORE_MIN]
    if second_pass_allowed(spacing, window, radius_px):
        if not confident:
            raw = [locate_ring(page.gray, center, radius_px, 2 * window) for center in centers]
            saturated = [index for index, fix in enumerate(raw) if _saturated(fix, window)]
        elif saturated:
            raw = _second_pass(page, centers, positions, radius_px, window, raw, saturated)
        confident = [index for index, (_, _, score) in enumerate(raw) if score >= SCORE_MIN]
    if not confident:
        return [RingFix(0, 0, score, SOURCE_SPEC) for _, _, score in raw]
    line_dx, line_dy = _fit_lines(positions, raw, confident)
    fixes = []
    for index, (position, (dx, dy, score)) in enumerate(zip(positions, raw, strict=True)):
        expected_dx = line_dx[0] + line_dx[1] * position
        expected_dy = line_dy[0] + line_dy[1] * position
        was_saturated = index in saturated
        own = (
            score >= SCORE_MIN
            and abs(dx - expected_dx) <= GROUP_TOLERANCE_PX
            and abs(dy - expected_dy) <= GROUP_TOLERANCE_PX
        )
        if own:
            fixes.append(RingFix(dx, dy, score, SOURCE_OWN, was_saturated))
        else:
            fixes.append(
                RingFix(
                    int(round(expected_dx)),
                    int(round(expected_dy)),
                    score,
                    SOURCE_GROUP,
                    was_saturated,
                )
            )
    return fixes


def _second_pass(
    page: RectifiedPage,
    centers: list[tuple[int, int]],
    positions: list[float],
    radius_px: int,
    window: int,
    raw: list[tuple[int, int, float]],
    saturated: list[int],
) -> list[tuple[int, int, float]]:
    """Vuelve a buscar los ajustes recortados en el borde de la ventana, centrado mas alla.

    Corre cuando PARTE del grupo es confiable: el ancla de cada busqueda es lo que
    predice la recta del grupo. El caso en que ninguna burbuja es confiable (corrimiento
    grande y parejo: en sintetico, con anillos finos, la primera pasada ni siquiera llega
    al borde, el pico cae en el spec con score de papel) lo cubre la pasada ancha de
    `register_group` (ventana 2W desde el spec), con la misma garantia geometrica.
    """
    confident = [index for index, (_, _, score) in enumerate(raw) if score >= SCORE_MIN]
    lines = _fit_lines(positions, raw, confident) if confident else None
    updated = list(raw)
    for index in saturated:
        if lines is not None:
            anchor_dx = int(round(lines[0][0] + lines[0][1] * positions[index]))
            anchor_dy = int(round(lines[1][0] + lines[1][1] * positions[index]))
        else:
            anchor_dx, anchor_dy, _ = raw[index]
        anchor = (centers[index][0] + anchor_dx, centers[index][1] + anchor_dy)
        dx2, dy2, score2 = locate_ring(page.gray, anchor, radius_px, window)
        if score2 >= SCORE_MIN:
            updated[index] = (anchor_dx + dx2, anchor_dy + dy2, score2)
    return updated


def _fit_lines(
    positions: list[float], raw: list[tuple[int, int, float]], confident: list[int]
) -> tuple[tuple[float, float], tuple[float, float]]:
    line_dx = robust_line([(positions[i], raw[i][0]) for i in confident])
    line_dy = robust_line([(positions[i], raw[i][1]) for i in confident])
    return line_dx, line_dy


def _group_axis_positions(centers: list[tuple[int, int]]) -> list[float]:
    """Coordenada de cada burbuja sobre el eje en que el grupo se extiende (fila o columna)."""
    xs = [center[0] for center in centers]
    ys = [center[1] for center in centers]
    axis = xs if (max(xs) - min(xs)) >= (max(ys) - min(ys)) else ys
    origin = axis[0]
    return [float(value - origin) for value in axis]


def robust_line(points: list[tuple[float, float]]) -> tuple[float, float]:
    """(intercepto, pendiente) por Theil-Sen; tolera un atipico entre cuatro puntos.

    Con un solo punto la recta es constante. La pendiente se acota a MAX_SLOPE: un
    gradiente real de lente vale 0.02-0.04 px/px, y una pendiente mayor solo puede
    salir de dos ajustes muy juntos con error — en ese caso vale mas una constante.
    """
    if len(points) == 1:
        return points[0][1], 0.0
    slopes = [
        (vb - va) / (pb - pa)
        for index, (pa, va) in enumerate(points)
        for pb, vb in points[index + 1 :]
        if abs(pb - pa) >= 1.0
    ]
    slope = float(np.median(slopes)) if slopes else 0.0
    if abs(slope) > MAX_SLOPE:
        slope = 0.0
    intercept = float(np.median([value - slope * position for position, value in points]))
    return intercept, slope


def fallback_ratio(fixes: list[RingFix]) -> float:
    if not fixes:
        return 0.0
    return sum(1 for fix in fixes if fix.fallback) / len(fixes)


def unregistrable(fixes: list[RingFix]) -> bool:
    """La captura no se puede registrar: demasiadas burbujas sin anillo confiable.

    Con el registro activo, muestrear en la posicion del spec es volver al modo
    de falla que el registro vino a cerrar (disco fuera de la burbuja, lecturas
    confiadas y mal). Una burbuja suelta que hereda o cae al spec es normal
    (marca gruesa, trazo); una PAGINA con mas de FALLBACK_MAX_RATIO de sus
    burbujas al spec es una captura que no se deja registrar (desenfoque,
    layout distinto) y pide otra foto, no una lectura silenciosa. Medido:
    fotos reales 0 %; sinteticas con marcas sucias hasta 8 % de una hoja.
    """
    return fallback_ratio(fixes) > FALLBACK_MAX_RATIO


def summarize(fixes: list[RingFix], enabled: bool) -> dict:
    """Resumen por pagina para el payload de debug (no es contrato)."""
    if not fixes:
        return {"enabled": enabled, "bubbles": 0}
    offsets = np.array([fix.offset_px for fix in fixes])
    scores = np.array([fix.score for fix in fixes])
    return {
        "enabled": enabled,
        "bubbles": len(fixes),
        "offMedianPx": round(float(np.median(offsets)), 2),
        "offP90Px": round(float(np.percentile(offsets, 90)), 2),
        "offMaxPx": round(float(offsets.max()), 2),
        "scoreP10": round(float(np.percentile(scores, 10)), 3),
        "fallbackCount": int(sum(1 for fix in fixes if fix.fallback)),
        "inheritedCount": int(sum(1 for fix in fixes if fix.source == SOURCE_GROUP)),
        "saturatedCount": int(sum(1 for fix in fixes if fix.saturated)),
    }
