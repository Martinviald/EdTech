"""Validador del conjunto de oro (T2): `python -m goldset.validate [data_dir]`.

Verifica, hoja por hoja, ANTES de medir nada:
  1. truth.json parsea y tiene exactamente 2 transcripciones de personas distintas.
  2. Las dos transcripciones COINCIDEN (doble verificacion del diseno); si
     difieren se listan las discrepancias por printedNumber para que las dos
     personas las resuelvan mirando el papel.
  3. Los printedNumbers de cada transcripcion cubren EXACTAMENTE los campos
     del layout-spec, y cada respuesta es una combinacion valida de las
     alternativas del campo (o null = en blanco).
  4. Las imagenes/PDF existen y la cantidad de paginas logicas coincide con
     spec.pageCount.

Sale con codigo distinto de 0 y un reporte claro si algo falla.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from .dataset import (
    REQUIRED_TRANSCRIPTIONS,
    DatasetError,
    GoldSheet,
    answer_discrepancies,
    count_logical_pages,
    discover_sheets,
    fields_by_printed_number,
    load_spec,
    load_truth,
    page_files,
    printed_number_sort_key,
    required_transcriptions,
    transcription_answers,
)

DEFAULT_DATA_DIR = Path(__file__).parent / "data"


def validate_sheet(sheet: GoldSheet) -> list[str]:
    try:
        truth = load_truth(sheet)
        spec = load_spec(sheet, truth)
    except DatasetError as error:
        return [str(error)]

    errors: list[str] = []
    errors.extend(_validate_pages(sheet, spec))

    try:
        transcriptions = transcription_answers(truth)
    except DatasetError as error:
        return errors + [f"{sheet.label}: {error}"]

    try:
        required = required_transcriptions(truth)
    except DatasetError as error:
        return errors + [f"{sheet.label}: {error}"]
    errors.extend(_validate_transcription_shape(sheet, transcriptions, required))
    fields = fields_by_printed_number(spec)
    for transcription in transcriptions:
        errors.extend(_validate_answers(sheet, transcription, fields))
    if required == REQUIRED_TRANSCRIPTIONS and len(transcriptions) == REQUIRED_TRANSCRIPTIONS:
        errors.extend(_transcription_discrepancies(sheet, transcriptions))
    return errors


def _validate_pages(sheet: GoldSheet, spec: dict[str, Any]) -> list[str]:
    try:
        kind, paths = page_files(sheet)
        logical_pages = count_logical_pages(kind, paths)
    except DatasetError as error:
        return [str(error)]
    except Exception as error:
        return [f"{sheet.label}: no se pudieron contar las paginas: {error}"]
    expected = spec.get("pageCount")
    if logical_pages != expected:
        return [
            f"{sheet.label}: {logical_pages} paginas digitalizadas pero el "
            f"spec declara pageCount={expected}"
        ]
    return []


def _validate_transcription_shape(
    sheet: GoldSheet, transcriptions: list[dict[str, Any]], required: int
) -> list[str]:
    errors: list[str] = []
    if len(transcriptions) != required:
        why = "doble verificacion" if required == REQUIRED_TRANSCRIPTIONS else "truthSource"
        errors.append(
            f"{sheet.label}: se requieren exactamente {required} "
            f"transcripciones ({why}) y hay {len(transcriptions)}"
        )
    names = [t.get("by") for t in transcriptions]
    if any(not isinstance(name, str) or not name for name in names):
        errors.append(f"{sheet.label}: toda transcripcion necesita un campo 'by' no vacio")
    elif len(set(names)) != len(names):
        errors.append(
            f"{sheet.label}: las transcripciones deben ser de personas distintas ({names})"
        )
    return errors


def _validate_answers(
    sheet: GoldSheet, transcription: dict[str, Any], fields: dict[str, dict[str, Any]]
) -> list[str]:
    by = transcription.get("by", "?")
    answers = transcription.get("answers")
    if not isinstance(answers, dict):
        return [f"{sheet.label} [{by}]: transcripcion sin objeto answers"]

    errors: list[str] = []
    missing = sorted(set(fields) - set(answers), key=printed_number_sort_key)
    extra = sorted(set(answers) - set(fields), key=printed_number_sort_key)
    if missing:
        errors.append(f"{sheet.label} [{by}]: faltan respuestas para {', '.join(missing)}")
    if extra:
        errors.append(
            f"{sheet.label} [{by}]: respuestas para preguntas fuera del spec: {', '.join(extra)}"
        )
    for printed_number, answer in answers.items():
        field = fields.get(printed_number)
        if field is None or answer is None:
            continue
        valid_values = {bubble["value"] for bubble in field["bubbles"]}
        if not isinstance(answer, str) or not answer or any(
            value not in valid_values for value in answer
        ):
            errors.append(
                f"{sheet.label} [{by}]: pregunta {printed_number} tiene respuesta "
                f"invalida {answer!r} (validas: {'/'.join(sorted(valid_values))} o null)"
            )
    return errors


def _transcription_discrepancies(
    sheet: GoldSheet, transcriptions: list[dict[str, Any]]
) -> list[str]:
    first, second = transcriptions
    answers_a = first.get("answers")
    answers_b = second.get("answers")
    if not isinstance(answers_a, dict) or not isinstance(answers_b, dict):
        return []
    return [
        f"{sheet.label}: DISCREPANCIA en pregunta {printed_number}: "
        f"{first.get('by', '?')}={_show(answers_a[printed_number])} vs "
        f"{second.get('by', '?')}={_show(answers_b[printed_number])} — resolver mirando el papel"
        for printed_number in answer_discrepancies(answers_a, answers_b)
    ]


def _show(value: str | None) -> str:
    return "blanco" if value is None else value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m goldset.validate",
        description="Valida la estructura y la doble transcripcion del conjunto de oro",
    )
    parser.add_argument("data_dir", nargs="?", default=str(DEFAULT_DATA_DIR))
    args = parser.parse_args(argv)

    try:
        sheets = discover_sheets(Path(args.data_dir))
    except DatasetError as error:
        print(f"ERROR: {error}")
        return 2

    all_errors: list[str] = []
    for sheet in sheets:
        all_errors.extend(validate_sheet(sheet))

    if all_errors:
        print(f"Conjunto INVALIDO: {len(all_errors)} problema(s) en {len(sheets)} hoja(s)\n")
        for error in all_errors:
            print(f"  - {error}")
        return 1
    print(f"Conjunto valido: {len(sheets)} hoja(s), transcripciones completas y coincidentes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
