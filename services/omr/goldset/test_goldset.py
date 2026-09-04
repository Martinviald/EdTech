"""Prueba del harness del conjunto de oro sobre el ejemplo sintetico (T4).

Es la evidencia de que medir funciona ANTES de tener papel real: validate y
run corren sobre goldset/example/ (una hoja generada con tests/synthetic.py)
y el reporte da 100% correctas, 0 incorrectas-confiadas y veredicto APRUEBA.
"""

from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

import pytest

from goldset import run as goldset_run
from goldset import validate as goldset_validate
from goldset.scoring import (
    CATEGORY_CORRECT,
    CATEGORY_REVIEW,
    CATEGORY_UNREAD,
    CATEGORY_WRONG,
    score_sheet,
)

EXAMPLE_DIR = Path(__file__).parent / "example"
EXAMPLE_TRUTH = EXAMPLE_DIR / "phone-good" / "hoja-ejemplo-001" / "truth.json"


def test_validate_acepta_el_ejemplo(capsys: pytest.CaptureFixture[str]) -> None:
    assert goldset_validate.main([str(EXAMPLE_DIR)]) == 0
    assert "Conjunto valido" in capsys.readouterr().out


def test_validate_reporta_discrepancias_entre_transcripciones(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    data_dir = tmp_path / "data"
    shutil.copytree(EXAMPLE_DIR, data_dir)
    truth_path = data_dir / "phone-good" / "hoja-ejemplo-001" / "truth.json"
    truth = json.loads(truth_path.read_text(encoding="utf-8"))
    truth["transcriptions"][1]["answers"]["3"] = "D"
    truth_path.write_text(json.dumps(truth), encoding="utf-8")

    assert goldset_validate.main([str(data_dir)]) == 1
    output = capsys.readouterr().out
    assert "DISCREPANCIA en pregunta 3" in output
    assert "persona1=C" in output
    assert "persona2=D" in output


def test_run_sobre_el_ejemplo_aprueba(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = goldset_run.main([str(EXAMPLE_DIR), "--reports-dir", str(tmp_path)])
    assert exit_code == 0

    stem = f"report-{date.today().isoformat()}"
    md_path = tmp_path / f"{stem}.md"
    json_path = tmp_path / f"{stem}.json"
    assert md_path.is_file()
    assert "## Veredicto: **APRUEBA**" in md_path.read_text(encoding="utf-8")

    report = json.loads(json_path.read_text(encoding="utf-8"))
    metrics = report["metrics"]["global"]
    assert report["verdict"] == "APRUEBA"
    assert metrics["correctPct"] == 100.0
    assert metrics["reviewPct"] == 0.0
    assert metrics["confidentWrong"] == 0
    assert metrics["unread"] == 0
    assert metrics["totalMarks"] == 8
    assert report["metrics"]["byCut"]["phone-good"]["totalMarks"] == 8
    assert "APRUEBA" in capsys.readouterr().out


def _mini_spec() -> dict:
    def field(number: int, page: int) -> dict:
        return {
            "fieldId": f"f_{number:03d}",
            "kind": "bubble_group",
            "printedNumber": str(number),
            "pageIndex": page,
            "selectMode": "single",
            "bubbles": [
                {"value": value, "center": {"x": 0.1, "y": 0.1}, "radius": 0.01}
                for value in "AB"
            ],
            "region": None,
        }

    return {"pageCount": 2, "fields": [field(1, 0), field(2, 0), field(3, 1)]}


def _mark(number: int, state: str, value: str | None) -> dict:
    return {
        "printedNumber": str(number),
        "state": state,
        "value": value,
        "fill": 0.8,
        "threshold": 0.5,
        "margin": 0.3,
    }


def test_score_sheet_clasifica_las_cuatro_categorias() -> None:
    truth = {"1": "A", "2": None, "3": "B"}
    result = {
        "pages": [
            {
                "pageIndex": 0,
                "quality": {"ok": True, "rejectReason": None},
                "marks": [_mark(1, "marked", "B"), _mark(2, "ambiguous", None)],
            }
        ]
    }
    outcomes = score_sheet("dirty/hoja-x", "dirty", _mini_spec(), truth, result)
    by_number = {o.printed_number: o for o in outcomes}
    assert by_number["1"].category == CATEGORY_WRONG
    assert by_number["1"].expected == "A"
    assert by_number["2"].category == CATEGORY_REVIEW
    assert by_number["3"].category == CATEGORY_UNREAD


def test_score_sheet_pagina_rechazada_manda_todo_a_revision() -> None:
    truth = {"1": "A", "2": None, "3": "B"}
    result = {
        "pages": [
            {
                "pageIndex": 0,
                "quality": {"ok": False, "rejectReason": "blurry"},
                "marks": [],
            },
            {
                "pageIndex": 1,
                "quality": {"ok": True, "rejectReason": None},
                "marks": [_mark(3, "blank", None)],
            },
        ]
    }
    outcomes = score_sheet("phone-bad/hoja-y", "phone-bad", _mini_spec(), truth, result)
    by_number = {o.printed_number: o for o in outcomes}
    assert by_number["1"].category == CATEGORY_REVIEW
    assert by_number["1"].reject_reason == "blurry"
    assert by_number["2"].category == CATEGORY_REVIEW
    assert by_number["3"].category == CATEGORY_WRONG


def test_score_sheet_blank_y_marked_correctos() -> None:
    truth = {"1": "A", "2": None, "3": None}
    result = {
        "pages": [
            {
                "pageIndex": 0,
                "quality": {"ok": True, "rejectReason": None},
                "marks": [_mark(1, "marked", "A"), _mark(2, "blank", None)],
            },
            {
                "pageIndex": 1,
                "quality": {"ok": True, "rejectReason": None},
                "marks": [_mark(3, "blank", None)],
            },
        ]
    }
    outcomes = score_sheet("scanner-adf/hoja-z", "scanner-adf", _mini_spec(), truth, result)
    assert all(o.category == CATEGORY_CORRECT for o in outcomes)
