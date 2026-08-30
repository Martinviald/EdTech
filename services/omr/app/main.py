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

Modo debug (T4, opt-in para el conjunto de oro O4): `POST /v1/read?debug=1`
responde `{ result: ScanResult, debug: { pages: [...] } }` con histograma de
fills, threshold/gap/stds, conteo por estado, sharpness/glare crudos y ms por
etapa. Sin `?debug=1` la respuesta es el ScanResult puro del contrato — el
schema (additionalProperties:false) no cambia.

POST /v1/assess (CD-11): (imagen base64, LayoutSpec) -> { imageSha256,
quality, identity }. Subset de read: rectificacion + QualityGate + QR/grilla
RUT, SIN clasificar marcas; presupuesto <1s por imagen. Una imagen que no
decodifica es un request invalido (422): aca no hay descarga, el payload ES
la imagen.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from .contracts import validate
from .pipeline import AllPagesTimedOut, assess_page, read_scan, read_scan_debug
from .sources import SourceDecodeError, SourceDownloadError, decode_base64_image

app = FastAPI(title="omr-service", version="0.3.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "omr", "version": "0.3.0"}


@app.post("/v1/assess")
def assess_capture(payload: dict[str, Any]) -> Any:
    errors = validate("assess-request", payload)
    if errors:
        return JSONResponse(status_code=422, content={"errors": errors})

    try:
        bgr = decode_base64_image(payload["imageBase64"])
    except SourceDecodeError as error:
        return JSONResponse(status_code=422, content={"errors": [str(error)]})

    result = assess_page(bgr, payload["layoutSpec"], payload["captureProfile"])

    output_errors = validate("assess-result", result)
    if output_errors:
        bug_errors = [f"assess-result invalido (bug del servicio): {e}" for e in output_errors]
        return JSONResponse(status_code=500, content={"errors": bug_errors})
    return result


@app.post("/v1/read")
def read(payload: dict[str, Any], debug: int = Query(default=0)) -> Any:
    errors = validate("read-request", payload)
    if errors:
        return JSONResponse(status_code=422, content={"errors": errors})

    try:
        if debug:
            result, debug_pages = read_scan_debug(payload)
        else:
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
    if debug:
        return {"result": result, "debug": {"pages": debug_pages}}
    return result
