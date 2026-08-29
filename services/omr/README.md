# omr-service — Servicio de visión del lector de marcas (E22)

Convierte imágenes de hojas de respuesta en un `ScanResult`. **Sin estado, sin
base de datos, sin conocimiento de tenants**: una función pura sobre
`(imagen, LayoutSpec)`. Diseño en `docs/diseno-lector-de-marcas/` (C18–C21);
contrato HTTP en `docs/e22-lector-contracts.md`.

## Contratos

`contracts/*.schema.json` son **generados** desde los Zod de `@soe/types`:

```bash
pnpm --filter @soe/types gen:omr-contracts
```

Nunca editarlos a mano. Los ejemplos de `contracts/examples/` se validan en
ambos lados (pytest acá, jest en `packages/types`).

## Pipeline (F1)

```
PageSource (sources.py) → Rectifier (rectify.py) → QualityGate (quality.py)
                        → FieldReader/MarkClassifier (readers.py / classify.py)
                        → QR (identity.py) → ScanResult (pipeline.py)
```

| Módulo | Componente |
|---|---|
| `app/geometry.py` | Convención del rectángulo fiducial y espacio de trabajo |
| `app/sources.py` | C18 · `PdfPageSource` (pypdfium2, ~200 DPI) / `ImagePageSource` (EXIF) |
| `app/rectify.py` | C19 · detección de fiduciales + homografía (corre SIEMPRE, D2) |
| `app/quality.py` | C20 · sharpness/glare/cropped/fiducials, umbrales del `CaptureProfile` |
| `app/classify.py` | C21 · fill, umbral Otsu relativo por hoja, separabilidad, `AMBIGUITY_MARGIN` |
| `app/readers.py` | D10 · registro `READERS` por tipo de campo (MVP: `bubble_group`) |
| `app/identity.py` | T6 · lectura de QR (el payload NO se interpreta acá) |
| `app/pipeline.py` | T7 · ensamblado, sha256 canónico, thumbs, timeout por página |

## Convención del rectángulo fiducial (compartida con el impresor, A1)

1. El rectángulo fiducial es el rectángulo cuyas esquinas son las **esquinas
   EXTERIORES** de los 4 cuadrados (la esquina de cada cuadrado más cercana a
   su esquina de página). Todas las coordenadas del `LayoutSpec` son fracciones
   0–1 de ese rectángulo: `x` sobre su ancho, `y` sobre su alto.
2. `marginRatio` = distancia de cada borde de página al rectángulo, como
   fracción del **ancho de página** (igual en los 4 lados); los cuadrados se
   dibujan hacia adentro del rectángulo.
3. `sizeRatio` y todo `radius` son fracciones del **ancho del rectángulo
   fiducial**.

Ver `app/geometry.py` y el generador espejo `tests/synthetic.py`.

## Variables de entorno

| Var | Default | Qué controla |
|---|---|---|
| `OMR_PAGE_TIMEOUT_S` | `20` | Tiempo límite por página; una página que lo excede se omite del resultado (si TODAS lo exceden → 504) |
| `OMR_DOWNLOAD_TIMEOUT_S` | `10` | Timeout de descarga de cada URL firmada |

## Desarrollo local

```bash
cd services/omr
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --port 8090
```

## Docker

```bash
docker build -t omr-service .
docker run --rm -p 8090:8090 omr-service
```

## Endpoints

| Ruta | Qué hace |
|---|---|
| `GET /health` | Liveness |
| `POST /v1/read` | `(LayoutSpec, CaptureProfile, source)` → `ScanResult`. 422 request inválido; 502 imagen no descargable; 504 tiempo límite por página |
