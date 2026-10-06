#!/usr/bin/env python3
"""Recupera la numeración de los 54 ítems COMUNES en los cuadernillos de Física y Química.

Las Tablas de especificaciones de las tandas 3 y 4 solo llenaron la columna N°B: para
Física y Química el común quedó sin numerar, así que su clave no se puede mapear por tabla.
Pero el común es literalmente el mismo ítem en los tres cuadernillos, solo que en otro
orden: se empareja por el texto del enunciado contra el cuadernillo de Biología, que sí
tiene la numeración, y se arrastra la clave.

El método se valida contra la tanda 1, donde la tabla SÍ trae N°F y N°Q: ahí el
emparejamiento por texto tiene que reproducir exactamente la numeración declarada.
"""
from __future__ import annotations

import difflib
import json
import re
import sys
import unicodedata


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", re.sub(r"\s+", " ", s)).strip()


def items(path):
    return [i for s in json.load(open(path))["sections"] for i in s["items"]]


def match(src_items, dst_items, cutoff=0.80):
    """Empareja cada ítem común del cuadernillo fuente con su gemelo en el destino."""
    dst = {i["position"]: norm(i["stem"]) for i in dst_items if i["position"] <= 54}
    pairs, unmatched = {}, []
    used = set()
    for it in src_items:
        if it["position"] > 54:
            continue
        s = norm(it["stem"])
        cands = {p: difflib.SequenceMatcher(None, s, t).ratio()
                 for p, t in dst.items() if p not in used}
        if not cands:
            unmatched.append(it["position"])
            continue
        best = max(cands, key=cands.get)
        if cands[best] < cutoff:
            unmatched.append(it["position"])
            continue
        used.add(best)
        pairs[it["position"]] = (best, round(cands[best], 3))
    return pairs, unmatched


if __name__ == "__main__":
    bio, dst_path = sys.argv[1], sys.argv[2]
    pairs, unmatched = match(items(bio), items(dst_path))
    ratios = [r for _, r in pairs.values()]
    print(f"{dst_path.split('/')[-1]}: {len(pairs)}/54 emparejados "
          f"(similitud min={min(ratios):.2f} mediana={sorted(ratios)[len(ratios)//2]:.2f})"
          + (f" · sin par: {unmatched}" if unmatched else ""))
    if len(sys.argv) > 3:
        json.dump({str(k): v[0] for k, v in pairs.items()}, open(sys.argv[3], "w"), indent=1)
