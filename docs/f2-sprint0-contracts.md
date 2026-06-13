# Contratos y Plan de Implementación — F2 · Sprint 0 (Cimientos)

> Rama: `sprint-f2-0` (desde `dev`). Doc de planificación: `docs/Sprints/Planificación F2.md`.
> Este documento es a la vez el **contrato compartido** (lo que todos compilan) y el **plan de
> ejecución** (workstreams, tickets, delegación a agentes, integración, E2E).

---

## 0. Resumen ejecutivo

S0 entrega 4 habilitadores de infraestructura para F2, **todos detrás de puertos** para no acoplar las
épicas de producto y poder migrar a infra pesada (BullMQ, pgvector, CQRS) sin reescritura:

| Historia | Entregable | Puerto / Tabla |
|---|---|---|
| **H19.20** | Despacho async in-process + reaper de colgados | `JobDispatcher` (puerto) |
| **H19.21** | Recuperación curricular estructurada | `CurriculumRetriever` (puerto) |
| **H19.23** | Motor IA base (registro + caché + runner sobre `LlmService` existente) | tabla `ai_analyses` |
| **H19.24** | Participación en benchmarking | tabla `org_benchmark_settings` |

**Hallazgo clave:** el módulo `apps/api/src/llm/` **ya existe** (`LlmService.complete(system, prompt, orgId)`,
multi-proveedor Gemini/Claude, config por org). H19.23 lo **reutiliza**; solo añade persistencia,
caché por `input_hash`, `prompt_version`, parseo Zod del output y trazado de costo.

**Estrategia de paralelización:** la **Fase 0 (contratos)** la hace el orquestador secuencialmente y se
commitea a `sprint-f2-0`. Luego **4 agentes backend** trabajan en directorios disjuntos compilando
contra esos contratos. No hay frontend en S0. Integración y E2E al final.

---

## 1. Contratos — Fase 0 (orquestador, antes de los agentes)

Todo lo de esta sección se crea y **commitea a `sprint-f2-0`** antes de lanzar agentes.

### 1.1 Enum nuevo — `packages/db/src/schema/enums.ts`

```typescript
export const aiAnalysisStatusEnum = pgEnum('ai_analysis_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);
```

### 1.2 Tabla `ai_analyses` — `packages/db/src/schema/ai-analyses.ts`

Sirve a la vez de **registro de job async** (status) y de **caché** (input_hash). `analysisType` y
`audience` quedan como `text` (Open/Closed: nuevos tipos sin migración). RLS por `org_id`.

```typescript
import { decimal, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { aiAnalysisStatusEnum } from './enums';
import { organizations } from './organizations';
import { assessments } from './assessments';

export const aiAnalyses = pgTable('ai_analyses', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id').references(() => assessments.id, { onDelete: 'cascade' }),
  classGroupId: uuid('class_group_id'),
  analysisType: text('analysis_type').notNull(),            // 'assessment_insights' | 'item_analysis' | …
  audience: text('audience').notNull().default('general'),  // 'general' | 'director' | 'teacher'
  status: aiAnalysisStatusEnum('status').notNull().default('pending'),
  model: text('model'),
  promptVersion: text('prompt_version'),
  inputHash: text('input_hash'),                            // clave de caché
  input: jsonb('input').$type<Record<string, unknown>>(),   // snapshot (auditoría, sin PII)
  output: jsonb('output').$type<Record<string, unknown>>(), // salida tipada (validada con Zod en runtime)
  tokens: jsonb('tokens').$type<{ input: number; output: number }>(),
  costUsd: decimal('cost_usd', { precision: 10, scale: 6 }),
  error: text('error'),
  createdById: uuid('created_by_id'),
  startedAt: timestamp('started_at'),                       // para el reaper (detectar colgados)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),                       // "descartar" análisis
});

export const aiAnalysesRelations = relations(aiAnalyses, ({ one }) => ({
  org: one(organizations, { fields: [aiAnalyses.orgId], references: [organizations.id] }),
  assessment: one(assessments, { fields: [aiAnalyses.assessmentId], references: [assessments.id] }),
}));

export type AiAnalysis = typeof aiAnalyses.$inferSelect;
export type NewAiAnalysis = typeof aiAnalyses.$inferInsert;
```

Índices: `(org_id, assessment_id, analysis_type, audience)` (última versión) y `(input_hash)` (caché).
Declararlos en el tercer argumento de `pgTable` siguiendo el patrón de `responses.ts`.

### 1.3 Tabla `org_benchmark_settings` — `packages/db/src/schema/benchmark.ts`

Una fila por org (`unique(orgId)`). **Guarda solo lo que NO se deriva.** La red/sostenedor se obtiene
de `organizations.parent_id` (no se re-almacena). RLS por `org_id`.

```typescript
import { boolean, pgTable, timestamp, uuid, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';

export const orgBenchmarkSettings = pgTable(
  'org_benchmark_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    optOutGlobalPool: boolean('opt_out_global_pool').notNull().default(false), // opt-out: participa por defecto
    consentGrantedAt: timestamp('consent_granted_at'),
    consentGrantedById: uuid('consent_granted_by_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.orgId)],
);

export const orgBenchmarkSettingsRelations = relations(orgBenchmarkSettings, ({ one }) => ({
  org: one(organizations, { fields: [orgBenchmarkSettings.orgId], references: [organizations.id] }),
}));

export type OrgBenchmarkSettings = typeof orgBenchmarkSettings.$inferSelect;
export type NewOrgBenchmarkSettings = typeof orgBenchmarkSettings.$inferInsert;
```

Exportar ambos archivos en `packages/db/src/schema/index.ts`.

### 1.4 RLS — `packages/db/sql/rls-policies.sql` (añadir)

Ambas tablas tienen `org_id` directo → política directa (patrón existente):

```sql
ALTER TABLE "ai_analyses"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_analyses"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "org_benchmark_settings"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_benchmark_settings"  FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_analyses_tenant_isolation" ON "ai_analyses";
CREATE POLICY "ai_analyses_tenant_isolation" ON "ai_analyses"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));

DROP POLICY IF EXISTS "org_benchmark_settings_tenant_isolation" ON "org_benchmark_settings";
CREATE POLICY "org_benchmark_settings_tenant_isolation" ON "org_benchmark_settings"
  AS PERMISSIVE FOR ALL
  USING (org_id::text = current_setting('app.current_org_id', true));
```

> El reaper de jobs (H19.20) actualiza `ai_analyses` **dentro de `withOrgContext`** por org, o corre con
> el rol admin/migrate fuera de RLS para el barrido global de colgados. Decisión: el reaper barre por
> org conocido (itera orgs con jobs `processing`), simple y respeta RLS. Documentar en el módulo.

### 1.5 Migración

`pnpm db:generate` (genera el SQL de las 2 tablas + enum). Revisar. `db:migrate` reaplica `rls-policies.sql`.

### 1.6 Tipos y Zod compartidos — `packages/types/src/schemas/`

**`ai-analysis.schema.ts`** (S0 = DTOs de job + status; el `AssessmentInsightsOutput` rico es de S1):

```typescript
import { z } from 'zod';

export const aiAnalysisStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
export type AiAnalysisStatus = z.infer<typeof aiAnalysisStatusSchema>;

export const generateAnalysisSchema = z.object({
  analysisType: z.string().min(1).default('assessment_insights'),
  audience: z.enum(['general', 'director', 'teacher']).default('general'),
  classGroupId: z.string().uuid().optional(),
  force: z.boolean().default(false), // ignora caché por input_hash
});
export type GenerateAnalysisDto = z.infer<typeof generateAnalysisSchema>;

// Response Model (job)
export type AiAnalysisModel = {
  id: string;
  orgId: string;
  assessmentId: string | null;
  analysisType: string;
  audience: string;
  status: AiAnalysisStatus;
  model: string | null;
  promptVersion: string | null;
  output: Record<string, unknown> | null;
  costUsd: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};
```

**`benchmark-settings.schema.ts`:**

```typescript
import { z } from 'zod';

export const updateBenchmarkSettingsSchema = z.object({
  optOutGlobalPool: z.boolean(),
});
export type UpdateBenchmarkSettingsDto = z.infer<typeof updateBenchmarkSettingsSchema>;

export type BenchmarkSettingsModel = {
  orgId: string;
  optOutGlobalPool: boolean;
  consentGrantedAt: string | null;
  // Derivado de organizations.parent_id (NO almacenado):
  networkOrgId: string | null;   // la foundation/sostenedor, si tiene
  updatedAt: string;
};
```

**`curriculum-context.schema.ts`** (tipos de retorno del `CurriculumRetriever`):

```typescript
export type TaxonomyNodeRef = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: string;          // 'learning_objective' | 'axis' | 'descriptor' | …
};

export type TaggedItemRef = {
  itemId: string;
  position: number | null;
  type: string;          // item_type
  stem: string | null;   // extraído de content para few-shot
};

export type CurriculumContext = {
  node: TaxonomyNodeRef;
  ancestors: TaxonomyNodeRef[];   // de raíz → padre (eje, dominio)
  descriptors: TaxonomyNodeRef[]; // hijos directos
  siblings: TaxonomyNodeRef[];    // mismo parent_id
  taggedItems: TaggedItemRef[];   // ítems etiquetados a este nodo
};
```

Exportar los 3 en `packages/types/src/schemas/index.ts`.

### 1.7 Access policies — `packages/types/src/access-policies.ts` (añadir)

```typescript
export const AI_ANALYSIS_VIEWER_ROLES: readonly UserRole[] = [
  'platform_admin', 'school_admin', 'academic_director', 'eval_coordinator', 'teacher',
];
export const AI_ANALYSIS_GENERATOR_ROLES: readonly UserRole[] = [
  'platform_admin', 'school_admin', 'academic_director', 'eval_coordinator',
];
export const BENCHMARK_SETTINGS_ROLES: readonly UserRole[] = [
  'platform_admin', 'school_admin',
];
```

### 1.8 Interfaces de puertos (backend) — committeadas en Fase 0

**`apps/api/src/jobs/job-dispatcher.ts`** (interface + token; la impl la añade el Agente A):

```typescript
export interface EnqueuedJob {
  id: string;                  // id del registro de dominio (p.ej. ai_analyses.id)
  kind: string;                // 'ai_analysis' (routing/métricas)
  run: () => Promise<void>;    // unidad de trabajo
}

export interface JobDispatcher {
  enqueue(job: EnqueuedJob): void;   // dispara async; respeta límite de concurrencia global
}

export const JOB_DISPATCHER = 'JOB_DISPATCHER';
```

**`apps/api/src/curriculum-retriever/curriculum-retriever.ts`** (interface + token; impl Agente B):

```typescript
import type { CurriculumContext } from '@soe/types';

export interface CurriculumRetriever {
  getContext(nodeId: string): Promise<CurriculumContext>;
}

export const CURRICULUM_RETRIEVER = 'CURRICULUM_RETRIEVER';
```

### 1.9 Commit de Fase 0

```
feat(types): definir contratos F2-S0 — schemas Zod, models, puertos y access policies
```
(incluye packages/db, packages/types, los 2 archivos de interface en apps/api, la migración y el RLS).
Verificar: `pnpm --filter @soe/types build && pnpm --filter @soe/db build`.

---

## 2. Análisis de dependencias

```
FASE 0 (contratos) ─┬─▶ A · JobDispatcher impl      (apps/api/src/jobs/)
                    ├─▶ B · CurriculumRetriever impl (apps/api/src/curriculum-retriever/)
                    ├─▶ C · Motor IA base            (apps/api/src/ai-analysis/)
                    └─▶ D · Benchmark settings        (apps/api/src/benchmark-settings/)

Acoplamientos (resueltos por contrato, NO por código):
- C usa el interface JobDispatcher (Fase 0) → DI bindea la impl de A en integración.
- C reutiliza LlmService (módulo `llm/` existente) — solo lo inyecta.
- A (reaper) lee la tabla ai_analyses (schema de Fase 0) — data-coupling, no importa el service de C.
- D usa las constantes de access-policies (Fase 0).
Todos los archivos compartidos (app.module.ts, schema/index, types/index, access-policies, rls) → Fase 0 + Fase 4.
```

**Resultado: las 4 corren en paralelo.** Cada agente toca un directorio nuevo y disjunto.

---

## 3. Workstreams, tickets y criterios de aceptación

### Agente A — H19.20 · JobDispatcher (`apps/api/src/jobs/`)
**Tickets:** T1 `InProcessJobDispatcher implements JobDispatcher` con **semáforo de concurrencia**
(límite configurable, p.ej. `JOB_MAX_CONCURRENCY`, default 4) · T2 `JobReaper` (tarea programada con
`@nestjs/schedule` o `setInterval` simple) que marca `ai_analyses` en `processing` con
`startedAt` más viejo que `JOB_STALE_MINUTES` (default 10) como `failed` con `error='stale_timeout'`,
iterando por org dentro de `withOrgContext` · T3 `JobsModule` (provee `JOB_DISPATCHER`, exporta) ·
T4 tests (≥8): respeta el cap de concurrencia, captura errores del `run`, el reaper marca colgados.
**Criterios:** CA1 enqueue ejecuta async sin bloquear · CA2 nunca corren más de N jobs a la vez ·
CA3 un `run` que lanza error no tumba el proceso y queda registrable · CA4 reaper idempotente ·
CA7 `tsc --noEmit` limpio.

### Agente B — H19.21 · CurriculumRetriever (`apps/api/src/curriculum-retriever/`)
**Tickets:** T1 `StructuredCurriculumRetriever implements CurriculumRetriever` · T2 traversal:
nodo + ancestros (subir por `parent_id` hasta raíz) + descriptores (hijos directos) + hermanos
(mismo `parent_id`) + ítems vía `item_taxonomy_tags` (extraer `stem` de `items.content`) ·
T3 `CurriculumRetrieverModule` (provee `CURRICULUM_RETRIEVER`, exporta) · T4 tests (≥8).
**Criterios:** CA1 `getContext(nodeId)` devuelve el `CurriculumContext` completo y tipado ·
CA2 nodo inexistente → `NotFoundException` · CA3 nodo raíz → `ancestors: []` sin romper ·
CA4 **no** hardcodea "DIA"/"Lenguaje": opera por taxonomía · CA5 `taxonomy_nodes`/`items`/
`item_taxonomy_tags` NO están bajo RLS → query directa, sin `withOrgContext` · CA7 `tsc` limpio.

### Agente C — H19.23 · Motor IA base (`apps/api/src/ai-analysis/`)
**Tickets:** T1 `AiAnalysisService`: `create` (inserta `pending` en `withOrgContext`), `findByHash`
(caché), `get`, `markProcessing/Completed/Failed` · T2 `AiAnalysisRunner`: envuelve **`LlmService`**
(inyectado del módulo `llm/` existente) añadiendo `promptVersion`, parseo **Zod** del output (si no
parsea → `failed` con `error`), y trazado de `costUsd`/`tokens` · T3 `AiAnalysisController`:
`POST /ai-analysis/assessments/:id/generate` (crea registro, encola vía `JOB_DISPATCHER`, responde
`{ analysisId, status }`; si hay caché válida y no `force`, la devuelve), `GET /ai-analysis/:id`
(poll) · T4 `AiAnalysisModule` (importa `LlmModule` y `JobsModule` por DI del puerto) · T5 tests (≥8).
**Criterios:** CA1 respuestas = `AiAnalysisModel` del contrato · CA2 **multi-tenancy**: todas las
queries a `ai_analyses` dentro de `withOrgContext`, `orgId` del token (no del body) · CA3 caché por
`input_hash` evita regenerar salvo `force` · CA4 salida siempre en `output`, nunca pisa datos
deterministas · CA5 guards con `AI_ANALYSIS_GENERATOR_ROLES`/`AI_ANALYSIS_VIEWER_ROLES` de
access-policies (no inline) · CA6 sin PII al `LlmService` · CA7 `tsc` limpio. **Para S0 el runner
puede usar un `analysisType` de prueba** (el prompt/output rico de evaluación es S1); el objetivo es
el ciclo `pending→processing→completed` real con `LlmService`.

### Agente D — H19.24 · Benchmark settings (`apps/api/src/benchmark-settings/`)
**Tickets:** T1 `BenchmarkSettingsService`: `getForOrg` (lee/crea fila por org; deriva `networkOrgId`
desde `organizations.parent_id` cuando el padre es `foundation`), `update` (set `optOutGlobalPool`,
sella consentimiento) · T2 `BenchmarkSettingsController`: `GET /benchmark-settings`,
`PATCH /benchmark-settings` (sobre la org del token) · T3 `BenchmarkSettingsModule` · T4 tests (≥8).
**Criterios:** CA1 respuestas = `BenchmarkSettingsModel` · CA2 multi-tenancy: `org_benchmark_settings`
bajo `withOrgContext`, `orgId` del token · CA3 `networkOrgId` se **deriva**, no se almacena ·
CA5 guard con `BENCHMARK_SETTINGS_ROLES` · CA7 `tsc` limpio.

> Cada prompt de agente incluye, **textual**, el bloque SETUP de la skill (merge/reset `sprint-f2-0` +
> `pnpm install` + build de `@soe/types` y `@soe/db`) y la **instrucción de commit obligatoria**.

---

## 4. Fase 3 — Auditoría

Un solo agente de auditoría backend (read-only) con el checklist de la skill, enfatizando para S0:
multi-tenancy/`withOrgContext` (C y D), roles desde access-policies (no inline), salida IA solo en
`output`, sin PII al LLM, ≥8 tests por service, `tsc` limpio. (Sin auditoría frontend — no hay UI.)

## 5. Fase 4 — Integración (orquestador, en `sprint-f2-0`)

1. Merge de las 4 ramas de agente a `sprint-f2-0` (orden: A, B, D, luego C que depende del puerto de A).
2. **Wiring DI** en `app.module.ts`: registrar `JobsModule`, `CurriculumRetrieverModule`,
   `AiAnalysisModule`, `BenchmarkSettingsModule`. Bindear `JOB_DISPATCHER`→`InProcessJobDispatcher` y
   `CURRICULUM_RETRIEVER`→`StructuredCurriculumRetriever` (providers con `provide`/`useClass`).
3. `pnpm db:migrate` (crea tablas + RLS). `pnpm typecheck && pnpm --filter @soe/api test && pnpm lint` → 0 errores.
4. Commit: `feat(f2-s0): integrar cimientos F2 — jobs, curriculum-retriever, motor IA, benchmark-settings`.

## 6. Fase 5 — Validación E2E (criterio de salida de S0)

- `JobDispatcher`: encolar un job trivial → corre async respetando concurrencia; un job que excede el
  timeout queda `failed` por el reaper.
- `CurriculumRetriever.getContext(nodeId)` sobre un nodo seedeado devuelve nodo + ancestros +
  descriptores + ítems etiquetados.
- `POST /ai-analysis/assessments/:id/generate` → `ai_analyses` pasa `pending→processing→completed` con
  un `LlmService` real (o stub si no hay API key) y salida parseada por Zod; segundo llamado con mismo
  `input_hash` devuelve la caché.
- `PATCH /benchmark-settings` setea `optOutGlobalPool`; `GET` devuelve el modelo con `networkOrgId`
  derivado. Smoke de guards: endpoints sin auth → 401.

## 7. Decisiones tomadas en este plan (registrar)

- **Reaper por-org dentro de `withOrgContext`** (no un barrido global que bypassa RLS).
- **Sin tabla `jobs` genérica en S0**: el `JobDispatcher` despacha funciones in-process; el estado vive
  en la tabla de dominio (`ai_analyses`). Si surgen más tipos de job, se evalúa una tabla genérica
  (sigue siendo cambio detrás del puerto). 
- **H19.23 reutiliza `LlmService`** del módulo `llm/` existente (no crea provider Gemini).
- `analysisType`/`audience` como `text` (extensible sin migración).

---

_Generado: 2026-06-12 · Contratos + plan de ejecución de F2-S0._
