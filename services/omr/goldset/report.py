"""Reporte del conjunto de oro: las tres cifras del criterio + desgloses.

Regla del veredicto (06-plan-mvp-v1.md): la tercera cifra DOMINA. Un 97% de
correctas con 0 incorrectas-confiadas APRUEBA; un 99,5% con 3 confiadas NO —
significa que el clasificador no sabe cuando no sabe. Formalmente:

    APRUEBA <=> incorrectas_confiadas == 0
            AND enviadas_a_revision <= 3%
            AND paginas_sin_leer == 0

Con esas tres condiciones, correctas >= 97% queda garantizado por aritmetica
(correctas = 100% - revision - sin_leer - confiadas). El objetivo >= 99% de
correctas se reporta aparte como meta informativa.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from app.classify import AMBIGUITY_MARGIN

from .scoring import (
    CATEGORY_CORRECT,
    CATEGORY_REVIEW,
    CATEGORY_UNREAD,
    CATEGORY_WRONG,
    MarkOutcome,
)

CORRECT_TARGET_PCT = 99.0
REVIEW_MAX_PCT = 3.0
TOP_WRONG_LIMIT = 20
MARGIN_BIN_WIDTH = 0.05
MARGIN_BIN_COUNT = 10


@dataclass(frozen=True)
class Metrics:
    total: int
    correct: int
    review: int
    wrong: int
    unread: int

    @property
    def correct_pct(self) -> float:
        return 100.0 * self.correct / self.total if self.total else 0.0

    @property
    def review_pct(self) -> float:
        return 100.0 * self.review / self.total if self.total else 0.0

    @property
    def approves(self) -> bool:
        return (
            self.total > 0
            and self.wrong == 0
            and self.review_pct <= REVIEW_MAX_PCT
            and self.unread == 0
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "totalMarks": self.total,
            "correct": self.correct,
            "correctPct": round(self.correct_pct, 2),
            "review": self.review,
            "reviewPct": round(self.review_pct, 2),
            "confidentWrong": self.wrong,
            "unread": self.unread,
        }


def compute_metrics(outcomes: list[MarkOutcome]) -> Metrics:
    counts = {
        CATEGORY_CORRECT: 0,
        CATEGORY_REVIEW: 0,
        CATEGORY_WRONG: 0,
        CATEGORY_UNREAD: 0,
    }
    for outcome in outcomes:
        counts[outcome.category] += 1
    return Metrics(
        total=len(outcomes),
        correct=counts[CATEGORY_CORRECT],
        review=counts[CATEGORY_REVIEW],
        wrong=counts[CATEGORY_WRONG],
        unread=counts[CATEGORY_UNREAD],
    )


def build_report(
    outcomes: list[MarkOutcome], data_dir: Path, sheet_count: int, mode: str
) -> dict[str, Any]:
    metrics = compute_metrics(outcomes)
    by_cut: dict[str, list[MarkOutcome]] = {}
    for outcome in outcomes:
        by_cut.setdefault(outcome.cut, []).append(outcome)
    reject_reasons: dict[str, int] = {}
    for outcome in outcomes:
        if outcome.category == CATEGORY_REVIEW and outcome.reject_reason:
            reject_reasons[outcome.reject_reason] = reject_reasons.get(outcome.reject_reason, 0) + 1
    wrong = sorted(
        (o for o in outcomes if o.category == CATEGORY_WRONG),
        key=lambda o: (o.margin is None, o.margin if o.margin is not None else 0.0),
        reverse=True,
    )
    return {
        "generatedOn": date.today().isoformat(),
        "dataDir": str(data_dir),
        "mode": mode,
        "sheetCount": sheet_count,
        "ambiguityMargin": AMBIGUITY_MARGIN,
        "verdict": "APRUEBA" if metrics.approves else "NO APRUEBA",
        "metrics": {
            "global": metrics.to_json(),
            "byCut": {cut: compute_metrics(cut_outcomes).to_json()
                      for cut, cut_outcomes in sorted(by_cut.items())},
        },
        "reviewByRejectReason": dict(sorted(reject_reasons.items())),
        "confidentWrong": [o.to_json() for o in wrong],
        "confidentWrongMarginHistogram": _margin_histogram(wrong),
        "marks": [o.to_json() for o in outcomes],
    }


def _margin_histogram(wrong: list[MarkOutcome]) -> list[dict[str, Any]]:
    bins = [
        {
            "from": round(index * MARGIN_BIN_WIDTH, 2),
            "to": round((index + 1) * MARGIN_BIN_WIDTH, 2),
            "count": 0,
        }
        for index in range(MARGIN_BIN_COUNT)
    ]
    for outcome in wrong:
        if outcome.margin is None:
            continue
        index = min(int(outcome.margin / MARGIN_BIN_WIDTH), MARGIN_BIN_COUNT - 1)
        bins[index]["count"] += 1
    return bins


def render_markdown(report: dict[str, Any]) -> str:
    metrics = report["metrics"]["global"]
    lines = [
        f"# Conjunto de oro — reporte {report['generatedOn']}",
        "",
        f"- Datos: `{report['dataDir']}` ({report['sheetCount']} hojas, "
        f"{metrics['totalMarks']} marcas)",
        f"- Modo: {report['mode']}",
        f"- `AMBIGUITY_MARGIN` vigente: {report['ambiguityMargin']}",
        "",
        f"## Veredicto: **{report['verdict']}**",
        "",
        "| Metrica | Valor | Umbral | Cumple |",
        "|---|---|---|---|",
        _metric_row(
            "Marcas leidas correctamente",
            f"{metrics['correctPct']:.2f}%",
            f">= {CORRECT_TARGET_PCT}% (meta)",
            metrics["correctPct"] >= CORRECT_TARGET_PCT,
        ),
        _metric_row(
            "Marcas enviadas a revision",
            f"{metrics['reviewPct']:.2f}%",
            f"<= {REVIEW_MAX_PCT}%",
            metrics["reviewPct"] <= REVIEW_MAX_PCT,
        ),
        _metric_row(
            "Incorrectas decididas con confianza",
            str(metrics["confidentWrong"]),
            "= 0 (dominante)",
            metrics["confidentWrong"] == 0,
        ),
        "",
        f"Paginas sin leer (timeout/omitidas): {metrics['unread']} marcas afectadas"
        + (" — bloquea el veredicto" if metrics["unread"] else ""),
        "",
        "La tercera cifra domina: un 97% de correctas con 0 confiadas-incorrectas "
        "APRUEBA; un 99,5% con 3 confiadas NO (el clasificador no sabe cuando no sabe).",
        "",
        "## Desglose por corte",
        "",
        "| Corte | Marcas | Correctas | Revision | Confiadas-incorrectas | Sin leer |",
        "|---|---|---|---|---|---|",
    ]
    for cut, cut_metrics in report["metrics"]["byCut"].items():
        lines.append(
            f"| {cut} | {cut_metrics['totalMarks']} | {cut_metrics['correctPct']:.2f}% "
            f"| {cut_metrics['reviewPct']:.2f}% | {cut_metrics['confidentWrong']} "
            f"| {cut_metrics['unread']} |"
        )
    lines.extend(_reject_reason_section(report))
    lines.extend(_wrong_section(report))
    lines.extend(_margin_section(report))
    return "\n".join(lines) + "\n"


def _metric_row(label: str, value: str, threshold: str, ok: bool) -> str:
    return f"| {label} | {value} | {threshold} | {'SI' if ok else 'NO'} |"


def _reject_reason_section(report: dict[str, Any]) -> list[str]:
    lines = ["", "## Marcas a revision por rejectReason de pagina", ""]
    reasons = report["reviewByRejectReason"]
    if not reasons:
        return lines + ["Ninguna pagina rechazada por calidad."]
    lines.extend(["| rejectReason | Marcas |", "|---|---|"])
    lines.extend(f"| {reason} | {count} |" for reason, count in reasons.items())
    return lines


def _wrong_section(report: dict[str, Any]) -> list[str]:
    lines = ["", f"## Top-{TOP_WRONG_LIMIT} incorrectas-confiadas", ""]
    wrong = report["confidentWrong"]
    if not wrong:
        return lines + ["Ninguna. Es la cifra que importa."]
    lines.extend(
        [
            "| Hoja | Pregunta | Esperado | Leido | fill | threshold | margin |",
            "|---|---|---|---|---|---|---|",
        ]
    )
    for outcome in wrong[:TOP_WRONG_LIMIT]:
        expected = outcome["expected"] if outcome["expected"] is not None else "blanco"
        read = outcome["value"] if outcome["value"] is not None else outcome["state"]
        lines.append(
            f"| {outcome['sheet']} | {outcome['printedNumber']} | {expected} | {read} "
            f"| {outcome['fill']} | {outcome['threshold']} | {outcome['margin']} |"
        )
    return lines


def _margin_section(report: dict[str, Any]) -> list[str]:
    lines = [
        "",
        "## Distribucion de margins de las incorrectas-confiadas",
        "",
        f"Para calibrar `AMBIGUITY_MARGIN` (hoy {report['ambiguityMargin']}): toda "
        "incorrecta con margin bajo se elimina subiendo el umbral (a costa de mas revision).",
        "",
    ]
    if not report["confidentWrong"]:
        return lines + ["Sin incorrectas-confiadas: nada que calibrar."]
    lines.extend(["| Margin | Incorrectas |", "|---|---|"])
    for bin_ in report["confidentWrongMarginHistogram"]:
        lines.append(f"| {bin_['from']:.2f}–{bin_['to']:.2f} | {bin_['count']} |")
    return lines


def write_reports(report: dict[str, Any], reports_dir: Path) -> tuple[Path, Path]:
    reports_dir.mkdir(parents=True, exist_ok=True)
    stem = f"report-{report['generatedOn']}"
    md_path = reports_dir / f"{stem}.md"
    json_path = reports_dir / f"{stem}.json"
    md_path.write_text(render_markdown(report), encoding="utf-8")
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return md_path, json_path
