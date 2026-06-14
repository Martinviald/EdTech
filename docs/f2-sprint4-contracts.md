# Contratos — F2 · Sprint 4 (Benchmarking Institucional)

> Rama `sprint-f2-4` (desde `dev`, con S0–S3 mergeados). Permite que un colegio compare su desempeño
> contra una cohorte de perfil similar (**global anónima, opt-out**) y contra los colegios de su
> **red/sostenedor** (identificada). Comparación **mismo-instrumento** (apples-to-apples).

## 0. Contexto y reglas (LEER COMPLETO ANTES DE CODEAR)

- **⚠️ EXCEPCIÓN CROSS-TENANT (la única del proyecto, CLAUDE.md §5.2 / §9):** el read-model
  `benchmark_aggregates` **NO tiene RLS** — se lee CROSS-TENANT a propósito. **Por eso NUNCA contiene
  PII**: solo agregados por org (conteos, % logro, distribución por banda, % por habilidad). El servicio
  de comparación lee esa tabla con `this.db` directamente (FUERA de `withOrgContext`). El acceso se
  protege con guards de rol + **k-anonimato** + nunca devuelve filas crudas de otra org en modo global.
- **Refresh sin romper RLS (H7.1):** el refresh del read-model **itera org por org** y lee la fuente
  (`assessment_results`, `skill_results`) DENTRO de `withOrgContext(orgId, tx => …)`; luego hace upsert
  en `benchmark_aggregates` (que no tiene RLS). Así la fuente se lee con aislamiento y el read-model se
  construye cross-tenant. Snapshotea `optOutGlobalPool` y las dimensiones (`dependence/region/commune/
  networkOrgId = organizations.parent_id`) en cada fila.
- **k-anonimato — FUENTE ÚNICA:** importar `BENCHMARK_K_MIN_SCHOOLS` (3) y `BENCHMARK_N_MIN_STUDENTS`
  (20) de `@soe/types`. En modo **global**, si la cohorte tiene `< k` colegios **o** `< n` alumnos →
  `suppressed=true` y NO se exponen `cohort`/`yourSchool` comparativos (disclaimer de muestra insuficiente).
- **Modos (H7.4):** `global` = pool anónimo, excluye orgs con `optOutGlobalPool=true`, aplica k-anonimato.
  `network` = identificado, solo orgs con el mismo `networkOrgId` (= `parent_id`) que el caller; **sin**
  supresión por k (es por acuerdo del sostenedor). Si el caller no tiene `parent_id` → red vacía
  (`networkSchools=[]`, disclaimer "sin red").
- **Auditoría (H7.6):** cada consulta de comparación escribe una fila en `benchmark_access_logs`
  (DENTRO de `withOrgContext(callerOrgId)` — esa tabla SÍ tiene RLS). Compliance Ley 19.628.
- **Roles:** constantes de `@soe/types/access-policies`: `BENCHMARKING_VIEWER_ROLES` (directivo, sin
  teacher), `BENCHMARKING_ADMIN_ROLES` (refresh). Nunca roles inline.
- Sin hardcodear "DIA"/"Lenguaje". Sin `any`. TypeScript strict.

### Contratos compartidos (Fase 0, YA commiteados en `sprint-f2-4`)
- **DB:** tablas `benchmark_aggregates` (read-model, **sin RLS**) y `benchmark_access_logs` (RLS), enum
  `benchmark_mode`, migración `0004_charming_agent_brand.sql`, RLS de `benchmark_access_logs` en
  `rls-policies.sql` (+ nota de que `benchmark_aggregates` NO lleva RLS). Tipos Drizzle `BenchmarkAggregate`,
  `BenchmarkAccessLog` de `@soe/db`. La tabla `org_benchmark_settings` (opt-out + consent) ya existe (S0).
- **`@soe/types` (`benchmark.schema.ts`):** `BENCHMARK_K_MIN_SCHOOLS`/`BENCHMARK_N_MIN_STUDENTS`,
  `benchmarkModeSchema`, sub-modelos (`BenchmarkBandDistribution`, `BenchmarkSkillAggregate`),
  `BenchmarkInstrumentOption`/`BenchmarkInstrumentListResponse`, `benchmarkComparisonQuerySchema`,
  `SchoolBenchmark`/`CohortBenchmark`/`CohortSkillStat`/`NetworkSchoolRow`/`BenchmarkComparisonResponse`,
  `BenchmarkRefreshResponse`, `BenchmarkAccessLogModel`/`benchmarkAuditListQuerySchema`/`BenchmarkAuditListResponse`.
- **Roles:** `BENCHMARKING_VIEWER_ROLES`, `BENCHMARKING_ADMIN_ROLES`.

## 1. Endpoints

| Método | Ruta | Roles | Request → Response |
|---|---|---|---|
| `GET` | `/api/benchmarking/instruments` | `BENCHMARKING_VIEWER_ROLES` | → `BenchmarkInstrumentListResponse` (instrumentos donde la org tiene datos) |
| `GET` | `/api/benchmarking/comparison` | `BENCHMARKING_VIEWER_ROLES` | query `BenchmarkComparisonQueryDto` → `BenchmarkComparisonResponse` (+ escribe access log) |
| `POST` | `/api/benchmarking/refresh` | `BENCHMARKING_ADMIN_ROLES` | → `BenchmarkRefreshResponse` (reconstruye el read-model) |
| `GET` | `/api/benchmarking/audit` | `BENCHMARKING_VIEWER_ROLES` | query `BenchmarkAuditListQueryDto` → `BenchmarkAuditListResponse` (accesos de la propia org) |

Response shapes EXACTOS = los Models de `@soe/types`.

## 2. Workstreams

### BE — Módulo benchmarking (H7.1–H7.4 + H7.6) · dir: `apps/api/src/benchmarking/` (NUEVO, dueño único)
- **T1 — Refresh del read-model (H7.1)** `benchmarking-refresh.service.ts`: para cada org (no eliminada),
  bajo `withOrgContext(orgId, tx => …)` agrega desde `assessment_results` (% logro, `performanceLevel` →
  bandDistribution, studentCount distinct) + `skill_results` (perSkill por `nodeId`) agrupado por
  `(instrumentId via assessments, gradeId, subjectId)`; lee `org_benchmark_settings` (opt-out) y
  `organizations` (dependence/region/commune/parent_id). Upsert en `benchmark_aggregates`
  (sin contexto, no tiene RLS) con `onConflictDoUpdate` por la unique `(orgId,instrumentId,gradeId,subjectId)`.
  Devuelve `BenchmarkRefreshResponse`. Expuesto por `POST /refresh` (`BENCHMARKING_ADMIN_ROLES`). Puede
  encolar vía `JOB_DISPATCHER` o correr sincrónico (volumen piloto). Sin PII en el read-model.
- **T2 — Motor de comparación mismo-instrumento (H7.2)** `benchmarking.service.ts`: lee
  `benchmark_aggregates` con `this.db` (CROSS-TENANT, fuera de withOrgContext). Calcula, para el
  instrumento+filtros: la cohorte (filas que matchean), `yourSchool` (la fila del caller),
  percentil de tu colegio dentro de la cohorte, `median/p25/p75`, `avgAchievement`, `bandDistribution`
  agregada y `perSkill` (cohortAchievement vs yourAchievement + delta).
- **T3 — Cohortes y filtros (H7.3):** la cohorte = filas del mismo `instrumentId` (+ gradeId/subjectId si
  vienen) filtradas por `dependence/region/commune` (solo modo global). No hardcodear; filtros opcionales.
- **T4 — Doble modo privacidad (H7.4):**
  - `global`: excluye `optOutGlobalPool=true`; aplica **k-anonimato** (`< BENCHMARK_K_MIN_SCHOOLS`
    colegios **o** `< BENCHMARK_N_MIN_STUDENTS` alumnos → `suppressed=true`, `cohort=null`,
    `networkSchools=null`, `suppressionReason` explicativo). NUNCA exponer filas identificables.
  - `network`: cohorte = orgs con el mismo `networkOrgId` que el caller (identificada, `NetworkSchoolRow[]`
    con `orgName` + `isYou`); SIN supresión por k. Si el caller no tiene `networkOrgId` → `networkSchools=[]`
    + `suppressionReason="Tu colegio no pertenece a una red/sostenedor"`.
  - `thresholds` siempre reporta `{kMinSchools, nMinStudents}`.
- **T5 — Selector de instrumentos** (`GET /instruments`): instrumentos donde el caller tiene filas en
  `benchmark_aggregates` (su org), con nombres de instrumento/grade/subject y `yourStudentCount`.
- **T6 — Auditoría (H7.6):** en `GET /comparison`, tras resolver el resultado, escribe
  `benchmark_access_logs` (mode, instrumentId, filters, cohortSchoolCount, cohortStudentCount, suppressed,
  userId) DENTRO de `withOrgContext(callerOrgId)`. `GET /audit` lista los accesos de la propia org
  (paginado, dentro de `withOrgContext`).
- **T7 — Controller + module** (4 endpoints, validación Zod, guards por constante) + registrar
  providers. **NO** registres en `app.module.ts` (integración).
- **T8 — Tests (≥8):** refresh (agrega sin PII, snapshot opt-out, iterando orgs), comparación
  (percentil/mediana), k-anonimato (suprime bajo umbral; usa los valores de `@soe/types`), modo red
  (identificado por parent_id; vacío sin red), exclusión de opt-out en global, auditoría escribe log.

**CA BE:** el read-model **nunca** lleva PII; las lecturas cross-tenant son SOLO sobre `benchmark_aggregates`
(no sobre tablas de alumnos); el refresh lee la fuente bajo `withOrgContext`; k-anonimato con las
constantes de `@soe/types`; modo global excluye opt-out; auditoría dentro de `withOrgContext`; roles por
constante; response shapes == Models; `tsc` limpio; tests verdes.

**Verifica:** `cd apps/api && npx tsc --noEmit`; `pnpm --filter @soe/api test`.

### FE — Dashboard `/benchmarking` (H7.5) · dir: `apps/web/src/app/(dashboard)/benchmarking/` (NUEVO, dueño único)
- `T1` Página (Server Component) `/benchmarking`: selector de instrumento (`GET /instruments`), conmutador
  **modo global ↔ red**, filtros de cohorte (dependence/region/commune). `canAccess(roles, BENCHMARKING_VIEWER_ROLES)`.
- `T2` Render de `BenchmarkComparisonResponse`: "tu colegio vs cohorte" (percentil + distribución por
  banda comparada), **heatmap por habilidad** (sobre/bajo cohorte vía `delta`), y —en modo red— tabla
  identificada (`networkSchools`, resaltando `isYou`). **Sin rankings públicos 1-N** (percentiles/cuartiles).
- `T3` **Disclaimers**: anonimato (modo global) y **muestra insuficiente** cuando `suppressed=true`
  (mostrar el `suppressionReason`, no datos). Caso "sin red" en modo red.
- `T4` Tipar TODO con Models de `@soe/types`. `apiGet` de `lib/api.ts`. UI español, responsive, tokens
  Tailwind, gráficos con tokens (sin colores hardcodeados). NO `useEffect` para fetch inicial.
- **NO toques** `nav-items.ts`, `lib/api.ts`, `layout.tsx` (integración agrega el nav).

**Verifica:** `cd apps/web && npx tsc --noEmit`.

## 3. Archivos que SOLO toca integración (Fase 4)
- `apps/api/src/app.module.ts` (registrar `BenchmarkingModule`).
- `apps/web/src/components/layout/nav-items.ts` (item "Benchmarking", `BENCHMARKING_VIEWER_ROLES`).

## 4. Decisiones cerradas (consulta al usuario)
- **k-anonimato:** `k≥3` colegios y `n≥20` alumnos, definidos como constantes en `@soe/types`
  (`benchmark.schema.ts`) — fuente única, fácil de ajustar.
- **Participación global:** **opt-out** (T&C + exclusión; diseño S0). El refresh excluye del pool global
  a orgs con `optOutGlobalPool=true` (snapshot en el read-model).
- **Read-model:** tabla resumen `benchmark_aggregates` refrescada por trigger/schedule (no vistas
  materializadas). org_id NO bajo RLS (excepción cross-tenant documentada).

## 5. Setup OBLIGATORIO de cada agente (worktree aislado)
El worktree nace de `main`, NO de `sprint-f2-4`. PRIMERO, desde la raíz del worktree:
1. Árbol limpio → `git reset --hard sprint-f2-4`; con commits propios → `git merge sprint-f2-4 --no-edit`.
   Verifica con `git log --oneline -3` el commit de contratos de `sprint-f2-4`.
2. `pnpm install` → `pnpm --filter @soe/types build` → `pnpm --filter @soe/db build`.
3. Recién entonces: leer este doc COMPLETO y codear.
4. **Commit obligatorio** antes de terminar, o el worktree se borra y se pierde todo.
