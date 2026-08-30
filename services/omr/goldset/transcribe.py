"""Herramienta de transcripcion manual (T5): stdin/stdout puro, sin UI web.

    python -m goldset.transcribe <sheet_dir>                (dos pasadas seguidas)
    python -m goldset.transcribe <sheet_dir> --by persona2  (una sola pasada)

Recorre los printedNumbers del layout-spec en orden (pagina, numero) mostrando
las alternativas validas y captura por teclado: una letra (o varias si el
campo es selectMode multiple), '-' para blanco, 'z' para deshacer la anterior.
Escribe/mergea truth.json conservando la transcripcion de la otra persona si
ya existe, y al final muestra las discrepancias entre ambas para resolverlas
mirando el papel.

El layout-spec se resuelve asi: --spec explicito > layoutSpecFile del
truth.json existente > ../layout-spec.json (el spec compartido del corte).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .dataset import answer_discrepancies, printed_number_sort_key

DEFAULT_PASSES = ("persona1", "persona2")
BLANK_INPUT = "-"
UNDO_INPUT = "z"


def ordered_fields(spec: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        spec["fields"],
        key=lambda field: (field["pageIndex"], printed_number_sort_key(field["printedNumber"])),
    )


def normalize_answer(raw: str, field: dict[str, Any]) -> tuple[bool, str | None]:
    text = raw.strip().upper()
    if text == BLANK_INPUT:
        return True, None
    values = [bubble["value"] for bubble in field["bubbles"]]
    if not text or any(char not in values for char in text):
        return False, None
    if field["selectMode"] != "multiple" and len(text) > 1:
        return False, None
    ordered = "".join(value for value in values if value in set(text))
    return True, ordered


def capture_pass(spec: dict[str, Any], by: str) -> dict[str, str | None]:
    fields = ordered_fields(spec)
    answers: dict[str, str | None] = {}
    print(f"\n=== Pasada de {by} — {len(fields)} preguntas ===")
    print(f"Una letra por respuesta, '{BLANK_INPUT}' = en blanco, '{UNDO_INPUT}' = deshacer.\n")
    position = 0
    while position < len(fields):
        field = fields[position]
        options = "/".join(bubble["value"] for bubble in field["bubbles"])
        raw = input(f"  P{field['printedNumber']} [{options}]: ")
        if raw.strip().lower() == UNDO_INPUT:
            if position == 0:
                print("    (nada que deshacer)")
            else:
                position -= 1
                undone = fields[position]
                answers.pop(undone["printedNumber"], None)
                print(f"    (deshecho P{undone['printedNumber']})")
            continue
        ok, value = normalize_answer(raw, field)
        if not ok:
            print(f"    Respuesta invalida: usa {options}, '{BLANK_INPUT}' o '{UNDO_INPUT}'")
            continue
        answers[field["printedNumber"]] = value
        position += 1
    return answers


def merge_truth(
    existing: dict[str, Any] | None,
    sheet_dir: Path,
    spec_file: str,
    by: str,
    answers: dict[str, str | None],
) -> dict[str, Any]:
    truth = dict(existing or {})
    truth.setdefault("sheetId", sheet_dir.name)
    truth["layoutSpecFile"] = spec_file
    transcriptions = [
        t for t in truth.get("transcriptions", []) if t.get("by") != by
    ]
    transcriptions.append({"by": by, "answers": answers})
    truth["transcriptions"] = transcriptions
    return truth


def report_discrepancies(truth: dict[str, Any]) -> None:
    transcriptions = truth.get("transcriptions", [])
    if len(transcriptions) < 2:
        print("\nFalta la segunda transcripcion (otra persona debe correr --by).")
        return
    first, second = transcriptions[:2]
    differing = answer_discrepancies(first["answers"], second["answers"])
    if not differing:
        print("\nLas dos transcripciones COINCIDEN. Hoja lista.")
        return
    print(f"\nDISCREPANCIAS ({len(differing)}) — resolver mirando el papel:")
    for printed_number in differing:
        value_a = first["answers"][printed_number]
        value_b = second["answers"][printed_number]
        print(
            f"  P{printed_number}: {first['by']}={value_a or 'blanco'} "
            f"vs {second['by']}={value_b or 'blanco'}"
        )


def resolve_spec_file(sheet_dir: Path, explicit: str | None) -> str:
    if explicit:
        return explicit
    truth_path = sheet_dir / "truth.json"
    if truth_path.is_file():
        existing = json.loads(truth_path.read_text(encoding="utf-8"))
        spec_file = existing.get("layoutSpecFile")
        if isinstance(spec_file, str) and spec_file:
            return spec_file
    return "../layout-spec.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m goldset.transcribe",
        description="Transcribe a mano una hoja del conjunto de oro (doble pasada)",
    )
    parser.add_argument("sheet_dir")
    parser.add_argument("--by", default=None, help="solo esta pasada (p.ej. persona2)")
    parser.add_argument("--spec", default=None, help="ruta al layout-spec relativa a la hoja")
    args = parser.parse_args(argv)

    sheet_dir = Path(args.sheet_dir)
    if not sheet_dir.is_dir():
        print(f"ERROR: no existe el directorio de hoja {sheet_dir}")
        return 2
    spec_file = resolve_spec_file(sheet_dir, args.spec)
    spec_path = (sheet_dir / spec_file).resolve()
    if not spec_path.is_file():
        print(f"ERROR: no existe el layout-spec {spec_path}")
        return 2
    spec = json.loads(spec_path.read_text(encoding="utf-8"))

    truth_path = sheet_dir / "truth.json"
    truth: dict[str, Any] | None = (
        json.loads(truth_path.read_text(encoding="utf-8")) if truth_path.is_file() else None
    )
    passes = [args.by] if args.by else list(DEFAULT_PASSES)
    try:
        for by in passes:
            answers = capture_pass(spec, by)
            truth = merge_truth(truth, sheet_dir, spec_file, by, answers)
            truth_path.write_text(
                json.dumps(truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            print(f"\ntruth.json actualizado con la pasada de {by}.")
    except (KeyboardInterrupt, EOFError):
        print("\nTranscripcion interrumpida; no se guardo la pasada en curso.")
        return 130

    report_discrepancies(truth or {})
    return 0


if __name__ == "__main__":
    sys.exit(main())
