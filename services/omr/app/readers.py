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

Contrato v2 (OMR_CONTRACT_V2, default encendido): cada marca lleva ademas tres
campos que dicen QUE sugiere el motor y POR QUE duda, sin cambiar state/value:

  suggestedValue  en ambiguous, la alternativa que el motor elegiria si la duda
                  se resolviera como viene: la unica burbuja sobre el umbral
                  (en selectMode multiple, todas las que estan sobre el umbral).
                  null si ninguna o mas de una lo supera; null fuera de ambiguous.
  doubtReason     `margin` (alguna burbuja con margin < ambiguity_margin),
                  `band` (ninguna por margin pero alguna en tierra de nadie),
                  `multiple` (state multiple); null en marked/blank.
  nullConfidence  solo en multiple, 0-1: cuan seguro es que la doble marca es
                  una nula real. Fuerza de la burbuja mas tenue sobre el umbral,
                  (fill - umbral) / (1 - umbral) — cuanto del camino hasta el
                  relleno pleno recorrio — penalizada linealmente por el
                  contraste entre la mas oscura y la mas clara de ellas
                  (NULL_CONFIDENCE_CONTRAST_SCALE = 0.25 de fill anula la
                  confianza): dos igual de rellenas => alto; una clara y una
                  tenue (borron o correccion) => bajo. No usa `margin` porque
                  ese es relativo al umbral y en una hoja de rellenos plenos
                  (umbral 0.62) topa en 0.62 hasta para la doble mas evidente.
                  Medido en goldset/README-registro.md (pendientes fase 4).

Con OMR_CONTRACT_V2=0 las tres claves no se emiten y el ScanResult vuelve a la
forma v1 (los tres campos son opcionales en el contrato).
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from typing import Any, Protocol

from .classify import (
    AMBIGUITY_MARGIN,
    PageThreshold,
    bubble_fill,
    bubble_fill_px,
    crop_field_jpeg,
    crop_region_jpeg,
    margin_of,
)
from .geometry import point_to_px, radius_to_px
from .rectify import RectifiedPage
from .registration import RingFix, local_registration_enabled, register_group

ENV_CONTRACT_V2 = "OMR_CONTRACT_V2"
CONTRACT_V2_DEFAULT = True
DOUBT_MARGIN = "margin"
DOUBT_BAND = "band"
DOUBT_MULTIPLE = "multiple"
NULL_CONFIDENCE_CONTRAST_SCALE = 0.25


def contract_v2_enabled() -> bool:
    raw = os.environ.get(ENV_CONTRACT_V2)
    if raw is None:
        return CONTRACT_V2_DEFAULT
    return raw.strip().lower() in ("1", "true", "yes", "on")


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

    def sample_fills(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        registration_log: list[RingFix] | None = None,
    ) -> list[float]: ...

    def read(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        fills: list[float],
        page_threshold: PageThreshold,
        ambiguity_margin: float = AMBIGUITY_MARGIN,
    ) -> dict[str, Any]: ...


def sample_bubble_fills_at_spec(page: RectifiedPage, bubbles: list[dict[str, Any]]) -> list[float]:
    """Fill en la posicion que dice el spec, sin registro local.

    Es lo que usan la firma de grilla y el afinado de esquinas (pipeline.py): ahi la
    posicion del spec ES la pregunta — si el anillo esta donde el spec lo pone, la
    homografia es la correcta — y una busqueda local la responderia por ellos.
    """
    return [bubble_fill(page, bubble["center"], bubble["radius"]) for bubble in bubbles]


def sample_bubble_fills(
    page: RectifiedPage,
    bubbles: list[dict[str, Any]],
    registration_log: list[RingFix] | None = None,
) -> list[float]:
    """Fill de cada burbuja del grupo, sobre el anillo localizado si el registro esta activo.

    El grupo es la unidad de consistencia del registro (app/registration.py): un campo
    de alternativas o una columna de la grilla RUT. Con el interruptor apagado es
    exactamente `sample_bubble_fills_at_spec`.
    """
    if not bubbles:
        return []
    if not local_registration_enabled():
        return sample_bubble_fills_at_spec(page, bubbles)
    fixes = register_group(page, bubbles)
    if registration_log is not None:
        registration_log.extend(fixes)
    fills = []
    for bubble, fix in zip(bubbles, fixes, strict=True):
        center_px = point_to_px(bubble["center"], page.size)
        radius_px = radius_to_px(bubble["radius"], page.size)
        registered_px = (center_px[0] + fix.dx, center_px[1] + fix.dy)
        fills.append(bubble_fill_px(page, registered_px, radius_px))
    return fills


def sample_digit_grid_fills(
    page: RectifiedPage,
    bubbles: list[dict[str, Any]],
    registration_log: list[RingFix] | None = None,
) -> list[float]:
    """Una grilla de digitos se registra por columna (`group`), no como un solo grupo.

    En la grilla las burbujas estan a menos de dos radios entre si y una columna entera
    comparte el mismo desplazamiento; la mediana por columna es la consistencia
    correcta. Sin `group` valido se registra la grilla completa como un unico grupo.
    """
    if not bubbles:
        return []
    if not local_registration_enabled():
        return sample_bubble_fills_at_spec(page, bubbles)
    if any(not isinstance(bubble.get("group"), int) for bubble in bubbles):
        return sample_bubble_fills(page, bubbles, registration_log)
    fills: dict[int, float] = {}
    by_group: dict[int, list[int]] = {}
    for index, bubble in enumerate(bubbles):
        by_group.setdefault(bubble["group"], []).append(index)
    for indexes in by_group.values():
        group_fills = sample_bubble_fills(page, [bubbles[i] for i in indexes], registration_log)
        for index, fill in zip(indexes, group_fills, strict=True):
            fills[index] = fill
    return [fills[index] for index in range(len(bubbles))]


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


def empty_doubt_fields() -> dict[str, Any]:
    return {"suggestedValue": None, "doubtReason": None, "nullConfidence": None}


def doubt_fields(
    field: dict[str, Any],
    samples: list[BubbleSample],
    state: str,
    threshold: float,
    ambiguity_margin: float,
) -> dict[str, Any]:
    if state == "ambiguous":
        return {
            "suggestedValue": suggested_value(field, samples, threshold),
            "doubtReason": doubt_reason(samples, ambiguity_margin),
            "nullConfidence": None,
        }
    if state == "multiple":
        return {
            "suggestedValue": None,
            "doubtReason": DOUBT_MULTIPLE,
            "nullConfidence": round(null_confidence(samples, threshold), 4),
        }
    return empty_doubt_fields()


def suggested_value(
    field: dict[str, Any], samples: list[BubbleSample], threshold: float
) -> str | None:
    over = [sample for sample in samples if sample.is_over(threshold)]
    if not over:
        return None
    if field["selectMode"] == "multiple":
        return "".join(sample.value for sample in over)
    if len(over) == 1:
        return over[0].value
    return None


def doubt_reason(samples: list[BubbleSample], ambiguity_margin: float) -> str:
    if any(sample.uncertain and sample.margin < ambiguity_margin for sample in samples):
        return DOUBT_MARGIN
    return DOUBT_BAND


def null_confidence(samples: list[BubbleSample], threshold: float) -> float:
    over = [sample for sample in samples if sample.is_over(threshold)]
    if len(over) < 2 or threshold >= 1.0:
        return 0.0
    fills = [sample.fill for sample in over]
    weakest_strength = min(1.0, (min(fills) - threshold) / (1.0 - threshold))
    contrast = (max(fills) - min(fills)) / NULL_CONFIDENCE_CONTRAST_SCALE
    return max(0.0, weakest_strength * (1.0 - contrast))


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

    def sample_fills(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        registration_log: list[RingFix] | None = None,
    ) -> list[float]:
        return sample_bubble_fills(page, field["bubbles"], registration_log)

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
        reading = {
            "fieldId": field["fieldId"],
            "printedNumber": field["printedNumber"],
            "state": state,
            "value": value,
            "fill": round(representative.fill, 4),
            "threshold": round(threshold, 4),
            "margin": round(representative.margin, 4),
            "cropJpegBase64": _bubbles_crop_base64(page, field) if needs_evidence else None,
        }
        if contract_v2_enabled():
            reading.update(doubt_fields(field, samples, state, threshold, ambiguity_margin))
        return reading

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
            return (
                "marked",
                "".join(sample.value for sample in over),
                max(over, key=lambda sample: sample.fill),
            )
        if len(over) == 1:
            return "marked", over[0].value, over[0]
        return "multiple", None, min(over, key=lambda sample: sample.margin)


class DigitGridReader:
    kind = "digit_grid"

    def sample_fills(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        registration_log: list[RingFix] | None = None,
    ) -> list[float]:
        return sample_digit_grid_fills(page, field["bubbles"], registration_log)

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
        reading = {
            "fieldId": field["fieldId"],
            "printedNumber": field["printedNumber"],
            "state": state,
            "value": value,
            "fill": round(representative.fill, 4) if representative else 0.0,
            "threshold": round(page_threshold.threshold, 4),
            "margin": round(representative.margin, 4) if representative else 0.0,
            "cropJpegBase64": _bubbles_crop_base64(page, field) if state == "ambiguous" else None,
        }
        if contract_v2_enabled():
            reading.update(empty_doubt_fields())
        return reading

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

    def sample_fills(
        self,
        page: RectifiedPage,
        field: dict[str, Any],
        registration_log: list[RingFix] | None = None,
    ) -> list[float]:
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
        reading = {
            "fieldId": field["fieldId"],
            "printedNumber": field["printedNumber"],
            "state": "marked",
            "value": None,
            "fill": 0.0,
            "threshold": 0.5,
            "margin": 1.0,
            "cropJpegBase64": base64.b64encode(encoded.tobytes()).decode("ascii"),
        }
        if contract_v2_enabled():
            reading.update(empty_doubt_fields())
        return reading


def _bubbles_crop_base64(page: RectifiedPage, field: dict[str, Any]) -> str:
    encoded = crop_field_jpeg(page, field["bubbles"])
    return base64.b64encode(encoded.tobytes()).decode("ascii")


READERS: dict[str, FieldReader] = {
    "bubble_group": BubbleGroupReader(),
    "digit_grid": DigitGridReader(),
    "crop_region": CropRegionReader(),
}
