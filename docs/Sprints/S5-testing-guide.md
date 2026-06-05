# Sprint 5 — Guía de testing E2E manual

> Dashboards avanzados + flujo demo. Rama `sprint-5`. Prerrequisito: tener una
> evaluación DIA ya procesada (S3) con resultados (`assessment_results`,
> `skill_results`, `responses`) — usar el flujo de S3 (`/importar-resultados`) si
> hace falta poblar datos.

## Setup

1. `pnpm install` en la raíz.
2. `.env` con `DATABASE_URL` apuntando a la BD con datos de S3.
3. Backend: `pnpm --filter @soe/api dev` (API en `http://localhost:4000/api`, o `API_PORT`).
4. Frontend: `pnpm --filter @soe/web dev` (`http://localhost:3000`).
5. Login SSO (o mock provider) como **directivo** (school_admin/academic_director)
   y, en otra sesión, como **profesor** (teacher) para validar el scoping.

---

## H6.10 — Mapa de calor (habilidad × asignatura)

**Ruta:** `/resultados/mapa-calor` (tab "Mapa de calor" en Resultados).

1. Como directivo, abre la vista. Verifica:
   - [ ] Se renderiza una tabla: filas = habilidades, columnas = asignaturas, más columna "Total".
   - [ ] Cada celda muestra el % de logro coloreado por nivel (rojo→insuficiente,
         ámbar→elemental, esmeralda→adecuado, azul→avanzado).
   - [ ] Las habilidades más críticas (menor % logro) aparecen arriba.
   - [ ] Tooltip/hover muestra el nº de alumnos evaluados (`studentsAssessed`).
   - [ ] Celda sin datos se muestra vacía/neutra (no 0% falso).
2. Aplica filtros (asignatura, curso, período) desde el filter bar:
   - [ ] La matriz se recalcula; filtrar por una asignatura deja una sola columna.
3. Como **profesor**: solo aparecen habilidades/asignaturas de **sus cursos**.
   Profesor sin cursos asignados → estado vacío explicativo.

**Casos de error:** sin datos en el scope → `EmptyState` ("sin datos" vs "profesor sin cursos").

---

## H6.11 — Tabla cruzada alumno × pregunta (drill-down)

**Ruta:** `/resultados/detalle?assessmentId=<id>` (tab "Detalle por pregunta").

1. Sin `assessmentId` en la URL → `EmptyState` pidiendo seleccionar una evaluación.
2. Con un `assessmentId` válido del scope:
   - [ ] Filas = alumnos, columnas = preguntas (P1, P2, …) en orden de posición.
   - [ ] Cada celda indica correcto / incorrecto / sin-respuesta (color) y la
         alternativa elegida (A/B/C/D).
   - [ ] La cabecera de cada pregunta muestra su `correctRate` (% de acierto), con
         las preguntas críticas resaltadas.
   - [ ] Las columnas de la celda coinciden en orden con la cabecera.
   - [ ] Paginación de alumnos funciona (`data`/`total`/`page`/`limit`).
   - [ ] Cada alumno aparece **una sola vez** aunque tenga matrícula en varios años.
3. **Drill-down:** click en la cabecera de una pregunta → abre el panel H6.12.

**Casos de error:**
- `assessmentId` inexistente o de otra org → mensaje de no-encontrado/sin-acceso.
- Profesor sin scope sobre la evaluación → mensaje de acceso denegado.

---

## H6.12 — Distribución de respuestas + distractores

**Componente:** panel lateral (`QuestionDetailPanel`) abierto desde la tabla cruzada.

1. Al abrir una pregunta:
   - [ ] Muestra el enunciado (stem) y, si existe, imagen y explicación.
   - [ ] Lista todas las alternativas con barra de distribución (count + %).
   - [ ] Resalta la alternativa correcta y el distractor más elegido.
   - [ ] Muestra % de acierto (`correctRate`) y nº de respuestas en blanco (`blankCount`).
   - [ ] Muestra la habilidad y el contenido (taxonomy) asociados a la pregunta.
2. Pregunta sin alternativas (no selección múltiple) → maneja el caso sin romper.

**Verificación de datos:** la suma de counts de alternativas + blancos = `totalResponses`.

---

## H6.18 — Export genérico Excel/PDF

**Componente:** botón "Exportar" en el mapa de calor (y reutilizable en otras vistas).

1. En `/resultados/mapa-calor` con datos, click en Exportar → Excel:
   - [ ] Descarga un `.xlsx` con las columnas de la vista (habilidad + asignaturas + total).
2. Export → PDF:
   - [ ] Descarga un `.pdf` con título y un resumen de los filtros aplicados, más la tabla.
3. [ ] El export usa los datos **ya cargados** (no recarga / no depende del backend).
4. [ ] Botón deshabilitado cuando no hay datos.

---

## H19.1 — Validación arquitectónica (revisión, no UI)

- [ ] Revisar `docs/H19.1-validacion-arquitectonica.md`.
- [ ] Confirmar que ninguna lógica de negocio ramifica por `instrument.type === 'dia'`
      ni usa UUIDs de currículo hardcodeados (`grep` documentado en el doc).
- [ ] Confirmar que skill vs contenido se deriva de `taxonomy_nodes.type` (no de
      `item_tag_type`).

---

## Flujo demo F1 completo (criterio de salida)

1. [ ] Admin da de alta colegio + sube nómina (S1).
2. [ ] Encargado sube CSV de respuestas DIA del curso (S3).
3. [ ] Sistema procesa → dashboard de habilidades (S4) + **mapa de calor (H6.10)** +
       **tabla cruzada (H6.11)**.
4. [ ] Director hace click en una pregunta → **distribución de distractores (H6.12)**.
5. [ ] Director compara con el diagnóstico del año anterior (H6.3/H6.6, S4).
6. [ ] Director **exporta el reporte (H6.18)**.

Objetivo: todo el flujo en ~5 minutos.

---

## Gates automáticos (ya verificados en integración)

- `pnpm typecheck` → 7/7 paquetes en verde.
- `pnpm --filter @soe/api test` → tests de `heatmap` (12) e `item-analysis` (10) en verde.
  (Los specs de `privacy` fallan sin Postgres de test — pre-existente, ajeno a S5.)
- Smoke E2E: `GET /api/heatmap`, `/api/item-analysis/matrix`, `/api/item-analysis/questions/:id`
  → 401 sin token (existen + guardados). `/resultados/mapa-calor` y `/resultados/detalle`
  → 307 (redirect a login). Sin errores de compilación.
