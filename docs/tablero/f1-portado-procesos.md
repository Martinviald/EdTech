# F1 — Procesos de medición portados de `dev` a `main`

Registro de lo que se trajo de `origin/dev` a la rama `feat/tablero-procesos-pruebas` en la
fase F1 del plan (`docs/plan-desarrollo-tablero-procesos-pruebas.md`), de lo que quedó fuera y
del porqué. El portado se hizo por archivos (`git diff <merge>^1 <merge>` aplicado con
`git apply -3` sobre `main`), nunca con `git merge` de `dev`.

## Portado

| Origen en `dev` | Qué se trajo |
| --- | --- |
| PR #230 (`ce49772`: `aa1c20f`, `db23c7a`, `68f913a`, `148222f`, `7da352a`, `35b4342`, `4a6b324`) | Schema `measurement_processes`, enums `process_kind`/`process_status`, `assessments.process_id` + índice y relación; política RLS; script `backfill-measurement-processes.ts` y su entrada `db:backfill:processes`; módulo API `apps/api/src/measurement-processes/*` (controller, service, `process-coverage.service`, helpers y su spec); `@soe/types`: `measurement-process.schema.ts`, `access-policies/measurement-processes.ts`, `utils/expected-scope.ts` (+ spec), `utils/slug.ts`; filtro `processId` en `dashboard.schema` y `DashboardsService`; web `/procesos/**`, `nav-items`, `routes`, `page-titles`; `docs/diseno-procesos-de-medicion.md` |
| PR #243 (`9d190b8`: `f90b72f`, `29a5752`, `ab3582a`) | Tarjeta de proceso clickeable, filtro de proceso en panorama y mapa de calor (`heatmap.schema`, `HeatmapService`, `dashboard-filter-bar`, `dashboard-filters`), alcance derivado del backfill que ya no inventa celdas |
| PR #262 (`c09ef97`): `7e0552e`, `2be722a`, `71783f0`, `0e8fc09` | Filtro `processId` en `/evaluaciones` (`item-analysis.schema` + `ItemAnalysisService` + spec); preselección del proceso más reciente con resultados (`processes`/`defaultProcessId` en `getFilterOptions` + specs, `withEntryDefaults`, opt-out `processOptOut`, `buildDashboardHref`/`buildClearProcessQuery`); `process-preview-banner.tsx` (reemplaza `process-filter-notice.tsx`); los dos arreglos de la revisión adversarial |
| PR #262: `8ab0445`, `a8d3573` | `docs/diseno-entrada-por-proceso.md` (lo referencia `dashboard.schema.ts`) |
| PR #263 (`907a6c3`): `77dbd08`, y de `a686f28` solo `resultados/page.tsx` | La banda del proceso cuenta alumnos únicos; la banda va bajo los filtros |

## Excluido

| Pieza de `dev` | Motivo |
| --- | --- |
| `0034_public_nitro.sql` y su snapshot | La migración se regeneró sobre la cadena de `main` (`0034_lean_mindworm`) |
| `HeaderIcon`, `HeaderLead`, `PageHeader` (`b1e262a`, PR #243) | Ajuste visual ajeno a procesos; nada de procesos depende de él |
| PR #244 / #245 (buscador `q`): `assessment-name-search.helper`, `searchTermSchema`, `AssessmentSearchField`, `useDebouncedSearch`, `SearchEmptyState`, `search` de `ComparableUnitsTable`, `FilterBar.fullWidthField` (`a686f28`) | Feature aparte que no está en `main`. Los conflictos de #262/#263 se resolvieron quitando solo las líneas del buscador |
| `649f67c` (orden por gravedad en `/evaluaciones`, `utils/assessment-severity.ts` + spec) | No es de procesos: ordena por la severidad de la unidad comparable |
| PR #261 (`@soe/decisions`), #264, #267, #270, #272 y el resto de `origin/main..origin/dev` | Sin relación con procesos |

## Cambios nuevos (no existen en `dev`)

- El slug único es un índice parcial `(org_id, slug) WHERE deleted_at IS NULL`. `buildUniqueSlug`
  y el backfill ignoran los procesos borrados (el backfill de `dev` podía reutilizar uno borrado).
- `groupProcessCandidates` y `findProcessInvariantViolations` en
  `packages/types/src/utils/process-grouping.ts`: agrupan por (org, año, tipo, período). Si una
  celda (grado del curso, prueba) tiene dos instrumentos distintos, solo las evaluaciones de esa
  celda quedan apartadas (en `ambiguous`, con sus violaciones); el resto del grupo sí se asigna.
  La prueba se inyecta con `testKey` (por defecto la línea o, sin línea, la asignatura).
- El backfill usa esa función, es dry-run por defecto (`--commit` para escribir) y reporta las
  celdas en conflicto.
- `linkAssessments` valida org (dentro de `withOrgContext`), cursos asignados, año del curso
  igual al del proceso, e invariante sobre el resultado (ya vinculadas + nuevas). Permite la
  vinculación parcial. Errores con `BadRequestException`.

## Nota para F2

Con la asignatura como prueba, una tanda PAES sigue violando la invariante: M1 y M2 son `MATH`, y
las tres menciones de Ciencias son `SCI`. F2 debe pasar como `testKey` la línea
(`coalesce(track_id, subject_id)`), tanto en el backfill como en `linkAssessments`, antes de que
F5 cree los procesos "Ensayo PAES N".
