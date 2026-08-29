"""Lectura de QR (T6): identidad = payload crudo + confianza, sin interpretarlo."""

from __future__ import annotations

import numpy as np

from app.identity import peek_logical_page_index
from app.pipeline import process_page
from tests import synthetic as syn


def test_qr_payload_read_verbatim_with_full_confidence(clean_result: dict) -> None:
    assert clean_result["identity"]["mode"] == "qr"
    assert clean_result["identity"]["raw"] == syn.qr_payload(0, 1)
    assert clean_result["identity"]["confidence"] == 1.0
    assert clean_result["pageThumbJpegBase64"] is None


def test_illegible_qr_still_reads_marks_and_attaches_thumb(
    spec: dict, profile: dict, marks_abcd: dict
) -> None:
    gray = syn.render_page(spec, 0, marks=marks_abcd, qr_text=None, rng=np.random.default_rng(6))
    page = process_page(syn.to_bgr(gray), 0, spec, profile)
    assert page["identity"]["raw"] is None
    assert page["identity"]["confidence"] == 0.0
    assert page["quality"]["ok"] is True
    assert len(page["marks"]) == 8
    assert page["pageThumbJpegBase64"] is not None


def test_peek_uses_the_qr_logical_page_index() -> None:
    payload = syn.qr_payload(1, 2)
    assert peek_logical_page_index(payload, file_page_index=6, page_count=2) == 1


def test_peek_falls_back_to_file_position_when_qr_missing() -> None:
    assert peek_logical_page_index(None, file_page_index=5, page_count=2) == 1
    assert peek_logical_page_index(None, file_page_index=4, page_count=2) == 0


def test_peek_ignores_malformed_or_out_of_range_payloads() -> None:
    assert peek_logical_page_index("otra:cosa", file_page_index=3, page_count=2) == 1
    assert peek_logical_page_index("academos:v1:a:b:no:2", file_page_index=0, page_count=2) == 0
    assert peek_logical_page_index(syn.qr_payload(7, 8), file_page_index=0, page_count=2) == 0
