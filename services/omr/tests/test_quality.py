"""QualityGate (C20): una captura mala se rechaza ANTES de leerse."""

from __future__ import annotations

import numpy as np

from app.pipeline import process_page
from app.quality import sharpness_score
from app.rectify import RectifiedPage, rectify
from tests import synthetic as syn


def test_clean_page_is_sharp(clean_result: dict) -> None:
    assert clean_result["quality"]["ok"] is True
    assert clean_result["quality"]["rejectReason"] is None
    assert clean_result["quality"]["sharpness"] > 0.5


def test_blurred_page_rejected_as_blurry(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    blurred = syn.blur(clean_gray, 2.5)
    page = process_page(syn.to_bgr(blurred), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "blurry"
    assert page["quality"]["sharpness"] < 0.2
    assert page["marks"] == []
    assert page["pageThumbJpegBase64"] is not None


def test_sharpness_separates_clean_from_blurred(spec: dict, clean_gray: np.ndarray) -> None:
    clean_rectified = rectify(syn.to_bgr(clean_gray), spec)
    blurred_rectified = rectify(syn.to_bgr(syn.blur(clean_gray, 2.5)), spec)
    assert isinstance(clean_rectified, RectifiedPage)
    assert isinstance(blurred_rectified, RectifiedPage)
    assert sharpness_score(clean_rectified.gray) > 0.5
    assert sharpness_score(blurred_rectified.gray) < 0.2


def test_glare_spot_rejected_as_glare(spec: dict, clean_gray: np.ndarray, profile: dict) -> None:
    shiny = syn.glare_spot(clean_gray, (0.5, 0.5), 0.3)
    page = process_page(syn.to_bgr(shiny), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "glare"
    assert page["quality"]["glare"] > profile["maxGlare"]
    assert page["marks"] == []


def test_fiducial_glued_to_border_rejected_as_cropped(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    cropped = clean_gray[35:, 35:]
    page = process_page(syn.to_bgr(cropped), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "cropped"


def test_three_fiducials_recovered_when_the_qr_confirms_the_reconstruction(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    """Con 3 esquinas se cierra el paralelogramo, pero solo si el QR lo confirma.

    Un fiducial que el recorte del escaner se comio no tiene por que costar la
    pagina entera: la 4a esquina se estima desde las otras 3. La reconstruccion
    se acepta unicamente porque el QR sigue decodificando desde la region que
    dice el spec — si la esquina estimada estuviera corrida, la homografia se
    corre con ella y el QR no cae ahi.
    """
    erased = clean_gray.copy()
    erased[:80, :80] = syn.PAPER_GRAY
    page = process_page(syn.to_bgr(erased), 0, spec, profile)
    assert page["quality"]["ok"] is True
    assert page["quality"]["rejectReason"] is None
    assert page["quality"]["fiducialsFound"] == 3
    assert page["identity"]["raw"] is not None
    assert page["marks"] != []


def test_three_fiducials_rejected_when_the_qr_cannot_confirm_it(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    """Sin QR que confirme, la reconstruccion se descarta y la pagina se rechaza.

    Es la mitad que importa de la recuperacion: recuperar una hoja mas nunca
    puede costar una lectura incorrecta hecha con confianza. Se borra el
    fiducial Y el QR.
    """
    erased = clean_gray.copy()
    erased[:80, :80] = syn.PAPER_GRAY
    height, width = erased.shape
    rows = slice(round(height * 0.08), round(height * 0.18))
    cols = slice(round(width * 0.60), round(width * 0.88))
    erased[rows, cols] = syn.PAPER_GRAY
    page = process_page(syn.to_bgr(erased), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "fiducials_missing"
    assert page["quality"]["fiducialsFound"] == 3
    assert page["marks"] == []
    assert page["pageThumbJpegBase64"] is not None


def test_corner_eaten_by_the_scanner_crop_says_cropped_not_fiducials_missing(
    spec: dict, clean_gray: np.ndarray, profile: dict
) -> None:
    """El motivo tiene que decirle al usuario QUE hacer, no solo que fallo.

    `cropped` y `fiducials_missing` significan lo mismo para el rectificador —no
    hay 4 esquinas— pero piden acciones opuestas: reescanear sin auto-recorte, o
    revisar que la hoja sea de esta tirada. Antes los dos salian como
    `fiducials_missing`: `cropped` estaba en el enum pero era inalcanzable justo
    cuando el recorte era la causa, porque `touches_border` solo mira los
    fiduciales que SI se encontraron.

    Se simula el auto-recorte del escaner partiendo al medio el fiducial
    superior izquierdo: queda tinta oscura pegada al borde de la captura, que es
    la firma del recorte.
    """
    half_eaten = clean_gray[:, 50:].copy()
    page = process_page(syn.to_bgr(half_eaten), 0, spec, profile)
    assert page["quality"]["ok"] is False
    assert page["quality"]["fiducialsFound"] < 4
    assert page["quality"]["rejectReason"] == "cropped"
    assert page["marks"] == []
