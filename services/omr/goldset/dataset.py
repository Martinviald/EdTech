"""Estructura del conjunto de oro (O4): descubrimiento y carga de hojas.

Formato en disco (ver goldset/README.md):

    <data_dir>/<corte>/layout-spec.json
    <data_dir>/<corte>/<hoja-id>/page-0.png|jpg|jpeg  (o un unico *.pdf)
    <data_dir>/<corte>/<hoja-id>/truth.json

Convencion de paginas: los archivos se digitalizan en ORDEN LOGICO, es decir
`page-N` (o la pagina N del PDF) corresponde a la pagina logica N del
LayoutSpec. El QR sigue mandando dentro del pipeline (CD-7); esta convencion
solo se usa para saber que campos esperar cuando una pagina se rechaza o no
aparece en el resultado.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CUTS = ("scanner-adf", "phone-good", "phone-bad", "dirty", "real-phone", "real-scanner")
PAGE_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg")
PAGE_FILE_PATTERN = re.compile(r"^page-(\d+)$")
REQUIRED_TRANSCRIPTIONS = 2

# `truthSource` en truth.json dice de donde sale la verdad y cuantas transcripciones
# hacen falta. Sin el campo, la verdad es la doble transcripcion de O4 (2 personas que
# leen el papel). En los cortes `real-*` la verdad puede venir POR CONSTRUCCION: la
# persona que rellena la hoja deja escrita la clave ANTES de fotografiarla, asi que no
# hay lectura que verificar por duplicado (una transcripcion, `by` = quien rellena).
# `adjudication` es la verdad provisional de un lote real ya adjudicado en la cola de
# revision (una transcripcion, `by` = revisor + motor); vale para seguir el cambio de
# lectura de ese lote, no como juez.
TRUTH_SOURCE_DOUBLE = "double-transcription"
TRUTH_SOURCE_CONSTRUCTION = "construction"
TRUTH_SOURCE_ADJUDICATION = "adjudication"
TRANSCRIPTIONS_BY_SOURCE = {
    TRUTH_SOURCE_DOUBLE: REQUIRED_TRANSCRIPTIONS,
    TRUTH_SOURCE_CONSTRUCTION: 1,
    TRUTH_SOURCE_ADJUDICATION: 1,
}


class DatasetError(Exception):
    pass


@dataclass(frozen=True)
class GoldSheet:
    cut: str
    sheet_dir: Path

    @property
    def label(self) -> str:
        return f"{self.cut}/{self.sheet_dir.name}"

    @property
    def truth_path(self) -> Path:
        return self.sheet_dir / "truth.json"


def discover_sheets(data_dir: Path) -> list[GoldSheet]:
    if not data_dir.is_dir():
        raise DatasetError(f"No existe el directorio de datos: {data_dir}")
    sheets: list[GoldSheet] = []
    for cut in CUTS:
        cut_dir = data_dir / cut
        if not cut_dir.is_dir():
            continue
        for sheet_dir in sorted(path for path in cut_dir.iterdir() if path.is_dir()):
            sheets.append(GoldSheet(cut=cut, sheet_dir=sheet_dir))
    if not sheets:
        raise DatasetError(
            f"Sin hojas en {data_dir}. Se esperan subdirectorios "
            f"{'/'.join(CUTS)} con una carpeta por hoja."
        )
    return sheets


def load_truth(sheet: GoldSheet) -> dict[str, Any]:
    if not sheet.truth_path.is_file():
        raise DatasetError(f"{sheet.label}: falta truth.json")
    try:
        truth = json.loads(sheet.truth_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise DatasetError(f"{sheet.label}: truth.json no parsea: {error}") from error
    if not isinstance(truth, dict):
        raise DatasetError(f"{sheet.label}: truth.json debe ser un objeto JSON")
    return truth


def load_spec(sheet: GoldSheet, truth: dict[str, Any]) -> dict[str, Any]:
    spec_file = truth.get("layoutSpecFile")
    if not isinstance(spec_file, str) or not spec_file:
        raise DatasetError(f"{sheet.label}: truth.json sin layoutSpecFile")
    spec_path = (sheet.sheet_dir / spec_file).resolve()
    if not spec_path.is_file():
        raise DatasetError(f"{sheet.label}: layoutSpecFile no existe: {spec_path}")
    try:
        return json.loads(spec_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise DatasetError(f"{sheet.label}: layout-spec no parsea: {error}") from error


def page_files(sheet: GoldSheet) -> tuple[str, list[Path]]:
    images: list[tuple[int, Path]] = []
    pdfs: list[Path] = []
    for path in sorted(sheet.sheet_dir.iterdir()):
        if path.suffix.lower() == ".pdf":
            pdfs.append(path)
        elif path.suffix.lower() in PAGE_IMAGE_SUFFIXES:
            match = PAGE_FILE_PATTERN.match(path.stem)
            if match is None:
                raise DatasetError(
                    f"{sheet.label}: imagen con nombre invalido {path.name} "
                    "(se espera page-<n>.png|jpg|jpeg)"
                )
            images.append((int(match.group(1)), path))
    if pdfs and images:
        raise DatasetError(f"{sheet.label}: mezcla PDF e imagenes; debe ser uno u otro")
    if len(pdfs) > 1:
        raise DatasetError(f"{sheet.label}: mas de un PDF")
    if pdfs:
        return "pdf", pdfs
    if not images:
        raise DatasetError(f"{sheet.label}: sin paginas (page-*.png|jpg|jpeg o un *.pdf)")
    indexes = sorted(index for index, _ in images)
    if indexes != list(range(len(indexes))):
        raise DatasetError(
            f"{sheet.label}: indices de pagina no consecutivos desde 0: {indexes}"
        )
    return "images", [path for _, path in sorted(images)]


def count_logical_pages(kind: str, paths: list[Path]) -> int:
    if kind == "images":
        return len(paths)
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(paths[0].read_bytes())
    try:
        return len(document)
    finally:
        document.close()


def fields_by_printed_number(spec: dict[str, Any]) -> dict[str, dict[str, Any]]:
    fields: dict[str, dict[str, Any]] = {}
    for field in spec.get("fields", []):
        fields[field["printedNumber"]] = field
    return fields


def printed_number_sort_key(printed_number: str) -> tuple[Any, ...]:
    parts = printed_number.replace(",", ".").split(".")
    if all(part.isdigit() for part in parts):
        return (0, tuple(int(part) for part in parts))
    return (1, printed_number)


def answer_discrepancies(
    answers_a: dict[str, str | None], answers_b: dict[str, str | None]
) -> list[str]:
    shared = set(answers_a) & set(answers_b)
    return sorted(
        (pn for pn in shared if answers_a[pn] != answers_b[pn]),
        key=printed_number_sort_key,
    )


def transcription_answers(truth: dict[str, Any]) -> list[dict[str, Any]]:
    transcriptions = truth.get("transcriptions")
    if not isinstance(transcriptions, list):
        raise DatasetError("truth.json sin lista transcriptions")
    return transcriptions


def truth_source(truth: dict[str, Any]) -> str:
    source = truth.get("truthSource", TRUTH_SOURCE_DOUBLE)
    if source not in TRANSCRIPTIONS_BY_SOURCE:
        raise DatasetError(
            f"truthSource desconocido {source!r} "
            f"(validos: {', '.join(TRANSCRIPTIONS_BY_SOURCE)})"
        )
    return source


def required_transcriptions(truth: dict[str, Any]) -> int:
    return TRANSCRIPTIONS_BY_SOURCE[truth_source(truth)]


def consensus_answers(sheet: GoldSheet, truth: dict[str, Any]) -> dict[str, str | None]:
    transcriptions = transcription_answers(truth)
    required = required_transcriptions(truth)
    if len(transcriptions) != required:
        raise DatasetError(
            f"{sheet.label}: se requieren exactamente {required} "
            f"transcripciones y hay {len(transcriptions)}"
        )
    if required == 1:
        answers = transcriptions[0].get("answers")
        if not isinstance(answers, dict):
            raise DatasetError(f"{sheet.label}: transcripcion sin answers")
        return answers
    first, second = (t.get("answers") for t in transcriptions)
    if first != second:
        raise DatasetError(
            f"{sheet.label}: las transcripciones difieren; corre "
            "`python -m goldset.validate` para ver las discrepancias"
        )
    if not isinstance(first, dict):
        raise DatasetError(f"{sheet.label}: transcripcion sin answers")
    return first
