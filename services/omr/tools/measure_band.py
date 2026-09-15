"""Medicion de la tierra de nadie (pendientes fase 6a-1), sin tocar el motor.

    python -m tools.measure_band goldset/data --cut dirty --synthetic
    python -m tools.measure_band goldset/real
    python -m tools.measure_band goldset/data --cut dirty --synthetic --candidates 3:0.08 2:0.08

Para cada hoja muestrea los fills como lo hace el motor (registro local + relleno del
disco), arma el umbral de la pagina (`page_threshold`) y vuelve a clasificar cada campo
con `BubbleGroupReader._classify` bajo cada candidato de banda
(`CLUSTER_BAND_STD_FACTOR:CLUSTER_BAND_MIN_WIDTH`), parchando esas dos constantes de
`app.classify`. El primer candidato es siempre el vigente.

Cruza el resultado con la verdad de la hoja y, en el sintetico (`--synthetic`), con el
ESTILO del trazo que el generador dibujo en cada campo (`plan_sheet` es determinista:
misma semilla, mismos estilos): relleno franco, cruz, tilde, relleno a medias, borron,
doble. La pregunta que responde: ¿la banda atrapa marcas reales que sin ella serian
correctas, y hay algun trazo-no-respuesta que dependa de ella para ir a revision?
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

OMR_ROOT = Path(__file__).resolve().parents[1]
if str(OMR_ROOT) not in sys.path:
    sys.path.insert(0, str(OMR_ROOT))

from app import classify as classify_module  # noqa: E402
from app.classify import AMBIGUITY_MARGIN, PageThreshold, page_threshold  # noqa: E402
from app.geometry import point_to_px, radius_to_px  # noqa: E402
from app.pipeline import _rectify_oriented  # noqa: E402
from app.readers import BubbleGroupReader, bubble_samples  # noqa: E402
from app.rectify import RectifiedPage  # noqa: E402
from app.registration import register_group  # noqa: E402
from app.sources import ImagePageSource  # noqa: E402
from goldset.dataset import (  # noqa: E402
    GoldSheet,
    consensus_answers,
    discover_sheets,
    load_spec,
    load_truth,
    page_files,
)
from goldset.make_synthetic import DEFAULT_SEED, DEFAULT_SHEETS, allocate, plan_sheet  # noqa: E402
from tools.measure_registration import fill_at  # noqa: E402

STYLE_FULL = "full"
STYLE_BLANK = "blank"
STYLE_REAL = "real"


@dataclass(frozen=True)
class Candidate:
    std_factor: float
    min_width: float

    @property
    def label(self) -> str:
        return f"max({self.std_factor:g}σ, {self.min_width:g})"


@dataclass(frozen=True)
class FieldSample:
    sheet: str
    printed_number: str
    style: str
    expected: str | None
    field: dict[str, Any]
    fills: list[float]


def synthetic_styles(seed: int, sheets: int) -> dict[str, dict[str, str]]:
    styles: dict[str, dict[str, str]] = {}
    for index, recipe in enumerate(allocate(sheets)):
        rng = np.random.default_rng([seed, index])
        plan = plan_sheet(recipe, index, rng)
        per_field: dict[str, str] = {}
        for field_id, value in plan.marks.items():
            if isinstance(value, list):
                per_field[field_id] = "double"
            elif field_id in plan.smudged:
                per_field[field_id] = "smudge"
            elif field_id in plan.styles:
                per_field[field_id] = plan.styles[field_id]
            elif plan.coverage.get(field_id, 1.0) < 0.7:
                per_field[field_id] = "half"
            else:
                per_field[field_id] = STYLE_FULL
        styles[plan.sheet_id] = per_field
    return styles


def sample_sheet(sheet: GoldSheet, styles: dict[str, str] | None) -> list[FieldSample]:
    truth = load_truth(sheet)
    spec = load_spec(sheet, truth)
    answers = consensus_answers(sheet, truth)
    kind, paths = page_files(sheet)
    if kind != "images" or len(paths) != 1 or spec["pageCount"] != 1:
        return []
    _, bgr = next(ImagePageSource([paths[0].read_bytes()]).pages())
    _, rectified, _, _ = _rectify_oriented(bgr, spec, 0)
    if not isinstance(rectified, RectifiedPage):
        return []
    samples: list[FieldSample] = []
    for field in spec["fields"]:
        if field["pageIndex"] != 0 or field["kind"] != "bubble_group":
            continue
        fixes = register_group(rectified, field["bubbles"])
        fills: list[float] = []
        for bubble, fix in zip(field["bubbles"], fixes, strict=True):
            cx, cy = point_to_px(bubble["center"], rectified.size)
            radius_px = radius_to_px(bubble["radius"], rectified.size)
            fills.append(fill_at(rectified.gray, cx + fix.dx, cy + fix.dy, radius_px))
        expected = answers.get(field["printedNumber"])
        if styles is None:
            style = STYLE_REAL if expected is not None else STYLE_BLANK
        else:
            style = styles.get(field["fieldId"], STYLE_BLANK)
        samples.append(
            FieldSample(sheet.label, field["printedNumber"], style, expected, field, fills)
        )
    return samples


def classify_under(
    candidate: Candidate, threshold: PageThreshold, sample: FieldSample
) -> tuple[str, str | None, str]:
    original = (classify_module.CLUSTER_BAND_STD_FACTOR, classify_module.CLUSTER_BAND_MIN_WIDTH)
    classify_module.CLUSTER_BAND_STD_FACTOR = candidate.std_factor
    classify_module.CLUSTER_BAND_MIN_WIDTH = candidate.min_width
    try:
        bubbles = bubble_samples(sample.field["bubbles"], sample.fills, threshold, AMBIGUITY_MARGIN)
        state, value, _ = BubbleGroupReader()._classify(sample.field, bubbles, threshold.threshold)
        by_margin = any(bubble.margin < AMBIGUITY_MARGIN for bubble in bubbles)
    finally:
        classify_module.CLUSTER_BAND_STD_FACTOR, classify_module.CLUSTER_BAND_MIN_WIDTH = original
    if state == "ambiguous":
        state = "ambiguous:margin" if by_margin else "ambiguous:band"
    return state, value, "-"


def outcome_of(state: str, value: str | None, expected: str | None) -> str:
    if state.startswith("ambiguous") or state == "multiple":
        return "review"
    read = value if state == "marked" else None
    return "correct" if read == expected else "WRONG"


def measure(
    data_dir: Path,
    candidates: list[Candidate],
    styles_by_sheet: dict[str, dict[str, str]] | None,
    cuts: list[str] | None = None,
) -> dict[str, Any]:
    sheets = [s for s in discover_sheets(data_dir) if not cuts or s.cut in cuts]
    tables: dict[str, dict[tuple[str, str], int]] = {c.label: defaultdict(int) for c in candidates}
    wrong: dict[str, list[str]] = {c.label: [] for c in candidates}
    band_only: dict[str, list[str]] = {c.label: [] for c in candidates}
    for sheet in sheets:
        styles = None
        if styles_by_sheet is not None:
            styles = styles_by_sheet.get(sheet.label.split("/")[-1], {})
        samples = sample_sheet(sheet, styles)
        if not samples:
            continue
        threshold = page_threshold([fill for sample in samples for fill in sample.fills])
        if not threshold.separable:
            continue
        for sample in samples:
            for candidate in candidates:
                state, value, _ = classify_under(candidate, threshold, sample)
                outcome = outcome_of(state, value, sample.expected)
                tables[candidate.label][(sample.style, f"{state}/{outcome}")] += 1
                where = (
                    f"{sample.sheet} q{sample.printed_number} ({sample.style}, "
                    f"verdad {sample.expected or 'blanco'}, "
                    f"fills {[round(f, 2) for f in sample.fills]}, "
                    f"umbral {threshold.threshold:.2f})"
                )
                if outcome == "WRONG":
                    wrong[candidate.label].append(where)
                if state == "ambiguous:band":
                    band_only[candidate.label].append(where)
    return {"tables": tables, "wrong": wrong, "bandOnly": band_only, "sheets": len(sheets)}


def render(report: dict[str, Any], candidates: list[Candidate]) -> str:
    lines = [f"{report['sheets']} hojas"]
    for candidate in candidates:
        table = report["tables"][candidate.label]
        lines.append("")
        lines.append(f"## banda {candidate.label}")
        styles = sorted({style for style, _ in table})
        states = sorted({state for _, state in table})
        lines.append("| estilo | " + " | ".join(states) + " |")
        lines.append("|---|" + "---|" * len(states))
        for style in styles:
            cells = [str(table.get((style, state), 0) or "") for state in states]
            lines.append(f"| {style} | " + " | ".join(cells) + " |")
        lines.append("")
        lines.append(f"incorrectas confiadas: {len(report['wrong'][candidate.label])}")
        lines.extend(f"  - {entry}" for entry in report["wrong"][candidate.label])
        lines.append(f"ambiguas SOLO por la banda: {len(report['bandOnly'][candidate.label])}")
        lines.extend(f"  - {entry}" for entry in report["bandOnly"][candidate.label])
    return "\n".join(lines)


def parse_candidate(raw: str) -> Candidate:
    factor, width = raw.split(":")
    return Candidate(float(factor), float(width))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tools.measure_band")
    parser.add_argument("data_dir", type=Path)
    parser.add_argument(
        "--synthetic", action="store_true", help="cruzar con los estilos del generador"
    )
    parser.add_argument("--cut", nargs="*", default=None, help="solo estos cortes")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--sheets", type=int, default=DEFAULT_SHEETS)
    parser.add_argument("--candidates", nargs="*", default=["3:0.08", "2:0.08", "3:0.12"])
    args = parser.parse_args(argv)

    current = Candidate(
        classify_module.CLUSTER_BAND_STD_FACTOR, classify_module.CLUSTER_BAND_MIN_WIDTH
    )
    candidates = [current] + [c for c in map(parse_candidate, args.candidates) if c != current]
    styles = synthetic_styles(args.seed, args.sheets) if args.synthetic else None
    report = measure(args.data_dir, candidates, styles, args.cut)
    print(render(report, candidates))
    return 0


if __name__ == "__main__":
    sys.exit(main())
