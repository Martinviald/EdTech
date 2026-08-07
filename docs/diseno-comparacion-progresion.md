# Diagnóstico — Vistas de Comparación y Progresión del Panorama Pedagógico

> **Qué es esto:** diagnóstico en profundidad de las dos vistas de comparación temporal del
> Panorama Pedagógico —`/resultados/comparacion` (comparación generacional) y `/resultados/progresion`
> (progresión en el tiempo)— para identificar por qué **mezclan métricas no comparables** y cómo
> alinearlas con el marco de comparabilidad ya construido.
>
> **Es la continuación natural de** [`docs/diseno-panorama-comparable.md`](./diseno-panorama-comparable.md)
> (ítems #1C + #2), que resolvió este mismo problema para las tabs **Resumen**, **Dimensiones** y
> **Mapa de calor**, construyó el núcleo de comparabilidad (`packages/types/src/comparability.ts`,
> niveles N0–N3) — y **dejó estas dos vistas fuera a propósito** (Deuda #5: _"progression (D6) sigue
> mezclando instrumentos… el fix de la vista vive en #2B"_; y D7: `generational` se endureció sólo en
> el backend). Este documento retoma justo eso.
>
> **Fecha:** 2026-08-06 · **Estado:** 🔍 diagnóstico cerrado · ✍️ **diseño en curso** (decisiones A–E
> resueltas §5.1; sin código todavía). Roadmap relacionado: **#2B** (vista 360 / trayectoria comparable
> del alumno) y **#4** (comparación de instrumentos con IA) en
> [`docs/roadmap-producto.md`](./roadmap-producto.md).

---

## 1. El principio rector, y qué falta cumplirlo

El principio rector del producto (`roadmap-producto.md` §"comparar peras con peras"): **ningún número
mezcla instrumentos no comparables** — ni en un KPI, ni en una distribución, ni en un gráfico. Un
"% de logro" que promedia 5 evaluaciones distintas no mide nada: una prueba puede ser mucho más
difícil que otra, y cada instrumento trae su propio corte de niveles (`performance_bands`), así que
promediar mezcla **dificultades Y escalas**.

`comparability.ts` ya define operativamente qué es comparable, en 4 niveles:

| Nivel                      | Clave                                                          | Qué contiene                                   | ¿Promediable en UN número?          |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------- |
| **N0 — Aplicación**        | `assessmentId`                                                 | Una evaluación concreta                        | ✅ Sí                               |
| **N1 — Instrumento**       | `instrumentId`                                                 | El mismo instrumento en varios cursos          | ✅ Sí                               |
| **N2 — Familia estándar**  | `(type, subjectId, gradeId, applicationPeriod)` — varía `year` | El "mismo DIA" de años distintos               | ❌ No. Se compara **punto a punto** |
| **N3 — Serie de momentos** | `(type, subjectId, gradeId, year)` — varía `applicationPeriod` | Diagnóstico → Monitoreo → Cierre del mismo año | ❌ No. Trayectoria, no promedio     |

Todo lo que no cae en N0–N3 es **mixto**: no se agrega ni se compara, se desglosa o se pide elegir
una unidad. La regla de emisión: **agregar** un número sólo en N0/N1; **comparar** (dos números +
delta en puntos porcentuales) en N2/N3; **clasificar** (banda de alumno/curso) sólo con las bandas
del instrumento de esa unidad.

**El hallazgo central de este diagnóstico:** las dos vistas cuyo propósito _entero_ es la comparación
temporal son, paradójicamente, las que menos respetan este marco. Ambas siguen produciendo la línea o
la barra que mezcla peras con manzanas.

---

## 2. Diagnóstico — Comparación generacional (`/resultados/comparacion`)

**Backend:** `AnalyticsService.generational()` (`apps/api/src/analytics/analytics.service.ts:53-105`).
**Frontend:** `apps/web/src/app/(dashboard)/resultados/comparacion/page.tsx`.

### 2.1 Cómo funciona hoy

- El query exige `gradeId` y acepta como **opcionales** `subjectId`, `instrumentType`,
  `applicationPeriod`, `instrumentId`, `nodeId` (`comparacion/page.tsx:55-71`).
- El backend computa un `ComparabilityMeta` (`analytics.service.ts:173-220`) **y lo devuelve** — el
  endurecimiento D7 de #1C llegó hasta acá.
- La serie (`generationalSeriesFromResults`, `:222-295`) agrupa **sólo por `academicYears.year`** y
  calcula `avg(assessment_results.percentage)` + `passingRate` + distribución por nivel.
- La UI dibuja: 3 tarjetas `MetricComparison` (con delta vs año anterior), `GenerationalChart`
  (barra `averageAchievement` + línea `passingRate`), `GenerationalDistributionChart` (barras
  apiladas por nivel) y una tabla resumen (`comparacion/page.tsx:209-303`).

### 2.2 Fallas

| #      | Falla                                                                                                                                                                                                                                                           | Dónde                                                          | Por qué está mal                                                                                                                                                                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | **La UI dibuja el promedio aunque el alcance sea `mixed`.** Las `MetricComparison` (`% Logro promedio · año`) y ambos gráficos se renderizan **incondicionalmente**; el `ComparabilityNotice` (`:211`) sólo agrega un banner _encima_ del número, no lo suprime | `comparacion/page.tsx:209-274`                                 | Es el mismo defecto que #1C corrigió en Resumen/Dimensiones (donde `aggregatable === false` ⇒ el número se emite como `null`), pero esta vista **nunca recibió ese tratamiento en la UI**. El usuario ve "% logro 2024 = 63%" que es la media de DIA Lenguaje + DIA Matemática + prueba interna.                                      |
| **C2** | **El promedio por año es en sí mismo una mezcla dentro del año.** La serie agrupa sólo por `year` y hace `avg(percentage)` sobre TODAS las evaluaciones que matchean un filtro que puede ser laxo (sólo `gradeId` obligatorio)                                  | `analytics.service.ts:242-271`                                 | Es el defecto **D1** de #1C reaparecido a grano nivel: sin fijar instrumento/asignatura/momento, cada barra anual promedia instrumentos de distinta dificultad. El backend **no suprime** este número cuando el scope es mixto (a diferencia de `getPerformance`/`getSkills`, que sí ponen `pct = null`).                             |
| **C3** | **La distribución por nivel usa el enum legacy `performanceLevel`, sumado entre instrumentos**                                                                                                                                                                  | `analytics.service.ts:301-335`                                 | Defecto **D2**: agrupa por `assessment_results.performanceLevel` (enum deprecated de 4 niveles), no por las bandas del instrumento. La barra apilada suma etiquetas de cortes distintos → mezcla **escalas**.                                                                                                                         |
| **C4** | **Los filtros son multi-select pero la vista sólo consume el PRIMERO** de cada uno (`gradeId[0]`, `subjectId[0]`, `instrumentType[0]`, `applicationPeriod[0]`)                                                                                                  | `comparacion/page.tsx:55-71`                                   | La `DashboardFilterBar` es multi-select (fue diseñada para el Resumen). Si un director selecciona dos asignaturas, la comparación **descarta silenciosamente** la segunda. El control promete una capacidad que la vista no honra.                                                                                                    |
| **C5** | **El default de entrada invita a la mezcla.** Sólo `gradeId` es obligatorio; elegir un nivel y nada más produce el peor caso (`mixed` con promedios anuales que mezclan todo)                                                                                   | `comparacion/page.tsx:59`                                      | La entrada correcta (decisión A de #1C) es elegir primero una **unidad comparable** (familia N2), no un nivel suelto.                                                                                                                                                                                                                 |
| **C6** | **Opera a grano NIVEL, no CURSO; sin desglose ni baseline por curso**                                                                                                                                                                                           | `analytics.service.ts:242-271` (`groupBy(academicYears.year)`) | El usuario pide _"comparar el mismo curso en la misma asignatura años anteriores"_ y _"otros cursos/niveles años anteriores sobre la misma medición"_. `comparable-overview.service.ts` ya construye `byClassGroup` + baseline `previous_year`, pero esta vista **no lo reutiliza**: no hay corte curso × año sobre la misma familia. |
| **C7** | **No contrasta instrumentos: no explica si un salto es aprendizaje o cambio del instrumento**                                                                                                                                                                   | — (no existe)                                                  | Alcance de **#4** (comparación con IA). Hoy la vista es puramente determinística y ni siquiera marca qué comparaciones son "manzanas con manzanas" más allá del banner de mezcla.                                                                                                                                                     |

**Resumen de comparación:** la vista fue _endurecida en el query_ (D7 agregó `applicationPeriod` a la
clave de familia) pero **quedó a medio camino**: emite y dibuja el promedio mixto igual. Es, de hecho,
más expuesta que los endpoints que #1C sí arregló.

---

## 3. Diagnóstico — Progresión (`/resultados/progresion`)

**Backend:** `AnalyticsService.progression()` + 3 helpers (`analytics.service.ts:112-640`).
**Frontend:** `apps/web/src/app/(dashboard)/resultados/progresion/page.tsx` +
`components/charts/progression-chart.tsx`.

### 3.1 Cómo funciona hoy

- 3 scopes: `student` / `class` / `skill` (`progression()`, `:112-126`).
- Cada scope devuelve **un punto por evaluación ordenado por `administeredAt`**
  (`:507`, `:569`, `:631`), con `achievement` = `percentage` (o `avg(percentage)` para curso/habilidad).
- La UI dibuja **una única `LineChart`** que une todos los puntos con `connectNulls`
  (`progression-chart.tsx`) + una tabla de detalle por evaluación (`progresion/page.tsx:286-337`).

### 3.2 Fallas

| #      | Falla                                                                                                                                           | Dónde                                                                              | Por qué está mal                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | **Una sola línea que salta entre instrumentos incomparables**, sin agrupación por instrumento, familia ni ciclo                                 | `progression-chart.tsx` + `analytics.service.ts:507,569,631`                       | Grafica DIA Lenguaje diagnóstico → ensayo SIMCE → prueba interna de cierre como si fueran una tendencia. Es exactamente el defecto que el roadmap denuncia (`roadmap-producto.md:255-258`) y que #1C prohíbe.                                            |
| **P2** | **NO devuelve `comparability` en absoluto.** `progression()` nunca llama a `buildComparabilityMeta`; `ProgressionResponse` no tiene el campo    | `analytics.service.ts:112-126`; `packages/types/src/schemas/analytics.schema.ts`   | Es el **único** consumidor de analítica temporal que quedó completamente fuera del marco de #1C. Ni siquiera muestra el banner de mezcla que sí tiene comparación. Es la Deuda #5 del diseño anterior.                                                   |
| **P3** | **Reintroduce el fallback legacy 40/70/85 que #1C eliminó.** Deriva `performanceLevel` del promedio con `percentageToPerformanceLevel(avg/100)` | `analytics.service.ts:786-806`; se pinta en `progresion/page.tsx:326-330`          | Es precisamente el _"silent legacy fallback"_ que la decisión B de #1C mató en el resto del módulo. El nivel mostrado corresponde a un corte que no es de ningún instrumento del alcance.                                                                |
| **P4** | **Los filtros no acotan a algo comparable.** A la API sólo llegan `subjectId[0]` y `academicYearId`                                             | `progresion/page.tsx:187-189`                                                      | No hay filtro por instrumento, tipo ni momento. Incluso fijando asignatura, la línea puede mezclar diagnóstico + monitoreo + cierre de esa asignatura sobre instrumentos distintos. Y sin `academicYearId`, une puntos de 2024 y 2025 como "progresión". |
| **P5** | **No existe el concepto de ciclo de aplicación (diagnóstico → monitoreo → cierre).** Sólo ordena por fecha                                      | `analytics.service.ts` (todos los helpers `orderBy(administeredAt)`)               | Justo la progresión valiosa que el usuario pide (**N3 `period_series`**) es la que el backend NO modela. `comparability.ts` ya tiene `buildPeriodSeriesKey` y `previousApplicationPeriod` listos, pero `progression` no los usa.                         |
| **P6** | **Los scopes `student`/`skill` son casi inalcanzables desde la UI:** exigen pasar `studentId`/`nodeId` a mano por querystring                   | `progression-scope-bar.tsx:160-165`                                                | No hay catálogo de alumnos ni de habilidades en la barra. En la práctica sólo `scope=class` es usable.                                                                                                                                                   |
| **P7** | **Solapa con #2B (vista 360 del estudiante) sin coordinación**                                                                                  | `progression?scope=student` == `panorama-trajectory.tsx` (roadmap #2B, `:255-258`) | Dos vistas comparten el mismo endpoint, el mismo gráfico y el mismo defecto. El fix debería ser un único modelo de "trayectoria comparable" reutilizado, no dos parches.                                                                                 |

---

## 4. Lo que el usuario quiere ↔ el modelo que ya existe

Las cuatro comparaciones valiosas que pide el usuario **ya tienen nombre** en `comparability.ts`. No
falta modelo de datos ni migración: la materia prima está en
`instruments.{type, subjectId, gradeId, applicationPeriod, year}`.

| Lo que pide el usuario                                                                                                             | Nivel                                                                   | Helper existente                                    | Estado hoy                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| "Progresión de un curso en el tiempo: diagnóstico → monitoreo → cierre de una asignatura"                                          | **N3 `period_series`**                                                  | `buildPeriodSeriesKey`, `previousApplicationPeriod` | ❌ No existe: progresión ordena por fecha, sin ciclo (P5)            |
| "Comparar ese mismo curso, misma asignatura, años anteriores"                                                                      | **N2 `instrument_family`** a grano **curso** + baseline `previous_year` | `buildInstrumentFamilyKey`, `deltaInPoints`         | ⚠️ Comparación es a grano nivel, mezcla, sin desglose por curso (C6) |
| "Comparar con otros cursos/niveles años anteriores sobre la misma medición (ej. mismo nivel en DIA intermedio de años anteriores)" | **N2** a grano nivel + `byClassGroup` + `previous_year`                 | ídem + patrón de `comparable-overview.service.ts`   | ⚠️ Comparación agrega por año sin exponer cursos ni deltas (C6)      |
| "Seleccionar evaluaciones/asignaturas por nivel o curso y ver data comparable"                                                     | Entrada **por unidad comparable**                                       | decisión A de #1C (matriz por unidad)               | ❌ Multi-select laxo que usa sólo el primero (C4/C5)                 |

---

## 5. Decisiones (resueltas 2026-08-06)

| #     | Decisión                                                              | Resolución                                                                                                                                                                                                                                                                                                                                     |
| ----- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | ¿Fusionar comparación + progresión?                                   | ✅ **Sí, una sola vista "Trayectoria comparable".** N2 (años) y N3 (momentos) son la misma pregunta —"¿cómo se mueve esta unidad comparable a lo largo de un eje?"— con distinto eje. En un mismo lugar se muestra el resultado actual y su **variación contra dos baselines** (§6.2).                                                         |
| **B** | Entrada por unidad comparable, ¿reemplaza o envuelve el multi-select? | ✅ **Selector guiado propio** (nivel → asignatura → medición → curso opcional) que **reemplaza** la `DashboardFilterBar` multi-select **en esta vista**. El multi-select sigue existiendo para Resumen/Dimensiones/Mapa de calor. La entrada guiada garantiza que el alcance sea siempre N1/N2/N3, nunca `mixed`.                              |
| **C** | Grano por defecto                                                     | ✅ **Nivel por defecto**, con el desglose por curso (`byClassGroup`) siempre visible y un clic para **acotar a un curso** (que baja a N1-por-curso).                                                                                                                                                                                           |
| **D** | Progresión `student`/`skill`                                          | ✅ **`student` migra a #2B** (vista 360, mismo modelo de trayectoria reutilizado). **`skill` pasa a ser una lente opcional** dentro de la unidad (drill por `nodeId`, que el eje N2 ya soporta), no un scope de primer nivel. Se elimina el requisito de pasar `studentId`/`nodeId` a mano por URL.                                            |
| **E** | Endpoint nuevo vs. endurecer in-place                                 | ✅ **Endpoint unificado nuevo** (`GET /api/analytics/comparable-trajectory`, nombre TBD) sobre un servicio que **reutiliza los resolvers ya escritos** en `comparable-overview.service.ts`, extraídos a un colaborador compartido. Es la opción DRY/SOLID (§6.3). Se retiran `generational` y `progression` una vez migrados sus consumidores. |

**Punto a confirmar (no bloquea):** interpreto _"el nivel de arriba en el año anterior en la misma
medición"_ como el **`previous_year` de la misma familia N2** (mismo nivel, mismo instrumento, año
anterior) — que además es "el nivel que hoy está un grado más arriba", porque los alumnos del nivel N
del año pasado hoy están en N+1. Es peras-con-peras. La lectura alternativa —comparar el nivel N
contra el nivel N+1 (instrumentos **distintos**) como referencia aspiracional— **viola el principio
rector** (mide con dos varas distintas) y por eso no se diseña; lo que sí cubre "otros cursos y
niveles" es el desglose `byClassGroup` de la unidad, cada curso contra **su propio** baseline (§6.2).

---

## 6. Diseño de la solución

El principio: **una unidad comparable + un eje + baselines**, todo apoyado en el marco #1C que ya
existe. No se inventa modelo nuevo; se unifican dos vistas rotas en una correcta y se reutiliza la
maquinaria de `comparable-overview`.

### 6.1 Concepto: "Trayectoria comparable"

Una sola vista, centrada en **una unidad comparable** (una familia N2 o una serie de momentos N3),
que se mueve a lo largo de **un eje** elegible:

| Eje          | Qué fija / qué varía                                                                              | Nivel                      | Reemplaza a                 |
| ------------ | ------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------- |
| **Años**     | Fija `(type, subject, grade, applicationPeriod)`; varía `year`                                    | **N2 `instrument_family`** | la comparación generacional |
| **Momentos** | Fija `(type, subject, grade, year)`; varía `applicationPeriod` (diagnóstico → monitoreo → cierre) | **N3 `period_series`**     | la progresión               |

Cada punto del eje es una **aplicación comparable** (misma familia), con su `% de logro` y su banda —
nunca una línea `connectNulls` que salta entre instrumentos incomparables. El corte de niveles siempre
es el del instrumento (`classifyByBands` + `loadInstrumentBands`), nunca el legacy 40/70/85 (mata P3).

### 6.2 Los dos baselines, en un mismo lugar

Para el resultado actual de la unidad se muestran **dos variaciones** (chips de delta en pp, vía
`MetricComparison`), que son exactamente los dos `BaselineKind` que `comparability.ts` ya define y
`comparable-overview` ya resuelve:

1. **`previous_period`** — "la evaluación anterior rendida por el mismo curso/nivel": el momento
   anterior del ciclo (p. ej. actual = Monitoreo → baseline = Diagnóstico) dentro del mismo año y
   familia. Es la trayectoria **intra-año**.
2. **`previous_year`** — "el nivel [que hoy está] arriba, en el año anterior, en la misma medición":
   la misma familia N2 en `year - 1`. Es la comparación **inter-año** peras-con-peras.

Ambos ya se calculan en `attachBaselines` (`comparable-overview.service.ts:482-515`), que hoy **elige
uno** (`previousPeriod ?? previousYear`). El único cambio de comportamiento: **exponer los dos a la
vez** cuando existan, en vez de priorizar uno.

El desglose **`byClassGroup`** (ya construido en `loadByClassGroup`, `:395-480`) responde "otros cursos
y niveles": cada curso del nivel con su `% + banda + share en banda inferior`, ordenable, y cada uno
comparable contra **su propio** baseline. Es el drill nivel → curso de la decisión C.

### 6.3 Backend: endpoint unificado + extracción de los resolvers compartidos (DRY/SOLID)

**Problema DRY actual:** la lógica correcta (fold de logro, distribución por banda, `byClassGroup`,
resolución de baselines, comparabilidad) vive como **métodos privados de `ComparableOverviewService`**
— no reutilizable por un segundo servicio sin copiar. Y `analytics.service.ts` re-implementa versiones
peores de lo mismo (avg crudo, nivel legacy).

**Diseño (aplica `03-helpers-vs-services.md`: lógica reusada entre archivos → su propio servicio):**

1. **Extraer** de `ComparableOverviewService` un colaborador compartido —`ComparableUnitAssembler`
   (o helpers en `apps/api/src/dashboards/comparable/`)— dueño de: `loadAchievementByAssessment`,
   `foldAchievement`, `resolveBandDistribution`, `loadByClassGroup`, y la resolución de baselines
   (`loadBaselineCandidates` + `attachBaselines`). `ComparableOverviewService` pasa a **orquestar
   muchas** unidades usando ese colaborador; nada de comportamiento cambia (los specs de overview lo
   fijan).
2. **`ComparableTrajectoryService`** nuevo: orquesta **una** unidad + su eje + sus dos baselines +
   `byClassGroup`, todo vía el colaborador. SRP limpio (overview = matriz; trajectory = una unidad en
   el tiempo; assembler = arma una unidad).
3. **`GET /api/analytics/comparable-trajectory`** (`@Roles(...ANALYTICS_VIEWER_ROLES)`, mismo scoping
   por rol vía `resolveClassGroupScope`). Respuesta ~:
   ```ts
   type ComparableTrajectoryResponse = {
     axis: 'years' | 'moments';
     unit: ComparableUnitSummary; // el punto "actual" (reutiliza el tipo existente)
     series: ComparableTrajectoryPoint[]; // puntos comparables a lo largo del eje
     baselines: {
       // ambos, no uno
       previousPeriod: BaselineRef | null;
       previousYear: BaselineRef | null;
     };
     comparability: ComparabilityMeta; // siempre presente (mata P2)
   };
   ```
4. **Pago de deuda al pasar:** el ensamblado por-unidad de overview tiene N+1 conocido
   (`comparable-overview.service.ts:55-72`). El trajectory endpoint opera sobre **una** unidad + sus
   vecinos de familia → es acotado por diseño; y la extracción es la oportunidad de mover a
   "una query por preocupación" sin empeorar overview. **No** introducir trabajo por-unidad nuevo sin
   saldar eso (regla del propio archivo + `04-collection-complexity.md`).

### 6.4 Frontend: una vista, un selector guiado, dos ejes

- **Una tab** ("Comparación" o "Trayectoria") reemplaza las dos actuales en `RESULTADOS_TABS`
  (`view-tabs.tsx`). Se retira la tab "Progresión".
- **Selector guiado** (reemplaza el multi-select en esta vista): `Nivel → Asignatura → Medición
(tipo + momento) → Curso (opcional)`, con `useTransition` + `TopProgressBar` (contrato de
  `07-navigation-reactivity.md`). Por defecto: nivel elegido, eje = años, sin curso.
- **Toggle de eje** años ↔ momentos (o mostrar ambos si hay datos): la misma unidad, distinto eje.
- **Panel**: (a) `MetricComparison` del resultado actual con **dos chips de delta** (vs período
  anterior, vs año anterior); (b) **gráfico de trayectoria** punto-a-punto comparable (reemplaza
  `generational-chart` + `progression-chart` por un único chart parametrizado por eje); (c)
  distribución por **bandas del instrumento** (reemplaza `generational-distribution-chart`, sin enum
  legacy); (d) **tabla `byClassGroup`** con drill a curso.
- **Guardas de comparabilidad**: si el alcance resolviera a `mixed` (no debería, dada la entrada
  guiada), se reutiliza `ComparabilityNotice` + supresión del número (mata C1).
- **`GenerationalBanner`** del Resumen re-apunta a la vista unificada con el eje = años pre-seleccionado
  (hoy enlaza a `/resultados/comparacion`).

### 6.5 Migración (radio acotado, verificado)

| Consumidor                                                                                 | Acción                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /analytics/generational`, `GET /analytics/progression` + sus DTOs                     | Se retiran tras migrar. Un solo endpoint nuevo los reemplaza.                                                                                                                                     |
| Tools del asistente `get_generational`, `get_progression` (con saneo PII en student scope) | Se reemplazan por `get_comparable_trajectory` (mismo saneo PII). Actualizar `analysis-tools.spec.ts`.                                                                                             |
| `resultados/{comparacion,progresion}/` (pages, data.ts, loading.tsx, scope-bar)            | Se consolidan en la vista unificada; se elimina la ruta sobrante.                                                                                                                                 |
| Charts `generational-chart`, `generational-distribution-chart`, `progression-chart`        | Se reemplazan por el chart de trayectoria + distribución por banda. Cada uno tiene **un solo importador** → migración limpia.                                                                     |
| `RESULTADOS_TABS`, `routes.ts`, `nav-items.ts`, `page-titles.ts`                           | Colapsar dos entradas en una.                                                                                                                                                                     |
| `analytics.service.spec.ts` (suites generational/progression)                              | Reescribir contra el contrato nuevo (no borrar: cubren scoping por rol, `passingRate=null` sin escala, skill por nodeId).                                                                         |
| **#2B (vista 360)**                                                                        | Aún **no** consume `progression` (usa `getStudentPanorama`). Se coordina para que reutilice `ComparableTrajectoryService` con la unidad = asignatura del alumno. No hay nada roto que migrar hoy. |

### 6.6 Cómo mata cada falla del diagnóstico

| Falla                                               | Cómo se resuelve                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| C1 (dibuja promedio mixto)                          | Entrada guiada ⇒ nunca `mixed`; y supresión + `ComparabilityNotice` como red de seguridad    |
| C2 (avg por año mezcla dentro del año)              | El eje N2 fija la familia; cada punto es una aplicación comparable, no un avg de todo el año |
| C3 (distribución con enum legacy)                   | Distribución por **bandas del instrumento** (`classifyByBands`)                              |
| C4/C5 (multi-select first-only; default mezcla)     | Selector guiado dedicado; default = nivel + eje años                                         |
| C6 (sólo grano nivel)                               | `byClassGroup` + drill a curso (decisión C)                                                  |
| P1/P2 (línea entre instrumentos; sin comparability) | Serie punto-a-punto por familia + `comparability` siempre en el payload                      |
| P3 (legacy 40/70/85)                                | Se elimina `percentageToPerformanceLevel`; bandas del instrumento                            |
| P4/P5 (filtros no acotan; sin ciclo)                | Eje "momentos" = ciclo N3 explícito; entrada guiada acota a una familia                      |
| P6 (student/skill por URL)                          | `student` → #2B; `skill` → lente por `nodeId` dentro de la unidad                            |
| P7 (solape #2B)                                     | Modelo de trayectoria único reutilizado por #2B                                              |
| C7 (contraste peras-vs-peras)                       | Enganche para #4 (IA), fuera de esta tanda                                                   |

---

## 7. Qué NO tocar (ya está bien)

- El **streaming del shell** (Suspense + `loading.tsx`, contrato de `07-navigation-reactivity.md`):
  ambas páginas ya lo cumplen.
- El **núcleo `comparability.ts`**: es la fuente única correcta. Reutilizarlo, nunca re-derivar.
- El **read-model de cohorte** (`assessment_skill_stats` / `assessment_item_stats`): permite alimentar
  las vistas desde informes agregados; preservar ese camino.
- Las **bandas por instrumento** (`performance_bands`, `classifyByBands`) como escala primaria.

---

## 8. Estado de implementación

✅ **Implementado** en la rama `fix-comparison-progression-views`. Validado con typecheck + lint +
prettier (types/api/web) y los specs afectados (`analysis-tools.spec.ts`, `comparable-alerts.service.spec.ts`).

- **Backend:** `ComparableUnitAssembler` extraído de `ComparableOverviewService` (Ola 0, comportamiento
  idéntico) · `ComparableTrajectoryService` + `GET /api/analytics/comparable-trajectory` (Ola 1, expone
  **ambos** baselines) · tool `get_comparable_trajectory` reemplaza a `get_generational`/`get_progression`.
  Retirados `AnalyticsService.{generational,progression}`, su controller/DTOs/spec, `analytics.schema.ts`.
- **Frontend:** vista única `resultados/trayectoria/` (selector guiado + toggle de eje + chips de delta
  - `TrajectoryChart` + `DistributionBar` por bandas + tabla `byClassGroup` con drill a curso). Retiradas
    las tabs/rutas/charts de `comparacion` y `progresion`; `GenerationalBanner` re-apunta a la nueva ruta.

### 8.1 Deuda y desviaciones conocidas

| #   | Qué                                                                                                                             | Por qué se acepta                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Lente por habilidad (`nodeId`) no implementada.** El eje recorre la familia a grano assessment, no por nodo de taxonomía.     | El core (comparación+progresión a grano nivel/curso) es el entregable; la lente de habilidad es follow-up (P6, decisión D). |
| 2   | **Eje "momentos" usa el año más reciente** (no hay selector de año en la UI). El backend acepta `year`; falta exponerlo.        | Cubre el caso normal; agregar el picker de año es incremental.                                                              |
| 3   | **Ensamblado no es de una sola pasada.** `ComparableTrajectoryService` corre queries por punto/baseline (acotado a una unidad). | Igual deuda documentada en `comparable-overview.service.ts`; volumen chico. No agregar trabajo por-unidad sin saldarla.     |
| 4   | **`student` scope migró conceptualmente a #2B** pero #2B aún no consume `ComparableTrajectoryService`.                          | #2B no consumía `progression` hoy (usa `getStudentPanorama`): no hay regresión; el enganche queda para esa tanda.           |
| 5   | **Sin verificación visual** (nadie abrió la página en el navegador).                                                            | Pendiente de una sesión con la app levantada / datos demo.                                                                  |

---

## 9. Bitácora

| Fecha      | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-06 | Documento creado. Diagnóstico de las dos vistas de comparación temporal (C1–C7 en comparación, P1–P7 en progresión), mapeo de los requerimientos del usuario a los niveles N0–N3 ya existentes, y direcciones de mejora. Decisiones A–E abiertas. Continúa `diseno-panorama-comparable.md` (Deuda #5) y engancha con roadmap #2B y #4.                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-06 | **Decisiones A–E resueltas** (§5): fusión en una vista "Trayectoria comparable" (N2 años / N3 momentos como ejes), selector guiado que reemplaza el multi-select, grano nivel por defecto con drill a curso, `student`→#2B y `skill`→lente por nodeId, endpoint unificado nuevo reutilizando los resolvers de `comparable-overview`. Diseño de la solución escrito (§6): concepto, dos baselines (`previous_period` + `previous_year`) en un lugar, extracción DRY/SOLID de `ComparableUnitAssembler`, frontend de una vista, migración acotada. Interpretación de "el nivel de arriba" = `previous_year` anotada para confirmar. Falta: cerrar el nombre del endpoint y la calibración fina; luego plan de ejecución por olas. |
| 2026-08-06 | **Implementado** (§8). Endpoint `GET /api/analytics/comparable-trajectory`, `ComparableTrajectoryService` + `ComparableUnitAssembler` (extraído del overview sin cambiar su comportamiento), tool `get_comparable_trajectory`, y la vista única `resultados/trayectoria/`. Retirados `generational`/`progression` (endpoints, DTOs, tools, charts, páginas, `analytics.schema.ts`). typecheck + lint + prettier verdes; specs afectados pasan. Deuda registrada en §8.1 (lente por habilidad, picker de año, ensamblado 1-pasada, enganche #2B, verificación visual).                                                                                                                                                           |
