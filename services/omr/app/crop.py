"""Recorte de un campo `crop_region` con perfil versionado (diseno S1/S2).

Un perfil fija COMO se entrega la imagen al lector (humano o modelo): margen
alrededor de la region (`bleedRatio`), ancho de salida (`targetWidthPx`),
calidad JPEG y contraste opcional (`clahe`). Los perfiles se declaran en
`@soe/types` (`CROP_PROFILES`, packages/types/src/schemas/answer-reading/
crop.schema.ts) y se replican aca; `tests/test_crop_profiles_contract.py` los
compara contra `contracts/crop-profiles.json`, que genera
`pnpm --filter @soe/types gen:omr-contracts`.

Margen: `bleedRatio` es fraccion del lado MAYOR de la region y se aplica igual
en los cuatro lados, recortado a los bordes de la pagina rectificada. Un margen
uniforme en px conserva la tinta que se sale por arriba o por abajo de una
respuesta de una linea (si fuera fraccion de cada eje, una region ancha y baja
casi no tendria margen vertical).

Nunca se binariza ni se "limpian" trazos (diseno §16.2): puede borrar un punto
decimal. El recorte sale en gris, reescalado conservando la proporcion.

`LEGACY_CROP_PROFILE` NO es un perfil del contrato: describe el recorte
historico (sin margen, 600 px, calidad 70) que se mantiene cuando el campo no
pide perfil, para no cambiar el comportamiento existente.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from .geometry import point_to_px
from .rectify import RectifiedPage

CLAHE_CLIP_LIMIT = 2.0
CLAHE_TILE_GRID = (8, 8)


@dataclass(frozen=True)
class CropProfile:
    id: str
    version: int
    bleed_ratio: float
    target_width_px: int
    jpeg_quality: int
    contrast: str

    @property
    def key(self) -> str:
        return f"{self.id}@{self.version}"

    def to_contract(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "version": self.version,
            "bleedRatio": self.bleed_ratio,
            "targetWidthPx": self.target_width_px,
            "jpegQuality": self.jpeg_quality,
            "contrast": self.contrast,
        }


def _profile(
    id: str, version: int, bleed_ratio: float, target_width_px: int, jpeg_quality: int
) -> CropProfile:
    return CropProfile(id, version, bleed_ratio, target_width_px, jpeg_quality, "none")


CROP_PROFILES: dict[str, CropProfile] = {
    profile.key: profile
    for profile in (
        _profile("short-answer", 1, 0.15, 1000, 85),
        _profile("free-text", 1, 0.05, 1400, 85),
    )
}

LEGACY_CROP_PROFILE = _profile("crop-region-legacy", 1, 0.0, 600, 70)


def resolve_crop_profile(profile_id: str | None) -> CropProfile:
    """Perfil pedido por el campo; el historico si no pide o pide uno desconocido.

    Un id desconocido no tumba la pagina: se recorta con el historico y la
    evidencia (`crop.cropProfileId`) dice cual se aplico de verdad.
    """
    if profile_id is None:
        return LEGACY_CROP_PROFILE
    return CROP_PROFILES.get(profile_id, LEGACY_CROP_PROFILE)


@dataclass(frozen=True)
class CropImage:
    jpeg: np.ndarray
    width_px: int
    height_px: int
    profile: CropProfile

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.jpeg.tobytes()).hexdigest()


def region_box_px(
    region: dict[str, dict[str, float]], size: tuple[int, int]
) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1) inclusivos y ordenados de una region del LayoutSpec."""
    ax, ay = point_to_px(region["topLeft"], size)
    bx, by = point_to_px(region["bottomRight"], size)
    return min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)


def bleed_box_px(
    box: tuple[int, int, int, int], bleed_ratio: float, size: tuple[int, int]
) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = box
    pad = round(bleed_ratio * max(x1 - x0 + 1, y1 - y0 + 1))
    width, height = size
    return max(0, x0 - pad), max(0, y0 - pad), min(width - 1, x1 + pad), min(height - 1, y1 + pad)


def crop_with_profile(
    page: RectifiedPage, region: dict[str, dict[str, float]], profile: CropProfile
) -> CropImage:
    x0, y0, x1, y1 = bleed_box_px(region_box_px(region, page.size), profile.bleed_ratio, page.size)
    crop = page.gray[y0 : y1 + 1, x0 : x1 + 1]
    if profile.contrast == "clahe":
        clahe = cv2.createCLAHE(clipLimit=CLAHE_CLIP_LIMIT, tileGridSize=CLAHE_TILE_GRID)
        crop = clahe.apply(np.ascontiguousarray(crop))
    width = profile.target_width_px
    height = max(1, round(crop.shape[0] * width / max(1, crop.shape[1])))
    interpolation = cv2.INTER_AREA if width <= crop.shape[1] else cv2.INTER_CUBIC
    resized = cv2.resize(crop, (width, height), interpolation=interpolation)
    ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, profile.jpeg_quality])
    if not ok:
        raise RuntimeError("No se pudo codificar el recorte JPEG")
    return CropImage(encoded, width, height, profile)
