# Estado del proyecto — Iteración Feedback v2

> Instantánea del progreso de la ejecución del plan `docs/plan-iteracion-feedback-v2.md`.
> **Rama actual:** `sprint-feedback-v2b` (worktree fuera de Dropbox, desde `dev`) · **Merged:** PR [#85](https://github.com/Martinviald/EdTech/pull/85) (→dev) y PR #84 (dev→main, release `9c38da7`).
> **Decisiones detalladas:** `docs/decisiones-feedback-v2.md` · **Última actualización:** 2026-07-26 (arranca la fase grande, Fase A).

---

## Resumen

- **~17 de 27 tickets** implementados, verificados (`typecheck` + `lint` verdes) y commiteados (19 commits).
- **Ola 1 completa · Ola 2 casi completa · UI de Ola 3 hecha.**
- **Pendiente:** el cluster de filtros del dashboard, las 4 features grandes (con migraciones) y el rename de ruta del banco.
- **Testing E2E manual: pendiente** (planificado para el final). Las migraciones de los tickets pendientes **aún no se generan** (se generan al construirlos; no se pueden aplicar/validar en este entorno).

---

## Definiciones del equipo (2026-07-25)

- **Secuencia:** primero **E2E de estos ~17 tickets** (PR [#85](https://github.com/Martinviald/EdTech/pull/85)); recién después se retoma la fase grande con la app corriendo. La construcción está **en pausa** hasta el go.
- **T2-25 rename de ruta — SÍ:** al retomar, renombrar `/banco-items` → `/banco-contenido` (tabs por subruta: `/banco-contenido` + `/banco-contenido/explorar`) + redirects de compatibilidad.
- **T2-03 idioma:** se **mantiene "español de Chile"** en los prompts (sin cambios). Las fugas de inglés en UI ya se corrigieron.
- **T2-09 Comparar instrumentos — DOS accesos:** (a) botón **"Comparar con otra evaluación"** en el hub de una evaluación, que la preselecciona como base (vía `?baseId`, ya listo en T2-10); **y** (b) un botón/sección **"Comparar instrumentos"** dentro de `/evaluaciones`. Se saca del sidebar cuando existan ambos.

**Aún por confirmar al retomar (defaults ya asumidos):** T2-08 degrade de "Mis cursos" (asumido: al final de "Análisis") · T2-11 ¿eje-axis estricto? (asumido: dimensiones etiquetadas) · T2-22 RLS de colecciones (asumido: `org_id`+`withOrgContext` sin política, por precedente `items`/`instruments`) · T2-19 nombre del "Estudio de material" · T2-23 confirmar que es el `status` de evaluaciones (vestigial).

---

## Actualización (2026-07-26) — merge a main + arranca la fase grande

- **PRs mergeadas:** #85 (→dev) y **#84 (dev→main**, release `9c38da7`, deploy demo corrido). Verificado vía RDS demo (skill `demo-db-access`): **no requería backfill** (read-models poblados, analítica sin cambios en el delta) ni **cambio de taxonomía** (T2-16 es UI-only; `order`/`subjectId` ya poblados).
- **E2E de los ~17: aprobado.** Arranca la fase grande en worktree **`sprint-feedback-v2b`** (fuera de Dropbox).
- **Arranque = Fase A** (sin migraciones, E2E en el loop): T2-25 rename, T2-12 multi-select transversal, T2-14 jerarquía, T2-15 panorama select-first, T2-27 momento DIA, T2-17 informes clickeable + comparativa nivel. Luego **Fase B** (T2-21 `0015`, T2-22 `0016`, T2-20) y **Fase C** (T2-23, sin migración).
- **Decisiones nuevas (confirmadas):**
  - **T2-19 "Crear material" — DIFERIDO a fase futura (F2).** No se construye en esta iteración; "Material Remedial" queda tal cual en el sidebar.
  - **T2-11 eje temático — SÍ estricto:** se agrega backend para exponer el ancestro (padre del OA) y agrupar por eje curricular.
  - **T2-23 REDEFINIDO:** son los estados **Borrador/Publicado/Archivado** de instrumentos (visibles) → **ocultar en UI + traer todos los estados**, **sin migración** (no era el `assessment_status` vestigial).
  - **T2-22 colecciones — sin RLS** (confirmado, precedente `items`/`instruments`).

---

## Avance por ola

### Ola 1 — Quick wins ✅ (5/5)
- [x] T2-01 "Ver enunciado" → "Ver instrumento"
- [x] T2-02 ruta `/resultados/habilidades` → `/dimensiones` (+ redirect)
- [x] T2-03 idioma: fugas de inglés en UI (`Close`→`Cerrar`) — *prompts "de Chile" sin tocar (ver pregunta abierta)*
- [x] T2-04 desactivar calidad de ítem (veredicto IA + pestaña "Calidad")
- [x] T2-05 instrumento de origen en el panel de ítem

### Ola 2 — Tablero, Mis cursos y navegación 🟡 (7/8)
- [x] T2-24 ocultar "Importar" del sidebar
- [x] T2-09 quitar "Análisis IA" del sidebar
- [x] T2-08 degradar "Mis cursos" + secciones colapsables
- [x] T2-07 "Mis cursos" en filas
- [x] T2-06 "Tablero maestro" (rótulo + densidad)
- [x] T2-10 query params en comparar + breadcrumb "Volver" en el hub
- [x] T2-25 (parcial) header en una fila + quitar "Nuevo instrumento"
- [x] **T2-25 (resto)** rename de ruta `/banco-items` → `/banco-contenido` (Fase A, `16f35ee`)

### Ola 3 — Filtros y dashboards 🟢 (Fase A casi completa)
- [x] T2-26 paginación banco de ítems 20/pág (+ fix `pageSize`)
- [x] T2-16 taxonomía agrupada por asignatura
- [x] T2-13 multi-select asignatura/nivel en el banco
- [x] T2-18 (verificado: panel de pregunta ya unificado; sin cambio)
- [x] T2-11 tabla de especificaciones + ✅ residual "eje curricular estricto" (agente, `cf6e4c6`).
- [x] **T2-12** multi-selección transversal en filtros — Fase A `b236933`
- [x] **T2-14** jerarquía Asig›instrumento (selector concreto) — Fase A `1b67814`. ⏸️ **T2-14b** (filtro habilidad/eje por `nodeId`) DIFERIDO: ya está en el schema; la exploración por habilidad/eje la cubre el drill-down (SkillsBreakdown/SkillDrilldownDialog).
- [x] **T2-15** panorama pedagógico select-first — Fase A `48c36c6`
- [x] **T2-17** informes clickeable + comparativa contra el nivel — Fase A (agente, `998b7cc`)

> **✅ FASE A COMPLETA (2026-07-26):** T2-25, T2-12, T2-27, T2-14 (14b `nodeId` diferido), T2-15, T2-17, T2-11 integrados en `sprint-feedback-v2b`, typecheck+lint verdes, tests de API OK (salvo `privacy.*` que exige `DATABASE_URL` — entorno). Falta E2E manual. Sigue **Fase B** (T2-21 `0015` → T2-22 `0016` → T2-20).

### Ola 4 — Features grandes 🟢 (3/3 + 1 diferido)
- [x] **T2-21** etiqueta de dificultad por ítem — Fase B `7bd2b22`+`c99f0c5` (migración `0015`; editar difficulty diferido)
- [x] **T2-22** listas/colecciones de ítems — Fase B (agente, `d76c9fb`, migración `0016`; puente lista→evaluación clona ítems, sin tags/figuras/secciones — diferido)
- [x] **T2-20** vista 360 del estudiante — Fase B (agente, `4f791d1`, endpoint panorama + perfil + picker)
- ⏸️ **T2-19** Crear material IA (canvas) — **DIFERIDO a fase futura (F2)** (decisión 2026-07-26)

### Ola 5 — Limpieza 🟢 (1/1)
- [x] **T2-23** ocultar estados de instrumentos (Borrador/Publicado/Archivado) en UI + traer todos los estados — Fase C `8fb2e93` (sin migración)

### Ola 3 (extra) — 🟢
- [x] **T2-27** filtro de momento DIA en `/evaluaciones` — Fase A `6645dc5`

> **✅ PLAN COMPLETO (2026-07-26):** las 3 fases integradas en `sprint-feedback-v2b` (pusheada). Fase A (7 tickets), Fase B (T2-21/22/20), Fase C (T2-23). **10 tickets construidos + T2-19 diferido a fase futura.** typecheck 6/6 · lint 6/6 · **828 tests de API OK** (sólo `privacy.*` falla por `DATABASE_URL` de entorno). Diferidos documentados: T2-14b (filtro `nodeId`), editar dificultad (T2-21), puente lista→evaluación sin tags/figuras/secciones (T2-22). **Pendiente: E2E manual.**

---

## Por qué se pausó acá

El trabajo restante es cualitativamente distinto al ya hecho: (a) **cambios al subsistema core de filtros** que consume todo `/resultados` + `/evaluaciones` (romperlo es transversal y `typecheck` no lo atrapa — se detectó un bug real de `pageSize` que solo se ve en runtime); (b) **4 features grandes con migraciones de BD** que no se pueden aplicar ni validar en este entorno y deben ir secuenciales (conflicto de numeración). Construirlas a ciegas produce una superficie amplia sin verificar. La recomendación es abordarlas **con la app corriendo y E2E en el loop**.

---

## Preguntas abiertas (a definir para continuar)

### Cómo proceder (bloqueante)
1. **¿Construyo el resto ahora a ciegas** (migraciones generadas sin aplicar, E2E al final) **o E2E-amos estos ~17 primero** y seguimos la fase grande con la app corriendo? *(Recomendado: lo segundo.)*

### Decisiones tomadas que conviene CONFIRMAR
2. **T2-03 idioma:** mantuve los prompts en **"español de Chile"** (hay un test que lo asegura y es lo correcto para F1). ¿Se cambia a "latinoamericano" neutro? (duda #5 del plan)
3. **T2-25 tabs:** elegí **subrutas** (`/banco-contenido` + `/banco-contenido/explorar`) en vez de `?tab=` literal (por streaming/loading por tab). ¿OK?
4. **T2-08:** moví "Mis cursos" al final del grupo "Análisis" (no a "Administración", porque ese grupo es solo admins). ¿OK?
5. **T2-11 "eje temático":** el resumen cuenta por dimensiones ya etiquetadas (habilidad/OA/tipo-texto). El "eje estricto" (axis = padre del OA) requiere exponer el ancestro (backend). ¿Se necesita el eje estricto?
6. **T2-22 colecciones:** iré con `org_id` + `withOrgContext` **sin política RLS** (precedente de `items`/`instruments`, que no son RLS por no tener PII). ¿OK, o RLS explícito?

### Decisiones nuevas que faltan definir
7. **T2-25 rename de ruta:** ¿se hace el rename `/banco-items` → `/banco-contenido` (mecánico, ~16 consumidores + redirects) o se deja (el label ya dice "Banco de contenido")?
8. **T2-09 Comparar instrumentos:** ¿dónde vive? (acción "Comparar con otra evaluación" desde el hub preseleccionando la base / dentro de "Evaluaciones" / dejarlo en el sidebar) (duda #2)
9. **T2-19 Estudio de material:** ¿nombre definitivo? ("Estudio de material", "Generador de material", otro) — el alcance ya se definió: canvas global + accesible desde una evaluación.
10. **T2-23 estados:** confirmar que se refiere al `status` de **evaluaciones** (vestigial, no se pinta), NO al estado de los **jobs de importación** (sí visible, es otro concepto).
