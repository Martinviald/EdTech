#!/usr/bin/env python3
"""Fusiona los cuadernillos por mención de Ciencias PAES en UN instrumento por ensayo, en el
formato que consume `import-instruments.ts`, y emite el mapa legacy → fusionado que usa
`db:migrate:cie-electivas` para re-apuntar las respuestas.

Entrada: los 9 JSON del repo `packages/db/data/instruments-paes/CIE/CIE-E{n}-{BIO,FIS,QUI}-con-pauta.json`.
Salida:
  - `CIE-E{n}-fusionado.json` (en el mismo directorio): 4 secciones, módulo común (`core`) +
    tres menciones (`elective`, grupo `mencion-ciencias`, claves y líneas BIO/FIS/QUI). El
    instrumento lleva la línea `CIE-COMUN`; la sección común no lleva línea (la hereda).
  - `cie-electivas-mapa.json` (un nivel arriba): por ensayo, qué JSON legacy corresponde a
    cada mención y, por cada ítem legacy (mención, número impreso), a qué ítem fusionado va
    (sección, número impreso).

Reglas (ver docs/tablero/f3-ciencias-electivas.md):
  - El común es canónico en Biología. Física y Química se emparejan por ENUNCIADO con
    `mapear_comun_cie.match` (en E1 el común está en otro orden en cada cuadernillo).
  - La storage key de la figura viaja tal cual (`imageRef`): nunca se deriva de la posición
    nueva. Si el canónico no tiene figura y un equivalente sí, se usa la del equivalente.
  - El número impreso del común es el de Biología; el de cada mención, el de su cuadernillo.

Uso:  python3 scripts/paes-2026/fusionar_cie_electivas.py [--dir packages/db/data/instruments-paes/CIE]
Sale con código 1 si la fusión no da 54 + 3×26 o si el gate de figuras no cierra.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mapear_comun_cie import match  # noqa: E402

MENCIONES = [("BIO", "Biología"), ("FIS", "Física"), ("QUI", "Química")]
CANONICA = "BIO"
GRUPO = "mencion-ciencias"
LINEA_INSTRUMENTO = "CIE-COMUN"
ENSAYOS = ("E1", "E3", "E4")
N_COMUN = 54
N_MENCION = 26


def legacy_name(ensayo: str, men: str) -> str:
    return f"CIE-{ensayo}-{men}-con-pauta.json"


def fused_name(ensayo: str) -> str:
    return f"CIE-{ensayo}-fusionado.json"


def items_of(doc: dict) -> list[dict]:
    return [it for s in doc["sections"] for it in s["items"]]


def printed(it: dict) -> str:
    return str(it.get("printedNumber") or it["position"])


def item_out(it: dict, position: int, printed_number: str, image_ref: str | None) -> dict:
    out: dict = {}
    for k, v in it.items():
        if k in ("position", "printedNumber", "imageRef"):
            continue
        out[k] = v
        if k == "figureNote" and image_ref:
            out["imageRef"] = image_ref
    if image_ref and "imageRef" not in out:
        out["imageRef"] = image_ref
    res = {"position": position}
    if printed_number != str(position):
        res["printedNumber"] = printed_number
    res.update(out)
    return res


def fusionar(directorio: Path, ensayo: str) -> tuple[dict, dict, list[str]]:
    errores: list[str] = []
    docs = {m: json.load(open(directorio / legacy_name(ensayo, m))) for m, _ in MENCIONES}
    por_men = {m: items_of(docs[m]) for m, _ in MENCIONES}
    comun = {m: [it for it in por_men[m] if it["position"] <= N_COMUN] for m, _ in MENCIONES}

    canonicos = sorted(comun[CANONICA], key=lambda x: x["position"])
    equivalentes: dict[str, dict[int, int]] = {}
    for m, _ in MENCIONES:
        if m == CANONICA:
            continue
        pares, sin_par = match(canonicos, comun[m])
        equivalentes[m] = {k: v[0] for k, v in pares.items()}
        if sin_par or len(pares) != len(comun[m]):
            errores.append(f"{ensayo}/{m}: común sin par en {CANONICA} {sin_par}")

    por_pos = {m: {it["position"]: it for it in por_men[m]} for m, _ in MENCIONES}
    mapa_items: list[dict] = []
    seccion_comun = []
    for n, it in enumerate(canonicos, start=1):
        copias = [(CANONICA, it)] + [
            (m, por_pos[m][equivalentes[m][it["position"]]])
            for m, _ in MENCIONES
            if m != CANONICA and it["position"] in equivalentes[m]
        ]
        image_ref = next((c.get("imageRef") for _, c in copias if c.get("imageRef")), None)
        seccion_comun.append(item_out(it, n, printed(it), image_ref))
        for m, copia in copias:
            mapa_items.append({
                "electiveKey": m,
                "legacyPrintedNumber": printed(copia),
                "fusedElectiveKey": None,
                "fusedPrintedNumber": printed(it),
            })

    secciones = [{
        "order": 1, "name": "Módulo común", "type": "multiple_choice", "role": "core",
        "instructions": None, "passage": None, "items": seccion_comun,
    }]
    siguiente = len(seccion_comun) + 1
    for orden, (m, nombre) in enumerate(MENCIONES, start=2):
        propios = sorted((it for it in por_men[m] if it["position"] > N_COMUN), key=lambda x: x["position"])
        elegidos = []
        for it in propios:
            elegidos.append(item_out(it, siguiente, printed(it), it.get("imageRef")))
            mapa_items.append({
                "electiveKey": m,
                "legacyPrintedNumber": printed(it),
                "fusedElectiveKey": m,
                "fusedPrintedNumber": printed(it),
            })
            siguiente += 1
        if len(elegidos) != N_MENCION:
            errores.append(f"{ensayo}/{m}: {len(elegidos)} ítems de mención (se esperaban {N_MENCION})")
        secciones.append({
            "order": orden, "name": f"Mención {nombre}", "type": "multiple_choice",
            "role": "elective", "electiveGroup": GRUPO, "electiveKey": m, "track": m,
            "instructions": None, "passage": None, "items": elegidos,
        })
    if len(seccion_comun) != N_COMUN:
        errores.append(f"{ensayo}: {len(seccion_comun)} ítems comunes (se esperaban {N_COMUN})")

    base = docs[CANONICA]["instrument"]
    paes = {**base.get("paes", {}), "mencion": None}
    numero = ensayo.lstrip("E")
    tanda = paes.get("tanda") or f"Tanda {numero}"
    instrumento = {
        **{k: v for k, v in base.items() if k not in ("paes", "track")},
        "name": f"PAES CIE — Ensayo {numero} ({tanda}) · IV° Medio 2026",
        "subject": "Ciencias",
        "track": LINEA_INSTRUMENTO,
        "paes": paes,
    }
    total = sum(len(s["items"]) for s in secciones)
    doc = {
        "instrument": instrumento,
        "sections": secciones,
        "pauta": {"source": {"instrumentJson": fused_name(ensayo)}},
        "extraction": {
            "itemCount": total,
            "fusedFrom": [legacy_name(ensayo, m) for m, _ in MENCIONES],
            "generator": "scripts/paes-2026/fusionar_cie_electivas.py",
        },
    }
    entrada = {
        "fused": {"sourceJson": fused_name(ensayo), "file": f"CIE/{fused_name(ensayo)}"},
        "legacy": [{"sourceJson": legacy_name(ensayo, m), "electiveKey": m} for m, _ in MENCIONES],
        "items": mapa_items,
    }
    return doc, entrada, errores


def keys_of(doc: dict) -> list[str]:
    out = []
    for s in doc["sections"]:
        for it in s["items"]:
            if it.get("imageRef"):
                out.append(it["imageRef"])
            out += [a["imageRef"] for a in it.get("alternatives") or [] if a.get("imageRef")]
    return out


def gate_figuras(directorio: Path, fusionados: dict[str, dict], mapa: list[dict]) -> list[str]:
    """Toda key de un fusionado viene de un legacy, y toda key legacy queda en el fusionado
    salvo las de copias NO canónicas de un ítem común cuyo canónico conserva su propia key."""
    errores: list[str] = []
    legacy_keys: dict[str, tuple[str, str, str]] = {}
    for ensayo in ENSAYOS:
        for m, _ in MENCIONES:
            doc = json.load(open(directorio / legacy_name(ensayo, m)))
            for it in items_of(doc):
                for k in ([it["imageRef"]] if it.get("imageRef") else []):
                    if k in legacy_keys:
                        errores.append(f"key repetida en legacy: {k}")
                    legacy_keys[k] = (ensayo, m, printed(it))
    fused_keys: list[str] = [k for d in fusionados.values() for k in keys_of(d)]
    inventadas = sorted(set(fused_keys) - set(legacy_keys))
    repetidas = len(fused_keys) - len(set(fused_keys))
    destino: dict[tuple[str, str, str], tuple[str, str | None, str]] = {}
    for entrada in mapa:
        ensayo = entrada["fused"]["sourceJson"].split("-")[1]
        for it in entrada["items"]:
            destino[(ensayo, it["electiveKey"], it["legacyPrintedNumber"])] = (
                ensayo, it["fusedElectiveKey"], it["fusedPrintedNumber"])
    key_de_fusionado: dict[tuple[str, str | None, str], str] = {}
    for ensayo, d in fusionados.items():
        for s in d["sections"]:
            for it in s["items"]:
                if it.get("imageRef"):
                    key_de_fusionado[(ensayo, s.get("electiveKey"), printed(it))] = it["imageRef"]
    perdidas, deduplicadas = [], []
    for k, origen in legacy_keys.items():
        d = destino.get(origen)
        if d is None:
            perdidas.append(k)
            continue
        actual = key_de_fusionado.get(d)
        if actual == k:
            continue
        if actual is not None and d[1] is None:
            deduplicadas.append(k)
        else:
            perdidas.append(k)
    print(f"  figuras: legacy={len(legacy_keys)} fusionadas={len(fused_keys)} "
          f"(conservadas={len(set(fused_keys))}, copias del común deduplicadas={len(deduplicadas)}, "
          f"perdidas={len(perdidas)}, inventadas={len(inventadas)}, repetidas={repetidas})")
    if len(set(fused_keys)) + len(deduplicadas) != len(legacy_keys):
        errores.append("el conteo conservadas + deduplicadas no cuadra con las legacy")
    if perdidas:
        errores.append(f"keys perdidas: {perdidas[:5]}")
    if inventadas:
        errores.append(f"keys inventadas: {inventadas[:5]}")
    if repetidas:
        errores.append(f"{repetidas} keys repetidas en los fusionados")
    return errores


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="packages/db/data/instruments-paes/CIE")
    ap.add_argument("--mapa", default="packages/db/data/instruments-paes/cie-electivas-mapa.json")
    a = ap.parse_args()
    directorio = Path(a.dir)
    errores: list[str] = []
    fusionados: dict[str, dict] = {}
    entradas = []
    for ensayo in ENSAYOS:
        doc, entrada, errs = fusionar(directorio, ensayo)
        errores += errs
        fusionados[ensayo] = doc
        entradas.append(entrada)
        print(f"{fused_name(ensayo)}: {doc['extraction']['itemCount']} ítems · "
              + " · ".join(f"{s['name']} {len(s['items'])}" for s in doc["sections"]))
    errores += gate_figuras(directorio, fusionados, entradas)
    if errores:
        for e in errores:
            print("  !", e)
        sys.exit(1)
    for ensayo, doc in fusionados.items():
        (directorio / fused_name(ensayo)).write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    mapa = {
        "schemaVersion": 1,
        "description": "Ciencias PAES 2026: 9 instrumentos por mención -> 3 instrumentos con "
                       "secciones electivas. Generado por scripts/paes-2026/fusionar_cie_electivas.py; "
                       "lo consume db:migrate:cie-electivas.",
        "loadKey": "paes-2026-cie",
        "instruments": entradas,
    }
    Path(a.mapa).write_text(json.dumps(mapa, ensure_ascii=False, indent=1))
    print(f"OK: 3 fusionados + {a.mapa}")


if __name__ == "__main__":
    main()
