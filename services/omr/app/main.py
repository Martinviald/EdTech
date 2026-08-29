"""Servicio de vision del lector de marcas (E22).

POST /v1/read: (imagen, LayoutSpec) -> ScanResult. Sin estado, sin base de
datos, sin conocimiento de tenants (el aislamiento NUNCA depende de este
servicio — recibe URLs firmadas de vida corta emitidas por la API, que ya
valido el tenant). El QualityGate corre ADENTRO y su veredicto es parte de la
respuesta: un 200 con quality.ok=false es una respuesta correcta.

Codigos de error del contrato (docs/e22-lector-contracts.md):
  422 -> request invalido contra el JSON Schema (bug del backend, no reintentar)
  502 -> no se pudo descargar una imagen fuente
  504 -> tiempo limite por pagina
"""

from __future__ import annotations

import hashlib
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .contracts import validate

app = FastAPI(title="omr-service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "omr", "version": "0.1.0"}


@app.post("/v1/read")
def read(payload: dict[str, Any]) -> Any:
    errors = validate("read-request", payload)
    if errors:
        return JSONResponse(status_code=422, content={"errors": errors})

    result = _stub_scan_result(payload)

    output_errors = validate("scan-result", result)
    if output_errors:
        bug_errors = [f"scan-result invalido (bug del servicio): {e}" for e in output_errors]
        return JSONResponse(status_code=500, content={"errors": bug_errors})
    return result


def _stub_scan_result(payload: dict[str, Any]) -> dict[str, Any]:
    """Esqueleto F0: respuesta valida y deterministica SIN vision real.

    La ola F1 (workstream B1) reemplaza esto por el pipeline
    PageSource -> Rectifier -> QualityGate -> FieldReader/MarkClassifier.
    """
    spec = payload["layoutSpec"]
    source = payload["source"]
    urls = [source["pdfUrl"]] if source["kind"] == "pdf" else list(source["imageUrls"])

    pages = []
    for page_index, url in enumerate(urls):
        pages.append(
            {
                "pageIndex": page_index,
                "imageSha256": hashlib.sha256(url.encode()).hexdigest(),
                "quality": {
                    "ok": False,
                    "sharpness": 0.0,
                    "glare": 0.0,
                    "fiducialsFound": 0,
                    "rejectReason": "fiducials_missing",
                },
                "identity": {"mode": spec["identity"]["mode"], "raw": None, "confidence": 0.0},
                "marks": [],
                "pageThumbJpegBase64": None,
            }
        )
    return {"pages": pages}
