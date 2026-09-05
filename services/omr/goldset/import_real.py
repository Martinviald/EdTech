"""Trae las fotos del corte real desde fuera del repo: `python -m goldset.import_real <origen>...`

Las imagenes de `goldset/real/` NO se comitean (son fotos de hojas reales, pesan
megabytes y el corte crece con el tiempo). Lo que si se comitea es la verdad y la
procedencia: cada `truth.json` declara `sourceFile`, el nombre del archivo original.
Este comando busca ese nombre en los directorios de origen y lo copia como
`page-0.<ext>` en la carpeta de la hoja, que es lo que `dataset.py` espera.

Idempotente: una hoja que ya tiene su `page-0` se deja como esta salvo `--force`.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from .dataset import DatasetError, discover_sheets, load_truth

DEFAULT_REAL_DIR = Path(__file__).parent / "real"


def import_photos(
    real_dir: Path, sources: list[Path], force: bool = False
) -> tuple[int, list[str]]:
    copied = 0
    problems: list[str] = []
    for sheet in discover_sheets(real_dir):
        try:
            truth = load_truth(sheet)
        except DatasetError as error:
            problems.append(str(error))
            continue
        source_name = truth.get("sourceFile")
        if not isinstance(source_name, str) or not source_name:
            problems.append(f"{sheet.label}: truth.json sin sourceFile")
            continue
        existing = [p for p in sheet.sheet_dir.glob("page-0.*")]
        if existing and not force:
            continue
        found = next((d / source_name for d in sources if (d / source_name).is_file()), None)
        if found is None:
            problems.append(
                f"{sheet.label}: no encontre {source_name} en {[str(d) for d in sources]}"
            )
            continue
        target = sheet.sheet_dir / f"page-0{found.suffix.lower()}"
        shutil.copyfile(found, target)
        copied += 1
    return copied, problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m goldset.import_real",
        description="Copia las fotos del corte real segun el sourceFile de cada truth.json",
    )
    parser.add_argument("sources", nargs="+", type=Path, help="Directorios donde buscar las fotos")
    parser.add_argument("--real-dir", type=Path, default=DEFAULT_REAL_DIR)
    parser.add_argument("--force", action="store_true", help="Reemplazar page-0 existentes")
    args = parser.parse_args(argv)

    try:
        copied, problems = import_photos(args.real_dir, args.sources, args.force)
    except DatasetError as error:
        print(f"ERROR: {error}")
        return 2
    print(f"{copied} foto(s) copiadas en {args.real_dir}")
    for problem in problems:
        print(f"  - {problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
