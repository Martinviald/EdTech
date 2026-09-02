"""Orientacion (B2/T5): hoja escaneada de lado o invertida.

Si la primera pasada no se confirma (QR ilegible desde su region), se prueban
las 4 rotaciones y se acepta la que el QR decodifica o la que confirma la
firma de la grilla (test_grid_confirmation.py): los fiduciales solos no
distinguen orientaciones. Una hoja jamas se lee con una correspondencia
equivocada — la rotacion sin QR ahora se lee, pero estos tests verifican que
se lee CORRECTA."""

from __future__ import annotations

import hashlib

import cv2
import numpy as np
import pytest

from app.pipeline import process_page
from tests import synthetic as syn

ROTATION_CODES = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


@pytest.mark.parametrize("degrees", [90, 180, 270])
def test_rotated_sheet_is_reoriented_and_read_correctly(
    spec: dict, profile: dict, clean_gray: np.ndarray, marks_abcd: dict, degrees: int
) -> None:
    rotated = cv2.rotate(clean_gray, ROTATION_CODES[degrees])
    page = process_page(syn.to_bgr(rotated), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] == syn.qr_payload(0, 1)
    by_number = {mark["printedNumber"]: mark for mark in page["marks"]}
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
    assert by_number["8"]["state"] == "blank"


def test_image_sha256_is_of_the_capture_as_it_entered_not_the_reoriented(
    spec: dict, profile: dict, clean_gray: np.ndarray
) -> None:
    rotated = cv2.rotate(clean_gray, cv2.ROTATE_180)
    page = process_page(syn.to_bgr(rotated), 0, spec, profile)

    ok, encoded = cv2.imencode(".png", syn.to_bgr(rotated))
    assert ok
    assert page["imageSha256"] == hashlib.sha256(encoded.tobytes()).hexdigest()


@pytest.mark.parametrize("degrees", [90, 180])
def test_rotated_sheet_without_readable_qr_reads_with_the_correct_mapping(
    spec: dict, profile: dict, marks_abcd: dict, degrees: int
) -> None:
    no_qr = syn.render_page(
        spec, 0, marks=marks_abcd, qr_text=None, rng=np.random.default_rng(42)
    )
    rotated = cv2.rotate(no_qr, ROTATION_CODES[degrees])
    page = process_page(syn.to_bgr(rotated), 0, spec, profile)

    assert page["quality"]["ok"] is True
    assert page["identity"]["raw"] is None
    by_number = {mark["printedNumber"]: mark for mark in page["marks"]}
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
