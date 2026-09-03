"""Barrido sintetico: N hojas x combinaciones de degradacion, en formato de dataset.

    python -m goldset.make_synthetic                      # genera el dataset
    python -m goldset.make_synthetic --run                # genera + mide + veredicto
    python -m goldset.make_synthetic --sheets 48 --seed 7

Escribe en `goldset/data/` (gitignoreado) el mismo formato que `dataset.py` ya
sabe leer, asi que `python -m goldset.run` y `python -m goldset.report` corren
encima sin ningun cambio. La verdad de terreno sale gratis y es EXACTA: las
marcas las decide este generador, de modo que `truth.json` no es una
transcripcion sino lo que efectivamente se dibujo. Esa es la ventaja central
sobre el papel — y la unica.

QUE ES Y QUE NO ES ESTO
=======================

Esto NO reemplaza el conjunto de oro de 300 hojas fisicas (O4). Una simulacion
solo cubre los modos de falla que ya se nos ocurrieron, y TODOS los bugs reales
de esta semana salieron de capturas reales, no de sinteticos: el umbral de
solidez que partia la poblacion al medio, el filtro anti-QR que se cayo con una
foto de 2339 px, el limite absoluto de oscuridad que rechazaba esquinas lavadas.
Ninguno lo habria encontrado un barrido — pero una vez conocidos, este barrido
los deja clavados como regresion.

Si el veredicto sale APRUEBA eso significa "no hay regresiones conocidas", NO
"el MVP esta validado".

CALIBRACION CONTRA PAPEL REAL
=============================

Un generador que dibuja cuadrados perfectos no sirve para calibrar nada. Las
degradaciones de aca reproducen distribuciones MEDIDAS sobre 10 capturas de dos
escaneres y una camara (ver `goldset/fiducial_metrics.py` para el instrumento y
`goldset/README-barrido.md` para la tabla de solape):

    solidez del fiducial     0.85 - 0.92   -> `fiducial_roughness` 0.028-0.040
    compacidad               16.7 - 18.4   -> idem
    oscuridad relativa       0.03 - 0.49   -> receta `esquina-lavada`
    resolucion               1655 - 2339px -> receta `alta-resolucion`
    mediana del papel        173 - 255     -> `paper_gray` por receta

Y los seis modos de falla reales que el generador no simulaba: esquina lavada,
fiducial cortado por el borde, fiducial ausente, alta resolucion, QR ilegible
por movimiento, y papel reestirado a otra proporcion.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

OMR_ROOT = Path(__file__).resolve().parents[1]
if str(OMR_ROOT) not in sys.path:
    sys.path.insert(0, str(OMR_ROOT))

from tests import synthetic as syn  # noqa: E402

DEFAULT_DATA_DIR = Path(__file__).parent / "data"
DEFAULT_SHEETS = 48
DEFAULT_SEED = 20260901
FIELDS_PER_PAGE = 12
ALTERNATIVES = ("A", "B", "C", "D")

SCANNER_WIDTH = 1655
PHONE_WIDTH = 1655
HIGH_RESOLUTION_WIDTH = 2339
A4_ASPECT = 1.414
ROUGHNESS_RANGE = (0.026, 0.036)
INK_RANGE = (10, 58)
BLANK_PROBABILITY = 0.12

Page = np.ndarray


@dataclass(frozen=True)
class Recipe:
    """Una combinacion de degradacion con nombre, aplicable a una hoja."""

    name: str
    cut: str
    page_width: int = PHONE_WIDTH
    paper_gray: int = syn.PAPER_GRAY
    washed_corner: int | None = None
    dropped_corner: int | None = None
    clipped_corner: int | None = None
    dirty_marks: bool = False
    post: tuple[Callable[[Page, np.random.Generator], Page], ...] = field(
        default_factory=tuple
    )


def _rotate(degrees: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.rotate(gray, degrees)


def _perspective(strength: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, rng: syn.perspective(gray, strength, rng)


def _blur(sigma: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.blur(gray, sigma)


def _noise(std: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, rng: syn.add_noise(gray, std, rng)


def _canvas(pad: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.on_canvas(gray, pad)


def _wrinkle(amplitude: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.wrinkle(gray, amplitude)


def _side_shadow(band: float, strength: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.side_shadow(gray, band, strength)


def _diagonal_shadow(strength: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.diagonal_shadow(gray, strength)


def _glare(
    center: tuple[float, float], radius: float
) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.glare_spot(gray, center, radius)


def _photocopy() -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.photocopy_gray(gray)


def _clip(corner: int) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.clip_corner(gray, corner)


def _motion_qr() -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.motion_blur_region(gray, (0.70, 0.0, 1.0, 0.17))


def _reflow() -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, _rng: syn.reflow(gray, A4_ASPECT)


def _alias_resample(scale: float) -> Callable[[Page, np.random.Generator], Page]:
    return lambda gray, rng: syn.alias_resample(gray, scale, int(rng.integers(0, 3)))


RECIPES: tuple[Recipe, ...] = (
    Recipe("plano", "scanner-adf", page_width=SCANNER_WIDTH, paper_gray=250),
    Recipe(
        "papel-realzado",
        "scanner-adf",
        page_width=SCANNER_WIDTH,
        paper_gray=255,
        post=(_noise(2.0),),
    ),
    Recipe(
        "papel-gris",
        "scanner-adf",
        page_width=SCANNER_WIDTH,
        paper_gray=178,
    ),
    Recipe(
        "fotocopia",
        "scanner-adf",
        page_width=SCANNER_WIDTH,
        paper_gray=245,
        post=(_photocopy(),),
    ),
    Recipe(
        "esquina-lavada",
        "scanner-adf",
        page_width=SCANNER_WIDTH,
        paper_gray=255,
        washed_corner=3,
    ),
    Recipe(
        "alta-resolucion",
        "scanner-adf",
        page_width=HIGH_RESOLUTION_WIDTH,
        paper_gray=252,
    ),
    Recipe(
        "remuestreo-240dpi",
        "scanner-adf",
        page_width=HIGH_RESOLUTION_WIDTH,
        paper_gray=252,
        post=(_alias_resample(0.62),),
    ),
    Recipe("rotacion-leve", "phone-good", post=(_rotate(1.6),)),
    Recipe("perspectiva-leve", "phone-good", post=(_perspective(0.012),)),
    Recipe("con-fondo", "phone-good", post=(_canvas(0.07),)),
    Recipe(
        "alta-resolucion-foto",
        "phone-good",
        page_width=HIGH_RESOLUTION_WIDTH,
        post=(_canvas(0.05),),
    ),
    Recipe("sombra-diagonal", "phone-good", post=(_diagonal_shadow(0.18),)),
    Recipe(
        "perspectiva-fuerte",
        "phone-bad",
        post=(_perspective(0.03), _canvas(0.06)),
    ),
    Recipe("arruga", "phone-bad", post=(_wrinkle(4.0), _rotate(-2.2))),
    Recipe("sombra-lateral", "phone-bad", post=(_side_shadow(0.28, 0.30),)),
    Recipe("desenfoque", "phone-bad", post=(_blur(1.4), _noise(3.0))),
    Recipe("reflejo", "phone-bad", post=(_glare((0.62, 0.55), 0.09),)),
    Recipe("reflow-a4", "phone-bad", post=(_reflow(),)),
    Recipe("qr-movido", "phone-bad", post=(_motion_qr(),)),
    Recipe("marcas-sucias", "dirty", dirty_marks=True),
    Recipe(
        "marcas-sucias-con-sombra",
        "dirty",
        dirty_marks=True,
        post=(_diagonal_shadow(0.22),),
    ),
    Recipe("fiducial-cortado", "dirty", clipped_corner=1, post=(_clip(1),)),
    Recipe("fiducial-ausente", "dirty", dropped_corner=2),
)


CUT_SHARE: dict[str, float] = {
    "scanner-adf": 100 / 300,
    "phone-good": 100 / 300,
    "phone-bad": 50 / 300,
    "dirty": 50 / 300,
}


def allocate(sheets: int) -> list[Recipe]:
    """Reparte las hojas entre cortes con la MISMA proporcion que el conjunto de oro.

    O4 se compone 100/100/50/50 (scanner-adf, phone-good, phone-bad, dirty). Si
    el barrido reparte por receta en vez de por corte, `phone-bad` y `dirty` —los
    que mas recetas tienen— quedan sobre-representados y las tres cifras del
    veredicto dejan de ser comparables con el criterio que van a medir en papel.
    Dentro de cada corte se rota entre sus recetas, asi que subir `--sheets`
    agrega repeticiones con marcas distintas, no recetas nuevas.
    """
    by_cut: dict[str, list[Recipe]] = {}
    for recipe in RECIPES:
        by_cut.setdefault(recipe.cut, []).append(recipe)

    quotas = {cut: sheets * share for cut, share in CUT_SHARE.items()}
    counts = {cut: max(1, int(quota)) for cut, quota in quotas.items()}
    remainders = sorted(
        quotas, key=lambda cut: quotas[cut] - counts[cut], reverse=True
    )
    position = 0
    while sum(counts.values()) < sheets:
        counts[remainders[position % len(remainders)]] += 1
        position += 1

    plan: list[Recipe] = []
    for cut in CUT_SHARE:
        recipes = by_cut[cut]
        plan.extend(recipes[index % len(recipes)] for index in range(counts[cut]))
    return plan[:sheets]


@dataclass(frozen=True)
class SheetPlan:
    """Lo que se va a dibujar en una hoja. `answers` es la verdad, por construccion."""

    recipe: Recipe
    sheet_id: str
    marks: dict[str, syn.Chosen]
    coverage: dict[str, float]
    styles: dict[str, str]
    answers: dict[str, str | None]
    smudged: tuple[str, ...]


def plan_sheet(recipe: Recipe, index: int, rng: np.random.Generator) -> SheetPlan:
    """Sortea las marcas de una hoja y deja escrita la verdad que le corresponde.

    En los cortes limpios la marca es un relleno franco. En `dirty` aparecen los
    estilos que el clasificador tiene que saber mandar a revision en vez de
    adivinar: cruz, tilde, relleno a medias, borron y doble marca. Para la doble
    marca la verdad es la alternativa que el alumno realmente eligio (la que
    quedo rellena entera); el lector deberia decir `multiple` y eso cuenta como
    revision, no como acierto ni como error — que es exactamente lo correcto.
    """
    marks: dict[str, syn.Chosen] = {}
    coverage: dict[str, float] = {}
    styles: dict[str, str] = {}
    answers: dict[str, str | None] = {}
    smudged: list[str] = []

    for number in range(1, FIELDS_PER_PAGE + 1):
        field_id = f"f_{number:03d}"
        printed = str(number)
        if rng.random() < BLANK_PROBABILITY:
            answers[printed] = None
            continue
        chosen = str(rng.choice(ALTERNATIVES))
        answers[printed] = chosen
        if not recipe.dirty_marks:
            marks[field_id] = chosen
            coverage[field_id] = float(rng.uniform(0.80, 1.0))
            continue

        flavor = int(rng.integers(0, 5))
        if flavor == 0:
            marks[field_id] = chosen
            styles[field_id] = "cross"
        elif flavor == 1:
            marks[field_id] = chosen
            styles[field_id] = "tick"
        elif flavor == 2:
            marks[field_id] = chosen
            coverage[field_id] = float(rng.uniform(0.45, 0.60))
        elif flavor == 3:
            other = str(rng.choice([a for a in ALTERNATIVES if a != chosen]))
            marks[field_id] = [chosen, other]
            coverage[f"{field_id}:{other}"] = 0.35
        else:
            marks[field_id] = chosen
            smudged.append(field_id)

    return SheetPlan(
        recipe=recipe,
        sheet_id=f"{recipe.cut}-{recipe.name}-{index:03d}",
        marks=marks,
        coverage=coverage,
        styles=styles,
        answers=answers,
        smudged=tuple(smudged),
    )


def render_sheet(spec: dict[str, Any], plan: SheetPlan, rng: np.random.Generator) -> Page:
    recipe = plan.recipe
    base_ink = int(rng.integers(*INK_RANGE))
    inks: dict[int, int] = dict.fromkeys(range(4), base_ink)
    if recipe.washed_corner is not None:
        inks[recipe.washed_corner] = int(rng.integers(120, 190))

    gray = syn.render_page(
        spec,
        0,
        marks=plan.marks,
        coverage=plan.coverage,
        styles=plan.styles,
        page_width=recipe.page_width,
        paper_gray=recipe.paper_gray,
        fiducial_roughness=float(rng.uniform(*ROUGHNESS_RANGE)),
        fiducial_inks=inks,
        drop_fiducials=(
            () if recipe.dropped_corner is None else (recipe.dropped_corner,)
        ),
        rng=rng,
    )
    for field_id in plan.smudged:
        value = plan.marks[field_id]
        letter = value if isinstance(value, str) else value[0]
        center = syn.bubble_center_px(spec, field_id, letter, recipe.page_width)
        radius = syn.bubble_radius_px(spec, recipe.page_width)
        gray = syn.smudge(gray, center, round(radius * 1.6), 150, rng)

    for step in recipe.post:
        gray = step(gray, rng)
    return gray


def generate(
    data_dir: Path, sheets: int, seed: int, clean: bool = True
) -> dict[str, Any]:
    """Escribe el dataset completo. Determinista: mismo `seed` -> mismos bytes."""
    if clean and data_dir.exists():
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / ".gitignore").write_text(
        "# Dataset regenerable con `python -m goldset.make_synthetic`.\n*\n!.gitignore\n",
        encoding="utf-8",
    )

    spec = syn.make_layout_spec(fields_per_page=FIELDS_PER_PAGE)
    spec_json = json.dumps(spec, ensure_ascii=False, indent=2) + "\n"
    written_cuts: set[str] = set()

    counts: dict[str, int] = {}
    for index, recipe in enumerate(allocate(sheets)):
        rng = np.random.default_rng([seed, index])
        plan = plan_sheet(recipe, index, rng)

        cut_dir = data_dir / recipe.cut
        if recipe.cut not in written_cuts:
            cut_dir.mkdir(parents=True, exist_ok=True)
            (cut_dir / "layout-spec.json").write_text(spec_json, encoding="utf-8")
            written_cuts.add(recipe.cut)

        sheet_dir = cut_dir / plan.sheet_id
        sheet_dir.mkdir(parents=True, exist_ok=True)
        gray = render_sheet(spec, plan, rng)
        (sheet_dir / "page-0.png").write_bytes(syn.png_bytes(gray))
        _write_truth(sheet_dir, plan)
        counts[recipe.name] = counts.get(recipe.name, 0) + 1

    return {
        "dataDir": str(data_dir),
        "sheets": sheets,
        "seed": seed,
        "recipes": len(RECIPES),
        "byRecipe": counts,
        "cuts": sorted(written_cuts),
        "missingRecipes": sorted({r.name for r in RECIPES} - set(counts)),
    }


def _write_truth(sheet_dir: Path, plan: SheetPlan) -> None:
    """La verdad no se transcribe: se sabe. Las dos 'personas' son el generador.

    `dataset.py` exige 2 transcripciones coincidentes porque en papel esa es la
    doble verificacion humana. Aca no hay nada que verificar — las marcas las
    decidio el generador — asi que se escriben dos copias identicas del mismo
    diccionario y `notes` deja dicho que esto es sintetico, no papel.
    """
    truth = {
        "sheetId": syn.SHEET_ID,
        "layoutSpecFile": "../layout-spec.json",
        "transcriptions": [
            {"by": "generador", "answers": plan.answers},
            {"by": "generador-copia", "answers": plan.answers},
        ],
        "notes": (
            f"Hoja SINTETICA (receta '{plan.recipe.name}') generada con "
            "`python -m goldset.make_synthetic`. La verdad es exacta por "
            "construccion; no es papel real y no reemplaza al conjunto de oro."
        ),
    }
    (sheet_dir / "truth.json").write_text(
        json.dumps(truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m goldset.make_synthetic",
        description="Genera el barrido sintetico (y opcionalmente lo corre y reporta)",
    )
    parser.add_argument("--sheets", type=int, default=DEFAULT_SHEETS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    parser.add_argument(
        "--run",
        action="store_true",
        help="tras generar, corre el pipeline y escribe el reporte con veredicto",
    )
    parser.add_argument("--reports-dir", default=None)
    args = parser.parse_args(argv)

    if args.sheets < 1:
        print("ERROR: --sheets debe ser >= 1")
        return 2

    data_dir = Path(args.data_dir)
    started = time.monotonic()
    summary = generate(data_dir, args.sheets, args.seed)
    elapsed = time.monotonic() - started
    print(
        f"{summary['sheets']} hojas en {len(summary['cuts'])} cortes "
        f"({summary['recipes']} recetas) escritas en {data_dir} "
        f"con semilla {summary['seed']} — {elapsed:.1f}s"
    )
    if summary["missingRecipes"]:
        print(
            "AVISO: con tan pocas hojas quedaron recetas sin ejercitar: "
            + ", ".join(summary["missingRecipes"])
            + f" (usa --sheets {DEFAULT_SHEETS} o mas)"
        )
    if not args.run:
        print("Para medir: python -m goldset.run " + str(data_dir))
        return 0

    from . import run as goldset_run

    run_argv = [str(data_dir)]
    if args.reports_dir:
        run_argv += ["--reports-dir", args.reports_dir]
    print("\nRECORDATORIO: un veredicto APRUEBA aca significa 'sin regresiones")
    print("conocidas', NO 'MVP validado'. La validacion es el conjunto de oro de")
    print("300 hojas fisicas (O4).\n")
    return goldset_run.main(run_argv)


if __name__ == "__main__":
    sys.exit(main())
