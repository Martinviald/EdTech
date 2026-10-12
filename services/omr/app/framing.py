"""Encuadre de la hoja dentro de una foto de celular (C19, reintento del perfil `phone`).

El rectificador busca cada fiducial cerca de la esquina de la IMAGEN, con un tope
de distancia (`MAX_CORNER_DISTANCE_FRACTION`, 0.22 del lado menor; 0.35 en la
busqueda por firma) que existe por una buena razon: sin el, un borron lejano
gana la esquina y la pagina se lee entera mal con confianza (ver rectify.py).

Ese tope presupone que la hoja llena el cuadro, y en una foto de celular eso no
pasa: la captura web sube la foto tal cual, con mesa, ropa y piso alrededor. En
las 6 fotos reales del 2026-10-12 (2268x4032, la hoja ocupando ~60 % del cuadro)
los fiduciales verdaderos quedaban entre 0.26 y 0.39 del lado menor, y la tela a
cuadros pegada al borde de abajo aportaba cuadrados oscuros MAS cerca de la
esquina que el fiducial: 5 de 6 paginas salian `cropped` sin que les faltara
nada.

La correccion no afloja el tope: mueve la referencia. Se localiza la hoja (el
blob claro mas grande, separado del fondo por Otsu), se recorta su rectangulo
envolvente con un margen y el rectificador corre de nuevo sobre ese recorte,
con TODOS sus gates intactos. Dentro del recorte los fiduciales vuelven a estar
a ~0.05-0.10 de la esquina, como en un escaneo. Medido sobre las 6 fotos: 4/4
fiduciales en el recorte en todas, a resolucion nativa y a la de la app.

El recorte es una CANDIDATA, igual que las demas rectificaciones de rescate: el
pipeline solo la acepta si los 4 fiduciales forman un cuadrilatero coherente con
la hoja (`fiducial_quad_consistent` en rectify.py) y, cuando la pagina tiene
burbujas, si la firma de la grilla la confirma.
"""

from __future__ import annotations

import cv2
import numpy as np

FRAMING_WORK_WIDTH = 600
FRAMING_OPEN_FRACTION = 0.02
FRAMING_MIN_SHEET_FRACTION = 0.2
FRAMING_PAD_FRACTION = 0.03
FRAMING_MAX_KEPT_AREA = 0.95


def frame_sheet(bgr: np.ndarray) -> np.ndarray | None:
    """Recorte de la foto al rectangulo de la hoja (con margen), o None si no aporta.

    None cuando no aparece un blob claro que pueda ser la hoja (menos del 20 % del
    cuadro) o cuando el recorte conservaria casi toda la imagen: en ese caso la
    hoja ya llenaba el cuadro y reintentar daria el mismo resultado.
    """
    height, width = bgr.shape[:2]
    box = _sheet_box(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
    if box is None:
        return None
    x0, y0, x1, y1 = box
    if (x1 - x0) * (y1 - y0) >= FRAMING_MAX_KEPT_AREA * width * height:
        return None
    return np.ascontiguousarray(bgr[y0:y1, x0:x1])


def _sheet_box(gray: np.ndarray) -> tuple[int, int, int, int] | None:
    height, width = gray.shape
    scale = FRAMING_WORK_WIDTH / width
    small = cv2.resize(
        gray, (FRAMING_WORK_WIDTH, max(1, round(height * scale))), interpolation=cv2.INTER_AREA
    )
    small = cv2.GaussianBlur(small, (5, 5), 0)
    _, bright = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = max(3, round(FRAMING_OPEN_FRACTION * FRAMING_WORK_WIDTH))
    bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, np.ones((kernel, kernel), np.uint8))
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    sheet = max(contours, key=cv2.contourArea)
    if cv2.contourArea(sheet) < FRAMING_MIN_SHEET_FRACTION * bright.size:
        return None
    x, y, box_w, box_h = cv2.boundingRect(sheet)
    pad = FRAMING_PAD_FRACTION * box_w
    return (
        max(0, round((x - pad) / scale)),
        max(0, round((y - pad) / scale)),
        min(width, round((x + box_w + pad) / scale)),
        min(height, round((y + box_h + pad) / scale)),
    )
