"""Rectifier (C19): detecta los 4 fiduciales y rectifica por homografia.

Corre SIEMPRE, incluso en un escaneo plano donde la homografia sale
casi-identidad (D2): un solo camino de codigo. Menos de 4 fiduciales =>
`FiducialFailure`, que el QualityGate traduce a `fiducials_missing`.

La busqueda es por cuadrante de esquina: en cada uno se buscan contornos
cuadrados y OSCUROS en el gris original. Un finder pattern del QR se descarta
por su estructura anillo-hueco-centro (nieto en la jerarquia RETR_TREE); un
fiducial ahuecado por el threshold adaptativo (cuadrado grande y solido: el
interior queda sobre la media local) solo tiene un hueco vacio, sin nieto, y
se acepta. Se elige el candidato cuya esquina exterior queda mas cerca de la
esquina de la imagen. La homografia mapea los CENTROIDES de los
cuadrados (CD-5: el marco fiducial son los centros); la esquina exterior solo
se usa para elegir candidato y detectar recorte.

El gate de forma se calibro contra hojas sinteticas, donde el cuadrado sale
perfecto, y en papel real rechazaba capturas limpias. Se miden dos cosas:

    solidez     = area / area de su minAreaRect   (1.00 cuadrado, 0.79 circulo)
    compacidad  = perimetro^2 / area              (16.0 cuadrado, 12.6 circulo)

Las dos se degradan, pero en regimenes OPUESTOS. Impreso y escaneado, la tinta
se desborda y el borde queda dentado: la solidez cae a 0.85 mientras la
compacidad sube a 17-18. Reescalado a baja resolucion pasa lo contrario: el
suavizado redondea las esquinas, la compacidad cae a 14.8 y la solidez se
mantiene en 0.98. Medido:

                         solidez        compacidad
    burbuja rellena      0.77 - 0.81    13.7 - 14.4
    fiducial 55% escala  0.98 - 0.99    14.8 - 14.9
    fiducial real        0.85 - 0.92    16.7 - 18.4   (28 esquinas, 2 lotes)

Por eso se acepta el candidato que pasa CUALQUIERA de los dos umbrales, y se
rechaza solo al que falla ambos. La burbuja rellena —el falso positivo que
importa, porque colarla arruina la homografia y produce una lectura mala con
confianza— es la unica forma que queda baja en las dos. Un umbral unico de
solidez no sirve: en 0.88 partia la poblacion real al medio (dos paginas
nitidas fallaron por 0.855 y 0.859) y bajarlo a 0.80 dejaba entrar la burbuja.

Tampoco se aprieta el epsilon de approxPolyDP, que seria lo obvio para separar
circulo de cuadrado: por debajo de 0.05 rechaza el cuadrado pixelado de una
captura de baja resolucion.

Las esquinas cortadas por el borde de la captura siguen rechazadas (0.78 de
solidez con 14.3 de compacidad, medido), que es lo que se quiere: sin las 4
esquinas no hay homografia confiable.

`MAX_CORNER_DISTANCE_FRACTION` acota DONDE puede estar un fiducial, y no es un
detalle: sin el, cuando el fiducial verdadero falta, `_best_square` elige "el
cuadrado oscuro mas cercano a la esquina" dentro de una region que abarca el
45% de la pagina, y termina coronando un borron a 800 px de distancia. Reporta
4 fiduciales, la homografia sale deformada y la pagina se lee ENTERA MAL con
confianza — el unico error que el MVP no admite. Se midio sobre 49 fiduciales
verdaderos (sinteticos a 55% y 100%, con canvas, rotados, con perspectiva, y
los reales de dos lotes impresos): todos caen entre 0.034 y 0.164 del lado
menor de la imagen. Los dos falsos positivos observados estaban a 0.239 y
0.554. El corte en 0.22 los separa.

`MAX_DARKNESS_RATIO` cierra el ultimo criterio: cuan oscuro debe ser el interior
del cuadrado, medido RESPECTO DE SU PAPEL y no en una escala absoluta. Era un
absoluto (110) y rechazaba fiduciales sanos que el escaner habia lavado: se
verifico en el papel que los 4 cuadrados estaban igual de negros, y aun asi los
de la fila inferior volvieron con interior 125.7 y 182.6 sobre papel 255. El de
125.7 estaba impecable (compacidad 18.1, de las mejores medidas) y se caia solo
por claro. Ademas el papel no siempre es blanco — su mediana local fue de 173 a
255 segun el escaner y el realce aplicado — asi que un absoluto exige cosas
distintas en cada pagina sin razon. El clasificador de marcas (C21) ya deriva su
umbral del papel de cada pagina; este era el unico criterio que no lo hacia.

Ojo al tocarlo: el tope de distancia y `CORNER_REGION_FRACTION` acotan lo mismo y
se mueven juntos. Una captura con MUCHO fondo alrededor de la hoja empuja los
fiduciales verdaderos lejos de la esquina de la imagen; si algun dia hay que
admitirla, sube el tope y revalida contra el conjunto de oro, porque aflojarlo
reabre exactamente este agujero.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from .geometry import workspace_size

CORNER_REGION_FRACTION = 0.45
MIN_SQUARE_AREA_PX = 60
MAX_SQUARE_PAGE_FRACTION = 0.01
MIN_SOLIDITY = 0.83
MIN_COMPACTNESS = 15.0
MAX_ASPECT = 1.7
MAX_DARKNESS_RATIO = 0.55
BORDER_TOUCH_PX = 2
MIN_CLIPPED_INK_AREA_PX = 200
MAX_CORNER_DISTANCE_FRACTION = 0.22


@dataclass(frozen=True)
class RectifiedPage:
    gray: np.ndarray
    size: tuple[int, int]
    fiducials_found: int
    touches_border: bool
    reconstructed: bool = False


@dataclass(frozen=True)
class FiducialFailure:
    fiducials_found: int
    touches_border: bool
    clipped_corners: int = 0


def rectify(
    page_bgr: np.ndarray, spec: dict[str, Any], *, allow_reconstruction: bool = False
) -> RectifiedPage | FiducialFailure:
    gray = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2GRAY)
    detections, clipped = _find_fiducials_with_clipping(gray)
    found = sum(1 for d in detections if d is not None)
    touches = _any_touches_border([d[1] for d in detections if d is not None], gray.shape)

    reconstructed = False
    if found == 3 and allow_reconstruction:
        detections = _complete_parallelogram(detections)
        reconstructed = True
    elif found < 4:
        return FiducialFailure(
            fiducials_found=found, touches_border=touches, clipped_corners=clipped
        )

    size = workspace_size(spec)
    width, height = size
    src = np.array([d[0] for d in detections], dtype=np.float32)
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32
    )
    homography = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(gray, homography, size, flags=cv2.INTER_LINEAR)
    return RectifiedPage(
        gray=warped,
        size=size,
        fiducials_found=found,
        touches_border=touches,
        reconstructed=reconstructed,
    )


def _complete_parallelogram(
    detections: list[tuple[tuple[float, float], tuple[float, float]] | None],
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Estima el centro del fiducial faltante cerrando el paralelogramo.

    Las esquinas van en orden TL, TR, BR, BL, asi que la que falta es la suma de
    sus dos vecinas menos la opuesta. Con perspectiva leve el error es de pocos
    pixeles; con perspectiva fuerte se corre, y por eso la reconstruccion NUNCA
    se acepta sola: el pipeline la valida decodificando el QR desde la region que
    dice el spec (misma prueba que usa para confirmar orientacion). Si la esquina
    estimada estuviera mal, la homografia se corre y el QR no cae donde deberia.
    """
    missing = next(i for i, d in enumerate(detections) if d is None)
    left = detections[(missing - 1) % 4]
    right = detections[(missing + 1) % 4]
    opposite = detections[(missing + 2) % 4]
    assert left is not None and right is not None and opposite is not None
    center = (
        left[0][0] + right[0][0] - opposite[0][0],
        left[0][1] + right[0][1] - opposite[0][1],
    )
    completed = list(detections)
    completed[missing] = (center, center)
    return [d for d in completed if d is not None]


def _find_fiducials(
    gray: np.ndarray,
) -> list[tuple[tuple[float, float], tuple[float, float]] | None]:
    detections, _ = _find_fiducials_with_clipping(gray)
    return detections


def _find_fiducials_with_clipping(
    gray: np.ndarray,
) -> tuple[list[tuple[tuple[float, float], tuple[float, float]] | None], int]:
    height, width = gray.shape
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

    detections: list[tuple[tuple[float, float], tuple[float, float]] | None] = []
    clipped = 0
    for (offset_x, offset_y), image_corner in zip(regions, image_corners, strict=True):
        crop = binary[offset_y : offset_y + region_h, offset_x : offset_x + region_w]
        gray_crop = gray[offset_y : offset_y + region_h, offset_x : offset_x + region_w]
        local_target = (image_corner[0] - offset_x, image_corner[1] - offset_y)
        max_distance = MAX_CORNER_DISTANCE_FRACTION * min(width, height)
        max_interior = darkness_limit(gray_crop)
        local = _best_square(
            crop, gray_crop, local_target, width * height, max_distance, max_interior
        )
        if local is None:
            detections.append(None)
            offset = (offset_x, offset_y)
            if _corner_looks_clipped(crop, gray_crop, offset, gray.shape, max_interior):
                clipped += 1
        else:
            (cx, cy), (ox, oy) = local
            detections.append(((cx + offset_x, cy + offset_y), (ox + offset_x, oy + offset_y)))
    return detections, clipped


def darkness_limit(gray_crop: np.ndarray) -> float:
    """Cuan oscuro tiene que ser el interior de un fiducial, RELATIVO a su papel.

    El papel no siempre es blanco: en las capturas medidas su mediana local va de
    173 a 255 segun el escaner y el realce que le haya aplicado. Un limite
    absoluto por lo tanto exige cosas distintas en cada pagina sin ninguna razon.
    El clasificador de marcas (C21) ya resuelve esto asi — su umbral sale del
    papel de cada pagina — y el detector de fiduciales era el unico que no.
    """
    return MAX_DARKNESS_RATIO * float(np.median(gray_crop))


def _corner_looks_clipped(
    binary_crop: np.ndarray,
    gray_crop: np.ndarray,
    offset: tuple[int, int],
    shape: tuple[int, ...],
    max_interior: float,
) -> bool:
    """Hay tinta oscura pegada al borde de la captura donde deberia haber un fiducial.

    Un cuadrado que el recorte del escaner partio al medio deja un trozo oscuro
    tocando el borde de la imagen: no pasa el gate de forma (deja de ser un
    cuadrado), pero su presencia distingue "la hoja venia recortada" de "aca no
    hay ningun fiducial". Sin esto, los dos casos salen como `fiducials_missing`
    y el usuario no sabe si reescanear o revisar la impresion.
    """
    height, width = shape[:2]
    offset_x, offset_y = offset
    contours, _ = cv2.findContours(binary_crop, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        if cv2.contourArea(contour) < MIN_CLIPPED_INK_AREA_PX:
            continue
        if _interior_mean(gray_crop, contour) > max_interior:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if (
            x + offset_x <= BORDER_TOUCH_PX
            or y + offset_y <= BORDER_TOUCH_PX
            or x + w + offset_x >= width - 1 - BORDER_TOUCH_PX
            or y + h + offset_y >= height - 1 - BORDER_TOUCH_PX
        ):
            return True
    return False


def _best_square(
    binary_crop: np.ndarray,
    gray_crop: np.ndarray,
    target: tuple[int, int],
    page_area: float,
    max_distance: float,
    max_interior: float,
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    contours, hierarchy = cv2.findContours(binary_crop, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return None
    hier = hierarchy[0]
    best: tuple[float, tuple[tuple[float, float], tuple[float, float]]] | None = None
    for idx, (contour, node) in enumerate(zip(contours, hier, strict=True)):
        if node[3] != -1:
            continue
        if _has_grandchild(hier, idx):
            continue
        candidate = _square_candidate(contour, page_area)
        if candidate is None:
            continue
        if _interior_mean(gray_crop, contour) > max_interior:
            continue
        outer = min(
            candidate, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2
        )
        moments = cv2.moments(contour)
        if moments["m00"] == 0:
            continue
        centroid = (moments["m10"] / moments["m00"], moments["m01"] / moments["m00"])
        distance = (outer[0] - target[0]) ** 2 + (outer[1] - target[1]) ** 2
        if distance > max_distance * max_distance:
            continue
        if best is None or distance < best[0]:
            best = (distance, (centroid, outer))
    return None if best is None else best[1]


def _has_grandchild(hier: np.ndarray, idx: int) -> bool:
    child = hier[idx][2]
    while child != -1:
        if hier[child][2] != -1:
            return True
        child = hier[child][0]
    return False


def _interior_mean(gray_crop: np.ndarray, contour: np.ndarray) -> float:
    mask = np.zeros(gray_crop.shape, dtype=np.uint8)
    cv2.drawContours(mask, [contour], -1, 255, thickness=-1)
    if not mask.any():
        return 255.0
    return float(cv2.mean(gray_crop, mask=mask)[0])


def _square_candidate(contour: np.ndarray, page_area: float) -> list[tuple[float, float]] | None:
    area = cv2.contourArea(contour)
    if area < MIN_SQUARE_AREA_PX or area > page_area * MAX_SQUARE_PAGE_FRACTION:
        return None
    perimeter = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.05 * perimeter, True)
    if len(approx) != 4 or not cv2.isContourConvex(approx):
        return None
    (_, _), (rect_w, rect_h), _ = cv2.minAreaRect(contour)
    if min(rect_w, rect_h) == 0 or max(rect_w, rect_h) / min(rect_w, rect_h) > MAX_ASPECT:
        return None
    solidity = area / (rect_w * rect_h)
    compactness = perimeter * perimeter / area
    if solidity < MIN_SOLIDITY and compactness < MIN_COMPACTNESS:
        return None
    return [(float(point[0][0]), float(point[0][1])) for point in approx]


def _any_touches_border(
    corners: list[tuple[float, float] | None], shape: tuple[int, ...]
) -> bool:
    height, width = shape[:2]
    return any(
        corner is not None
        and (
            corner[0] <= BORDER_TOUCH_PX
            or corner[1] <= BORDER_TOUCH_PX
            or corner[0] >= width - 1 - BORDER_TOUCH_PX
            or corner[1] >= height - 1 - BORDER_TOUCH_PX
        )
        for corner in corners
    )
