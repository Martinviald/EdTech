# Matriz de acceso base (línea base previa al rediseño de navegación)

> Árbol revisado: `wt-rediseno-navegacion` (origin/dev + 1 commit). Solo lectura de código: no ejecuté nada.
> Prefijos: **W** = `apps/web/src/app/(dashboard)/`, **A** = `apps/api/src/`, **T** = `packages/types/src/access-policies/`.

## Convenciones

- **Sidebar.** `apps/web/src/components/layout/nav-items.ts` muestra un item si `canAccess(roles, item.roles)` (unión de roles, nav-items.ts:343).
- **Guard común de página.** Todas las páginas usan `if (!canAccess(roles, X)) redirect(ROUTES.dashboard)`, salvo donde se indica otra cosa. El layout raíz `W/layout.tsx:20-22` solo exige sesión y `orgId`.
- **Backend.** El `RolesGuard` es global (`A/app.module.ts:135`) y autoriza por unión de roles. Si el usuario tiene `isPlatformAdmin`, pasa siempre (`A/common/guards/roles.guard.ts:38`).
- **Alcance docente.** Lo resuelve `resolveClassGroupScope` (`A/common/helpers/class-group-scope.helper.ts:108`). Decide según el **rol activo**, no por la unión de roles (línea 115).
  - Si el rol activo está en `ADMIN_LIKE_ROLES` (línea 42: pa, sa, ad, cd, dh, co, ec), el usuario ve toda la organización.
  - Si no, solo ve los pares curso/asignatura de `teacher_assignments`, más las jefaturas de `org_memberships.scope.classGroupIds` cuando tiene `homeroom_teacher` (línea 176).

### Conjuntos de roles resueltos

Abreviaturas: pa=platform_admin, fd=foundation_director, sa=school_admin, ad=academic_director, cd=cycle_director, dh=dept_head, co=coordinator, t=teacher, hrt=homeroom_teacher, ec=eval_coordinator, g=guardian.

| Constante                                                                                                                                                              | Roles                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| RESULTS*VIEWER (T/results-dashboards.ts:6). Alias: DASHBOARD*, ANALYTICS*, HEATMAP*, MASTER_BOARD_VIEWER, PROCESS_VIEWER, ITEM_ANALYSIS_VIEWER, OFFICIAL_REPORT_VIEWER | pa sa ad cd dh co ec t hrt |
| AI_ANALYSIS_VIEWER (T/ai-analysis.ts:4)                                                                                                                                | pa sa ad ec t              |
| AI_ANALYSIS_GENERATOR (:13)                                                                                                                                            | pa sa ad ec                |
| REMEDIAL_VIEWER (T/remedial.ts:5)                                                                                                                                      | pa sa ad ec t              |
| BENCHMARKING_VIEWER (T/benchmarking.ts:9)                                                                                                                              | pa fd sa ad cd ec          |
| ESTABLISHMENT_REPORT (T/official-reports.ts:14)                                                                                                                        | pa sa ad cd dh co ec       |
| TELEMETRY_VIEWER (T/telemetry.ts:11)                                                                                                                                   | pa fd sa ad                |
| CLASS_VIEWER (T/class-groups.ts:3) y ALL_STAFF_ROLES (nav-items.ts:71)                                                                                                 | pa sa ad cd dh co ec t hrt |
| ITEM_VIEWER (T/item-bank.ts:12)                                                                                                                                        | pa sa ad cd dh co ec t hrt |
| ITEM_BANK (:4)                                                                                                                                                         | pa sa ad ec                |
| SHEET_MANAGEMENT / SHEET_REVIEW / REVIEW_SETTINGS (T/sheet-scanning.ts:7,18,29)                                                                                        | pa sa ad ec                |
| DOCUMENT_VIEWER = DOCUMENT_EDITOR (T/documents.ts:7,23)                                                                                                                | pa sa ad cd dh co ec t hrt |
| ORG_ACADEMIC_ADMIN, TAXONOMY, GRADING_SCALE, AI_OBSERVABILITY, ORG_BRANDING, ASSIGNMENTS                                                                               | pa sa ad                   |
| STAFF_MANAGEMENT (T/staff-org.ts:3)                                                                                                                                    | pa sa                      |
| LLM_SETTINGS (T/llm-settings.ts:8)                                                                                                                                     | pa                         |
| STUDENT_ROSTER (T/students.ts:5)                                                                                                                                       | pa sa ad cd dh co hrt      |
| ADMIN_HUB_ROLES (admin-hub.ts:124, unión de las opciones)                                                                                                              | pa sa ad cd dh co hrt ec   |

## Detalle por vista

**1. `/dashboard` (Inicio)**

- **Sidebar:** ALL_ROLES, los 11 roles (nav-items.ts:113).
- **Guard de página:** no hay guard de rol. `W/dashboard/page.tsx:35` solo exige `orgId`.
- **Vista docente:** se activa con rol activo `teacher` o `homeroom_teacher` (:40).
- **Backend:**
  - `/item-analysis/assessments` (`A/item-analysis/item-analysis.controller.ts:25`).
  - `/organizations/me/overview` con ORG_ACADEMIC_ADMIN (`A/organizations/organizations.controller.ts:50`).
  - `/instruments` (`A/instruments/instruments.controller.ts:56`).
  - `/organizations/:id/class-groups`.
  - Todas tienen `.catch(()=>null)` (`W/dashboard/data.ts:13-25`), así que fd y g ven Inicio sin datos.
- **QuickAccess (:220-240):** muestra Panorama (RESULTS_VIEWER), `/analisis-ia` (AI_ANALYSIS_VIEWER), Material remedial (REMEDIAL_VIEWER) e Importar (IMPORT).

**2. `/evaluaciones` y `/evaluaciones/[assessmentId]`**

- **Sidebar:** DASHBOARD_VIEWER (nav-items.ts:120).
- **Guards de página:**
  - Listado: `W/evaluaciones/page.tsx:46`.
  - Detalle: `W/evaluaciones/[assessmentId]/layout.tsx:53`, con `notFound()` si `/analytics/assessment-report` falla (:61-66). Ese endpoint usa ANALYTICS_VIEWER (`A/assessment-report/assessment-report.controller.ts:21`).
- **Backend del listado:**
  - `/item-analysis/assessments` (item-analysis.controller.ts:25).
  - `/dashboards/comparable-overview` (`A/dashboards/dashboards.controller.ts:37`).
- **Pestañas (layout.tsx:85-136) y guard de cada subpágina:**

| Pestaña           | Gate de la pestaña        | Guard de la subpágina                                                                   | Backend                                                   |
| ----------------- | ------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Resumen           | ninguno                   | page.tsx:63. Las secciones se filtran por policy (:153-178)                             | —                                                         |
| Resultados        | ANALYTICS (:92)           | resultados/page.tsx:29                                                                  | `A/assessment-results/...controller.ts:52`                |
| Tablero maestro   | ITEM_ANALYSIS (:101)      | detalle/page.tsx:31                                                                     | item-analysis.controller.ts:38                            |
| Análisis IA       | AI_ANALYSIS_VIEWER (:110) | analisis-ia/page.tsx:38, flag `ai_analysis` (:77)                                       | `A/ai-analysis/ai-analysis.controller.ts:78`              |
| Material remedial | REMEDIAL_VIEWER (:119)    | material-remedial/page.tsx:53, flag `remedial` (:99)                                    | `A/remedial/remedial.controller.ts:149`                   |
| Informe oficial   | OFFICIAL_REPORT (:128)    | informe-oficial/page.tsx:36. Informe por alumno: informe-alumno/[studentId]/page.tsx:40 | `A/official-reports/official-reports.controller.ts:39,63` |

- **Alcance docente:** sí. Lo aplican assessment-report.service.ts:1314, item-analysis.service.ts:1424 y report-support.service.ts:96.
- **Otros accesos:** `W/dashboard/components/recent-assessments-card.tsx:51` y `W/evaluaciones/components/assessment-list.tsx:74`.

**3. `/procesos` y `/procesos/[processId]`**

- **Sidebar:** PROCESS_VIEWER (nav-items.ts:127).
- **Guards de página:** `W/procesos/page.tsx:27` y `W/procesos/[processId]/layout.tsx:28`, con `notFound()` en :35-37.
- **Backend:**
  - `A/measurement-processes/measurement-processes.controller.ts:38,56,88` (PROCESS_VIEWER).
  - Candidatos en :97 (PROCESS_MANAGEMENT). La página solo los pide si `canManage` (page.tsx:33).
- **Pestañas:** Resumen y Rendición, sin gate (layout.tsx:41-44).
- **Otros accesos:** `W/procesos/components/process-card.tsx:33` y `W/resultados/components/process-preview-banner.tsx:95`.

**4. `/resultados` (Panorama)**

- **Sidebar:** DASHBOARD_VIEWER, con las pestañas como hijos (nav-items.ts:134-135).
- **Pestañas:** el menú no tiene gate (`W/resultados/components/resultados-nav.tsx:17`). Cada pestaña tiene su propio guard, y todos resuelven a RESULTS_VIEWER:

| Pestaña         | Guard                                                                     | Backend                                              |
| --------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Resumen         | page.tsx:57                                                               | dashboards.controller.ts:37-120                      |
| Tablero maestro | tablero-maestro/page.tsx:31 (vista por docente: TEACHER_PERFORMANCE, :34) | `A/master-board/master-board.controller.ts:25,34,43` |
| Clasificación   | clasificacion/page.tsx:66                                                 | dashboards.controller.ts                             |
| Dimensiones     | dimensiones/page.tsx:48 (`habilidades` solo redirige)                     | dashboards.controller.ts                             |
| Mapa de calor   | mapa-calor/page.tsx:45                                                    | `A/heatmap/heatmap.controller.ts:26`                 |
| Trayectoria     | trayectoria/page.tsx:132                                                  | `A/analytics/analytics.controller.ts:24`             |

- `detalle` e `informe` solo redirigen a `/evaluaciones/...`.
- **Llamada colateral:** `/benchmarking/samples` requiere BENCHMARKING_VIEWER (`A/benchmarking/benchmarking.controller.ts:32`). Para roles sin ese permiso falla en silencio, porque hay un `catch` en `apps/web/src/lib/benchmark-samples.ts:35`.
- **Alcance docente:** sí, en dashboards.service.ts, heatmap.service.ts:98, master-board.service.ts:145 y comparable-trajectory.service.ts:110.
- **Otros accesos:** a Trayectoria desde `W/resultados/components/generational-banner.tsx:32`.

**5. `/estudiantes` y `/estudiantes/[studentId]`**

- **Sidebar:** DASHBOARD_VIEWER (nav-items.ts:144).
- **Guards de página:** RESULTS_VIEWER en `W/estudiantes/page.tsx:36` y `W/estudiantes/[studentId]/page.tsx:68`.
- **Backend:** RESULTS_VIEWER en `A/students/student-signals.controller.ts:21`, `student-panorama.controller.ts:23` y `student-comparisons.controller.ts:22`.
- **Alcance docente:** sí (student-signals.service.ts:85, panorama :120, comparisons :102).
- **Otros accesos:** `W/estudiantes/components/signals-table.tsx:132` y `W/evaluaciones/[assessmentId]/informe-alumno/[studentId]/page.tsx:46`.

**6. `/comparar-instrumentos`**

- **Sidebar:** AI_ANALYSIS_GENERATOR (nav-items.ts:152).
- **Guard de página:** `W/comparar-instrumentos/page.tsx:21`.
- **Feature flag:** `ai_analysis` (:24). Si está apagado, muestra `FeatureUpgradeNotice`.
- **Backend:** `A/ai-analysis/instrument-comparison.controller.ts:45` (GENERATOR) y :86 (VIEWER).
- **Otros accesos:** ninguno.

**7. `/material-remedial` y `/material-remedial/[id]`**

- **Sidebar:** REMEDIAL_VIEWER (nav-items.ts:159).
- **Guards de página:**
  - Listado: `W/material-remedial/page.tsx:53`, con flag `remedial` (:54).
  - Detalle: `[id]/page.tsx:44`. **El detalle no revisa el flag.**
- **Backend:** remedial.controller.ts:149, :126 y :139 (REMEDIAL_VIEWER).
- **Alcance docente:** sí (remedial.service.ts:113,250).
- **Otros accesos:**
  - QuickAccess (`W/dashboard/page.tsx:231`).
  - `W/analisis-ia/components/skill-gaps.tsx:31`.
  - `W/evaluaciones/[assessmentId]/material-remedial/page.tsx:143`.
  - Al detalle: `components/material-card.tsx:27`.

**8. `/benchmarking`**

- **Sidebar:** BENCHMARKING_VIEWER (nav-items.ts:166).
- **Guard de página:** `W/benchmarking/page.tsx:81`. No tiene flag.
- **Backend:** benchmarking.controller.ts:47,54.
- **Otros accesos:** `apps/web/src/components/shared/sample-contrast.tsx:65`.

**9. `/establecimiento/informe-oficial`**

- **Sidebar:** ESTABLISHMENT_REPORT (nav-items.ts:173).
- **Guard de página:** `W/establecimiento/informe-oficial/page.tsx:41`.
- **Backend:** official-reports.controller.ts:51.
- **Alcance docente:** pasa por report-support.service.ts:96, pero ningún rol docente tiene acceso a esta vista.

**10. `/telemetria`**

- **Sidebar:** TELEMETRY_VIEWER (nav-items.ts:182).
- **Guard de página:** `W/telemetria/page.tsx:13`.
- **Backend:** `A/telemetry/telemetry.controller.ts:57`.
- **Otros accesos:** ninguno.

**11. `/dashboard/my-classes` y `/dashboard/my-classes/[classGroupId]`**

- **Sidebar:** ALL_STAFF_ROLES (nav-items.ts:191).
- **Guards de página:**
  - Listado: `W/dashboard/my-classes/page.tsx:14` solo exige `orgId` (**no hay guard de rol**).
  - Detalle: `[classGroupId]/page.tsx:53` (CLASS_VIEWER), con `notFound()` en :61.
- **Backend:** class-groups.controller.ts:21,48, con roles inline equivalentes a CLASS_VIEWER.
- **Alcance docente:** `A/class-groups/class-groups.service.ts:42` (rol activo en TEACHER_ROLES) filtra por `teacher_assignments` (:72-78).
- **Otros accesos:** `W/dashboard/page.tsx:50,111` (vista docente).

**12. `/banco-contenido` y `/banco-contenido/[instrumentId]`**

- **Sidebar:** lista inline pa, sa, ad, ec, t, hrt (nav-items.ts:204-211).
- **Guards de página:** todos usan ITEM_VIEWER:
  - `(hub)/page.tsx:53`, `(hub)/explorar/page.tsx:117`, `(hub)/colecciones/page.tsx:21`.
  - `[instrumentId]/page.tsx:26`.
  - Spec-table: `[instrumentId]/spec-table/page.tsx:27` (ITEM_VIEWER). `spec-table/cargar` (:16) y `etiquetar` (:25) usan ITEM_BANK.
- **Backend:**
  - instruments.controller.ts:67,84 usan una constante local `INSTRUMENT_VIEWER_ROLES` (:30). Sus roles son sa ad cd dh co ec hrt t, **sin `platform_admin`**; ese rol solo entra por el bypass del flag `isPlatformAdmin`.
  - `A/items/items.controller.ts:50`.
  - `A/item-collections/item-collections.controller.ts:33`.
- **Otros accesos:** `W/banco-contenido/InstrumentRow.tsx:25`.

**13. `/hojas`**

- **Sidebar:** SHEET_MANAGEMENT (nav-items.ts:221).
- **Guards de página:** `W/hojas/page.tsx:36`. También `escanear` :44, `[id]/disenar` :27, `[id]/imprimir` :46 y `lotes/[batchId]/revisar` :24 (SHEET_REVIEW).
- **Backend:**
  - `A/sheet-scanning/sheet-print-runs.controller.ts:49,60`.
  - La revisión usa SHEET_REVIEW + `SensitiveDataGuard` (scan-review.controller.ts:37-38,64-65,83-84,101-102). `SensitiveDataGuard` exige SENSITIVE_DATA (pa sa ad ec).

**14. `/materiales` y `/materiales/[id]`**

- **Sidebar:** DOCUMENT_VIEWER (nav-items.ts:230).
- **Guards de página:** `W/materiales/page.tsx:51`, `[id]/page.tsx:26` e `imprimir/page.tsx:39`.
- **Edición:** se habilita si se cumple `isPlatformAdmin` o DOCUMENT_EDITOR (:30-31) y además el usuario es el autor (:75).
- **Backend:** `A/documents/documents.controller.ts:71,88,174`.
- **Otros accesos:** `W/banco-contenido/[instrumentId]/CreateMaterialButton.tsx:28` y `W/materiales/document-row.tsx:65`.

**15. `/administracion` y las opciones del hub**

- **Sidebar:** ADMIN_HUB_ROLES (nav-items.ts:245).
- **Guard de página:** `W/administracion/page.tsx:25-30` llama a `accessibleHubOptions`. Esta función hace bypass con `isPlatformAdmin` (admin-hub.ts:149) y **no descarta las opciones `soon`**. Si el usuario no tiene ninguna opción accesible, redirige a `/dashboard`.
- **Otros accesos:** breadcrumb `page-titles.ts:115`.
- **Opciones:**

| Opción (roles de la tarjeta)                          | Guard de página                                                                                                                    | Backend                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/organizacion` (ORG_ACADEMIC_ADMIN)                  | `W/organizacion/page.tsx:19`: **solo `orgId`, sin guard de rol**                                                                   | organizations.controller.ts:50 (ORG_ACADEMIC_ADMIN). Otros roles reciben error                                    |
| `/equipo` (STAFF ∪ ASSIGNMENTS)                       | `W/equipo/page.tsx:16-21`: STAFF; si no, ASSIGNMENTS va a `/equipo/asignaciones` (`asignaciones/page.tsx:18`); si no, `/dashboard` | `A/staff/staff.controller.ts:50` (sa, pa inline); `A/teacher-assignments/...controller.ts:31` (sa, ad, pa inline) |
| `/alumnos` (STUDENT_ROSTER, `soon`)                   | **no existe carpeta de ruta** (404); la tarjeta está deshabilitada                                                                 | —                                                                                                                 |
| `/marcos-academicos` (TAXONOMY)                       | `W/marcos-academicos/page.tsx:40`, `[taxonomyId]/page.tsx:27`                                                                      | `A/taxonomies/taxonomies.controller.ts:32,48` (inline)                                                            |
| `/configuracion/escalas` (GRADING_SCALE)              | `W/configuracion/escalas/page.tsx:17`                                                                                              | grading-scales.controller.ts:39 (lectura: ANSWER_SHEET_IMPORT), :52 (escritura)                                   |
| `/configuracion/observabilidad-ia` (AI_OBSERVABILITY) | `observabilidad-ia/page.tsx:29`                                                                                                    | ai-observability.controller.ts:23-41                                                                              |
| `/configuracion/identidad` (ORG_BRANDING)             | `identidad/page.tsx:19-22` (`isPlatformAdmin` o rol)                                                                               | organizations.controller.ts:73 (GET sin @Roles), :83                                                              |
| `/configuracion/revision-hojas` (REVIEW_SETTINGS)     | `revision-hojas/page.tsx:19-22` (`isPlatformAdmin` o rol)                                                                          | review-settings.controller.ts:21                                                                                  |
| `/configuracion/modelos-ia` (LLM_SETTINGS)            | `modelos-ia/page.tsx:20-23` (`isPlatformAdmin` o pa)                                                                               | `A/llm/llm-settings.controller.ts:19`                                                                             |

- `/configuracion` sin subruta redirige a la primera opción accesible (`W/configuracion/page.tsx:15-21`).

## Resumen

Leyenda: **S** = item del sidebar, **H** = vía hub de Administración, **C** = solo por enlace en contexto, **U** = solo escribiendo la URL, **—** = el guard de página lo deniega. Las celdas con ² se explican en las notas.

| Vista                   | pa                              | fd  | sa  | ad  | cd  | dh  | co  | t   | hrt | ec  | g   |
| ----------------------- | ------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Inicio                | S                               | S   | S   | S   | S   | S   | S   | S   | S   | S   | S   |
| 2 Evaluaciones          | S                               | —   | S   | S   | S   | S   | S   | S   | S   | S   | —   |
| 3 Procesos              | S                               | —   | S   | S   | S   | S   | S   | S   | S   | S   | —   |
| 4 Panorama (+tabs)      | S                               | —   | S   | S   | S   | S   | S   | S   | S   | S   | —   |
| 5 Estudiantes           | S                               | —   | S   | S   | S   | S   | S   | S   | S   | S   | —   |
| 6 Comparar instr.¹      | S                               | —   | S   | S   | —   | —   | —   | —   | —   | S   | —   |
| 7 Material remedial¹    | S                               | —   | S   | S   | —   | —   | —   | S   | —   | S   | —   |
| 8 Benchmarking          | S                               | S   | S   | S   | S   | —   | —   | —   | —   | S   | —   |
| 9 Informe establec.     | S                               | —   | S   | S   | S   | S   | S   | —   | —   | S   | —   |
| 10 Telemetría           | S                               | S   | S   | S   | —   | —   | —   | —   | —   | —   | —   |
| 11 Mis cursos           | S                               | U²  | S   | S   | S   | S   | S   | S   | S   | S   | U²  |
| 12 Banco contenido      | S                               | —   | S   | S   | U   | U   | U   | S   | S   | S   | —   |
| 13 Hojas                | S                               | —   | S   | S   | —   | —   | —   | —   | —   | S   | —   |
| 14 Materiales           | S                               | —   | S   | S   | S   | S   | S   | S   | S   | S   | —   |
| 15 Administración (hub) | S                               | —   | S   | S   | S³  | S³  | S³  | —   | S³  | S   | —   |
| 15a Organización        | H                               | U²  | H   | H   | U²  | U²  | U²  | U²  | U²  | U²  | U²  |
| 15b Equipo              | H                               | —   | H   | H⁴  | —   | —   | —   | —   | —   | —   | —   |
| 15c Marcos / taxonomía  | H                               | —   | H   | H   | —   | —   | —   | —   | —   | —   | —   |
| 15d Escalas             | H                               | —   | H   | H   | —   | —   | —   | —   | —   | —   | —   |
| 15e Observabilidad IA   | H                               | —   | H   | H   | —   | —   | —   | —   | —   | —   | —   |
| 15f Identidad           | H                               | —   | H   | H   | —   | —   | —   | —   | —   | —   | —   |
| 15g Revisión de hojas   | H                               | —   | H   | H   | —   | —   | —   | —   | —   | H   | —   |
| 15h Modelos IA          | H                               | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| 15i Alumnos             | 404 (`soon`, la ruta no existe) |     |     |     |     |     |     |     |     |     |     |

**Notas**

1. **Feature flags.** Comparar instrumentos y el listado de Material remedial muestran `FeatureUpgradeNotice` si el flag `ai_analysis` o `remedial` está apagado. Lo mismo pasa con las pestañas Análisis IA y Material remedial de la evaluación. `/material-remedial/[id]` no revisa el flag. El asistente IA del layout depende de `ai_assistant` (`W/layout.tsx:35`).
2. **La página entra, pero el backend responde 403 y la vista falla.** El guard de página no revisa el rol. En Mis cursos, CLASS_VIEWER no incluye fd ni g. En Organización, `/organizations/me/overview` exige ORG_ACADEMIC_ADMIN. El detalle `/dashboard/my-classes/[id]` sí deniega a fd y g.
3. **Hub sin contenido útil.** cd, dh, co y hrt ven el item "Administración" solo porque la tarjeta `soon` de Alumnos (STUDENT_ROSTER) entra en ADMIN_HUB_ROLES. Dentro del hub solo encuentran esa tarjeta deshabilitada.
4. ad entra a Equipo, pero lo redirigen a `/equipo/asignaciones`.

**Otros puntos para el auditor**

- **hrt queda fuera de REMEDIAL_VIEWER y AI_ANALYSIS_VIEWER.** No ve esas pestañas en la evaluación.
- **Banco de contenido:** el sidebar es más estrecho que el guard de página. cd, dh y co pueden entrar escribiendo la URL.
- **`platform_admin`:** el guard de página revisa el rol `platform_admin`, mientras que el backend y algunas páginas de configuración hacen bypass con el flag `isPlatformAdmin`.
