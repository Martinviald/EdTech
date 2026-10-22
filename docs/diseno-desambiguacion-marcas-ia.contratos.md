# Contratos compartidos — desambiguación de marcas con IA

> Complemento de `docs/diseno-desambiguacion-marcas-ia.md`. Fija las decisiones semánticas que
> cruzan fases (PR 1–6) y capas (`@soe/decisions`, `@soe/types`, `@soe/db`, `apps/api`,
> `apps/web`). Si algo aquí contradice al diseño, manda este archivo: recoge los desvíos que
> aparecieron al calzar el diseño con el código real. Todo prompt de subagente copia la sección
> que le toca con esta misma redacción.

## C1. Nombres exactos

| Qué | Nombre | Dónde |
|---|---|---|
| Umbrales de un motor | `PairThresholds { agree; solo; unsure }` | `@soe/decisions` (`contracts.ts`) y zod `pairThresholdsSchema` en `@soe/types` |
| Lado del combinador | `PairSide = { status: 'ok'; answer: ChoiceAnswer<string> } \| { status: 'failed'; code: DecisionErrorCode \| 'dropped' }` | `@soe/decisions` (`consensus.ts`) |
| Veredicto del combinador | `PairVerdict = 'agree' \| 'solo_a' \| 'solo_b' \| 'low_agreement' \| 'conflict' \| 'engine_failed'` | `@soe/decisions` (TS) y `PAIR_VERDICTS` (zod) en `@soe/types` |
| Veredicto persistido | `MarkAiVerdict = PairVerdict \| 'audit_sample' \| 'vetoed' \| 'no_thresholds'` | `@soe/types` (`MARK_AI_VERDICTS`) |
| Evidencia persistida | `MarkAiResolution` (zod `markAiResolutionSchema`) | `@soe/types/src/schemas/mark-disambiguation.schema.ts`, columna `sheet_scan_marks.ai_resolution` |
| Features | `mark_disambiguation_jev`, `mark_disambiguation_openai` | `DECISION_FEATURES` en `@soe/types` |
| Id de la pregunta | `respuesta` (`MARK_DISAMBIGUATION_QUESTION_ID`) | `@soe/types` |
| Respuestas especiales | `blank` (`MARK_ANSWER_BLANK`), `null` (`MARK_ANSWER_NULL`), como **strings** | `@soe/types` |
| Versión de la pregunta | `mark-disambiguation-v1` (`MARK_DISAMBIGUATION_DECISION_VERSION`) | `@soe/types` |
| Modelo de UI | `ReviewMarkModel.aiResolution: ReviewMarkAiResolutionModel \| null` | `@soe/types/src/schemas/sheet-scanning.schema.ts` |

- **Motor A = Jev** (`mark_disambiguation_jev`), **motor B = OpenAI** (`mark_disambiguation_openai`).
  `solo_a` significa "Jev sabe y OpenAI no"; `solo_b`, al revés. `MarkAiResolution.engines`
  va siempre en el orden `[jev, openai]`.
- Los umbrales viven en `decision_settings.thresholds` de cada feature bajo la clave
  `respuesta`: `{ "respuesta": { "agree": 0.6, "solo": 0.85, "unsure": 0.5 } }`.
  Invariante: `0 <= unsure <= agree <= solo <= 1`.
- `pairConsensus(a, b, ta, tb, options)` recibe en `options` **la lista completa de claves
  válidas** de la pregunta (los `value` de las burbujas más `blank` y `null`). El combinador no
  sabe qué es una burbuja: solo valida que cada `choice` esté en `options`.

## C2. Tabla de decisión (combinador, `@soe/decisions`)

`ca/pa` = opción y confianza de A (Jev); `cb/pb` = las de B (OpenAI). Se evalúa en este orden:

1. A o B `failed` → `engine_failed`, `review`, `choice: null`.
2. `ca` o `cb` fuera de `options`, o confianza no finita o fuera de [0,1] → `engine_failed`, `review`.
3. `ca = cb`, `pa >= agreeA` y `pb >= agreeB` → `agree`, `auto`, `choice: ca`.
4. `ca = cb` y alguna bajo su `agree` → `low_agreement`, `review`.
5. `ca ≠ cb`, `pa >= soloA` y `pb < unsureB` → `solo_a`, `auto`, `choice: ca`.
6. `ca ≠ cb`, `pb >= soloB` y `pa < unsureA` → `solo_b`, `auto`, `choice: cb`.
7. Cualquier otro `ca ≠ cb` → `conflict`, `review`.

Comparaciones: `>=` para superar un umbral alto (`agree`, `solo`) y `<` estricto para "no sabe"
(`unsure`). Umbrales inválidos → `DecisionError('invalid_request')` (lo lanza
`assertValidThresholds`, que se extiende al caso pair).

## C3. Qué marcas entran y quién filtra

- `SheetScanService` **no filtra por dominio**. `persistPage` devuelve un
  `MarkDisambiguationCandidate` por cada marca insertada con `state IN ('multiple','ambiguous')`
  y `cropJpegBase64 !== null`, con: `markId`, `scanId`, `fieldId`, `state`, `cropJpegBase64`,
  `scanState` (el `SheetScanState` con que se insertó el escaneo), `autoAnnulled` (si
  `autoAnnulment` la resolvió) y la baseline OMR (`doubtReason`, `suggestedValue`,
  `nullConfidence`, `fill`, `margin`). `processSources` los acumula y `runJob` los pasa a
  `MarkDisambiguationService.resolveBatch(orgId, batchId, spec, candidates)` antes de
  `finalizeBatch`. `resolveBatch` **nunca lanza**.
- `MarkDisambiguationService` aplica **todo** el filtro de §3.4 del diseño más la guardia de
  identidad (§10):
  - campo del layout `kind = 'bubble_group'`, `selectMode = 'single'`, ≥ 2 burbujas;
  - burbujas en una sola fila: `max(center.y) - min(center.y) <= min(radius)`;
  - ningún `value` igual a `blank` ni `null` (si choca: se excluye el campo y se reporta);
  - el rectángulo de las burbujas más 1,5 radios no se cruza con `spec.identity.region`
    (si se cruza: se excluye y se reporta);
  - `scanState` distinto de `quality_rejected` y `superseded`;
  - en `live`: se excluyen las auto-anuladas por el OMR (`autoAnnulled`); en `shadow` se incluyen;
  - tope `MARK_DISAMBIGUATION_MAX_MARKS_PER_BATCH = 500`.
- Reportes de exclusión por configuración (`mode_mismatch`, `misconfigured`, choque de valores,
  guardia de identidad): **una vez por lote**, con `reportServerError(..., { scope:
  'mark_disambiguation.<motivo>' })`.
- Catch-up: además de los candidatos en memoria, el servicio busca en la BD las marcas del lote
  con `ai_resolution IS NULL`, `crop_file_id IS NOT NULL`, estado dudoso, escaneo no
  `superseded`/`quality_rejected`, y (en `live`) `reviewed_at IS NULL`, que no estén en
  memoria. Para esas manda la imagen como `{ url }` (`FilesService.buildDownloadUrl(record,
  'inline')`).

## C4. Modo efectivo y motores

- `live` si las dos features están en `live`; `shadow` si las dos están en `shadow`; cualquier
  otra combinación (incluido `off`/`off`) → no corre. `off`/`off` no se reporta; el resto se
  reporta como `mark_disambiguation.mode_mismatch`.
- La fila con `engine` distinto del esperado (`jev` para `_jev`, `openai` para `_openai`) →
  `mark_disambiguation.misconfigured`, no corre.
- En `live` sin umbrales válidos para algún motor → `misconfigured`, no corre (todo queda a
  revisión como hoy). En `shadow` sin umbrales → corre, registra y persiste con
  `verdict: 'no_thresholds'`, `route: 'review'`, `value: null`.
- Un motor caído o fallido **no cambia el modo**: su lado es `failed` y la marca va a revisión
  (`engine_failed`). Nunca se acepta con un solo motor.
- `DecisionsService.shadow()` devuelve `DecisionResult | null`; `null` (descartada por cola
  llena o fallida) se traduce a `PairSide` `failed` con `code: 'dropped'`.
- `DecisionsService.evaluate()` (live) se llama con `timeoutMs: 8_000` y el `AbortSignal` del
  lote. Un `DecisionError` se traduce a `failed` con su `code`.
- Plazo del lote vencido (`MARK_DISAMBIGUATION_BATCH_DEADLINE_MS = 90_000`): la llamada se
  aborta y la marca **no** se persiste (ni `ai_resolution` ni `reviewed_*`), para que un
  reintento la intente.
- `correlation_id` = `markId`. `baseline` = `{ state, doubtReason, suggestedValue,
  nullConfidence, fill, margin, fieldId, autoAnnulled }`.

## C5. Vetos y auditoría (solo después del combinador)

- **Veto:** OMR `multiple` y el combinador dice `auto` con `blank` → `verdict: 'vetoed'`,
  `route: 'review'`. Aplica en ambos modos (en sombra se mide).
- **Auditoría ciega:** en `live`, una marca con ruta `auto` se convierte en
  `verdict: 'audit_sample'`, `route: 'review'` cuando
  `parseInt(sha256(markId).slice(0, 8), 16) / 2**32 < MARK_DISAMBIGUATION_AUDIT_RATE (0.05)`.
  En `shadow` no hay auditoría (el profesor ya revisa todo).
- `MarkAiResolution.value` guarda la elección que el combinador habría aplicado (`agree`,
  `solo_*`, y también cuando eso terminó en `vetoed` o `audit_sample`); en cualquier otro
  veredicto es `null`. Valores: la opción de la burbuja, `'blank'` o `'null'`.

## C6. Traducción respuesta → marca (una sola función, en `@soe/types`)

`markAnswerToReview(value)` y su inversa `reviewToMarkAnswer(decision, reviewedValue)`:

| Respuesta IA | `review_decision` | `reviewed_value` |
|---|---|---|
| opción `X` | `option` | `X` |
| `'blank'` | `blank` | `null` |
| `'null'` | `annulled` | `null` |

La usan el servicio (al escribir en `live`), las métricas (acuerdo IA–humano) y la
calibración. No se reimplementa en otro lado.

## C7. Escritura y autoría

- **Sombra:** solo `ai_resolution` (`mode: 'shadow'`, `applied: false`), con
  `WHERE id = :markId AND org_id = :orgId AND ai_resolution IS NULL`. No toca `reviewed_*`,
  `auto_resolved` ni `suggested_value`.
- **Live, ruta `auto`:** una transacción por marca dentro de `withOrgContext`:
  `UPDATE ... SET reviewed_value, review_decision, reviewed_at = now(), auto_resolved = true,
  reviewed_by_id = NULL, ai_resolution = {..., applied: true}
  WHERE id = :markId AND org_id = :orgId AND reviewed_at IS NULL AND ai_resolution IS NULL`.
  Si actualiza 0 filas, se escribe solo `ai_resolution` con `applied: false` (`WHERE ...
  AND ai_resolution IS NULL`). **Nunca** pisa `reviewed_*` previos (humano ni OMR).
- **Live, ruta `review`:** solo `ai_resolution` (`applied: false`).
- **Autoría:**
  - IA: `auto_resolved = true`, `reviewed_by_id IS NULL`, `ai_resolution->>'applied' = 'true'`;
  - OMR (auto-anulación): `auto_resolved = true`, `reviewed_by_id IS NULL`, `ai_resolution`
    nula o con `applied = false`;
  - humano: `reviewed_by_id IS NOT NULL`, `auto_resolved = false`.
- `resolveMark` y `correctConfirmedMark` (humanos) dejan `auto_resolved = false`, fijan
  `reviewed_by_id` y **no tocan** `ai_resolution`.
- `suggested_value` sigue siendo la sugerencia del OMR. `responses.scored_by` no cambia
  (`auto`): la fila de `responses` no distingue IA de OMR.
- `reviewPending` no cambia de fórmula: `finalizeBatch` corre después de la etapa y cuenta
  dudosas con `reviewed_at IS NULL`.

## C8. Qué ve cada quien

- **Alumno / apoderado:** nada. `aiResolution` y `ai_resolution` **nunca** salen por endpoints
  que no estén bajo `SHEET_REVIEW_ROLES`; `responses` y resultados no cambian de forma.
- **Profesor** (`ReviewMarkModel.aiResolution`, construido en `ScanReviewService.toReviewMarkModel`):
  - `null` si no hay `ai_resolution` o si `mode = 'shadow'`;
  - `applied = true` → `{ verdict: 'agree' | 'solo_a' | 'solo_b', value, agreement: 'both' | 'single' }`
    (`agree` → `both`; `solo_*` → `single`). Se muestra aunque un humano la haya corregido después;
  - `verdict = 'conflict'` y `applied = false` → `{ verdict: 'conflict', value: null, agreement: null }`
    ("Los modelos no coinciden");
  - cualquier otro caso (`audit_sample`, `vetoed`, `low_agreement`, `engine_failed`,
    `no_thresholds`, o `applied = false` con ruta `auto`) → `null`. La auditoría es ciega.
- **Textos de UI** (tuteo): callout "Resueltas automáticamente: N por IA, M dobles marcas
  evidentes. No requieren revisión; quedan al final de la lista por si quieres corregir
  alguna."; distintivos "IA: B (dos modelos coinciden)", "IA: en blanco (un modelo seguro)",
  "IA: nula (…)", "Doble marca evidente", "Los modelos no coinciden".

## C9. Corrección después de confirmar (PR 6)

- `GET /sheet-scan-batches/:id/corrections` (roles `SHEET_REVIEW_ROLES`): para un lote
  `confirmed`, devuelve `ReviewMarkModel[]` con todas las marcas dudosas
  (`multiple|ambiguous`) de escaneos no `superseded`, ya resueltas por quien sea, con su
  `aiResolution` según C8.
- `PATCH /sheet-scan-marks/:id/correction` (mismo `reviewMarkSchema`): `correctConfirmedMark`
  exige lote `confirmed`, actualiza la marca como decisión humana (C7), reescribe la fila de
  `responses` de ese alumno e ítem con la misma corrección que la ingesta y llama a
  `AssessmentResultsService.recalculateAnswerSheetResults`.
- Desvío del diseño: no existe hoy una "vista de la hoja del alumno"; el botón "Corregir" vive
  en la página del lote confirmado (`/hojas/lotes/[batchId]/revisar`), con filtro por alumno.

## C10. Reglas que valen para todos

- `apps/api`: sin comentarios ni JSDoc, `reportServerError` en los catch, helpers de un solo uso
  como métodos privados, sin `any`, toda query a tablas de tenant dentro de `withOrgContext` y
  con `tx`. Tests con `Database` falso (`01-testing.md`).
- `packages/decisions`: mantiene su estilo (con JSDoc).
- Texto en español con tuteo neutro.
