"""FieldReader (D10): registro por tipo de campo. Sumar un tipo = registrar un lector.

El MVP registra solo `bubble_group` (D14). `digit_grid` y `crop_region`
entran como implementaciones nuevas de este protocolo, sin tocar el pipeline.

Para `selectMode: single`: 0 burbujas sobre el umbral => blank; 1 => marked;
>= 2 => multiple (value null, la evidencia queda en el recorte). Cualquier
burbuja del campo con margin < AMBIGUITY_MARGIN, o con fill en tierra de
nadie entre los dos grupos de la pagina (PageThreshold.is_in_no_mans_land),
=> el campo entero es ambiguous. El fill/margin reportado es el de la burbuja
representativa: la marcada si hay una, la mas dudosa en los demas casos.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Protocol

from .classify import AMBIGUITY_MARGIN, PageThreshold, bubble_fill, crop_field_jpeg, margin_of
from .rectify import RectifiedPage


@dataclass(frozen=True)
class BubbleSample:
    value: str
    fill: float
    margin: float
    uncertain: bool

    def is_over(self, threshold: float) -> bool:
        return self.fill > threshold


class FieldReader(Protocol):
    kind: str

    def sample_fills(self, page: RectifiedPage, field: dict[str, Any]) -> list[float]: ...

    def read(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        fills: list[float],
        page_threshold: PageThreshold,
    ) -> dict[str, Any]: ...


class BubbleGroupReader:
    kind = "bubble_group"

    def sample_fills(self, page: RectifiedPage, field: dict[str, Any]) -> list[float]:
        return [
            bubble_fill(page, bubble["center"], bubble["radius"]) for bubble in field["bubbles"]
        ]

    def read(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        fills: list[float],
        page_threshold: PageThreshold,
    ) -> dict[str, Any]:
        threshold = page_threshold.threshold
        samples = [
            BubbleSample(
                value=bubble["value"],
                fill=fill,
                margin=margin_of(fill, threshold),
                uncertain=margin_of(fill, threshold) < AMBIGUITY_MARGIN
                or page_threshold.is_in_no_mans_land(fill),
            )
            for bubble, fill in zip(field["bubbles"], fills, strict=True)
        ]
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
            "cropJpegBase64": self._crop_base64(page, field) if needs_evidence else None,
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

    def _crop_base64(self, page: RectifiedPage, field: dict[str, Any]) -> str:
        encoded = crop_field_jpeg(page, field["bubbles"])
        return base64.b64encode(encoded.tobytes()).decode("ascii")


READERS: dict[str, FieldReader] = {
    "bubble_group": BubbleGroupReader(),
}
