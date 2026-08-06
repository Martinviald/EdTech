# Diseño — Tablero Maestro de Resultados

> Documento de diseño técnico y de producto para la nueva vista **"Tablero Maestro"**: una matriz
> Asignaturas × Cursos (agrupados por Nivel) de % de logro, filtrable por una "toma" de evaluaciones,
> con drill-down por nivel→curso, tooltip de profesor por asignatura y navegación al detalle de la
> evaluación del curso.
>
> Estado: **propuesta de diseño** (pre-implementación). Alineado con `CLAUDE.md` y las reglas de
> `.claude/rules/`. Este documento define qué reutilizar, qué construir y en qué orden.

---

## 1. Objetivo y alcance

### 1.1 Qué queremos

Un tablero director-first que responde de un vistazo: **"¿cómo le fue a cada curso/nivel en cada
asignatura en esta toma de pruebas?"**

- **Filtro superior:** selecciona una *toma* de evaluaciones (p. ej. "DIA Intermedio 2025",
  "Ensayo SIMCE #2", "Mock Cambridge Agosto").
- **Matriz:** columnas = asignaturas; filas = **niveles** con % de logro agregado; cada nivel se
  **expande** a sus cursos mostrando el % de logro por curso × asignatura.
- **Tooltip de profesor:** al pasar el cursor sobre un curso/celda, se muestra el docente de esa
  asignatura en ese curso; es clickeable y lleva a una vista con todos los cursos que hace ese
  profesor y su desempeño.
- **Click en celda de curso:** navega al detalle de la evaluación de ese curso (vista ya existente).

### 1.2 Alcance de esta entrega

- **Dentro:** la vista tablero, su endpoint de matriz, el mecanismo de "toma", el tooltip de
  profesor y la vista de desempeño del profesor.
- **Fuera (documentado como punto de extensión, no implementar ahora):** tabla explícita de
  "campañas/tomas" nombradas (`assessment_campaigns`), benchmarking inter-colegio en el tablero,
  predicción ML. Ver §5.3 y §11.

### 1.3 Hallazgo estructural clave

**La base de datos ya soporta el 100% de las relaciones necesarias.** No se requiere ningún cambio
de schema para el núcleo de la feature:

- Nivel ↔ curso: `grades` ← `class_groups.grade_id`.
- Curso ↔ asignatura: `subject_classes(class_group_id, subject_id, academic_year_id)`.
- Evaluación ↔ asignatura ↔ nivel: `instruments(subject_id, grade_id, application_period, type, year)`.
- Evaluación ↔ cursos: `assessment_course_assignments(assessment_id, class_group_id)`.
- **Profesor ↔ asignatura ↔ curso:** `teacher_assignments(user_id, subject_class_id, role)` →
  `subject_classes` → `subjects` + `class_groups`. Responde exactamente "¿quién es el profe de
  Matemática del 3°A?".
- Resultados agregados por curso: read-models `assessment_item_stats`, `assessment_skill_stats`,
  `assessment_level_stats` (grano `assessment × class_group × …`).

Lo que falta es **capa de aplicación** (un endpoint de matriz + una vista + una página de profesor),
no capa de datos.

---

## 2. Requerimientos (restatement)

| # | Requerimiento | Traducción técnica |
|---|---|---|
| R1 | Filtrar por una *toma* de evaluaciones que define qué evaluaciones mostrar | Definir el concepto de "toma" (§4.1) y un selector que resuelve un conjunto de `assessmentId`s |
| R2 | Matriz: columnas asignaturas, filas niveles con % logro; expandible a cursos | Endpoint de matriz (§6) + tabla con filas colapsables (§7.3) |
| R3 | Tooltip con profesor (nombre) sobre el curso, clickeable → cursos del profe con desempeño | Incluir `teacher` por celda en la respuesta (§6.4) + nueva página de profesor (§7.5) |
| R4 | Click en celda de curso → detalle de la evaluación de ese curso | Navegar a `ROUTES.evaluacionDetalle(assessmentId)?classGroupId=…` (§7.4) |

---

## 3. Inventario de reutilización (estado actual del código)

### 3.1 Datos (`packages/db/src/schema/`) — reutilizable tal cual

| Tabla | Rol en el tablero |
|---|---|
| `grades` (`academic.ts`) | Filas nivel; `order`, `cycle`, `short_name` |
| `class_groups` (`academic.ts`) | Cursos; `grade_id`, `academic_year_id`, `org_id`, `name` |
| `subjects` (`academic.ts`) | Columnas; catálogo global `name`/`short_name`/`code` |
| `subject_classes` (`academic.ts`) | Puente curso×asignatura×año; ancla de `teacher_assignments` |
| `instruments` (`instruments.ts`) | `subject_id`, `grade_id`, `type`, `application_period`, `year`, `grading_scale_id` |
| `assessments` (`assessments.ts`) | Instancia aplicada; `instrument_id`, `administered_at`, `status`, `data_granularity` |
| `assessment_course_assignments` (`assessments.ts`) | Evaluación ↔ cursos que la rinden |
| `teacher_assignments` (`users.ts`) | `user_id`, `subject_class_id`, `role` (`primary`/`assistant`) |
| `assessment_item_stats` (`results.ts`) | Read-model item×curso → % de logro del curso (`score_sum/max_sum`) |
| `assessment_skill_stats` (`results.ts`) | Read-model habilidad×curso |
| `assessment_level_stats` (`results.ts`) | Distribución por banda×curso |
| `assessment_results` (`results.ts`) | Per-alumno `percentage`/`grade`/banda |
| `performance_bands` (`results.ts`) | Bandas configurables por instrumento/escala/org |

**Enums confirmados:**
- `instrument_type`: `dia | simce | paes | cambridge_mock | aptus | desafio | pal | custom`
  (`packages/db/src/schema/enums.ts`, `packages/types/src/enums.ts:43`).
- `instrument_application_period`: `diagnostico | intermedio | cierre` (**nullable**, orientado a DIA)
  (`packages/db/src/schema/enums.ts:81`).

### 3.2 Backend (`apps/api/src/`) — helpers y lógica a reutilizar

| Pieza | Ubicación | Reutilización |
|---|---|---|
| Promedio ponderado de cohorte | `cohortAverage()` + `COHORT_PCT_SUM/WEIGHT` en `heatmap/cohort-skill-stats.helper.ts` | **Sí** — es la fórmula única de `Σ(pct×students)/Σ(students)` |
| % de logro por alumno / habilidad | `aggregateStudentResults()`, `aggregateSkillResults()` en `@soe/types` `utils/grade-calculator.ts` | **Sí** — funciones puras |
| % → nivel / banda | `percentageToPerformanceLevel()`, `percentageToGrade()` (mismo archivo) | **Sí** |
| Opciones de filtro | `DashboardsService.getFilterOptions()` (`dashboards/dashboards.service.ts`) | **Sí** — extender para "tomas" |
| Comparabilidad | `buildComparabilityMeta()` / `resolveScaleAndComparability()` | **Sí** — gatea el coloreo por nivel |
| Combinación per-alumno + cohorte | `DashboardsService.getOverview()` (une `assessment_results` + `assessment_item_stats` sin doble-contar) | **Patrón a replicar** en la agregación del tablero |
| Scoping por rol | `getAccessibleClassGroupIds()` (replicado en heatmap/analytics/dashboards) | **Sí** — reutilizar el mismo criterio |
| Asignaciones docentes | `teacher-assignments.service.ts`, `class-groups.service.ts` (`getClassGroupDetail` ya devuelve `subjects[].teachers[]`) | **Sí** — fuente del profe por celda |

### 3.3 Frontend (`apps/web/src/`) — componentes y patrones a reutilizar

| Pieza | Ubicación | Reutilización |
|---|---|---|
| Colores/labels de desempeño | `resultados/components/performance-level.ts` (`PERFORMANCE_LEVEL_LABELS`, `..._BADGE_CLASS`, `..._BAR_CLASS`, `..._CHART_COLOR`, `formatAchievement`) | **Sí** — tokens `bg-level-*` |
| Badge de desempeño | `resultados/components/performance-badge.tsx` (`PerformanceBadge`, soporta `band`) | **Sí** |
| Celda coloreada + tooltip | `resultados/mapa-calor/heatmap-table.tsx` (`HEAT_CELL_CLASS`, `TooltipProvider delayDuration={150}`) | **Patrón directo** para las celdas |
| Filas expandibles (chevron + `Set<string>`) | `estudiantes/components/skill-tree.tsx` | **Patrón directo** para nivel→curso |
| Fila clickeable → detalle | `resultados/components/comparable-units-table.tsx` (`unitHref`, `ArrowRight` hover) | **Patrón directo** para navegación de celda |
| Filtros dashboard | `resultados/components/dashboard-filters.ts` (`parseDashboardFilters`, `buildDashboardQuery`) + `dashboard-filter-bar.tsx` | **Extender** con la dimensión "toma" |
| Sub-nav de resultados | `components/layout/view-tabs.tsx` (`RESULTADOS_TABS`) + `resultados/components/resultados-nav.tsx` (`PageTabs`) | **Extender** con un tab nuevo |
| Rutas | `apps/web/src/lib/routes.ts` | **Extender** (`tableroMaestro`, `profesor(id)`) |
| Reactividad de navegación | reglas `frontend/07-navigation-reactivity.md` (Suspense, `loading.tsx`, `useTransition`+`TopProgressBar`) | **Obligatorio** seguir |

### 3.4 Lo que NO existe hoy (a construir)

1. **Endpoint de matriz** asignatura × (nivel→curso). El `/heatmap` actual es habilidad × asignatura
   (filas = `taxonomy_nodes`), **no** sirve. Se necesita una agregación nueva por
   `(subject, grade, class_group)` con % global del curso.
2. **Concepto/selector de "toma"** (agrupación de evaluaciones). Hoy los períodos son implícitos
   (`instruments.application_period` + año + tipo).
3. **Vista/página del tablero maestro** (tab nuevo).
4. **Página de desempeño de un profesor** (`/equipo/[userId]`, decisión P4a). No hay ninguna ruta de
   perfil de profesor hoy.
5. **Endpoint "cursos y desempeño de un profesor"** (`GET /master-board/teachers/:userId/performance`).

---

## 4. Decisiones de diseño (deliberaciones)

### 4.1 Decisión clave — cómo agrupar evaluaciones en una "toma"

El requerimiento pide "un periodo o toma de evaluaciones" y explícitamente nos pide *deliberar* si
conviene asociar varias evaluaciones a una toma o usar otro método.

**Contexto:** No existe una tabla que agrupe evaluaciones. Los períodos hoy son implícitos:
`instruments.application_period` (`diagnostico`/`intermedio`/`cierre`, nullable) + `academic_year` +
`instrument.type`. Una "toma DIA Intermedio" es, naturalmente, *todas las evaluaciones cuyo
instrumento es `type=dia`, `application_period=intermedio`, del año seleccionado* — abarcando varias
asignaturas y niveles, que es exactamente la forma de la matriz.

**Opciones evaluadas:**

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| **A. Toma derivada (implícita)** | Clave de agrupación = `(academic_year_id, instrument_type, application_period?)` | Cero cambios de schema; cubre DIA limpiamente; los datos ya lo permiten | Para tipos sin `application_period` (SIMCE, Cambridge) y ensayos repetidos, colapsa varios ensayos en una sola "toma" |
| **B. Selección libre de evaluaciones** | El usuario elige a mano los `assessmentId`s que componen el tablero | Máxima flexibilidad; cubre ensayos repetidos y cortes ad-hoc; cero schema | Más fricción; no hay un "nombre" persistente de la toma |
| **C. Tabla explícita `assessment_campaigns`** | FK `assessments.campaign_id` → `assessment_campaigns(id, org_id, name, academic_year_id)` | Tomas nombradas y persistentes ("Ensayo SIMCE Agosto") | Cambio de schema + nueva UI de gestión; F2+ según scope; contradice "no construir F2 en F1" |

**Recomendación: A + B ahora; C documentada como extensión futura.**

1. **Primario (esta entrega, cero schema):** *Toma derivada*. El selector ofrece las tomas
   detectadas agrupando por `(academic_year_id, instrument_type, application_period)`. Para DIA
   produce "DIA Diagnóstico / Intermedio / Cierre {año}" de forma perfecta. Para tipos sin
   `application_period`, la clave degrada a `(academic_year_id, instrument_type)` y — si hay varias
   rondas — se desambigua por *bucket de fecha* (`administered_at` por mes) para no fusionar ensayos
   distintos.
2. **Escape hatch (esta entrega, cero schema):** modo *selección libre*. El selector permite
   "Personalizada" → multiselección de evaluaciones. Cubre ensayos repetidos y cruces arbitrarios.
   Se serializa como `assessmentId[]` en la URL.
3. **Extensión futura (F2+, no implementar):** `assessment_campaigns` para tomas nombradas y
   reutilizables. Punto de extensión limpio: `assessments.campaign_id` nullable; el endpoint de
   matriz aceptaría `campaignId` como una tercera forma de resolver el conjunto de assessments, sin
   romper A ni B. Esto respeta la guía de "dejar el punto de extensión documentado, no implementar
   features de F2+ en F1" (CLAUDE.md §8.1, §14).

**Contrato del selector de toma → conjunto de assessments.** El endpoint acepta *cualquiera* de:
- `takeKey` = `"{academicYearId}:{instrumentType}:{applicationPeriod|_}"` (toma derivada), **o**
- `assessmentId[]` (selección libre), **o** (futuro) `campaignId`.

El backend resuelve internamente a un conjunto de `assessmentId`s y de ahí calcula. Esto mantiene el
resto del pipeline idéntico sin importar cómo se eligió la toma → **Open/Closed**: agregar
`campaignId` mañana no toca la agregación.

### 4.2 Cálculo del valor de celda (% de logro)

Una celda es `(nivel|curso) × asignatura` sobre el conjunto de assessments de la toma.

- **Fuente:** reutilizar el patrón de `DashboardsService.getOverview()` que combina per-alumno
  (`assessment_results`) y cohorte importada (`assessment_item_stats`, DIA oficial) sin doble-contar.
  Para el % *global* del curso en una asignatura: `Σ score_sum / Σ max_sum` sobre `assessment_item_stats`
  del curso (source `imported`), y `avg(percentage)` sobre `assessment_results` del curso (source
  `computed`).
- **Rollup nivel:** `cohortAverage()` = `Σ(pct_curso × alumnos_curso) / Σ(alumnos_curso)` sobre los
  cursos del nivel. **Ponderado por número de alumnos**, nunca promedio simple (evita el sesgo de
  cursos chicos). Es la fórmula única ya usada por el heatmap — no reimplementar (DRY, CLAUDE.md §4.2).
- **% → nivel de desempeño / banda:** `percentageToPerformanceLevel()` con thresholds resueltos del
  instrumento (o `performance_bands` si el instrumento las define).
- **Agregado crudo (`CellAggregate`) como seam de extensibilidad:** la agregación no produce un
  número final directo, sino un `CellAggregate` por celda (`scoreSum`, `maxSum`, `studentsAssessed`,
  `studentsTotal`, `gradeSum`, `bandCounts`, agregado previo). Las métricas se derivan de él (§4.7).
  La 1ª entrega sólo usa `scoreSum/maxSum`, pero el agregado se calcula completo porque son SUM/COUNT
  del mismo query (costo marginal cero) y así una métrica nueva no obliga a re-consultar.
- **Complejidad:** la asamblea en memoria debe ser O(N) con `Map`s en una sola pasada, siguiendo
  `HeatmapService.assembleResponse()` (regla `backend/04-collection-complexity.md`). Nada de `.find()`
  por celda.

### 4.3 Comparabilidad — cuándo se puede colorear por nivel

Una toma puede mezclar instrumentos con distinta escala de calificación. El % es siempre válido, pero
la **clasificación por nivel** (colores insuficiente/elemental/adecuado/avanzado) sólo es válida si
los instrumentos son comparables. Reutilizar `comparability: ComparabilityMeta`:
- `aggregatable=true` → celdas coloreadas por nivel + leyenda.
- `aggregatable=false` → mostrar % en escala neutra + `AlertCallout` "Resultados de múltiples
  instrumentos; los colores por nivel no aplican" (patrón ya existente en la vista de resultados).

Dado que una toma derivada agrupa por `instrument_type`, en la práctica casi siempre será comparable;
la selección libre es el caso donde puede no serlo.

### 4.4 Dónde vive el tooltip del profesor (decisión de UX + shape de API)

El requerimiento dice "tooltip sobre el nombre del curso con el nombre del profe" y a la vez "el
profesor de cada asignatura de cada curso". Un curso tiene **varios** profesores (uno por asignatura),
así que un único tooltip en el nombre del curso es ambiguo.

**Recomendación:** el indicador/tooltip de profesor vive **en la celda** `(curso × asignatura)`,
porque ahí "el profesor de esa asignatura en ese curso" es único y coincide con el destino del click
de R4. Adicionalmente, el **encabezado de fila del curso** puede mostrar al profesor jefe
(`homeroom_teacher`) si existe, como cortesía. Esto:
- Resuelve la ambigüedad sin inventar datos.
- Encaja con `class_groups.service.ts::getClassGroupDetail` que ya devuelve `subjects[].teachers[]`
  con rol `primary|assistant`.
- Mantiene la API limpia: cada celda de curso lleva `teacher: { userId, name } | null` (el `primary`
  de esa `subject_class`).

> **Decisión confirmada (P1):** el tooltip de profesor se ancla **en la celda** `(curso × asignatura)`,
> donde el profe es único. El encabezado de curso muestra el profesor jefe como cortesía cuando exista.

### 4.5 Destino del click en celda

- **Celda a nivel de curso** (fila expandida): si la intersección `(curso, asignatura)` en la toma
  tiene **exactamente un** assessment → navegar a `ROUTES.evaluacionDetalle(assessmentId)?classGroupId=…`
  (vista existente, `apps/web/.../evaluaciones/[assessmentId]/detalle`). Si tiene **>1** (p. ej.
  selección libre con dos evaluaciones de la misma asignatura para ese curso) → navegar a la lista de
  resultados filtrada (`ROUTES.evaluaciones?...` o un desambiguador). La respuesta de la matriz
  incluye `assessmentIds: string[]` por celda para decidir en el cliente.
- **Celda a nivel de nivel** (fila colapsada): el click primario **expande** el nivel (no navega),
  porque agrega varios cursos. El chevron y el click en la etiqueta del nivel togglean; las celdas
  del nivel muestran el agregado pero no son un destino de detalle único.

### 4.6 Ubicación de la vista en la navegación

**Decisión confirmada (P2):** nuevo tab **"Tablero maestro"** dentro de `/resultados` (agregar a
`RESULTADOS_TABS` en `view-tabs.tsx`), junto a "Mapa de calor". Comparte contexto, filtros y el shell
de `resultados/layout.tsx`. Ruta: `/resultados/tablero-maestro`.

### 4.7 Métricas extensibles — partir con "% de logro", diseñar para agregar más (P5)

**Decisión confirmada (P5):** la primera entrega muestra **% de logro global del curso**, pero la
feature se diseña para **agregar nuevas métricas sin tocar el pipeline de agregación ni la tabla**.

Para lograrlo, la celda **no lleva un `achievement` hardcodeado**, sino un conjunto de *métricas*
derivadas de un **agregado crudo** por celda. Patrón (Open/Closed, CLAUDE.md §4.1-O):

1. **Agregado crudo por celda (`CellAggregate`).** La agregación calcula, en una sola pasada, los
   *bloques de construcción* que ya salen naturalmente de las queries: `scoreSum`, `maxSum`,
   `studentsAssessed`, `studentsTotal`, `gradeSum` (para nota promedio), `bandCounts` (distribución
   por banda/nivel desde `assessment_level_stats`) y — cuando exista toma previa — el agregado de la
   toma anterior para deltas. Calcular estos campos es barato (son SUM/COUNT del mismo query) y
   evita re-consultar al añadir una métrica.
2. **Registro de métricas (`MetricDescriptor`).** Cada métrica es un descriptor:
   ```ts
   type MetricDescriptor = {
     key: MetricKey;                 // 'achievement' | (futuras)
     label: string;                  // "% de logro"
     compute: (agg: CellAggregate) => { value: number | null; display: string };
     supportsLevelColoring: boolean; // si deriva insuficiente/…/avanzado para el color de celda
   };
   ```
   El pipeline recorre el registro y produce las métricas de cada celda. **Agregar una métrica =
   registrar un descriptor + un valor en el enum `MetricKey`**; ni el service de agregación ni el
   componente de tabla cambian.
3. **Métrica primaria seleccionable.** El query acepta `metric?: MetricKey` (default `achievement`).
   Esa métrica es la que **colorea y ordena** la matriz; la celda expone todas las métricas
   calculadas para el tooltip.

**Primera entrega:** sólo se registra el descriptor `achievement`
(`value = 100 · scoreSum/maxSum`, `supportsLevelColoring = true` vía `percentageToPerformanceLevel`).
Todo lo demás (selector de métrica, tooltip multi-métrica) queda cableado pero con un único ítem.

**Catálogo candidato de métricas futuras** (no implementar ahora; todas derivables del `CellAggregate`
sin schema nuevo, para demostrar que el seam es real):

| Métrica futura | Deriva de | Colorea por nivel |
|---|---|---|
| % de aprobación | `assessment_results.grade` ≥ nota de corte | no |
| Nota promedio | `gradeSum / studentsAssessed` | no |
| % en adecuado+avanzado | `bandCounts` | sí (bandas) |
| % en insuficiente (riesgo) | `bandCounts` | sí (bandas) |
| Variación vs toma anterior (Δ) | `CellAggregate` previo | sí (semáforo Δ) |
| Cobertura (evaluados/total) | `studentsAssessed / studentsTotal` | no |

---

## 5. Modelo de datos

### 5.1 Sin cambios de schema para el núcleo

Todo el núcleo (matriz, tooltip de profesor, navegación) se resuelve con las tablas existentes (§3.1).
**No se generan migraciones para R1–R4.**

### 5.2 Consultas de referencia

```sql
-- (a) Resolver el conjunto de assessments de una toma derivada
SELECT a.id
FROM assessments a
JOIN instruments i ON a.instrument_id = i.id
JOIN class_groups cg ON cg.academic_year_id = :academicYearId AND cg.org_id = :orgId
JOIN assessment_course_assignments aca ON aca.assessment_id = a.id AND aca.class_group_id = cg.id
WHERE i.type = :instrumentType
  AND (i.application_period = :applicationPeriod OR :applicationPeriod IS NULL)
  AND a.status = 'completed';

-- (b) % de logro por (curso, asignatura) en la toma — fuente cohorte importada
SELECT cg.grade_id, aca.class_group_id, i.subject_id,
       SUM(ais.score_sum)  AS score_sum,
       SUM(ais.max_sum)    AS max_sum,
       MAX(ais.student_count) AS students
FROM assessment_item_stats ais
JOIN assessments a  ON a.id = ais.assessment_id
JOIN instruments i  ON i.id = a.instrument_id
JOIN assessment_course_assignments aca ON aca.assessment_id = a.id AND aca.class_group_id = ais.class_group_id
JOIN class_groups cg ON cg.id = ais.class_group_id
WHERE a.id = ANY(:assessmentIds)
GROUP BY cg.grade_id, aca.class_group_id, i.subject_id;
-- (complementar con avg(percentage) de assessment_results para source 'computed', patrón getOverview)

-- (c) Profesor (primary) de cada (curso, asignatura)
SELECT sc.class_group_id, sc.subject_id, u.id AS user_id, u.name
FROM teacher_assignments ta
JOIN subject_classes sc ON sc.id = ta.subject_class_id
JOIN users u ON u.id = ta.user_id
WHERE sc.academic_year_id = :academicYearId
  AND ta.role = 'primary'
  AND sc.class_group_id = ANY(:classGroupIds);

-- (d) Cursos + desempeño de un profesor (para la página de profesor)
SELECT sc.class_group_id, sc.subject_id, a.id AS assessment_id
FROM teacher_assignments ta
JOIN subject_classes sc ON sc.id = ta.subject_class_id
JOIN assessment_course_assignments aca ON aca.class_group_id = sc.class_group_id
JOIN assessments a ON a.id = aca.assessment_id
JOIN instruments i ON i.id = a.instrument_id AND i.subject_id = sc.subject_id
WHERE ta.user_id = :userId AND sc.academic_year_id = :academicYearId;
```

> **RLS (CLAUDE.md §5.2):** todas las queries a `assessments`, `assessment_*_stats`,
> `assessment_results` corren **dentro de `withOrgContext(db, orgId, tx => …)`** usando `tx`.
> `teacher_assignments`, `subject_classes`, `class_groups`, `subjects`, `grades` no son tablas RLS
> sensibles, pero se filtran por `org_id`/año igual.

### 5.3 Punto de extensión futuro (NO implementar)

Cuando se requieran tomas nombradas persistentes:

```
assessment_campaigns
  id uuid PK, org_id uuid NOT NULL, academic_year_id uuid NOT NULL,
  name text, instrument_type instrument_type, created_at, updated_at
assessments.campaign_id uuid NULL  -- FK opcional
```

El endpoint de matriz sumaría `campaignId` como tercera forma de resolver el set de assessments. Sin
impacto en A/B. Documentado aquí; fuera de scope de esta entrega.

---

## 6. Diseño Backend (NestJS)

### 6.1 Módulo

Nuevo módulo `apps/api/src/master-board/` (o reutilizar `dashboards/` si el equipo prefiere no crear
módulo; recomiendo módulo propio por SRP):

```
master-board/
  master-board.module.ts
  master-board.controller.ts
  master-board.service.ts       # resuelve toma → assessments → CellAggregate por celda
  master-board.metrics.ts       # registro de MetricDescriptor (§4.7); 1ª entrega: solo 'achievement'
  dto/                          # Zod DTOs (query de matriz, query de profesor)
```

El registro de métricas (`master-board.metrics.ts`) es el único punto que se toca al añadir una
métrica: un nuevo `MetricDescriptor`. El service y el controller no cambian.

- Guards: `@UseGuards(RolesGuard)` + `@Roles(...RESULTS_VIEWER_ROLES)` (o un alias
  `MASTER_BOARD_VIEWER_ROLES` en `packages/types/src/access-policies/results-dashboards.ts` si el
  audiencia difiere). Nunca inline de roles (regla `backend/05-rbac-guards.md`).
- Reutiliza `cohortAverage`, `percentageToPerformanceLevel`, `buildComparabilityMeta`,
  `getAccessibleClassGroupIds` — **este último se promueve a helper compartido** (decisión P3, §6.7)
  antes de consumirlo aquí.

### 6.2 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/master-board/takes` | Lista tomas disponibles (derivadas) + años + asignaturas para el selector |
| `GET` | `/master-board/matrix` | Matriz asignatura × (nivel→curso) para una toma |
| `GET` | `/master-board/teachers/:userId/performance` | Cursos + desempeño de un profesor |

`/master-board/takes` puede fusionarse con `DashboardsService.getFilterOptions()` extendido; se
recomienda un endpoint dedicado que devuelva las *tomas derivadas* ya etiquetadas (label listo para
UI: "DIA Intermedio 2025").

### 6.3 DTO de entrada — `GET /master-board/matrix`

```ts
// Zod en packages/types/src/schemas/  (compartido api+web)
MasterBoardMatrixQuery = {
  // Forma 1: toma derivada
  academicYearId?: string;
  instrumentType?: InstrumentType;
  applicationPeriod?: 'diagnostico' | 'intermedio' | 'cierre';
  // Forma 2: selección libre (excluyente con forma 1)
  assessmentId?: string[];
  // (futuro) campaignId?: string;
  // Filtros opcionales de recorte
  gradeId?: string[];    // limitar a ciertos niveles
  subjectId?: string[];  // limitar a ciertas asignaturas
  // Métrica primaria que colorea/ordena la matriz (default 'achievement'). Ver §4.7
  metric?: MetricKey;
}
```

El service valida que venga *o* la forma derivada *o* `assessmentId[]` (Zod refine), resuelve el
conjunto de assessments y agrega. `metric` selecciona la métrica primaria; el resto de métricas
registradas se calculan para el tooltip.

### 6.4 Shape de respuesta — matriz

```ts
type MetricValue = {               // valor de una métrica ya calculado (§4.7)
  key: MetricKey;                  // 'achievement' | (futuras)
  label: string;                   // "% de logro"
  value: number | null;            // numérico crudo (para ordenar)
  display: string;                 // "72.4%"
  level: PerformanceLevel | null;  // color de celda si la métrica lo soporta; null si no
};

type MasterBoardMatrix = {
  take: {
    label: string;                 // "DIA Intermedio 2025"
    academicYearId: string | null;
    instrumentType: InstrumentType | null;
    applicationPeriod: string | null;
    assessmentIds: string[];       // set resuelto
  };
  primaryMetricKey: MetricKey;     // la que colorea/ordena (default 'achievement')
  availableMetrics: { key: MetricKey; label: string }[];  // pobla el selector de métrica
  subjects: { subjectId: string; name: string; shortName: string }[];  // columnas
  grades: {                                                            // filas nivel
    gradeId: string;
    name: string;                  // "3° Básico"
    order: number;
    cells: MasterBoardCell[];      // una por subject (agregado del nivel)
    courses: {                     // filas hijas (expandibles)
      classGroupId: string;
      name: string;                // "3°A"
      homeroomTeacher?: { userId: string; name: string } | null;
      cells: MasterBoardCourseCell[];
    }[];
  }[];
  comparability: ComparabilityMeta;
};

type MasterBoardCell = {           // celda de nivel (agregado ponderado)
  subjectId: string;
  studentsAssessed: number;
  metrics: MetricValue[];          // 1ª entrega: [achievement]; se colorea por primaryMetricKey
};

type MasterBoardCourseCell = {     // celda de curso (destino de click + tooltip profe)
  subjectId: string;
  studentsAssessed: number;
  metrics: MetricValue[];          // idem; el tooltip las lista todas
  teacher: { userId: string; name: string } | null;   // primary de esa subject_class
  assessmentIds: string[];         // 1 → detalle directo; >1 → desambiguar
};
```

> La celda **no** expone un `achievement` fijo: lleva `metrics: MetricValue[]`. La UI toma el
> `MetricValue` cuya `key === primaryMetricKey` para el número y el color. Añadir una métrica no
> cambia estos tipos — sólo aparece un elemento más en `metrics` y en `availableMetrics`.

### 6.5 Shape — desempeño del profesor

```ts
type TeacherPerformance = {
  teacher: { userId: string; name: string; email: string };
  academicYearId: string;
  classes: {
    classGroupId: string;
    className: string;              // "3°A"
    gradeName: string;             // "3° Básico"
    subjects: {
      subjectId: string;
      subjectName: string;
      role: 'primary' | 'assistant';
      metrics: MetricValue[];      // mismas métricas que la matriz (§4.7); 1ª entrega: [achievement]
      assessmentIds: string[];
    }[];
  }[];
};
```

### 6.6 Autorización y scoping

- Admin-like (`school_admin`, `academic_director`, etc.): ve toda la org.
- Profesor puro: la matriz se recorta a sus cursos (`teacher_assignments`), igual que
  `HeatmapService`/`DashboardsService`.
- **Página de desempeño del profesor (decisión P4b): sólo directivos/admin** (los roles que ya ven
  datos agregados de toda la org). Gatear con `RESULTS_VIEWER_ROLES` (o el alias `MASTER_BOARD_VIEWER_ROLES`).
  Un profesor sobre sí mismo **no** entra por esta vista en esta entrega (queda como posible extensión).

### 6.7 Promoción del helper de scoping (decisión P3)

`getAccessibleClassGroupIds()` está hoy **duplicado** en `HeatmapService`, `AnalyticsService` y
`DashboardsService`. En vez de replicarlo por 4ª vez en `MasterBoardService`, se **promueve a helper
compartido** y se migran los 3 call sites existentes (DRY, regla `backend/03-helpers-vs-services.md`
"reuse before adding — search first, then promote"):

- Como toca `db` (query a `teacher_assignments`/`class_groups`), **no** es un helper puro → va como
  **su propio service** reutilizable, p. ej. `apps/api/src/common/scoping/class-group-scope.service.ts`
  con `getAccessibleClassGroupIds(orgId, user, tx)`. Los 4 services lo inyectan.
- Migración incremental y verificable: extraer, migrar los 3 existentes (sin cambio de comportamiento,
  cubierto por sus specs), luego consumirlo en `MasterBoardService`.

---

## 7. Diseño Frontend (Next.js / App Router)

### 7.1 Ruta y shell

- Nuevo tab en `RESULTADOS_TABS` (`components/layout/view-tabs.tsx`): `{ href: ROUTES.tableroMaestro,
  label: 'Tablero maestro', icon: Table2, exact: true }`.
- Nueva ruta en `apps/web/src/lib/routes.ts`: `tableroMaestro: route('/resultados/tablero-maestro')`
  y (decisión P4a) `equipoMiembro: (userId) => route('/equipo/${userId}')` para la página de
  desempeño del profesor, coherente con la gestión de equipo existente.
- Página: `apps/web/src/app/(dashboard)/resultados/tablero-maestro/page.tsx` (Server Component).

### 7.2 Reactividad (regla `frontend/07-navigation-reactivity.md`)

- `page.tsx` sólo `await auth()` + `await searchParams`; **no** `await` de la matriz antes del JSX.
- El fetch de la matriz va en un hijo async dentro de `<Suspense fallback={<MatrixSkeleton/>}>`.
- Sibling `loading.tsx` con el skeleton del cuerpo (el header/tabs viven en `resultados/layout.tsx`).
- El selector de toma y filtros escriben `searchParams` con `useTransition` + `TopProgressBar`.

### 7.3 Componentes

```
resultados/tablero-maestro/
  page.tsx                    # Server Component: auth gate + parse searchParams + <Suspense>
  loading.tsx                 # skeleton del cuerpo
  components/
    take-selector.tsx         # 'use client' — elige toma derivada o "Personalizada" (multiselección)
    metric-selector.tsx       # 'use client' — elige la métrica primaria (1ª entrega: solo "% de logro")
    master-board-table.tsx    # 'use client' — matriz con filas expandibles + tooltips + navegación
    master-board-legend.tsx   # leyenda de niveles (reusar patrón HeatmapLegend)
    matrix-skeleton.tsx
  master-board-api.ts         # server actions / apiGet wrappers
```

**`master-board-table.tsx`** (núcleo):
- Estado `const [expanded, setExpanded] = useState<Set<string>>(...)` de `gradeId`s (patrón
  `estudiantes/components/skill-tree.tsx`).
- La celda lee la métrica primaria: `cell.metrics.find(m => m.key === matrix.primaryMetricKey)`
  (precalculado a `Map` por celda para no re-buscar; regla `frontend/05-performance.md`). Usa su
  `display` para el número y su `level` para el color (`HEAT_CELL_CLASS`, tokens `bg-level-*`). Si la
  métrica no soporta color (`level === null`), se usa una escala neutra.
- Fila de nivel: chevron `ChevronDown/ChevronRight`, etiqueta de nivel, celdas agregadas coloreadas.
- Al expandir: filas de curso indentadas; cada celda de curso:
  - color/valor por la métrica primaria;
  - `Tooltip` (patrón heatmap, `delayDuration={150}`) que lista **todas** las `metrics` + "N alumnos"
    + **profesor** (`teacher.name`);
  - el nombre del profesor dentro del tooltip es un `Link` a `ROUTES.equipoMiembro(teacher.userId)`;
  - la celda (fuera del link de profe) es clickeable → §7.4.
- `TooltipProvider` envuelve la tabla una vez.
- Aggregación/lookups en el cliente con `Map` (regla `frontend/05-performance.md`, sin `.find()` por celda).

### 7.4 Navegación de celda (R4)

Reutilizar el patrón de `comparable-units-table.tsx`:

```ts
function cellHref(cell: MasterBoardCourseCell, classGroupId: string): Route {
  if (cell.assessmentIds.length === 1) {
    return `${ROUTES.evaluacionDetalle(cell.assessmentIds[0]!)}?classGroupId=${classGroupId}` as Route;
  }
  return `${ROUTES.evaluaciones}?classGroupId=${classGroupId}&subjectId=${cell.subjectId}` as Route;
}
```

Destino existente: `apps/web/.../evaluaciones/[assessmentId]/detalle/page.tsx` (ya acepta
`?classGroupId=`).

### 7.5 Página de desempeño del profesor (R3)

- Ruta nueva `apps/web/src/app/(dashboard)/equipo/[userId]/page.tsx` (decisión P4a, bajo `equipo/`).
- Server Component: `auth()` + `canAccess(roles, RESULTS_VIEWER_ROLES)` — **sólo directivos/admin**
  (decisión P4b); si no pasa el gate → `redirect('/dashboard')`.
- Fetch `GET /master-board/teachers/:userId/performance`.
- Render: `PageHeader` (nombre del profe) + una `Card` por curso, dentro tabla asignatura × % logro con
  `PerformanceBadge`. Reutiliza `performance-level.ts` y `EmptyState` si el profe no tiene datos.
- Cada curso enlaza al detalle de evaluación correspondiente (mismo `cellHref`).

### 7.6 Reutilización estricta de tokens/labels

- Colores y etiquetas: **sólo** `performance-level.ts` / tokens `--level-*`. Nunca re-derivar el
  mapeo insuficiente→rojo, etc. (regla `frontend/02-ui-conventions.md`).
- Badges: `PerformanceBadge`. Formato %: `formatAchievement`.

---

## 8. Contrato de datos compartido (`packages/types`)

Todos los tipos/DTO nuevos viven en `packages/types/src/schemas/` (Zod) y se importan en `api` y
`web` (DRY, CLAUDE.md §4.2):
- `master-board.schema.ts`: `MasterBoardMatrixQuery`, `MasterBoardMatrix`, `MasterBoardCell`,
  `MasterBoardCourseCell`, `MasterBoardTake`, `MetricValue`.
- `metric-key.ts` (o dentro de `enums.ts`): enum `MetricKey` (1ª entrega: `['achievement']`). Es la
  fuente de verdad que comparten el registro backend y el selector frontend.
- `teacher-performance.schema.ts`: `TeacherPerformance`.
- Constante de roles: `MASTER_BOARD_VIEWER_ROLES` en `access-policies/results-dashboards.ts` (alias
  de `RESULTS_VIEWER_ROLES` si coincide la audiencia, con comentario explícito).

---

## 9. Plan de implementación (historias)

Orden sugerido; cada bloque es entregable e independiente en lo posible.

0. **H-TM.0 — Promover helper de scoping (backend, prerequisito).** Extraer
   `getAccessibleClassGroupIds()` a `class-group-scope.service.ts` y migrar los 3 call sites
   existentes (`HeatmapService`, `AnalyticsService`, `DashboardsService`) sin cambio de comportamiento
   (cubierto por sus specs). Decisión P3, §6.7. Se hace primero para que `MasterBoardService` lo consuma.
1. **H-TM.1 — Tipos y contrato.** `master-board.schema.ts` + `teacher-performance.schema.ts` +
   enum `MetricKey` + `MetricValue` en `packages/types`; constante de roles. (Base para api y web.)
2. **H-TM.2 — Resolución de tomas (backend).** `GET /master-board/takes`: detectar tomas derivadas
   `(año, tipo, período)` con datos reales + años/asignaturas. Tests de la lógica de derivación.
3. **H-TM.3 — Agregación de matriz + registro de métricas (backend).** `GET /master-board/matrix`:
   resolver assessments, construir `CellAggregate` por `(subject, grade, class_group)` reutilizando
   `cohortAverage`/comparabilidad; registro `MetricDescriptor` con **solo** `achievement`; incluir
   `teacher` por celda y `assessmentIds`. Tests con `Database` fake (patrón `heatmap.service.spec.ts`)
   + test unitario del descriptor `achievement` (función pura sobre `CellAggregate`).
4. **H-TM.4 — Selector de toma + métrica (frontend).** `take-selector.tsx` (derivado +
   "Personalizada") y `metric-selector.tsx` (cableado, con un solo ítem "% de logro"); serialización
   a `searchParams` (`useTransition`+`TopProgressBar`).
5. **H-TM.5 — Tabla de matriz (frontend).** `master-board-table.tsx` con filas expandibles, celda que
   lee la métrica primaria de `cell.metrics`, tooltips multi-métrica (incl. profesor) y navegación de
   celda. `loading.tsx` + `<Suspense>`.
6. **H-TM.6 — Tab + ruta.** Alta en `RESULTADOS_TABS`, `routes.ts`, page/loading.
7. **H-TM.7 — Desempeño del profesor (backend).** `GET /master-board/teachers/:userId/performance`,
   gateado a directivos/admin (P4b).
8. **H-TM.8 — Página del profesor (frontend).** `/equipo/[userId]` (P4a) + link desde el tooltip.
9. **H-TM.9 — Comparabilidad y estados vacíos.** `AlertCallout` cuando `aggregatable=false`,
   `EmptyState` sin datos, manejo de toma sin resultados.
10. **H-TM.10 — QA/rendimiento.** Verificar O(N) en asamblea, responsive (mobile-first,
    `overflow-x-auto`), typecheck/lint/format.

---

## 10. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Tomas derivadas fusionan ensayos repetidos (SIMCE/Cambridge sin `application_period`) | Toma incorrecta | Desambiguar por bucket de fecha + ofrecer "Personalizada" (§4.1) |
| Instrumentos con distinta escala en una toma | Colores por nivel inválidos | `comparability.aggregatable`; degradar a % neutro + aviso (§4.3) |
| Doble conteo per-alumno vs cohorte importada | % inflado | Replicar exactamente el merge de `getOverview()` (§4.2) |
| O(N²) en asamblea de celdas al crecer la matrícula | Página lenta | `Map`s en una pasada, patrón `assembleResponse()` (reglas de complejidad) |
| Curso sin profesor `primary` asignado | Tooltip vacío | `teacher: null`; el tooltip omite la línea; no bloquea |
| Ambigüedad "tooltip en curso vs en celda" | UX/So API | Recomendado por celda; API soporta ambos; confirmar (P1) |

---

## 11. Decisiones confirmadas

Todas las decisiones de diseño están cerradas. El diseño está listo para planificar desarrollo.

- **P1 — Anclaje del tooltip de profesor:** ✅ **por celda** `(curso × asignatura)`; el encabezado de
  curso muestra el profesor jefe como cortesía (§4.4).
- **P2 — Ubicación del tablero:** ✅ **tab dentro de `/resultados`** (`/resultados/tablero-maestro`)
  (§4.6).
- **P3 — Refactor de scoping:** ✅ **promover `getAccessibleClassGroupIds()` a service compartido** y
  migrar los 3 call sites existentes antes de consumirlo (§6.7, H-TM.0).
- **P4a — Ruta del profesor:** ✅ **`/equipo/[userId]`**, coherente con la gestión de equipo (§7.5).
- **P4b — Acceso a la página del profesor:** ✅ **sólo directivos/admin** (`RESULTS_VIEWER_ROLES`); el
  profesor sobre sí mismo queda como extensión futura (§6.6).
- **P5 — Métrica de la celda:** ✅ **partir con % de logro global del curso**, con la feature diseñada
  para **agregar nuevas métricas sin tocar el pipeline ni la tabla** (registro `MetricDescriptor` +
  `CellAggregate`, §4.7).
- **P6 — "Toma":** ✅ **tomas derivadas `(año, tipo, período)` + selección libre, sin schema nuevo**;
  `assessment_campaigns` queda documentada como extensión futura (§4.1, §5.3).

---

## 12. Resumen ejecutivo

- **La BDD ya soporta todo el núcleo** (incluida la relación profesor↔asignatura↔curso vía
  `teacher_assignments → subject_classes`). **Cero migraciones** para R1–R4.
- **Reutilizamos** la aritmética de % ponderado (`cohortAverage`), la clasificación por nivel/banda,
  la comparabilidad, los tokens de color (`performance-level.ts` / `--level-*`), el patrón de filas
  expandibles (`skill-tree.tsx`), el patrón de tooltip+celda (`heatmap-table.tsx`) y el de fila
  clickeable (`comparable-units-table.tsx`).
- **Construimos** un endpoint de matriz nuevo (`/master-board/matrix`), un selector de "toma"
  (derivada + libre, sin schema), la tabla expandible, un endpoint + página de desempeño del profesor.
- **Decisión de "toma":** derivada por `(año, tipo, período)` como primaria + selección libre como
  escape, con `assessment_campaigns` documentada como extensión F2+ — respetando la filosofía de
  extensibilidad sin sobre-construir.
- **Métricas extensibles (P5):** la 1ª entrega muestra **% de logro global del curso**, pero la celda
  lleva `metrics: MetricValue[]` derivadas de un `CellAggregate` crudo vía un registro de
  `MetricDescriptor`. Agregar % de aprobación, nota promedio, distribución por banda o Δ vs toma
  anterior = registrar un descriptor; el pipeline de agregación y la tabla no cambian (Open/Closed).

---

## 13. Estado de implementación (entrega inicial)

**Implementado y validado** (typecheck ✓, lint ✓, prettier ✓, tests ✓):

- **Backend** — módulo `apps/api/src/master-board/` con 3 endpoints: `GET /master-board/takes`,
  `GET /master-board/matrix`, `GET /master-board/teachers/:userId/performance`. Registro de métricas
  en `master-board.metrics.ts` (`CellAggregate` + `MetricDescriptor`, solo `achievement`), con
  `master-board.metrics.spec.ts` (11 tests).
- **Tipos** — `packages/types/src/schemas/master-board.schema.ts` (+ `MetricKey`, `METRIC_LABELS`,
  `INSTRUMENT_TYPE_LABELS`, `MASTER_BOARD_VIEWER_ROLES`, `TEACHER_PERFORMANCE_VIEWER_ROLES`).
- **Frontend** — tab "Tablero maestro" en `/resultados/tablero-maestro` (selector de toma + métrica,
  tabla nivel→curso expandible, tooltips con profesor, navegación de celda) y página de desempeño
  del profesor en `/equipo/[userId]`.
- **P3** — `getAccessibleClassGroupIds` migrado en `HeatmapService`/`AnalyticsService`/`DashboardsService`
  al helper compartido `resolveClassGroupScope` (66 tests de esos specs siguen verdes).

**Decisiones de alcance de esta entrega (vs. el diseño):**

- **Fuente única del % de celda:** la matriz se calcula **solo** desde `assessment_item_stats`
  (`Σscore_sum / Σmax_sum`), que es el read-model que escriben **ambos** caminos (cálculo desde
  `responses` e informes oficiales importados). Es más simple y uniforme que el merge per-alumno +
  cohorte de `DashboardsService.getOverview()` mencionado en §4.2, y numéricamente equivalente para
  DIA. El merge de `getOverview` sólo hace falta para **contar alumnos con identidad** (distinct),
  que el tablero no necesita.
- **Selector de toma:** implementadas las **tomas derivadas** `(año, tipo, período)`. La **selección
  libre** (`assessmentId[]`) está soportada de punta a punta en el backend y el contrato, pero **su
  UI (multiselección de evaluaciones) queda diferida** — el selector hoy ofrece las tomas derivadas.
  Es el punto de extensión natural para ensayos SIMCE/Cambridge repetidos.
- **Profesor jefe (cortesía):** no implementado (no hay una fuente única y confiable del homeroom por
  curso hoy). El tooltip de profesor por celda (P1) sí está.
- **Umbrales de la vista del profesor:** usa los umbrales DIA por defecto (F1 OK); afinar a la escala
  del instrumento queda para F2 multi-escala, igual que el resto de dashboards.
