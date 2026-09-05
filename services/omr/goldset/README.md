# Conjunto de oro (O4) — harness de medición

El MVP se acepta o rechaza contra **300 hojas físicas reales**, cada una transcrita a mano
por **dos personas** (doble verificación). Este directorio contiene el harness completo:
cuando existan las hojas, medir es apretar un botón. Criterio en
`docs/diseno-lector-de-marcas/06-plan-mvp-v1.md`.

## Las tres cifras del criterio

| Métrica | Umbral |
|---|---|
| Marcas leídas correctamente | ≥ 99,0 % (meta) |
| Marcas enviadas a revisión | ≤ 3 % |
| **Marcas incorrectas decididas con confianza alta** | **0 (dominante)** |

**La tercera domina**: un 97% de correctas con 0 confiadas-incorrectas APRUEBA; un 99,5%
con 3 confiadas NO — significa que el clasificador no sabe cuándo no sabe. El veredicto
del reporte implementa exactamente eso:

```
APRUEBA ⟺ incorrectas-confiadas == 0  Y  revisión ≤ 3%  Y  páginas-sin-leer == 0
```

(Con esas tres condiciones, correctas ≥ 97% queda garantizado por aritmética; la meta
del 99% se reporta aparte.)

## Composición (la hace el equipo humano, en papel real)

| Corte (directorio) | Hojas | CaptureProfile |
|---|---|---|
| `scanner-adf` | 100 · escáner con ADF, hojas planas | `scanner` |
| `phone-good` | 100 · foto de celular, condiciones buenas | `phone` |
| `phone-bad` | 50 · celular malo (sombra, ángulo, arruga) | `phone` |
| `dirty` | 50 · casos sucios deliberados (doble marca, borrada, en blanco) | `phone` |
| `real-phone` / `real-scanner` | fotos y escaneos de hojas impresas con **verdad por construcción** (`goldset/real/`, ver su README) | `phone` / `scanner` |

`truth.json` puede declarar `truthSource`: `double-transcription` (default, 2 personas),
`construction` (1 transcripción: quien rellenó dejó la clave antes de capturar) o
`adjudication` (1 transcripción provisional desde la cola de revisión). Los cortes `real-*`
son el juez del registro de burbujas; método y bitácora en `README-registro.md`.

## Estructura de directorios

```
goldset/data/                         ← gitignoreado (papel real, datos de alumnos)
  <corte>/                            ← scanner-adf | phone-good | phone-bad | dirty
    layout-spec.json                  ← el LayoutSpec CONGELADO usado por la tirada
    <hoja-id>/
      page-0.jpg|png                  ← una imagen por página lógica, en orden…
      page-1.jpg|png
      …o bien un único <algo>.pdf     ← PDF multipágina (escáner ADF)
      truth.json                      ← la verdad transcrita (2 personas)
goldset/example/                      ← SÍ comiteado: 1 hoja sintética (make_example)
goldset/reports/                      ← gitignoreado: report-<fecha>.md|json
```

Convenciones:

- **`page-N` = página lógica N** del LayoutSpec (y la página N del PDF también). El QR
  sigue mandando dentro del pipeline (CD-7); esta convención sólo se usa para saber qué
  campos esperar cuando una página se rechaza o no aparece.
- El `layout-spec.json` del corte es el spec congelado de la tirada impresa (bajarlo de
  `GET /sheet-layouts/:id`, campo `spec`). Si una hoja usara otro spec, `truth.json`
  puede apuntar a otro archivo vía `layoutSpecFile`.

## `truth.json`

```json
{
  "sheetId": "uuid-de-printed-sheet-o-identificador",
  "layoutSpecFile": "../layout-spec.json",
  "transcriptions": [
    { "by": "persona1", "answers": { "1": "A", "2": "V", "3": null } },
    { "by": "persona2", "answers": { "1": "A", "2": "V", "3": null } }
  ],
  "notes": "opcional"
}
```

- `answers` está indexado por **printedNumber** (los mismos del spec, exactamente).
- Valor: la letra marcada (`"A"`, `"V"`, …), varias letras concatenadas si el campo es
  `selectMode: multiple`, o `null` = en blanco.
- **Exactamente 2 transcripciones** de personas distintas, y deben COINCIDIR: la
  discrepancia es el mecanismo de doble verificación — `validate` la lista por pregunta
  y se resuelve mirando el papel.

## Flujo completo

```bash
cd services/omr && source .venv/bin/activate    # o usar .venv/bin/python directo

# 1. Transcribir cada hoja (dos personas; la segunda puede correr aparte con --by)
python -m goldset.transcribe goldset/data/scanner-adf/hoja-001
python -m goldset.transcribe goldset/data/scanner-adf/hoja-001 --by persona2

# 2. Validar el conjunto entero (estructura + doble transcripción + cobertura del spec)
python -m goldset.validate goldset/data

# 3. Medir (in-process por defecto: sin red, sin servicio corriendo)
python -m goldset.run goldset/data

# 3b. …o contra el servicio HTTP real (sirve los archivos locales solo)
python -m goldset.run goldset/data --service-url http://localhost:8090

# 4. Leer goldset/reports/report-<fecha>.md (veredicto arriba de todo)
```

Códigos de salida de `run`: `0` = APRUEBA, `1` = NO APRUEBA, `2` = error del harness.

## El reporte

`report-<fecha>.md` trae, en orden: las tres cifras con veredicto, desglose por corte,
marcas a revisión por `rejectReason`, top-20 de incorrectas-confiadas con su evidencia
(hoja, pregunta, esperado, leído, `fill`, `threshold`, `margin`) y la distribución de
`margin` de las incorrectas — la palanca para calibrar `AMBIGUITY_MARGIN`
(`app/classify.py`): subirlo elimina incorrectas de margin bajo a costa de más revisión.
`report-<fecha>.json` trae los datos crudos por marca para análisis posterior.

Clasificación por marca: `correct_firm` (marked/blank que coincide) · `review`
(`multiple`/`ambiguous`, o TODA marca de una página `quality.ok=false`) ·
`confident_wrong` (marked/blank firme que NO coincide — la cifra que importa) ·
`unread` (la página no apareció en el resultado, CD-6).

## Barrido sintético (iteración rápida, NO validación)

Mientras el papel no exista —y también después, como red de regresiones— hay un generador que
produce N hojas con marcas conocidas bajo 22 combinaciones de degradación calibradas contra
capturas reales, y las corre por este mismo harness:

```bash
python -m goldset.make_synthetic --run     # generar + medir + veredicto, ~16s
```

Ver **[`README-barrido.md`](README-barrido.md)** para las recetas, el solape de distribuciones
sintético-vs-papel y el veredicto actual. **Un `APRUEBA` ahí significa "sin regresiones conocidas",
no "MVP validado"**: la validación sigue siendo O4, las 300 hojas físicas.

## Ejemplo sintético comiteado

`goldset/example/` tiene UNA hoja generada con `tests/synthetic.py`
(regenerable con `python -m goldset.make_example`). `pytest goldset/` corre
validate + run sobre ella y exige 100% correctas / 0 confiadas / APRUEBA: prueba que el
harness funciona antes de tener papel real.
