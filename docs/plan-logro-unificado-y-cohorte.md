# Plan de desarrollo — % de logro unificado y contraste con la cohorte

> **Qué es esto:** el plan para construir lo que define
> [`diseno-logro-unificado-y-cohorte.md`](./diseno-logro-unificado-y-cohorte.md). Incluye tickets por
> fase, archivos que toca cada uno, criterios de aceptación, cómo se verifica y en qué orden se
> entrega. Las referencias `§N` apuntan al documento de diseño.
>
> **Fecha:** 2026-10-06 · **Estado:** ✅ listo para ejecución autónoma (§7), sin código.

---

## 1. Cómo se entrega

### 1.1 Una PR, dos partes, un commit por fase

- **Desarrollo autónomo completo en worktrees aislados.** Nada se hace en el checkout principal ni en
  `dev`.
  - El trabajo de integración vive en el worktree `wt-logro-cohorte`, rama
    `feat/logro-unificado-cohorte`, que ya sale de `origin/dev` y tiene los commits de documentación.
  - Cada subagente que escribe código trabaja en **su propio worktree aislado**, en una rama que sale
    de la de integración. Commitea antes de terminar; si no, pierde su trabajo. Sus commits se
    integran en la rama de la PR y se aplastan en el commit de su fase.
  - Al terminar se borran los worktrees de los subagentes. El de integración queda hasta el merge.
- **Una sola PR contra `dev`** al final. Contiene la parte A (fases A1–A5) y la B (fases B0–B4), con
  **un commit por fase**, en ese orden.
- La A va antes que la B dentro de la misma rama. Cada fase se sube y el CI la valida antes de empezar
  la siguiente. Así, aunque vayan juntas, el historial separa "cambió la fórmula" (A) de "cambió la
  vista" (B).
- **La PR se abre al terminar A1** (como borrador) para tener CI en cada push.
- **Al final del plan, la PR pasa por una auditoría** (§7.6). Se corrige lo que aparezca y la PR se
  entrega a `dev` **mergeable y auditada**: CI en verde, sin conflictos y con el informe de la
  auditoría en su cuerpo.
- **Nada se mergea ni se despliega en la ejecución autónoma.** El merge a `dev`, la promoción a `main`
  y todo lo que toque demo quedan en el runbook de §8, para hacerlo con el usuario.

### 1.2 Verificación

- **CI de GitHub en cada fase** (jobs API, DB, Types, Web, Decisions, OMR): typecheck, lint y tests.
  En local sólo corren specs de un archivo; la máquina no aguanta las suites completas.
- **Base local nueva para los gates de datos** (§7.3): migración, backfills, refresh y el informe de
  diferencias corren contra ella. Nunca contra `soe_dev` ni contra demo.
- **Specs con números reales sin leer demo:** se usan las cifras ya capturadas en §8 del diseño y en
  los specs de la PR #273 (Lectura 6°: muestra 71,91 % sobre 103 alumnos). No se hacen lecturas nuevas
  de demo.

### 1.3 Subagentes

Se usan para mejorar o acelerar el trabajo, **sin abusar por los costos**: sólo cuando el trabajo se
reparte en partes independientes o cuando una mirada aparte encuentra lo que el autor no ve.

| Dónde                  | Para qué                                                                    | Cuántos                                |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| A3                     | ~20 servicios con el mismo cambio mecánico, repartidos por dominio          | 3–4 en paralelo, en worktrees aislados |
| B2 / B3                | Tablero maestro y `/detalle` son independientes una vez que existen B0 y B1 | 2 en paralelo, en worktrees aislados   |
| Exploración puntual    | Ubicar código en muchos archivos cuando sólo hace falta la conclusión       | Agente `Explore`, sólo lectura         |
| Auditoría final (§7.6) | Regresiones y accesos sobre la PR completa                                  | 1, sólo lectura                        |

Lo que **no** se delega: los contratos de `@soe/types`, el helper de A1, la migración de A2, la
integración de los commits de los agentes, la revisión de lo que entregan y la corrección de los
hallazgos de la auditoría. Tampoco se lanzan agentes para tareas de un solo archivo.

Antes de lanzar agentes se commitean los contratos y el helper de A1, y se fijan las semánticas que
comparten (`feedback-agentes-decisiones-compartidas`). A cada agente se le pasan:

- las reglas de `.claude/rules/backend` (cero comentarios en `apps/api`, `reportServerError` en los
  catch, helpers de un uso como método privado) y, si toca la web, las de `.claude/rules/frontend`;
- la regla del diseño §3.1 y la tabla de su dominio del inventario §9;
- las reglas de §7.1 (un proceso pesado a la vez: los agentes **no** corren suites completas ni
  builds; los tests se ven en el CI);
- la instrucción de commitear en su worktree antes de terminar.

---

## 2. Decisiones

Todas tomadas (§2 del diseño, D1–D9). A0 ya se hizo (§8 del diseño). Para lo que pueda surgir durante
el desarrollo, §7.2 fija los criterios por defecto, para no detenerse a preguntar.

---

## 3. Parte A — % de logro unificado

### A0 · Verificación de datos en demo ✅ (2026-10-06)

Resultados en §8 del diseño:

| #    | Qué                               | Resultado                                                                                                                                                                    |
| ---- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0-1 | Evaluaciones sin datos de puntaje | Ninguna: todas tienen estadísticas por ítem con máximo                                                                                                                       |
| A0-2 | Secciones electivas en DIA        | Ninguna (sólo PAES CIE, sin respuestas cruzadas entre ramas)                                                                                                                 |
| A0-3 | Foto "antes"                      | No hace falta guardarla: A5-1 recalcula la fórmula vieja y la nueva sobre los mismos datos en el mismo momento, que es una comparación más estricta que una foto de otro día |
| A0-4 | Hallazgos                         | Pendientes que inflan a CSCJ en 2025; logro por nodo en escala 0..1 en 2 evaluaciones (A-7)                                                                                  |

### A1 · Definición en `@soe/types` y correcciones por alumno

| #    | Ticket                                                                            | Archivos                                                                                     | Aceptación                                                                               |
| ---- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A1-1 | `AchievementTally`, `emptyTally`, `addTally`, `tallyOf`, `achievementPct`         | `packages/types/src/utils/achievement.ts` (+spec), export en `utils/index.ts`                | `achievementPct({0,0}) = null`; redondeo único; specs con crédito parcial y puntajes ≠ 1 |
| A1-2 | Todo pendiente → `null` (A-1)                                                     | `grade-calculator.ts` (`aggregateStudentResults`, `aggregateSkillResults`)                   | Alumno sin corregidas: `percentage = null`, sin banda; los consumidores toleran `null`   |
| A1-3 | `aggregateSkillResults` devuelve `scoreSum / maxSum`                              | `grade-calculator.ts`                                                                        | El `percentage` recalculado coincide con `scoreSum/maxSum`                               |
| A1-4 | `aggregateCohortSkillStats` suma tallies; `deriveSkillStatsFromItemStats` también | `item-stats-calculator.ts`                                                                   | Mismo valor para orígenes calculado e importado sobre los mismos ítems                   |
| A1-5 | Ítems borrados no cuentan (A-2)                                                   | `assessment-results/persist-results.ts` (`loadResponsesForPersist`), los 3 importadores seed | Spec: respuesta sobre un ítem con `deleted_at` queda fuera                               |
| A1-6 | Guarda de electivas en el seed DIA 2026 (A-3)                                     | `packages/db/src/seed/import-dia-2026-responses.ts`                                          | Mismo comportamiento que el seed PAES                                                    |

### A2 · Esquema, escritores y recálculo

| #    | Ticket                                                                                                                                                                                               | Archivos                                                                                             | Aceptación                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A2-1 | Migración: `score_sum`, `max_sum` en `skill_results`, `assessment_skill_stats`, `benchmark_aggregates`, `benchmark_item_aggregates`                                                                  | `packages/db/src/schema/{results,benchmark}.ts`, migración generada                                  | `drizzle-kit generate` sin diff pendiente; todas `numeric NOT NULL DEFAULT 0` |
| A2-2 | Escritores: persistencia de `skill_results`, cohorte calculada e importada, importador de informes oficiales                                                                                         | `persist-results.ts`, `packages/db/src/queries/cohort-stats.ts`, `official-report-import.service.ts` | Toda fila nueva sale con sumas y `percentage = sumas`                         |
| A2-3 | Refresh de la muestra con tallies: `score_sum / max_sum` por colegio e instrumento (desde `assessment_item_stats`), `per_skill[].scoreSum / maxSum` (desde `assessment_skill_stats`), sumas por ítem | `packages/db/src/queries/benchmark-aggregates.ts` (+spec)                                            | `avg_achievement = sumas`; sin `pctSum`                                       |
| A2-4 | `db:backfill:student-scores`: rellena `skill_results.score_sum / max_sum` desde `responses`, por evaluación, idempotente, con `--dry-run` que reporta discrepancias de `percentage`                  | `packages/db/src/scripts/backfill-student-scores.ts`, `package.json`                                 | Dry-run en local: 0 discrepancias salvo las de A1-2 (todo pendiente)          |
| A2-5 | Backfill de cohorte: pasada para evaluaciones `aggregate_only` (re-deriva skill stats importadas desde sus item stats; corrige A-7)                                                                  | `backfill-cohort-stats.ts`, huella en `lib/cohort-stats-fingerprint.ts`                              | La huella cambia → el deploy reconstruye                                      |
| A2-6 | Deploy: paso del backfill de A2-4 con sello propio y chequeo final (falla si hay filas con respuestas corregidas y `max_sum = 0`)                                                                    | `.github/workflows/deploy-backend.yml`, script de chequeo                                            | Orden de §1.3; un deploy sin backfill falla en vez de publicar vacío          |

### A3 · Lectores del API (inventario §9 del diseño)

Un ticket por dominio. Todos siguen el mismo patrón: sumar tallies (`COHORT_SCORE_SUM` /
`COHORT_MAX_SUM` en SQL, `addTally` en TS) y llamar a `achievementPct`.

| #     | Dominio                           | Funciones                                                                                                                                                                                  |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A3-1  | Helpers comunes                   | Reemplazar `COHORT_PCT_SUM / COHORT_PCT_WEIGHT` y su acumulador por tallies (`common/helpers/cohort-skill-stats.helper.ts`); `cohort-item-stats.helper.ts` usa `achievementPct`            |
| A3-2  | Informe de evaluación             | `buildSummary`, `buildCourseComparison`, `buildSkills`                                                                                                                                     |
| A3-3  | Informes oficiales                | curso (`buildGeneralResult`, `buildSkillAxes*`, `buildSpecTable` → B), alumno (`loadClassAverage`), establecimiento (% mostrado; la prueba estadística sigue con observaciones por alumno) |
| A3-4  | Dashboards                        | `loadRecentAssessments`, `loadSkillsFrom*`, `loadBreakdownFrom*`, `getTeacherKpis`, `getPerformance`                                                                                       |
| A3-5  | Panorama comparable y trayectoria | `comparable-unit.assembler.ts` (todas), `comparable-trajectory.service.ts`                                                                                                                 |
| A3-6  | Alertas                           | `loadNodeAchievements` y `loadItemRates` pasan de C a B                                                                                                                                    |
| A3-7  | Mapa de calor                     | `loadCellRows`, `cohortAverage`                                                                                                                                                            |
| A3-8  | Alumno, remedial, IA              | `student-panorama` (`loadBySkill`), `student-comparisons` (`foldCourses`), `group-plan.generator`, `instrument-comparison.snapshot`                                                        |
| A3-9  | Muestra                           | `benchmark-sample.ts` (`aggregateSample`, `aggregateSampleSkills`, `aggregateItemSample` sobre tallies), `benchmarking.service.ts`                                                         |
| A3-10 | Detalle                           | `aggregateReference` devuelve `null` sin corregidas (A-4)                                                                                                                                  |
| A3-11 | Guardián                          | Spec que recorre `apps/api/src` y falla si aparece `avg(` sobre una columna `percentage` o un `pctSum`                                                                                     |

**Aceptación de A3:** cada spec existente que fija un % se recalcula a mano con la regla y se
actualiza **con el número nuevo justificado en el caso**, no copiando la salida.

### A4 · Web

| #    | Ticket                                                                                               | Archivos                                                                                                                     | Aceptación                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A4-1 | Total de "% Logro nivel" desde el API (A-5)                                                          | `resultados/detalle/cross-table.tsx`                                                                                         | El total coincide con `references.grade.rate` sobre todas las columnas                               |
| A4-2 | Aviso de pendientes (A-6): `pendingStudentCount` en `AssessmentReportMeta` y en `ItemMatrixResponse` | contratos en `@soe/types`, `assessment-report.service.ts`, `item-analysis.service.ts`, `report-body.tsx`, `detalle/page.tsx` | `AlertCallout` "N alumnos con preguntas por corregir: su % considera sólo lo corregido" cuando N > 0 |
| A4-3 | Tolerar `percentage = null` (A1-2) en las vistas por alumno                                          | componentes que formatean el % del alumno                                                                                    | "—" en vez de "0%"                                                                                   |

### A5 · Informe de diferencias y cierre

| #    | Ticket                                                                                                                                                                                        | Aceptación                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A5-1 | Script `apps/api/scripts/diff-achievement.ts`: para cada evaluación, curso y nodo, % antes (fórmula vieja, recalculada en el script) y después; conteo de alertas antes y después; salida CSV | Corre en la base local de §7.3 y su salida se resume en la PR; en demo se corre con el usuario (§8) |
| A5-2 | Revisión intermedia de la parte A con un subagente (números, vistas, rendimiento de las consultas cambiadas), antes de empezar la B                                                           | Hallazgos corregidos en un commit aparte                                                            |
| A5-3 | Actualizar `docs/Diseño bdd.md` (columnas nuevas, significado único de `percentage`) y el diseño                                                                                              | —                                                                                                   |

---

## 4. Parte B — Contraste con la cohorte

### B0 · Contratos

| #    | Ticket                                                                                                                           | Archivos                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| B0-1 | `CellSample` en `MasterBoardCell` / `MasterBoardCourseCell`; `MetricKey` gana `sample_delta`                                     | `master-board.schema.ts`, `metric` keys              |
| B0-2 | `QuestionReferences.sample: SampleReferenceRate \| null` (tally + `schoolCount`, `studentCount`); `MatrixReferenceScopes.sample` | `item-analysis.schema.ts`                            |
| B0-3 | `reference=level` en el query de `/dashboards/skills`; `gradeId` y `academicYearId` en `AssessmentReportMeta` si hacen falta     | `dashboard.schema.ts`, `assessment-report.schema.ts` |
| B0-4 | Superficies de telemetría `master_board`, `item_matrix`, `skills_breakdown`                                                      | `telemetry.schema.ts`                                |

### B1 · Muestra para cualquier conjunto de ítems

| #    | Ticket                                                                                                                                                                                                                                                                                                                                                        | Archivos                                                                           | Aceptación                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| B1-1 | `BenchmarkSamplesService.getItemSetSamples(itemSets, db)`: una consulta a `benchmark_item_aggregates`; cada conjunto llega ya acotado a las preguntas que el grupo comparado tiene corregidas (D9) y devuelve cuántas quedaron fuera; por conjunto, tally de la muestra, tally por colegio (para el percentil), k por ítem; un registro de acceso por request | `benchmark-samples.service.ts` (+spec)                                             | Conjuntos = instrumento completo o sección; un ítem bajo k excluye el conjunto; specs con números reales |
| B1-2 | Helper de población del nivel, extraído de `item-analysis` (mismo instrumento, nivel y año) y reutilizado por `/detalle` y por `/dashboards/skills?reference=level`                                                                                                                                                                                           | `common/helpers/level-cohort.helper.ts` o servicio, según `03-helpers-vs-services` | Misma población que la fila del nivel actual                                                             |

### B2 · Tablero maestro

| #    | Ticket                                                                                                                                            | Archivos                                                                                           | Aceptación                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| B2-1 | `sample` por celda (§5.2); sólo con rol de muestra y fuera de la vista de profesor; percentil y zona sólo en celdas de nivel con alcance completo | `master-board.service.ts` (`buildCellView`), `master-board.module.ts` importa `BenchmarkingModule` | Celdas mixtas o bajo k → `null`; secciones comparadas por sus ítems      |
| B2-2 | Métrica `sample_delta` en `master-board.metrics.ts` y en `availableMetrics` según el usuario                                                      | `master-board.metrics.ts` (+spec)                                                                  | Valor = diferencia en pp; sin muestra → `null`                           |
| B2-3 | Tooltip de celdas (nivel y curso) con `SampleTooltipBody`                                                                                         | `master-board-table.tsx`                                                                           | Textos de §5.2; tests de RTL                                             |
| B2-4 | Pintado divergente y leyenda para `sample_delta`; selector de métrica en `MasterBoardControls`                                                    | `master-board-table.tsx`, `master-board-controls.tsx`                                              | Escala bajo / similar / sobre con tokens; gris "sin muestra"; responsive |

### B3 · `/detalle`

| #    | Ticket                                                                                                                           | Archivos                                                    | Aceptación                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| B3-1 | Llenar `references.sample` y `scopes.sample` con B1-1, conjunto = cada ítem                                                      | `item-analysis.service.ts`, `item-analysis.module.ts`       | Profesor → `null`; ítem bajo k → `null`   |
| B3-2 | Tooltip de la pregunta: Curso / Nivel / Muestra con diferencias; "Esta evaluación" si no hay filtro de curso y hay varios cursos | `cross-table.tsx`                                           | RTL                                       |
| B3-3 | Fila "% Logro muestra"                                                                                                           | `cross-table.tsx`                                           | Total sobre columnas visibles con tallies |
| B3-4 | Panel de la pregunta con las tres referencias                                                                                    | `question-detail-panel.tsx`, `/item-analysis/questions/:id` | —                                         |

### B4 · `/resultados` de una evaluación y cierre

| #    | Ticket                                                                                                                                   | Archivos                                                                                     | Aceptación                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| B4-0 | Muestra por nodo desde `benchmark_item_aggregates` + tags, acotada a las preguntas corregidas del grupo (D9); `per_skill` deja de leerse | `benchmark-samples.service.ts`, `report-body.tsx`                                            | Mismo valor que `per_skill` cuando el grupo tiene todo corregido |
| B4-1 | `/dashboards/skills?assessmentId&reference=level` con B1-2                                                                               | `dashboards.service.ts`, controller, DTO                                                     | Mismo resultado que pedir los cursos del nivel a mano            |
| B4-2 | `SkillsBreakdown`: marcas de nivel y muestra, tooltip con `SampleTooltipBody`, nivel omitido sin filtro de curso                         | `skills-breakdown.tsx`, `report-body.tsx`, `evaluaciones/[assessmentId]/resultados/page.tsx` | En todas las dimensiones del selector; RTL                       |
| B4-3 | Telemetría en las tres superficies                                                                                                       | componentes de B2–B4                                                                         | —                                                                |
| B4-4 | Actualización del diseño y paso a la auditoría final (§7.6)                                                                              | —                                                                                            | Hallazgos corregidos                                             |

---

## 5. Orden y dependencias

```
A1 ─ A2 ─┬─ A3 (agentes por dominio) ─ A4 ─ A5 ─ B0 ─ B1 ─┬─ B2 (agente) ─┐
         │                                               └─ B3 (agente) ─┴─ B4 ─ auditoría §7.6 ─ correcciones ─▶ PR mergeable
         └─ PR en borrador (CI desde aquí)
```

- A3 se reparte entre agentes una vez que A1 y A2 están commiteadas y en verde.
- B2 y B3 son independientes entre sí una vez que existen B0 y B1.

## 6. Fuera de alcance (registrado)

- Anulación de una pregunta completa (§3.3 del diseño).
- Puntuar con 0 el desarrollo en blanco (§3.3).
- `instrument-comparison.snapshot.ts` sin filtro de alcance: ticket aparte.
- Contract: borrar `band_distribution` y cualquier `percentage` o conteo que quede sin lectores, en una
  entrega posterior.
- k vuelve a 3 cuando entre un tercer colegio (decisión anterior).

---

## 7. Ejecución autónoma

### 7.1 Reglas que no se rompen

| Regla                      | Detalle                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Sin AWS                    | Cero `aws`, `sst`, túnel, S3 o lectura de demo. Push y PR a GitHub sí: el CI de PR no toca AWS.                                               |
| Un proceso pesado a la vez | Antes de un build, typecheck o test: `pgrep -fl "tsc --build\|vitest\|jest\|next build"`. Si hay uno, esperar.                                |
| Tests en el CI             | En local sólo specs de un archivo (`pnpm --filter @soe/api test <archivo>`).                                                                  |
| Formato                    | `npx prettier --write <archivos propios>`. Nunca `pnpm format` global.                                                                        |
| Push                       | Antes de cada push, en un paso aparte: `gh pr list --head feat/logro-unificado-cohorte --state all`. Si está `MERGED` o `CLOSED`, rama nueva. |
| CI                         | Exigir número de checks y `mergeStateStatus`. "No checks" = conflicto, no espera. Leer el log, no el exit code.                               |
| `apps/api`                 | Sin comentarios. `reportServerError` en los catch.                                                                                            |
| Español                    | Tuteo neutro en UI, docs y commits.                                                                                                           |
| Datos                      | No se tocan respuestas ni puntajes de alumnos. Los scripts de backfill tienen `--dry-run` y son idempotentes.                                 |

### 7.2 Criterios por defecto (para no detenerse)

| Si pasa esto                                                      | Se hace esto                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un spec existente cambia de número                                | Se recalcula a mano con la regla §3.1 y el número nuevo se justifica en el caso. Nunca se copia la salida.                                                    |
| Un lugar del inventario no encaja en la regla                     | Se aplica la regla. Si no es un % de grupo (§3.2), se deja como está y se anota en la PR.                                                                     |
| Aparece otro lugar con la fórmula vieja fuera del inventario      | Se corrige igual y se agrega al inventario §9.                                                                                                                |
| Un umbral de alerta cambia mucho el conteo en la base local       | No se toca el umbral. Se reporta en la PR para decidir con datos de demo (§8).                                                                                |
| Hace falta un texto de UI nuevo                                   | Tuteo neutro, corto, consistente con los textos vecinos y con `SampleTooltipBody`.                                                                            |
| Hace falta un color nuevo                                         | Tokens existentes (`--level-*`, `success`, `warning`, `destructive`, `muted`). Nada hardcodeado.                                                              |
| La escala divergente del tablero                                  | Bajo la muestra < −`similarPp` ≤ similar ≤ `similarPp` < sobre la muestra (`ALERT_THRESHOLDS.cohort.similarPp` = 5).                                          |
| La migración choca con otra de `dev`                              | Rebase sobre `origin/dev`, borrar la propia y regenerar (`feedback-conflicto-migraciones-drizzle`).                                                           |
| El CI falla                                                       | Se corrige en un commit nuevo de la misma fase o con `--amend` + `--force-with-lease` si la fase aún no tiene revisión.                                       |
| Algo del diseño resulta imposible o contradictorio                | Se elige la opción que respeta §3.1 y D1–D9, se implementa y se explica en la sección "Decisiones tomadas en el camino" de la PR. No se detiene la ejecución. |
| Un bloqueo real (credencial, servicio externo, dato sólo en demo) | Se deja el ticket hecho hasta donde se pueda, se marca en la PR como pendiente con el motivo y se sigue con el resto.                                         |

### 7.3 Base local para los gates

1. `createdb soe_logro` en el Postgres local (PG 14: nada de `NULLS NOT DISTINCT`).
2. `DATABASE_URL` y `DATABASE_ADMIN_URL` apuntando a `soe_logro` sólo para esos comandos.
3. `pnpm --filter @soe/db db:migrate` y `db:seed:dev` (seed base, e2e y fixtures de benchmark).
4. Para que haya al menos dos colegios con el mismo instrumento, crédito parcial y preguntas
   pendientes, se agrega un seed local de prueba (`packages/db/src/seed/logro-fixtures.ts`), sólo con
   datos sintéticos y sin RUT reales.
5. Gates por fase:
   - A2: migración sin diff pendiente; `db:backfill:student-scores --dry-run` con 0 discrepancias salvo
     las de A1-2; el chequeo de A2-6 pasa; `db:backfill:cohort-stats` y `db:refresh:benchmark` sin
     errores.
   - A5: `diff-achievement` produce el CSV; su resumen va a la PR.
   - B: el tablero, `/detalle` y `/resultados` cargan contra esta base con un usuario directivo y uno
     profesor (sesión forjada, `NODE_ENV=development`; ver `feedback-e2e-local-sin-demo`).

### 7.4 Definición de terminado

- Fases A1–A5 y B0–B4 commiteadas, un commit por fase, más los commits de corrección de las
  auditorías.
- CI en verde en todos los jobs y PR `MERGEABLE`, con el número de checks verificado.
- Inventario §9 completo: ningún `avg(` sobre `percentage` ni `pctSum` en `apps/api` (guardián A3-11).
- Revisión intermedia A5-2 hecha y sus hallazgos corregidos.
- **Auditoría final §7.6 hecha sobre la PR completa, hallazgos corregidos y re-verificados**, con el CI
  en verde después de las correcciones.
- PR contra `dev` **lista para revisión** (no borrador), mergeable y con el cuerpo de §7.5.
- Worktrees de los subagentes borrados.
- Diseño, plan y `docs/Diseño bdd.md` actualizados.

### 7.5 Cuerpo de la PR

1. Resumen de A y de B.
2. Tabla de commits por fase.
3. Resumen del informe de diferencias en la base local (A5-1).
4. Decisiones tomadas en el camino (§7.2).
5. Pendientes y bloqueos, si hubo.
6. Informe de la auditoría final: qué se revisó, qué encontró, cómo se corrigió y qué quedó como nota.
7. El runbook de §8, copiado tal cual.
8. Firma de Claude Code.

### 7.6 Auditoría final de la PR

Cuando están todas las fases (A1–A5, B0–B4) en la PR y el CI está en verde, un subagente de **sólo
lectura** audita la PR completa contra `origin/dev`. Su encargo:

1. **Regresiones de comportamiento.** Para quien no ve la muestra (profesores, jefes de departamento,
   coordinadores, colegios sin muestra), las vistas muestran lo mismo salvo el cambio de fórmula
   documentado. Ninguna vista se rompe con datos vacíos, `null` o una API anterior (el front y el back
   se despliegan por separado).
2. **Accesos que no se pierden ni se abren.**
   - Cada endpoint tocado mantiene sus `@Roles` y sus guards.
   - Cada página mantiene su gate con `canAccess` y la misma constante de `access-policies`.
   - Las consultas a tablas con RLS siguen dentro de `withOrgContext` usando `tx`.
   - La muestra sólo llega a `BENCHMARKING_VIEWER_ROLES` y nunca en la vista de profesor.
   - Ninguna respuesta expone `org_id` ni datos por alumno de otro colegio; el k-anonimato se exige por
     instrumento y por pregunta.
3. **Datos y deploy.** La migración sólo agrega columnas y es segura con la imagen anterior. Los
   backfills son idempotentes y tienen `--dry-run`. El paso del workflow falla si quedan sumas sin
   calcular.
4. **Fórmula.** No queda ningún % de grupo fuera de la regla §3.1 (inventario §9 y guardián A3-11).
   Los números nuevos de los specs están justificados.
5. **Rendimiento.** Ninguna consulta nueva hace N+1 ni abre conexiones fuera de la transacción.

**Cierre:**

- Cada hallazgo se verifica antes de corregirlo; los falsos positivos se descartan con el motivo.
- Los confirmados se corrigen en un commit `fix: hallazgos de la auditoría`.
- Si las correcciones tocan accesos o consultas, se pide al mismo agente una segunda pasada sólo sobre
  ese commit.
- Con el CI en verde y la PR `MERGEABLE`, se marca lista para revisión.

---

## 8. Runbook con el usuario (después de la PR)

Nada de esto se hace en la ejecución autónoma.

1. **Revisión y merge** de la PR a `dev`.
2. **Informe de diferencias en demo:** túnel, `diff-achievement` en solo lectura, revisión del CSV
   (cambios por evaluación, curso y nodo; conteo de alertas antes y después).
3. **Aviso a CSCJ y San Agustín** de los números que cambian, con el CSV en mano.
4. **Promoción `dev → main`.** Si `main` avanzó su cadena de migraciones, regenerar la de A2 sobre la
   de `main` (`feedback-sync-dev-main-migraciones`).
5. **Deploy de backend.** Orden: migración → `db:backfill:student-scores` → `db:backfill:cohort-stats`
   → `db:refresh:benchmark` → imagen. Confirmar que el chequeo de A2-6 pasó y que las 2 evaluaciones
   de A-7 quedaron en escala 0..100.
6. **Recorrido en demo:** tablero, `/detalle` y `/resultados` con un directivo de CSCJ y otro de San
   Agustín. Un profesor no ve nada nuevo. La métrica "diferencia vs muestra" aparece sólo para
   directivos.
7. **Recapturar** los baselines de `snapshot-panorama`.
8. **Ajuste de umbrales de alertas** si el conteo cambió mucho (decisión con datos).
