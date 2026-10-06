#!/usr/bin/env python3
"""Reescribe el instrumentId de un artefacto PAES con el id que tiene en la BDD local.

Los conversores traen fijos los ids de la BDD demo; en la BDD local el importador
regenera los UUID, así que se resuelven por nombre exacto del instrumento.

Uso: remapear-instrumentos.py <artefacto.json> <database_url>
"""

import json
import subprocess
import sys


def ids_por_nombre(database_url: str) -> dict[str, str]:
    salida = subprocess.run(
        [
            "psql", database_url, "-At", "-F", "\t", "-c",
            "select name, id from instruments where type = 'paes' and deleted_at is null",
        ],
        check=True, capture_output=True, text=True,
    ).stdout
    pares = [linea.split("\t") for linea in salida.splitlines() if linea]
    return {nombre: iid for nombre, iid in pares}


def main() -> None:
    ruta, database_url = sys.argv[1], sys.argv[2]
    artefacto = json.load(open(ruta, encoding="utf-8"))
    ids = ids_por_nombre(database_url)
    faltantes = sorted({c["instrumentName"] for c in artefacto["courses"] if c["instrumentName"] not in ids})
    if faltantes:
        sys.exit(f"Instrumentos sin cargar en la BDD local: {faltantes}")
    for curso in artefacto["courses"]:
        curso["instrumentId"] = ids[curso["instrumentName"]]
    json.dump(artefacto, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{ruta}: {len(artefacto['courses'])} cursos remapeados")


if __name__ == "__main__":
    main()
