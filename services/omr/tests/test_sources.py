"""PageSource (C18, D3): PDF multipagina, orientacion EXIF y errores de decodificacion."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from app.sources import (
    ImagePageSource,
    PdfPageSource,
    SourceDecodeError,
    build_page_source,
)
from tests import synthetic as syn


def make_pdf_bytes(grays: list[np.ndarray]) -> bytes:
    images = [Image.fromarray(gray) for gray in grays]
    buffer = io.BytesIO()
    images[0].save(
        buffer, format="PDF", save_all=True, append_images=images[1:], resolution=200
    )
    return buffer.getvalue()


def test_pdf_source_yields_every_page_in_order(spec: dict, clean_gray: np.ndarray) -> None:
    blank = syn.render_page(spec, 0, marks={}, rng=np.random.default_rng(1))
    source = PdfPageSource(make_pdf_bytes([clean_gray, blank]))
    pages = list(source.pages())
    assert [index for index, _ in pages] == [0, 1]
    for _, bgr in pages:
        assert bgr.ndim == 3
        assert bgr.shape[2] == 3


def test_pdf_source_raises_decode_error_on_garbage() -> None:
    source = PdfPageSource(b"esto no es un pdf")
    with pytest.raises(SourceDecodeError):
        list(source.pages())


def test_image_source_applies_exif_orientation(clean_gray: np.ndarray) -> None:
    landscape = np.rot90(clean_gray, k=1)
    exif = Image.Exif()
    exif[0x0112] = 8
    buffer = io.BytesIO()
    Image.fromarray(landscape).save(buffer, format="JPEG", quality=95, exif=exif)

    source = ImagePageSource([buffer.getvalue()])
    [(index, bgr)] = list(source.pages())
    assert index == 0
    assert bgr.shape[0] > bgr.shape[1]


def test_image_source_raises_decode_error_on_garbage() -> None:
    source = ImagePageSource([b"no es una imagen"])
    with pytest.raises(SourceDecodeError):
        list(source.pages())


def test_build_page_source_dispatches_by_kind(clean_gray: np.ndarray) -> None:
    fetched: list[str] = []

    def fetch(url: str) -> bytes:
        fetched.append(url)
        return syn.png_bytes(clean_gray)

    pdf_request = {"kind": "pdf", "pdfUrl": "https://x/archivo.pdf", "imageUrls": None}
    images_request = {"kind": "images", "pdfUrl": None, "imageUrls": ["https://x/1", "https://x/2"]}
    assert isinstance(
        build_page_source(images_request, fetch), ImagePageSource
    )

    def fetch_pdf(url: str) -> bytes:
        fetched.append(url)
        return make_pdf_bytes([clean_gray])

    assert isinstance(build_page_source(pdf_request, fetch_pdf), PdfPageSource)
    assert fetched == ["https://x/1", "https://x/2", "https://x/archivo.pdf"]
