"""FieldReader (D10): registro por tipo de campo. Sumar un tipo = registrar un lector.

v1 registra `bubble_group` (D14), `digit_grid` (CD-8) y `crop_region` (CD-9).

Para `selectMode: single`: 0 burbujas sobre el umbral => blank; 1 => marked;
>= 2 => multiple (value null, la evidencia queda en el recorte). Cualquier
burbuja del campo con margin < ambiguity_margin (del CaptureProfile, CD-12;
default AMBIGUITY_MARGIN), o con fill en tierra de nadie entre los dos grupos
de la pagina (PageThreshold.is_in_no_mans_land), => el campo entero es
ambiguous. El fill/margin reportado es el de la burbuja representativa: la
marcada si hay una, la mas dudosa en los demas casos.

digit_grid (CD-8): cada `group` es un mini-cluster single de '0'-'9'; el valor
del campo es la concatenacion de los digitos por grupo ascendente. Si
CUALQUIER grupo es dudoso, doble, o queda vacio mientras otros estan marcados,
el campo ENTERO es ambiguous con evidencia — jamas un numero con un digito
inventado. Todos los grupos vacios y claros => blank.

crop_region (CD-9): el recorte ES la respuesta: state marked, value null,
cropJpegBase64 siempre, fill/threshold/margin fijos 0/0.5/1.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Protocol

from .classify import (
    AMBIGUITY_MARGIN,
    PageThreshold,
    bubble_fill,
    crop_field_jpeg,
    crop_region_jpeg,
    margin_of,
)
from .rectify import RectifiedPage


@dataclass(frozen=True)
class BubbleSample:
    value: str
    fill: float
    margin: float
    uncertain: bool

    def is_over(self, threshold: float) -> bool:
        return self.fill > threshold


@dataclass(frozen=True)
class DigitGroupReading:
    state: str
    digit: str | None
    representative: BubbleSample


class FieldReader(Protocol):
    kind: str

    def sample_fills(self, page: RectifiedPage, field: dict[str, Any]) -> list[float]: ...

    def read(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        fills: list[float],
        page_threshold: PageThreshold,
        ambiguity_margin: float = AMBIGUITY_MARGIN,
    ) -> dict[str, Any]: ...


def sample_bubble_fills(page: RectifiedPage, bubbles: list[dict[str, Any]]) -> list[float]:
    return [bubble_fill(page, bubble["center"], bubble["radius"]) for bubble in bubbles]


def bubble_samples(
    bubbles: list[dict[str, Any]],
    fills: list[float],
    page_threshold: PageThreshold,
    ambiguity_margin: float,
) -> list[BubbleSample]:
    threshold = page_threshold.threshold
    return [
        BubbleSample(
            value=bubble["value"],
            fill=fill,
            margin=margin_of(fill, threshold),
            uncertain=margin_of(fill, threshold) < ambiguity_margin
            or page_threshold.is_in_no_mans_land(fill),
        )
        for bubble, fill in zip(bubbles, fills, strict=True)
    ]


def read_digit_groups(
    bubbles: list[dict[str, Any]],
    fills: list[float],
    page_threshold: PageThreshold,
    ambiguity_margin: float,
) -> list[DigitGroupReading] | None:
    grouped: dict[int, tuple[list[dict[str, Any]], list[float]]] = {}
    for bubble, fill in zip(bubbles, fills, strict=True):
        group_index = bubble.get("group")
        if not isinstance(group_index, int):
            return None
        group_bubbles, group_fills = grouped.setdefault(group_index, ([], []))
        group_bubbles.append(bubble)
        group_fills.append(fill)
    if sorted(grouped) != list(range(len(grouped))):
        return None
    return [
        _read_group(group_bubbles, group_fills, page_threshold, ambiguity_margin)
        for _, (group_bubbles, group_fills) in sorted(grouped.items())
    ]


def _read_group(
    bubbles: list[dict[str, Any]],
    fills: list[float],
    page_threshold: PageThreshold,
    ambiguity_margin: float,
) -> DigitGroupReading:
    samples = bubble_samples(bubbles, fills, page_threshold, ambiguity_margin)
    most_doubtful = min(samples, key=lambda sample: sample.margin)
    uncertain = [sample for sample in samples if sample.uncertain]
    if uncertain:
        return DigitGroupReading(
            state="doubtful",
            digit=None,
            representative=min(uncertain, key=lambda sample: sample.margin),
        )
    over = [sample for sample in samples if sample.is_over(page_threshold.threshold)]
    if not over:
        return DigitGroupReading(state="blank", digit=None, representative=most_doubtful)
    if len(over) == 1:
        return DigitGroupReading(state="marked", digit=over[0].value, representative=over[0])
    return DigitGroupReading(
        state="doubtful",
        digit=None,
        representative=min(over, key=lambda sample: sample.margin),
    )


class BubbleGroupReader:
    kind = "bubble_group"

    def sample_fills(self, page: RectifiedPage, field: dict[str, Any]) -> list[float]:
        return sample_bubble_fills(page, field["bubbles"])

    def read(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        fills: list[float],
        page_threshold: PageThreshold,
        ambiguity_margin: float = AMBIGUITY_MARGIN,
    ) -> dict[str, Any]:
        threshold = page_threshold.threshold
        samples = bubble_samples(field["bubbles"], fills, page_threshold, ambiguity_margin)
        state, value, representative = self._classify(field, samples, threshold)
        needs_evidence = state in ("multiple", "ambiguous")
        return {
            "fieldId": field["fieldId"],
            "printedNumber": field["printedNumber"],
            "state": state,
            "value": value,
            "fill": round(representative.fill, 4),
            "threshold": round(threshold, 4),
            "margin": round(representative.margin, 4),
            "cropJpegBase64": _bubbles_crop_base64(page, field) if needs_evidence else None,
        }

    def _classify(
        self, field: dict[str, Any], samples: list[BubbleSample], threshold: float
    ) -> tuple[str, str | None, BubbleSample]:
        most_doubtful = min(samples, key=lambda sample: sample.margin)
        over = [sample for sample in samples if sample.is_over(threshold)]
        uncertain = [sample for sample in samples if sample.uncertain]
        if uncertain:
            return "ambiguous", None, min(uncertain, key=lambda sample: sample.margin)
        if not over:
            return "blank", None, most_doubtful
        if field["selectMode"] == "multiple":
            return "marked", "".join(sample.value for sample in over), max(
                over, key=lambda sample: sample.fill
            )
        if len(over) == 1:
            return "marked", over[0].value, over[0]
        return "multiple", None, min(over, key=lambda sample: sample.margin)


class DigitGridReader:
    kind = "digit_grid"

    def sample_fills(self, page: RectifiedPage, field: dict[str, Any]) -> list[float]:
        return sample_bubble_fills(page, field["bubbles"])

    def read(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        fills: list[float],
        page_threshold: PageThreshold,
        ambiguity_margin: float = AMBIGUITY_MARGIN,
    ) -> dict[str, Any]:
        groups = read_digit_groups(field["bubbles"], fills, page_threshold, ambiguity_margin)
        state, value, representative = self._classify(groups)
        return {
            "fieldId": field["fieldId"],
            "printedNumber": field["printedNumber"],
            "state": state,
            "value": value,
            "fill": round(representative.fill, 4) if representative else 0.0,
            "threshold": round(page_threshold.threshold, 4),
            "margin": round(representative.margin, 4) if representative else 0.0,
            "cropJpegBase64": _bubbles_crop_base64(page, field) if state == "ambiguous" else None,
        }

    def _classify(
        self, groups: list[DigitGroupReading] | None
    ) -> tuple[str, str | None, BubbleSample | None]:
        if not groups:
            return "ambiguous", None, None
        most_doubtful = min(
            (group.representative for group in groups), key=lambda sample: sample.margin
        )
        if any(group.state == "doubtful" for group in groups):
            return "ambiguous", None, most_doubtful
        if all(group.state == "blank" for group in groups):
            return "blank", None, most_doubtful
        if any(group.state == "blank" for group in groups):
            return "ambiguous", None, most_doubtful
        digits = "".join(group.digit for group in groups if group.digit is not None)
        return "marked", digits, most_doubtful


class CropRegionReader:
    kind = "crop_region"

    def sample_fills(self, page: RectifiedPage, field: dict[str, Any]) -> list[float]:
        return []

    def read(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        fills: list[float],
        page_threshold: PageThreshold,
        ambiguity_margin: float = AMBIGUITY_MARGIN,
    ) -> dict[str, Any]:
        encoded = crop_region_jpeg(page, field["region"])
        return {
            "fieldId": field["fieldId"],
            "printedNumber": field["printedNumber"],
            "state": "marked",
            "value": None,
            "fill": 0.0,
            "threshold": 0.5,
            "margin": 1.0,
            "cropJpegBase64": base64.b64encode(encoded.tobytes()).decode("ascii"),
        }


def _bubbles_crop_base64(page: RectifiedPage, field: dict[str, Any]) -> str:
    encoded = crop_field_jpeg(page, field["bubbles"])
    return base64.b64encode(encoded.tobytes()).decode("ascii")


READERS: dict[str, FieldReader] = {
    "bubble_group": BubbleGroupReader(),
    "digit_grid": DigitGridReader(),
    "crop_region": CropRegionReader(),
}
