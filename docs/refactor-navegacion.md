# Plan de Diseño — Refactor de Navegación y Arquitectura de Información

> **Rama:** `refactor/navegacion-ia` · **Worktree:** `~/Desktop/nav-refactor` (basado en `dev`)
> **Objetivo:** reorganizar la distribución de vistas/módulos y los flujos de navegación para que la
> experiencia sea más intuitiva, fluida y centrada en el objeto de negocio (la evaluación), sin romper
> el contrato técnico del proyecto (ver `.claude/CLAUDE.md`).
> **No-objetivo:** agregar features de F2+ (benchmarking real, ML, etc.). Esto es puramente IA de navegación
> + reubicación + cierre de loops. Nada de schema nuevo, nada de nuevos dominios.

---

## 1. Principios de diseño

1. **La evaluación es el objeto central.** Todo lo demás son vistas de ese objeto o herramientas para crearlo.
   El `assessmentId` que identifica una evaluación debe vivir en la **ruta** (`/evaluaciones/[id]/...`), no
   arrastrarse por query params entre rutas hermanas. Identidad → path; refinamiento de vista (curso, asignatura,
   filtros) → query string.
2. **Jerarquía por frecuencia de uso.** Lo diario arriba y visible; lo de configuración agrupado; lo administrativo
   colapsado. El sidebar deja de ser una lista plana.
3. **Sin callejones sin salida.** Toda vista de detalle ofrece la siguiente acción natural. Ninguna pantalla obliga
   a volver al sidebar para continuar un flujo.
4. **Reutilizar, no reescribir.** Las vistas profundas (informe, análisis IA, material remedial, mapa de calor)
   ya existen. El refactor las **re-parienta** y mueve el selector de evaluación un nivel arriba; no reimplementa
   su lógica de datos.
5. **Respetar el contrato existente:** App Router (Server Components por defecto), autorización por unión de roles
   con `canAccess()` y las constantes de `packages/types/src/access-policies.ts`, RLS vía `withOrgContext` en el
   backend, Tailwind + shadcn, sin Zustand para lo que es estado de URL.

---

## 2. Estado actual (resumen del diagnóstico)

- **Sidebar plano de 16 ítems** (`apps/web/src/components/layout/nav-items.ts`) sin agrupación; mezcla uso diario,
  configuración y administración.
- **No existe el objeto "evaluación" navegable.** `/evaluaciones` está marcado `soon` y la ruta no existe. Las
  evaluaciones solo se alcanzan como un dropdown (`AssessmentSelect`) dentro de `/resultados`. El `assessmentId`
  se arrastra por query params entre `/resultados`, `/analisis-ia`, `/material-remedial` y el usuario lo
  re-selecciona en cada sección. El commit `c38a434` es un parche a este síntoma.
- **Home (`/dashboard/page.tsx`) es un stub:** solo un saludo, sin CTAs ni "próxima acción".
- **Importación dispersa en 3–4 puntos:** `/importar` (nómina, ni siquiera está en el sidebar), `/importar-dia`
  (pauta/instrumento, mal nombrada: hardcodea "DIA" y suena a resultados), `/importar-resultados` (hojas de
  respuesta). Sin modelo de pasos ni prerequisitos visibles.
- **Loops abiertos:** `my-classes/[id]` no enlaza a resultados del curso; el import job termina en `/resultados`
  genérico; `banco-items/[id]` no enlaza a sus evaluaciones.
- **Observabilidad IA** (panel administrativo) vive entre los ítems de consumo diario.

Mapa de roles relevante (de `packages/types/src/access-policies.ts`):

| Constante | Incluye (resumen) |
|---|---|
| `RESULTS_VIEWER_ROLES` = `DASHBOARD_VIEWER_ROLES` = `ANALYTICS_VIEWER_ROLES` = `HEATMAP_*` = `ITEM_ANALYSIS_*` = `INSTRUMENT_QUALITY_*` | admins + directivos + coordinator + eval_coordinator + **teacher** + homeroom_teacher (profesor: solo sus cursos) |
| `AI_ANALYSIS_VIEWER_ROLES` / `REMEDIAL_VIEWER_ROLES` | admins + academic_director + eval_coordinator + **teacher** |
| `AI_ANALYSIS_GENERATOR_ROLES` / `REMEDIAL_GENERATOR_ROLES` | igual pero **sin** teacher (genera) / remedial sí incluye teacher |
| `BENCHMARKING_VIEWER_ROLES` | admins + foundation_director + academic_director + cycle_director + eval_coordinator (**sin** teacher) |
| `ITEM_BANK_ROLES` | admins + academic_director + eval_coordinator (edita) |
| `ITEM_VIEWER_ROLES` | + cycle_director, dept_head, coordinator, teacher, homeroom_teacher (lee) |
| `IMPORT_ROLES` / `ANSWER_SHEET_IMPORT_ROLES` | admins + academic_director + eval_coordinator |
| `TAXONOMY_ROLES` / `GRADING_SCALE_ROLES` / `ASSIGNMENTS_ROLES` | admins + academic_director |
| `STAFF_MANAGEMENT_ROLES` | platform_admin + school_admin |
| `AI_OBSERVABILITY_VIEWER_ROLES` / `LLM_SETTINGS_ROLES` | admins + academic_director |

---

## 3. Arquitectura objetivo

### 3.1 Modelo mental

```
                        ┌──────────────────────────────┐
   crear / cargar  ───► │        EVALUACIÓN  [id]       │ ◄─── consumir / analizar
   (Importar, Banco,    │  (hub con pestañas)           │
    Marcos)             │  Resumen · Resultados ·       │
                        │  Análisis IA · Material ·     │
                        │  Calidad del instrumento      │
                        └──────────────────────────────┘
```

### 3.2 Mapa de rutas objetivo (App Router, grupo `(dashboard)`)

```
/dashboard                         Home launchpad por rol (Fase 1)
/dashboard/my-classes              Mis cursos  (+ link a resultados del curso — Fase 0)
/dashboard/my-classes/[id]         Detalle de curso (+ "Ver resultados", "Análisis IA")

/evaluaciones                      LISTA de evaluaciones (filtrable) — antes el dropdown    (Fase 2)
/evaluaciones/[assessmentId]       layout con tabs + carga de meta + contexto del asistente (Fase 2)
  ├─ /                             Resumen de la evaluación (KPIs + accesos a cada pestaña)
  ├─ /resultados                   Informe (default) — reusa report-body
  │    ├─ ?view=clasificacion|habilidades|mapa-calor|detalle|comparacion|progresion
  │    └─ (sub-nav interna; filtros curso/asignatura como query)
  ├─ /analisis-ia                  Análisis IA de esta evaluación (reusa analysis-report)
  ├─ /material-remedial            Material de esta evaluación (reusa lista + GeneratePanel)
  └─ /calidad                      Calidad psicométrica del instrumento (reusa instrument-quality)

/resultados        ▸ landing-selector → enruta a /evaluaciones/[id]/resultados   (Fase 2: se simplifica)
/analisis-ia       ▸ landing-selector → enruta a /evaluaciones/[id]/analisis-ia
/material-remedial ▸ banco global + landing-selector (mantiene su banco paginado)

/importar                          HUB de importación: 3 pasos (nómina · pauta · resultados)  (Fase 3)
  ├─ /alumnos                      (mueve el actual /importar = StudentImportFlow)
  ├─ /instrumento                  (mueve el actual /importar-dia = DiaImportWizard)
  └─ /resultados                   (mueve el actual /importar-resultados + cargar/preview/jobs)

/banco-items, /marcos-academicos                         (sin cambio de ruta; agrupados en sidebar)
/organizacion (+asignaciones, +configurar)               (sin cambio; agrupados)
/equipo, /configuracion (+escalas, +modelos-ia, +ia)     (Observabilidad se mueve aquí — Fase 0)
```

> **Decisión de identidad vs filtro:** `assessmentId` → path (`[assessmentId]`). `classGroupId`, `subjectId`,
> `gradeId`, etc. → query string (refinan la vista dentro del hub). Esto preserva el `DashboardFilterBar`
> existente sin cambios: solo cambia el `basePath` que recibe.

### 3.3 Sidebar reagrupado

```
▸ ANÁLISIS                     ▸ CONTENIDO Y DATOS          ▸ ADMINISTRACIÓN  (colapsable)
   Inicio                         Importar       (hub)         Mi Colegio
   Mis cursos        (staff)      Banco de Instrumentos        Equipo
   Evaluaciones      (nuevo)      Marcos Académicos            Configuración
   Resultados                                                    └ escalas, modelos IA,
   Análisis IA                                                      Observabilidad IA
   Material Remedial
   Benchmarking      (directivos)
```

Filtrado por rol idéntico al actual (unión de roles). Grupos vacíos para un rol se ocultan completos (un profesor
no ve "Administración"). "Evaluaciones" reemplaza conceptualmente el dropdown enterrado.

---

## 4. Fases de implementación

Cada fase es **commiteable y desplegable de forma independiente**. Orden recomendado: 0 → 1 → 3 → 2 (el hub es lo
más grande; las fases 0/1/3 entregan valor visible antes y reducen el riesgo de la 2).

---

### FASE 0 — Quick wins (bajo riesgo, alto impacto visible)

**0.1 Agrupar el sidebar**

- **Archivo:** `apps/web/src/components/layout/nav-items.ts`
- Introducir estructura de grupos sin romper `visibleNavItems` (mantenerla por compatibilidad):
  ```ts
  export type NavGroup = { id: string; label: string; items: readonly NavItem[] };
  export const NAV_GROUPS: readonly NavGroup[] = [
    { id: 'analisis',       label: 'Análisis',           items: [/* Inicio, Mis cursos, Evaluaciones, Resultados, Análisis IA, Material Remedial, Benchmarking */] },
    { id: 'contenido',      label: 'Contenido y datos',  items: [/* Importar, Banco de Instrumentos, Marcos Académicos */] },
    { id: 'administracion', label: 'Administración',     items: [/* Mi Colegio, Equipo, Configuración */] },
  ];
  export function visibleNavGroups(roles: readonly UserRole[]): NavGroup[] {
    return NAV_GROUPS
      .map((g) => ({ ...g, items: g.items.filter((i) => i.roles.some((r) => roles.includes(r))) }))
      .filter((g) => g.items.length > 0);
  }
  ```
  `NAV_ITEMS` puede quedar como `NAV_GROUPS.flatMap(g => g.items)` para no romper imports existentes.
- **Archivo:** `apps/web/src/components/layout/SidebarNav.tsx` — renderizar encabezados de grupo (label en
  `text-xs uppercase text-muted-foreground`, con separación). Mantener el resaltado de activo por `pathname`.
- **Criterio de aceptación:** un `teacher` ve solo el grupo "Análisis" (+ Banco como lectura); un `school_admin`
  ve los 3 grupos con encabezados; el orden dentro de cada grupo respeta la tabla 3.3.

**0.2 Mover Observabilidad IA a Configuración y renombrar import de pauta**

- Quitar `/observabilidad-ia` del nivel superior del sidebar; exponerlo como card dentro de `/configuracion`
  (junto a Escalas y Modelos de IA), gateado por `AI_OBSERVABILITY_VIEWER_ROLES`. La ruta `/observabilidad-ia`
  **se mantiene** (solo cambia su punto de entrada en el menú).
- Renombrar el label del ítem `/importar-dia` de **"Importar DIA"** a **"Pauta / Instrumento"** (deshardcodea
  "DIA" conforme §8.2 del CLAUDE.md). La ruta no cambia en Fase 0 (se moverá en Fase 3).

**0.3 Cerrar loops contextuales mínimos**

- `apps/web/src/app/(dashboard)/dashboard/my-classes/[classGroupId]/page.tsx`: agregar botones
  "Ver resultados del curso" → `/resultados?classGroupId=<id>` y, si `AI_ANALYSIS_VIEWER_ROLES`,
  "Análisis IA" → `/analisis-ia?classGroupId=<id>`. (En Fase 2 estos apuntarán al hub.)
- `apps/web/src/app/(dashboard)/importar-resultados/jobs/[jobId]/page.tsx`: cuando el job complete y exista
  `assessmentId`, el CTA principal pasa de `/resultados` genérico a la evaluación concreta
  (`/resultados?assessmentId=<id>` en Fase 0; `/evaluaciones/<id>` en Fase 2), y añadir CTA secundario
  "Generar análisis IA".
- `apps/web/src/app/(dashboard)/banco-items/[instrumentId]/page.tsx`: si hay evaluaciones que usan el instrumento,
  link "Ver evaluaciones" → `/evaluaciones?instrumentId=<id>` (queda activo cuando exista la lista en Fase 2; en
  Fase 0 puede apuntar a `/resultados`).

**0.4 Switcher Mi Colegio ↔ Plataforma (platform_admin con org)**

- **Archivo:** topbar (`apps/web/src/components/layout/` — el componente de UserNav/Topbar). Agregar un control
  visible solo si `session.user.isPlatformAdmin && orgId`, que alterne entre `/dashboard` y `/admin`. Hoy esa
  transición solo ocurre por redirect en los guards de layout; hacerla explícita.

**Riesgos Fase 0:** mínimos. Cambios de presentación + links. Validar `pnpm typecheck` y `pnpm lint`.

---

### FASE 1 — Home como launchpad por rol

- **Archivo:** `apps/web/src/app/(dashboard)/dashboard/page.tsx` (hoy stub).
- Server Component que ramifica por `activeRole` / unión de roles:
  - **Profesor (`teacher`/`homeroom_teacher`):** cards "Mis cursos" (reusar datos de my-classes) +
    "Últimas evaluaciones de mis cursos" (→ hub/resultados) + acceso a Material remedial.
  - **Directivo / eval_coordinator:** banda de KPIs de la org (nº evaluaciones, alumnos, último import),
    tabla "Evaluaciones recientes" clickeable (→ hub), import jobs en curso, accesos directos a Importar y
    Análisis IA.
  - **Onboarding checklist** (cuando el setup está incompleto): "1. Configurar año académico · 2. Importar nómina ·
    3. Cargar pauta/instrumento · 4. Importar resultados". Cada paso enlaza a su destino y marca completitud según
    datos reales (reusar señales que ya consume `/organizacion` y `/importar`).
- **Datos:** reusar endpoints existentes (`/item-analysis/assessments` para evaluaciones recientes,
  `/dashboards/filters`, señales de organización). No crear endpoints nuevos salvo un agregador opcional de KPIs;
  si se necesita, vivir en un módulo backend existente (p. ej. `dashboards`) respetando RLS.
- **Componentes nuevos:** `apps/web/src/app/(dashboard)/dashboard/components/` →
  `teacher-home.tsx`, `staff-home.tsx`, `onboarding-checklist.tsx`, `recent-assessments-card.tsx`.
- **Criterio de aceptación:** ningún rol aterriza en una página vacía; cada rol tiene al menos una "próxima acción"
  clara y un acceso de 1 clic a su flujo principal.

---

### FASE 2 — Hub de evaluación (cambio estructural; paga la deuda de fondo)

**2.1 Lista `/evaluaciones`**

- **Archivos nuevos:** `apps/web/src/app/(dashboard)/evaluaciones/page.tsx` + `components/`.
- Reusa `apiGet<AssessmentListResponse>('/item-analysis/assessments' + filterQuery)` (el mismo endpoint que hoy
  alimenta el dropdown) y el `DashboardFilterBar` para filtrar por curso/asignatura/grado/año/tipo.
- Render: tabla/cards de evaluaciones; cada fila → `/evaluaciones/[assessmentId]`. Estado vacío → CTA a Importar.
- `roles: RESULTS_VIEWER_ROLES`. Activar el ítem de sidebar (quitar `status: 'soon'` de `/evaluaciones`).

**2.2 Layout del hub `/evaluaciones/[assessmentId]/layout.tsx`**

- Server Component que:
  - Carga la meta de la evaluación una sola vez (nombre, instrumento, asignatura, grado, fecha, nº alumnos) vía
    `/analytics/assessment-report` o un endpoint ligero de meta; si la evaluación no existe / sin acceso →
    `notFound()`.
  - Renderiza un **`AssessmentTabsNav`** (cliente) que conserva la query string (curso/filtros) al cambiar de
    pestaña — mismo patrón que el actual `ResultadosNav` (`apps/web/.../resultados/components/resultados-nav.tsx`).
  - Monta `RegisterAssistantContext` con `{ kind: 'assessment', id, label }` (+ classGroupId si está en query)
    una sola vez para todas las pestañas (hoy se repite en cada página).
- Pestañas (cada una gateada por su rol; si el usuario no la puede ver, no se muestra):
  `Resumen · Resultados · Análisis IA · Material remedial · Calidad`.

**2.3 Páginas-pestaña (re-parentado, no reimplementación)**

Cada pestaña es una página delgada que lee `assessmentId` de `params` (no de `searchParams`) y **reutiliza los
componentes de presentación que ya existen**:

| Nueva ruta | Reusa de hoy |
|---|---|
| `[id]/page.tsx` (Resumen) | KPIs de `assessment-report` (`report.summary`/`report.meta`) + accesos a pestañas |
| `[id]/resultados/page.tsx` | `resultados/informe/report-body.tsx` (`ReportBody`) + sub-nav de las 8 vistas (informe/clasificación/habilidades/mapa-calor/detalle/comparación/progresión) movidas como `?view=` o subrutas |
| `[id]/analisis-ia/page.tsx` | `analisis-ia/components/{analysis-report,analysis-poller,generate-button}` + actions; preserva la lógica de "cargar el último análisis" (`/ai-analysis/assessments/:id/latest?audience=...`) ya presente en `analisis-ia/page.tsx` |
| `[id]/material-remedial/page.tsx` | `material-remedial/components/{material-card,generate-panel,...}` (lista filtrada por `assessmentId`, que el backend ya soporta) |
| `[id]/calidad/page.tsx` | `/instrument-quality?assessmentId=...` + su tarjeta de presentación |

> El `AssessmentSelect` deja de vivir dentro de cada vista; el selector se vuelve la **lista `/evaluaciones`**.
> Dentro del hub no hay selector de evaluación (ya estás dentro de una).

**2.4 Convertir los top-level en landings-selector**

- `/resultados`, `/analisis-ia`: pasan a ser páginas de aterrizaje con `DashboardFilterBar` + `AssessmentSelect`
  cuyo `basePath` enruta al hub (`onChange` → `/evaluaciones/[id]/resultados` o `/analisis-ia`). Esto **reemplaza
  el parche `c38a434`**: en vez de arrastrar `assessmentId` entre hermanas, el selector entra al hub.
- `/material-remedial`: mantiene su **banco global paginado** (es legítimamente cross-evaluación) + el launchpad
  que ya agregamos; las tarjetas de material siguen yendo a `/material-remedial/[id]` (detalle del material, que
  no depende del hub).
- **Migración del commit `c38a434`:** los puentes que agregó (pestaña "Análisis IA" en `ResultadosNav`, botones
  contextuales) se **redirigen al hub**:
  - La pestaña "Análisis IA" del `ResultadosNav` se integra como pestaña nativa del hub (`AssessmentTabsNav`) →
    se elimina del `ResultadosNav` top-level.
  - El botón "Análisis IA" del informe y el botón "Material remedial" del análisis quedan **subsumidos** por las
    pestañas del hub (ya estás en la misma evaluación, cambias de pestaña). Se eliminan los botones redundantes;
    se conserva el filtro por `assessmentId` del banco remedial (sigue siendo útil).

**2.5 Compatibilidad de URLs**

- Mantener `/resultados?assessmentId=...`, `/analisis-ia?assessmentId=...` funcionando como **redirects** a la
  ruta del hub equivalente (links externos, marcadores, el asistente E21 que arma URLs). Implementar con
  `redirect()` en el Server Component cuando llega `assessmentId` por query.

**Criterios de aceptación Fase 2:**
- Entrar a una evaluación y moverse entre Resultados / Análisis IA / Material / Calidad **sin volver a elegir la
  evaluación** y conservando el filtro de curso.
- URL del tipo `/evaluaciones/<uuid>/analisis-ia?classGroupId=<uuid>` es compartible y carga el estado completo.
- `/resultados?assessmentId=<uuid>` redirige a `/evaluaciones/<uuid>/resultados`.
- Profesor sin permiso de una pestaña no la ve y no puede forzarla por URL (guard por rol en la página-pestaña).

**Riesgos Fase 2:**
- Superficie amplia de rutas → hacer la migración pestaña por pestaña, manteniendo las top-level operativas hasta
  que el hub esté completo (feature parity antes de borrar).
- El asistente E21 construye URLs (`list_assessments` → assessmentId). Verificar/actualizar el constructor de URLs
  para apuntar al hub (o confiar en los redirects de 2.5).
- Sub-nav de las 8 vistas de resultados: decidir `?view=` (menos archivos, un page que ramifica) vs subrutas
  (más archivos, pero cada vista cacheable). **Recomendación:** subrutas `[id]/resultados/<vista>/page.tsx`
  delgadas para conservar el code-splitting actual.

---

### FASE 3 — Importación unificada

- **Hub `/importar/page.tsx`:** tres cards de pasos con prerequisitos y estado:
  1. **Nómina de alumnos** → mover `app/(dashboard)/importar/` actual a `app/(dashboard)/importar/alumnos/`.
  2. **Pauta / Instrumento** → mover `importar-dia/` a `importar/instrumento/`.
  3. **Resultados (hojas)** → mover `importar-resultados/` (con `cargar`, `preview`, `jobs/[jobId]`) a
     `importar/resultados/`.
- El hub muestra el orden lógico y señala prerequisitos ("necesitas la pauta cargada antes de importar
  resultados"). Reusa los flujos existentes intactos; solo cambian rutas y se añade el contenedor.
- **Sidebar:** los 3 ítems de importación colapsan en un único "Importar" (dentro del grupo "Contenido y datos").
- **Redirects de compatibilidad:** `/importar-dia` → `/importar/instrumento`, `/importar-resultados` →
  `/importar/resultados` (links y marcadores existentes).
- **Cierre de loop:** al terminar el job (ya tocado en Fase 0), enlazar al hub de la evaluación creada.

**Criterio de aceptación:** desde la Home, un directivo nuevo completa nómina → pauta → resultados → ve la
evaluación, siguiendo CTAs sin perderse ni adivinar el orden.

---

## 5. Migración del parche `c38a434`

El commit `c38a434` (puentes contextuales por query param) fue un paso intermedio correcto. Su destino:

| Elemento de `c38a434` | En el diseño final |
|---|---|
| Selector propio en `/analisis-ia` sin assessmentId | Se convierte en landing-selector que enruta al hub (Fase 2.4) |
| Pestaña "Análisis IA" en `ResultadosNav` | Pasa a ser pestaña nativa del hub (`AssessmentTabsNav`); se quita del nav top-level |
| Botón "Análisis IA" en Informe / "Material remedial" en Análisis | Subsumidos por las pestañas del hub; se eliminan |
| Filtro `assessmentId` del banco remedial + banner + launchpad | **Se conserva** (banco es cross-evaluación) |

No se revierte nada en Fase 0/1; la limpieza ocurre como parte de Fase 2.4.

---

## 6. Consideraciones transversales

- **Autorización:** cada página-pestaña del hub valida su rol con `canAccess(session.user.roles, <POLICY>)` y
  `redirect('/dashboard')` o no-render de la pestaña. Nunca confiar solo en ocultar el tab.
- **RLS / backend:** no se tocan queries de datos sensibles; si Fase 1 agrega un agregador de KPIs, debe correr
  dentro de `withOrgContext` (§5.2 CLAUDE.md). No se introduce schema nuevo.
- **Responsive (H19.2):** el sidebar agrupado y el `AssessmentTabsNav` deben colapsar en móvil (tabs scrollables /
  menú). Mobile-first desde el inicio.
- **i18n / nombres:** labels en español; deshardcodear "DIA" en el menú; usar tokens de diseño, sin colores
  hardcodeados.
- **Tests:** seguir §10.2 — añadir/ajustar tests de los componentes de navegación críticos (sidebar agrupado,
  tabs del hub, home por rol) con React Testing Library. Validar redirects con tests de página.
- **Calidad:** `pnpm typecheck && pnpm lint && pnpm format` verde antes de cada commit. `typedRoutes` está activo:
  los hrefs dinámicos en variables requieren `as Route`.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper links existentes (asistente E21, marcadores) | Redirects de compatibilidad (2.5, Fase 3); migrar el constructor de URLs del asistente |
| Regresión en autorización al mover páginas | Mantener el guard de rol en cada nueva página-pestaña; tests de acceso por rol |
| Alcance grande de Fase 2 | Migrar pestaña por pestaña con feature parity; no borrar top-level hasta completar |
| Worktree pnpm sin `node_modules` | `pnpm install` en `~/Desktop/nav-refactor` antes de correr typecheck/dev |
| Confusión durante la transición (hub + top-level coexistiendo) | Documentar y limpiar en 2.4; los top-level se vuelven landings, no duplican vistas |

---

## 8. Orden de ejecución y commits

1. `chore: setup worktree + plan de diseño` (este documento).
2. **Fase 0** — un commit por sub-paso o uno agrupado: `feat(nav): agrupar sidebar en secciones`,
   `feat(nav): mover observabilidad a configuración y renombrar import de pauta`,
   `feat(nav): cerrar loops my-classes/import-job/banco`, `feat(nav): switcher colegio/plataforma`.
3. **Fase 1** — `feat(home): launchpad por rol con evaluaciones recientes y onboarding`.
4. **Fase 3** — `refactor(import): unificar importación en hub de 3 pasos` (+ redirects).
5. **Fase 2** — serie de commits: `feat(evaluaciones): lista`, `feat(evaluaciones): layout y tabs del hub`,
   `feat(evaluaciones): pestañas resultados/analisis/material/calidad`,
   `refactor(nav): top-level como landings-selector + redirects`, `chore: limpiar puentes de c38a434`.

Cada fase: `typecheck` + `lint` verdes y, donde aplique, tests.

---

## 9. Fuera de alcance

- Implementar features `soon` reales (`/alumnos` como gestión org-wide; `/evaluaciones` como creación manual de
  evaluaciones fuera de import).
- Cambios de schema, nuevos dominios backend (salvo un agregador de KPIs opcional, sin datos nuevos).
- Rediseño visual del design system (solo reagrupación/estructura, no re-skin).
- Benchmarking / ML / generación de contenido (F2+).

---

## 10. Checklist de arranque del worktree

- [ ] `cd ~/Desktop/nav-refactor && pnpm install`
- [ ] `pnpm typecheck` y `pnpm lint` verdes en baseline (antes de tocar nada)
- [ ] Levantar `apps/web` para baseline visual del sidebar/home actuales
- [ ] Comenzar por Fase 0.1 (sidebar agrupado)
