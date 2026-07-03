# Contratos — F2 · Sprint 1 (Informe IA de evaluación)

> Rama: `sprint-f2-1` (desde `dev`). Construye sobre el motor IA base de S0 (`apps/api/src/ai-analysis/`).
> S1 **enriquece el output y el prompt/snapshot**; la superficie HTTP (POST generate, GET /:id) ya
> existe de S0 y casi no cambia.

## 0. Contexto y reglas

- **Motor base (S0, ya en `dev`):** `ai-analysis.service.ts` (registro + caché por `inputHash` + estados),
  `ai-analysis.runner.ts` (ciclo async: markProcessing → LLM → Zod → markCompleted), `ai-analysis.controller.ts`
  (POST `/api/ai-analysis/assessments/:assessmentId/generate`, GET `/api/ai-analysis/:id`),
  `ai-analysis.module.ts` (importa `LlmModule` + `JobsModule`).
- **Principio rector:** la IA **razona sobre métricas deterministas**, no las calcula. Toda la psicometría
  (p, D, KR-20, distractores, % logro) se computa en backend; la IA solo interpreta. Salida SOLO en
  `output`. **NUNCA PII al LLM** (sin nombres ni RUT) — el snapshot ya viene anonimizado.
- **Multi-tenancy:** toda query a `ai_analyses` dentro de `withOrgContext`; `orgId` del token.
- **Contratos compartidos (Fase 0, en `@soe/types`, ya commiteados):**
  `assessmentInsightsOutputSchema` / `AssessmentInsightsOutput` (+ submodelos `ItemPracticeCard`,
  `ItemDiagnosisCard`, `SkillDiagnosis`, `AiRecommendation`), y el tipo `AiAnalysisSnapshot`
  (+ `SnapshotItem`, `SnapshotSkill`). Access-policies `AI_ANALYSIS_VIEWER_ROLES` /
  `AI_ANALYSIS_GENERATOR_ROLES` ya existen.

## 1. Endpoints (sin cambios de superficie; cambia el `output`)

| Método | Ruta | Notas |
|---|---|---|
| `POST` | `/api/ai-analysis/assessments/:assessmentId/generate` | Ya existe. Tras S1, al completar, `output` = `AssessmentInsightsOutput`. |
| `GET` | `/api/ai-analysis/:id` | Ya existe. `output` (cuando `completed`) se valida/parsea con `assessmentInsightsOutputSchema`. |

## 2. Flujo enriquecido (runner)

```
runner.run(analysisId, orgId):
  markProcessing
  → snapshot = SnapshotService.build(assessmentId, orgId, { classGroupId })   ← BE-1 (determinista, sin PII)
  → { system, prompt } = buildAssessmentInsightsPrompt(snapshot, audience)    ← BE-2
  → raw = LlmService.complete(system, prompt, orgId)
  → output = assessmentInsightsOutputSchema.parse(JSON)  (si falla → markFailed) ← BE-2
  → markCompleted(output, promptVersion, costo)
```

## 3. Workstreams

### BE-1 — Snapshot + métricas (H20.1) · dir: `apps/api/src/ai-analysis/`
Archivos PROPIOS: `ai-analysis.snapshot.ts` (+ `ai-analysis.metrics.ts` si conviene). NO toques
`runner.ts`, `service.ts`, `controller.ts`, `module.ts`.
- `T1` `SnapshotService.build(assessmentId, orgId, opts?): Promise<AiAnalysisSnapshot>` — **reusa
  `AssessmentReportService.getReport()`** (de `apps/api/src/assessment-report/`) para p, D, distractores,
  % logro por skill, cobertura evaluados/matriculados. Inyéctalo (importa `AssessmentReportModule`).
- `T2` métricas nuevas: **KR-20** (sobre la matriz correcto/incorrecto del instrumento), **punto-biserial**
  por ítem, **cobertura blueprint** (ítems por nodo vs esperado de `item_taxonomy_tags`).
- `T3` ensambla `AiAnalysisSnapshot` (incluye `studentsBelowThreshold` determinista para
  `remedialGroupSize`). **Sin PII**: nada de nombres/RUT; solo agregados + contenido de ítems (stem).
- `T4` ≥8 tests (mock DB / mock AssessmentReportService). CA: `withOrgContext`, sin PII, números deterministas, `tsc` limpio.

### BE-2 — Prompt + output + rewire del runner (H20.2–H20.5) · dir: `apps/api/src/ai-analysis/`
Archivos PROPIOS: `prompts/` (builder) + **reescribe `ai-analysis.runner.ts`**. NO toques `snapshot.ts`
(consúmelo por su **tipo** `AiAnalysisSnapshot` + inyección del `SnapshotService`; el wiring del module
lo hace integración).
- `T1` `prompts/assessment-insights.prompt.ts`: **un solo prompt** que recibe el `AiAnalysisSnapshot` +
  `audience` y pide a Gemini un JSON que cumpla `AssessmentInsightsOutput`. Cubre: narrativa adaptativa
  director/profesor (H20.2), **Top/Bottom 5** con causa raíz (H20.3), brechas por habilidad
  distractor→misconcepción→estrategia (H20.4), recomendaciones priorizadas (H20.5). `promptVersion` nuevo (ej. `s1-insights-v1`).
- `T2` parseo Zod ESTRICTO con `assessmentInsightsOutputSchema` (tolera fences); si no cumple → el runner marca `failed`.
- `T3` rewire `runner.run`: inyecta `SnapshotService` (por tipo/DI), llama snapshot→prompt→LLM→parse. Mantiene timeout + try/catch de S0.
- `T4` ≥8 tests con `LlmService` y `SnapshotService` mockeados (happy path → output válido; salida no-JSON → failed; schema inválido → failed; audiencia director vs profesor). CA: salida solo en `output`, sin PII, `tsc` limpio.

### FE-1 — UI `/analisis-ia` (H20.6, H20.7 + render H20.2–H20.5) · dir: `apps/web/src/app/(dashboard)/analisis-ia/`
- `T1` Página (Server Component): si no hay análisis → botón "Generar"; durante `pending/processing` →
  feedback con polling (`GET /:id`); al `completed` → render. Usa `apiGet`/`apiPost` de `lib/api.ts` y
  server actions en `actions.ts`. Recibe `?assessmentId=`.
- `T2` Tarjetas por sección tipadas con `AssessmentInsightsOutput`: headline + narrativa **adaptativa por
  `activeRole`** (director ve `executiveSummary.director` + recomendaciones de gestión; profesor ve
  `teacher` + accionable), **Top 5** (`topItems`) y **Bottom 5** (`bottomItems`), brechas (`skillGaps`),
  recomendaciones (`recommendations`). Componentes en `analisis-ia/components/`.
- `T3` `reliability.kr20` + `confidence` + `caveats` + **disclaimer visible** "sugerencia IA, validar" +
  acciones regenerar (`force:true`) / descartar (H20.7).
- `T4` `canAccess(roles, AI_ANALYSIS_VIEWER_ROLES)` en la página; tipar TODO con Models de `@soe/types`
  (no tipos locales). CA: responsive mobile-first, UI en español, `tsc` limpio.
- NO toques `nav-items.ts` ni el enlace desde el Informe (integración los agrega).

## 4. Archivos que SOLO toca integración (Fase 4)
`apps/api/src/ai-analysis/ai-analysis.module.ts` (registrar `SnapshotService` + `AssessmentReportModule`),
`apps/web/src/components/layout/nav-items.ts`, y el enlace desde el Informe de Evaluación.

## 5. Setup de agente
Cada agente: `git reset --hard sprint-f2-1` → `pnpm install` → build de `@soe/types` y `@soe/db` →
leer este doc → codear → **commit obligatorio** antes de terminar.
