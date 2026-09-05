"""Runner del conjunto de oro (T3): `python -m goldset.run [data_dir]`.

Por cada hoja arma el request del contrato (layoutSpec congelado del corte +
CaptureProfile segun el corte: scanner-adf -> scanner, phone-*/dirty -> phone)
y lee las paginas. Por defecto corre IN-PROCESS: importa
`app.pipeline.read_scan_debug` con el descargador stubbeado a archivos
locales — sin red, sin servicio corriendo. Con `--service-url URL` corre
contra el servicio HTTP real via `POST /v1/read?debug=1`, sirviendo los
archivos locales desde un HTTP server efimero en 127.0.0.1.

Produce goldset/reports/report-<fecha>.md (veredicto y desgloses) y .json
(datos crudos por marca). Codigo de salida: 0 = APRUEBA, 1 = NO APRUEBA,
2 = error del harness.
"""

from __future__ import annotations

import argparse
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from app.pipeline import read_scan_debug

from .dataset import (
    DatasetError,
    GoldSheet,
    consensus_answers,
    discover_sheets,
    load_spec,
    load_truth,
    page_files,
)
from .report import build_report, render_markdown, write_reports
from .scoring import MarkOutcome, ScoringError, score_sheet

DEFAULT_DATA_DIR = Path(__file__).parent / "data"
DEFAULT_REPORTS_DIR = Path(__file__).parent / "reports"

SCANNER_PROFILE = {
    "source": "scanner",
    "normalizeIllumination": False,
    "minSharpness": 0.45,
    "maxGlare": 0.35,
    "expectedDpi": 300,
}
PHONE_PROFILE = {
    "source": "phone",
    "normalizeIllumination": True,
    "minSharpness": 0.35,
    "maxGlare": 0.25,
    "expectedDpi": None,
}
PROFILES_BY_CUT = {
    "scanner-adf": SCANNER_PROFILE,
    "phone-good": PHONE_PROFILE,
    "phone-bad": PHONE_PROFILE,
    "dirty": PHONE_PROFILE,
    "real-phone": PHONE_PROFILE,
    "real-scanner": SCANNER_PROFILE,
}


class HarnessError(Exception):
    pass


def build_request(
    sheet: GoldSheet, spec: dict[str, Any], to_url: Any
) -> dict[str, Any]:
    kind, paths = page_files(sheet)
    if kind == "pdf":
        source = {"kind": "pdf", "pdfUrl": to_url(paths[0]), "imageUrls": None}
    else:
        source = {"kind": "images", "pdfUrl": None, "imageUrls": [to_url(p) for p in paths]}
    return {
        "layoutSpec": spec,
        "captureProfile": dict(PROFILES_BY_CUT[sheet.cut]),
        "source": source,
    }


def read_in_process(request: dict[str, Any]) -> dict[str, Any]:
    result, _ = read_scan_debug(request, fetch=_read_local_file)
    return result


def _read_local_file(url: str) -> bytes:
    return Path(url).read_bytes()


class _LocalFileServer:
    def __init__(self, root: Path) -> None:
        handler = partial(SimpleHTTPRequestHandler, directory=str(root))
        self._root = root
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def __enter__(self) -> _LocalFileServer:
        self._thread.start()
        return self

    def __exit__(self, *exc_info: object) -> None:
        self._server.shutdown()
        self._server.server_close()

    def url_for(self, path: Path) -> str:
        relative = path.resolve().relative_to(self._root.resolve()).as_posix()
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}/{relative}"


def read_via_service(request: dict[str, Any], service_url: str) -> dict[str, Any]:
    import httpx

    response = httpx.post(
        f"{service_url.rstrip('/')}/v1/read",
        params={"debug": 1},
        json=request,
        timeout=120.0,
    )
    if response.status_code != 200:
        raise HarnessError(
            f"El servicio respondio {response.status_code}: {response.text[:500]}"
        )
    return response.json()["result"]


def run_goldset(
    data_dir: Path, service_url: str | None = None
) -> tuple[dict[str, Any], int]:
    sheets = discover_sheets(data_dir)
    if service_url:
        with _LocalFileServer(data_dir) as server:
            outcomes = _score_all(
                sheets, server.url_for, lambda req: read_via_service(req, service_url)
            )
        mode = f"servicio HTTP ({service_url})"
    else:
        outcomes = _score_all(sheets, str, read_in_process)
        mode = "in-process (app.pipeline.read_scan_debug)"
    return build_report(outcomes, data_dir, len(sheets), mode), len(sheets)


def _score_all(sheets: list[GoldSheet], to_url: Any, reader: Any) -> list[MarkOutcome]:
    outcomes: list[MarkOutcome] = []
    for sheet in sheets:
        truth = load_truth(sheet)
        spec = load_spec(sheet, truth)
        answers = consensus_answers(sheet, truth)
        request = build_request(sheet, spec, to_url)
        result = reader(request)
        outcomes.extend(score_sheet(sheet.label, sheet.cut, spec, answers, result))
    return outcomes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m goldset.run",
        description="Corre el pipeline sobre el conjunto de oro y mide las tres cifras",
    )
    parser.add_argument("data_dir", nargs="?", default=str(DEFAULT_DATA_DIR))
    parser.add_argument("--service-url", default=None)
    parser.add_argument("--reports-dir", default=str(DEFAULT_REPORTS_DIR))
    args = parser.parse_args(argv)

    try:
        report, _ = run_goldset(Path(args.data_dir), args.service_url)
    except (DatasetError, ScoringError, HarnessError) as error:
        print(f"ERROR: {error}")
        return 2

    md_path, json_path = write_reports(report, Path(args.reports_dir))
    print(render_markdown(report))
    print(f"Reporte escrito en {md_path} y {json_path}")
    return 0 if report["verdict"] == "APRUEBA" else 1


if __name__ == "__main__":
    sys.exit(main())
