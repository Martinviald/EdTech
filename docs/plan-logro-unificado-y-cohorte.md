# Plan de desarrollo — % de logro unificado y contraste con la cohorte

> **Qué es esto:** el plan para construir lo que define
> [`diseno-logro-unificado-y-cohorte.md`](./diseno-logro-unificado-y-cohorte.md). Incluye tickets por
> fase, archivos que toca cada uno, criterios de aceptación, cómo se verifica y en qué orden se
> entrega. Las referencias `§N` apuntan al documento de diseño.
>
> **Fecha:** 2026-10-06 · **Estado:** 📋 plan propuesto, sin código.

---

## 1. Cómo se entrega

### 1.1 Dos PRs, en orden

| PR    | Rama                                | Contenido                                     | Depende de          |
| ----- | ----------------------------------- | --------------------------------------------- | ------------------- |
| **A** | `feat/logro-unificado`              | Definición única del % de logro (fases A0–A5) | —                   |
| **B** | `feat/cohorte-en-tablero-y-detalle` | Contraste con la cohorte (fases B0–B4)        | A mergeada en `dev` |

- Ambas van contra `dev`, con **un commit por fase**. El CI valida cada fase antes de empezar la
  siguiente.
- Van separadas porque la A cambia números en toda la app y se valida con el informe de diferencias
  (A5). Mezclarla con la UI nueva de la B haría imposible separar "cambió la fórmula" de "cambió la
  vista".
- La promoción `dev → main` (que despliega a demo) es aparte. §1.3 dice qué tiene que cuidar.

### 1.2 Verificación

- **En la PR:** CI de GitHub (typecheck, lint y tests de los jobs API, DB, Types y Web). En local sólo
  corren specs de un archivo; la máquina no aguanta las suites completas. Un proceso pesado a la vez.
- **Sin AWS ni demo en modo autónomo.** Las comprobaciones contra la base de demo de A0, A5 y B4 se
  hacen **con el usuario**. Durante el desarrollo, las comprobaciones de datos se hacen en una base
  local nueva.
- **Specs con números reales:** los casos de prueba usan cifras de evaluaciones reales de CSCJ y San
  Agustín (anonimizadas en el spec), igual que en la PR #273.

### 1.3 Lo que la promoción `dev → main` tiene que cuidar

- **Migraciones:** hoy `main` y `dev` comparten la cadena (0040). Si alguna de las dos avanza antes de
  promover, se regenera la migración de A2 sobre la cadena de `main`
  (`feedback-sync-dev-main-migraciones`).
- **Orden en el deploy de backend:** migración → `db:backfill:student-scores` (nuevo) →
  `db:backfill:cohort-stats` → `db:refresh:benchmark` → imagen nueva. El workflow ya corre los dos
  últimos; A2 agrega el primero con su sello y el chequeo que falla si quedan sumas sin calcular.
- **Aviso a los colegios** antes del deploy de la PR A, con el informe de diferencias en mano.

### 1.4 Subagentes

Sólo donde suma: la fase A3 (unos 20 servicios con el mismo cambio mecánico) se puede repartir por
dominio. Los contratos de A0 y el helper de A1 se commitean **antes** de lanzar agentes, y a cada
agente se le pasan las reglas de `.claude/rules/backend` (cero comentarios en `apps/api`,
`reportServerError` en los catch). La integración y la revisión final las hago yo.

---

## 2. Decisiones

Todas tomadas (§2 del diseño). Queda un pendiente **de datos**, no de diseño: cuántas evaluaciones no
tienen puntajes (§8). Se cuenta en A0 y, si son muchas, se decide ahí cómo presentarlas.

---

## 3. PR A — % de logro unificado

### A0 · Verificación de datos (con el usuario, sin código)

| #    | Qué                               | Cómo                                                                                                                    | Sale                                                  |
| ---- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A0-1 | Evaluaciones sin datos de puntaje | Contar en demo las evaluaciones con resultados donde `total_score / max_score` es null y no hay `assessment_item_stats` | Lista por colegio. Si hay, decisión de presentación.  |
| A0-2 | Secciones electivas en DIA 2026   | ¿Algún instrumento DIA 2026 tiene `instrument_sections.role = 'elective'`?                                              | Si hay, revisar respuestas de ramas no rendidas (A-3) |
| A0-3 | Foto "antes"                      | Correr `snapshot-panorama` y el script de A5 sobre demo, sin cambios                                                    | Base del informe de diferencias                       |

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
| A2-5 | Backfill de cohorte: pasada para evaluaciones `aggregate_only` (re-deriva skill stats importadas desde sus item stats)                                                                               | `backfill-cohort-stats.ts`, huella en `lib/cohort-stats-fingerprint.ts`                              | La huella cambia → el deploy reconstruye                                      |
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

| #    | Ticket                                                                                                                                                                                        | Aceptación                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A5-1 | Script `apps/api/scripts/diff-achievement.ts`: para cada evaluación, curso y nodo, % antes (fórmula vieja, recalculada en el script) y después; conteo de alertas antes y después; salida CSV | Corre en local; en demo se corre **con el usuario** antes de promover |
| A5-2 | Auditoría de regresiones con un subagente (vistas, permisos, rendimiento de las consultas cambiadas)                                                                                          | Hallazgos corregidos en un commit aparte                              |
| A5-3 | Actualizar `docs/Diseño bdd.md` (columnas nuevas, significado único de `percentage`) y el diseño                                                                                              | —                                                                     |

---

## 4. PR B — Contraste con la cohorte

### B0 · Contratos

| #    | Ticket                                                                                                                           | Archivos                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| B0-1 | `CellSample` en `MasterBoardCell` / `MasterBoardCourseCell`; `MetricKey` gana `sample_delta`                                     | `master-board.schema.ts`, `metric` keys              |
| B0-2 | `QuestionReferences.sample: SampleReferenceRate \| null` (tally + `schoolCount`, `studentCount`); `MatrixReferenceScopes.sample` | `item-analysis.schema.ts`                            |
| B0-3 | `reference=level` en el query de `/dashboards/skills`; `gradeId` y `academicYearId` en `AssessmentReportMeta` si hacen falta     | `dashboard.schema.ts`, `assessment-report.schema.ts` |
| B0-4 | Superficies de telemetría `master_board`, `item_matrix`, `skills_breakdown`                                                      | `telemetry.schema.ts`                                |

### B1 · Muestra para cualquier conjunto de ítems

| #    | Ticket                                                                                                                                                                                                                         | Archivos                                                                           | Aceptación                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| B1-1 | `BenchmarkSamplesService.getItemSetSamples(itemSets, db)`: una consulta a `benchmark_item_aggregates`; por conjunto, tally de la muestra, tally por colegio (para el percentil), k por ítem; un registro de acceso por request | `benchmark-samples.service.ts` (+spec)                                             | Conjuntos = instrumento completo o sección; un ítem bajo k excluye el conjunto; specs con números reales |
| B1-2 | Helper de población del nivel, extraído de `item-analysis` (mismo instrumento, nivel y año) y reutilizado por `/detalle` y por `/dashboards/skills?reference=level`                                                            | `common/helpers/level-cohort.helper.ts` o servicio, según `03-helpers-vs-services` | Misma población que la fila del nivel actual                                                             |

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

| #    | Ticket                                                                                                                                                       | Archivos                                                                                     | Aceptación                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| B4-1 | `/dashboards/skills?assessmentId&reference=level` con B1-2                                                                                                   | `dashboards.service.ts`, controller, DTO                                                     | Mismo resultado que pedir los cursos del nivel a mano |
| B4-2 | `SkillsBreakdown`: marcas de nivel y muestra, tooltip con `SampleTooltipBody`, nivel omitido sin filtro de curso                                             | `skills-breakdown.tsx`, `report-body.tsx`, `evaluaciones/[assessmentId]/resultados/page.tsx` | En todas las dimensiones del selector; RTL            |
| B4-3 | Telemetría en las tres superficies                                                                                                                           | componentes de B2–B4                                                                         | —                                                     |
| B4-4 | Auditoría de regresiones con subagente y actualización del diseño                                                                                            | —                                                                                            | Hallazgos corregidos                                  |
| B4-5 | **En demo, con el usuario, tras promover:** tablero, `/detalle` y `/resultados` con un directivo de CSCJ y otro de San Agustín; un profesor no ve nada nuevo | —                                                                                            | Checklist firmada                                     |

---

## 5. Orden y dependencias

```
A0 (datos) ─┐
A1 ─ A2 ─ A3 ─ A4 ─ A5 ──▶ merge A ─▶ B0 ─ B1 ─┬─ B2 ─┐
                                              ├─ B3 ─┼─ B4 ─▶ merge B
                                              └──────┘
```

- A3 se puede repartir entre agentes por dominio una vez que A1 y A2 estén commiteadas.
- En la B, B2 y B3 son independientes entre sí una vez que existen B0 y B1.

## 6. Fuera de alcance (registrado)

- Anulación de una pregunta completa (§3.3 del diseño).
- Puntuar con 0 el desarrollo en blanco (§3.3).
- `instrument-comparison.snapshot.ts` sin filtro de alcance: ticket aparte.
- Contract: borrar `band_distribution` y cualquier `percentage` o conteo que quede sin lectores, en una
  entrega posterior.
- k vuelve a 3 cuando entre un tercer colegio (decisión anterior).
