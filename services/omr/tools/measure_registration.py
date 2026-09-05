"""Arnes de MEDICION del registro de burbujas, sobre un dataset con formato de goldset.

    python -m tools.measure_registration goldset/real
    python -m tools.measure_registration goldset/real --json /tmp/registro.json

El conjunto de oro mide DECISIONES (correcta / revision / incorrecta-confiada). Eso no
alcanza para un problema de medicion: dos criterios distintos pueden dar las mismas
cifras de decision sobre fills que ya venian mal (paso con la validacion del margen por
hueco, ver goldset/README-registro.md). Este arnes mide lo que hay debajo, por burbuja,
contra la verdad de cada hoja:

  off_med / off_p90 / off_max   desplazamiento (px) entre la posicion que el spec le da a
                                la burbuja y el anillo impreso, localizado con un metodo
                                INDEPENDIENTE del que usa el motor (media iterada de la
                                tinta en una corona, no correlacion con plantilla)
  res_med / res_p90             residuo (px) entre la posicion que usa el motor (con
                                registro local) y ese localizador independiente
  fallback                      fraccion de burbujas en que el registro local no confio
                                y se muestreo en la posicion del spec
  floor_p95                     p95 del fill de las burbujas realmente VACIAS
  mark_min                      minimo fill de las burbujas realmente MARCADAS
  gap                           mark_min - max(vacias): negativo = se cruzan
  contraste                     por pregunta, fill mayor menos segundo mayor; se reporta
                                min(contestadas) / max(en blanco): cuanto mas alto, mas
                                separa el criterio relativo por pregunta
  xcap                          entre dos fotos de la MISMA hoja fisica (`physicalSheet`
                                en truth.json), mediana de |delta fill| por burbuja

Cada metrica de fill se calcula en tres posiciones: `spec` (lo que hacia el motor sin
registro), `motor` (lo que hace el motor hoy: registro local si esta habilitado) e
`indep` (posicion del localizador independiente, como cota de lo alcanzable).

No modifica nada del motor: usa `classify_page_debug` para las decisiones (mismo camino
que produccion) y `_rectify_oriented` para obtener la misma pagina rectificada.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

OMR_ROOT = Path(__file__).resolve().parents[1]
if str(OMR_ROOT) not in sys.path:
    sys.path.insert(0, str(OMR_ROOT))

from app.classify import (  # noqa: E402
    DARK_CONTRAST_MIN_DELTA,
    DARK_CONTRAST_RATIO,
    INNER_RADIUS_RATIO,
    _circle_pixels,
    _local_background,
    _patch_around,
    bubble_fill,
)
from app.geometry import point_to_px, radius_to_px  # noqa: E402
from app.pipeline import _rectify_oriented, classify_page_debug  # noqa: E402
from app.rectify import RectifiedPage  # noqa: E402
from app.sources import ImagePageSource  # noqa: E402
from goldset.dataset import (  # noqa: E402
    DatasetError,
    GoldSheet,
    consensus_answers,
    discover_sheets,
    load_spec,
    load_truth,
    page_files,
)
from goldset.run import PROFILES_BY_CUT  # noqa: E402
from goldset.scoring import (  # noqa: E402
    CATEGORY_CORRECT,
    CATEGORY_REVIEW,
    CATEGORY_WRONG,
    score_sheet,
)

try:
    from app.registration import register_group
except ImportError:  # fase 0: el motor todavia no registra
    register_group = None

INDEPENDENT_DARK_MIN_DELTA = 30.0
INDEPENDENT_DARK_RATIO = 0.25
INDEPENDENT_RING_BAND = (0.75, 1.30)
INDEPENDENT_MIN_PIXELS = 30
INDEPENDENT_ITERATIONS = 8
FILL_KINDS = ("spec", "motor", "indep")


def fill_at(gray: np.ndarray, cx: int, cy: int, radius_px: int) -> float:
    """La misma aritmetica que classify.bubble_fill, con el centro en pixeles."""
    patch, center = _patch_around(gray, (cx, cy), radius_px)
    background = _local_background(patch, center, radius_px)
    inner = _circle_pixels(patch, center, max(1, round(radius_px * INNER_RADIUS_RATIO)))
    if inner.size == 0:
        return 0.0
    cutoff = background - max(DARK_CONTRAST_MIN_DELTA, DARK_CONTRAST_RATIO * background)
    return float(np.count_nonzero(inner < cutoff)) / inner.size


def independent_ring_center(
    gray: np.ndarray, cx: int, cy: int, radius_px: int
) -> tuple[float, float] | None:
    """Centro del anillo impreso por media iterada de la tinta en una corona.

    Independiente del localizador del motor a proposito: si los dos coinciden, ninguno
    se esta confirmando a si mismo. Sirve igual con la burbuja vacia (solo el anillo) y
    con la burbuja rellena (disco oscuro simetrico): en los dos casos la media de los
    pixeles oscuros dentro de la corona converge al centro. Devuelve None cuando no hay
    tinta suficiente o el centro se va mas alla de 0.9 R (no hay anillo ahi).
    """
    patch, (lx, ly) = _patch_around(gray, (cx, cy), radius_px)
    background = _local_background(patch, (lx, ly), radius_px)
    cutoff = background - max(INDEPENDENT_DARK_MIN_DELTA, INDEPENDENT_DARK_RATIO * background)
    ys, xs = np.nonzero(patch < cutoff)
    if xs.size < INDEPENDENT_MIN_PIXELS:
        return None
    x, y = float(lx), float(ly)
    low, high = INDEPENDENT_RING_BAND
    for _ in range(INDEPENDENT_ITERATIONS):
        distance = np.hypot(xs - x, ys - y)
        selected = (distance >= low * radius_px) & (distance <= high * radius_px)
        if int(selected.sum()) < INDEPENDENT_MIN_PIXELS:
            return None
        nx, ny = float(xs[selected].mean()), float(ys[selected].mean())
        moved = abs(nx - x) + abs(ny - y)
        x, y = nx, ny
        if math.hypot(x - lx, y - ly) > 0.9 * radius_px:
            return None
        if moved < 0.05:
            break
    return x - lx, y - ly


def measure_sheet(sheet: GoldSheet) -> dict[str, Any]:
    truth = load_truth(sheet)
    spec = load_spec(sheet, truth)
    answers = consensus_answers(sheet, truth)
    kind, paths = page_files(sheet)
    record: dict[str, Any] = {
        "sheet": sheet.label,
        "cut": sheet.cut,
        "physicalSheet": truth.get("physicalSheet"),
        "truthSource": truth.get("truthSource", "double-transcription"),
    }
    if kind != "images" or len(paths) != 1 or spec["pageCount"] != 1:
        record["skipped"] = "el arnes de registro solo mide hojas de una pagina en imagen"
        return record
    profile = dict(PROFILES_BY_CUT[sheet.cut])
    _, bgr = next(ImagePageSource([paths[0].read_bytes()]).pages())

    started = time.perf_counter()
    page, debug = classify_page_debug(bgr, 0, spec, profile)
    record["wallMs"] = round((time.perf_counter() - started) * 1000, 1)
    record["classifyMs"] = debug["timingsMs"].get("classify")
    record["threshold"] = debug.get("threshold")
    record["gapOtsu"] = debug.get("gap")
    outcomes = score_sheet(sheet.label, sheet.cut, spec, answers, {"pages": [page]})
    counts = defaultdict(int)
    for outcome in outcomes:
        counts[outcome.category] += 1
    record["decision"] = dict(counts)
    record["wrong"] = [
        {"q": o.printed_number, "expected": o.expected, "state": o.state, "value": o.value}
        for o in outcomes
        if o.category == CATEGORY_WRONG
    ]
    if not page["quality"]["ok"]:
        record["rejected"] = page["quality"]["rejectReason"]
        return record

    _, rectified, _, _ = _rectify_oriented(bgr, spec, 0)
    if not isinstance(rectified, RectifiedPage):
        record["rejected"] = "sin rectificar"
        return record
    gray, size = rectified.gray, rectified.size

    bubbles_out: list[dict[str, Any]] = []
    for field in spec["fields"]:
        if field["pageIndex"] != 0 or field["kind"] != "bubble_group":
            continue
        expected = answers.get(field["printedNumber"])
        fixes = register_group(rectified, field["bubbles"]) if register_group else None
        for index, bubble in enumerate(field["bubbles"]):
            cx, cy = point_to_px(bubble["center"], size)
            radius_px = radius_to_px(bubble["radius"], size)
            entry: dict[str, Any] = {
                "q": field["printedNumber"],
                "letter": bubble["value"],
                "marked": expected is not None and bubble["value"] in expected,
                "spec": bubble_fill(rectified, bubble["center"], bubble["radius"]),
            }
            independent = independent_ring_center(gray, cx, cy, radius_px)
            if independent is not None:
                entry["off"] = float(math.hypot(*independent))
                entry["indep"] = fill_at(
                    gray, round(cx + independent[0]), round(cy + independent[1]), radius_px
                )
            if fixes is not None:
                fix = fixes[index]
                entry["motor"] = fill_at(gray, cx + fix.dx, cy + fix.dy, radius_px)
                entry["fallback"] = fix.fallback
                entry["score"] = fix.score
                if independent is not None:
                    entry["res"] = float(
                        math.hypot(fix.dx - independent[0], fix.dy - independent[1])
                    )
            else:
                entry["motor"] = entry["spec"]
            bubbles_out.append(entry)
    record["bubbles"] = bubbles_out
    record["metrics"] = _sheet_metrics(bubbles_out)
    return record


def _sheet_metrics(bubbles: list[dict[str, Any]]) -> dict[str, Any]:
    metrics: dict[str, Any] = {}
    offs = np.array([b["off"] for b in bubbles if "off" in b])
    if offs.size:
        metrics["off_med"] = float(np.median(offs))
        metrics["off_p90"] = float(np.percentile(offs, 90))
        metrics["off_max"] = float(offs.max())
        metrics["indep_found"] = float(offs.size / len(bubbles))
    res = np.array([b["res"] for b in bubbles if "res" in b])
    if res.size:
        metrics["res_med"] = float(np.median(res))
        metrics["res_p90"] = float(np.percentile(res, 90))
    if any("fallback" in b for b in bubbles):
        metrics["fallback"] = float(np.mean([b["fallback"] for b in bubbles if "fallback" in b]))
    for kind in FILL_KINDS:
        marked = np.array([b[kind] for b in bubbles if b["marked"] and kind in b])
        empty = np.array([b[kind] for b in bubbles if not b["marked"] and kind in b])
        if empty.size:
            metrics[f"{kind}_floor_p95"] = float(np.percentile(empty, 95))
            metrics[f"{kind}_floor_max"] = float(empty.max())
        if marked.size and empty.size:
            metrics[f"{kind}_mark_min"] = float(marked.min())
            metrics[f"{kind}_gap"] = float(marked.min() - empty.max())
        metrics[f"{kind}_contrast"] = _contrast_ratio(bubbles, kind)
    return metrics


def _contrast_ratio(bubbles: list[dict[str, Any]], kind: str) -> dict[str, float | None]:
    by_q: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for b in bubbles:
        if kind in b:
            by_q[b["q"]].append(b)
    answered: list[float] = []
    blank: list[float] = []
    for group in by_q.values():
        if len(group) < 2:
            continue
        values = sorted((b[kind] for b in group), reverse=True)
        contrast = values[0] - values[1]
        marked_count = sum(1 for b in group if b["marked"])
        if marked_count == 1:
            answered.append(contrast)
        elif marked_count == 0:
            blank.append(contrast)
    return {
        "min_answered": min(answered) if answered else None,
        "max_blank": max(blank) if blank else None,
        "ratio": (min(answered) / max(blank)) if answered and blank and max(blank) > 0 else None,
    }


def cross_capture(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_physical: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        if record.get("bubbles") and record.get("physicalSheet"):
            by_physical[record["physicalSheet"]].append(record)
    pairs = []
    for physical, group in sorted(by_physical.items()):
        for i, a in enumerate(group):
            for b in group[i + 1 :]:
                index_b = {(x["q"], x["letter"]): x for x in b["bubbles"]}
                pair: dict[str, Any] = {"physicalSheet": physical, "a": a["sheet"], "b": b["sheet"]}
                for kind in FILL_KINDS:
                    marked_d, empty_d = [], []
                    for x in a["bubbles"]:
                        y = index_b.get((x["q"], x["letter"]))
                        if y is None or kind not in x or kind not in y:
                            continue
                        (marked_d if x["marked"] else empty_d).append(abs(x[kind] - y[kind]))
                    if marked_d:
                        pair[f"{kind}_marked_med"] = float(np.median(marked_d))
                        pair[f"{kind}_marked_max"] = float(max(marked_d))
                    if empty_d:
                        pair[f"{kind}_empty_med"] = float(np.median(empty_d))
                pairs.append(pair)
    return pairs


def _fmt(value: Any, digits: int = 3) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def render(records: list[dict[str, Any]], pairs: list[dict[str, Any]]) -> str:
    lines = []
    header_decision = f"{'hoja':<14} {'ok':>3} {'rev':>3} {'ERR':>3}"
    header_registration = f"{'off_med':>7} {'off_p90':>7} {'res_med':>7} {'fallb':>5}"
    header_fills = (
        f"{'piso95 spec/motor':>17} {'marc_min spec/motor':>19} "
        f"{'hueco spec/motor':>16} {'contraste motor':>15}"
    )
    lines.append(f"{header_decision} | {header_registration} | {header_fills} | {'cls ms':>6}")
    totals = defaultdict(int)
    for r in records:
        d = r.get("decision", {})
        for key in (CATEGORY_CORRECT, CATEGORY_REVIEW, CATEGORY_WRONG):
            totals[key] += d.get(key, 0)
        head = (
            f"{r['sheet'][:14]:<14} {d.get(CATEGORY_CORRECT, 0):>3} "
            f"{d.get(CATEGORY_REVIEW, 0):>3} {d.get(CATEGORY_WRONG, 0):>3}"
        )
        if r.get("rejected") or r.get("skipped"):
            lines.append(f"{head} | {r.get('rejected') or r.get('skipped')}")
            continue
        m = r["metrics"]
        contrast = m.get("motor_contrast", {})
        registration = (
            f"{_fmt(m.get('off_med'), 1):>7} {_fmt(m.get('off_p90'), 1):>7} "
            f"{_fmt(m.get('res_med'), 1):>7} {_fmt(m.get('fallback'), 2):>5}"
        )
        fills = (
            f"{_fmt(m.get('spec_floor_p95')):>8}/{_fmt(m.get('motor_floor_p95')):<8} "
            f"{_fmt(m.get('spec_mark_min')):>9}/{_fmt(m.get('motor_mark_min')):<9} "
            f"{_fmt(m.get('spec_gap')):>7}/{_fmt(m.get('motor_gap')):<8} "
            f"{_fmt(contrast.get('min_answered')):>6}/{_fmt(contrast.get('max_blank')):<8}"
        )
        lines.append(f"{head} | {registration} | {fills} | {_fmt(r.get('classifyMs'), 0):>6}")
        if r.get("wrong"):
            lines.append(
                "    incorrectas confiadas: "
                + ", ".join(
                    f"q{w['q']} esperado {w['expected']} leido {w['state']}/{w['value']}"
                    for w in r["wrong"]
                )
            )
    lines.append(
        f"{'TOTAL':<14} {totals[CATEGORY_CORRECT]:>3} "
        f"{totals[CATEGORY_REVIEW]:>3} {totals[CATEGORY_WRONG]:>3}"
    )
    measured = [r for r in records if r.get("metrics")]
    if measured:
        worst = {}
        for kind in FILL_KINDS:
            gaps = [
                r["metrics"].get(f"{kind}_gap")
                for r in measured
                if r["metrics"].get(f"{kind}_gap") is not None
            ]
            worst[kind] = min(gaps) if gaps else None
        lines.append(
            "hueco minimo entre hojas: "
            + "  ".join(f"{kind}={_fmt(worst[kind])}" for kind in FILL_KINDS)
        )
    if pairs:
        lines.append(
            "estabilidad entre capturas de la misma hoja (mediana |delta fill| marcadas / vacias):"
        )
        for p in pairs:
            lines.append(
                f"  {p['physicalSheet']:<8} {p['a']} vs {p['b']}: "
                + "  ".join(
                    f"{kind}={_fmt(p.get(f'{kind}_marked_med'))}/{_fmt(p.get(f'{kind}_empty_med'))}"
                    for kind in FILL_KINDS
                )
            )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tools.measure_registration",
        description="Mide el registro de burbujas y la separacion de fills contra la verdad",
    )
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--json", type=Path, default=None, help="Volcar registros y pares en JSON")
    parser.add_argument("--cut", default=None, help="Medir solo este corte")
    args = parser.parse_args(argv)
    try:
        sheets = discover_sheets(args.data_dir)
    except DatasetError as error:
        print(f"ERROR: {error}")
        return 2
    if args.cut:
        sheets = [s for s in sheets if s.cut == args.cut]
    records = []
    for sheet in sheets:
        try:
            records.append(measure_sheet(sheet))
        except DatasetError as error:
            records.append({"sheet": sheet.label, "cut": sheet.cut, "skipped": str(error)})
    pairs = cross_capture(records)
    print(
        f"registro local del motor: {'disponible' if register_group else 'NO disponible (fase 0)'}"
    )
    print(render(records, pairs))
    if args.json:
        args.json.write_text(
            json.dumps({"records": records, "pairs": pairs}, indent=1), encoding="utf-8"
        )
        print(f"JSON en {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
