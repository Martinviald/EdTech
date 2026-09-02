"""Pruebas del barrido sintetico (goldset/make_synthetic.py).

Lo que hay que garantizar es distinto de lo que garantiza `test_goldset.py`:
alli se prueba que el harness MIDE bien; aca que el generador produce un dataset
en el que se puede confiar. Tres cosas:

1. El `truth.json` coincide con lo que efectivamente se dibujo — si la verdad se
   desincroniza de la imagen, el barrido reporta errores del lector que no
   existen (o peor, esconde los que si).
2. La semilla es determinista hasta el byte. Un barrido que cambia entre
   corridas no sirve como deteccion de regresiones: no se sabe si cambio el
   lector o el dataset.
3. Las metricas de fiducial caen dentro de la envolvente MEDIDA en papel. Este
   es el test que impide que el generador vuelva a dibujar cuadrados perfectos
   —solidez 1.00, compacidad 16.0— y nos deje calibrar umbrales contra una
   poblacion que no existe.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from goldset import make_synthetic as gen
from goldset.dataset import consensus_answers, discover_sheets, load_truth
from goldset.fiducial_metrics import measure_image
from goldset.validate import main as validate_main

REAL_SOLIDITY = (0.85, 0.93)
REAL_COMPACTNESS = (16.5, 18.5)
SMALL_SWEEP = 8


@pytest.fixture(scope="module")
def sweep(tmp_path_factory: pytest.TempPathFactory) -> Path:
    data_dir = tmp_path_factory.mktemp("sweep") / "data"
    gen.generate(data_dir, sheets=SMALL_SWEEP, seed=99)
    return data_dir


def test_el_dataset_generado_pasa_validate(sweep: Path) -> None:
    assert validate_main([str(sweep)]) == 0


def test_descubre_las_hojas_y_todas_traen_verdad(sweep: Path) -> None:
    sheets = discover_sheets(sweep)
    assert len(sheets) == SMALL_SWEEP
    for sheet in sheets:
        answers = consensus_answers(sheet, load_truth(sheet))
        assert set(answers) == {str(n) for n in range(1, gen.FIELDS_PER_PAGE + 1)}


def test_la_verdad_coincide_con_las_marcas_dibujadas() -> None:
    """`answers` y `marks` tienen que decir lo mismo, campo por campo.

    Es la propiedad que hace barato al barrido: la verdad no se transcribe, se
    conoce. Si se desincroniza, todo el resto del reporte miente.
    """
    for index, recipe in enumerate(gen.RECIPES):
        rng = np.random.default_rng([1234, index])
        plan = gen.plan_sheet(recipe, index, rng)
        for number in range(1, gen.FIELDS_PER_PAGE + 1):
            field_id = f"f_{number:03d}"
            expected = plan.answers[str(number)]
            if expected is None:
                assert field_id not in plan.marks, f"{recipe.name}: marca sin verdad"
                continue
            drawn = plan.marks[field_id]
            chosen = [drawn] if isinstance(drawn, str) else list(drawn)
            assert expected in chosen, f"{recipe.name}/{field_id}: verdad != dibujo"


def test_la_doble_marca_conserva_la_alternativa_elegida() -> None:
    """En una doble marca la verdad es la que el alumno relleno entera.

    El lector deberia responder `multiple` y eso cae en revision — ni acierto ni
    error. Lo que no puede pasar es que la verdad apunte a la marca residual.
    """
    dirty = next(r for r in gen.RECIPES if r.dirty_marks)
    doubles = 0
    for index in range(40):
        plan = gen.plan_sheet(dirty, index, np.random.default_rng([7, index]))
        for field_id, drawn in plan.marks.items():
            if isinstance(drawn, str):
                continue
            doubles += 1
            printed = str(int(field_id.split("_")[1]))
            assert plan.answers[printed] == drawn[0]
    assert doubles > 0, "la receta sucia deberia producir dobles marcas"


def test_la_semilla_es_determinista(tmp_path: Path) -> None:
    first, second = tmp_path / "a", tmp_path / "b"
    gen.generate(first, sheets=4, seed=2026)
    gen.generate(second, sheets=4, seed=2026)
    for path in sorted(p for p in first.rglob("*") if p.is_file()):
        twin = second / path.relative_to(first)
        assert twin.is_file(), f"falta {twin}"
        assert path.read_bytes() == twin.read_bytes(), f"difiere {path.name}"


def test_semillas_distintas_dan_datasets_distintos(tmp_path: Path) -> None:
    first, second = tmp_path / "a", tmp_path / "b"
    gen.generate(first, sheets=4, seed=1)
    gen.generate(second, sheets=4, seed=2)
    pages = sorted(p for p in first.rglob("page-0.png"))
    twins = sorted(p for p in second.rglob("page-0.png"))
    assert any(a.read_bytes() != b.read_bytes() for a, b in zip(pages, twins, strict=True))


def test_los_fiduciales_caen_en_la_envolvente_del_papel_real(sweep: Path) -> None:
    """Solidez y compacidad tienen que solapar con lo medido en papel.

    Rangos reales: solidez 0.85-0.92, compacidad 16.7-18.4 (28 esquinas, dos
    lotes impresos). Un cuadrado perfecto da 1.00 y 16.0 — si este test empieza
    a fallar por arriba en solidez, alguien volvio a dibujar el cuadrado ideal y
    el barrido dejo de servir para calibrar el gate de forma.
    """
    solidities: list[float] = []
    compactnesses: list[float] = []
    for page in sorted(sweep.rglob("page-0.png")):
        gray = cv2.imread(str(page), cv2.IMREAD_GRAYSCALE)
        for metrics in measure_image(gray, page.name):
            solidities.append(metrics.solidity)
            compactnesses.append(metrics.compactness)

    assert solidities, "no se detecto ningun fiducial en el barrido"
    median_solidity = float(np.median(solidities))
    median_compactness = float(np.median(compactnesses))
    assert REAL_SOLIDITY[0] <= median_solidity <= REAL_SOLIDITY[1], median_solidity
    assert (
        REAL_COMPACTNESS[0] <= median_compactness <= REAL_COMPACTNESS[1]
    ), median_compactness


def test_la_composicion_respeta_las_proporciones_del_conjunto_de_oro() -> None:
    """O4 es 100/100/50/50; el barrido tiene que repartirse igual.

    Si no, los cortes con mas recetas (phone-bad, dirty) se sobre-representan y
    las tres cifras del veredicto dejan de compararse con el criterio real.
    """
    allocation = gen.allocate(300)
    counts = {cut: 0 for cut in gen.CUT_SHARE}
    for recipe in allocation:
        counts[recipe.cut] += 1
    assert counts == {
        "scanner-adf": 100,
        "phone-good": 100,
        "phone-bad": 50,
        "dirty": 50,
    }


def test_el_barrido_por_defecto_ejercita_todas_las_recetas() -> None:
    exercised = {recipe.name for recipe in gen.allocate(gen.DEFAULT_SHEETS)}
    assert exercised == {recipe.name for recipe in gen.RECIPES}


def test_las_notas_dicen_que_es_sintetico(sweep: Path) -> None:
    """El dataset tiene que declararse sintetico en cada hoja.

    Un `truth.json` sin esa marca se puede confundir con papel transcrito, y el
    dia que alguien mezcle los dos directorios el reporte diria "validado" sobre
    hojas que nadie imprimio.
    """
    for truth_path in sorted(sweep.rglob("truth.json")):
        notes = json.loads(truth_path.read_text(encoding="utf-8"))["notes"]
        assert "SINTETICA" in notes
        assert "no reemplaza al conjunto de oro" in notes
