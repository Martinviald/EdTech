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

## Convención del rectángulo fiducial (CD-5, compartida con el impresor, A1)

1. El rectángulo fiducial es el rectángulo cuyas esquinas son los **CENTROS**
   de los 4 cuadrados fiduciales. Todas las coordenadas del `LayoutSpec` son
   fracciones 0–1 de ese rectángulo: `x` sobre su ancho, `y` sobre su alto.
2. `fiducials.sizeRatio` (lado del cuadrado) y `fiducials.marginRatio`
   (distancia del borde de página al borde EXTERIOR del cuadrado) son
   fracciones del **ancho de página**, iguales en ambos ejes.
3. Todo `radius` de burbuja es fracción del **ancho del rectángulo fiducial**.
4. El rectificador mapea los **centroides detectados** de los cuadrados a las
   esquinas del espacio de trabajo.

Ver `docs/e22-lector-contracts.md` (CD-5), `app/geometry.py` y el generador
espejo `tests/synthetic.py`. Implementación gemela del impresor:
`apps/api/src/sheet-scanning/sheet-print.helpers.ts` (`computeDrawPlan`).

## Principio rector del clasificador

**Ante la duda, el clasificador duda o rechaza — nunca decide mal con
confianza** (criterio MVP: cero marcas incorrectas decididas con confianza
alta). Los umbrales están sesgados hacia mandar a revisión: `ambiguous` y
`multiple` van a la cola con evidencia (`cropJpegBase64`); una página sin dos
grupos de fills separables se rechaza entera (`no_separable_marks`), jamás se
lee como "todo en blanco".

Excepción documentada: una hoja con **todas** las burbujas marcadas tampoco
tiene dos grupos, pero se distingue del caso en blanco porque el fill es
relativo al fondo local (un clúster único con todos los fills altos es tinta
real). Re-escanear no la arregla, así que no se rechaza: cada campo `single`
sale `multiple` y va a la cola.

## Catálogo de suciedad real cubierto (`tests/test_dirty_catalog.py`)

Derivado de ~2.700 escaneos reales de GradeCam. Cada caso tiene un test que
declara el comportamiento correcto:

| Caso | Comportamiento |
|---|---|
| Doble burbuja con llenados desiguales (100% + 40%) | `multiple`/`ambiguous`, jamás `marked` confiado |
| Marca borrada a medias (~30%) + remarcada | `ambiguous`; con borrado limpio (~8%) → `marked` de la nueva |
| Lápiz muy claro en toda la hoja | lo absorbe el corte relativo al fondo local |
| Cruz/tick en vez de relleno | `marked` consistente o `ambiguous`, nunca `blank` confiado |
| Relleno desbordado fuera del círculo | `marked`, sin contaminar vecinos |
| Mancha sobre burbuja NO marcada | `blank`/`ambiguous`, jamás `marked` confiado |
| Hoja arrugada (deformación sinusoidal leve) | se lee correcta |
| Banda de sombra dura lateral | se lee correcta (fondo local por anillo) |
| Página con solo 1–2 marcas | se lee, la separabilidad no inventa umbral |
| Todas las burbujas marcadas | `multiple` por campo, página NO rechazada |
| Hoja rotada 90°/180°/270° | reorientación probada por QR (`tests/test_orientation.py`) |

Orientación: si la primera pasada no decodifica el QR desde su región, se
prueban las 4 rotaciones y se acepta **solo** la que lo decodifica (los
fiduciales solos no distinguen orientaciones). Sin prueba se conserva la
primera pasada, que termina rechazada — nunca leída con una correspondencia
equivocada.

## Modo debug (O4)

`POST /v1/read?debug=1` responde `{ result, debug: { pages: [...] } }`: el
`result` es el ScanResult del contrato sin cambios; `debug` agrega por página
histograma de fills (10 bins), `threshold`/`gap`/`stdLow`/`stdHigh`,
`separable`/`allMarked`, conteo por estado, `sharpness`/`glare` crudos,
`orientationDegrees`, ms por etapa y `registration` (resumen del registro local
de burbujas: desplazamiento mediano/p90/máximo respecto del spec, score p10,
cuántas burbujas cayeron al spec y cuántas heredaron el ajuste del grupo). Sin
`?debug=1` la respuesta es el ScanResult puro. El harness del conjunto de oro
(F4) puede importar `app.pipeline.classify_page_debug` / `read_scan_debug`
directamente.

## Registro local de burbujas

La homografía de los 4 fiduciales deja cada burbuja a varios píxeles de donde el
spec la pone (6–8 px típicos en fotos de teléfono, 15 en la peor medida; el anillo
tiene 17.6 px de radio y el disco de muestreo 14). `app/registration.py` localiza
el anillo impreso de cada burbuja en una ventana acotada alrededor del spec antes
de medir el fill, con consistencia lineal por grupo y fallback a la posición del
spec. La firma de grilla y la identidad RUT siguen muestreando en el spec (la
firma es la prueba de la homografía; no debe ayudarse). Método, compuertas y
bitácora de validación en `goldset/README-registro.md`; medición con
`python -m tools.measure_registration goldset/real`.

## Conjunto de oro (O4)

El criterio de aceptación del MVP (≥ 99% correctas, ≤ 3% a revisión y **0 incorrectas
decididas con confianza** — la cifra dominante) se mide contra 300 hojas físicas reales
transcritas a mano por dos personas. El harness completo vive en `goldset/`
(formato de datos, veredicto y detalle en `goldset/README.md`):

```bash
python -m goldset.transcribe goldset/data/<corte>/<hoja>            # transcripción ×2 personas
python -m goldset.transcribe goldset/data/<corte>/<hoja> --by persona2
python -m goldset.validate goldset/data                             # doble verificación + estructura
python -m goldset.run goldset/data                                  # in-process, sin servicio
python -m goldset.run goldset/data --service-url http://localhost:8090
```

Flujo: imprimir → rendir → digitalizar (`goldset/data/<corte>/<hoja-id>/`) → transcribir
(dos personas) → `validate` (lista discrepancias entre transcripciones) → `run` → leer
`goldset/reports/report-<fecha>.md` (veredicto APRUEBA/NO APRUEBA arriba de todo, más el
top de incorrectas-confiadas y la distribución de margins para calibrar
`AMBIGUITY_MARGIN`). `goldset/data/` y `goldset/reports/` están gitignoreados; el único
dato comiteado es `goldset/example/` (una hoja sintética con la que `pytest goldset/`
prueba el harness de punta a punta).

## Variables de entorno

| Var | Default | Qué controla |
|---|---|---|
| `OMR_PAGE_TIMEOUT_S` | `20` | Tiempo límite por página; una página que lo excede se omite del resultado (si TODAS lo exceden → 504) |
| `OMR_DOWNLOAD_TIMEOUT_S` | `10` | Timeout de descarga de cada URL firmada |
| `OMR_LOCAL_REGISTRATION` | `1` | Registro local de burbujas antes de muestrear (`app/registration.py`). `0` = apagado de emergencia (vuelve al muestreo en la posición del spec) mientras dure la observación en producción; después se retira |

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
| `POST /v1/read?debug=1` | Igual, pero responde `{ result, debug }` con métricas de diagnóstico por página (ver "Modo debug") |

## Leer una hoja sin pasar por la UI

```bash
python -m tools.read_sheet hoja.pdf --spec layout.json
python -m tools.read_sheet foto.jpg --spec-from-db <layoutId|tiradaId> --profile phone
python -m tools.read_sheet hoja.pdf --spec layout.json --marks   # detalle marca por marca
python -m tools.read_sheet hoja.pdf --spec layout.json --json    # ScanResult crudo
```

Corre el pipeline **en proceso**: no necesita el servicio levantado, ni el backend, ni
S3, ni crear un lote. Existe para cortar el ciclo de iteracion — imprimir, rendir,
escanear, subir por la UI, crear el lote y esperar — cuando lo unico que se quiere saber
es por que una hoja se rechazo.

Por pagina informa cuantos fiduciales se detectaron y el motivo del rechazo, si el QR
decodifico, y con `--marks` el relleno, umbral y margen de cada marca: los tres numeros
que explican por que una quedo dudosa.
