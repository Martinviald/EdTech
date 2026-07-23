#!/usr/bin/env python3
"""Valida los JSON de extracción contra el contrato (CONTRATO.md, schema 1.0).

Uso:
  python3 validate.py                      # valida extraccion/lenguaje y extraccion/matematicas
  python3 validate.py <archivo.json> ...   # valida archivos puntuales

Sale con código 1 si hay algún error.
"""
import json, sys, glob, os

SUBJ = {"LANG", "MATH"}
GRADE = {"3RD_BASIC", "4TH_BASIC", "5TH_BASIC", "6TH_BASIC"}
PERIOD = {"diagnostico", "intermedio", "cierre"}
RESPONSE_FORMAT = {"choice", "fill_in", "develop"}
CHOICE_TYPES = {"multiple_choice", "true_false"}

HERE = os.path.dirname(os.path.abspath(__file__))


def validate_file(path):
    errs, warns = [], []
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        return [f"JSON inválido: {e}"], []

    ins = d.get("instrument", {})
    if ins.get("subjectCode") not in SUBJ:
        errs.append(f"subjectCode inválido: {ins.get('subjectCode')}")
    if ins.get("gradeCode") not in GRADE:
        errs.append(f"gradeCode inválido: {ins.get('gradeCode')}")
    if ins.get("applicationPeriod") not in PERIOD:
        errs.append(f"applicationPeriod inválido: {ins.get('applicationPeriod')}")
    if not isinstance(ins.get("year"), int) or not (2000 <= ins.get("year", 0) <= 2100):
        errs.append(f"year inválido: {ins.get('year')}")

    sections = d.get("sections", [])
    items = [it for s in sections for it in s.get("items", [])]
    pos = [it.get("position") for it in items]
    if pos != list(range(1, len(items) + 1)):
        errs.append(f"posiciones no correlativas 1..N: {pos}")

    declared = d.get("extraction", {}).get("itemCount")
    if declared != len(items):
        errs.append(f"itemCount={declared} != {len(items)} ítems reales")

    for it in items:
        p = it.get("position")
        if it.get("correctKey") is not None:
            errs.append(f"#{p}: correctKey debe ser null en extracción")
        if it.get("skill") is not None:
            errs.append(f"#{p}: skill debe ser null en extracción")
        rf = it.get("responseFormat")
        if rf is not None and rf not in RESPONSE_FORMAT:
            errs.append(f"#{p}: responseFormat inválido: {rf}")
        if not it.get("stem"):
            errs.append(f"#{p}: sin stem")
        if it.get("type") in CHOICE_TYPES:
            alts = it.get("alternatives") or []
            if len(alts) < 2:
                errs.append(f"#{p}: ítem de selección con <2 alternativas")
            keys = [a.get("key") for a in alts]
            if len(set(keys)) != len(keys):
                errs.append(f"#{p}: keys duplicadas {keys}")
            if any(not a.get("text") for a in alts):
                errs.append(f"#{p}: alternativa sin texto")
        else:
            if it.get("alternatives"):
                errs.append(f"#{p}: ítem no-selección no debe llevar alternativas")

    if d.get("extraction", {}).get("needsHumanReview"):
        warns.append("needsHumanReview: true")
    nfig = sum(1 for it in items if it.get("hasFigure"))
    if nfig:
        warns.append(f"{nfig} ítems con figura")
    return errs, warns


def main():
    args = sys.argv[1:]
    if args:
        files = args
    else:
        files = sorted(
            glob.glob(os.path.join(HERE, "lenguaje", "*.json"))
            + glob.glob(os.path.join(HERE, "matematicas", "*.json"))
        )
    if not files:
        print("No se encontraron JSON para validar.")
        return 0

    total_err = 0
    for f in files:
        errs, warns = validate_file(f)
        name = os.path.basename(f)
        if errs:
            total_err += len(errs)
            print(f"✗ {name}")
            for e in errs:
                print(f"    ERROR: {e}")
        else:
            extra = f" ({'; '.join(warns)})" if warns else ""
            print(f"✓ {name}{extra}")
    print()
    print(f"{len(files)} archivo(s) · {total_err} error(es)")
    return 1 if total_err else 0


if __name__ == "__main__":
    sys.exit(main())
