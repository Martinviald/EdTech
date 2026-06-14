# Contratos — F2 · Sprint 3 (IA Remedial / RAG)

> Rama `sprint-f2-3` (desde `dev`, con S0–S2 mergeados). Cierra el ciclo
> "resultado → acción": desde una brecha diagnosticada (node_id), genera material
> remedial pedagógicamente válido con RAG (recuperación curricular estructurada),
> con aprobación humana.

## 0. Contexto y reglas (LEER COMPLETO ANTES DE CODEAR)

- **Principio rector (CLAUDE.md §8.3):** la IA **propone**, el humano **aprueba**. El material se
  genera async (`pending→processing→ready`), entra en **borrador (`ready`)** y un humano lo
  **aprueba** (`approved`) o **descarta** (`discarded`).
- **RAG = recuperación curricular ESTRUCTURADA**, NO embeddings. Se usa el `CurriculumRetriever` de S0
  (`apps/api/src/curriculum-retriever/`, token `CURRICULUM_RETRIEVER`): `getContext(nodeId)` →
  `CurriculumContext` { node, ancestors, descriptors, siblings, taggedItems }. Anti-alucinación:
  inyectar el OA real + descriptores + ítems etiquetados en el prompt.
- **NUNCA PII al LLM** (sin nombres ni RUT). Para `group_plan` (H9.4) la **agrupación de alumnos es
  determinista en backend**; la IA solo etiqueta el grupo en abstracto (`groupLabel`, `studentCount`).
- **Multi-tenancy/RLS (CLAUDE.md §5.2):** toda query a `remedial_materials` (y a `responses`,
  `students`, `assessment_results`, `items` cuando aplique) corre dentro de
  `withOrgContext(db, orgId, tx => …)` usando `tx`. `orgId` SIEMPRE del token.
- **Async (CLAUDE.md §12):** la generación corre vía el `JOB_DISPATCHER` (puerto de S0,
  `apps/api/src/jobs/`), igual que el runner de `ai-analysis`. Caché por `inputHash`.
- **Roles:** usar SIEMPRE constantes de `@soe/types/access-policies`: `REMEDIAL_VIEWER_ROLES`,
  `REMEDIAL_GENERATOR_ROLES`, `REMEDIAL_APPROVER_ROLES`. Nunca roles inline.
- **Sin hardcodear "DIA"/"Lenguaje".** Sin `any`. TypeScript strict.

### Contratos compartidos (Fase 0, YA commiteados en `sprint-f2-3`)
- **DB:** tabla `remedial_materials` (polimórfica: `type` + `content JSONB` + `status`), enums
  `remedial_material_type` / `remedial_status`, RLS `remedial_materials_tenant_isolation`, migración
  `0003_chief_pete_wisdom.sql`. Tipos Drizzle `RemedialMaterial` / `NewRemedialMaterial` de `@soe/db`.
- **`@soe/types` (`remedial.schema.ts`):** `remedialMaterialTypeSchema`, `remedialStatusSchema`;
  contenidos `remedialGuideContentSchema` / `remedialPracticeContentSchema` / `remedialPlanContentSchema`
  + `remedialContentSchema` (unión) + `validateRemedialContent(type, content)`; Model
  `remedialMaterialModelSchema` / `RemedialMaterialModel`; `remedialListResponseSchema`; DTOs
  `generateRemedialSchema`, `remedialListQuerySchema`, `reviewRemedialSchema`.
- **Roles:** `REMEDIAL_VIEWER_ROLES` / `REMEDIAL_GENERATOR_ROLES` / `REMEDIAL_APPROVER_ROLES`.

## 1. Endpoints

| Método | Ruta | Roles | Request → Response |
|---|---|---|---|
| `POST` | `/api/remedial/generate` | `REMEDIAL_GENERATOR_ROLES` | body `GenerateRemedialDto` → `{ materialId: string, status: RemedialStatus }` |
| `GET` | `/api/remedial/:id` | `REMEDIAL_VIEWER_ROLES` | → `RemedialMaterialModel` (polling del estado/salida) |
| `GET` | `/api/remedial` | `REMEDIAL_VIEWER_ROLES` | query `RemedialListQueryDto` → `RemedialListResponse` (banco de material) |
| `PATCH` | `/api/remedial/:id/review` | `REMEDIAL_APPROVER_ROLES` | body `ReviewRemedialDto` (`approve`/`discard` + `content?` editado) → `RemedialMaterialModel` |

Response shapes EXACTOS = los Models Zod de `@soe/types`. El backend retorna exactamente esos campos;
el frontend tipa con esos Models (sin tipos locales que los dupliquen).

## 2. Workstreams

### BE — Módulo remedial completo (H9.1–H9.5) · dir: `apps/api/src/remedial/` (NUEVO, dueño único)
Eres dueño único de `apps/api/src/remedial/`. Importa cosas read-only de otros módulos; NO los edites.

**T1 — Base service + tenancy + caché (foundation).** `remedial.service.ts`:
- `create(user, dto)`: calcula `inputHash` determinista de `{type, nodeId, classGroupId, itemCount}`;
  si hay fila cacheable (`ready`/`approved`, no `force`) la reusa (`fromCache`); si no, inserta `pending`
  y devuelve `{ material, fromCache }`. Persiste `createdById`. Todo en `withOrgContext` con `tx`.
- `get(user, id)`, `list(user, query)` (paginado `{data,total,page,limit}`, filtra `deletedAt IS NULL`).
- `markProcessing/markReady/markFailed(id, orgId, …)` (mismo patrón que `AiAnalysisService`). `markReady`
  guarda `content` (validado con `validateRemedialContent`), `model`, `promptVersion`, `tokens`, `costUsd`,
  `input` (contexto RAG, auditoría, sin PII).
- `toModel(row)`: arma `RemedialMaterialModel` (incluye `nodeName` joineado de `taxonomy_nodes`).

**T2 — RAG context assembler (H9.1).** `remedial-context.service.ts`:
- Inyecta `CURRICULUM_RETRIEVER` (`CurriculumRetriever.getContext(nodeId)`).
- Ensambla un objeto de contexto curricular para el prompt: OA objetivo (code/name/description) +
  ancestros (eje/dominio) + descriptores/hijos + hermanos + few-shot de ítems etiquetados (`taggedItems`).
  Devuelve un tipo interno (no hace falta exponerlo en `@soe/types`).

**T3 — Generador guía de reenseñanza (H9.2).** `generators/guide.generator.ts`:
- Prompt (`prompts/guide.prompt.ts`, `promptVersion='s3-guide-v1'`) con el contexto RAG inyectado →
  Gemini → JSON que cumple `remedialGuideContentSchema` (parseo Zod estricto, tolera fences).
- Material genérico por OA → cacheable (la caché por `inputHash` ya lo cubre, per-tenant en S3).

**T4 — Generador ítems de práctica (H9.3).** `generators/practice.generator.ts`:
- Prompt (`prompts/practice.prompt.ts`, `promptVersion='s3-practice-v1'`) → Gemini → N ítems nuevos.
- **Cada ítem se valida con `validateItemContent(type, content)` de `@soe/types` y se INSERTA en la tabla
  `items`** con `source='ai_generated'`, `status='draft'`, `orgId`, `instrumentId=null` (banco), y se
  etiqueta al `nodeId` en `item_taxonomy_tags` (`taggedBy='ai'`). **Batch insert** (`.values([...])`, no en loop).
- El `content` del material (`remedialPracticeContentSchema`) guarda las **referencias** (`itemId`,
  `position`, `stem`). Aprobar el material (H9.5) publica esos ítems (`status='published'`).
- Reusa `ItemsService` (`apps/api/src/items/items.service.ts`) si te sirve, o inserta directo con `tx`.

**T5 — Generador plan por grupo (H9.4).** `generators/group-plan.generator.ts`:
- **Agrupación DETERMINISTA en backend** (sin IA, sin PII al LLM): consulta los alumnos del `classGroupId`
  (o de la cohorte de la evaluación) que están **bajo umbral** en la habilidad `nodeId` (vía `responses`/
  `skill_results`/`assessment_results`). Calcula `studentCount`. La IA solo recibe agregados +
  contexto RAG y produce `groupLabel` (abstracto) + `sequence` (pasos) que cumple `remedialPlanContentSchema`.
- `promptVersion='s3-group-plan-v1'`.

**T6 — Dispatch + runner async.** `remedial.runner.ts` + un registro/puerto `RemedialGenerator`:
- Define `interface RemedialGenerator { type; generate(ctx): Promise<{ content; itemIdsToLink? }> }` y
  resuelve el generador por `type`. El runner: `markProcessing` → arma contexto (RAG + datos
  deterministas) → generador por tipo → `markReady` con el `content` validado. Timeout + try/catch →
  `markFailed` (igual que `ai-analysis.runner.ts`). Trazabilidad (`promptVersion`, `model`, `costUsd`).

**T7 — Workflow IA-propone/humano-aprueba (H9.5).** En `remedial.service.ts`:
- `review(user, id, dto)`: valida estado `ready`; `approve` → `status='approved'`, guarda `content`
  editado si vino (re-valida con `validateRemedialContent`), sella `reviewedById`/`reviewedAt`, y para
  `practice_set` **publica los ítems** referenciados (`items.status='published'`); `discard` →
  `status='discarded'`. Solo `REMEDIAL_APPROVER_ROLES`.

**T8 — Controller + module.** `remedial.controller.ts` (los 4 endpoints de §1, validación Zod, guards
con las constantes de roles, encola con `JOB_DISPATCHER` en `generate`) + `remedial.module.ts`
(importa `JobsModule`, `LlmModule`, `CurriculumRetrieverModule`, `ItemsModule`/lo que necesites;
registra service, context service, runner, los 3 generadores, controller). **NO** registres en
`app.module.ts` (eso es integración).

**T9 — Tests (≥8 por service/área):** base service (caché, status, review/aprobación, multi-tenancy,
sin PII), context assembler (mock CurriculumRetriever), y cada generador (mock LlmService: happy →
content válido; no-JSON → failed; schema inválido → failed; group_plan → sin PII y studentCount
determinista; practice → inserta items draft + linkea). Mock DB / dependencias.

**Verifica:** `cd apps/api && npx tsc --noEmit`; `pnpm --filter @soe/api test`.

**CA BE:** withOrgContext en toda query; `orgId` del token; **cero PII al LLM**; salida solo en `content`;
caché por inputHash; roles por constante; ítems generados con `source='ai_generated'`+`status='draft'`,
publicados solo al aprobar; batch inserts; response shapes == Models; `tsc` limpio; tests verdes.

### FE — Sección "Material Remedial" (H9.6) · dir: `apps/web/src/app/(dashboard)/material-remedial/` (NUEVO)
Dueño único de la ruta. Puede **enlazarse desde una brecha** del Análisis IA (el enlace en
`analisis-ia/` y el `nav-items.ts` los hace **integración** — no los toques).
- `T1` Página (Server Component) `/material-remedial`: **banco de material** vía `apiGet<RemedialListResponse>('/remedial?…')`
  con filtros (type/status/nodeId). `canAccess(roles, REMEDIAL_VIEWER_ROLES)`.
- `T2` **Disparar generación** desde una brecha: recibe `?nodeId=&assessmentId=&classGroupId=&type=` (o
  selector), server action `generateRemedial()` (`POST /remedial/generate`), y **polling** de
  `GET /remedial/:id` hasta `ready`/`failed` (componente `'use client'`).
- `T3` **Revisar / editar / aprobar / descartar** (H9.5): vista de detalle por tipo (guía / set de ítems
  con preview / plan por grupo) con acciones `approve`/`discard` (server action → `PATCH /remedial/:id/review`).
  Permite editar el `content` antes de aprobar (al menos para `guide`). `canAccess(roles, REMEDIAL_APPROVER_ROLES)`
  en las acciones. **Disclaimer IA visible** "sugerencia IA, validar".
- `T4` Tipar TODO con Models de `@soe/types` (`RemedialMaterialModel`, `RemedialListResponse`,
  `RemedialGuideContent`/`RemedialPracticeContent`/`RemedialPlanContent`). `apiGet`/`apiPost` de `lib/api.ts`;
  mutations en `actions.ts`. UI en español, responsive mobile-first, tokens Tailwind.
- **NO toques** `nav-items.ts`, `lib/api.ts`, `layout.tsx`, ni `analisis-ia/` (integración enlaza).

**Verifica:** `cd apps/web && npx tsc --noEmit`.

## 3. Archivos que SOLO toca integración (Fase 4 — NO los toquen los agentes)
- `apps/api/src/app.module.ts` (registrar `RemedialModule`).
- `apps/web/src/components/layout/nav-items.ts` (item "Material Remedial").
- El **enlace desde la brecha** en `apps/web/src/app/(dashboard)/analisis-ia/` (acción "Generar material remedial").

## 4. Decisiones de diseño cerradas (consulta al usuario)
- **Persistencia:** tabla **polimórfica** `remedial_materials` (`type`+`content JSONB`), una caché/workflow/controller.
- **Ítems de práctica:** se insertan en `items` como `source='ai_generated'`+`status='draft'`; el material referencia sus `itemId`; aprobar publica (`status='published'`).
- **org_id NOT NULL** (per-tenant) en S3; el reuso plataforma-global cross-tenant de material genérico por OA queda como optimización futura (requiere org_id nullable + política de lectura compartida).

## 5. Setup OBLIGATORIO de cada agente (worktree aislado)
El worktree nace de `main`, NO de `sprint-f2-3`. PRIMERO, desde la raíz del repo del worktree:
1. Árbol limpio → `git reset --hard sprint-f2-3`; con commits propios → `git merge sprint-f2-3 --no-edit`.
   Verifica con `git log --oneline -3` que ves el commit de contratos de `sprint-f2-3`.
2. `pnpm install` → `pnpm --filter @soe/types build` → `pnpm --filter @soe/db build`.
3. Recién entonces: leer este doc COMPLETO y codear.
4. **Commit obligatorio** antes de terminar (`git add -A && git commit -m "…"`), o el worktree se borra y se pierde todo.
