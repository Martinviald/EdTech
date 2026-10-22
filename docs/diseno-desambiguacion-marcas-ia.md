# Desambiguación de marcas de burbuja con IA

> Estado: diseño CERRADO (2026-10-22), en implementación. Decisiones de cierre en §12.
> Entrega: una sola PR a `dev` con los PR 1–6 de §11 como fases (commits) de la misma rama.
> Fecha original: 2026-10-21. Base: `origin/dev` @ `25f92b71` (incluye PR #312).
> Alcance: marcas `multiple` y `ambiguous` de campos `bubble_group` que el motor OMR no logra decidir.
> Convención: todo nombre de archivo, clase, método o columna sin marca existe hoy en `origin/dev`. Lo marcado **(nuevo)** es propuesta.

## 1. Contexto y objetivo

Hoy cada marca que el OMR deja dudosa (`sheet_scan_marks.state IN ('multiple','ambiguous')`) llega a la cola de revisión humana (`ScanReviewService.getQueue` → `ambiguousMarks`). La única resolución automática es la anulación de dobles marcas evidentes (`SheetScanService.autoAnnulment`, con `nullConfidence >= organizations.config.review.autoAnnulMinConfidence`).

**Objetivo:** quitarle al profesor la mayor carga posible. Un número ínfimo de errores es tolerable, porque el alumno reclama si se le corrigió mal. Para eso necesitas dos cosas: que la IA resuelva sola casi todo lo que hoy revisa el profesor, y una vía barata para corregir lo que la IA resolvió.

### 1.1 Evidencia de la PoC (`analisis-omr-marcas/poc-decisions-2026-10-21/`)

- **Muestra:** 100 recortes reales de 250×68 px (fila de 4 burbujas A–D) con respuesta conocida. 35 son marcas dudosas del OMR. Verdad: 37 `blank`, 61 opciones, 2 `null`.
- **Jev 1.14** (recorte ampliado a 300 px de alto): 100/100. Confianza de las correctas: mínimo 0,56, p10 0,86. Con umbral 0,8 resuelve 96/100 sin errores. Latencia p50 260 ms, p95 433 ms. Unos 1.530 tokens de entrada.
- **OpenAI `gpt-6-luna`** (recorte original): 97/100. Falló dos veces la doble marca B+C (dijo B, con 0,40 y 0,46) y un blanco (dijo B, con 0,10). Todos sus errores tienen confianza < 0,5. p10 de las correctas: 0,59 (subconfiado). Unos 382 tokens de entrada.
- **Dato que condiciona el diseño:** OpenAI con el recorte **ampliado** (`results/openai-x.jsonl`) empeora. Comete 6 errores y uno tiene confianza 0,68. El reescalado sirve para Jev y perjudica a OpenAI, así que no puede vivir en el consumidor (ver §4.2).
- **Simulación de la regla de §5** sobre los resultados guardados, con los umbrales iniciales de §7:
  - en las 35 dudosas: 33 automáticas, 0 errores, 2 a revisión;
  - en las 100: 93 automáticas, 0 errores.
- **Costo:** unos US$0,00004 por recorte en OpenAI y US$0,00006 en Jev.

### 1.2 Límites de la evidencia

- Solo hay 2 nulas, de la misma hoja. No hay borrones, tachas ni marcas en X.
- 0 errores en 35 dudosas no descarta una tasa de error real de hasta ~8 % (cota superior al 95 %, regla de tres: 3/35).
- La muestra es de pocas hojas y capturas. No representa escáner contra celular, ni lápices distintos, ni campos de 5 o más opciones.
- El texto de las preguntas cambia un poco al pasar al código de producción (§4.4). Hay que repetir la PoC con el builder real antes de la sombra.

## 2. Decisiones ya tomadas (no se reabren)

1. Las marcas no resueltas pasan por **ambos** motores, en paralelo.
2. Cada motor tiene sus propios umbrales. Coinciden y ambos superan su umbral de acuerdo → se acepta. Difieren, uno supera su umbral alto y el otro está bajo su umbral bajo → se acepta la del que sabe. Todo lo demás → revisión humana.
3. Se acepta un número ínfimo de errores, con vía de corrección posterior barata.
4. Se parte en `shadow` para calibrar y luego se pasa a `live`.
5. Enviar estos recortes a los proveedores no bloquea el avance: el recorte no lleva identidad del alumno (§10). El DPA y la retención de cada proveedor se revisan después.

## 3. Arquitectura

### 3.1 ¿Ruta nueva dentro de `answer-reading` o servicio hermano? → Servicio hermano

`answer-reading` resuelve otro problema y no conviene meter las burbujas ahí:

- **El resultado llega por otro camino.** La respuesta de burbuja la consume `ScanReviewService.confirmBatch` → `toParserResult` (`scan-result.adapter.ts`), que lee `sheet_scan_marks.reviewed_value`/`review_decision` cuando `reviewed_at` no es nulo. Las lecturas por visión van por otro lado: `confirmBatch` trata como `pendingReading`/`prescored` solo los `printedNumber` de campos `crop_region` (`cropItemsByPrintedNumber`) y los consolida `AnswerReadingConsolidationService`. Volver las burbujas un formato de lectura cambiaría cómo se confirma **cada** ítem de alternativas.
- **`answer_reading_decisions` no calza.** Exige `item_id NOT NULL`, guarda un `value` de tipo `NormalizedAnswer`, `scoring_outcome`, `policy_id`/`policy_version` y `used_reading_ids`, que apuntan a `answer_readings` producidas por `VisionTranscriber` (LLM de texto, no `@soe/decisions`). Una marca de burbuja no tiene nada de eso.
- **Las rutas se seleccionan por formato.** `ReadingRoutesService` y `visionResponsesByField` eligen por `ResponseFormatKind` (`VISION_READING_FORMAT_KINDS`), y solo para `crop_region`. Los campos `bubble_group` no tienen `response`.
- **`ConsensusPolicy` tiene otra regla.** Es acuerdo canónico entre familias distintas con un solo `minConfidence`. La regla de §2 necesita tres umbrales por motor y el caso "uno sabe, el otro no".
- **`AnswerReadingBudgetService` mide otro gasto.** Suma costos de `answer_readings` y `ai_grading_jobs` y usa `ResolvedOrgAnswerReadingSettings`. No ve `decision_calls`.

**Qué sí se reutiliza**, sin duplicarlo:

| Pieza | Uso |
|---|---|
| `DecisionsService` (`evaluate`, `shadow`), `DecisionsConfigService`, `decision_settings`, `decision_calls`, `DecisionCallsRecorder` | Modo por funcionalidad, modelo fijado, umbrales, registro de cada llamada con hash de estado e imágenes, tokens y costo |
| `ConcurrencyLimiter` (`common/concurrency`) | Paralelismo por lote |
| Job `sheet_scan` de `SheetScanService.runJob` (vía `JOB_DISPATCHER`) | La etapa corre dentro del mismo job |
| `ScanReviewService` (`getQueue`, lista `autoAnnulled` con `selectPendingMarks(..., 'auto')`, `resolveMark`, `recountReviewPending`) | Cola, lista de auto-resueltas y corrección. Sin pantallas nuevas |
| Conteo de `reviewPending` en `SheetScanService.finalizeBatch` y `recountReviewPending` | Sin cambios: ya excluyen `reviewed_at IS NOT NULL` |
| `SheetScanMetricsService` | Se extiende con métricas de IA |
| Patrón de `remedial/judge-decision.ts` y `scripts/decisions/` | Builder de dominio compartido con la calibración |

### 3.2 Punto de enganche: etapa síncrona dentro del job, antes de `finalizeBatch`

Flujo actual de `SheetScanService.runJob`: `processSources` → (por página) `persistPage` → `finalizeBatch` (lote pasa a `needs_review` y calcula `reviewPending`).

**Propuesta (nuevo):**

```
runJob
  processSources                 (sin cambios)
  markProcessingAlive
  markDisambiguation.resolveBatch(orgId, batchId, candidates)   ← nuevo, nunca lanza
  finalizeBatch                  (sin cambios)
```

- **Por qué dentro del job y no en un job aparte:** mientras corre, el lote sigue en `processing`. `resolveMark` exige `needs_review` (`assertBatchInReview`), así que no hay carrera entre el profesor y la IA, ni carrera con `confirmBatch`. Además `finalizeBatch` calcula `reviewPending` ya descontando lo que resolvió la IA, sin código de recuento nuevo.
- **Costo de hacerlo así:** unos 10 a 25 s más por lote (§9). Lo acotan un plazo total (`MARK_DISAMBIGUATION_BATCH_DEADLINE_MS = 90_000`, nuevo) y un `AbortSignal`. Lo que no alcance queda pendiente para el humano, como hoy.
- **Candidatos:** `persistPage` ya tiene en memoria `mark.cropJpegBase64`. Propongo que devuelva los candidatos y que `processSources` los acumule. Cada candidato lleva `markId`, `fieldId`, `state`, el base64 y la *baseline* OMR.
- **Reintentos del lote:** `resolveBatch` también busca en la BD las marcas del lote con `ai_resolution IS NULL` que cumplan el filtro (§3.4) y no estén en memoria, por ejemplo tras un `retry` cuyas páginas se saltó la idempotencia. Para esas pasa la imagen como `{ url }` (presignada con `FilesService.buildDownloadUrl(record, 'inline')`).
- **Separación con la lectura por visión:** `answerReading.scheduleForScan` sigue igual. Lee solo campos `crop_region` y no se toca.

### 3.3 Componentes

| Componente | Ubicación | Estado |
|---|---|---|
| `MarkDisambiguationService` | `apps/api/src/sheet-scanning/mark-disambiguation.service.ts` | nuevo |
| Builder de la pregunta | `apps/api/src/sheet-scanning/mark-disambiguation-decision.ts` | nuevo |
| Combinador puro de dos motores | `packages/decisions/src/consensus.ts` | nuevo |
| Imágenes y reescalado de Jev | `packages/decisions/src/jev/` | cambio |
| Features y umbrales | `packages/types/src/schemas/decisions.schema.ts` | cambio |
| Evidencia persistida | `sheet_scan_marks.ai_resolution` | nuevo, con migración |

`MarkDisambiguationService` se registra en `SheetScanningModule`. `DecisionsModule` ya es `@Global`. Sus helpers de un solo uso son métodos privados (regla `03-helpers-vs-services`) y no lleva comentarios (`02-no-comments`).

### 3.4 Qué marcas entran

Entran las marcas que cumplen **todo** esto:

- `state IN ('multiple','ambiguous')` y `reviewed_at IS NULL` en `live`;
- el campo del layout es `kind = 'bubble_group'` y `selectMode = 'single'`;
- las burbujas están en una sola fila (dispersión vertical de los `center.y` ≤ radio);
- hay recorte (base64 en memoria o `crop_file_id`);
- el escaneo no está en `quality_rejected` ni en `superseded`.

Quedan fuera en v1: `digit_grid`, `selectMode = 'multiple'` y `crop_region`.

**Auto-anuladas por el OMR** (`auto_resolved = true` con `review_decision = 'annulled'` sin `reviewed_by_id`):

- En `live` se **excluyen**: el OMR ya decidió con confianza y no hay que pagar por eso.
- En `shadow` se **incluyen**: son la principal fuente de nulas reales, la clase más débil de la PoC. Su verdad es débil (decisión del OMR, no humana) y se reporta aparte.

### 3.5 Una feature por motor (dos `DecisionFeature`)

`decision_settings` tiene índice único `(org_id, feature)` y una sola columna `engine`. Propongo **dos features** (nuevas):

- `mark_disambiguation_jev`, con default `{ engine: 'jev', model: 'jev-1.14.0', mode: 'off', thresholds: {} }`;
- `mark_disambiguation_openai`, con default `{ engine: 'openai', model: 'gpt-6-luna', mode: 'off', thresholds: {} }`.

Por qué dos features y no una feature con dos motores:

- No requiere migración en `decision_settings` ni cambiar su índice único.
- Cada motor tiene su modelo fijado y sus umbrales, que es justo lo que pide la regla 2. Un umbral calibrado vale para un par (motor, modelo).
- `decision_calls.feature` distingue las filas de cada motor sin columnas nuevas.
- Una sola feature obligaría a agregar un "override de engine" en `evaluate()` y a guardar umbrales por motor dentro de un jsonb pensado por pregunta.

Que el nombre incluya el motor es intencional: cambiar el motor de un slot exige recalibrar igual. Si la fila trae un `engine` distinto del esperado, el servicio lo trata como mal configurado: `reportServerError` y todo a revisión.

**Modo efectivo del pipeline** (nuevo, en `MarkDisambiguationService`):

- `live` si las **dos** features están en `live`;
- `shadow` si las dos están en `shadow`;
- en cualquier otra combinación no corre y se reporta una vez por lote (`scope: 'mark_disambiguation.mode_mismatch'`).

Un motor caído en `live` no cambia el modo. Su llamada falla y la marca va a revisión (§5.2).

**Cambios mínimos en `DecisionsService`** (`apps/api/src/decisions/decisions.service.ts`):

- `shadow()` pasa a devolver `Promise<DecisionResult<Q> | null>` y sigue sin lanzar nunca. Es compatible con `remedial-judge.service.ts`, que lo llama con `void`. Sin esto, en sombra no podrías calcular el veredicto combinado.
- Nuevo `settingsOf(orgId, feature): Promise<{ mode; engine; model; thresholds; available }>`. Envuelve `DecisionsConfigService.resolve` y `isAvailable()`, y da los umbrales también en sombra.

**Concurrencia:**

- `DECISION_MAX_CONCURRENCY = 8` es global y `DECISION_MAX_SHADOW_BACKLOG = 16` descarta llamadas en sombra.
- El servicio usa su propio `ConcurrencyLimiter(MARK_DISAMBIGUATION_CONCURRENCY = 3)` por lote, es decir 3 marcas y 6 llamadas en vuelo. Así la cola no pasa del límite de descarte, incluso con dos lotes en paralelo.
- Una llamada descartada (`null`) cuenta como falla de motor.

## 4. Imágenes en Jev y la pregunta

### 4.1 Adaptador de Jev (`packages/decisions/src/jev/`)

Requisitos de Jev 1.13/1.14 (https://docs.typesafe.ai/images.md):

- header `TypeSafe-Danger-Zone-Images: true`;
- mapa `assets` `{ ref: { type: 'image', format: 'png'|'jpg'|'jpeg', data_base64 } }`;
- la referencia **debe** aparecer en `state`, en las instrucciones o en los criterios, o la API responde 400;
- PNG o JPEG, cada lado de 280 a 1568 px, 78.400 a 2.458.624 px en total, 16 MiB por imagen;
- **Jev nunca reescala**: si una imagen no cumple, falla toda la llamada.

**SDK: subir `@typesafe-ai/sdk` de `0.6.0` a `0.7.0`, versión exacta.** No conviene mapear a mano:

- el SDK genera las referencias y arma `assets`;
- acepta `headers` por request;
- se mantiene `mapSdkError`, con sus clases (`RateLimitError`, `APITimeoutError`…) y reintentos;
- el contrato "solo el adaptador conoce el SDK" sigue vigente.

El SDK 0.7.0 requiere Node 22. `apps/api/Dockerfile` (`node:22-bookworm-slim`), `engines` (`>=22.0.0`) y CI ya usan 22, pero **`.nvmrc` dice `20`**: corrígelo en el mismo PR. Si la API de `image()` del SDK no permite controlar la clave en `state`, el plan B es pasar `assets` por el cuerpo crudo dentro del mismo adaptador.

**Cambios** (nuevos):

- **Opción de constructor `experimentalImages`.** `JevEngineConfig.experimentalImages?: boolean` (default `false`). `capabilities.images` refleja esa opción. `DecisionsModule` lo enciende con la variable `JEV_EXPERIMENTAL_IMAGES=true`. Apagarlo hace que todo vaya a revisión.
- **Restricciones de imagen en los límites.** `DecisionEngineLimits.imageConstraints: { minSidePx; maxSidePx; minPixels; maxPixels; maxBytes } | null` en `contracts.ts`. `JEV_LIMITS` lleva los valores de la doc. `OPENAI_LIMITS` y `FakeDecisionEngine` llevan `null`.
- **Tokens por imagen.** `JEV_LIMITS.tokensPerImage` pasa de `0` a `3_000`. Es conservador: en la PoC, 1103×300 dio unos 1.300 tokens de imagen. La doc todavía no publica cómo estimarlos.
- **Validación previa.** `JevDecisionEngine.evaluate` pasa `request.images` a `assertWithinLimits` (hoy no lo hace porque las rechaza).
- **Inyección de la referencia.** Si `state` es objeto, se agrega la clave reservada `imagen` (o `imagenes` si hay más de una) con la referencia. Si `state` ya trae esa clave → `invalid_request`. Si es texto, se envuelve en `{ texto, imagen }`. `DecisionCallsRecorder.hashState` no cambia, porque hashea el `state` original más cada imagen.
- **Imágenes por URL.** Si la imagen viene como `{ url }`, el adaptador la descarga con el `fetch` inyectable, porque Jev necesita los bytes. Un 404 se traduce en `upstream`.

### 4.2 Dónde se reescala: en el adaptador, según `limits`

El consumidor manda **una** imagen, el recorte original, a ambos motores:

- **El reescalado depende del motor.** La PoC muestra que ampliar perjudica a OpenAI. Si el consumidor reescalara, tendría que saber qué motor es cuál, y eso rompe la abstracción.
- **Sin reescalado, Jev no funciona.** Jev falla con lados < 280 px y no reescala. El recorte del OMR mide 250 px de ancho (`crop_field_jpeg`, `width_px=250` en `services/omr/app/classify.py`).
- **Regla en el adaptador** (`packages/decisions/src/images/fit-image.ts`, nuevo):
  - escalar para que el lado menor quede en `JEV_IMAGE_TARGET_MIN_SIDE_PX = 300`, que es lo calibrado en la PoC (ligeramente sobre los 280 mínimos);
  - Lanczos, JPEG calidad 92, como en `run_poc.py`;
  - si el lado mayor supera 1568, bajar a 1568 y rellenar en blanco el lado menor hasta 280 (relación de aspecto > 5,6).
  - Ejemplo: 250×68 → 1103×300.
- **Librería:** `sharp` como dependencia de `@soe/decisions`. Hoy no hay ninguna librería de imágenes en el monorepo. `sharp` trae binarios precompilados para glibc x64/arm64, compatibles con `bookworm-slim`.
- **Alternativa descartada por ahora:** que el OMR emita un recorte nativo más grande. Daría mejor calidad, pero cambia el contrato `markReadingSchema`, el almacenamiento y lo que ve OpenAI. Queda como pregunta abierta (§12).

### 4.3 La pregunta (`mark-disambiguation-decision.ts`, nuevo)

Sigue el patrón de `buildJudgeDecision`: una función pura que comparten la API y `scripts/decisions/`.

```ts
export const MARK_DISAMBIGUATION_DECISION_VERSION = 'mark-disambiguation-v1';
export const MARK_ANSWER_BLANK = 'blank';
export const MARK_ANSWER_NULL = 'null';
export function buildMarkDisambiguationDecision(options: readonly string[]): {
  state: DecisionState;
  questions: { respuesta: ChoiceQuestion<string> };
};
```

**Opciones:**

- Son los `bubbles[].value` del campo en `sheet_layouts.spec`, ordenados por `center.x`. Es la misma fuente que `ScanReviewService.buildOptionsIndex`.
- Se agregan `blank` y `null`.
- Si algún `value` coincide con `blank` o `null`, el campo se excluye y se reporta.

**`state`** (sin datos del alumno; Jev agrega `imagen` en el adaptador):

```json
{ "descripcion": "<INSTRUCCIONES>" }
```

**INSTRUCCIONES** (parte de la PoC; los cambios de redacción están marcados abajo):

> La imagen es el recorte de UNA pregunta de alternativas de una hoja de respuestas en papel. Muestra una fila de burbujas impresas con los rótulos {opts}, de izquierda a derecha. Puede asomar el borde de la fila de arriba o de abajo: ignóralo, evalúa solo la fila central completa. Un alumno marca su respuesta rellenando una burbuja con lápiz. Los rótulos impresos y el contorno de cada burbuja NO son marcas. ¿Qué respondió el alumno en esta pregunta?

`{opts}` es `options.join(', ')`. "Letras" pasó a "rótulos" porque hay campos con valores como V/F o 1–5.

**Pregunta** `respuesta = choice(instrucción, criterios)`:

- Instrucción: "Siguiendo `descripcion` y mirando la imagen del recorte, ¿qué respondió el alumno en esta pregunta?"
- Criterios:
  - por cada opción `X`: "Rellenó claramente la burbuja X y ninguna otra.";
  - `blank`: "No rellenó ninguna burbuja: todas están vacías (solo contorno y rótulo impreso).";
  - `null`: "Respuesta nula: rellenó dos o más burbujas, o hay marcas que no permiten saber cuál eligió (borrones, tachas, rellenos parciales parecidos en varias burbujas)."

**Imagen:** `images: [{ mimeType: 'image/jpeg', data: cropJpegBase64 }]`, o `{ url }` en el camino de catch-up.

**Traducción a la marca:**

| Respuesta | `review_decision` | `reviewed_value` |
|---|---|---|
| opción `X` | `option` | `X` |
| `blank` | `blank` | `null` |
| `null` | `annulled` | `null` |

Usa los mismos valores de `mark_review_decision` que ya entiende `toParserResult`.

### 4.4 Paridad con la PoC

La PoC usó textos distintos por motor:

- a Jev le pasó `recorte` como clave del estado;
- a OpenAI le pasó texto plano y la pregunta "¿Qué respondió…?".

En producción, `toOpenAiInput` manda `JSON.stringify(state)`. Antes de la sombra, un script de replay (`scripts/decisions/run-mark-replay.ts`, nuevo) corre los 100 recortes con el builder y los adaptadores reales. **Criterio:** ningún error nuevo respecto de la PoC y la simulación de §5 con los umbrales de §7 dentro de ±3 automáticas.

## 5. Combinador de dos motores

### 5.1 Ubicación: `packages/decisions/src/consensus.ts` (nuevo), exportado en `index.ts`

Va en el paquete y no en el dominio por dos razones:

- no conoce burbujas, solo dos `ChoiceAnswer` y sus umbrales;
- tiene un segundo consumidor real: el script de calibración, que simula umbrales sobre `decision_calls` sin NestJS.

La traducción a `review_decision` y los vetos de dominio quedan en `MarkDisambiguationService`.

```ts
export interface PairThresholds { readonly agree: number; readonly solo: number; readonly unsure: number }
export type PairSide =
  | { readonly status: 'ok'; readonly answer: ChoiceAnswer<string> }
  | { readonly status: 'failed'; readonly code: DecisionErrorCode | 'dropped' };
export type PairVerdict = 'agree' | 'solo_a' | 'solo_b' | 'low_agreement' | 'conflict' | 'engine_failed';
export interface PairConsensus { readonly verdict: PairVerdict; readonly route: 'auto' | 'review'; readonly choice: string | null }
export function pairConsensus(a: PairSide, b: PairSide, ta: PairThresholds, tb: PairThresholds, options: readonly string[]): PairConsensus;
```

**Invariante**, validada en `assertValidThresholds` (se extiende) y en el zod de §7: `0 <= unsure <= agree <= solo <= 1`. Con `unsure <= solo` nunca pueden cumplirse a la vez `solo_a` y `solo_b`.

### 5.2 Tabla de decisión

`ca`/`pa` son la opción y la confianza del motor A (Jev); `cb`/`pb`, las del motor B (OpenAI).

| # | Condición | Veredicto | Ruta | Valor |
|---|---|---|---|---|
| 1 | A o B `failed` (`timeout`, `rate_limited`, `upstream`, `refused`, `unavailable`, `auth`, `aborted`, `disabled`, `invalid_request`, `context_exceeded`, `dropped`) | `engine_failed` | review | — |
| 2 | `ca` o `cb` no está en `options ∪ {blank,null}`, o la confianza no es finita en [0,1] | `engine_failed` | review | — |
| 3 | `ca = cb`, `pa ≥ agreeA` y `pb ≥ agreeB` | `agree` | auto | `ca` |
| 4 | `ca = cb` y alguno bajo su umbral de acuerdo | `low_agreement` | review | — |
| 5 | `ca ≠ cb`, `pa ≥ soloA` y `pb < unsureB` | `solo_a` | auto | `ca` |
| 6 | `ca ≠ cb`, `pb ≥ soloB` y `pa < unsureA` | `solo_b` | auto | `cb` |
| 7 | `ca ≠ cb` en cualquier otro caso (ambos seguros o zona intermedia) | `conflict` | review | — |

**Casos borde:**

- **Un motor no disponible o caído** (fila 1): nunca se acepta con un solo motor, aunque esté muy seguro. La marca queda como hoy.
- **Refusal:** OpenAI lo entrega como `DecisionError('refused')` y cae en la fila 1.
- **Valor fuera de las opciones:** los adaptadores ya lo rechazan con `upstream` (`assertAnswerMatches`). La fila 2 es defensa en profundidad.
- **Plazo del lote vencido:** la llamada se aborta y **no** se persiste `ai_resolution`, para que un reintento pueda intentarla.
- **Umbrales ausentes o inválidos en `decision_settings`:** `reportServerError` y todo a revisión en `live`. En sombra se registra sin veredicto.

**Vetos de dominio** (en el servicio, después del combinador; propuesta v1):

- **OMR `multiple` y la IA dice `blank`** (dos burbujas sobre el umbral y la IA no ve ninguna) → review. Es físicamente incoherente, aunque en la PoC no ocurrió. Se mide en sombra antes de mantenerlo o quitarlo.
- **Muestra de auditoría:** en `live`, un `MARK_DISAMBIGUATION_AUDIT_RATE = 0.05` de las automáticas va a revisión con veredicto `audit_sample`, elegidas de forma determinista por hash del `markId`. Sirve para medir la deriva.

### 5.3 Comportamiento por modo

| | `shadow` | `live` |
|---|---|---|
| Llamadas | `DecisionsService.shadow()` ×2 (devuelve el resultado) | `DecisionsService.evaluate()` ×2 con `timeoutMs = 8_000` |
| `decision_calls` | 2 filas `mode='shadow'`, `correlation_id = markId`, `baseline` con el estado OMR | 2 filas `mode='live'`, mismo `correlation_id` y `baseline` |
| `sheet_scan_marks` | Solo `ai_resolution` (`mode='shadow'`, `applied=false`). No toca `reviewed_*` | Si la ruta es auto: escribe `reviewed_*`, `auto_resolved=true`, `ai_resolution.applied=true` |
| Profesor | No ve nada distinto | Ve las auto-resueltas en la lista existente (§8) |

`baseline` = `{ state, doubtReason, suggestedValue, nullConfidence, fill, margin, fieldId, autoAnnulled }`.

## 6. Persistencia

### 6.1 Migración (nueva, `packages/db/drizzle/migrations/0056_mark_ai_resolution.sql`)

```sql
ALTER TABLE "sheet_scan_marks" ADD COLUMN "ai_resolution" jsonb;
```

- Se agrega `aiResolution: jsonb('ai_resolution').$type<MarkAiResolution>()` en `packages/db/src/schema/sheet-scanning.ts`.
- No lleva índice: las consultas van por `scan_id`/lote, que ya están indexados (`sheet_scan_marks_review_idx`).
- No se toca `decision_settings` ni `decision_calls`.
- El número `0056` es el siguiente al último en `dev` (`0055_auditor_lectura`). Si otra rama lo ocupa antes, conserva la meta de dev y regenera la migración (no la renombres a mano).

**`MarkAiResolution`** (zod nuevo en `packages/types/src/schemas/mark-disambiguation.schema.ts`):

```ts
{
  version: 'mark-disambiguation-v1',
  mode: 'shadow' | 'live',
  verdict: PairVerdict | 'audit_sample' | 'vetoed',
  route: 'auto' | 'review',
  value: string | null,
  applied: boolean,
  engines: Array<{
    feature: DecisionFeature; engine: DecisionEngineId; model: string | null;
    choice: string | null; confidence: number | null; errorCode: string | null;
  }>,
  thresholds: { jev: PairThresholds | null; openai: PairThresholds | null },
  decidedAt: string
}
```

`value` es la opción, `blank` o `null`.

### 6.2 Separación entre decisión de IA y decisión humana (CLAUDE.md §8.3)

- **Evidencia de IA:** `ai_resolution`, con las dos respuestas, confianzas, modelos y umbrales vigentes. El detalle con probabilidades queda en `decision_calls`, unido por `correlation_id = sheet_scan_marks.id`. No se agrega FK porque `DecisionCallsRecorder.record` no devuelve el id y la unión por `correlation_id` basta.
- **Decisión vigente:** `reviewed_value` y `review_decision`, que lee `toParserResult`.
- **Autoría:**
  - IA: `auto_resolved = true`, `reviewed_by_id IS NULL` y `ai_resolution->>'applied' = 'true'`;
  - auto-anulación del OMR: `auto_resolved = true`, `reviewed_by_id IS NULL` y `ai_resolution` nula o sin aplicar;
  - humano: `reviewed_by_id` no nulo y `auto_resolved = false`.
- `ScanReviewService.resolveMark` ya hace `autoResolved: false` y fija `reviewedById`, y no toca `ai_resolution`. Si el profesor corrige, la evidencia de la IA se conserva.
- `suggested_value` sigue siendo la sugerencia del **OMR**. No se pisa, para no romper la métrica de `SheetScanMetricsService.suggestionMetrics`.

### 6.3 Escritura y `reviewPending`

- En `live`, la actualización usa `WHERE id = :markId AND org_id = :orgId AND reviewed_at IS NULL`. Así nunca pisa una decisión previa, como la auto-anulación del OMR.
- Va dentro de `withOrgContext`, una transacción por marca.
- `reviewPending` no requiere cambios. `finalizeBatch` corre después de la etapa y cuenta `multiple|ambiguous` con `reviewed_at IS NULL`. `recountReviewPending` hace lo mismo cuando el profesor corrige.

## 7. Umbrales y calibración

### 7.1 Dónde viven

En `decision_settings.thresholds` de cada feature, bajo el id de pregunta `respuesta`: `{ "respuesta": { "agree": …, "solo": …, "unsure": … } }`.

- Se agrega `pairThresholdsSchema` (`.strict()`, con el refine de la invariante) a la unión de `decisionThresholdsSchema` en `packages/types/src/schemas/decisions.schema.ts`.
- No choca con `{auto, review}` ni con `{yes, no}`, que también son `.strict()`.
- Las filas pueden ser globales (`org_id IS NULL`) o por organización.

### 7.2 Valores iniciales (PROVISORIOS, salen de 100 casos)

| Motor | `agree` | `solo` | `unsure` | Justificación |
|---|---|---|---|---|
| Jev `jev-1.14.0` | 0,60 | 0,85 | 0,50 | Mínimo de las correctas 0,56 y p10 0,86. Sus aciertos donde OpenAI erró tuvieron 0,87, 0,83 y 0,95 |
| OpenAI `gpt-6-luna` | 0,50 | 0,80 | 0,50 | Todos sus errores < 0,5 (máximo 0,46), así que bajo 0,5 cuenta como "no sabe". Está subconfiado (p10 0,59) |

Resultado simulado: §1.1 (verificado sobre los resultados guardados de la PoC). Con estos valores, el caso `IMG_1626_q12` (Jev `null` 0,83 contra OpenAI B 0,46) va a revisión por `conflict`, que es lo deseable mientras no haya más nulas.

### 7.3 Plan de calibración en sombra

- **Verdad:** en sombra el profesor sigue revisando **todas** las dudosas. La verdad es su decisión (`reviewed_by_id IS NOT NULL`), traducida con la tabla de §4.3. Para las auto-anuladas del OMR la verdad es débil y se reporta aparte. Cada desacuerdo entre la IA y el humano se revisa a mano, porque el humano también se equivoca.
- **Métricas:**
  - (a) tasa de error entre las automáticas simuladas, con su cota superior al 95 %;
  - (b) cobertura: automáticas sobre evaluadas;
  - (c) tasa de fallas de motor;
  - (d) latencia p50/p95 por motor.
- **Tamaño de muestra:** con 0 errores observados, la cota superior al 95 % es 3/n (regla de tres).
  - Para afirmar un error ≤ 1 % necesitas ≥ 300 automáticas con verdad humana; para ≤ 0,5 %, ≥ 600.
  - Objetivo para pasar a `live`: **≥ 300 automáticas simuladas, a lo más 1 error y ninguno sistemático**.
  - Con una cobertura cercana al 90 % son unas 350 dudosas. A unas 100 dudosas por lote, son 4 a 6 lotes.
  - Deben venir de ≥ 3 colegios e incluir capturas de escáner y de celular, para no calibrar con una sola muestra.
- **Cortes obligatorios**, cada uno con n ≥ 30 y 0 errores automáticos:
  1. verdad `annulled` (nulas reales);
  2. verdad `blank`;
  3. marcas débiles: `doubt_reason IN ('margin','band')` y `margin < 0.1`;
  4. `doubt_reason = 'multiple'`;
  5. `captureProfile.source` escáner contra celular;
  6. campos de 5 o más opciones.
- **Nulas, borrones y tachas:** si las nulas reales no llegan a 30, arma un set sintético de unas 100 hojas marcadas a propósito (doble marca, borrón con remarca, tacha, X, marca débil). Se etiquetan y se corren con `run-mark-replay.ts`.
- **Ajuste de umbrales:** se busca la mayor cobertura que cumpla el criterio, por motor. Se versionan en `decision_settings.thresholds` antes de `live` y se recalibra si cambia `jev-1.14.0` o se detecta deriva en `gpt-6-luna` (§11).
- **Herramienta:** `scripts/decisions/run-mark-calibration.ts` (nuevo). Une `decision_calls` (features `mark_disambiguation_*`) con `sheet_scan_marks` por `correlation_id`, simula `pairConsensus` sobre una grilla de umbrales y genera el reporte. Respeta la regla de `extract-goldsets.ts`: solo lee una BDD local o una copia anonimizada.

## 8. UX mínima

- **Lista de auto-resueltas.** `selectPendingMarks(..., 'auto')` filtra `auto_resolved = true AND reviewed_by_id IS NULL`, así que las marcas que resuelva la IA **ya aparecen** en `autoAnnulled`. `ReviewWizard.tsx` las suma al final de `MarkReviewPanel` y el profesor las corrige con el mismo `PATCH /sheet-scan-marks/:id`.
- **Modelo:** `ReviewMarkModel.aiResolution: { value; verdict; agreement: 'both' | 'single' } | null` (nuevo). Solo se expone con `mode = 'live'`; en sombra va `null`. Se llena en `ScanReviewService.toReviewMarkModel`.
- **Textos** (cambios chicos, sin pantallas nuevas):
  - el callout de `ReviewWizard.tsx` pasa de "Dobles marcas anuladas automáticamente" a "Resueltas automáticamente: N por IA, M dobles marcas evidentes. No requieren revisión; quedan al final de la lista por si quieres corregir alguna.";
  - cada marca muestra un distintivo: "IA: B (dos modelos coinciden)", "IA: en blanco (un modelo seguro)" o "Doble marca evidente";
  - en las que van a revisión por `conflict` se puede mostrar "Los modelos no coinciden". **No** se muestra la respuesta de la IA en `audit_sample`: la auditoría tiene que ser ciega.
- **Después de confirmar el lote:** hoy no hay vía. `resolveMark` exige `needs_review` y ningún endpoint actualiza `responses` de ítems de alternativas (solo lo hacen `rubric-grading.service.ts` y `development-grading.service.ts`). Propongo:
  - `ScanReviewService.correctConfirmedMark` (nuevo): actualiza la marca, hace upsert de la fila de `responses` con `(assessment_id, student_id, item_id)` como en `AnswerSheetsService.confirm` y llama a `AssessmentResultsService.recalculateAnswerSheetResults`;
  - en la interfaz, un "Corregir" en la vista de la hoja del alumno que abre el mismo panel con el recorte.
  - Es la vía para atender el reclamo del alumno (fase 6).
- **Alumno:** ve su resultado como hoy, sin ninguna indicación de que la IA resolvió una respuesta (§12.3). `aiResolution` nunca se expone en endpoints ni vistas del alumno o apoderado.
- **Profesor:** ve el distintivo de IA en la revisión del lote y en "Corregir" después de confirmar.

## 9. Costos y latencia esperados

- **Por marca (ambos motores):** Jev ~1.530 tokens × US$0,042/M = US$0,000064, y OpenAI ~382 × US$0,10/M = US$0,000038 (precios de `llm.pricing.ts`). En total **~US$0,0001**.
- **Por lote** (40 hojas × 30 preguntas = 1.200 marcas, con 3 % a 10 % de dudosas = 36 a 120 marcas): **US$0,004 a 0,012**. Es despreciable. Igual se pone un tope duro `MARK_DISAMBIGUATION_MAX_MARKS_PER_BATCH = 500` (nuevo).
- **Latencia por marca:** el máximo de las dos llamadas en paralelo, p50 ~300 ms y p95 ~700 ms, más unos milisegundos de reescalado. Con 3 marcas en vuelo, 120 marcas toman unos 15 a 30 s, dentro del plazo de 90 s.
- **Brecha de presupuesto:** `AiObservabilityService.fetchRows` no suma `decision_calls`, así que el presupuesto de IA de la organización no ve este gasto (ni el del juez remedial). Propongo agregarlo en un PR aparte (fase 4).

## 10. Seguridad y privacidad

- **El recorte no contiene identidad.**
  - `crop_field_jpeg` (`services/omr/app/classify.py`) recorta el rectángulo que envuelve las burbujas del campo, más un margen de 1,5 radios, y lo lleva a 250 px de ancho.
  - El nombre manuscrito y el QR viven en `spec.identity.region` (el QR en `SHEET_QR_IDENTITY_REGION`, esquina superior derecha), no en `spec.fields`.
  - El RUT por burbujas también está en `spec.identity`, no en los campos `digit_grid`, y además `digit_grid` queda fuera del alcance (§3.4).
  - **Guardia nueva:** si el rectángulo del campo más su margen se cruza con `spec.identity.region`, la marca se excluye y se reporta.
- **El estado no lleva datos del alumno:** ni nombre, ni RUT, ni `studentId`. `correlation_id` (el `markId`) y `baseline` quedan solo en nuestra BD.
- **Proveedores:** son respuestas de alumnos, sin identidad, enviadas a TypeSafe (imágenes en fase experimental) y a OpenAI. Por decisión del usuario (§2.5) esto **no bloquea** `shadow` ni `live`; el DPA y la retención de imágenes de cada proveedor se revisan después.
- **Imágenes por URL:** solo en el camino de catch-up, con URL presignada de vida corta (`FilesService.buildDownloadUrl`). El hash de la URL sin query ya lo hace `DecisionCallsRecorder.hashImage`.
- **Permisos y RLS:** toda lectura y escritura va por `withOrgContext`. Los errores van a `reportServerError` con `scope: 'mark_disambiguation'`.

## 11. Plan de implementación

**PR 1. Imágenes en Jev (`@soe/decisions`)**

- Archivos:
  - `packages/decisions/package.json`: `@typesafe-ai/sdk` 0.7.0 y `sharp`;
  - `src/contracts.ts`: `imageConstraints` y `PairThresholds`;
  - `src/jev/jev-engine.ts`, `jev-mapping.ts`, `jev-limits.ts`;
  - `src/images/fit-image.ts` (nuevo);
  - `src/openai/openai-limits.ts`, `src/fake/fake-engine.ts`;
  - `README.md`: quitar "Imágenes a Jev: hoy solo texto";
  - `apps/api/src/decisions/decisions.module.ts`;
  - `.nvmrc` → 22.
- Tests en `jev-engine.spec.ts`, con `fetch` falso:
  - header presente solo con imágenes;
  - `assets` con referencia presente en `state`;
  - choque con la clave `imagen`;
  - 250×68 → 1103×300;
  - relación > 5,6 con relleno y > 1568 reducido;
  - imagen `{url}` descargada y 404 → `upstream`;
  - `experimentalImages=false` → `invalid_request`;
  - `tokensPerImage` en `assertWithinLimits`.
- `fit-image.spec.ts`. Las specs existentes del SDK deben seguir verdes con 0.7.0.

**PR 2. Combinador y features**

- Archivos:
  - `packages/decisions/src/consensus.ts`, `routing.ts` (`assertValidThresholds` con el caso pair), `index.ts`;
  - `packages/types/src/schemas/decisions.schema.ts` (`pairThresholdsSchema`, `DECISION_FEATURES += mark_disambiguation_jev, mark_disambiguation_openai`, defaults `off`);
  - `apps/api/src/decisions/decisions.service.ts` (`shadow()` devuelve el resultado, `settingsOf`).
- Tests:
  - `consensus.spec.ts` con las 7 filas de §5.2;
  - bordes exactos (`>=` contra `<`);
  - invariante violada;
  - `decisions.service.spec.ts` (sombra devuelve `null` al descartar o fallar, `settingsOf`);
  - `decisions.schema.spec`.

**PR 3. Dominio, persistencia y sombra**

- Archivos:
  - migración `0056_mark_ai_resolution.sql` y `packages/db/src/schema/sheet-scanning.ts`;
  - `packages/types/src/schemas/mark-disambiguation.schema.ts`;
  - `apps/api/src/sheet-scanning/mark-disambiguation-decision.ts`;
  - `mark-disambiguation.service.ts`;
  - `sheet-scan.service.ts` (`persistPage`/`processSources` devuelven candidatos; `runJob` llama a `resolveBatch`);
  - `sheet-scanning.module.ts`;
  - `scripts/decisions/run-mark-replay.ts`.
- Tests:
  - builder: opciones desde `bubbles`, orden por `x`, choque con `blank`/`null`;
  - servicio con `Database` falsa y `DecisionsService` falso, según `01-testing`: filtro de §3.4, modo efectivo, sombra sin tocar `reviewed_*`, guardia de identidad, plazo y aborto sin persistir, catch-up desde la BD con `{url}`;
  - `sheet-scan.service.spec.ts`: la etapa corre antes de `finalizeBatch` y su falla no cambia el estado del lote.
- Activación: fila global `mode='shadow'` para ambas features, después de que el replay pase el criterio de §4.4.

**PR 4. Métricas y calibración**

- Archivos:
  - `sheet-scan-metrics.service.ts`: `aiResolutions = { evaluated, autoSimulated, autoApplied, correctedByHuman, agreementWithHuman }`;
  - `packages/types` (`SheetScanMetricsResponse`);
  - `scripts/decisions/run-mark-calibration.ts`;
  - `ai-observability.service.ts`: sumar `decision_calls`.
- Tests: specs de métricas con filas falsas; traducción `annulled ↔ null`.

**PR 5. Live**

- Archivos:
  - `mark-disambiguation.service.ts`: rama de escritura, veto, auditoría;
  - `scan-review.service.ts`: `aiResolution` en `toReviewMarkModel`;
  - `packages/types/src/schemas/sheet-scanning.schema.ts`: `ReviewMarkModel`;
  - `apps/web/.../revisar/ReviewWizard.tsx` y `MarkReviewPanel`: callout y distintivo.
- Tests:
  - escritura con `reviewed_at IS NULL` (no pisa a un humano ni al OMR);
  - `finalizeBatch` descuenta las resueltas;
  - `resolveMark` posterior deja `auto_resolved=false` y conserva `ai_resolution`;
  - auditoría determinista.
- Activación: umbrales calibrados en `thresholds`, luego `live` en una organización piloto y después global.

**PR 6. Corrección después de confirmar** (vía de reclamo, §8)

- Archivos: `scan-review.service.ts` (`correctConfirmedMark`), `scan-review.controller.ts`, `answer-sheets.service.ts` o `assessment-results.service.ts`, web.
- Tests: upsert de `responses` y recálculo.

### 11.1 Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Las imágenes de Jev son experimentales ("Dreamer-ready"): formato, límites o precisión pueden cambiar entre versiones | Interruptor `JEV_EXPERIMENTAL_IMAGES`; modelo fijado en `jev-1.14.0` en `decision_settings`; si Jev falla, todo a revisión (fila 1); replay obligatorio antes de subir de versión |
| `gpt-6-luna` no tiene versión fijable: puede cambiar sin aviso | Monitoreo semanal de la distribución de confianza (p10 y fracción < 0,5) en `decision_calls`; auditoría ciega del 5 %; si la tasa de corrección o error de la auditoría supera 1 %, volver a `shadow` con una fila de `decision_settings`, sin deploy |
| Deriva de los modelos o de las capturas (nuevos lápices, celulares) | La auditoría y `correctedByHuman` se miden por corte (§7.3); recalibrar al cambiar el perfil de captura |
| Sesgo de la muestra: pocas nulas, sin borrones, pocos colegios | Cortes obligatorios con n ≥ 30; set sintético; ≥ 3 colegios y ambas fuentes de captura antes de `live` |
| Sombra descartada por cola llena (`DECISION_MAX_SHADOW_BACKLOG`) | Limitador propio de 3 marcas; se mide la tasa de `dropped` y, si supera 2 %, se baja la concurrencia |
| El lote tarda más en procesarse | Plazo de 90 s, tope de 500 marcas; la latencia se mide en sombra, que corre en el mismo punto |
| `sharp` es una dependencia nativa | Imagen `bookworm-slim` (glibc) con binarios precompilados; si da problemas, la alternativa es el recorte nativo del OMR (§12) |
| Errores tolerables que el alumno no detecta | Auditoría, lista de auto-resueltas visible antes de confirmar, corrección posterior (PR 6) |

## 12. Decisiones de cierre (2026-10-22)

1. **Auditoría:** se mantiene el 5 % de automáticas que vuelve a revisión ciega (§5.2).
2. **Un solo motor en `live`:** si un motor falla o no está disponible, la marca va siempre a revisión humana (fila 1 de §5.2). No se acepta con un solo motor.
3. **Transparencia:** el alumno NO ve que una respuesta la resolvió la IA. El profesor SÍ: distintivo en la revisión del lote (§8) y en la corrección posterior (PR 6).

## 13. Preguntas abiertas (no bloquean)

1. **Recorte nativo más grande:** ¿vale la pena que el OMR emita un recorte de mayor resolución (por ejemplo 300 px de alto desde la página rectificada) para Jev, en vez de ampliar en el adaptador? Se puede medir en sombra con un subconjunto.
2. **Interruptor para el colegio:** ¿la organización necesita un control propio (`organizations.config.review`, vía `ReviewSettingsService`) además de `decision_settings`, que maneja operaciones?
