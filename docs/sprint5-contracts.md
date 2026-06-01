# Sprint 5 — Contratos (Dashboards avanzados + flujo demo)

> **READ THIS FILE COMPLETELY BEFORE WRITING ANY CODE.**
> Rama de integración: `sprint-5` (salida de `dev`). Cada agente trabaja en su
> propio worktree aislado y DEBE commitear antes de terminar.

Sprint 5 completa las visualizaciones de mayor impacto en la demo F1. **No hay
migración de BD nueva**: se reusan las tablas de S2/S3/S4 (`responses`,
`assessment_results`, `skill_results`, `items`, `item_taxonomy_tags`,
`taxonomy_nodes`, `assessments`, `instruments`).

Historias: **H6.10** (mapa de calor), **H6.11** (tabla cruzada alumno×pregunta),
**H6.12** (distribución de respuestas + distractores), **H6.18** (export genérico),
**H19.1** (validación arquitectónica — la hace el orquestador, no es un módulo).

---

## 0. Contratos compartidos (ya committeados en `sprint-5`)

- `packages/types/src/schemas/heatmap.schema.ts` — `heatmapQuerySchema`,
  `HeatmapResponse` + Models (`HeatmapSubject`, `HeatmapRow`, `HeatmapCell`).
- `packages/types/src/schemas/item-analysis.schema.ts` — `itemMatrixQuerySchema`,
  `ItemMatrixResponse`, `questionAnalysisQuerySchema`, `QuestionAnalysisResponse`
  + Models (`MatrixQuestionColumn`, `MatrixStudentRow`, `MatrixCell`,
  `AlternativeDistribution`, `ItemTaxonomyRef`).
- `packages/types/src/access-policies.ts` — `HEATMAP_VIEWER_ROLES`,
  `ITEM_ANALYSIS_VIEWER_ROLES` (ambos = `RESULTS_VIEWER_ROLES`; el scoping por
  curso de profesores lo aplica el service).
- Libs frontend ya instaladas en `apps/web`: **recharts** (gráficos), **xlsx** +
  **jspdf** + **jspdf-autotable** (export). **No instalar libs nuevas.**

Importar SIEMPRE los tipos desde `@soe/types`. **No redefinir tipos locales que
dupliquen un Model.**

---

## 1. División en agentes

| Agente | Tipo | Módulo / Ruta (propiedad exclusiva) | Historias |
|---|---|---|---|
| **BE-A** | backend | `apps/api/src/heatmap/` | H6.10 |
| **BE-B** | backend | `apps/api/src/item-analysis/` | H6.11, H6.12 |
| **FE-A** | frontend | `apps/web/src/app/(dashboard)/resultados/mapa-calor/` + `resultados/components/export/` | H6.10, H6.18 |
| **FE-B** | frontend | `apps/web/src/app/(dashboard)/resultados/detalle/` + `resultados/components/question-detail-panel.tsx` | H6.11, H6.12 |

**Aislamiento:** cada agente toca SOLO su directorio. **NADIE** toca en desarrollo:
`apps/api/src/app.module.ts`, `apps/web/src/components/layout/nav-items.ts`,
`apps/web/src/lib/api.ts`, `apps/web/src/app/(dashboard)/layout.tsx`,
`apps/api/src/dashboards/*`, `apps/api/src/analytics/*`, `packages/types/*`,
`packages/db/*`. Esos se integran en Fase 4.

---

## 2. Convenciones backend (NestJS + Drizzle)

Patrón de referencia: `apps/api/src/analytics/analytics.service.ts` y
`apps/api/src/dashboards/dashboards.service.ts` (service, controller, scoping).

- **Inyección DB:** `constructor(@InjectDb() private readonly db: Database) {}` desde
  `../database/database.types`.
- **Auth:** `@UseGuards(RolesGuard)` en el controller + `@Roles(...ROLES)` por
  endpoint + `@CurrentUser() user: JwtPayload`. Validar el query con el schema Zod
  (`schema.parse(query ?? {})`) en el controller, NUNCA en el service.
- **Scoping por rol (OBLIGATORIO):** replicar `getAccessibleClassGroupIds(user, orgId)`
  de `analytics.service.ts:620` (cópialo a tu service, NO lo importes de otro módulo):
  - `platform_admin` / admin-like (`school_admin, academic_director, cycle_director,
    dept_head, coordinator, eval_coordinator`) → `scopeAll = true` (toda la org).
  - profesor (`teacher, homeroom_teacher`) → sólo class_groups vía `teacher_assignments
    → subject_classes → class_groups` con `teacherAssignments.userId = user.userId`.
  - **`org_id` SIEMPRE de `user.orgId`, NUNCA del query.** Usa `requireOrgId(user)`.
  - Profesor sin cursos → devolver respuesta vacía (no error), salvo acceso directo a
    una entidad fuera de su scope → `ForbiddenException`.
- **Multi-tenancy:** toda query filtra por `org_id` (vía `assessments.orgId`).
  **Soft deletes:** `isNull(students.deletedAt)`, `isNull(items.deletedAt)`,
  `isNull(instruments.deletedAt)`.
- **% logro:** `assessment_results.percentage` y `skill_results.percentage` están en
  `0..100` (decimal string). Para promedios usar `avg(... ::numeric)` en SQL y
  `Number(...)` al mapear. Nivel de desempeño: `percentageToPerformanceLevel(pct/100)`
  de `@soe/types` (espera 0..1).
- **Skills/contenidos = `taxonomy_nodes`** vía `item_taxonomy_tags.node_id`. No hay
  columna "skill" en items. `tag_type` distingue el rol del nodo
  (`'primary'`/`'skill'`/`'content'`/`'oa'` — inspeccionar `item_tag_type` enum). Para
  "habilidad principal" tomar el tag de tipo skill/primary; para "contenido" el de
  contenido/OA. Si hay ambigüedad, documentar el criterio elegido.
- **Año/período:** `assessments.administered_at` (timestamp), `academic_years.year` vía
  `class_groups.academic_year_id`. Cursos de una evaluación vía
  `assessment_course_assignments → class_groups`.
- **Batch:** NUNCA insertar/consultar en loop (N+1). Agregar en SQL con `group by`.
  La matriz (H6.11) se arma con UNA query de columnas + UNA de respuestas + UNA de
  alumnos (paginada), NO una query por alumno ni por pregunta.
- **Tests:** ≥8 tests por service (`*.service.spec.ts`), happy path + edge (sin datos,
  scoping de profesor, filtros, evaluación inexistente). Testear las agregaciones.
- **Compilación:** `cd apps/api && npx tsc --noEmit` sin errores antes de terminar.
- **NO** registrar el módulo en `app.module.ts` (lo hace integración). Sí crear el
  `*.module.ts` (con `controllers` + `providers` + import de `DatabaseModule` si aplica
  — mira cómo lo hace `dashboards.module.ts`).

### 2.1 BE-A — módulo `heatmap/` (base `/api/heatmap`)

Roles: `@Roles(...HEATMAP_VIEWER_ROLES)`. Query: `heatmapQuerySchema`.

| Verbo + Path | Query DTO | Response Model | Historia |
|---|---|---|---|
| `GET /api/heatmap` | `HeatmapQueryDto` | `HeatmapResponse` | H6.10 |

Comportamiento:
- Construye una matriz **habilidad (fila) × asignatura (columna)** de % logro promedio.
- `subjects`: las asignaturas (subjects) visibles en el scope/filtros, en orden por
  nombre. Son las columnas. Derivar las asignaturas desde los `instruments.subject_id`
  de las evaluaciones que matchean el scope+filtros (sólo asignaturas con datos).
- `rows`: una por `taxonomy_node` (habilidad) con datos en `skill_results` dentro del
  scope. Cada fila trae `cells` (una por subject de `subjects`, **mismo orden**); la
  celda agrega `skill_results.percentage` de ese nodo en esa asignatura
  (`avg(::numeric)`), con `studentsAssessed` = alumnos distintos. Celda sin datos →
  `{ averageAchievement: null, performanceLevel: null, studentsAssessed: 0 }`.
- `overallAchievement` por fila = promedio del nodo sobre todas las asignaturas
  visibles. Ordenar `rows` por `overallAchievement` ascendente (las más críticas
  primero — son las que importan en la demo). Nodos sin datos al final.
- Filtros (`assessmentId`, `instrumentId`, `instrumentType`, `subjectId`, `gradeId`,
  `classGroupId`, `academicYearId`) acotan el universo de `skill_results` agregados.
  Si viene `subjectId`, el heatmap tendrá una sola columna.
- Profesor sin cursos → `{ subjects: [], rows: [] }`.
- **Toda la matriz se arma con agregación SQL (group by node_id, subject_id)**, no en
  bucles JS por celda.

### 2.2 BE-B — módulo `item-analysis/` (base `/api/item-analysis`)

Roles: `@Roles(...ITEM_ANALYSIS_VIEWER_ROLES)`.

| Verbo + Path | Query DTO | Response Model | Historia |
|---|---|---|---|
| `GET /api/item-analysis/matrix` | `ItemMatrixQueryDto` | `ItemMatrixResponse` | H6.11 |
| `GET /api/item-analysis/questions/:itemId` | `QuestionAnalysisQueryDto` | `QuestionAnalysisResponse` | H6.12 |

**Matrix (H6.11):**
- `assessmentId` obligatorio. Verificar que la evaluación pertenece a `user.orgId`
  (si no → `NotFoundException`) y que el caller tiene scope sobre ella (profesor: la
  evaluación debe tocar alguno de sus class_groups; si no → `ForbiddenException`).
- `questions`: ítems del instrumento de la evaluación (`items` por `instrument_id`,
  `isNull(deletedAt)`, orden por `position`). Para cada uno: `correctKey` (de
  `content.correctKey` o `alternatives[].isCorrect`), `skill`/`content` (tags), y
  `correctRate` = % alumnos (de la población visible) con `responses.is_correct = true`
  en ese ítem (UNA query agregada `group by item_id`, no por ítem).
- `students`: alumnos con respuestas en esa evaluación dentro del scope, paginados
  `{ data, total, page, limit }`. Cada fila trae `cells` (una por columna de
  `questions`, **mismo orden**) con `selectedKey` (de `responses.value`, claves
  candidatas `answer`/`raw`/`key`), `isCorrect`, `score` (`final_score ?? raw_score`).
  `achievement` = % logro del alumno (de `assessment_results.percentage` si existe, o
  derivado de `correctCount/answeredCount`).
- Filtro `classGroupId` (debe estar en el scope) y `nodeId` (limita columnas a ítems
  taggeados con ese nodo).
- **Sin N+1:** carga columnas (1 query), respuestas de la página de alumnos (1 query
  con `inArray(studentId, pageIds)`), y arma las celdas en memoria.

**Question analysis / distractores (H6.12):**
- `:itemId` debe pertenecer a un instrumento de la org del caller (vía join a
  `assessments`/`instruments` de la org, o validando `items.org_id`/instrumento). Si no
  es visible → `NotFoundException`.
- Devuelve `stem`, `imageUrl`, `explanation`, `correctKey`, `skill`, `content`, y
  `alternatives` (de `items.content.alternatives`): para cada alternativa `count` y
  `percentage` de alumnos que la eligieron, `isCorrect`. Incluir la correcta y los
  distractores. `blankCount` = respuestas sin alternativa; `correctCount` y
  `correctRate` (0..100 sobre `totalResponses`).
- La distribución se calcula sobre la población visible (scope) y se acota con
  `assessmentId`/`classGroupId` si vienen. **UNA query agregada** `group by` el valor
  de la alternativa (`responses.value->>'answer'` con `coalesce` de claves), no un
  bucle por alternativa ni por alumno.
- Si el ítem no es de selección múltiple (sin `alternatives`), devolver `alternatives: []`
  pero igual `totalResponses`/`correctCount`/`correctRate`.

### 2.3 Formato de `items.content` y `responses.value` (CRÍTICO para BE-B)

```jsonc
// items.content  (selección múltiple DIA)
{
  "stem": "¿Qué hacía el gato en la historia?",
  "alternatives": [
    { "key": "A", "text": "El gato estaba durmiendo" },   // puede traer "isCorrect": bool
    { "key": "B", "text": "El gato estaba jugando" }
  ],
  "correctKey": "B"        // clave correcta (formato DIA). Puede faltar → usar alternatives[].isCorrect
}

// responses.value
{ "answer": "B" }          // alternativa elegida. Claves candidatas: answer | raw | key. null = en blanco
```

- `responses.isCorrect` (boolean) YA viene precomputado por la ingesta — úsalo para
  `correctRate`/`isCorrect` en celdas en vez de recomputar, salvo que necesites el
  desglose por alternativa (ahí agrupa por `responses.value`).
- Helper de referencia para extraer la alternativa elegida:
  `assessment-results.service.ts:715` (`extractRawAnswer`: `raw ?? key ?? answer`).

---

## 3. Convenciones frontend (Next.js 15 App Router)

Patrón de referencia: `apps/web/src/app/(dashboard)/resultados/page.tsx`,
`resultados/habilidades/page.tsx`, `resultados/clasificacion/page.tsx`.

- **Server Components por defecto.** `'use client'` SÓLO para interactividad (tablas
  interactivas, drill-down, modal/panel, botones de export). Los gráficos recharts son
  client-only.
- **Auth en cada página protegida:**
  ```ts
  const session = await auth();              // from '@/auth'
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, HEATMAP_VIEWER_ROLES)) redirect('/dashboard');
  // (ITEM_ANALYSIS_VIEWER_ROLES en las páginas de detalle)
  ```
- **Data fetch:** `apiGet<ResponseModel>('/heatmap?...')` / `apiGet<ItemMatrixResponse>(
  '/item-analysis/matrix?...')` desde `@/lib/api` en Server Components. Tipar SIEMPRE
  con el Model del contrato. No `useEffect` para fetch inicial.
- **searchParams (Next 15):** `searchParams` es `Promise` → `const params = await
  searchParams;`. Los filtros viven en la URL (querystring).
- **Filter bar compartido (ya existe, de S4):**
  `resultados/components/dashboard-filter-bar.tsx` exporta `DashboardFilterBar`,
  `DashboardFilterValues` y `parseDashboardFilters(params)`. **Reutilizarlo**, no
  duplicarlo. (Si tu vista necesita filtros, impórtalo de esa ruta.)
- **UI en español, mobile-first** (clases `sm: md: lg:`). shadcn/ui en
  `apps/web/src/components/ui/` (button, card, table, select, badge, dialog/sheet,
  skeleton, tooltip). Patrones en `components/patterns/` (`PageHeader`, `PageContainer`,
  `EmptyState`). **No** colores hardcodeados; usar tokens Tailwind (para el heatmap usar
  escalas de color por rango de logro definidas con clases utilitarias, no hex inline).
- **NO** tocar `nav-items.ts`, `lib/api.ts`, `layout.tsx`, ni las páginas de S4 ya
  existentes (`resultados/page.tsx`, `clasificacion`, `habilidades`, `comparacion`,
  `progresion`). Integración los maneja.
- **Compilación:** `cd apps/web && npx tsc --noEmit` sin errores antes de terminar.

### 3.1 Rutas y propiedad

| Ruta / archivo | Agente | Contenido |
|---|---|---|
| `resultados/mapa-calor/page.tsx` | FE-A | Heatmap habilidad×asignatura (H6.10), celdas coloreadas por rango |
| `resultados/components/export/` | FE-A | Util + `<ExportButton>` genérico client-side (H6.18) |
| `resultados/detalle/page.tsx` | FE-B | Tabla cruzada alumno×pregunta paginada con drill-down (H6.11) |
| `resultados/components/question-detail-panel.tsx` | FE-B | Panel/modal de distribución + distractores (H6.12) |

### 3.2 Contrato del `<ExportButton>` genérico (H6.18 — lo crea FE-A)

FE-A DEBE crear este componente client-side con esta firma exacta (Models de
`@soe/types` no aplican aquí — es una util de presentación):

```tsx
// apps/web/src/app/(dashboard)/resultados/components/export/export-button.tsx
'use client';

export type ExportColumn<T> = { key: keyof T | string; header: string };

export function ExportButton<T extends Record<string, unknown>>(props: {
  /** Filas YA cargadas en la vista (no hace fetch nuevo). */
  rows: T[];
  columns: ExportColumn<T>[];
  /** Nombre base del archivo (sin extensión) y título del PDF. */
  filename: string;
  title: string;
  /** Texto con los filtros aplicados, para el subtítulo del PDF/hoja. */
  filtersSummary?: string;
  /** Formatos a ofrecer; por defecto ambos. */
  formats?: ('xlsx' | 'pdf')[];
}): JSX.Element;
```

- Excel: `xlsx` (`XLSX.utils.json_to_sheet` → `XLSX.writeFile`).
- PDF: `jspdf` + `jspdf-autotable` (tabla de la vista + título + `filtersSummary`).
- El botón exporta los datos YA cargados (no hace fetch). Genérico: sirve para heatmap,
  tabla cruzada y cualquier vista futura. **Reusar** (no reimplementar) el existente
  `resultados/components/charts/export-view-button.tsx` como referencia de uso de las libs.

### 3.3 Contrato del `<QuestionDetailPanel>` (H6.12 — lo crea FE-B)

FE-B crea este componente client-side. FE-A NO lo necesita (la matriz de FE-B lo
consume al hacer click en una columna de pregunta):

```tsx
// apps/web/src/app/(dashboard)/resultados/components/question-detail-panel.tsx
'use client';
import type { QuestionAnalysisResponse } from '@soe/types';

export function QuestionDetailPanel(props: {
  /** itemId de la pregunta; el panel hace fetch a /item-analysis/questions/:id
   *  vía un route handler o server action, o recibe los datos ya cargados. */
  data: QuestionAnalysisResponse | null;
  open: boolean;
  onClose: () => void;
}): JSX.Element;
```

- Muestra: enunciado, alternativas con barra de distribución (count + %), resaltando la
  correcta y los distractores más elegidos, % de acierto y respuestas en blanco.
- El fetch de los datos de la pregunta puede hacerse con un route handler/server action
  en la ruta `detalle/` que llame a `apiGet<QuestionAnalysisResponse>(...)`, o pasando
  los datos ya cargados. Documentar el enfoque elegido.

---

## 4. Checklist de entrega por agente

### Tickets comunes (todos)
- [ ] T1: Implementar la lógica del dominio (service / página) siguiendo el patrón de referencia.
- [ ] T2: Endpoints/páginas con los response shapes EXACTOS del Model en `@soe/types`.
- [ ] T3: (backend) Tests `*.service.spec.ts` ≥8. (frontend) Tipar todo con Models del contrato.
- [ ] T4: Compilación limpia (`npx tsc --noEmit` en `apps/api` o `apps/web`).
- [ ] T5: **`git add -A && git commit`** antes de terminar (worktree se borra sin commit).

### Criterios de aceptación
- [ ] CA1: Multi-tenancy — toda query backend filtra por `org_id` del token.
- [ ] CA2: Scoping de profesor — un profesor sólo ve sus cursos (replicar `getAccessibleClassGroupIds`).
- [ ] CA3: Soft deletes — queries filtran `deleted_at IS NULL` donde aplique (students, items, instruments).
- [ ] CA4: Roles — guards/`canAccess()` usan constantes de `@soe/types` (`HEATMAP_VIEWER_ROLES` /
  `ITEM_ANALYSIS_VIEWER_ROLES`). NUNCA roles inline.
- [ ] CA5: Response shapes coinciden EXACTAMENTE con los Models de `@soe/types` (sin campos de más/menos).
- [ ] CA6: Sin N+1 — agregaciones en SQL con `group by`, no bucles de queries por celda/fila/pregunta.
- [ ] CA7: (frontend) UI en español, responsive, sin colores hardcodeados, sin tipos locales que dupliquen Models.
- [ ] CA8: No se tocaron archivos compartidos (`app.module.ts`, `nav-items.ts`, `lib/api.ts`, `layout.tsx`,
  `dashboards/*`, `analytics/*`, `packages/*`, páginas S4).
- [ ] CA9: Estados vacíos manejados (sin datos / profesor sin cursos / evaluación sin respuestas) con `EmptyState`.
- [ ] CA10: **No hardcodear "DIA"** ni IDs de currículo/asignatura (H19.1) — todo por IDs/enums y taxonomy_nodes.

---

## 5. Integración (Fase 4 — la hace el orquestador, NO los agentes)

1. Registrar `HeatmapModule` y `ItemAnalysisModule` en `apps/api/src/app.module.ts`.
2. En `nav-items.ts`: agregar items para `/resultados/mapa-calor` y `/resultados/detalle`
   (roles `HEATMAP_VIEWER_ROLES` / `ITEM_ANALYSIS_VIEWER_ROLES`), o sub-nav dentro de
   Resultados (ver `resultados-nav.tsx`).
3. Cablear `<ExportButton>` (FE-A) en las vistas que correspondan.
4. `pnpm typecheck` + `pnpm --filter @soe/api test` + `pnpm lint` en verde.
5. H19.1: auditoría de no-hardcoding + `docs/H19.1-validacion-arquitectonica.md`.
