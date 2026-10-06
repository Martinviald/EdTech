#!/usr/bin/env python3
"""Lista las celdas de un artefacto DIA cuyo instrumento (grado, asignatura, período, año)
existe con ítems en la BDD local, en el formato de `--onlyFile` de
`import-dia-2026-responses.ts`. Las demás se reportan por stderr y se omiten.

Uso: celdas-dia-cargables.py <artefacto.json> <database_url> <salida.txt>
"""

import json
import subprocess
import sys


def instrumentos_disponibles(database_url: str) -> set[tuple[str, str, str, int]]:
    salida = subprocess.run(
        [
            "psql", database_url, "-At", "-F", "\t", "-c",
            """
            select g.code, s.name, i.application_period, i.year
            from instruments i
            join grades g on g.id = i.grade_id
            join subjects s on s.id = i.subject_id
            where i.org_id is null and i.deleted_at is null and i.type = 'dia'
              and exists (select 1 from items it where it.instrument_id = i.id)
            """,
        ],
        check=True, capture_output=True, text=True,
    ).stdout
    return {
        (g, s, p, int(y))
        for g, s, p, y in (linea.split("\t") for linea in salida.splitlines() if linea)
    }


def main() -> None:
    ruta, database_url, salida = sys.argv[1:4]
    artefacto = json.load(open(ruta, encoding="utf-8"))
    disponibles = instrumentos_disponibles(database_url)
    cargables, omitidas = [], []
    for c in artefacto["courses"]:
        if c.get("skipped"):
            continue
        clave = f"{c['gradeCode']}:{c['section']}:{c['subjectName']}"
        destino = (c["gradeCode"], c["subjectName"], c["applicationPeriod"], int(c["year"]))
        (cargables if destino in disponibles else omitidas).append(clave)
    with open(salida, "w", encoding="utf-8") as fh:
        fh.write("\n".join(sorted(set(cargables))))
    print(f"celdas cargables={len(set(cargables))} omitidas={len(omitidas)}")
    for clave in sorted(omitidas):
        print(f"  omitida (sin instrumento local): {clave}", file=sys.stderr)


if __name__ == "__main__":
    main()
