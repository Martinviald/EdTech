"""Identidad rut_bubbles (CD-10): misma regla de oro que digit_grid.

Un RUT con un digito inventado matchea al alumno equivocado en silencio, asi
que cualquier grupo dudoso, doble o vacio => identidad no detectada (raw None,
confidence 0). El servicio NO valida DV ni interpreta: eso es del backend.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.contracts import validate
from app.pipeline import process_page
from tests import synthetic as syn

RUT = "12345678K"
BUBBLE_MARKS = {"f_001": "A", "f_002": "C", "f_003": "B", "f_004": "D"}


@pytest.fixture(scope="module")
def rut_spec() -> dict:
    spec = syn.make_layout_spec(fields_per_page=4)
    spec["identity"] = syn.make_rut_identity()
    return spec


def read_rut_page(rut_spec: dict, profile: dict, **render_kwargs) -> dict:
    gray = syn.render_page(
        rut_spec, 0, marks=dict(BUBBLE_MARKS), rng=np.random.default_rng(15), **render_kwargs
    )
    return process_page(syn.to_bgr(gray), 0, rut_spec, profile)


def test_full_rut_with_k_is_read_verbatim(rut_spec: dict, profile: dict) -> None:
    page = read_rut_page(rut_spec, profile, identity_marks=syn.rut_marks(RUT))

    assert page["identity"]["mode"] == "rut_bubbles"
    assert page["identity"]["raw"] == RUT
    assert 0.0 < page["identity"]["confidence"] <= 1.0
    assert page["quality"]["ok"] is True
    marked = {m["fieldId"]: m["value"] for m in page["marks"] if m["state"] == "marked"}
    assert marked == BUBBLE_MARKS
    assert validate("scan-result", {"pages": [page]}) == []


def test_double_marked_rut_group_yields_undetected_identity(
    rut_spec: dict, profile: dict
) -> None:
    doubled = {**syn.rut_marks(RUT), 3: ["4", "9"]}
    page = read_rut_page(rut_spec, profile, identity_marks=doubled)

    assert page["identity"]["raw"] is None
    assert page["identity"]["confidence"] == 0.0
    assert page["quality"]["ok"] is True
    assert page["pageThumbJpegBase64"] is not None


def test_blank_rut_group_yields_undetected_identity(rut_spec: dict, profile: dict) -> None:
    missing_group = {g: v for g, v in syn.rut_marks(RUT).items() if g != 5}
    page = read_rut_page(rut_spec, profile, identity_marks=missing_group)

    assert page["identity"]["raw"] is None
    assert page["identity"]["confidence"] == 0.0


def test_partially_filled_rut_digit_yields_undetected_identity(
    rut_spec: dict, profile: dict
) -> None:
    page = read_rut_page(
        rut_spec,
        profile,
        identity_marks=syn.rut_marks(RUT),
        coverage={"identity:2:3": 0.5},
    )

    assert page["identity"]["raw"] is None
    assert page["identity"]["confidence"] == 0.0


def test_completely_blank_rut_grid_yields_undetected_identity(
    rut_spec: dict, profile: dict
) -> None:
    page = read_rut_page(rut_spec, profile, identity_marks=None)

    assert page["identity"]["raw"] is None
    assert page["identity"]["confidence"] == 0.0


def test_unrectifiable_page_yields_undetected_identity(rut_spec: dict, profile: dict) -> None:
    featureless = np.full((1600, 1240), 235, dtype=np.uint8)
    page = process_page(syn.to_bgr(featureless), 0, rut_spec, profile)

    assert page["quality"]["rejectReason"] == "fiducials_missing"
    assert page["identity"]["mode"] == "rut_bubbles"
    assert page["identity"]["raw"] is None
    assert page["identity"]["confidence"] == 0.0


def test_rut_sheet_carries_corner_qr_in_qr_raw(rut_spec: dict, profile: dict) -> None:
    page = read_rut_page(rut_spec, profile, identity_marks=syn.rut_marks(RUT))

    assert page["identity"]["qrRaw"] == syn.qr_payload(0, 1)
    assert page["identity"]["raw"] == RUT
    assert page["quality"]["ok"] is True
    assert validate("scan-result", {"pages": [page]}) == []


def test_upside_down_rut_sheet_is_reoriented_by_corner_qr(
    rut_spec: dict, profile: dict
) -> None:
    gray = syn.render_page(
        rut_spec,
        0,
        marks=dict(BUBBLE_MARKS),
        identity_marks=syn.rut_marks(RUT),
        rng=np.random.default_rng(15),
    )
    rotated = cv2.rotate(gray, cv2.ROTATE_180)
    page = process_page(syn.to_bgr(rotated), 0, rut_spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["qrRaw"] == syn.qr_payload(0, 1)
    assert page["identity"]["raw"] == RUT
    marked = {m["fieldId"]: m["value"] for m in page["marks"] if m["state"] == "marked"}
    assert marked == BUBBLE_MARKS


def test_rut_sheet_without_corner_qr_is_read_and_resolved_by_bubbles(
    rut_spec: dict, profile: dict
) -> None:
    """Regresion F1: el modo pensado para no depender del QR dependia del QR.

    Antes del arreglo, un QR de esquina ilegible rechazaba la pagina entera
    (no_separable_marks) aunque la grilla RUT y las marcas fueran legibles. La
    orientacion la confirma ahora la firma de la grilla; el QR queda como via
    rapida. Verificado contra el codigo sin el arreglo: ahi este test falla con
    quality.ok False.
    """
    page = read_rut_page(
        rut_spec, profile, identity_marks=syn.rut_marks(RUT), qr_text=None
    )

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] == RUT
    assert page["identity"]["qrRaw"] is None
    marked = {m["fieldId"]: m["value"] for m in page["marks"] if m["state"] == "marked"}
    assert marked == BUBBLE_MARKS


def test_upside_down_rut_sheet_without_corner_qr_is_reoriented_by_grid(
    rut_spec: dict, profile: dict
) -> None:
    gray = syn.render_page(
        rut_spec,
        0,
        marks=dict(BUBBLE_MARKS),
        identity_marks=syn.rut_marks(RUT),
        qr_text=None,
        rng=np.random.default_rng(15),
    )
    rotated = cv2.rotate(gray, cv2.ROTATE_180)
    page = process_page(syn.to_bgr(rotated), 0, rut_spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] == RUT
    assert page["identity"]["qrRaw"] is None
    marked = {m["fieldId"]: m["value"] for m in page["marks"] if m["state"] == "marked"}
    assert marked == BUBBLE_MARKS
