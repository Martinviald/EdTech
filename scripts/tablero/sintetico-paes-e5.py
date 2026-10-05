#!/usr/bin/env python3
"""Fixture SINTÉTICO del Ensayo 5 PAES (M1 y M2) para la BDD local de pruebas.

No hay escaneos de GradeCam del Ensayo 5 en el disco, así que se fabrican: alumnos
ficticios (RUT 50.000.0xx, nombres "Sintético") matriculados en IV° medio 2026 y
respuestas determinísticas (semilla fija) contra la clave del instrumento local.
Escribe los alumnos en la BDD y deja un artefacto con el mismo contrato que
`paes_2026_a_artefacto.py`, que se carga con `import-paes-2026-responses.ts`.

Uso: sintetico-paes-e5.py <database_url> <artefacto_salida.json>
"""

import json
import random
import subprocess
import sys

ORG_ID = "c5c10000-0000-0000-0000-000000000001"
SEMILLA = 20260905
ALUMNOS_POR_SECCION = {"A": 14, "B": 12, "C": 10}
RINDEN_M2_POR_SECCION = {"A": 9, "B": 4, "C": 5}
ENSAYO = 5
PRUEBAS = {
    "M1": ("PAES M1 — Ensayo 5 (Tanda 5) · IV° Medio 2026", "2026-09-15"),
    "M2": ("PAES M2 — Ensayo 5 (Tanda 5) · IV° Medio 2026", "2026-09-16"),
}


def psql(database_url: str, sql: str) -> list[list[str]]:
    salida = subprocess.run(
        ["psql", database_url, "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=True, capture_output=True, text=True,
    ).stdout
    return [linea.split("\t") for linea in salida.splitlines() if linea]


def digito_verificador(cuerpo: int) -> str:
    suma, factor = 0, 2
    for d in reversed(str(cuerpo)):
        suma += int(d) * factor
        factor = 2 if factor == 7 else factor + 1
    resto = 11 - suma % 11
    return {11: "0", 10: "K"}.get(resto, str(resto))


def alumnos_sinteticos() -> list[dict]:
    alumnos, n = [], 0
    for seccion, cuantos in ALUMNOS_POR_SECCION.items():
        for i in range(1, cuantos + 1):
            n += 1
            cuerpo = 50_000_000 + n
            alumnos.append({
                "rut": f"{cuerpo}-{digito_verificador(cuerpo)}",
                "firstName": f"Alumno{n:02d}",
                "lastName": f"Sintético {seccion}",
                "section": seccion,
                "indiceEnSeccion": i,
            })
    return alumnos


def matricular(database_url: str, alumnos: list[dict]) -> None:
    valores = ",".join(
        f"('{a['rut']}', '{a['firstName']}', '{a['lastName']}', '{a['section']}')" for a in alumnos
    )
    psql(database_url, f"""
        with nuevos(rut, first_name, last_name, section) as (values {valores}),
        ins as (
          insert into students (org_id, rut, first_name, last_name)
          select '{ORG_ID}', rut, first_name, last_name from nuevos
          on conflict (org_id, rut) do update set first_name = excluded.first_name
          returning id, rut
        )
        insert into student_enrollments (student_id, class_group_id, academic_year_id, status)
        select ins.id, cg.id, ay.id, 'active'
        from ins
        join nuevos n on n.rut = ins.rut
        join academic_years ay on ay.org_id = '{ORG_ID}' and ay.year = 2026
        join grades g on g.code = '4TH_MEDIO'
        join class_groups cg on cg.academic_year_id = ay.id and cg.grade_id = g.id and cg.name = n.section
        on conflict (student_id, academic_year_id)
        do update set class_group_id = excluded.class_group_id, status = 'active';
    """)


def claves(database_url: str, nombre: str) -> list[tuple[int, str, list[str]]]:
    filas = psql(database_url, f"""
        select it.position,
          coalesce((select string_agg(a->>'key', '' order by a->>'key')
                    from jsonb_array_elements(it.content->'alternatives') a
                    where (a->>'isCorrect')::bool), ''),
          coalesce((select string_agg(a->>'key', '' order by a->>'key')
                    from jsonb_array_elements(it.content->'alternatives') a), '')
        from instruments i join items it on it.instrument_id = i.id
        where i.name = '{nombre.replace("'", "''")}' and i.deleted_at is null
        order by it.position
    """)
    if not filas:
        sys.exit(f"Instrumento no cargado: {nombre}")
    return [(int(p), clave, list(alts or "ABCD")) for p, clave, alts in filas]


def respuestas(rng: random.Random, pauta, habilidad: float) -> dict[str, str]:
    salida = {}
    for posicion, clave, alternativas in pauta:
        if clave and rng.random() < habilidad:
            salida[str(posicion)] = clave[0]
        else:
            salida[str(posicion)] = rng.choice(alternativas)
    return salida


def main() -> None:
    database_url, ruta_salida = sys.argv[1], sys.argv[2]
    rng = random.Random(SEMILLA)
    alumnos = alumnos_sinteticos()
    matricular(database_url, alumnos)
    habilidad = {a["rut"]: rng.uniform(0.3, 0.8) for a in alumnos}

    cursos = []
    for codigo, (nombre, fecha) in PRUEBAS.items():
        pauta = claves(database_url, nombre)
        for seccion in ALUMNOS_POR_SECCION:
            del_curso = [a for a in alumnos if a["section"] == seccion]
            if codigo == "M2":
                del_curso = [a for a in del_curso if a["indiceEnSeccion"] <= RINDEN_M2_POR_SECCION[seccion]]
            filas = [
                {
                    "rut": a["rut"],
                    "nombre": f"{a['firstName']} {a['lastName']}",
                    "answers": respuestas(rng, pauta, habilidad[a["rut"]]),
                    "bajoConteo": False,
                    "respuestasEfectivas": len(pauta),
                }
                for a in del_curso
            ]
            cursos.append({
                "sourceFile": "sintetico-paes-e5",
                "gradeCode": "4TH_MEDIO",
                "section": seccion,
                "subjectName": "Matemáticas",
                "instrumentId": None,
                "instrumentName": nombre,
                "ensayo": ENSAYO,
                "asignaturaCodigo": codigo,
                "administeredAt": fecha,
                "questionCount": len(pauta),
                "rows": filas,
            })

    with open(ruta_salida, "w", encoding="utf-8") as fh:
        json.dump({"year": 2026, "courses": cursos, "bajoConteo": []}, fh, ensure_ascii=False, indent=1)
    print(f"sintético E5: alumnos={len(alumnos)} cursos={len(cursos)} filas={sum(len(c['rows']) for c in cursos)}")


if __name__ == "__main__":
    main()
