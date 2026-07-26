# Estado del proyecto — Iteración Feedback v2

> Instantánea del progreso de la ejecución del plan `docs/plan-iteracion-feedback-v2.md`.
> **Rama:** `sprint-feedback-v2` (worktree, desde `dev`) · **PR:** [#85](https://github.com/Martinviald/EdTech/pull/85) → `dev`
> **Decisiones detalladas:** `docs/decisiones-feedback-v2.md` · **Última actualización:** ronda de ejecución autónoma.

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
- [ ] **T2-25 (resto)** rename de ruta `/banco-items` → `/banco-contenido`

### Ola 3 — Filtros y dashboards 🟡 (5/9)
- [x] T2-26 paginación banco de ítems 20/pág (+ fix `pageSize`)
- [x] T2-16 taxonomía agrupada por asignatura
- [x] T2-13 multi-select asignatura/nivel en el banco
- [x] T2-18 (verificado: panel de pregunta ya unificado; sin cambio)
- [x] T2-11 tabla de especificaciones (pestaña nueva + filtros + tab Resumen)
- [ ] **T2-12** multi-selección transversal en filtros *(core, alto riesgo)*
- [ ] **T2-14** jerarquía Asignatura›instrumento›habilidad/eje›nivel
- [ ] **T2-15** panorama pedagógico select-first
- [ ] **T2-17** informes clickeable + comparativa contra el nivel

### Ola 4 — Features grandes ⬜ (0/4)
- [ ] **T2-19** Estudio de material IA (canvas + lenguaje natural + rename) — *migración*
- [ ] **T2-20** vista 360 del estudiante — *endpoint nuevo*
- [ ] **T2-21** etiqueta de dificultad por ítem — *migración*
- [ ] **T2-22** listas/colecciones de ítems — *migración*

### Ola 5 — Limpieza ⬜ (0/1)
- [ ] **T2-23** eliminar estados de evaluaciones — *migración*

### Ola 3 (extra) — ⬜
- [ ] **T2-27** filtro de momento DIA en `/evaluaciones` *(depende del stack de filtros)*

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
