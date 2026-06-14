# Contratos — F2 · Sprint 2 (Análisis IA por-pregunta + calidad de instrumento + export)

> Rama: `sprint-f2-2` (desde `dev`, con S0+S1 ya mergeados). Construye sobre el motor IA
> (`apps/api/src/ai-analysis/`), el análisis de ítems determinista (`apps/api/src/item-analysis/`),
> el informe de evaluación (`apps/api/src/assessment-report/`) y el LLM provider-agnóstico
> (`apps/api/src/llm/`).

## 0. Contexto y reglas (LEER COMPLETO ANTES DE CODEAR)

- **Principio rector (CLAUDE.md §8.3):** la IA **razona sobre métricas deterministas**, no las
  calcula. Toda la psicometría (p, D, KR-20, punto-biserial, distribución de distractores) se
  computa en backend; la IA solo interpreta. La salida del modelo vive SOLO en `output`; nunca pisa
  datos deterministas.
- **NUNCA PII al LLM** (sin nombres ni RUT). Los snapshots solo llevan contenido del ítem + agregados.
- **Multi-tenancy (CLAUDE.md §5.2):** toda query a tablas con RLS (`ai_analyses`, `responses`,
  `assessment_results`, `students`, `assessments`) corre dentro de `withOrgContext(db, orgId, tx => …)`
  usando `tx`; el `orgId` proviene SIEMPRE del token (`user.orgId`), nunca del body/query.
- **Scoping por rol:** un profesor solo ve datos de sus cursos asignados (`teacher_assignments`); un
  directivo ve toda la org. Replicar el patrón de `ItemAnalysisService.getAccessibleClassGroupIds`.
- **Sin hardcodear "DIA"/"Lenguaje":** operar por IDs y por `type` de nodo/instrumento.
- **Roles:** usar SIEMPRE constantes de `@soe/types/access-policies` en los `@Roles(...)`. Nunca roles
  inline. Helpers `userHasAnyRole`/`canAccess`.
- **Contratos compartidos (Fase 0, en `@soe/types`, YA commiteados en `sprint-f2-2`):**
  - H20.8: `itemInsightOutputSchema` / `ItemInsightOutput` (+ `itemInsightQualityVerdictSchema`,
    `distractorReadingSchema`), `generateItemInsightSchema` / `GenerateItemInsightDto`, y el tipo
    `ItemInsightSnapshot`. (En `schemas/ai-analysis.schema.ts`.)
  - H20.9: `instrumentQualityResponseSchema` / `InstrumentQualityResponse` (+ `itemQualityModelSchema`,
    `itemQualityFlagSchema`, `instrumentReliabilityModelSchema`), `instrumentQualityQuerySchema` /
    `InstrumentQualityQueryDto`. (En `schemas/instrument-quality.schema.ts`.)
  - Roles: `AI_ANALYSIS_VIEWER_ROLES`, `AI_ANALYSIS_GENERATOR_ROLES` (ya existían),
    `INSTRUMENT_QUALITY_VIEWER_ROLES` (nuevo).

## 1. Endpoints

| Método | Ruta | Roles | Request → Response |
|---|---|---|---|
| `POST` | `/api/ai-analysis/items/:itemId/generate` | `AI_ANALYSIS_GENERATOR_ROLES` | body `GenerateItemInsightDto` → `{ analysisId: string, status: AiAnalysisStatus }` |
| `GET` | `/api/ai-analysis/:id` | `AI_ANALYSIS_VIEWER_ROLES` | **YA EXISTE** (S0/S1). Devuelve `AiAnalysisModel`; cuando `completed` y `analysisType='item_insight'`, `output` se valida en el front con `itemInsightOutputSchema`. |
| `GET` | `/api/instrument-quality` | `INSTRUMENT_QUALITY_VIEWER_ROLES` | query `InstrumentQualityQueryDto` (`assessmentId`, `classGroupId?`) → `InstrumentQualityResponse` |

**Response shapes exactos** = los Models Zod de `@soe/types` (sección 0). El backend DEBE retornar
exactamente esos campos; el frontend tipa con esos Models (sin tipos locales que los dupliquen).

## 2. Workstreams

### BE-1 — H20.8 · Análisis IA por-pregunta (multimodal) · dirs: `apps/api/src/llm/` + `apps/api/src/ai-analysis/`
**Dueño único** de `apps/api/src/llm/` y de `apps/api/src/ai-analysis/`. Nadie más toca esos dirs.

**A) Extensión multimodal del LLM (best-effort, sin romper el `complete()` de texto):**
- `T1` En `llm.types.ts`: agregar a `LlmCompletionRequest` un campo opcional
  `images?: Array<{ mimeType: string; data: string /* base64 */ }>`, y a `LlmProvider` un método
  OPCIONAL `completeMultimodal?(request): Promise<string>`.
- `T2` `LlmService.completeMultimodal(system, prompt, images, orgId?)`: resuelve config, usa
  `provider.completeMultimodal` si existe; si el provider no lo soporta o no hay imágenes, cae a
  `provider.complete` (degradación elegante). NO cambiar la firma de `complete()` (lo usan el runner
  de S1 y `ai-tagging`).
- `T3` Implementar `completeMultimodal` en `gemini.provider.ts`: el SDK `@google/genai`
  `generateContent` acepta `contents` como array de parts: `[{ text }, { inlineData: { mimeType,
  data } }, …]`. Mantener el patrón tolerante (tipado estructural local, sin romper si el SDK no
  está). `anthropic.provider.ts`: implementar también o dejar fallback a texto (documentarlo).

**B) Snapshot determinista por-pregunta:**
- `T4` `item-insight.snapshot.ts` (`ItemInsightSnapshotService` con puerto si conviene): construye un
  `ItemInsightSnapshot`. **Reusa `ItemAnalysisService.getQuestionAnalysis(user, itemId, { assessmentId,
  classGroupId })`** (de `apps/api/src/item-analysis/`, importa `ItemAnalysisModule`) para enunciado,
  alternativas + distribución, distractor dominante, correctKey, tags, `imageUrl`. Añade:
  - **psicometría** (`difficulty` p, `discrimination` D, `pointBiserial`): reusa
    `AssessmentReportService.getReport()` (busca el ítem por position) o computa con las funciones
    puras `kr20`/`pointBiserial` de `ai-analysis.metrics.ts`.
  - **pasaje**: `items.sectionId` → `instrument_sections` (`passageTitle`, `passageText`,
    `passageFormat`).
  - **imágenes**: `items.content.imageUrl` (source `'item'`) + `section_attachments.url` de la sección
    (source `'section'`). Solo URLs http(s) **fetcheables** (best-effort). Si solo hay `storageKey` S3
    sin `url`, OMITIR la imagen (no hay downloader S3 en F2).
  - `dominantDistractor`: la alternativa incorrecta más elegida.
  - **Sin PII.**
- `T5` `prompts/item-insight.prompt.ts`: `buildItemInsightPrompt(snapshot, audience)` → `{ system,
  prompt }` que pide a Gemini un JSON que cumpla `ItemInsightOutput` (por qué se obtuvo el resultado,
  misconcepción del distractor, lectura del pasaje/imagen si existen, veredicto de calidad, acciones).
  `promptVersion` nuevo (ej. `s2-item-insight-v1`).

**C) Job async + endpoint (reusa el patrón de S0/S1):**
- `T6` `item-insight.runner.ts` (`ItemInsightRunner.run(analysisId, orgId)`): markProcessing →
  leer `ai_analyses` (obtener `itemId`+`assessmentId` desde `input` jsonb) → snapshot → prompt →
  `llm.completeMultimodal(system, prompt, images, orgId)` (fetch de imágenes a base64 dentro del
  runner/snapshot) → parseo Zod ESTRICTO con `itemInsightOutputSchema` (tolerar fences) → markCompleted.
  Reusa `AiAnalysisService` (`markProcessing/markCompleted/markFailed`). Mantener timeout + try/catch
  (cualquier fallo → `failed`).
- `T7` Caché + creación: el `inputHash` para item_insight DEBE incluir `itemId` (además de
  assessmentId, analysisType='item_insight', audience, classGroupId). Persistir
  `input: { itemId, assessmentId }` en la fila `ai_analyses` (NO hay columna itemId en S2 — usar el
  jsonb `input`). Puedes generalizar `AiAnalysisService.create` (incluir `itemId` opcional en el hash
  y guardarlo en `input`) o agregar un método `createForItem`; **mantén verdes los tests de S1**.
- `T8` `item-insight.controller.ts` (`@Controller('ai-analysis')` o un controller propio):
  `POST items/:itemId/generate` con `@Roles(...AI_ANALYSIS_GENERATOR_ROLES)`, valida body con
  `generateItemInsightSchema`, crea/reusa-caché vía `AiAnalysisService`, si no es de caché encola con
  `JOB_DISPATCHER` el `ItemInsightRunner.run`. Responde `{ analysisId, status }`. El GET de polling es
  el `GET /api/ai-analysis/:id` existente (no duplicar).
- `T9` Registrar todo en `ai-analysis.module.ts` (importar `ItemAnalysisModule`; proveer el runner,
  snapshot service y el controller). **Esto SÍ lo hace BE-1** (es dueño del módulo).
- `T10` ≥8 tests: del runner (happy → output válido; no-JSON → failed; schema inválido → failed; sin
  imágenes → usa texto; con imágenes → llama completeMultimodal) con `LlmService`+snapshot mockeados;
  y del snapshot (reusa ItemAnalysisService mockeado, arma pasaje/imágenes, sin PII).
- **Verifica:** `cd apps/api && npx tsc --noEmit`; `pnpm --filter @soe/api test`.

**CA BE-1:** withOrgContext en toda query; sin PII al LLM; salida solo en `output`; roles por
constante; response shapes == Models; `tsc` limpio; tests S1 verdes.

### BE-2 — H20.9 · Calidad de instrumento e ítems (determinista) · dir: `apps/api/src/instrument-quality/` (NUEVO)
**Módulo nuevo, dueño único.** No toca `ai-analysis/` ni `llm/`. Importa cosas read-only.
- `T1` `instrument-quality.service.ts` (`InstrumentQualityService.getQuality(user, dto):
  Promise<InstrumentQualityResponse>`):
  - Scoping/multi-tenancy idéntico a `ItemAnalysisService` (org del token; profesor → solo sus cursos).
    Validar que la evaluación pertenece a la org y al scope.
  - **Psicometría por ítem:** reusa `AssessmentReportService.getReport()` (importa
    `AssessmentReportModule`) para `difficulty` (p, 0..100), `discrimination` (D), distractor
    dominante + su tasa. Para `pointBiserial` y **KR-20** usa las funciones puras `kr20`/`pointBiserial`
    de `apps/api/src/ai-analysis/ai-analysis.metrics.ts` (impórtalas; son puras y estables — BE-1 NO
    cambia su firma) construyendo la matriz correcto/incorrecto desde `responses`.
  - **Flags deterministas** (`itemQualityFlagSchema`), umbrales documentados en el código:
    `low_discrimination` (D<0.20), `ambiguous_key` (point-biserial<0.10 o negativo),
    `strong_distractor` (un distractor ≥ clave o >35%), `too_easy` (p>90%), `misaligned` (ítem sin tags).
  - **Sugerencias deterministas por flag** (plantillas en español; sin IA). Ej. `low_discrimination`
    → "Revisa si la pregunta discrimina entre niveles; considera reformular o reemplazar".
  - **Confiabilidad:** KR-20 + `interpretation` determinista por rangos (≥0.9 excelente, 0.8–0.9 buena,
    0.7–0.8 aceptable, 0.6–0.7 cuestionable, <0.6 pobre, null no calculable) + itemsAnalyzed/studentsAnalyzed.
  - `flaggedCount` = nº de ítems con ≥1 flag. **Sin N+1**: agrega con queries por lote.
- `T2` `instrument-quality.controller.ts`: `GET /api/instrument-quality`, `@Roles(...INSTRUMENT_QUALITY_VIEWER_ROLES)`,
  valida query con `instrumentQualityQuerySchema`, delega al service.
- `T3` `instrument-quality.module.ts`: importa `AssessmentReportModule` (+ DatabaseModule según patrón).
- `T4` ≥8 tests del service (mock DB / mock AssessmentReportService): cada flag se dispara con su
  umbral; KR-20 interpretación por rango; scoping profesor; sin PII en la respuesta; `tsc` limpio.
- **Verifica:** `cd apps/api && npx tsc --noEmit`; `pnpm --filter @soe/api test`.

**CA BE-2:** determinista (cero llamadas a LLM); withOrgContext; roles por constante; response shape ==
`InstrumentQualityResponse`; `tsc` limpio.

### FE-1 — H20.8 render (drill-down) + H20.10 export + H20.11 informe consolidado · dir: `apps/web/src/app/(dashboard)/analisis-ia/`
**Dueño único** del dir `analisis-ia/` (ya existe de S1). Extiéndelo; no toques otras rutas.
- `T1` **Drill-down por-pregunta (H20.8):** un modal/panel `'use client'` que, desde una pregunta
  (Top/Bottom 5 o un selector de ítems), dispara `POST /api/ai-analysis/items/:itemId/generate`
  (server action en `actions.ts`), hace **polling** con `GET /api/ai-analysis/:id` hasta `completed`,
  y renderiza el `ItemInsightOutput` (headline, performanceSummary, likelyCause, misconception,
  distractorAnalysis, passageInsight/visualInsight si no son null, itemQuality, recommendedActions,
  confidence, caveats). Tipar con `ItemInsightOutput`/`AiAnalysisModel` de `@soe/types`. Mostrar el
  pasaje/imagen del ítem si están (reusa el endpoint determinista de item-analysis si necesitas el
  contenido a mostrar). **Disclaimer visible** "sugerencia IA, validar".
- `T2` **Panel de calidad de instrumento (H20.9):** consume `GET /api/instrument-quality?assessmentId=…`
  (`apiGet<InstrumentQualityResponse>`). Muestra KR-20 + interpretación, tabla de ítems con sus flags
  (chips de color con tokens de Tailwind) y sugerencias. Tipar con `InstrumentQualityResponse`.
- `T3` **Export del análisis (H20.10):** botón `'use client'` que exporta a Excel (`xlsx`) y PDF
  (`jspdf` + `jspdf-autotable`) **del lado del cliente**, sin fetch extra (opera sobre los datos ya
  cargados). **Reusa el patrón** de `apps/web/src/app/(dashboard)/resultados/informe/report-export-button.tsx`
  (paleta, formateadores, dropdown). Exporta narrativa + Top/Bottom 5 + brechas + recomendaciones
  (del `AssessmentInsightsOutput` de S1) + calidad de instrumento.
- `T4` **Informe IA consolidado (H20.11):** una vista/sección que reúne en un documento único
  (exportable con el botón de T3): titular + narrativa adaptativa por rol + Top/Bottom 5 + brechas +
  recomendaciones + resumen de calidad de instrumento + las preguntas destacadas (las bottomItems con
  su diagnóstico de S1). Compartible con el equipo directivo.
- `T5` `canAccess(roles, AI_ANALYSIS_VIEWER_ROLES)` en la página (ya está de S1; el panel de calidad
  puede usar `INSTRUMENT_QUALITY_VIEWER_ROLES`). Server Components por defecto; `'use client'` solo en
  interactividad (modal, polling, export). UI en español, responsive mobile-first.
- **Verifica:** `cd apps/web && npx tsc --noEmit`.

**CA FE-1:** tipar TODO con Models de `@soe/types` (sin tipos locales que los dupliquen); `canAccess`
con constantes; usa `apiGet/apiPost` de `lib/api.ts`; export client-side reusando el patrón existente;
disclaimer IA visible; `tsc` limpio.

## 3. Archivos que SOLO toca integración (Fase 4 — NO los toquen los agentes)
- `apps/api/src/app.module.ts` (registrar `InstrumentQualityModule`).
- `apps/web/src/components/layout/nav-items.ts` (sin nav nuevo — `/analisis-ia` ya existe; revisar si
  hace falta enlazar la nueva sección).
- `apps/web/src/lib/api.ts`, `apps/web/.../layout.tsx` (compartidos).

> Nota: `ai-analysis.module.ts` lo edita BE-1 (es dueño del módulo). `app.module.ts` ya importa
> `AiAnalysisModule`, así que el endpoint de item-insight queda registrado sin tocar app.module.

## 4. Decisiones de diseño cerradas (de la consulta al usuario)
- **Multimodal:** método nuevo `completeMultimodal` (no se toca `complete()`); imágenes por url http(s)
  → base64; degradación a solo-texto si no hay url fetcheable.
- **H20.9 sugerencias:** 100% deterministas por flag (sin IA). BE-2 no depende del trabajo de BE-1.
- **itemId en `ai_analyses`:** se guarda en el jsonb `input` (sin migración en S2). Columna dedicada =
  extensión futura si se requiere listar insights por ítem.

## 5. Setup OBLIGATORIO de cada agente (worktree aislado)
El worktree del agente nace de `main`, NO de `sprint-f2-2`. PRIMERO, desde la raíz del repo del worktree:
1. Traer la base del sprint: árbol limpio → `git reset --hard sprint-f2-2`; con commits propios →
   `git merge sprint-f2-2 --no-edit`. Verifica con `git log --oneline -3` que ves el commit de
   contratos de `sprint-f2-2`.
2. `pnpm install` → `pnpm --filter @soe/types build` → `pnpm --filter @soe/db build`.
3. Recién entonces: leer este doc COMPLETO y codear.
4. **Commit obligatorio** antes de terminar (`git add -A && git commit -m "…"`), o el worktree se borra
   y se pierde todo.
