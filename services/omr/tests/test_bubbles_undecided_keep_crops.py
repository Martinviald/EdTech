"""Un problema de las burbujas no tira los recortes de la pagina.

Una pagina geometricamente valida (fiduciales y QR bien) cuyas burbujas no se
pueden separar (`likely_blank` o `unreadable`) se rechazaba entera con
`no_separable_marks` y `marks: []`: los recortes de sus campos `crop_region`, que
no dependen de las burbujas, se perdian. Pasaba con la pagina 1 de la prueba
sintetica de respuestas abiertas, que tiene UNA pregunta de alternativas (4
burbujas) y 8 campos de recorte.

Contrato, sin campos nuevos: si la pagina tiene campos de recorte, `quality.ok`
queda en true, `quality.marksReadability` dice que paso con las burbujas, cada
campo de burbujas sale `ambiguous` con su evidencia (a revision, nunca `blank`
confiado) y los recortes salen como siempre. Una pagina SOLO de burbujas se
sigue rechazando: ahi no hay nada que rescatar y repetir la foto es lo correcto.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from app.classify import MARKS_LIKELY_BLANK, MARKS_READABLE
from app.contracts import validate
from app.pipeline import _should_retry_flattened, assess_page, process_page
from tests import synthetic as syn


@pytest.fixture(scope="module")
def mixed_spec() -> dict:
    spec = syn.make_layout_spec(fields_per_page=1)
    spec["fields"].append(
        syn.make_crop_region_field("f_dev", "2", top_left=(0.1, 0.4), bottom_right=(0.9, 0.6))
    )
    spec["fields"][1]["response"] = {"cropProfileId": "short-answer@1"}
    return spec


@pytest.fixture(scope="module")
def unanswered_bgr(mixed_spec: dict) -> np.ndarray:
    return syn.to_bgr(syn.render_page(mixed_spec, 0, rng=np.random.default_rng(7)))


def by_field(page: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {mark["fieldId"]: mark for mark in page["marks"]}


def test_unseparable_bubbles_keep_the_crops(
    mixed_spec: dict, unanswered_bgr: np.ndarray, profile: dict
) -> None:
    page = process_page(unanswered_bgr, 0, mixed_spec, profile)

    assert page["quality"]["ok"] is True, page["quality"]
    assert page["quality"]["rejectReason"] is None
    assert page["quality"]["marksReadability"] == MARKS_LIKELY_BLANK
    marks = by_field(page)
    assert set(marks) == {"f_001", "f_dev"}
    assert marks["f_dev"]["state"] == "marked"
    assert marks["f_dev"]["crop"]["cropProfileId"] == "short-answer@1"
    assert validate("scan-result", {"pages": [page]}) == []


def test_unseparable_bubbles_go_to_review_never_blank(
    mixed_spec: dict, unanswered_bgr: np.ndarray, profile: dict
) -> None:
    page = process_page(unanswered_bgr, 0, mixed_spec, profile)

    bubble = by_field(page)["f_001"]
    assert bubble["state"] == "ambiguous"
    assert bubble["value"] is None
    assert bubble["cropJpegBase64"]
    assert bubble["suggestedValue"] is None


def test_the_phone_gate_agrees_with_the_batch(
    mixed_spec: dict, unanswered_bgr: np.ndarray, profile: dict
) -> None:
    gate = assess_page(unanswered_bgr, mixed_spec, profile)
    batch = process_page(unanswered_bgr, 0, mixed_spec, profile)

    assert gate["quality"]["ok"] is batch["quality"]["ok"] is True
    assert gate["quality"]["marksReadability"] == batch["quality"]["marksReadability"]


def test_answered_bubble_is_still_read_next_to_the_crops(mixed_spec: dict, profile: dict) -> None:
    gray = syn.render_page(mixed_spec, 0, marks={"f_001": "B"}, rng=np.random.default_rng(8))

    page = process_page(syn.to_bgr(gray), 0, mixed_spec, profile)

    assert page["quality"]["marksReadability"] == MARKS_READABLE
    bubble = by_field(page)["f_001"]
    assert (bubble["state"], bubble["value"]) == ("marked", "B")


def test_page_with_only_bubbles_is_still_rejected(profile: dict) -> None:
    spec = syn.make_layout_spec(fields_per_page=1)
    gray = syn.render_page(spec, 0, rng=np.random.default_rng(9))

    page = process_page(syn.to_bgr(gray), 0, spec, profile)

    assert page["quality"]["ok"] is False
    assert page["quality"]["rejectReason"] == "no_separable_marks"
    assert page["marks"] == []


@pytest.mark.parametrize(
    ("readability", "normalize", "expected"),
    [
        ("likely_blank", True, True),
        ("unreadable", True, True),
        ("readable", True, False),
        ("likely_blank", False, False),
    ],
)
def test_undecided_bubbles_also_try_the_flattened_retry(
    readability: str, normalize: bool, expected: bool
) -> None:
    page = {"quality": {"ok": True, "rejectReason": None, "marksReadability": readability}}

    assert _should_retry_flattened(page, {"normalizeIllumination": normalize}) is expected
