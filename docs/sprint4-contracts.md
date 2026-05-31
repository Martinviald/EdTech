# Sprint 4 — Contratos (Dashboards core)

> **READ THIS FILE COMPLETELY BEFORE WRITING ANY CODE.**
> Rama de integración: `sprint-4` (salida de `dev`). Cada agente trabaja en su
> propio worktree aislado y DEBE commitear antes de terminar.

Sprint 4 construye la **capa de visualización** (dashboards) sobre los datos ya
procesados en S3 (`assessment_results`, `skill_results`, `responses`). **No hay
migración de BD nueva**: se reusan las tablas de F1. Los umbrales de nivel de
desempeño viven en `grading_scales.config.performanceThresholds` (ya soportado).

Historias: **H6.1, H6.2, H6.3, H6.4, H6.5, H6.6, H6.7, H6.8, H6.9**.

---

## 0. Contratos compartidos (ya committeados en `sprint-4`)

- `packages/types/src/schemas/dashboard.schema.ts` — Models + query DTOs de dashboards.
- `packages/types/src/schemas/analytics.schema.ts` — Models + query DTOs de analítica.
- `packages/types/src/access-policies.ts` — `DASHBOARD_VIEWER_ROLES`, `ANALYTICS_VIEWER_ROLES`
  (ambos = `RESULTS_VIEWER_ROLES`; el scoping por curso de profesores lo aplica el service).
- Libs frontend ya instaladas en `apps/web`: **recharts** (gráficos), **xlsx** +
  **jspdf** + **jspdf-autotable** (export H6.9).

Importar SIEMPRE los tipos desde `@soe/types`. No redefinir tipos locales que dupliquen un Model.

---

## 1. División en agentes

| Agente | Tipo | Módulo / Ruta (propiedad exclusiva) | Historias |
|---|---|---|---|
| **BE-A** | backend | `apps/api/src/dashboards/` | H6.1, H6.2, H6.4, H6.5, H6.7, H6.8 |
| **BE-B** | backend | `apps/api/src/analytics/` | H6.3, H6.6 |
| **FE-A** | frontend | `apps/web/src/app/(dashboard)/resultados/` (shell + snapshot) | H6.1, H6.2, H6.4, H6.5, H6.7, H6.8 |
| **FE-B** | frontend | `apps/web/src/app/(dashboard)/resultados/comparacion/` y `/progresion/` + export | H6.3, H6.6, H6.9 |

**Aislamiento:** cada agente toca SOLO su directorio. **NADIE** toca en desarrollo:
`apps/api/src/app.module.ts`, `apps/web/src/components/layout/nav-items.ts`,
`apps/web/src/lib/api.ts`, `apps/web/src/app/(dashboard)/layout.tsx`,
`packages/types/*`, `packages/db/*`. Esos se integran en Fase 4.

---

## 2. Convenciones backend (NestJS + Drizzle)

Patrón de referencia: `apps/api/src/assessment-results/` (service, controller, scoping).

- **Inyección DB:** `constructor(@InjectDb() private readonly db: Database) {}` desde
  `../database/database.types`.
- **Auth:** `@UseGuards(RolesGuard)` + `@Roles(...ROLES)` + `@CurrentUser() user: JwtPayload`.
  Validar query/body con el schema Zod (`schema.parse(query ?? {})`) en el controller.
- **Scoping por rol (OBLIGATORIO):** replicar `getAccessibleClassGroupIds(user, orgId)` de
  `assessment-results.service.ts`:
  - `platform_admin` o roles admin-like (`school_admin, academic_director, cycle_director,
    dept_head, coordinator, eval_coordinator`) → `scopeAll = true` (toda la org).
  - profesor (`teacher, homeroom_teacher`) → sólo class_groups vía `teacher_assignments →
    subject_classes → class_groups` con `teacherAssignments.userId = user.userId`.
  - **`org_id` SIEMPRE viene de `user.orgId`/del assessment, NUNCA del query.**
- **Multi-tenancy:** toda query filtra por `org_id`. **Soft deletes:** `isNull(students.deletedAt)`,
  `isNull(items.deletedAt)`, `isNull(instruments.deletedAt)`.
- **% logro:** `assessment_results.percentage` y `skill_results.percentage` están en `0..100`
  (decimal string). Para promedios usar `avg(... ::numeric)`. Preferir `responses.final_score`
  sobre `raw_score` si recalculas algo (reusar helpers de `@soe/types`:
  `aggregateStudentResults`, `aggregateSkillResults`, `percentageToPerformanceLevel`).
- **Skills = `taxonomy_nodes`** vía `item_taxonomy_tags.node_id`. No hay columna "skill" en items.
- **Año/período:** `assessments.administered_at` (timestamp) y `academic_years.year` vía
  `class_groups.academic_year_id` / `student_enrollments.academic_year_id`.
- **Batch:** nunca insertar/consultar en loop (N+1). Agregar en SQL con `group by`.
- **Tests:** ≥8 tests por service (`*.service.spec.ts`), happy path + edge (sin datos, scoping
  de profesor, filtros). No mockear lógica de negocio trivial; testear agregaciones.
- **Compilación:** `cd apps/api && npx tsc --noEmit` sin errores antes de terminar.
- **NO** registrar el módulo en `app.module.ts` (lo hace integración). Sí crear el `*.module.ts`.

### 2.1 Endpoints BE-A — módulo `dashboards/` (base `/api/dashboards`)

Roles: `@Roles(...DASHBOARD_VIEWER_ROLES)`. Query: `dashboardFiltersQuerySchema`
(o `dashboardPerformanceQuerySchema` en performance).

| Verbo + Path | Query DTO | Response Model | Historia |
|---|---|---|---|
| `GET /api/dashboards/overview` | `DashboardFiltersQueryDto` | `DashboardOverviewResponse` | H6.1 / H6.7 |
| `GET /api/dashboards/filters` | `DashboardFiltersQueryDto` | `DashboardFilterOptionsResponse` | H6.2 |
| `GET /api/dashboards/performance` | `DashboardPerformanceQueryDto` | `DashboardPerformanceResponse` | H6.4 |
| `GET /api/dashboards/skills` | `DashboardFiltersQueryDto` | `DashboardSkillsResponse` | H6.5 |
| `GET /api/dashboards/teacher-kpis` | `DashboardFiltersQueryDto` | `DashboardTeacherKpisResponse` | H6.8 |

Notas de comportamiento:
- **overview**: `scope` = `'teacher'` si el caller es profesor puro (no admin-like), si no `'org'`.
  `globalAchievement` = promedio de `assessment_results.percentage` sobre el scope filtrado.
  `recentAssessments` = últimas evaluaciones (orden `administered_at` desc, máx 5).
  `alerts` = derivar al menos: cursos con % logro < 60 (`low_achievement`), habilidades con
  promedio < 50 (`critical_skill`). Lista vacía si no aplica.
- **filters**: devolver sólo opciones visibles para el scope del usuario (un profesor sólo ve
  sus cursos/asignaturas). `periods` = `academic_years` de la org.
- **performance**: si viene `assessmentId`, opera sobre esa evaluación; si no, agrega sobre todas
  las evaluaciones que matchean los filtros, contando cada `(alumno, assessment)` como punto en
  `distribution` y promediando por alumno en `students`. `thresholds` (0..1) desde la grading
  scale aplicable (o defaults 0.4/0.7/0.85). `students` es paginado `{ data, total, page, limit }`.
- **skills**: agrega `skill_results` por `node_id` sobre el scope; `averageAchievement` =
  promedio de `percentage`; `studentsAssessed` = alumnos distintos con ese skill.
- **teacher-kpis**: una fila por class_group del scope del profesor (admins ven todos sus cursos
  filtrados). `criticalStudents` = alumnos en nivel `'insufficient'`; `passingRate` = % alumnos
  con `grade >= passing_grade` de la escala.

### 2.2 Endpoints BE-B — módulo `analytics/` (base `/api/analytics`)

Roles: `@Roles(...ANALYTICS_VIEWER_ROLES)`.

| Verbo + Path | Query DTO | Response Model | Historia |
|---|---|---|---|
| `GET /api/analytics/generational` | `GenerationalComparisonQueryDto` | `GenerationalComparisonResponse` | H6.3 |
| `GET /api/analytics/progression` | `ProgressionQueryDto` | `ProgressionResponse` | H6.6 |

Notas:
- **generational**: agrupa por `academic_years.year` para el `gradeId` (y filtros opcionales).
  `series` ordenada por año asc. Puede tener 0 o 1 punto si sólo hay un período (válido —
  el frontend muestra estado "sin comparación disponible").
- **progression**: serie de evaluaciones dentro del período, ordenada por `administered_at` asc.
  `scope=student` → % del alumno; `scope=class` → promedio del curso; `scope=skill` → promedio
  del nodo (skill) sobre el scope visible. `entityId`/`entityLabel` identifican la entidad medida.

---

## 3. Convenciones frontend (Next.js 15 App Router)

Patrón de referencia: `apps/web/src/app/(dashboard)/curriculum/page.tsx` y `banco-items/page.tsx`.

- **Server Components por defecto.** `'use client'` sólo para interactividad (filtros, gráficos
  recharts, botones de export). Recharts es client-only → componentes de gráfico llevan `'use client'`.
- **Auth en cada página protegida:**
  ```ts
  const session = await auth();              // from '@/auth'
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect('/dashboard');
  ```
- **Data fetch:** `apiGet<ResponseModel>('/dashboards/overview?...')` desde `@/lib/api` en Server
  Components. Tipar SIEMPRE con el Model del contrato. No usar `useEffect` para fetch inicial.
- **searchParams (Next 15):** `searchParams` es `Promise` → `const params = await searchParams;`.
  Los filtros (H6.2) viven en la URL (querystring) para compartir/bookmarkear.
- **Mutations/acciones** (export): server actions en `actions.ts` con `'use server'`, o para el
  export client-side (xlsx/jspdf) un componente `'use client'` con botón de descarga.
- **UI en español, mobile-first** (clases `sm: md: lg:`). shadcn/ui en `apps/web/src/components/ui/`
  (button, card, table, select, badge, tabs?, skeleton). Patrones en `components/patterns/`
  (`PageHeader`, `PageContainer`, `EmptyState`). **No** colores hardcodeados; usar tokens Tailwind.
- **NO** tocar `nav-items.ts`, `lib/api.ts`, `layout.tsx` (integración los maneja).
- **Compilación:** `cd apps/web && npx tsc --noEmit` sin errores antes de terminar.

### 3.1 Rutas y propiedad

| Ruta | Agente | Contenido |
|---|---|---|
| `resultados/page.tsx` | FE-A | Overview directivo/profesor (cards H6.1/H6.7, KPIs H6.8) |
| `resultados/clasificacion/page.tsx` | FE-A | Distribución + tabla de clasificación por nivel (H6.4) |
| `resultados/habilidades/page.tsx` | FE-A | % logro por habilidad (H6.5) |
| `resultados/components/` | FE-A | **Filter bar compartido** + cards/tablas reutilizables |
| `resultados/comparacion/page.tsx` | FE-B | Comparación de generaciones, line/bar chart (H6.3) |
| `resultados/progresion/page.tsx` | FE-B | Progresión temporal, line chart (H6.6) |
| `resultados/export/` (o componente) | FE-B | Botón "Exportar vista" → xlsx/pdf client-side (H6.9) |

### 3.2 Contrato del Filter Bar compartido (lo crea FE-A, lo consume FE-B)

FE-A DEBE crear este componente con esta firma exacta para que FE-B lo importe:

```tsx
// apps/web/src/app/(dashboard)/resultados/components/dashboard-filter-bar.tsx
'use client';
import type { DashboardFilterOptionsResponse } from '@soe/types';

export type DashboardFilterValues = {
  subjectId?: string;
  gradeId?: string;
  classGroupId?: string;
  studentId?: string;
  academicYearId?: string;
  instrumentType?: string;
};

export function DashboardFilterBar(props: {
  options: DashboardFilterOptionsResponse;
  value: DashboardFilterValues;
  /** basePath de la ruta actual; el bar actualiza la querystring (router.push). */
  basePath: string;
}): JSX.Element;
```

- El bar lee/escribe el estado en la URL (querystring) usando `useRouter`/`useSearchParams`.
- FE-B importa `DashboardFilterBar` y `DashboardFilterValues` desde esa ruta. **Mientras FE-A no
  esté mergeado**, FE-B puede stubbearlo localmente con la MISMA firma y reemplazar el import en
  integración — pero el contrato de props NO cambia.
- Helper para parsear filtros desde `searchParams` también vive en `components/` (export
  `parseDashboardFilters(params): DashboardFilterValues`).

### 3.3 Export client-side (H6.9 — FE-B)

- Excel: `xlsx` (`XLSX.utils.json_to_sheet` → `XLSX.writeFile`).
- PDF: `jspdf` + `jspdf-autotable` (tabla de la vista actual + título con filtros aplicados).
- El botón exporta los datos YA cargados en la vista (no hace fetch nuevo). Componente `'use client'`.

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
- [ ] CA3: Soft deletes — queries filtran `deleted_at IS NULL` donde aplique.
- [ ] CA4: Roles — guards/`canAccess()` usan constantes de `@soe/types` (`DASHBOARD_VIEWER_ROLES` /
  `ANALYTICS_VIEWER_ROLES`). NUNCA roles inline.
- [ ] CA5: Response shapes coinciden EXACTAMENTE con los Models de `@soe/types` (sin campos de más/menos).
- [ ] CA6: (frontend) UI en español, responsive, sin colores hardcodeados, sin tipos locales que dupliquen Models.
- [ ] CA7: No se tocaron archivos compartidos (`app.module.ts`, `nav-items.ts`, `lib/api.ts`, `layout.tsx`, `packages/*`).
- [ ] CA8: Estados vacíos manejados (sin datos / sin comparación / profesor sin cursos) con `EmptyState`.

---

## 5. Integración (Fase 4 — la hace el orquestador, NO los agentes)

1. Registrar `DashboardsModule` y `AnalyticsModule` en `apps/api/src/app.module.ts`.
2. En `nav-items.ts`: cambiar el item `/resultados` de `status: 'soon'` a `'live'` (roles
   `DASHBOARD_VIEWER_ROLES`).
3. Reemplazar el stub del filter bar en FE-B por el import real de FE-A si aplica.
4. `pnpm typecheck` + `pnpm --filter @soe/api test` + `pnpm lint` en verde.
