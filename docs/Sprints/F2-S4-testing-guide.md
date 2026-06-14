# Guía de testing — F2 · Sprint 4 (Benchmarking Institucional)

> H7.1 read-model · H7.2 comparación mismo-instrumento · H7.3 cohortes · H7.4 doble modo (global
> k-anónimo / red identificada) · H7.5 dashboard · H7.6 auditoría. Rama `sprint-f2-4`.
> Requiere `DATABASE_URL` + `pnpm db:migrate` (aplica `0004` + RLS) y **múltiples colegios** con
> resultados del **mismo instrumento** para ver cohortes reales (≥ k=3 colegios y ≥ n=20 alumnos
> para que NO se suprima en modo global).

## Pre-requisitos
1. `pnpm install` && build de `@soe/types` y `@soe/db`.
2. `pnpm db:migrate` (crea `benchmark_aggregates` sin RLS + `benchmark_access_logs` con RLS; re-aplica
   `rls-policies.sql`).
3. Seed: varias orgs `type='school'` con `dependence/region/commune`, algunas con el mismo `parent_id`
   (sostenedor `foundation`) para el modo red; resultados (`assessment_results`/`skill_results`) del
   mismo instrumento en varias orgs; marcar `optOutGlobalPool=true` en alguna para probar exclusión.
4. **Refrescar el read-model**: `POST /api/benchmarking/refresh` (rol `platform_admin`) — sin esto las
   comparaciones salen vacías.
5. Sesión con un rol directivo (`school_admin`/`academic_director`).

## H7.1 — Read-model + refresh
```
POST /api/benchmarking/refresh   (platform_admin)
  → { refreshedOrgs, refreshedRows, refreshedAt }
```
- Verificar en DB que `benchmark_aggregates` tiene una fila por (org × instrumento) con agregados
  (studentCount, avgAchievement, bandDistribution, perSkill) y **cero PII** (sin studentId/nombres/RUT).
- Verificar que `optOutGlobalPool`, `dependence/region/commune/networkOrgId` quedaron snapshoteados.

## H7.2 + H7.3 — Comparación mismo-instrumento + cohortes
```
GET /api/benchmarking/instruments  → instrumentos donde tu org tiene datos
GET /api/benchmarking/comparison?instrumentId=<id>&mode=global[&gradeId=&subjectId=&dependence=&region=&commune=]
  → BenchmarkComparisonResponse { yourSchool{percentile,avgAchievement,bandDistribution,perSkill},
       cohort{schoolCount,studentCount,median,p25,p75,bandDistribution,perSkill}, suppressed, thresholds }
```
- Verificar percentil de tu colegio, mediana/cuartiles de la cohorte, delta por habilidad.
- Aplicar filtros de cohorte (dependence/region/commune) y ver que la cohorte se acota.

## H7.4 — Doble modo de privacidad (CRÍTICO)
- **Global k-anonimato**: con una cohorte de `< 3` colegios **o** `< 20` alumnos → `suppressed=true`,
  `cohort=null`, `yourSchool=null`, `suppressionReason` explicativo. **No** debe exponerse ningún dato.
  (Los umbrales viven en `@soe/types`: `BENCHMARK_K_MIN_SCHOOLS`, `BENCHMARK_N_MIN_STUDENTS`.)
- **Global excluye opt-out**: una org con `optOutGlobalPool=true` NO debe contar en la cohorte global.
- **Red identificada** (`mode=network`): solo colegios con el mismo `networkOrgId` (= `parent_id`
  sostenedor) que el caller; `networkSchools[]` con `orgName` + `isYou`; **sin** supresión por k.
  Colegio sin red → `networkSchools=[]` + reason "Tu colegio no pertenece a una red/sostenedor".
- **Aislamiento**: confirmar que el servicio nunca devuelve filas identificables de otra org en modo
  global, y que ninguna tabla de alumnos se lee cross-tenant (solo `benchmark_aggregates`).

## H7.5 — Dashboard `/benchmarking`
1. Selector de instrumento + conmutador global↔red + filtros de cohorte (vía URL).
2. "Tu colegio vs cohorte" (percentil/cuartil + distribución por banda), heatmap por habilidad
   (sobre/bajo vía delta), tabla de red identificada (orden alfabético, resalta tu colegio).
3. Disclaimers: anonimato (global), muestra insuficiente (`suppressed`), sin red (network).
4. Nav "Benchmarking" visible solo para `BENCHMARKING_VIEWER_ROLES` (directivos, no profesor).

## H7.6 — Auditoría
```
GET /api/benchmarking/audit?page=&limit=  → accesos de la propia org (RLS)
```
- Cada `GET /comparison` debe dejar una fila en `benchmark_access_logs` (mode, instrumentId, filters,
  cohortSchoolCount, cohortStudentCount, suppressed, userId).
- Verificar que una org solo ve sus propios accesos (RLS por org_id).

## Casos de error / borde
- **Sin refresh previo**: comparación sin datos → cohorte vacía / suppressed.
- **Multi-tenant**: el read-model es cross-tenant **a propósito** (sin RLS) pero solo agregados; el
  audit log y `/audit` sí están bajo RLS por org.
- **Rol insuficiente**: profesor no accede a benchmarking (no está en `BENCHMARKING_VIEWER_ROLES`); solo
  `platform_admin` puede `POST /refresh`.

## Checklist de aceptación del sprint
- [ ] `pnpm typecheck` (api + web) · `nest build` ✅.
- [ ] `pnpm --filter @soe/api test` — suite `benchmarking` en verde (las `privacy/*` requieren `DATABASE_URL`).
- [ ] Lint sin errores en `benchmarking/`.
- [ ] H7.1–H7.6 según los pasos; **cero PII en el read-model**; k-anonimato suprime bajo umbral; opt-out
      excluido del global; modo red identificado solo dentro del sostenedor; todo acceso auditado.
