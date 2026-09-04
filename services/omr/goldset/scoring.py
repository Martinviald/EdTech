"""Cruce de un ScanResult contra la verdad transcrita, marca por marca.

Cada printedNumber del spec cae en exactamente una categoria:

  correct_firm     marked/blank firme que coincide con la verdad.
  review           multiple/ambiguous, o toda marca de una pagina rechazada
                   por calidad (quality.ok=false): la cola de revision la
                   absorbe, no es un error del clasificador.
  confident_wrong  marked/blank firme que NO coincide — LA cifra que importa:
                   el clasificador decidio mal sin dudar.
  unread           la pagina no aparecio en el resultado (timeout CD-6 u
                   omision); el orquestador la trata como no escaneada.

La correspondencia pagina-logica <-> archivo es la convencion del dataset
(page-N = pagina logica N, ver dataset.py); dentro de una pagina leida las
marcas se cruzan por printedNumber, que es lo que el QR ya resolvio (CD-7).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CATEGORY_CORRECT = "correct_firm"
CATEGORY_REVIEW = "review"
CATEGORY_WRONG = "confident_wrong"
CATEGORY_UNREAD = "unread"

FIRM_STATES = ("marked", "blank")
REVIEW_STATES = ("multiple", "ambiguous")

PAGE_UNREAD_REASON = "page_missing"


class ScoringError(Exception):
    pass


@dataclass(frozen=True)
class MarkOutcome:
    sheet: str
    cut: str
    printed_number: str
    category: str
    expected: str | None
    state: str | None
    value: str | None
    fill: float | None
    threshold: float | None
    margin: float | None
    reject_reason: str | None

    def to_json(self) -> dict[str, Any]:
        return {
            "sheet": self.sheet,
            "cut": self.cut,
            "printedNumber": self.printed_number,
            "category": self.category,
            "expected": self.expected,
            "state": self.state,
            "value": self.value,
            "fill": self.fill,
            "threshold": self.threshold,
            "margin": self.margin,
            "rejectReason": self.reject_reason,
        }


def score_sheet(
    sheet_label: str,
    cut: str,
    spec: dict[str, Any],
    truth_answers: dict[str, str | None],
    result: dict[str, Any],
) -> list[MarkOutcome]:
    pages_by_index = {page["pageIndex"]: page for page in result["pages"]}
    outcomes: list[MarkOutcome] = []
    for logical_page in range(spec["pageCount"]):
        page_fields = [f for f in spec["fields"] if f["pageIndex"] == logical_page]
        page = pages_by_index.get(logical_page)
        if page is None:
            outcomes.extend(
                _whole_page(sheet_label, cut, page_fields, truth_answers,
                            CATEGORY_UNREAD, PAGE_UNREAD_REASON)
            )
        elif not page["quality"]["ok"]:
            outcomes.extend(
                _whole_page(sheet_label, cut, page_fields, truth_answers,
                            CATEGORY_REVIEW, page["quality"]["rejectReason"])
            )
        else:
            for mark in page["marks"]:
                outcomes.append(_score_mark(sheet_label, cut, mark, truth_answers))
    return outcomes


def _whole_page(
    sheet_label: str,
    cut: str,
    page_fields: list[dict[str, Any]],
    truth_answers: dict[str, str | None],
    category: str,
    reject_reason: str | None,
) -> list[MarkOutcome]:
    return [
        MarkOutcome(
            sheet=sheet_label,
            cut=cut,
            printed_number=field["printedNumber"],
            category=category,
            expected=_expected(sheet_label, field["printedNumber"], truth_answers),
            state=None,
            value=None,
            fill=None,
            threshold=None,
            margin=None,
            reject_reason=reject_reason,
        )
        for field in page_fields
    ]


def _score_mark(
    sheet_label: str, cut: str, mark: dict[str, Any], truth_answers: dict[str, str | None]
) -> MarkOutcome:
    printed_number = mark["printedNumber"]
    expected = _expected(sheet_label, printed_number, truth_answers)
    state = mark["state"]
    if state in REVIEW_STATES:
        category = CATEGORY_REVIEW
    elif state == "blank":
        category = CATEGORY_CORRECT if expected is None else CATEGORY_WRONG
    elif state == "marked":
        category = CATEGORY_CORRECT if mark["value"] == expected else CATEGORY_WRONG
    else:
        raise ScoringError(f"{sheet_label}: estado de marca desconocido {state!r}")
    return MarkOutcome(
        sheet=sheet_label,
        cut=cut,
        printed_number=printed_number,
        category=category,
        expected=expected,
        state=state,
        value=mark["value"],
        fill=mark["fill"],
        threshold=mark["threshold"],
        margin=mark["margin"],
        reject_reason=None,
    )


def _expected(
    sheet_label: str, printed_number: str, truth_answers: dict[str, str | None]
) -> str | None:
    if printed_number not in truth_answers:
        raise ScoringError(
            f"{sheet_label}: la pregunta {printed_number} no esta en la transcripcion "
            "(corre `python -m goldset.validate` primero)"
        )
    return truth_answers[printed_number]
