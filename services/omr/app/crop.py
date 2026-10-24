"""Recorte de un campo `crop_region` con perfil versionado (diseno S1/S2).

Un perfil fija COMO se entrega la imagen al lector (humano o modelo): margen
alrededor de la region (`bleedRatio`), ancho de salida (`targetWidthPx`),
calidad JPEG y contraste opcional (`clahe`). Los perfiles se declaran en
`@soe/types` (`CROP_PROFILES`, packages/types/src/schemas/answer-reading/
crop.schema.ts) y se replican aca; `tests/test_crop_profiles_contract.py` los
compara contra `contracts/crop-profiles.json`, que genera
`pnpm --filter @soe/types gen:omr-contracts`.

Margen: `bleedRatio` es fraccion de un lado de la region segun `bleedBasis`, y
se aplica igual en los cuatro lados antes de los topes, recortado a los bordes
de la pagina rectificada. Un margen uniforme en px conserva la tinta que se sale
por arriba o por abajo de una respuesta de una linea.

- `longer_side` (v1): fraccion del lado MAYOR. En un campo ancho y bajo el
  margen vertical superaba la altura del campo y el recorte traia la pregunta
  de abajo (fotos reales del 2026-10-12, P8 y P9): los lectores la transcribian.
- `shorter_side` (v2): fraccion del lado MENOR.
- `neighborGapFraction` (v2: 0.5; null en v1): en cada lado el margen no pasa de
  esa fraccion de la distancia al campo vecino mas cercano de ESE lado. Vecinos
  son los otros campos de la misma pagina (su `region`, o la caja de sus
  burbujas); uno limita arriba/abajo solo si se superpone en x con la region, y
  a izquierda/derecha solo si se superpone en y; uno superpuesto con la region
  no limita nada. Replica `cropBleedBox` de crop.schema.ts.
- `printedLabelGapFraction` (v3: 0.5; null en v1/v2): el mismo tope, pero contra
  los rotulos impresos fuera de la region (`response.printedLabelRegion` de los
  campos de la pagina: el numero de la pregunta). Un lector leia el "4" de la
  pregunta como parte de la respuesta ("4 3/4", Celeste P4). Un layout sin
  `printedLabelRegion` recorta igual que con v2. No hay `free-text@3`: el
  desarrollo se empieza a escribir en el margen izquierdo y el tope lo cortaba.

Nunca se binariza ni se "limpian" trazos (diseno §16.2): puede borrar un punto
decimal. El recorte sale en gris, reescalado conservando la proporcion.

`LEGACY_CROP_PROFILE` NO es un perfil del contrato: describe el recorte
historico (sin margen, 600 px, calidad 70) que se mantiene cuando el campo no
pide perfil, para no cambiar el comportamiento existente.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import cv2
import numpy as np

from .geometry import point_to_px, radius_to_px
from .rectify import RectifiedPage

CLAHE_CLIP_LIMIT = 2.0
CLAHE_TILE_GRID = (8, 8)

BleedBasis = Literal["longer_side", "shorter_side"]
PxBox = tuple[int, int, int, int]


@dataclass(frozen=True)
class CropProfile:
    id: str
    version: int
    bleed_ratio: float
    target_width_px: int
    jpeg_quality: int
    contrast: str
    bleed_basis: BleedBasis = "longer_side"
    neighbor_gap_fraction: float | None = None
    printed_label_gap_fraction: float | None = None

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
            "bleedBasis": self.bleed_basis,
            "neighborGapFraction": self.neighbor_gap_fraction,
            "printedLabelGapFraction": self.printed_label_gap_fraction,
        }


def _profile(
    id: str,
    version: int,
    bleed_ratio: float,
    target_width_px: int,
    jpeg_quality: int,
    bleed_basis: BleedBasis = "longer_side",
    neighbor_gap_fraction: float | None = None,
    printed_label_gap_fraction: float | None = None,
) -> CropProfile:
    return CropProfile(
        id,
        version,
        bleed_ratio,
        target_width_px,
        jpeg_quality,
        "none",
        bleed_basis,
        neighbor_gap_fraction,
        printed_label_gap_fraction,
    )


CROP_PROFILES: dict[str, CropProfile] = {
    profile.key: profile
    for profile in (
        _profile("short-answer", 1, 0.15, 1000, 85),
        _profile("free-text", 1, 0.05, 1400, 85),
        _profile("short-answer", 2, 0.3, 1000, 85, "shorter_side", 0.5),
        _profile("free-text", 2, 0.1, 1400, 85, "shorter_side", 0.5),
        _profile("short-answer", 3, 0.3, 1000, 85, "shorter_side", 0.5, 0.5),
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


def field_footprint_px(field: dict[str, Any], size: tuple[int, int]) -> PxBox | None:
    """Lo que ocupa un campo en la pagina: su `region`, o la caja de sus burbujas."""
    region = field.get("region")
    if region is not None:
        return region_box_px(region, size)
    bubbles = field.get("bubbles") or []
    if not bubbles:
        return None
    centers = [point_to_px(bubble["center"], size) for bubble in bubbles]
    radius = max(radius_to_px(bubble["radius"], size) for bubble in bubbles)
    return (
        min(x for x, _ in centers) - radius,
        min(y for _, y in centers) - radius,
        max(x for x, _ in centers) + radius,
        max(y for _, y in centers) + radius,
    )


def neighbor_footprints_px(
    field: dict[str, Any], page_fields: Sequence[dict[str, Any]], size: tuple[int, int]
) -> list[PxBox]:
    """Las huellas de los OTROS campos de la pagina, los que pueden limitar el margen."""
    footprints = []
    for other in page_fields:
        if other is field or other.get("fieldId") == field.get("fieldId"):
            continue
        footprint = field_footprint_px(other, size)
        if footprint is not None:
            footprints.append(footprint)
    return footprints


def printed_label_footprints_px(
    page_fields: Sequence[dict[str, Any]], size: tuple[int, int]
) -> list[PxBox]:
    """Las cajas de los rotulos impresos fuera de los campos (numero de la pregunta)."""
    footprints = []
    for field in page_fields:
        label = (field.get("response") or {}).get("printedLabelRegion")
        if label is not None:
            footprints.append(region_box_px(label, size))
    return footprints


def bleed_box_px(
    box: PxBox,
    profile: CropProfile,
    size: tuple[int, int],
    neighbors: Sequence[PxBox] = (),
    printed_labels: Sequence[PxBox] = (),
) -> PxBox:
    """La caja del recorte: region + margen del perfil, con topes por vecino, rotulo y pagina."""
    x0, y0, x1, y1 = box
    sides = (x1 - x0 + 1, y1 - y0 + 1)
    side = max(sides) if profile.bleed_basis == "longer_side" else min(sides)
    pad = profile.bleed_ratio * side
    fields = _side_gaps(box, neighbors)
    labels = _side_gaps(box, printed_labels)
    left, right, top, bottom = (
        round(
            _side_cap(
                _side_cap(pad, profile.neighbor_gap_fraction, field_gaps),
                profile.printed_label_gap_fraction,
                label_gaps,
            )
        )
        for field_gaps, label_gaps in zip(fields, labels, strict=True)
    )
    width, height = size
    return (
        max(0, x0 - left),
        max(0, y0 - top),
        min(width - 1, x1 + right),
        min(height - 1, y1 + bottom),
    )


def _overlaps(a0: int, a1: int, b0: int, b1: int) -> bool:
    return a0 <= b1 and b0 <= a1


def _side_gaps(box: PxBox, obstacles: Sequence[PxBox]) -> tuple[list[int], ...]:
    x0, y0, x1, y1 = box
    in_row = [n for n in obstacles if _overlaps(n[1], n[3], y0, y1)]
    in_column = [n for n in obstacles if _overlaps(n[0], n[2], x0, x1)]
    return (
        [x0 - n[2] - 1 for n in in_row],
        [n[0] - x1 - 1 for n in in_row],
        [y0 - n[3] - 1 for n in in_column],
        [n[1] - y1 - 1 for n in in_column],
    )


def _side_cap(pad: float, fraction: float | None, gaps: list[int]) -> float:
    if fraction is None:
        return pad
    free = [gap for gap in gaps if gap >= 0]
    if not free:
        return pad
    return min(pad, fraction * min(free))


def crop_with_profile(
    page: RectifiedPage,
    region: dict[str, dict[str, float]],
    profile: CropProfile,
    neighbors: Sequence[PxBox] = (),
    printed_labels: Sequence[PxBox] = (),
) -> CropImage:
    x0, y0, x1, y1 = bleed_box_px(
        region_box_px(region, page.size), profile, page.size, neighbors, printed_labels
    )
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
