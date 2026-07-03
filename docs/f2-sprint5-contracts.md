# Contratos — Sprint F2-S5 (Integración, monetización y hardening)

> Último sprint de F2. Cierra las tres épicas (Análisis IA, IA Remedial, Benchmarking)
> detrás del tier pago, agrega observabilidad de costo IA, valida calidad y endurece.
>
> **Ejecución HÍBRIDA** (S5 no encaja con el fan-out completo — ver Filtro previo de la skill):
> - **H18.1 (Gating)** y **H18.2 (diferida)** las hace el orquestador **secuencial** sobre `sprint-f2-5`
>   (gating es transversal: cablea 3 controllers + 3 páginas existentes).
> - **H19.25 (Observabilidad)** es el único módulo aislable → **1 agente full-stack en worktree**.
> - **H20.12 (QA E2E)** es el gate final tras integrar.

---

## 0. Historias

| ID | Historia | Quién | Estado |
|---|---|---|---|
| **H18.1** | Gating de tier pago: `org.config.allowedFeatures` gobierna Análisis IA, IA Remedial y Benchmarking; guards API + UI | Orquestador (secuencial) | — |
| **H18.2** | Validación pedagógica humana (revisión de muestras + tuning de prompts) | **DIFERIDA** (sin `GEMINI_API_KEY`) | doc |
| **H19.25** | Observabilidad de costo/latencia IA: panel por org/tipo/modelo + presupuesto + alertas | **Agente A** (full-stack) | — |
| **H20.12** | QA E2E + hardening: flujo dato→insight→remedial→benchmark, typecheck+lint+tests verdes | Orquestador (gate final) | — |

---

## 1. Tipos compartidos (`@soe/types`) — YA COMMITEADOS en Fase 0

### `feature.schema.ts` (H18.1)
- `FEATURE_KEYS = ['ai_analysis','remedial','benchmarking']`, `FeatureKey`, `featureKeySchema`, `FEATURE_LABELS`.
- `orgConfigSchema` (`.passthrough()`): `{ allowedFeatures?: FeatureKey[]; aiBudgetUsd?: number|null }`.
- `isFeatureAllowed(config, feature)` → **default piloto: si `allowedFeatures` no está, devuelve `true`** (no rompe pilotos; el guard sigue activo). `platform_admin` se exime en el guard, no acá.
- `resolveAllowedFeatures(config)` → `FeatureKey[]`.
- Models: `orgFeaturesResponseSchema` = `{ orgId, allowedFeatures: FeatureKey[], aiBudgetUsd: number|null }`; `updateOrgFeaturesSchema` = `{ allowedFeatures: FeatureKey[], aiBudgetUsd?: number|null }`.

### `ai-observability.schema.ts` (H19.25)
- `aiCostSourceSchema` = `'ai_analysis' | 'remedial'`.
- `aiCostBucketSchema` = `{ key, label, count, totalCostUsd, inputTokens, outputTokens, avgLatencyMs: number|null }`.
- `aiObservabilitySummarySchema` = `{ orgId, from, to, totals: { count, totalCostUsd, inputTokens, outputTokens, avgLatencyMs, failedCount }, bySource[], byType[], byModel[] }`.
- `aiBudgetStatusSchema` = `{ orgId, month, monthSpendUsd, budgetUsd: number|null, pctUsed: number|null, alertLevel: 'ok'|'warning'|'over' }`.
- `aiCostTimeseriesResponseSchema` = `{ orgId, from, to, points: [{ date, costUsd, count }] }`.

### `access-policies.ts`
- `FEATURE_MANAGEMENT_ROLES = ['platform_admin']`.
- `AI_OBSERVABILITY_VIEWER_ROLES = ['platform_admin','school_admin','academic_director']`.

---

## 2. H19.25 — Observabilidad IA (AGENTE A · full-stack)

### Backend — nuevo módulo `apps/api/src/ai-observability/`
Archivos: `ai-observability.module.ts`, `ai-observability.controller.ts`, `ai-observability.service.ts`, `ai-observability.service.spec.ts`.

**Fuente de datos:** agrega filas YA persistidas de `aiAnalyses` y `remedialMaterials` (ambas en `@soe/db`; columnas `costUsd` decimal, `tokens` jsonb `{input,output}`, `model` text, `status`, `createdAt`, `startedAt`, `completedAt`, `analysisType`/`type`, `orgId`). **NO llama al LLM.**

**⚠️ RLS:** `ai_analyses` y `remedial_materials` están bajo RLS. **TODA** query corre dentro de
`withOrgContext(this.db, orgId, async (tx) => …)` usando `tx`, nunca `this.db` directo. Sin contexto → 0 filas.

**Endpoints** (controller `@Controller('ai-observability')`, `@UseGuards(RolesGuard)`, todos `@Roles(...AI_OBSERVABILITY_VIEWER_ROLES)`):

| Verbo + path | Query | Response Model |
|---|---|---|
| `GET /ai-observability/summary` | `from?`, `to?` (ISO date; default últimos 30 días) | `AiObservabilitySummary` |
| `GET /ai-observability/budget` | — (mes actual) | `AiBudgetStatus` |
| `GET /ai-observability/timeseries` | `from?`, `to?` (default 30 días) | `AiCostTimeseriesResponse` |

**Reglas de cálculo:**
- `costUsd` viene como `decimal` (string en Drizzle) → parsear con `Number(...)`, tratar `null` como 0.
- `tokens` jsonb puede ser null → tratar como `{input:0,output:0}`.
- `avgLatencyMs`: promedio de `completedAt - startedAt` (ms) **sólo** sobre filas con ambos timestamps y `status='completed'`; si no hay → `null`.
- `failedCount`: filas con `status='failed'` (ai_analyses) / `status='failed'` (remedial).
- `byType`: para ai_analysis usa `analysisType`; para remedial usa `type`. `label` legible (mapa simple).
- `byModel`: agrupa por `model` (string; null → label "desconocido").
- **Budget**: `monthSpendUsd` = suma de costo del mes calendario actual (ambas tablas). `budgetUsd` = `org.config.aiBudgetUsd` (leer `organizations` directo, sin RLS; usar `orgConfigSchema.safeParse`). `pctUsed = budget ? monthSpend/budget*100 : null`. `alertLevel`: sin budget → `'ok'`; `<80%` → `'ok'`; `80–100%` → `'warning'`; `>100%` → `'over'`.
- `orgId` SIEMPRE del token (`req.user.orgId` vía `getEffectiveOrgId`), nunca del query.
- Fechas de agrupación de la timeseries: agrupar por día (`YYYY-MM-DD`) en backend; rellenar días sin gasto con 0 es opcional (puedes omitir días vacíos, el front los maneja).

Registrar el módulo en `app.module.ts` lo hace el orquestador en integración — **el agente NO toca `app.module.ts`.**

### Frontend — nueva página `apps/web/src/app/(dashboard)/observabilidad-ia/`
- `page.tsx` (Server Component): `auth()` → `canAccess(roles, AI_OBSERVABILITY_VIEWER_ROLES)` → redirect si no. Fetch con `apiGet<AiObservabilitySummary>('/ai-observability/summary')`, `apiGet<AiBudgetStatus>('/ai-observability/budget')`, `apiGet<AiCostTimeseriesResponse>('/ai-observability/timeseries')`.
- Componentes en `components/`: tarjetas de totales (costo, tokens, latencia, fallidos), barra de presupuesto con color por `alertLevel`, tablas de desglose `bySource`/`byType`/`byModel`, y la serie temporal como **barras simples (divs Tailwind)** — NO agregar librería de charts nueva. Reusar patrón visual de `benchmarking/components/skill-heatmap.tsx` si sirve.
- Tipar TODO con los Models de `@soe/types` (no crear tipos locales). UI en español, responsive, montos con `Intl.NumberFormat` USD.
- **NO tocar** `nav-items.ts` ni `lib/api.ts` (el orquestador agrega el nav item en integración).

---

## 3. H18.1 — Gating (ORQUESTADOR, secuencial) — referencia

- `packages/types`: ya listo (feature.schema.ts).
- `apps/api/src/common/decorators/feature.decorator.ts`: `@RequireFeature(feature: FeatureKey)`.
- `apps/api/src/common/guards/feature.guard.ts`: `FeatureGuard` lee metadata + `org.config` por `orgId` (DB directo, org sin RLS) → `isFeatureAllowed`. `platform_admin` exento. 403 si no.
- Cablear `@UseGuards(RolesGuard, FeatureGuard)` + `@RequireFeature('ai_analysis'|'remedial'|'benchmarking')` en los 3 controllers (registrar `FeatureGuard` en providers de cada módulo).
- `organizations`: `GET /organizations/me/features` (auth) · `GET|PATCH /organizations/:orgId/features` (`FEATURE_MANAGEMENT_ROLES`).
- Web: gating en las 3 páginas (`analisis-ia`, `material-remedial`, `benchmarking`) con CTA de upgrade si la feature no está habilitada; helper `getAllowedFeatures()` en `lib`.

---

## 4. Archivos compartidos — NO tocar durante desarrollo paralelo
`apps/api/src/app.module.ts`, `apps/web/src/components/layout/nav-items.ts`, `apps/web/src/lib/api.ts`, `packages/types/src/schemas/index.ts`, `packages/types/src/access-policies.ts`. Los integra el orquestador en Fase 4.

## 5. Checklist de entrega — Agente A (H19.25)
- [ ] Módulo `ai-observability` (service + controller + module + spec ≥8 tests).
- [ ] 3 endpoints con response shapes EXACTOS a los Models.
- [ ] TODA query dentro de `withOrgContext` usando `tx`.
- [ ] `orgId` del token, nunca del query; soft-delete: filtrar `deletedAt IS NULL`.
- [ ] Roles vía `AI_OBSERVABILITY_VIEWER_ROLES` (sin roles inline).
- [ ] Página `/observabilidad-ia` tipada con Models, `canAccess`, responsive, español, sin charts lib nueva.
- [ ] `cd apps/api && npx tsc --noEmit` y `cd apps/web && npx tsc --noEmit` limpios.
- [ ] **COMMIT** antes de terminar.
