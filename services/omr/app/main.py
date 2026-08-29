"""Servicio de vision del lector de marcas (E22).

POST /v1/read: (imagen, LayoutSpec) -> ScanResult. Sin estado, sin base de
datos, sin conocimiento de tenants (el aislamiento NUNCA depende de este
servicio — recibe URLs firmadas de vida corta emitidas por la API, que ya
valido el tenant). El QualityGate corre ADENTRO y su veredicto es parte de la
respuesta: un 200 con quality.ok=false es una respuesta correcta.

Codigos de error del contrato (docs/e22-lector-contracts.md):
  422 -> request invalido contra el JSON Schema (bug del backend, no reintentar)
  502 -> no se pudo descargar una imagen fuente
  504 -> tiempo limite por pagina (todas las paginas lo excedieron; si solo
         algunas, se omiten del resultado y la respuesta sigue siendo 200)
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .contracts import validate
from .pipeline import AllPagesTimedOut, read_scan
from .sources import SourceDecodeError, SourceDownloadError

app = FastAPI(title="omr-service", version="0.2.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "omr", "version": "0.2.0"}


@app.post("/v1/read")
def read(payload: dict[str, Any]) -> Any:
    errors = validate("read-request", payload)
    if errors:
        return JSONResponse(status_code=422, content={"errors": errors})

    try:
        result = read_scan(payload)
    except SourceDownloadError as error:
        return JSONResponse(status_code=502, content={"errors": [str(error)]})
    except SourceDecodeError as error:
        return JSONResponse(status_code=502, content={"errors": [str(error)]})
    except AllPagesTimedOut as error:
        return JSONResponse(status_code=504, content={"errors": [str(error)]})

    output_errors = validate("scan-result", result)
    if output_errors:
        bug_errors = [f"scan-result invalido (bug del servicio): {e}" for e in output_errors]
        return JSONResponse(status_code=500, content={"errors": bug_errors})
    return result
