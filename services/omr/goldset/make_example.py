"""Regenera el ejemplo sintetico comiteado en goldset/example/ (T4).

    python -m goldset.make_example

Usa tests/synthetic.py (el generador espejo del impresor) para renderizar UNA
hoja limpia con marcas conocidas, y escribe el layout-spec del corte, la
imagen page-0.png y un truth.json con 2 transcripciones identicas. Es la
unica excepcion al gitignore de data/: prueba que el harness funciona de
punta a punta ANTES de que exista papel real. Determinista (semilla fija).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

OMR_ROOT = Path(__file__).resolve().parents[1]
if str(OMR_ROOT) not in sys.path:
    sys.path.insert(0, str(OMR_ROOT))

from tests import synthetic as syn  # noqa: E402

EXAMPLE_DIR = Path(__file__).parent / "example"
CUT = "phone-good"
SHEET_DIR_NAME = "hoja-ejemplo-001"
MARKS = {f"f_{index:03d}": value for index, value in zip(range(1, 8), "ABCDABC", strict=True)}
ANSWERS: dict[str, str | None] = {
    **{str(index): value for index, value in zip(range(1, 8), "ABCDABC", strict=True)},
    "8": None,
}


def make_example() -> Path:
    spec = syn.make_layout_spec(fields_per_page=8)
    cut_dir = EXAMPLE_DIR / CUT
    sheet_dir = cut_dir / SHEET_DIR_NAME
    sheet_dir.mkdir(parents=True, exist_ok=True)

    (cut_dir / "layout-spec.json").write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    gray = syn.render_page(spec, 0, marks=MARKS, rng=np.random.default_rng(42))
    (sheet_dir / "page-0.png").write_bytes(syn.png_bytes(gray))

    truth = {
        "sheetId": syn.SHEET_ID,
        "layoutSpecFile": "../layout-spec.json",
        "transcriptions": [
            {"by": "persona1", "answers": ANSWERS},
            {"by": "persona2", "answers": ANSWERS},
        ],
        "notes": "Hoja sintetica generada con `python -m goldset.make_example`; "
        "no es papel real.",
    }
    (sheet_dir / "truth.json").write_text(
        json.dumps(truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return EXAMPLE_DIR


if __name__ == "__main__":
    print(f"Ejemplo regenerado en {make_example()}")
