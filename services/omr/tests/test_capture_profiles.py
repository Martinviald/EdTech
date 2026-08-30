"""Perfiles de captura (B2/T3): la MISMA imagen degradada produce veredictos
coherentes con la tolerancia de cada perfil (D2: los umbrales son datos).

DEFAULT_CAPTURE_PROFILES copiado LITERAL del contrato
(packages/types/src/schemas/omr-layout.schema.ts). Si el contrato cambia,
este test debe fallar."""

from __future__ import annotations

import numpy as np

from app.pipeline import process_page
from tests import synthetic as syn

DEFAULT_CAPTURE_PROFILES = {
    "scanner": {
        "source": "scanner",
        "normalizeIllumination": False,
        "minSharpness": 0.45,
        "maxGlare": 0.35,
        "expectedDpi": 300,
    },
    "phone": {
        "source": "phone",
        "normalizeIllumination": True,
        "minSharpness": 0.35,
        "maxGlare": 0.25,
        "expectedDpi": None,
    },
}


def test_blur_between_profile_tolerances_splits_the_verdict(
    spec: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    blurred = syn.blur(clean_gray, 0.7)

    scanner_page = process_page(
        syn.to_bgr(blurred), 0, spec, dict(DEFAULT_CAPTURE_PROFILES["scanner"])
    )
    phone_page = process_page(
        syn.to_bgr(blurred), 0, spec, dict(DEFAULT_CAPTURE_PROFILES["phone"])
    )

    sharpness = scanner_page["quality"]["sharpness"]
    assert DEFAULT_CAPTURE_PROFILES["phone"]["minSharpness"] < sharpness
    assert sharpness < DEFAULT_CAPTURE_PROFILES["scanner"]["minSharpness"]

    assert scanner_page["quality"]["ok"] is False
    assert scanner_page["quality"]["rejectReason"] == "blurry"
    assert scanner_page["marks"] == []

    assert phone_page["quality"]["ok"] is True
    _assert_expected_marks(phone_page, marks_abcd)


def test_glare_between_profile_tolerances_splits_the_verdict(
    spec: dict, clean_gray: np.ndarray, marks_abcd: dict
) -> None:
    shiny = syn.glare_spot(clean_gray, (0.68, 0.5), 0.31)

    scanner_page = process_page(
        syn.to_bgr(shiny), 0, spec, dict(DEFAULT_CAPTURE_PROFILES["scanner"])
    )
    phone_page = process_page(
        syn.to_bgr(shiny), 0, spec, dict(DEFAULT_CAPTURE_PROFILES["phone"])
    )

    glare = phone_page["quality"]["glare"]
    assert DEFAULT_CAPTURE_PROFILES["phone"]["maxGlare"] < glare
    assert glare < DEFAULT_CAPTURE_PROFILES["scanner"]["maxGlare"]

    assert phone_page["quality"]["ok"] is False
    assert phone_page["quality"]["rejectReason"] == "glare"
    assert phone_page["marks"] == []

    assert scanner_page["quality"]["ok"] is True
    _assert_expected_marks(scanner_page, marks_abcd)


def _assert_expected_marks(page: dict, marks_abcd: dict) -> None:
    by_number = {mark["printedNumber"]: mark for mark in page["marks"]}
    for field_id, expected in marks_abcd.items():
        mark = by_number[str(int(field_id.removeprefix("f_")))]
        assert mark["state"] == "marked"
        assert mark["value"] == expected
    assert by_number["8"]["state"] == "blank"
