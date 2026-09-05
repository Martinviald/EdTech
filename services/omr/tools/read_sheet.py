"""Lee una hoja de respuestas directo contra el motor, sin pasar por la UI.

    python -m tools.read_sheet hoja.pdf --spec layout.json
    python -m tools.read_sheet foto.jpg --spec-from-db <layoutId> --profile phone
    python -m tools.read_sheet hoja.pdf --spec layout.json --json > salida.json

Existe para cortar el ciclo caro de iteracion: imprimir, rendir, escanear, subir
por la UI, crear el lote, esperar el procesamiento y recien ahi ver por que una
hoja se rechazo. Corre `read_scan_debug` EN PROCESO con el descargador apuntando
al archivo local (mismo camino que usa el harness del conjunto de oro), asi que
no necesita el servicio levantado, ni S3, ni el backend, ni la base.

Lo que imprime por pagina es lo que hace falta para diagnosticar: cuantos
fiduciales se detectaron y por que se rechazo, si el QR decodifico, y el detalle
de cada marca con su relleno, umbral y margen — los tres numeros que explican por
que una marca quedo dudosa.

`--spec-from-db` es una comodidad de desarrollo: saca el layout congelado de la
base local con `psql`, leyendo DATABASE_URL del .env de la raiz del repo. Acepta
el id de un layout o el de una tirada.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

OMR_ROOT = Path(__file__).resolve().parents[1]
if str(OMR_ROOT) not in sys.path:
    sys.path.insert(0, str(OMR_ROOT))

from app.pipeline import read_scan_debug  # noqa: E402

REPO_ROOT = OMR_ROOT.parents[1]
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

PROFILES = {
    "scanner": {
        "source": "scanner",
        "normalizeIllumination": False,
        "minSharpness": 0.45,
        "maxGlare": 0.35,
        "expectedDpi": 300,
    },
    "phone": {
        "source": "phone",
        "normalizeIllumination": True,
        "minSharpness": 0.35,
        "maxGlare": 0.25,
        "expectedDpi": None,
    },
}


class ToolError(Exception):
    pass


def database_url() -> str:
    env = REPO_ROOT / ".env"
    if not env.exists():
        raise ToolError(f"No encontre {env}: usa --spec con un archivo JSON.")
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    raise ToolError("DATABASE_URL no esta en el .env: usa --spec con un archivo JSON.")


def spec_from_db(identifier: str) -> dict[str, Any]:
    """Trae el spec congelado por id de layout, o por id de tirada."""
    if not UUID_RE.match(identifier):
        raise ToolError(f"'{identifier}' no parece un UUID de layout ni de tirada.")
    # El id ya paso por UUID_RE, asi que no puede llevar comillas ni ';'.
    query = (
        f"select spec from sheet_layouts where id = '{identifier}' "
        "union all "
        f"select l.spec from sheet_layouts l "
        f"join sheet_print_runs r on r.layout_id = l.id where r.id = '{identifier}' "
        "limit 1"
    )
    try:
        out = subprocess.run(
            ["psql", database_url(), "-tAc", query],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        ).stdout.strip()
    except FileNotFoundError as error:
        raise ToolError("No encontre `psql` en el PATH.") from error
    except subprocess.CalledProcessError as error:
        raise ToolError(f"psql fallo: {error.stderr.strip()}") from error
    if not out:
        raise ToolError(f"No hay layout ni tirada con id {identifier} en la base local.")
    return json.loads(out)


def build_source(paths: list[Path]) -> dict[str, Any]:
    suffixes = {p.suffix.lower() for p in paths}
    if suffixes == {".pdf"}:
        if len(paths) > 1:
            raise ToolError("Pasa un solo PDF, o varias imagenes; no una mezcla.")
        return {"kind": "pdf", "pdfUrl": str(paths[0]), "imageUrls": None}
    if suffixes <= IMAGE_SUFFIXES:
        return {"kind": "images", "pdfUrl": None, "imageUrls": [str(p) for p in paths]}
    raise ToolError(f"Extensiones no soportadas: {sorted(suffixes)}")


def render(result: dict[str, Any], debug: list[dict[str, Any]], show_marks: bool) -> None:
    """`read_scan_debug` devuelve UNA lista de dicts de debug, una por pagina."""
    for page, page_debug in zip(result["pages"], debug, strict=False):
        quality = page["quality"]
        identity = page.get("identity") or {}
        verdict = "LEIDA" if quality["ok"] else f"RECHAZADA ({quality.get('rejectReason')})"
        print(f"\n── pagina {page['pageIndex']} — {verdict}")
        print(
            f"   fiduciales {quality.get('fiducialsFound')}/4"
            f"   nitidez {quality['sharpness']}"
            f"   reflejo {quality['glare']}"
            f"   orientacion {page_debug.get('orientationDegrees', 0)}°"
        )
        raw = identity.get("raw")
        print(f"   identidad: {raw if raw else 'SIN RESOLVER'}", end="")
        print(f"   (confianza {identity.get('confidence')})" if raw else "")

        marks = page.get("marks") or []
        if not marks:
            print("   sin marcas leidas")
            continue
        counts: dict[str, int] = {}
        for mark in marks:
            counts[mark["state"]] = counts.get(mark["state"], 0) + 1
        resumen = "  ".join(f"{state}={n}" for state, n in sorted(counts.items()))
        print(f"   {len(marks)} marcas   {resumen}")
        if page_debug.get("threshold") is not None:
            print(
                f"   umbral de la pagina {page_debug['threshold']}"
                f"   separables={page_debug.get('separable')}"
                f"   brecha={page_debug.get('gap')}"
            )
        registration = page_debug.get("registration") or {}
        if registration.get("bubbles"):
            print(
                f"   registro: desplazamiento med {registration['offMedianPx']} px"
                f"   p90 {registration['offP90Px']}   max {registration['offMaxPx']}"
                f"   score p10 {registration['scoreP10']}"
                f"   al spec {registration['fallbackCount']}"
                f"   heredados {registration['inheritedCount']}"
            )
        if not show_marks:
            continue
        print(f"\n   {'n':>4}  {'estado':<10} {'valor':<6} {'relleno':>8} {'margen':>7}")
        for mark in marks:
            value = mark.get("value") or "—"
            print(
                f"   {mark['printedNumber']:>4}  {mark['state']:<10} {value:<6}"
                f" {mark['fill']:>8.3f} {mark['margin']:>7.3f}"
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tools.read_sheet",
        description="Lee una hoja de respuestas directo contra el motor, sin la UI.",
    )
    parser.add_argument("paths", nargs="+", type=Path, help="Un PDF, o una o mas imagenes")
    spec_group = parser.add_mutually_exclusive_group(required=True)
    spec_group.add_argument("--spec", type=Path, help="Archivo JSON con el layout-spec")
    spec_group.add_argument(
        "--spec-from-db", metavar="ID", help="Id de layout o de tirada en la base local"
    )
    parser.add_argument("--profile", choices=sorted(PROFILES), default="scanner")
    parser.add_argument("--marks", action="store_true", help="Detalle marca por marca")
    parser.add_argument("--json", action="store_true", help="Volcar el ScanResult crudo")
    args = parser.parse_args(argv)

    for path in args.paths:
        if not path.exists():
            raise ToolError(f"No existe {path}")

    spec = (
        json.loads(args.spec.read_text(encoding="utf-8"))
        if args.spec
        else spec_from_db(args.spec_from_db)
    )
    request = {
        "layoutSpec": spec,
        "captureProfile": dict(PROFILES[args.profile]),
        "source": build_source(args.paths),
    }
    result, debug = read_scan_debug(request, fetch=lambda url: Path(url).read_bytes())

    if args.json:
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        print()
        return 0

    print(f"{len(result['pages'])} pagina(s) — perfil {args.profile}")
    render(result, debug, args.marks)
    rejected = sum(1 for page in result["pages"] if not page["quality"]["ok"])
    print(f"\n{len(result['pages']) - rejected} leidas, {rejected} rechazadas")
    return 1 if rejected else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ToolError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        sys.exit(130)
