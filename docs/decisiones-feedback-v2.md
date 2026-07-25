# Registro de decisiones — Ejecución autónoma Feedback v2

> Decisiones tomadas durante la ejecución autónoma del plan (`docs/plan-iteracion-feedback-v2.md`),
> para **revisión posterior** del equipo. El testing E2E manual se hará al final.
> Rama: `sprint-feedback-v2` (worktree `~/Desktop/EdTech/sprint-feedback-v2`), un commit por ticket.

---

## Decisiones globales de ejecución

- **Worktree + commits:** todo en `sprint-feedback-v2` (desde `dev`). 1 commit atómico por ticket, con `typecheck` + `lint` verdes antes de cada commit. Mensajes en español + trailer `Co-Authored-By`.
- **Prettier:** solo `npx prettier --write` sobre archivos con cambios sustanciales. En cambios mínimos (p. ej. una palabra) se respeta el estilo existente y NO se corre prettier, para evitar reformateos de archivo completo (el repo no está prettier-clean; `pnpm format` está prohibido — reformatea ~398 archivos). Los primitivos shadcn no se reestructuran.
- **Migraciones de BD:** se **generan** (`pnpm db:generate`) y commitean, pero **no se aplican** (no hay DB en este entorno); la validación queda para el E2E manual. Toda tabla nueva sensible por colegio agrega su política a `packages/db/sql/rls-policies.sql` (§5.2) y corre queries dentro de `withOrgContext`.
- **Features de F2 adelantadas** por prioridad del usuario (Estudio IA, vista 360, dificultad, listas de ítems): se construye el código completo (schema + backend + UI) y se verifican los chequeos estáticos; el comportamiento en runtime se valida en el E2E final.
- **Dudas abiertas del plan (§7):** donde una duda bloquea, se toma la opción recomendada por los lineamientos y se registra aquí para revisión.

---

## Ola 1 — implementada (commits `92a34a9`…`39cfaa5`)

- **T2-03 (idioma):** solo se tradujeron las 2 fugas reales de inglés en la UI (`"Close"→"Cerrar"` en `dialog`/`sheet`). **No** se tocaron los prompts "español de Chile": es una elección deliberada y **testeada** (`assistant.constants.spec.ts` asegura `/español de Chile/i`) y correcta para F1 (colegios chilenos). La duda #5 (Chile vs. LatAm neutro) queda **abierta** para tu decisión.
- **T2-04 (calidad de ítem):** "desactivar por ahora" se implementó como (a) ocultar el bloque de veredicto IA "Calidad del ítem" en `item-insight-dialog`, y (b) quitar la pestaña "Calidad" del hub de evaluación. La ruta/página/componentes quedan en el código para reactivar. *Alternativa no elegida:* conservar la pestaña solo con KR-20 (confiabilidad del instrumento) y ocultar solo las banderas por ítem.

---

## Ola 2 — decisiones al ejecutar

- **T2-09 (sacar del sidebar):** se quita del sidebar solo **"Análisis IA"** (su top-level ya es un redirect al hub → seguro). **"Material Remedial"** se quitará cuando exista **"Estudio de material"** (T2-19); **"Comparar instrumentos"** cuando tenga hogar en el hub (se coordina con T2-10). Se evita dejar features sin punto de entrada.
- **T2-25 (banco → /banco-contenido):** se eligen **tabs por subruta** (`/banco-contenido` + `/banco-contenido/explorar`) en lugar de `?tab=items|instrumentos` literal, siguiendo `07-navigation-reactivity` (streaming + `loading.tsx` por tab, code-split). El tab activo **igual persiste en la URL** (es la ruta) y es compartible, cumpliendo el objetivo del feedback. *Revisar si se prefiere el `?tab=` literal.*
- **T2-08 (degradar Mis cursos + colapsables) — implementado:** "Mis cursos" se movió al FINAL del grupo "Análisis" (no se pudo mover a "Administración" porque ese grupo es solo admins y los profesores perderían el acceso). Los grupos del sidebar ahora son **colapsables** (`SidebarNav.tsx`, persistido en `localStorage: soe:sidebar-groups-collapsed`, por defecto todos expandidos). `MobileSidebar` se dejó sin colapso por grupo (es un drawer). Commit `06ab6f6`.
- **T2-07 (Mis cursos a filas) — implementado:** lista densa (`divide-y rounded-lg border`) siguiendo el patrón de `assessment-list.tsx`; las asignaturas se muestran como badges en línea con el rol (Titular/Asistente). Commit `e7c042e`.
- **⚠️ Hallazgo importante:** `dev` avanzó durante la sesión (tip `8310a84`). Varias suposiciones del plan (basadas en el dev anterior) están desactualizadas: p. ej. el banco YA está consolidado como "Banco de contenido" (hub con tabs por subruta), `nav-items` usa `ROUTES.*` + `children` (flyouts), y la infraestructura de navegación (PageTabs, useOptimisticRoute) ya existe. Se re-mapea el estado actual antes de cada cluster; algunos tickets pueden estar parcial/totalmente hechos.

## Olas 2-3 — decisiones tomadas (implementadas)

- **T2-06 (tablero maestro):** rótulo del tab "Detalle por pregunta" → **"Tablero maestro"**; fila del alumno densificada (solo el nombre; RUT/curso/correctas al tooltip). % colegio ya existía; benchmark diferido. Commit `204551e`.
- **T2-10 (query params + volver):** selección de `comparison-workbench` (base/comparación/enfoque) movida a query params (`router.replace`); breadcrumb "Evaluaciones / …" agregado al hub (afordancia de volver) vía slot `breadcrumb` de `PageHeader` (ya funcional). Commit `c5c2b8e`.
- **T2-25 (parcial UI):** header del banco en una fila (tabs + título a la derecha) y CTA "Nuevo instrumento" quitado. **Rename de la RUTA `/banco-items`→`/banco-contenido` PENDIENTE** (ver abajo). Commit `9e3fb2e`.
- **T2-26 (paginación banco ítems):** pager 20/pág con `PaginationControls` (ya existía) + `?page=`; `ItemBankScopeSelect` quitado (scope fijo `all`). ⚠️ Fix `c2d455c`: el API usa `pageSize` (no `limit`) — la `paginationSchema` común es `page`+`pageSize`. Commits `c8a6991`+`c2d455c`.
- **T2-16 (taxonomía por asignatura):** agrupación **aditiva y segura** de los nodos raíz por asignatura (headers solo si hay 2+ asignaturas); no reorganiza el árbol. La taxonomía DIA (foco F1) ya es subject-first. Commit `975570b`.
- **T2-18 (unificar panel de pregunta):** **verificado — sustancialmente satisfecho, sin cambio.** El panel de resultados YA muestra enunciado + alternativas con la correcta marcada + nodos (dentro de "Distribución"), y comparte el shell (`question-detail-sheet`) con el de instrumento. Forzarlos idénticos quitaría valor contextual (distribución vs. propuestas de edición). *Revisar en E2E si se requiere convergencia visual adicional.*
- **T2-13 (banco multi-select):** asignatura y nivel a **multi-select** (reutilizando `NodeTypeFilter`); backend `subjectId`/`gradeId` aceptan CSV/array (`inArray`, backward-compatible); reset de página al filtrar. El **eje/narrower** se dejó single (cascada de scoping intrincada). ⚠️ La lógica de `matchesScope` (qué nodos quedan disponibles) es intrincada — **requiere validación E2E**. Commit `4b2b65d`.

---

## Estado final de esta corrida y PENDIENTES (con deltas accionables)

**Completados y verificados (typecheck+lint verdes, commiteados):** Ola 1 (T2-01…T2-05), Ola 2A (T2-24, T2-09, T2-08, T2-07), T2-06, T2-10, T2-25(UI), T2-26, T2-16, T2-18(verificado), T2-13, **T2-11** = **19 tickets**.

**T2-11 (tabla de especificaciones) — implementado:** (a) se abre en pestaña nueva desde el hub (no se pierde el contexto); (b) filtros de encabezado por dimensión reutilizando `TagMultiFilter`+`deriveTagFacets`; (c) tab "Resumen" (matriz ↔ resumen) con panorama del instrumento (cantidad de preguntas por dimensión/nodo). El "eje temático estricto" (axis, padre del OA) queda para cuando se exponga el ancestro (backend) — se muestran las dimensiones ya etiquetadas. Commit `3eb626f`.

**Pendientes** — se detienen aquí porque son (a) cambios al **subsistema core de filtros del dashboard** (lo consume todo `/resultados` + `/evaluaciones`; romperlo es transversal) o (b) **features grandes con migraciones de BD** que no se pueden aplicar/validar en este entorno. La decisión recomendada: implementarlos **con E2E en el loop** (build → validar en vivo → iterar), no a ciegas. Deltas exactos del recon (líneas del dev actual):

| Ticket | Qué falta | Archivos / delta |
|---|---|---|
| **T2-11** Tabla de especificaciones | (a) abrir con retorno (hoy `Link` misma pestaña sin volver, `evaluaciones/[id]/layout.tsx` → `SpecTableView.tsx:44-54` breadcrumb fijo al banco); (b) filtros de encabezado (cablear `banco-items/TagMultiFilter.tsx`+`tag-facets.ts` en `SpecTableReview.tsx:74-86`); (c) tab de resumen por dimensión (conteos; el "eje estricto" = padre del OA requiere exponer `parentId`). | UI (+ backend solo si eje-axis estricto) |
| **T2-12** Multi-select transversal | `dashboard-filter-bar.tsx:100-142` + `dashboard-filters.ts:11-28` todos single; schemas `dashboard.schema.ts:23-26` escalares. Cambiar a arrays + `eq`→`inArray` en services de dashboards/heatmap/analytics. **Alto riesgo (core).** | Backend+BDD-queries+UI |
| **T2-14** Jerarquía Asig›instrumento›hab/eje›nivel | `dashboard-filter-bar.tsx:92-94,133-141` colapsa instrumentos a `.type`; falta selector de instrumento concreto (backend ya lo soporta: `dashboard.schema.ts:23`) y de habilidad/eje (nodeId — extender `dashboardFiltersQuerySchema` + services). | UI+Backend |
| **T2-15** Panorama select-first | `resultados/page.tsx:67-144` es overview que mezcla asignaturas; convertirlo en selector guiado que enlace a `evaluaciones/[id]/resultados` (la vista profunda con `SkillsBreakdown` ya existe). Depende de T2-14. | UI (reusa hub) |
| **T2-17** Informes clickeable + comparativa nivel | `report-body.tsx:478-517` (`ItemsSection`/`ItemRow`) estática → hacer clickeable abriendo `QuestionDetailPanel` (Server Action `fetchQuestionAnalysis` ya existe). Backend: agregar referencia "% del nivel/grado" al `QuestionAnalysisResponse` (hoy solo `references.org`). | UI+Backend |
| **T2-27** Filtro momento DIA en /evaluaciones | Agregar `applicationPeriod` a `dashboard-filters` + `DashboardFilterBar` con `hidden: instrumentType!=='dia'`; labels Diagnóstico/**Monitoreo**/Cierre → `diagnostico`/`intermedio`/`cierre`. Backend: `dashboardFiltersQuerySchema` + filtrar por `instrument.applicationPeriod`. Precedente reusable: `InstrumentFilters.tsx:68,113-116`. | UI+Backend |
| **T2-25** Rename ruta `/banco-items`→`/banco-contenido` | Renombrar folder `app/(dashboard)/banco-items/`, `ROUTES.bancoItems*` (`routes.ts:61-68`), `BANCO_TABS`, ~16 consumidores + redirects; limpiar `.next/types`. **Decisión: mantener tabs por subruta** (no `?tab=`) por `07-navigation-reactivity`. Mecánico pero amplio. | UI (mecánico) |
| **T2-19** Estudio de material IA | DTO nuevo (objetivo NL + refs seleccionadas, no solo `nodeId` — `remedial.schema.ts:393-404`); prompt dinámico (hoy plantillas fijas `remedial/prompts/*`); extender enum `remedial_material_type` (`enums.ts:231-235`, **migración**); rename nav/routes/labels; UI canvas (extiende `GeneratePanel`). **Feature grande F2.** | UI+Backend+Prompts+BDD |
| **T2-20** Vista 360 estudiante | Endpoint agregador nuevo `GET /students/:id/panorama` (por evaluación+habilidad/eje/nivel, `withOrgContext`); página perfil; **picker de alumno** (fuente: `class-groups detail`). Reusa `assessment_results`/`skill_results`. | Backend+UI |
| **T2-21** Etiqueta de dificultad por ítem | Columna nueva `items.difficulty` (enum `item_difficulty`, **migración `0015`**); exponer en `create/update ItemSchema` + service; UI mostrar/editar/filtrar. (Etiquetado IA = F2.) | BDD+Backend+UI |
| **T2-22** Listas/colecciones de ítems | Tablas nuevas `item_collections` + `item_collection_items` (**migración**; `org_id`+`withOrgContext`, **SIN RLS** por precedente de `items`/`instruments` que no son RLS al no tener PII — §5.2 aplica a datos sensibles); módulo CRUD; UI multi-select + "guardar en lista" + puente lista→evaluación. | BDD+Backend+UI |
| **T2-23** Eliminar estados de evaluaciones | **Migración** (drop enum `assessment_status` + columna `assessments.status`); backend quitar `status` de `dashboards.service.ts:1528,1595` + inserts (`answer-sheets.service.ts:411`, `official-report-import.service.ts:587`) + seeds; tipos quitar `ASSESSMENT_STATUS`/`AssessmentStatus` (`enums.ts:102-109`) + `DashboardAssessmentSummary.status`. Vestigial en UI (no se pinta). ⚠️ NO confundir con `import_jobs.status` (sí visible, es otro concepto). | BDD+Backend+Tipos |

> **Nota de migraciones:** cualquier ticket con migración debe correr `pnpm db:generate` (próxima = `0015`), commitear el `.sql`, y aplicarse/validarse en el deploy o E2E (no se aplica en este entorno). Deben ir **secuenciales** (conflicto de numeración si dos ramas generan `0015`).
