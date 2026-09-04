"""Rectifier (C19): deteccion de fiduciales y homografia, con y sin perturbaciones."""

from __future__ import annotations

import cv2
import numpy as np

from app.geometry import point_to_px, workspace_size
from app.rectify import FiducialFailure, RectifiedPage, rectify
from tests import synthetic as syn


def test_clean_page_rectifies_to_workspace(spec: dict, clean_gray: np.ndarray) -> None:
    result = rectify(syn.to_bgr(clean_gray), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4
    width, height = workspace_size(spec)
    assert result.gray.shape == (height, width)
    assert not result.touches_border


def test_rotated_page_still_finds_four_fiducials(spec: dict, clean_gray: np.ndarray) -> None:
    rotated = syn.rotate(syn.on_canvas(clean_gray), 3)
    result = rectify(syn.to_bgr(rotated), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4


def test_perspective_page_still_finds_four_fiducials(spec: dict, clean_gray: np.ndarray) -> None:
    warped = syn.perspective(syn.on_canvas(clean_gray), 0.02, np.random.default_rng(5))
    result = rectify(syn.to_bgr(warped), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4


def test_missing_fiducial_is_a_failure(spec: dict, clean_gray: np.ndarray) -> None:
    erased = clean_gray.copy()
    erased[:80, :80] = syn.PAPER_GRAY
    result = rectify(syn.to_bgr(erased), spec)
    assert isinstance(result, FiducialFailure)
    assert result.fiducials_found == 3


def test_rectified_space_maps_bubbles_where_the_spec_says(
    spec: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    rotated = syn.rotate(syn.on_canvas(clean_gray), -4)
    result = rectify(syn.to_bgr(rotated), spec)
    assert isinstance(result, RectifiedPage)
    field = next(f for f in spec["fields"] if f["fieldId"] == "f_001")
    marked = next(b for b in field["bubbles"] if b["value"] == marks_abcd["f_001"])
    blank = next(b for b in field["bubbles"] if b["value"] != marks_abcd["f_001"])
    marked_px = point_to_px(marked["center"], result.size)
    blank_px = point_to_px(blank["center"], result.size)
    assert result.gray[marked_px[1], marked_px[0]] < 140
    assert result.gray[blank_px[1], blank_px[0]] > 180


def test_ragged_print_scan_fiducials_are_still_found(
    spec: dict, clean_gray: np.ndarray
) -> None:
    """Regresion del primer lote en papel: el gate no puede exigir un cuadrado perfecto.

    Impreso y escaneado, el fiducial pierde solidez (la tinta se desborda, el borde
    queda dentado) y sube la compacidad. En los dos primeros lotes reales la solidez
    de un cuadrado sano cayo a 0.85-0.92 y el umbral de entonces (0.88) rechazaba
    capturas nitidas. Se simula el desgaste erosionando/dilatando el borde.
    """
    kernel = np.ones((3, 3), np.uint8)
    ragged = cv2.dilate(cv2.erode(clean_gray, kernel, iterations=1), kernel, iterations=1)
    ragged = syn.blur(ragged, 1.2)
    result = rectify(syn.to_bgr(ragged), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4


def test_filled_bubble_is_never_taken_for_a_fiducial(
    spec: dict, clean_gray: np.ndarray
) -> None:
    """El falso positivo que importa: una burbuja RELLENA es un circulo, no un cuadrado.

    Colarla como fiducial corre la homografia y produce una lectura mala CON
    confianza — lo peor que puede hacer el lector. Con la esquina superior izquierda
    borrada, el candidato mas cercano pasa a ser una burbuja marcada; el gate de
    forma tiene que seguir rechazandola (solidez pi/4 y compacidad de circulo).
    """
    erased = clean_gray.copy()
    erased[:80, :80] = syn.PAPER_GRAY
    result = rectify(syn.to_bgr(erased), spec)
    assert isinstance(result, FiducialFailure)
    assert result.fiducials_found == 3


def test_a_distant_blob_is_never_crowned_as_the_missing_fiducial(
    spec: dict, clean_gray: np.ndarray
) -> None:
    """El falso positivo caro: coronar un borron lejano como si fuera la esquina.

    `_best_square` elige el cuadrado oscuro mas cercano a la esquina dentro de
    una region que abarca el 45% de la pagina. Si el fiducial verdadero falta,
    sin un tope de distancia el ganador puede estar a media hoja: se reportan 4
    fiduciales, la homografia sale deformada y la pagina se lee entera mal CON
    confianza. Se observo de verdad al aflojar el gate de forma — un borron a
    836 px se llevo la corona y cambio 3 respuestas ya decididas.

    Se borra el fiducial inferior izquierdo y se pinta un cuadrado impecable
    lejos de esa esquina: la pagina tiene que quedar en 3 fiduciales, no en 4.
    """
    tampered = clean_gray.copy()
    height, width = tampered.shape
    tampered[height - 80 :, :80] = syn.PAPER_GRAY
    decoy_y, decoy_x = round(height * 0.62), round(width * 0.12)
    cv2.rectangle(tampered, (decoy_x, decoy_y), (decoy_x + 30, decoy_y + 30), syn.INK_GRAY, -1)

    result = rectify(syn.to_bgr(tampered), spec)
    assert isinstance(result, FiducialFailure)
    assert result.fiducials_found == 3


def test_washed_out_fiducial_is_found_when_it_is_dark_for_its_paper(
    spec: dict, clean_gray: np.ndarray
) -> None:
    """Un escaner que lava una esquina no puede costar la hoja.

    Se verifico en papel: los 4 cuadrados estaban igual de negros, y aun asi el
    escaner devolvio los de la fila inferior con interior 125.7 y 182.6 sobre un
    papel de 255. El limite era absoluto (110), asi que se rechazaban por claros
    pese a estar perfectamente formados — el de 125.7 tenia compacidad 18.1, de
    las mejores del lote.

    El criterio correcto es el mismo que ya usa el clasificador de marcas: oscuro
    RESPECTO DE SU PAPEL. Aca se desvanece la esquina superior izquierda hasta un
    gris que supera el limite absoluto viejo pero sigue siendo oscuro para su
    propio papel.
    """
    washed = clean_gray.copy().astype(np.float32)
    box = washed[:300, :300]
    washed[:300, :300] = 255.0 - (255.0 - box) * 0.6
    faded = washed.astype(np.uint8)

    corner = faded[:300, :300]
    assert float(corner.min()) > 110.0, "el fiducial tiene que quedar sobre el limite viejo"

    result = rectify(syn.to_bgr(faded), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4


def _add_sensor_noise(page: np.ndarray, sigma: float, seed: int = 5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noisy = page.astype(np.int16) + rng.normal(0, sigma, page.shape)
    return np.clip(noisy, 0, 255).astype(np.uint8)


def test_high_resolution_capture_keeps_its_four_fiducials(spec: dict) -> None:
    """Una foto grande ahueca el fiducial, y el ruido de adentro no lo puede costar.

    `adaptiveThreshold` usa un `blockSize` fijo en PIXELES (51): cuanto mas
    grande sale el cuadrado en la captura, mas de su interior queda sobre la
    media local y mas se ahueca. El ruido del sensor dentro de ese hueco forma
    contornos, o sea NIETOS en la jerarquia RETR_TREE, y el filtro anti-QR —que
    descartaba cualquier candidato con nieto— empezaba a rechazar fiduciales
    verdaderos. Se vio en una foto real de 2339x3308: el detector encontraba 1
    de 4 esquinas siendo que los cuadrados eran impecables (solidez 0.92-0.95,
    compacidad 16.7-17.8).

    Aca se reproduce el mecanismo: la misma hoja a 2339 px de ancho con ruido de
    sensor. Con el criterio viejo salian 2 de 4.
    """
    page = _add_sensor_noise(syn.render_page(spec, 0, page_width=2339), 16)
    result = rectify(syn.to_bgr(page), spec)
    assert isinstance(result, RectifiedPage)
    assert result.fiducials_found == 4


def test_a_qr_finder_pattern_is_never_crowned_as_the_missing_fiducial(
    spec: dict, clean_gray: np.ndarray
) -> None:
    """La proteccion que no se puede perder al aflojar el criterio del nieto.

    Un finder pattern del QR es un cuadrado oscuro que pasa TODOS los otros
    gates —forma, tamano, oscuridad— y solo se distingue por su estructura
    anillo-hueco-centro. Coronarlo como fiducial corre la homografia y produce
    una lectura mala CON confianza, el unico error que el MVP no admite.

    Se borra el fiducial inferior izquierdo y se pinta un finder pattern
    (7x7 modulos, centro solido de 3x3) junto a esa esquina. Sin el filtro la
    pagina reporta 4 fiduciales; tiene que quedarse en 3.
    """
    scale = 4
    tampered = clean_gray.copy()
    height, _ = tampered.shape
    tampered[height - 80 :, :80] = syn.PAPER_GRAY
    x0, y0 = 20, height - 20 - 7 * scale
    tampered[y0 : y0 + 7 * scale, x0 : x0 + 7 * scale] = syn.INK_GRAY
    tampered[y0 + scale : y0 + 6 * scale, x0 + scale : x0 + 6 * scale] = syn.PAPER_GRAY
    tampered[y0 + 2 * scale : y0 + 5 * scale, x0 + 2 * scale : x0 + 5 * scale] = syn.INK_GRAY

    result = rectify(syn.to_bgr(tampered), spec)
    assert isinstance(result, FiducialFailure)
    assert result.fiducials_found == 3
