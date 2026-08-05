# Roadmap de Producto — Documento Vivo de Pendientes

> **Qué es esto:** backlog priorizado de las próximas grandes apuestas de producto. Cada ítem se
> desarrolla primero al nivel de **MVP funcional** y luego se pule. No es un contrato cerrado: es un
> documento vivo, se reordena y se marca a medida que avanza.
>
> **Cómo mantenerlo:** al tomar un ítem, cambia su estado (`🔲 Pendiente` → `🚧 En curso` →
> `✅ Hecho`). Cuando un ítem genere su propio plan detallado (tipo `docs/f2-sprintN-contracts.md`),
> enlázalo desde aquí. Convierte fechas relativas a absolutas.
>
> **Fecha de creación:** 2026-08-04 · **Fase actual del proyecto:** F1/F2 (ver `CLAUDE.md`).

---

## Norte de producto: de banco de datos a copiloto proactivo

> **La tesis que ordena todo este roadmap.** Hoy la plataforma es *pull*: la persona entra, filtra y
> aprieta "Generar"; el dato y hasta el análisis existen, pero **esperan a que alguien los vaya a
> buscar**. El norte es moverla a *push*: un motor de IA que **observa, piensa y sale a buscar a la
> persona** — analiza resultados, aterriza ítems e instrumentos, compara contra líneas base
> comparables (año anterior, periodo anterior, meta curricular, otros colegios), **levanta alertas,
> sugiere acciones y materiales, y hace seguimiento** para mejorar el aprendizaje, sin que nadie tenga
> que preguntarle.

Ese salto no es un feature suelto: son **cinco capas**. Varias piezas ya existen como capacidad
(#2, #2B, #3, #4, #8); lo **net-new** es la **espina** que las vuelve siempre-activas (ítem #3B):

1. **Disparo por eventos, no por clic.** Cuando *entran datos* (termina un `import_jobs`, se confirma
   un informe oficial, se calculan resultados, se cierra un periodo) el análisis se dispara solo.
   Reutiliza el patrón `JOB_DISPATCHER` + runners existente, pero colgado del **evento de datos**, no
   del botón del usuario.
2. **Cerebro que analiza y compara contra baselines comparables.** El análisis multi-paso (#3) y la
   comparación (#4) corren solos, **siempre** contra una línea base comparable (mismo instrumento año
   anterior, periodo comparable anterior, meta curricular, otros colegios vía benchmarking k-anónimo).
   Respeta el [principio rector](#principio-rector-comparar-peras-con-peras) — peras con peras, también
   cuando la comparación la inicia la máquina.
3. **Bandeja persistente de insights, alertas y acciones (fuente de verdad).** Hoy `ai_analyses` es
   efímero y cacheado por `inputHash`. Falta un almacén org-scoped con **ciclo de vida** (nueva →
   vista → en acción → resuelta/descartada), prioridad, dedup y evidencia enlazada. Sin esto,
   "proactivo" no tiene dónde vivir.
4. **Entrega proactiva.** Los hallazgos salen a la persona: feed/inbox in-app, banners del dashboard
   (#2), alertas de alumno (#2B), **digest por correo/notificación** (semanal o al cerrar periodo), y
   el **asistente que abre la conversación** con "encontré esto" en vez de esperar la pregunta.
5. **Cierre del bucle: no solo avisar, mejorar.** Cada alerta trae **acción concreta + material
   remedial** (#8) y el sistema **re-mide en el próximo periodo comparable** para saber si sirvió.
   Todo bajo "IA propone, humano aprueba" (`CLAUDE.md §8.3`) y con **alta precisión** para evitar
   fatiga de alertas.

**Regla de diseño transversal:** cada nueva capacidad se construye pensando en cómo **empuja** valor
al usuario (alerta/acción/insight que emerge solo), no solo en cómo lo **muestra** cuando lo van a
buscar. Si un feature solo se ve entrando a una vista, está a medio construir.

---

## Principio rector: comparar peras con peras

> **No se agrega ni promedia analítica sobre instrumentos que no son comparables.** Un "% de logro
> promedio de 10 evaluaciones" de instrumentos distintos **no aporta valor**: una prueba puede ser
> mucho más difícil que otra, o de distinta naturaleza, y el promedio mezcla cosas que no deben
> mezclarse. La unidad mínima comparable es un **mismo instrumento** (o un mismo instrumento estándar
> aplicado en condiciones comparables — p. ej. mismo DIA, mismo nivel, mismo momento).
>
> Toda métrica del producto —**sobre todo en el Panorama Pedagógico**— debe estar **acotada a una
> unidad comparable**: por evaluación/instrumento, por nivel, por asignatura, por momento. Nunca un
> agregado transversal que sume instrumentos heterogéneos. Este principio rige el ítem #1C (qué quitar)
> y condiciona el rediseño del dashboard (#2).

## Cómo leer las prioridades

- **P0 — Desbloqueadores / base.** Se hacen primero porque otros ítems dependen de ellos o porque
  quitan deuda que contamina el resto.
- **P1 — Alto valor de producto.** El corazón de esta tanda: lo que mueve la aguja comercial (PLG) y
  la experiencia analítica.
- **P2 — Potenciadores.** Alto valor pero construyen sobre P0/P1; se abordan cuando la base está lista.

| # | Ítem | Prioridad | Estado | Depende de |
|---|------|-----------|--------|-----------|
| 1 | Quitar evaluación de **calidad de instrumento / discriminación de ítems** | **P0** | 🔲 Pendiente | — |
| 1C | Quitar **agregación de analítica sobre instrumentos no comparables** (% logro global, clasificación global de niveles) | **P0** | 🔲 Pendiente | — |
| 2 | Dashboard **Panorama Pedagógico** inteligente (banners/CTAs, % logro ×nivel ×asignatura ×evaluación) | **P1** | 🔲 Pendiente | #1, #1C |
| 2B | **Vista 360 del estudiante** más rica (por asignatura, movimiento por periodos comparables) + alertas proactivas — [diseño](./diseno-vista-360-estudiante.md) | **P1** | 🚧 Diseño | #1C, #3 |
| 3 | **Análisis IA de resultados** multi-paso + **proactivo** (alertas/acciones, sin calidad de instrumento) | **P1** | 🔲 Pendiente | #1 |
| 3B | **Motor proactivo (espina):** disparo por eventos + bandeja de insights/alertas/acciones + entrega push + seguimiento | **P1** | 🔲 Pendiente | #3 |
| 4 | **Comparación entre años/instrumentos** fácil + explicada por IA potente | **P1** | 🔲 Pendiente | #1, #3 |
| 5 | **Extracción de informe oficial desde PDF** (multimodal) para onboarding auto | **P1** | 🔲 Pendiente | — |
| 6 | **Asistente IA** con más herramientas: analizar cuerpo del instrumento + contrastar instrumentos/resultados | **P2** | 🔲 Pendiente | #1, #3 |
| 7 | **Preguntar al agente desde cualquier componente** del front (contexto del dato seleccionado) | **P2** | 🔲 Pendiente | #6 |
| 8 | **Módulo de material remedial tipo canvas** (crear/editar) asistido por IA | **P2** | 🔲 Pendiente | — |

---

## P0 — Desbloqueadores

### 1. Eliminar toda evaluación de calidad del instrumento y discriminación de ítems

**Estado:** 🔲 Pendiente · **Prioridad:** P0 · **Diseño detallado:**
[`docs/diseno-limpieza-calidad-instrumento.md`](./diseno-limpieza-calidad-instrumento.md)
(levantamiento de 53 archivos, línea de corte, 7 decisiones y plan de ejecución)

**Por qué primero:** los instrumentos que procesamos son estándar y validados (DIA, SIMCE, PAES,
Cambridge). Evaluar su calidad psicométrica (KR-20, discriminación, punto-biserial, banderas de ítem
"defectuoso") no aporta valor y **contamina** el análisis IA (#3), la comparación (#4) y el asistente
(#6), que hoy razonan sobre "el ítem es defectuoso". Limpiar esto es precondición del resto.

**Estado actual (a eliminar / recortar):**
- Backend módulo completo: `apps/api/src/instrument-quality/` (service, controller, module) — calcula
  KR-20, punto-biserial, D, p, banderas (`low_discrimination`, `ambiguous_key`, `strong_distractor`,
  `too_easy`).
- Métricas psicométricas: `apps/api/src/ai-analysis/ai-analysis.metrics.ts` (`kr20()`, `pointBiserial()`).
- Cálculo de D/p en `apps/api/src/assessment-report/assessment-report.service.ts` (flags
  `low_discrimination`, `strong_distractor`).
- Frontend: página `apps/web/src/app/(dashboard)/evaluaciones/[assessmentId]/calidad/`,
  `analisis-ia/components/quality-panel.tsx`, `quality-format.ts`, columnas de discriminación en
  `resultados/informe/items-analysis-table.tsx` y `report-export-button.tsx`, pestaña "Calidad" en el
  hub de evaluación, ruta `evaluacionCalidad` en `lib/routes.ts`.
- Tipos: `packages/types/src/schemas/instrument-quality.schema.ts`; capability `'psychometrics'` en
  `packages/types/src/analytics-capabilities.ts`; campos psicométricos en `ai-analysis.schema.ts`
  (`itemInsightQualityVerdictSchema`, `reliability`, `difficulty/discrimination/pointBiserial`).
- Prompts IA: reglas `"item_quality"` / veredicto `solid|review|flawed` en
  `assessment-insights.prompt.ts` e `item-insight.prompt.ts`.
- Schema DB: `items.irtParams` (JSONB) — evaluar si se retira o se deja inerte.

**Alcance MVP:**
- Eliminar módulo `instrument-quality/` (backend + frontend + tipos + ruta + pestaña).
- Reescribir prompts IA para **quitar** la dimensión "calidad del ítem": el análisis de un ítem con
  bajo logro se explica **solo** por causas de aprendizaje (`not_taught`, `misconception`,
  `insufficient_practice`), nunca por "el ítem es malo".
- Recortar de informes/exports las columnas de discriminación (D) y confiabilidad (KR-20).

**Mantener (NO tocar):** análisis **académico** de respuestas — `item-analysis` (matriz alumno×pregunta,
distribución de alternativas, distractores desde la óptica de *error de aprendizaje del alumno*), % de
logro, `assessment_item_stats`/`assessment_skill_stats`, `item-stats-calculator.ts`.

**Ojo (decisión a tomar):** la distribución de alternativas de un ítem sigue siendo válida como señal
**pedagógica** ("qué error cometieron los alumnos"), distinta de "el distractor está mal diseñado".
Conservar la primera lectura, quitar la segunda.

**Pulido posterior:** revisar textos de UI que hablen de "calidad" y reencuadrar hacia "análisis de
aprendizaje".

---

### 1C. Eliminar agregación de analítica sobre instrumentos no comparables

**Estado:** 🔲 Pendiente · **Prioridad:** P0

**Por qué:** aplica el [principio rector](#principio-rector-comparar-peras-con-peras). Hoy el producto
promedia métricas a través de instrumentos heterogéneos (distinta dificultad, distinta naturaleza), lo
que produce números que **no aportan valor** y hasta engañan. Hay que quitar todo agregado transversal
que mezcle instrumentos no comparables, **sobre todo en el Panorama Pedagógico**.

**Qué eliminar / reencuadrar (a acotar por unidad comparable):**
- **% de logro global** que promedia varias evaluaciones/instrumentos:
  - `dashboards.service.ts` → campo `globalAchievement` de `GET /api/dashboards/overview` y su
    `StatCard` "% Logro global" en `resultados/page.tsx`. Un promedio sobre instrumentos mixtos es
    justo lo que no debe existir.
- **Clasificación global de niveles de alumnos** sobre instrumentos mezclados:
  - Distribución por nivel (Insuficiente/Elemental/Adecuado/Avanzado) y tabla de clasificación cuando
    el scope abarca **más de un instrumento no comparable**: `DistributionBar` en `resultados/page.tsx`,
    `resultados/clasificacion/page.tsx` y `GET /api/dashboards/performance`.
- Cualquier KPI/tarjeta/tabla del panorama que sume evaluaciones de instrumentos distintos en un solo
  número (revisar `overview`, `performance`, `teacher-kpis`).

**Regla de reemplazo (no solo borrar):**
- Estas métricas **sí pueden mostrarse acotadas a una unidad comparable**: por **evaluación/instrumento**
  específico, o por un mismo instrumento estándar en condiciones comparables (mismo DIA, mismo nivel,
  mismo momento). Ej.: "% de logro de *esta* evaluación", "distribución de niveles de *este* instrumento".
- El corte válido es exactamente el que pide el ítem #2: **% de logro × nivel × asignatura ×
  evaluación/instrumento**. Ese es el reemplazo del promedio global.
- Cuando el scope actual mezcla instrumentos, en vez de un promedio mostrar un **desglose por
  instrumento** (o pedir al usuario que elija uno) — nunca un número único agregado.

**Ojo (decisión a tomar):**
- Definir con precisión qué cuenta como "comparable". Propuesta: mismo `instrumentId`, o mismo
  instrumento estándar (mismo tipo + nivel + momento/aplicación). Documentar la regla y aplicarla
  consistentemente en backend (agregaciones) y frontend (qué se puede sumar).
- Distinguir del ítem #1: **#1** quita la evaluación de *calidad psicométrica del instrumento*; **#1C**
  quita los *agregados de resultados sobre instrumentos no comparables*. Son limpiezas distintas y
  complementarias.

**Dónde vive:** backend `apps/api/src/dashboards/` (overview, performance, teacher-kpis) y frontend
`apps/web/src/app/(dashboard)/resultados/` (page.tsx, clasificacion). Coordinar de cerca con #2.

---

## P1 — Alto valor de producto

### 2. Dashboard "Panorama Pedagógico" inteligente

**Estado:** 🔲 Pendiente · **Prioridad:** P1 · **Depende de:** #1, #1C

**Objetivo:** que el panorama sea mucho más inteligente, intuitivo y valioso. No debe **concluir** en
el resumen, sino **llamar la atención** con métricas de alto nivel y hacer **CTA** para entrar al
detalle. El usuario debe ver rápidamente: **% de logro × nivel × asignatura × evaluación/instrumento**,
% de logro de niveles en pruebas, % de logro de generaciones por asignatura, resultados de evaluaciones.

> **Restricción dura (ver #1C y el [principio rector](#principio-rector-comparar-peras-con-peras)):**
> el panorama **no** muestra promedios globales que mezclen instrumentos no comparables. Nada de
> "% de logro global de N evaluaciones" ni clasificación de niveles agregada sobre instrumentos
> heterogéneos. Toda métrica se acota a una unidad comparable (evaluación/instrumento, nivel,
> asignatura, momento). El corte estrella —**% de logro × nivel × asignatura × evaluación/instrumento**—
> es justamente el reemplazo comparable del viejo promedio global.

**Estado actual:**
- Página: `apps/web/src/app/(dashboard)/resultados/page.tsx` — 4 KPIs (StatCard), `DistributionBar`,
  `AlertsSection`, `RecentAssessments`, KPIs docentes.
- Alertas dinámicas ya existen en backend: `dashboards.service.ts` genera `low_achievement` (curso
  <60%) y `critical_skill` (habilidad <50%) con severidad — pero se muestran como lista pasiva en una
  card, sin CTA fuerte ni banner/modal.
- Endpoints: `GET /api/dashboards/overview | filters | performance | skills | skills/breakdown |
  teacher-kpis`; mapa de calor en `GET /api/heatmap` (habilidad × asignatura).
- Filtros ricos ya existen (`dashboard-filters.ts`): asignatura, nivel, curso, tipo de instrumento,
  momento DIA, instrumento, año.

**Alcance MVP:**
- **Banners/modals dinámicos** en la parte superior del panorama, alimentados por las alertas del
  backend (y por hitos: "nueva evaluación cargada", "brecha crítica detectada"). Cada uno con CTA
  directo al detalle correspondiente (curso, habilidad, evaluación).
- **Vista rápida % de logro × nivel × asignatura × evaluación/instrumento**: una matriz/tabla resumen
  navegable que hoy no existe de forma directa (el `overview` da global; el heatmap es habilidad ×
  asignatura). Definir el corte exacto y el endpoint de agregación (¿extender `dashboards/overview` o
  nuevo `dashboards/matrix`?).
- Tarjetas resumen que son **CTA**: al hacer click abren el drill (dimensiones, clasificación,
  mapa de calor, comparación).

**Pulido posterior:** jerarquía visual de los banners por severidad, animaciones/entrada, priorización
(qué banner se muestra primero), dismissal persistente, responsive.

**Notas de arquitectura:** respetar `frontend/07-navigation-reactivity.md` (shell inmediato + Suspense
por sección) y `frontend/05-performance.md` (agregación O(N) con Map, no re-scan por celda como en
`HeatmapService.assembleResponse()`).

---

### 2B. Vista 360 del estudiante más rica y proactiva

**Estado:** 🚧 En curso (diseño) · **Prioridad:** P1 · **Depende de:** #1C, #3 · **Diseño detallado:**
[`docs/diseno-vista-360-estudiante.md`](./diseno-vista-360-estudiante.md) (modelo de zoom progresivo
Z0→Z4, filtros y pre-filtros de alerta, 8 defectos verificables de la vista actual)

**Objetivo:** hacer la **visión 360 del estudiante** mucho más rica y útil. Hoy los filtros son malos,
se muestra poca información poco útil, y el gráfico de progresión grafica sobre pruebas **no
comparables** (mismo problema del [principio rector](#principio-rector-comparar-peras-con-peras)). La
vista debe mostrar: **cómo está el alumno en cada asignatura**, **cómo se ha movido a lo largo de los
periodos dentro de esa asignatura** (sobre instrumentos comparables), y debe **levantar alertas
proactivas** — no esperar a que el usuario entre a la ficha del alumno para enterarse de que hay que
tomar acción.

**Estado actual (a mejorar):**
- Página: `apps/web/src/app/(dashboard)/estudiantes/[studentId]/page.tsx` — KPIs (nº evaluaciones,
  logro promedio, habilidades), distribución por nivel, tabla por evaluación, tabla por habilidad.
  **Sin filtros explícitos** en la UI.
- Backend: `GET /api/students/:id/panorama` (`students/student-panorama.service.ts`) — `byAssessment`,
  `bySkill`, `byLevel`. Ordena por fecha, **no agrupa por asignatura ni por periodo comparable**.
- **Gráfico de progresión defectuoso:** `panorama-trajectory.tsx` → `progression-chart.tsx` y
  `GET /api/analytics/progression?scope=student` (`analytics.service.ts`): una **sola línea** de % de
  logro ordenada por fecha que **mezcla instrumentos distintos** — exactamente lo que #1C prohíbe.
  Comparar el % de un instrumento fácil con uno difícil en la misma línea no dice nada.
- **Sin alertas proactivas de alumno:** hoy hay que entrar a la ficha para ver el estado; no existe
  ninguna señal "este alumno necesita atención" en listas, dashboard o notificaciones.

**Alcance MVP:**
- **Por asignatura:** reorganizar la vista para que el eje principal sea la **asignatura** — cómo está
  el alumno en cada una (logro, nivel, brechas de habilidad), no una lista plana de evaluaciones.
- **Movimiento por periodos comparables:** reemplazar la progresión que mezcla instrumentos por una
  trayectoria **dentro de una asignatura sobre instrumentos comparables** (p. ej. DIA de la misma
  asignatura: diagnóstico → monitoreo → cierre). Nada de una línea única que salte entre instrumentos
  heterogéneos. Requiere que el backend agrupe por asignatura + secuencia de aplicaciones comparables
  (coordinar con la definición de "comparable" de #1C).
- **Filtros útiles:** por asignatura, por periodo/momento, por habilidad. Que el usuario pueda acotar
  a lo que le importa.
- **Alertas proactivas de alumno:** el alumno con caída sostenida, nivel insuficiente persistente o
  retroceso entre periodos comparables debe **emerger solo** — en el dashboard (#2), en la lista de
  alumnos del curso, y/o vía el motor de alertas/acciones de #3. La ficha 360 pasa a ser el
  **drill-down** de una alerta, no el único lugar donde se descubre el problema.

**Pulido posterior:** comparación del alumno vs su curso/nivel, línea de tiempo por habilidad,
sugerencias de material remedial (enlazar a #8), export de la ficha.

**Notas de arquitectura:** mismo cuidado de O(N) que #2 (agrupar por asignatura/periodo con Map en una
sola pasada). Las alertas de alumno deben salir del **mismo motor proactivo de #3**, no ser un sistema
de alertas paralelo.

---

### 3. Análisis IA de resultados: multi-paso y proactivo

**Estado:** 🔲 Pendiente · **Prioridad:** P1 · **Depende de:** #1

**Objetivo:** (a) que el análisis IA no sea **un solo prompt**, sino un **flujo por partes** que
produzca información más rica; (b) **quitar** el análisis de calidad del instrumento y centrarse solo
en el **análisis académico** de respuestas de alumnos + preguntas del instrumento; (c) que la
plataforma sea **proactiva**: que con el análisis IA se muestren **alertas y acciones** al usuario, en
vez de que tenga que filtrar e ir a buscar los resultados para actuar.

**Estado actual:**
- Módulo `apps/api/src/ai-analysis/` — hoy es **un prompt monolítico**: `assessment-insights.prompt.ts`
  (`s1-insights-v1`) devuelve headline + resúmenes + topItems/bottomItems + skillGaps + recommendations
  **+ reliability/calidad psicométrica** (a quitar por #1).
- Disparo **reactivo**: `POST /ai-analysis/assessments/:id/generate` → job async in-process
  (`JOB_DISPATCHER`), cacheado por `inputHash`. El usuario debe ir a `analisis-ia/page.tsx` y pulsar
  "Generar". **No hay** alertas/acciones proactivas.
- Frontend: `evaluaciones/[assessmentId]/analisis-ia/page.tsx` con polling (`use-remedial-status` /
  poller pattern).

**Alcance MVP:**
- **Descomponer el prompt** en un flujo por partes (p. ej.: 1) panorama general de logro → 2) brechas
  por habilidad → 3) análisis de ítems de bajo logro con causa de aprendizaje → 4) recomendaciones y
  acciones). Cada paso con su prompt versionado; ensamblar el resultado. Considerar orquestación tipo
  pipeline (ver patrón `remedial.runner.ts`).
- **Quitar** de input/output toda métrica de calidad del instrumento (coordinar con #1).
- **Proactividad:** que al completarse un análisis se generen **alertas accionables** que aparezcan en
  el panorama (#2) y/o notificaciones, con **acciones sugeridas** (ej: "generar material remedial para
  habilidad X" enlazando al módulo remedial). Definir dónde se persisten estas acciones (¿tabla nueva
  `ai_actions`/`ai_alerts`? ¿reusar el modelo de alertas del dashboard?).

**Pulido posterior:** afinar cada prompt del flujo, tono por audiencia (director vs profesor),
confidence/caveats, deduplicación de acciones, priorización de alertas.

**Referencias de patrón:** `docs/propuesta-motor-remedial-generativo.md` y `remedial.runner.ts` (flujo
async por pasos con caché por `inputHash` y quality-loop) son el molde más cercano.

---

### 3B. Motor proactivo (la espina que vuelve todo *push*)

**Estado:** 🔲 Pendiente · **Prioridad:** P1 · **Depende de:** #3

**Objetivo:** materializar el [Norte de producto](#norte-de-producto-de-banco-de-datos-a-copiloto-proactivo).
Es el eslabón que convierte capacidades on-demand (#2, #2B, #3, #4, #8) en un sistema **siempre-activo**
que empuja valor sin que nadie pregunte. **Net-new**: hoy no existe ninguna de sus cinco capas como
espina.

**Alcance (5 capas — cada una puede ser su propio sprint):**

1. **Disparo por eventos.** Suscribir el análisis a los eventos de datos ya existentes: completar
   `import_jobs`, confirmar `official-report-import`, calcular resultados, cierre de periodo. En F1
   reutilizar `JOB_DISPATCHER` in-process; en F3+ migra a BullMQ/Redis (`CLAUDE.md §12`). Regla: el
   pipeline arranca del **evento**, no del botón "Generar".
2. **Resolver de baselines comparables.** Servicio que, dado un resultado, resuelve contra qué
   comparar respetando #1C: mismo instrumento año anterior, periodo comparable anterior (mismo DIA:
   diagnóstico→monitoreo→cierre), meta curricular, benchmarking k-anónimo (`benchmarking.service.ts`).
   Punto único donde vive la definición de "comparable".
3. **Bandeja de insights/alertas/acciones (fuente de verdad).** Nueva(s) tabla(s) org-scoped (RLS) con:
   `type`, `severity`, `context` (asignatura/nivel/curso/alumno/habilidad/evaluación), `evidence`
   (enlace a `ai_analyses` + snapshot), `baselineRef`, **ciclo de vida** (`new → seen → in_progress →
   resolved | dismissed`), `priority`, y clave de **dedup** (no re-alertar lo mismo cada corrida).
   Reemplaza las alertas efímeras del dashboard (`dashboards.service.ts`) y unifica las de alumno (#2B).
4. **Entrega push.** Superficies de salida sobre esa bandeja: feed/inbox in-app, banners del dashboard
   (#2), alertas de alumno (#2B), **digest por correo** (semanal / al cerrar periodo — existe MCP de
   correo) y **apertura proactiva del asistente** ("encontré esto"). Una sola fuente, muchos canales.
5. **Bucle de seguimiento.** Cada acción/alerta enlaza material remedial (#8) y queda "en seguimiento";
   al llegar el próximo resultado comparable, el motor **re-evalúa** si la brecha mejoró y cierra o
   escala la alerta. Aquí es donde "proactivo" se vuelve "mejora el aprendizaje", no solo "avisa".

**Gobernanza (no negociable):** IA propone, humano aprueba (`§8.3`). Nada se aplica solo. **Precisión
sobre recall**: mejor pocas alertas certeras que muchas ruidosas (fatiga de alertas mata la confianza).
Toda alerta trazable a su evidencia.

**Decisiones a tomar:**
- Modelo de datos de la bandeja (¿una tabla `signals` polimórfica por `type`, o `alerts` + `actions`
  separadas?) y su relación con `ai_analyses`.
- Estrategia de dedup/priorización (evitar re-alertar; qué sube primero).
- Cadencia de digest y canal (in-app vs correo vs ambos) por rol.

**Pulido posterior:** aprendizaje de qué alertas el usuario ignora/actúa para afinar precisión;
personalización por rol (director ve gestión, profesor ve aula); throttling inteligente.

---

### 4. Comparación entre años/instrumentos: fácil y explicada por IA

**Estado:** 🔲 Pendiente · **Prioridad:** P1 · **Depende de:** #1, #3

**Objetivo:** hacer **fácil y rápido** comparar resultados de evaluaciones/instrumentos de **mismos
niveles en distintos años**, y que el análisis pase por un **modelo potente de IA** que contraste los
**instrumentos** (no solo los números) para explicar los resultados — porque comparar resultados sobre
instrumentos distintos, que no necesariamente son comparables, no es concluyente por sí solo.

**Estado actual:**
- Comparación **generacional** (`resultados/comparacion/page.tsx`): mismo grado a través de años,
  pero **determinística, sin IA** (% logro, % aprobación, tendencia, distribución por banda).
- Comparación de **instrumentos con IA** ya existe pero pequeña: `comparar-instrumentos/page.tsx` +
  `ai-analysis/instrument-comparison.{controller,runner}.ts` + `instrument-comparison.prompt.ts`
  (compara dos instrumentos, hoy razona sobre dificultad/discriminación → **ajustar por #1**).

**Alcance MVP:**
- **UX de comparación fácil**: desde una evaluación/instrumento, ofrecer "comparar con año anterior /
  con otro instrumento del mismo nivel" en pocos clics (selección guiada por nivel + asignatura + año).
- **Análisis IA de contraste**: que el modelo lea el **cuerpo/contenido de ambos instrumentos** (no
  solo métricas) y explique las diferencias de resultado atribuyéndolas a diferencias del **instrumento**
  (cobertura de habilidades, tipo de ítems, exigencia del enunciado) vs diferencias de **aprendizaje**
  del grupo. Reescribir `instrument-comparison.prompt.ts` sin marco psicométrico (#1).
- Dejar claro al usuario qué comparaciones son "manzanas con manzanas" y cuáles requieren cautela.

**Pulido posterior:** visualizaciones lado a lado, resaltar ítems equivalentes/divergentes entre
instrumentos, exportación del contraste.

---

### 5. Extracción de informe oficial desde PDF (onboarding automático)

**Estado:** 🔲 Pendiente · **Prioridad:** P1 · **Depende de:** —

**Objetivo:** poder **extraer datos de un informe oficial con solo cargarlo** a la plataforma
(PDF → datos estructurados), para **automatizar el onboarding** y ofrecer el producto a un colegio con
solo enviar un link/subir el informe.

**Estado actual:**
- El importador existe pero **asume JSON ya extraído**: `apps/api/src/official-report-import/`
  (upload → preview → confirm, 5 gates de integridad, matching de alumnos, escribe
  `assessment_item_stats`/`skill_stats`/`results`, modo `paper`/`aggregate_only`).
- Frontend: `apps/web/src/app/(dashboard)/importar-dia/page.tsx`.
- **NO existe** la extracción multimodal PDF→JSON. El JSON hoy se produce manualmente/externamente
  (ver fixture `informe-3a-cierre-2025.ts`). Existe skill `extraer-pruebas-pdf` pero es para PDFs de
  **pruebas** (ítems), no de **informes de resultados**.
- Gemini multimodal ya está configurado en `apps/api/src/llm/` (hoy usado para imágenes de ítems).

**Alcance MVP:**
- Servicio de **extracción PDF → `OfficialReportImportFile` (JSON)** con Gemini multimodal, que
  alimente el flujo `official-report-import` existente (upload del **PDF** en vez del JSON).
- Mantener los **5 gates** y el **matching de alumnos con aprobación humana** (`CLAUDE.md §8.3`: la IA
  propone, el humano confirma) — la extracción no debe persistir a ciegas.
- Enganchar al **onboarding**: flujo "sube tu informe oficial y ve tu dashboard" como punta de lanza PLG.

**Pulido posterior:** soportar más formatos de informe (distintos colegios/años/instrumentos),
detección de tipo de informe, corrección asistida de campos mal leídos, ingesta por link/email.

**Ojo:** la negrita del PDF (clave correcta) no siempre está en la capa de texto — ya documentado en
`official-report-import/lib/report-to-item-stats.ts`; la extracción multimodal debe manejar esto o
tomar la clave del instrumento.

---

## P2 — Potenciadores

### 6. Asistente IA con más herramientas analíticas

**Estado:** 🔲 Pendiente · **Prioridad:** P2 · **Depende de:** #1, #3

**Objetivo:** dar más herramientas al asistente para analizar instrumentos **no solo con los
resultados, sino con el cuerpo y contenido del instrumento**; que pueda **comparar instrumentos y
resultados** y tener un **foco analítico de resultados más potente**.

**Estado actual:**
- `apps/api/src/assistant/` con 13 tools (`assistant.constants.ts`, `tools/`). Ya puede leer contenido:
  `get_instrument` (metadata + stem truncado) y `get_item_content` (enunciado + alternativas + clave
  completos). Ya tiene `get_assessment_report`, dashboards, heatmap, progression, generational,
  `get_student_detail` (pseudónimo), `propose_item_edit`.
- **Falta:** herramienta de **comparación de instrumentos** dentro del chat, lectura del **cuerpo
  completo** del instrumento de una sola vez (hoy es ítem por ítem), y contraste instrumento↔resultados
  como una capacidad de primera clase.

**Alcance MVP:**
- Nueva(s) tool(s): comparar dos instrumentos (reusar #4), leer el instrumento completo de forma
  eficiente, cruzar resultados con contenido para explicar brechas.
- Alinear el system prompt con #1 (sin marco de calidad del instrumento).

**Pulido posterior:** memoria de contexto entre turnos, sugerencias proactivas dentro del chat.

---

### 7. Preguntar al agente desde cualquier componente del front

**Estado:** 🔲 Pendiente · **Prioridad:** P2 · **Depende de:** #6

**Objetivo:** poder preguntarle al agente **desde cualquier componente** del front, y que el agente
obtenga la **info de ese componente** (el dato/la métrica seleccionada) y responda sobre ella.

**Estado actual:**
- El asistente vive en `components/assistant/` (widget/panel/chat) con `context-picker.tsx` y
  `context-tray.tsx` — ya hay una noción de "contexto" que se puede adjuntar a la conversación.
- No hay un mecanismo genérico "pregúntale a la IA sobre **este** componente/dato" embebido en cada
  vista.

**Alcance MVP:**
- Patrón reutilizable "Ask AI" a nivel de componente (ej: botón/acción en cards de KPI, filas de tabla,
  celdas del heatmap) que inyecte el **contexto estructurado** de ese componente al `context-tray` y
  abra el asistente con la pregunta encuadrada.
- Definir un contrato de "contexto de componente" (qué datos/IDs viaja) que el asistente sepa resolver
  con sus tools (#6), respetando RLS (IDs, no PII).

**Pulido posterior:** UX del "adjuntar contexto", preguntas sugeridas por tipo de componente.

---

### 8. Módulo de material remedial tipo canvas

**Estado:** 🔲 Pendiente · **Prioridad:** P2 · **Depende de:** —

**Objetivo:** módulo de **creación y edición de material remedial tipo canvas** (lienzo de material),
con el asistente IA ayudando a **generar y editar** el remedial basándose en instrumentos, ítems y
resultados de evaluaciones.

**Estado actual:**
- Módulo remedial **ya implementado**: `apps/api/src/remedial/` (generación async por tipo `guide` /
  `practice_set` / `group_plan`, quality-loop, estímulo/pasaje, caché por `inputHash`, review
  aprobar/descartar, `editedContent` ≠ `content`). DB: `packages/db/src/schema/remedial.ts`.
- Frontend: `apps/web/src/app/(dashboard)/material-remedial/` con editores por tipo
  (`guide-editor`, `practice-editor`, `plan-editor`) y vistas de lectura.
- **Falta:** experiencia **tipo canvas** (edición libre/estructurada en un lienzo) y asistencia IA
  **iterativa** dentro del editor (no solo generar de una vez, sino co-editar).

**Alcance MVP:**
- Editor tipo canvas sobre el material remedial existente, con acciones de IA embebidas ("mejora esta
  sección", "agrega práctica sobre habilidad X", "adapta a nivel Y") que operan sobre `editedContent`
  sin pisar la evidencia IA original (`content`).
- Reusar el asistente/tools (#6) como motor de edición.

**Pulido posterior:** colaboración, versiones, plantillas de material, export a formatos de aula.

**Referencias:** `docs/propuesta-motor-remedial-generativo.md`, `docs/remedial-estimulo-ola2-diseno.md`.

---

## Dependencias en una vista

```
BASE (P0):          #1 (quita calidad instrumento)   #1C (quita agregados no comparables)
                          │                                  │
CAPACIDADES (P1):         ├─► #3 (análisis IA multi-paso) ───┤
                          │                                  ├─► #4  (comparación con IA)
                          │                                  ├─► #2  (dashboard inteligente)
                          │                                  └─► #2B (vista 360 del estudiante)
                          │
ESPINA (P1):              └─► #3B (MOTOR PROACTIVO) ── orquesta #3/#4 · empuja a #2/#2B · engancha #8
                                                          (eventos + bandeja + push + seguimiento)
POTENCIADORES (P2): #6 (asistente + tools) ─► #7 (ask-AI por componente)    #8 (remedial canvas)
INDEPENDIENTE:      #5 (extracción PDF informe) ── onboarding PLG
```

**Orden sugerido de ejecución:** (#1, #1C en paralelo) → (#2, #3, #5 en paralelo) → (#2B, #4, #3B) →
#6 → (#7, #8). El **#3B** es transversal: su *bandeja* (capa 3) puede arrancar junto con #3, pero su
*entrega push* (capa 4) necesita las superficies #2/#2B y su *seguimiento* (capa 5) necesita #4 y #8.
