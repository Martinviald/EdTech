# Arnés de evaluación offline de la lectura por visión (v2)

`answer-reading:eval` mide un **conjunto de rutas de lectura** (lectores + prompts + política de
consenso por formato) sobre un dataset etiquetado, con **el mismo código que producción**:
`resolveReadingRoute` elige la ruta de cada muestra por su formato, `renderTranscriptionPrompt` y
`transcriptionJsonSchema` arman el pedido, `LlmVisionTranscriber` llama al modelo, y la
normalización, `evaluateConsensus` (con desempate si la política lo usa) y la corrección con la
estrategia del ítem (`scoreReadingValue`, el formato derivado incluido) deciden. Es obligatorio
antes de integrar cualquier cambio que afecte la lectura (plan de la etapa 1, §2).

## Compuerta de T0 (reproducir la línea base y el pipeline B)

Desde `apps/api`, con el caché importado (sin gasto):

```bash
P="../../../pruebas-vlm-manuscrito"   # desde un worktree bajo EdTech/
pnpm answer-reading:eval --dataset "$P/datasets/fotos-reales-v1" \
  --routes scripts/answer-reading-eval/routes/actual.json \
  --repetitions 3 --budget-usd 0.40 --out "$P/resultados/t0-actual"

pnpm answer-reading:eval --dataset "$P/datasets/fotos-reales-v1" \
  --routes scripts/answer-reading-eval/routes/pipeline-b.json \
  --reader-min-confidence "gemini-3.5-flash=0.97,gpt-6-luna=0.85" \
  --repetitions 3 --budget-usd 0.40 --out "$P/resultados/t0-pipeline-b" \
  --compare "$P/resultados/t0-actual/informe.json"
```

Resultado (2026-10-12, 162 + 162 lecturas desde el caché, gasto US$0):

| Configuración                                 | Autoaceptadas [IC 95 %]    | Equivocadas | US$/recorte corto |
| --------------------------------------------- | -------------------------- | ----------- | ----------------- |
| `actual.json` (Haiku 5.5 + Flash-Lite 0,85)   | 15/72 = 20,8 % [13,1–31,6] | 0           | 0,00132           |
| `pipeline-b.json` (Flash ≥ 0,97, luna ≥ 0,85) | 32/72 = 44,4 % [33,5–55,9] | 0           | 0,00332           |

Ambas cifras coinciden exactamente con `experimento-lectores` (15/72) y la medición 2 de
`experimento-pipeline` (32/72), igual que los motivos de revisión y la exactitud por lector.
McNemar pareado de la autoaceptación: 20 casillas×repetición pasan a autoaceptadas y 3 dejan de
serlo (p < 0,001, optimista porque las repeticiones no son independientes).

## Opciones

| Opción                        | Qué hace                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dataset <dir>`             | Carpeta con `manifest.json` y las imágenes (obligatoria).                                                                                                                                                                                                                               |
| `--routes <archivo.json>`     | `{ "description": "…", "routes": [ReadingRoute…] }` como `reading_routes` (se respeta `status`), o una sola `ReadingRoute` (se trata como activa). Por defecto `routes/actual.json`. `--route` es un alias.                                                                             |
| `--reader-min-confidence <m>` | Umbral por clave de lector (`"gemini-3.5-flash=0.97,gpt-6-luna=0.85"`). **Simulación provisional hasta T1**: ver abajo.                                                                                                                                                                 |
| `--repetitions <n>`           | Repeticiones por muestra (índices 0…n−1, parte de la clave del caché).                                                                                                                                                                                                                  |
| `--budget-usd <x>`            | Tope de gasto. Obligatorio si falta alguna lectura en el caché. Antes de correr se estima el peor caso de lo que falta (3.000 tokens de entrada + `maxOutputTokens`) y, si supera el tope, no se llama a nada. Durante la corrida, cada llamada reserva su costo y no se pasa del tope. |
| `--concurrency <n>`           | Muestras en paralelo (los lectores de una muestra siempre van en paralelo).                                                                                                                                                                                                             |
| `--cache-dir <dir>`           | Caché de lecturas. Por defecto `../pruebas-vlm-manuscrito/cache-lecturas` relativo a la raíz del repo (fuera del repo).                                                                                                                                                                 |
| `--no-cache` / `--refresh`    | `--no-cache` ni lee ni escribe; `--refresh` vuelve a pedir todo y reescribe.                                                                                                                                                                                                            |
| `--out <dir>`                 | Carpeta de salida (`informe.json`, `informe.md`, `comparacion.json`). Los resultados con datos reales van **fuera del repo**.                                                                                                                                                           |
| `--dry-run`                   | Transcriptor falso que devuelve la etiqueta; no usa el caché ni llama a ninguna API.                                                                                                                                                                                                    |
| `--compare <informe.json>`    | Comparación **pareada** contra un informe v2 anterior (mismas muestras y repeticiones).                                                                                                                                                                                                 |

Las claves de API salen del `.env` de la raíz. Las tarifas están en `tariffs.ts`: Haiku 5.5,
Flash-Lite y luna de `llm_models` (migraciones 0044 y 0046); `gemini-3.5-flash` a US$1,50 /
US$9,00 por millón, de agregadores de precios (sep. 2026, anotado en
`experimento-lectores/analisis.md`; no hay página oficial). El arnés no lee ni escribe la base de
datos.

## Rutas por formato

Cada muestra arma un `ReadingContext` (org de evaluación, ítem, instrumento y formato) y la ruta sale
de `resolveReadingRoute`, igual que en producción: la de formato gana a la por defecto.

- `routes/actual.json`: las 8 rutas globales activas de esta rama (0048, 0049 y 0050), copiadas de
  las migraciones (un script verificó que lectores y política son idénticos al SQL). Haiku 5.5 +
  Flash-Lite con `hints: format` en `sequence`, `ordered_tuple`, `word_list`, `short_text` y
  `multi_box`; desarrollo (`free_text`, `math_work`) con Haiku y `transcribe.free-text@1`.
- `routes/pipeline-b.json`: los mismos formatos, prompts, hints y políticas, con
  `gemini-3.5-flash` + `gpt-6-luna` (`reasoning: low`) en respuesta corta y texto, y
  `gemini-3.5-flash` en desarrollo.
- `routes/default.json`: la ruta por defecto sola (fixtures sintéticos).

**Umbral por lector (provisional hasta T1).** El esquema de rutas todavía no admite
`minConfidence` por lector. Con `--reader-min-confidence`, la política se evalúa con
`minConfidence` 0 y, si alguna lectura principal queda bajo el umbral de su lector (o bajo el
`minConfidence` de la ruta si ese lector no tiene umbral), la casilla pasa a revisión de lectura con
`low_confidence`. Es lo mismo que hizo `experimento-pipeline` (medición 2): el paso de confianza de
`evaluateConsensus` solo puede mandar a revisión, nunca autoaceptar. Cuando T1 agregue el umbral al
contrato, este override se reemplaza por la ruta.

## Caché de lecturas

Una lectura se guarda en `<cache-dir>/<2 primeros>/<clave>.json`. La clave es el sha256 del JSON
canónico de: proveedor, modelo, **todos** los parámetros del lector, `system` y `user` renderizados,
`outputSchemaId`, el JSON Schema de salida y su `propertyOrder`, el sha256 de la imagen y el índice
de repetición. La etiqueta del lector (`key`) y su familia no entran: no cambian lo que se le pide
al modelo. Solo se guardan lecturas `ok`; una falla se vuelve a pedir.

Para importar lecturas ya pagadas:

```bash
pnpm exec tsx scripts/answer-reading-eval/importar-lecturas.ts \
  --dataset "$P/datasets/fotos-reales-v1" --cache-dir "$P/cache-lecturas" \
  --lecturas "$P/hojas-sinteticas/experimento-lectores/lecturas.json" \
  --lecturas "$P/hojas-sinteticas/experimento-pipeline/lecturas.json" \
  --routes scripts/answer-reading-eval/routes/actual.json \
  --routes scripts/answer-reading-eval/routes/pipeline-b.json [--dry-run]
```

Una lectura se importa solo si su imagen de origen tiene el mismo sha256 que una muestra del
dataset, el formato coincide, el lector guardado es una `ReaderSpec` válida cuyo `promptRef` atiende
el formato, y la salida valida contra el esquema del formato. La clave se calcula renderizando el
prompt con **ese** lector guardado, el formato y el curso de la muestra; las lecturas solo se usan
si esa clave es exactamente la que pide una ruta. Resultado: las 720 de `experimento-lectores`
entraron (su normalización guardada es idéntica a la actual) y cubren las 162 lecturas de cada
conjunto de rutas; de `experimento-pipeline` no entró ninguna (número tapado: otra imagen; por
casilla: otra imagen y otro formato; árbitro: no es una transcripción). Los prompts y formatos no
cambiaron entre esos experimentos y esta rama (`git log` de `packages/answer-reading/src/prompts`,
`formats` y los contratos: último cambio en `7af320bd`, antes de las corridas).

## Formato del dataset

`manifestVersion` 1 (el de los fixtures) sigue valiendo. La versión 2 agrega campos opcionales:

```json
{
  "manifestVersion": 2,
  "name": "fotos-reales-v1",
  "datasetVersion": "1",
  "samples": [
    {
      "id": "celeste-p05",
      "image": "celeste-p05.jpg",
      "format": { "kind": "sequence", "length": 3 },
      "label": {
        "state": "answered",
        "literal": "8, 11, 12",
        "canonical": "s:8|11|12",
        "parts": { "e1": "8", "e2": "11", "e3": "12" }
      },
      "item": {
        "id": "51e70000-0000-0000-0000-000000001005",
        "type": "short_answer",
        "content": { "prompt": "…", "comparison": "sequence", "acceptedAnswers": ["8, 10, 12"] },
        "scoringConfig": { "points": 1 }
      },
      "gradeName": "6° Básico",
      "student": "Celeste",
      "question": 5,
      "context": { "instrumentId": "51e70000-0000-0000-0000-000000000001" },
      "tags": { "handwriting": "adult" }
    }
  ]
}
```

- `label.literal` + `label.parts` es lo que el alumno escribió; se normaliza con el registro de
  formatos de producción y, si hay `label.canonical`, debe coincidir (si no, el dataset no carga).
- `item` es el ítem real (tipo, contenido con la clave, `scoringConfig`): se corrige con
  `scoreReadingValue`, que deriva el formato de corrección del contenido. Sin `item`, valen
  `acceptedAnswers`/`scoringConfig` de la v1 (ítem `short_answer`) o, sin clave, la etiqueta como
  clave implícita.
- En desarrollo (`free_text`, `math_work`) la verdad es el texto escrito y se mide fidelidad.

`pruebas-vlm-manuscrito/datasets/fotos-reales-v1/` (fuera del repo): los 30 recortes de
`resultado-fotos-v2/` (24 cortos + 6 de desarrollo, 3 hojas de letra adulta), la verdad por casilla
de `experimento-lectores` y los 10 ítems y el curso de `soe_vision`.

## Métricas (`informe.json` e `informe.md`)

Todas las proporciones llevan intervalo de Wilson al 95 %.

- **Por lector** (respuesta corta): lectura exacta (canónica igual a la de la verdad, misma
  normalización), exacta por formato, estabilidad entre repeticiones, calibración (confianza media
  acertando y fallando; exactas entre las lecturas con confianza ≥ 0,85 y ≥ 0,97), `reviewRequested`
  acertando y fallando, costo y latencia. En desarrollo: similitud de texto media, mínima y por
  recorte (1 − Levenshtein / largo, sin tildes ni mayúsculas, `×`→`x`, `⇒`→`=>`).
- **Por configuración** (respuesta corta): autoaceptadas, autoaceptadas equivocadas separadas en
  **perjudican al alumno** (menos puntaje del que corresponde, por ejemplo una correcta corregida
  como incorrecta), **lo favorecen** y sin efecto en el puntaje, con la suma de puntos de cada grupo;
  revisión por motivo; revisiones forzadas por el umbral de lector; desglose por formato.
- **Costo y latencia**: costo nominal por recorte (lo que costó cada lectura, también las del
  caché), gasto real de la corrida, lecturas desde el caché, latencia por lectura y por recorte.
- **`--compare`**: tabla pareada por casilla × repetición (ambas, ninguna, solo antes, solo ahora)
  de autoaceptadas, equivocadas, perjudican, favorecen y decisión correcta, con McNemar exacto
  bilateral, y la lista de unidades que cambiaron.

La auditoría muestral se apaga (`auditSampleRate` 0): se mide todo lo que se autoaceptaría.

## Fixtures sintéticos

`fixtures/` tiene casillas dibujadas por código (sin datos personales). Para regenerarlas:

```bash
pnpm --filter @soe/api exec tsx scripts/answer-reading-eval/generar-fixtures.ts
```

## Tests

```bash
cd apps/api && pnpm exec jest scripts/answer-reading-eval
```

Sin APIs reales: selección de ruta por formato, caché (acierto, fallo y qué cambia la clave),
métricas asimétricas, Wilson y McNemar con casos conocidos, umbral por lector, tope de gasto y
compatibilidad con el manifiesto v1.
