"""PageSource (C18, D3): entrega bitmaps BGR desde PDF o imagenes sueltas.

Termina donde entrega un bitmap: no sabe nada de fiduciales, layouts ni
burbujas. La descarga es inyectable (`fetch`) para que los tests corran sin
red. Un fallo de descarga es `SourceDownloadError`, que main.py traduce a 502.
"""

from __future__ import annotations

import io
import os
from collections.abc import Callable, Iterator
from typing import Any, Protocol

import cv2
import httpx
import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageOps

Fetch = Callable[[str], bytes]

PDF_RASTER_DPI = 200


class SourceDownloadError(Exception):
    def __init__(self, url: str, detail: str) -> None:
        super().__init__(f"No se pudo descargar {url}: {detail}")
        self.url = url


class SourceDecodeError(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)


class PageSource(Protocol):
    def pages(self) -> Iterator[tuple[int, np.ndarray]]: ...


def download_timeout_s() -> float:
    return float(os.environ.get("OMR_DOWNLOAD_TIMEOUT_S", "10"))


def fetch_url(url: str) -> bytes:
    try:
        response = httpx.get(url, timeout=download_timeout_s(), follow_redirects=True)
        response.raise_for_status()
        return response.content
    except httpx.HTTPError as error:
        raise SourceDownloadError(url, str(error)) from error


class PdfPageSource:
    def __init__(self, pdf_bytes: bytes) -> None:
        self._pdf_bytes = pdf_bytes

    def pages(self) -> Iterator[tuple[int, np.ndarray]]:
        try:
            document = pdfium.PdfDocument(self._pdf_bytes)
        except pdfium.PdfiumError as error:
            raise SourceDecodeError(f"PDF ilegible: {error}") from error
        try:
            for index in range(len(document)):
                bitmap = document[index].render(scale=PDF_RASTER_DPI / 72)
                rgb = bitmap.to_numpy()
                if rgb.ndim == 2:
                    yield index, cv2.cvtColor(rgb, cv2.COLOR_GRAY2BGR)
                else:
                    yield index, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        finally:
            document.close()


class ImagePageSource:
    def __init__(self, images_bytes: list[bytes]) -> None:
        self._images_bytes = images_bytes

    def pages(self) -> Iterator[tuple[int, np.ndarray]]:
        for index, raw in enumerate(self._images_bytes):
            yield index, self._decode(index, raw)

    def _decode(self, index: int, raw: bytes) -> np.ndarray:
        oriented = self._apply_exif_orientation(raw)
        image = cv2.imdecode(np.frombuffer(oriented, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise SourceDecodeError(f"Imagen {index} ilegible")
        return image

    def _apply_exif_orientation(self, raw: bytes) -> bytes:
        try:
            with Image.open(io.BytesIO(raw)) as pil_image:
                exif_orientation = pil_image.getexif().get(0x0112, 1)
                if exif_orientation == 1:
                    return raw
                transposed = ImageOps.exif_transpose(pil_image)
                buffer = io.BytesIO()
                transposed.save(buffer, format="PNG")
                return buffer.getvalue()
        except OSError:
            return raw


def build_page_source(source: dict[str, Any], fetch: Fetch = fetch_url) -> PageSource:
    if source["kind"] == "pdf":
        return PdfPageSource(fetch(source["pdfUrl"]))
    return ImagePageSource([fetch(url) for url in source["imageUrls"]])
