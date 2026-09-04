"""Pipeline (T7): hash canonico, reglas de evidencia inline y timeout por pagina."""

from __future__ import annotations

import hashlib
import time

import cv2
import numpy as np
import pytest

from app import pipeline
from app.pipeline import AllPagesTimedOut, process_page, read_scan
from tests import synthetic as syn


def images_request(spec: dict, urls: list[str], profile: dict) -> dict:
    return {
        "layoutSpec": spec,
        "captureProfile": profile,
        "source": {"kind": "images", "pdfUrl": None, "imageUrls": urls},
    }


def test_image_sha256_is_the_hash_of_the_canonical_png(
    spec: dict, clean_gray: np.ndarray, profile: dict, clean_result: dict
) -> None:
    ok, encoded = cv2.imencode(".png", syn.to_bgr(clean_gray))
    assert ok
    expected = hashlib.sha256(encoded.tobytes()).hexdigest()
    assert clean_result["imageSha256"] == expected


def test_thumb_absent_when_quality_ok_and_identity_present(clean_result: dict) -> None:
    assert clean_result["quality"]["ok"] is True
    assert clean_result["identity"]["raw"] is not None
    assert clean_result["pageThumbJpegBase64"] is None


def test_multipage_spec_reads_each_logical_page_from_its_qr(
    profile: dict, stub_fetch
) -> None:
    spec = syn.make_layout_spec(fields_per_page=4, page_count=2)
    page0 = syn.render_page(
        spec, 0, marks={"f_001": "A", "f_002": "C"}, rng=np.random.default_rng(10)
    )
    page1 = syn.render_page(
        spec, 1, marks={"f_005": "B", "f_007": "D"}, rng=np.random.default_rng(11)
    )
    stub_fetch({"https://x/p0.png": syn.png_bytes(page0), "https://x/p1.png": syn.png_bytes(page1)})

    result = read_scan(images_request(spec, ["https://x/p0.png", "https://x/p1.png"], profile))

    assert [page["pageIndex"] for page in result["pages"]] == [0, 1]
    first_numbers = {mark["printedNumber"] for mark in result["pages"][0]["marks"]}
    second_numbers = {mark["printedNumber"] for mark in result["pages"][1]["marks"]}
    assert first_numbers == {"1", "2", "3", "4"}
    assert second_numbers == {"5", "6", "7", "8"}
    assert result["pages"][1]["identity"]["raw"] == syn.qr_payload(1, 2)


def test_timed_out_page_is_omitted_and_the_rest_continue(
    spec: dict, clean_gray: np.ndarray, profile: dict, stub_fetch, monkeypatch
) -> None:
    monkeypatch.setenv("OMR_PAGE_TIMEOUT_S", "0.5")
    real_process_page = process_page

    def slow_on_first(bgr, page_index, page_spec, page_profile):
        if page_index == 0:
            time.sleep(2)
        return real_process_page(bgr, page_index, page_spec, page_profile)

    monkeypatch.setattr(pipeline, "process_page", slow_on_first)
    png = syn.png_bytes(clean_gray)
    stub_fetch({"https://x/a.png": png, "https://x/b.png": png})

    result = read_scan(images_request(spec, ["https://x/a.png", "https://x/b.png"], profile))

    assert [page["pageIndex"] for page in result["pages"]] == [1]


def test_all_pages_timed_out_raises(
    spec: dict, clean_gray: np.ndarray, profile: dict, stub_fetch, monkeypatch
) -> None:
    monkeypatch.setenv("OMR_PAGE_TIMEOUT_S", "0.05")

    def always_slow(bgr, page_index, page_spec, page_profile):
        time.sleep(1)
        return {}

    monkeypatch.setattr(pipeline, "process_page", always_slow)
    stub_fetch({"https://x/a.png": syn.png_bytes(clean_gray)})

    with pytest.raises(AllPagesTimedOut):
        read_scan(images_request(spec, ["https://x/a.png"], profile))
