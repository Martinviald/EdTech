# Plan — `getOverview` agregado + Distribución por nivel (Bloque B), con subagentes

> Continuación de la analítica agregada de informes DIA. El **Bloque A** (logro, cobertura y ejes de
> habilidad en el detalle de evaluación) ya está mergeado (PRs #48/#49). Quedan dos follow-ups de la
> misma familia: (1) que el dashboard cuente los informes agregados, y (2) la distribución por nivel
> de desempeño, que hoy sale vacía. Este plan descompone ambos en tareas de subagente con contratos.

---

## Contexto

- **`getOverview`** (`apps/api/src/dashboards/dashboards.service.ts:122`) calcula sus KPIs
  (`globalAchievement`, `studentsEvaluated`, `assessmentsCount`, `performanceDistribution`)
  **solo desde `assessment_results`** (per-alumno). Los 38 informes agregados no tienen esas filas →
  no cuentan en la página `/resultados` (endpoint `/dashboards/overview`). El servicio YA tiene el
  patrón agregado en `getSkills`/`getSkillBreakdown` (leen `assessment_skill_stats` por defecto).
- **Distribución por nivel (I/II/III)**: no está en nuestras 48 extracciones (`levelDistribution`
  siempre `[]`); vive en el **Gráfico 1 raster** del PDF. La cadena de importación ya la acepta,
  previsualiza y valida (gate #4, no bloqueante), pero **no la persiste** en ninguna tabla, y el
  extractor la deja vacía a propósito por el problema de OCR de los numerales romanos.

**Objetivo:** dashboard que refleje los 38 informes, y la torta de niveles + "requiere apoyo" pobladas
en ambas vistas, con datos re-extraídos y validados.

---

## Contratos compartidos (fijar ANTES de despachar subagentes)

> Los peores bugs quedan ENTRE tareas de subagente. Estas decisiones son el contrato; ningún agente
> las cambia por su cuenta.

1. **Valores de nivel**: strings `'I'`, `'II'`, `'III'` (contrato ya existente,
   `officialReportLevelShareSchema` en `packages/types`). El extractor asigna por **posición**
   (izq→der = I→II→III), NO por OCR del numeral. `resolveLevelBand` los mapea a la banda del
   instrumento por key/label.
2. **Tabla nueva `assessment_level_stats`** (read-model de cohorte, **conteos enteros nunca %**),
   grano `(assessment_id, class_group_id, performance_band_id)`, columnas: `student_count int`,
   `source stats_source` (`'imported'`), timestamps. Unique en la tripleta. FK a `performance_bands.id`.
   Espejo exacto de `assessment_skill_stats` (`packages/db/src/schema/results.ts:190`). Va en
   `results.ts` → se auto-exporta por el barrel. RLS = ENABLE+FORCE + policy EXISTS-sobre-assessments
   en `packages/db/sql/rls-policies.sql` (re-aplicada por `db:migrate`).
3. **De % a conteos**: `reconstructCountsFromPercentages(pcts, N)` de
   `packages/types/src/utils/item-stats-calculator.ts:407` (round(pct/100 × N)); N = `report.studentCount`.
4. **`getOverview` cuenta la UNIÓN**: un colegio tiene evaluaciones `item_level` Y agregadas.
   `assessmentsCount` = distinct assessmentId de `assessment_results` ∪ del read-model de cohorte.
   `globalAchievement` = mezcla ponderada por N (results per-alumno + cohorte item-weighted); si se
   prefiere no mezclar semánticas, dejarlo results-only y documentarlo. `studentsEvaluated`:
   per-alumno de results; para agregados no hay identidad de alumno → se suma la N de cohorte con
   caveat de posible doble conteo entre evaluaciones del mismo curso (aceptable en un KPI de landing).
5. **Reutilizar helpers existentes**, no reimplementar: `cohort-skill-stats.helper`
   (COHORT_PCT_SUM/WEIGHT, cohortAverage) y `cohort-item-stats.helper` (`loadCohortOverallAchievement`,
   creado en Bloque A).

---

## Parte 1 — `getOverview` agregado (independiente, solo código)

**Subagente P1 (backend).** Sin cambio de schema, sin re-extracción. Corre en paralelo con todo.

- Añadir a `getOverview` una contribución agregada leída del read-model de cohorte
  (`assessment_skill_stats` para logro/N, y/o `assessment_item_stats` vía `loadCohortOverallAchievement`),
  scopeada igual que hoy (org + cursos accesibles, dentro de `withOrgContext`).
- Combinar con la rama de `assessment_results`: `assessmentsCount` y `studentsEvaluated` incluyen los
  agregados; `globalAchievement` según contrato #4. `performanceDistribution` queda como está (per-alumno)
  hasta que exista `assessment_level_stats` (entonces se le puede sumar; ver Parte 2 B5, opcional).
- Mirar el patrón de `getSkills`/`getSkillBreakdown` (`dashboards.service.ts:458`, `:659`) para el estilo.
- **Frontend**: sin cambios (los KPIs degradan a `—`/`0` solos). Verificar `resultados/page.tsx:53`.
- **Verificar aparte** (no en este PR): el landing `/dashboard` usa OTRO endpoint
  (`/organizations/me/overview`); anotar si tiene el mismo gap para un follow-up.
- **Tests**: extender `dashboards.service.spec.ts` — org con solo agregados → `assessmentsCount`>0 y
  `studentsEvaluated`>0; org mixta → cuenta ambos; item_level puro → sin regresión.

Entregable: PR a dev+main. **No depende de nada de la Parte 2.**

---

## Parte 2 — Distribución por nivel (Bloque B)

### B1 — Re-extracción del Gráfico 1 (spike + batch) · Python, fuera del repo

**Subagente B1 (data/OCR).** Es el **camino crítico y el mayor riesgo**; se valida primero.

- Código en `../.claude/skills/extraer-informes-dia/extraer_informe.py`. Hoy `build()` (`:496`) deja
  `levelDistribution: []`. Añadir `parse_level_distribution()` modelado en `parse_skill_axes` (`:263`):
  `pdfimages → tesseract tsv → match por coordenada X`, localizando la página con el patrón
  "Gráfico 1 … niveles de logro".
- **Estrategia del numeral (el problema conocido)**: tomar las 3 (o 2) barras/segmentos por **posición
  espacial** y asignarlas I→II→III en orden; NO fuzzy-match del romano (I/II/III están a edit-distance 1).
  Reusar `_as_pct`/`VALUE_SIN_PUNTO` (`:384`) para el punto decimal comido por OCR.
- **Gate de spike (antes de batch)**: (a) confirmar que ninguna variante trae los % en la capa de texto
  (si los trae, parsear sin OCR); (b) validar 4–6 informes a mano contra el PDF; (c) los % suman ~100±1;
  (d) los conteos reconstruidos suman N. **Si la extracción no llega a confiable, B1 se detiene y se
  reporta** — B3/B4/B5 entregan valor solo con datos válidos.
- Correr el batch (`extraer_lote.py`) sobre los 48 PDFs; extender `validar_vs_cuadernillos.py` con un
  chequeo de suma-100/suma-N para niveles.

Entregable: 48 JSONs con `levelDistribution` poblado + reporte de validación. Paralelo a B2.

### B2 — Tabla `assessment_level_stats` + migración + RLS · Drizzle

**Subagente B2 (schema).** Independiente; base de B3/B4/B5.

- Añadir la tabla a `packages/db/src/schema/results.ts` (contrato #2) + `relations` + `$inferSelect/Insert`.
- `pnpm db:generate` (migración) + espejar los dos bloques RLS en `packages/db/sql/rls-policies.sql`
  (ENABLE+FORCE + policy EXISTS). Verificar que `db:migrate` aplica ambos.
- No tocar `index.ts` (barrel ya re-exporta `results.ts`).

Entregable: migración + RLS. **B3/B4/B5 dependen de esto.**

### B3 — Persistencia en el importador · depende de B2

**Subagente B3 (backend).** En `official-report-import.service.ts` `confirm()`: además de item/skill stats,
escribir `assessment_level_stats` desde `evaluation.levelDistribution` — `resolveLevelBand` por nivel,
`reconstructCountsFromPercentages(pcts, report.studentCount)` para el conteo, `source:'imported'`,
delete+reinsert por `(assessment, classGroup)` (idempotente como item/skill). Test unitario del confirm.

### B4 — Backfill de las 38 cohortes ya cargadas · depende de B1 + B2

**Subagente B4 (data/DB).** ⚠️ El `levelDistribution` en `import_jobs.mapping_config.report` de las 38
está **vacío** (se importó antes de B1) → el backfill lee los **JSONs re-extraídos de B1**, los matchea
al assessment existente por `(instrument, classGroup, period)`, resuelve bandas e inserta level stats.
Evita re-importar (esquiva el bug de idempotencia de `resolveAssessment`). Nuevo
`packages/db/src/scripts/backfill-level-stats.ts` + script `db:backfill:level-stats`; correr por org dentro
de `withOrgContext`. Wire en `.github/workflows/deploy-backend.yml` tras la línea del backfill de cohorte
(dentro del mismo túnel SSM, antes de `build-and-push`).

### B5 — Ramas de lectura + frontend · depende de B2 (lee la tabla)

**Subagente B5 (backend+frontend).**
- `assessment-report.service`: en agregado, `buildDistribution`/`bandDistribution` desde
  `assessment_level_stats` (en vez del vacío actual del guard).
- `course-report.service`: §2 `buildGeneralResult` distribución + `requiresSupportCount` (banda más baja)
  desde la tabla, en modo agregado.
- Frontend `course-report.tsx`: quitar las notas "no disponible" de Bloque A cuando el nivel ya está
  (condicionar a que haya datos, no a `dataGranularity`). Opcional: sumar la distribución agregada a
  `getOverview.performanceDistribution` (Parte 1).
- Tests de ambos servicios.

---

## Orquestación (olas)

- **Ola 1 (paralelo):** P1 (getOverview) ‖ B1 (extracción, spike→batch) ‖ B2 (schema).
- **Ola 2 (tras B2):** B3 (importer) ‖ B5 (lectura+frontend). **Tras B1+B2:** B4 (backfill).
- **Integración:** juntar en una rama, `/code-review`, correr typecheck+lint+tests, smoke en demo.
- **Gate duro:** si B1 no produce datos válidos, B3/B4/B5 quedan sin insumo real — P1 y B2 igual entregan
  (dashboard + tabla lista), y B1 se re-agenda. No mergear B5 mostrando una torta vacía/errónea.

**Despliegue:** P1 es solo lectura (no requiere backfill). Bloque B: al mergear a main, `db:migrate` crea
la tabla y `db:backfill:level-stats` debe correr en el mismo job (si no, la torta sale en blanco en demo,
misma trampa que el backfill de cohorte).

---

## Verificación (end-to-end)

1. `pnpm typecheck`/`lint` en `@soe/types`,`@soe/api`,`@soe/web` (sin `pnpm format` global).
2. Tests nuevos: `dashboards.service.spec` (P1), `official-report-import` (B3), `assessment-report` +
   `course-report` (B5), validación de niveles en el batch (B1).
3. Smoke en demo (skill `demo-db-access`, cerrar túnel al terminar): tras el backfill, `getOverview`
   cuenta los 38; `getReport`/`getCourseReport` de `fb1c6b25` devuelven la distribución por nivel con
   % que cuadran con el Gráfico 1 del PDF.
4. Visual en CloudFront: dashboard con los informes contados; torta de niveles y "requiere apoyo"
   pobladas en `/resultados` e `/informe-oficial`.

## Riesgos
- **B1 es el riesgo real**: OCR de un raster con numerales ambiguos. Mitigación: asignación posicional +
  gate de validación (suma-100, suma-N, spot-check). Si falla, el resto del Bloque B espera.
- **Idempotencia del importador** (deuda previa): B4 la esquiva usando backfill directo, no re-import.
- **Semántica mixta en `globalAchievement`** (P1): decisión de contrato #4; documentar la fórmula elegida.
