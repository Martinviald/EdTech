#!/usr/bin/env python3
"""
Convierte los escaneos GradeCam de los ensayos PAES de Ciencias (CIE) 2026 al
artefacto que consume `packages/db/src/seed/import-paes-2026-responses.ts`.

Por qué Ciencias necesita su propio conversor y no le sirve
`paes_2026_a_artefacto.py` del repo `plataforma-dia-toolkit`:

1. GradeCam partió Ciencias en DOS assignments por ensayo. El de módulo COMÚN
   tiene 54 preguntas y una sola versión; el de MENCIÓN tiene una hoja de 80
   posiciones donde sólo se llenan las 26 de mención (55-80) y TRES versiones.
   Las respuestas de un alumno viven repartidas en los dos archivos y hay que
   unirlas por `student.student_uid`.

2. La mención de cada alumno sale de `stats.version` del archivo de mención:
   versión 1 = Biología, 2 = Física, 3 = Química. No es una inferencia: las
   claves que el propio GradeCam guarda en `stats.answers[].cors` calzan 25/25,
   26/26 y 26/26 contra las claves del cuadernillo correspondiente ya cargado en
   la BDD, y 3-8 de 26 contra los otros dos. El script verifica ese calce en
   cada corrida (`--gate`) y aborta si deja de cumplirse.

3. En el Ensayo 1 los tres cuadernillos imprimen las MISMAS 54 preguntas del
   módulo común en ORDEN DISTINTO (bio y fis coinciden en sólo 17 de 54
   posiciones), mientras que la hoja de respuestas del assignment común es una
   sola. O sea: la posición 7 del cuadernillo de Física NO es la burbuja 7 de la
   hoja. La numeración de la hoja es la del cuadernillo de Biología (sus claves
   calzan 51/53; las de Física 19/54 y las de Química 25/54).
   Por eso el común se remapea por enunciado: para cada ítem común de un
   instrumento se busca su enunciado en el instrumento de Biología del mismo
   ensayo y esa posición es la burbuja de la hoja. En los ensayos 3 y 4 los tres
   cuadernillos ya vienen en el mismo orden y el remapeo es la identidad.

El artefacto queda con un "curso" por (mención × ensayo × sección), apuntando al
instrumento por mención que ya existe en la BDD.

El mapa de ítems se exporta de la BDD con psql (ver
`docs/runbook-carga-respuestas-paes-cie.md`).

Uso:
    python3 scripts/paes-2026/cie_a_artefacto.py \
        --dir /ruta/plataforma-dia-toolkit/data/gc_paes_2026 \
        --mapa /tmp/cie_mapa.tsv --out /tmp/artefacto-cie.json
"""

import argparse
import collections
import glob
import json
import os
import re
import statistics
import sys

# `stats.version` del assignment de mención -> mención. Verificado contra las claves
# de GradeCam en cada corrida por `verifica_gate()`.
VERSION_A_MENCION = {"1": "Biología", "2": "Física", "3": "Química"}
CODIGO_MENCION = {"Biología": "BIO", "Física": "FIS", "Química": "QUI"}

ENSAYOS = (1, 3, 4)
GRADE_CODE = "4TH_MEDIO"
# `subjects` guarda la asignatura ACADÉMICA, no la prueba PAES.
SUBJECT_NAME = "Ciencias Naturales"
POSICIONES_COMUN = 54
UMBRAL_BAJO_CONTEO = 0.5


def nombre_instrumento(mencion: str, ensayo: int) -> str:
    return f"PAES CIE mención {mencion} — Ensayo {ensayo} (Tanda {ensayo}) · IV° Medio 2026"


def normaliza(texto: str) -> str:
    return re.sub(r"\s+", "", texto or "").lower()


def carga_mapa(ruta: str) -> dict:
    """Lee el TSV `id<TAB>nombre<TAB>posicion<TAB>clave<TAB>enunciado` exportado de la BDD."""
    mapa = collections.defaultdict(
        lambda: {"id": None, "posiciones": {}, "claves": {}, "enunciados": {}}
    )
    with open(ruta, encoding="utf-8") as fh:
        for linea in fh:
            if not linea.strip():
                continue
            iid, nombre, pos, clave, enunciado = linea.rstrip("\n").split("\t")
            pos = int(pos)
            reg = mapa[nombre]
            reg["id"] = iid
            reg["posiciones"][pos] = True
            reg["claves"][pos] = clave or None
            reg["enunciados"][pos] = normaliza(enunciado)
    return mapa


def lee_escaneos(ruta: str) -> tuple:
    datos = json.load(open(ruta, encoding="utf-8"))
    filas = [x for x in datos["filteredItems"] if x.get("status") == "graded"]
    descartadas = len(datos["filteredItems"]) - len(filas)
    if datos["unfilteredCount"] != len(datos["filteredItems"]):
        raise SystemExit(
            f"{os.path.basename(ruta)}: unfilteredCount={datos['unfilteredCount']} pero llegaron "
            f"{len(datos['filteredItems'])} filas. Hay pérdida por paginación: no cargues esto."
        )
    return datos["meta"], filas, descartadas


def formatea_rut(uid: str) -> str:
    uid = (uid or "").strip().upper().replace(".", "").replace("-", "")
    return uid if len(uid) < 2 else f"{uid[:-1]}-{uid[-1]}"


def nombre_de(student: dict) -> str:
    partes = [student.get("first_name", ""), student.get("middle_name", ""), student.get("last_name", "")]
    return " ".join(p.strip() for p in partes if p and p.strip())


def seccion_de(escaneo: dict) -> str:
    nombre = ((escaneo.get("section") or {}).get("name") or "").strip().upper()
    return nombre[2:] if nombre.startswith("IV") else nombre


def respuestas_por_label(escaneo: dict) -> dict:
    salida = {}
    for a in escaneo["stats"]["answers"]:
        valor = (a.get("ans") or "").strip().upper()
        salida[int(a["label"])] = valor or None
    return salida


def claves_por_label(escaneo: dict) -> dict:
    salida = {}
    for a in escaneo["stats"]["answers"]:
        cors = a.get("cors")
        salida[int(a["label"])] = cors[0] if cors else None
    return salida


def verifica_gate(ensayo: int, mencion_por_version: dict, mapa: dict, remapeo: dict) -> None:
    """
    Gate duro: la clave que GradeCam guarda para cada versión tiene que calzar con la
    del cuadernillo de la mención que le asignamos, y no con la de las otras dos.
    """
    for version, claves in sorted(mencion_por_version.items()):
        esperada = VERSION_A_MENCION[version]
        puntajes = {}
        for mencion in VERSION_A_MENCION.values():
            reg = mapa[nombre_instrumento(mencion, ensayo)]
            comparables = [p for p in reg["posiciones"] if p > POSICIONES_COMUN and reg["claves"][p]]
            aciertos = sum(1 for p in comparables if reg["claves"][p] == claves.get(p))
            puntajes[mencion] = (aciertos, len(comparables))
        aciertos, total = puntajes[esperada]
        if aciertos != total:
            raise SystemExit(
                f"GATE E{ensayo} v{version}: la clave de GradeCam calza {aciertos}/{total} con "
                f"{esperada}. Se esperaba calce total. Puntajes: {puntajes}"
            )
        for mencion, (otros, tot) in puntajes.items():
            if mencion != esperada and otros > 0.5 * tot:
                raise SystemExit(
                    f"GATE E{ensayo} v{version}: {mencion} también calza {otros}/{tot}. Ambiguo."
                )
        print(f"  gate E{ensayo} v{version} -> {esperada}: " +
              " | ".join(f"{m[:3]} {a}/{t}" for m, (a, t) in puntajes.items()))

    # El común: su clave tiene que calzar con la del cuadernillo YA REMAPEADO.
    for mencion in VERSION_A_MENCION.values():
        reg = mapa[nombre_instrumento(mencion, ensayo)]
        rem = remapeo[mencion]
        comparables = [p for p in reg["posiciones"] if p <= POSICIONES_COMUN and reg["claves"][p] and p in rem]
        aciertos = sum(1 for p in comparables if reg["claves"][p] == remapeo["_claves_hoja"].get(rem[p]))
        print(f"  común E{ensayo} {mencion}: clave del banco vs hoja {aciertos}/{len(comparables)}"
              + ("" if aciertos == len(comparables) else "  ← revisar los que difieren"))


def construye_remapeo(ensayo: int, mapa: dict) -> dict:
    """
    Devuelve, por mención, {posicion_en_el_cuadernillo -> burbuja de la hoja del común}.
    La numeración de la hoja es la del cuadernillo de Biología (ver docstring).
    """
    bio = mapa[nombre_instrumento("Biología", ensayo)]
    burbuja_de = {
        bio["enunciados"][p]: p for p in bio["posiciones"] if p <= POSICIONES_COMUN
    }
    salida = {}
    for mencion in VERSION_A_MENCION.values():
        reg = mapa[nombre_instrumento(mencion, ensayo)]
        parcial = {}
        for p in sorted(reg["posiciones"]):
            if p > POSICIONES_COMUN:
                continue
            burbuja = burbuja_de.get(reg["enunciados"][p])
            if burbuja is not None:
                parcial[p] = burbuja
        salida[mencion] = parcial
    return salida


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="Carpeta con los JSON de GradeCam")
    ap.add_argument("--mapa", required=True, help="TSV de ítems exportado de la BDD")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    mapa = carga_mapa(args.mapa)
    cursos, marcados, incidencias = [], [], collections.defaultdict(list)
    version_por_alumno = collections.defaultdict(dict)

    for ensayo in ENSAYOS:
        (ruta_comun,) = glob.glob(os.path.join(args.dir, f"E{ensayo}_CIE-COMUN_*.json"))
        (ruta_mencion,) = glob.glob(os.path.join(args.dir, f"E{ensayo}_CIE-MENCION_*.json"))
        meta_comun, filas_comun, desc_comun = lee_escaneos(ruta_comun)
        meta_mencion, filas_mencion, desc_mencion = lee_escaneos(ruta_mencion)
        if desc_comun or desc_mencion:
            incidencias["escaneos_no_graded"].append(
                f"E{ensayo}: común={desc_comun} mención={desc_mencion}"
            )

        comun_por_uid = {}
        for escaneo in filas_comun:
            uid = (escaneo["student"].get("student_uid") or "").strip().upper()
            comun_por_uid[uid] = escaneo

        remapeo = construye_remapeo(ensayo, mapa)
        claves_hoja = claves_por_label(filas_comun[0])
        remapeo["_claves_hoja"] = claves_hoja
        por_version = {}
        for escaneo in filas_mencion:
            v = escaneo["stats"]["version"]
            if v not in por_version:
                por_version[v] = claves_por_label(escaneo)
        verifica_gate(ensayo, por_version, mapa, remapeo)

        uids_mencion = set()
        agrupado = collections.defaultdict(list)
        for escaneo in filas_mencion:
            version = escaneo["stats"]["version"]
            mencion = VERSION_A_MENCION.get(version)
            if mencion is None:
                incidencias["version_desconocida"].append(f"E{ensayo} v{version}")
                continue
            uid = (escaneo["student"].get("student_uid") or "").strip().upper()
            uids_mencion.add(uid)
            version_por_alumno[uid][ensayo] = (mencion, nombre_de(escaneo["student"]))

            reg = mapa[nombre_instrumento(mencion, ensayo)]
            rem = remapeo[mencion]
            propias = respuestas_por_label(escaneo)
            escaneo_comun = comun_por_uid.get(uid)
            del_comun = respuestas_por_label(escaneo_comun) if escaneo_comun else {}
            if escaneo_comun is None:
                incidencias["sin_comun"].append(
                    f"E{ensayo} {uid} {nombre_de(escaneo['student'])} ({mencion})"
                )

            respuestas, efectivas, sin_burbuja = {}, 0, 0
            for pos in sorted(reg["posiciones"]):
                if pos <= POSICIONES_COMUN:
                    burbuja = rem.get(pos)
                    if burbuja is None:
                        sin_burbuja += 1
                        valor = None
                    else:
                        valor = del_comun.get(burbuja)
                else:
                    valor = propias.get(pos)
                respuestas[str(pos)] = valor
                if valor:
                    efectivas += 1
            if sin_burbuja:
                aviso = (
                    f"E{ensayo} {mencion}: {sin_burbuja} ítem(s) del común sin equivalente en la "
                    "hoja (quedan sin respuesta para todo el curso)"
                )
                if aviso not in incidencias["items_comun_sin_burbuja"]:
                    incidencias["items_comun_sin_burbuja"].append(aviso)

            agrupado[(mencion, seccion_de(escaneo))].append(
                {
                    "rut": formatea_rut(uid),
                    "nombre": nombre_de(escaneo["student"]),
                    "answers": respuestas,
                    "_efectivas": efectivas,
                }
            )

        for uid, escaneo in comun_por_uid.items():
            if uid not in uids_mencion:
                incidencias["solo_comun"].append(
                    f"E{ensayo} {uid} {nombre_de(escaneo['student'])}"
                )

        for (mencion, seccion), filas in sorted(agrupado.items()):
            mediana = statistics.median(f["_efectivas"] for f in filas)
            for pos, fila in enumerate(filas, start=1):
                bajo = fila["_efectivas"] < UMBRAL_BAJO_CONTEO * mediana
                fila["bajoConteo"] = bajo
                fila["respuestasEfectivas"] = fila.pop("_efectivas")
                if bajo:
                    marcados.append(
                        {
                            "ensayo": ensayo,
                            "mencion": mencion,
                            "curso": f"IV°{seccion}",
                            "posicionEnLista": pos,
                            "respuestasEfectivas": fila["respuestasEfectivas"],
                            "medianaCurso": mediana,
                        }
                    )
            reg = mapa[nombre_instrumento(mencion, ensayo)]
            cursos.append(
                {
                    "sourceFile": f"{os.path.basename(ruta_comun)}+{os.path.basename(ruta_mencion)}",
                    "gradeCode": GRADE_CODE,
                    "section": seccion,
                    "subjectName": SUBJECT_NAME,
                    "instrumentId": reg["id"],
                    "instrumentName": nombre_instrumento(mencion, ensayo),
                    "ensayo": ensayo,
                    "asignaturaCodigo": f"CIE-{CODIGO_MENCION[mencion]}",
                    "administeredAt": meta_mencion["fecha"],
                    "questionCount": len(reg["posiciones"]),
                    "rows": filas,
                }
            )

    inconsistentes = {
        uid: v for uid, v in version_por_alumno.items()
        if len({m for m, _ in v.values()}) > 1
    }

    salida = {
        "year": 2026,
        "courses": cursos,
        "bajoConteo": marcados,
        "incidencias": {k: v for k, v in incidencias.items()},
        "mencionInconsistente": {
            uid: {
                "nombre": next(iter(v.values()))[1],
                "porEnsayo": {str(e): m for e, (m, _) in sorted(v.items())},
            }
            for uid, v in inconsistentes.items()
        },
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, indent=1)

    print(f"\ncursos={len(cursos)} filas={sum(len(c['rows']) for c in cursos)} "
          f"bajo_conteo={len(marcados)}")
    for c in cursos:
        print(f"  E{c['ensayo']} {c['asignaturaCodigo']} IV°{c['section']}: "
              f"{len(c['rows'])} filas · {c['questionCount']} ítems")
    for clave, valores in incidencias.items():
        print(f"\n  ⚠ {clave}: {len(valores)}")
        for v in valores[:40]:
            print(f"      {v}")
    print(f"\n  alumnos con mención distinta entre ensayos: {len(inconsistentes)}")
    for uid, v in sorted(inconsistentes.items()):
        detalle = " ".join(f"E{e}={m}" for e, (m, _) in sorted(v.items()))
        print(f"      {uid} {next(iter(v.values()))[1]}: {detalle}")


if __name__ == "__main__":
    main()
