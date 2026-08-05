# Diseño — Panorama Pedagógico comparable y reactivo (ítems #1C + #2)

> **Qué es esto:** documento vivo de diseño para los ítems **#1C** (eliminar agregación sobre
> instrumentos no comparables) y **#2** (Panorama Pedagógico inteligente) del
> `docs/roadmap-producto.md`. Recoge el **diagnóstico del módulo tal como está hoy** (con
> archivo:línea), la **definición operativa de "comparable"** que hoy no existe en ninguna parte del
> código, y el **diseño de lo que hay que agregar**. Se va anotando a medida que se decide e
> implementa.
>
> **Rama / worktree:** `feat/panorama-comparable` (worktree aislado desde `origin/dev` en
> `.claude/worktrees/panorama-comparable`).
> **Fecha de creación:** 2026-08-04 · **Estado:** 🚧 diagnóstico cerrado, diseño en revisión.

---

## 1. Objetivo

Convertir el Panorama Pedagógico (`/resultados`) de un tablero de promedios agregados —que hoy
mezclan instrumentos de distinta dificultad y distinta escala— en un **panel de control comparable,
accionable y reactivo**: que el usuario entre y en segundos vea **dónde hay un problema**, sobre qué
**unidad comparable**, y con **un clic** llegue al detalle.

Tres compromisos que ordenan todo el resto:

1. **Ningún número que mezcle instrumentos no comparables.** Ni en un KPI, ni en una distribución,
   ni en una alerta. (Principio rector del roadmap.)
2. **Toda señal trae contexto y salida.** Una alerta sin unidad comparable, sin baseline y sin CTA
   no es una alerta: es ruido.
3. **La escala la pone el instrumento.** Si el instrumento define bandas (`performance_bands`), se
   clasifica y se alerta con **esas** bandas, no con el corte legacy 40/70/85.

**No-objetivos de esta tanda** (viven en otros ítems del roadmap): el motor proactivo con bandeja
persistente y entrega push (#3B), el análisis IA multi-paso (#3), la vista 360 del estudiante (#2B),
el benchmarking inter-colegios (#7 de F2). Este trabajo deja los **puntos de enganche** para ellos,
no los implementa.

---

## 2. La pieza que falta: definición operativa de "comparable"

Hoy **no existe en el código ninguna noción de comparabilidad**. El único lugar donde el sistema se
acerca es `DashboardsService.resolveScopedBands()`
(`apps/api/src/dashboards/dashboards.service.ts:1520-1537`), que detecta si el scope resuelve a un
único instrumento — y cuando no, **cae en silencio** al corte legacy en vez de negarse a agregar.
Ese "cae en silencio" es la raíz de casi todo lo que sigue.

### 2.1 Los cuatro niveles

| Nivel | Clave | Qué contiene | ¿Se puede promediar en UN número? |
|---|---|---|---|
| **N0 — Aplicación** | `assessmentId` | Una evaluación concreta de un curso/varios cursos | ✅ Sí |
| **N1 — Instrumento** | `instrumentId` | El mismo instrumento aplicado a varios cursos del colegio | ✅ Sí (mismas preguntas, mismo corte) |
| **N2 — Familia estándar** | `(type, subjectId, gradeId, applicationPeriod)` — varía `year` | El "mismo DIA" de años distintos | ❌ No. Se compara **punto a punto** |
| **N3 — Serie de momentos** | `(type, subjectId, gradeId, year)` — varía `applicationPeriod` | Diagnóstico → Monitoreo → Cierre del mismo año | ❌ No. Trayectoria, no promedio |

Todo lo que **no** cae en N0–N3 es **mixto**: no se agrega ni se compara, se **desglosa**.

La materia prima ya está en el schema, no hay que migrar nada:
`instruments.type`, `instruments.subjectId`, `instruments.gradeId`, `instruments.applicationPeriod`,
`instruments.year`, `instruments.version` (`packages/db/src/schema/instruments.ts:43-67`).

### 2.2 Reglas de emisión

- **Agregar** (un número único: % logro, distribución, clasificación de alumnos) → sólo en **N0/N1**.
- **Comparar** (dos números lado a lado + delta en puntos porcentuales) → **N2/N3**.
- **Mixto** → prohibido el número único. Se emite el **desglose por unidad comparable**, o se pide
  al usuario que elija una.
- **Clasificar** (banda/nivel de un alumno o curso) → sólo con las bandas del instrumento de esa
  unidad. Si el scope es mixto, no hay clasificación posible: no se muestra.

### 2.3 Baselines comparables (para los deltas)

Un punto único donde se resuelve "¿contra qué comparo esto?" — el mismo servicio que después
reutilizará el motor proactivo (#3B capa 2):

| Baseline | Regla | Disponible hoy |
|---|---|---|
| `previous_year` | Misma familia N2, `year - 1` | ✅ Datos en BDD |
| `previous_period` | Mismo N3, momento anterior del ciclo | ✅ `applicationPeriod` |
| `org_same_instrument` | El curso vs el total de la org, dentro del mismo `instrumentId` | ✅ |
| `curricular_target` | Meta configurada por el colegio | ❌ No existe modelo — F2 |
| `benchmark` | Otros colegios, k-anónimo | ⏸ Existe `benchmarking.service.ts`, fuera de scope aquí |

---

## 3. Diagnóstico — qué está mal hoy

### 3.1 Backend: agregados que mezclan instrumentos no comparables

| # | Dónde | Qué hace | Por qué está mal |
|---|---|---|---|
| **D1** | `dashboards.service.ts:256-268` → `globalAchievement` | Media ponderada por N de alumnos sobre **todos** los assessments del scope, mezclando `assessment_results` y el read-model de cohorte | Es exactamente el promedio que #1C prohíbe. Sin filtros = promedio de toda la org sobre todos los instrumentos. Un DIA de Matemática 8° difícil y un Lenguaje 3° fácil entran al mismo `avg`. **El código está bien escrito y es correcto en su aritmética — el problema es que la métrica no significa nada.** |
| **D2** | `dashboards.service.ts:1554-1589` → `computePerformanceDistribution` | Cuenta cada par (alumno, assessment) como un punto y agrupa por `assessment_results.performanceLevel` | Doble mezcla: (a) instrumentos de distinta dificultad; (b) **distinta escala** — la fila de un instrumento con bandas trae un nivel derivado de sus cortes, la de otro trae el legacy 40/70/85. La barra suma etiquetas que no significan lo mismo. |
| **D3** | `dashboards.service.ts:519-598` → `getPerformance` (Clasificación) | `avg(percentage)` agrupado **sólo** por `studentId` a través de todas las evaluaciones del scope, y clasifica ese promedio | Un alumno con 90% en una prueba fácil y 50% en una difícil sale "Adecuado". El promedio per-alumno inter-instrumento no tiene interpretación pedagógica. |
| **D4** | `dashboards.service.ts:1520-1537` → `resolveScopedBands` | Si el scope resuelve a >1 instrumento devuelve `null` y el caller usa umbrales legacy | El fallback **miente en silencio**: clasifica con un corte que no es el de ningún instrumento del scope. El propio comentario lo admite ("limitación multi-escala, F2"). Correcto sería **no clasificar**. |
| **D5** | `dashboards.service.ts:1200+` → `getTeacherKpis` | `averageAchievement`, `passingRate`, `criticalStudents` por curso agregando todas sus evaluaciones | Mismo defecto que D1, a grano curso. "Mi 7°A tiene 68%" no dice nada si son 5 instrumentos distintos. |
| **D6** | `analytics.service.ts` → `progression` (`scope=class\|student`) | Una línea única de % logro ordenada por fecha, saltando entre instrumentos | Ya denunciado en el roadmap #2B. Se anota aquí porque comparte el resolver de comparabilidad; **el fix de la vista vive en #2B**, no en esta tanda. |
| **D7** | `analytics.schema.ts:18-25` → `generationalComparisonQuerySchema` | Compara mismo `gradeId` entre años, filtrando por `subjectId` + `instrumentType` | Es *casi* comparable, pero no exige mismo instrumento ni mismo momento: puede comparar el DIA de Cierre 2025 contra el de Diagnóstico 2024. Hay que endurecerlo a la clave N2. |

### 3.2 Backend: alertas que no significan nada

`DashboardsService.deriveAlerts()` (`dashboards.service.ts:1736-1820`):

- **`low_achievement`**: promedia `assessment_results.percentage` por curso **a través de
  instrumentos** y lo compara con **60 hardcodeado** (`:1775`). Mismo defecto que D1 + un umbral que
  ignora las bandas del instrumento. En un DIA cuyo corte de Nivel I está en ~33%, un curso en 55%
  puede estar perfectamente bien y sale alertado; y al revés.
- **`critical_skill`**: promedia `skill_results.percentage` por nodo a través de instrumentos contra
  **50 hardcodeado** (`:1807`). Idéntico problema, agravado porque un mismo nodo de taxonomía se
  evalúa con ítems de dificultad muy distinta según el instrumento.
- **`incomplete`**: declarado en el tipo (`dashboard.schema.ts:104`) y **nunca emitido**.
- **Sin dedup, sin prioridad, sin ciclo de vida, sin baseline.** Cada request las recalcula y las
  devuelve todas, en el orden en que salieron de las dos queries.
- No hay throttling: un colegio con 40 cursos puede recibir 40 alertas `low_achievement` de una,
  todas igual de "importantes".

### 3.3 Frontend: el panorama no es un panel de control

`apps/web/src/app/(dashboard)/resultados/page.tsx` (372 líneas):

| # | Qué pasa | Dónde |
|---|---|---|
| **F1** | Los 4 KPIs son de vanidad: "% Logro global" (D1), "Alumnos evaluados", "Evaluaciones", "Alertas" (un **conteo** de alertas). Ninguno responde "¿dónde tengo un problema?" | `page.tsx:117-140` |
| **F2** | Las alertas son una **lista pasiva**: `<li>` con un borde de color. `alert.contextId` existe en el payload y **la UI no lo usa** — no hay link, no hay CTA, no hay drill | `page.tsx:166-198` |
| **F3** | No existe el corte **% logro × nivel × asignatura × evaluación**. El heatmap es habilidad × asignatura; el overview es global. No hay endpoint ni vista para ese cruce | — |
| **F4** | La tabla de Evaluaciones es plana: nombre, asignatura, nivel, fecha, N, % logro. Sin banda de logro, sin delta contra su comparable, sin señal de qué mirar primero. Ordenada por fecha | `page.tsx:200-300` |
| **F5** | Las tarjetas **no son CTA**: no navegan a ningún drill | `page.tsx:117-140` |
| **F6** | `DistributionBar` pinta los 4 niveles legacy salvo que el scope sea un instrumento único (D2/D4) | `page.tsx:142` |
| **F7** | Nada le dice al usuario que **está mirando una mezcla**. El hint del KPI dice "Promedio sobre el alcance filtrado" — que es justo lo que no debería existir | `page.tsx:122` |
| **F8** | Los KPI docentes sólo aparecen si `scope === 'teacher'`; un director no tiene ninguna vista por curso en el panorama | `page.tsx:152-156` |
| **F9** | El default de la vista es **"todo mezclado"**: sin filtros, agrega toda la org. La entrada correcta es elegir primero la unidad comparable | `dashboard-filters.ts` |

**Lo que sí está bien y NO hay que tocar** (para no romperlo al reescribir):

- El **streaming del shell** ya cumple el contrato de `07-navigation-reactivity.md`: `page.tsx` sólo
  `await`ea `auth()` y `searchParams`, cada sección es un async child bajo `<Suspense>`
  (`page.tsx:74-93`), hay `loading.tsx` hermano y `layout.tsx` compartido con `ResultadosNav`.
- Los **filtros multi-select** ya son ricos y con `useTransition` + `TopProgressBar`
  (`dashboard-filter-bar.tsx`, `dashboard-filters.ts`): asignatura, nivel, curso, tipo de
  instrumento, momento DIA, instrumento, año.
- El **read-model de cohorte** (`assessment_item_stats` / `assessment_skill_stats`) ya permite que
  los informes oficiales agregados alimenten las mismas vistas — hay que preservar ese camino.
- Las **bandas por instrumento** (`performance_bands`, `loadInstrumentBands`, `classifyByBands`) ya
  existen y están probadas. El diseño nuevo las usa como escala primaria.

### 3.4 Radio de impacto de tocar estos contratos

| Consumidor | Qué usa | Impacto |
|---|---|---|
| `resultados/page.tsx` | `overview.globalAchievement` | El único consumidor de UI (`grep` confirmado) |
| `dashboards.service.spec.ts` | `globalAchievement` en 7 aserciones | Los tests hay que reescribirlos con la métrica nueva, no borrarlos |
| **Asistente IA** — `get-dashboard-overview.tool.ts`, `get-dashboard-performance.tool.ts`, `get-dashboard-skills.tool.ts` | Llaman directo a `DashboardsService` | **Cambio de contrato llega al LLM.** Es una mejora, no un daño: hoy le entregamos un promedio sin significado del que razona. Hay que actualizar las descripciones de las tools en la misma tanda. |
| `heatmap.service.ts` | Reusa helpers de scope de `DashboardsService` | Sin impacto si el resolver se agrega sin tocar los helpers existentes |

El radio es **chico y contenido**. Es el mejor momento para hacerlo.

---

## 4. Diseño propuesto

### 4.1 Ola 0 — Núcleo de comparabilidad (base, sin cambios visibles)

**`packages/types/src/comparability.ts`** (nuevo, fuente única compartida api ↔ web):

```ts
export const COMPARABILITY_KINDS = [
  'single_assessment',   // N0
  'single_instrument',   // N1
  'instrument_family',   // N2 — comparable punto a punto, NO agregable
  'period_series',       // N3 — comparable punto a punto, NO agregable
  'mixed',               // no comparable
] as const;

export type ComparabilityMeta = {
  kind: ComparabilityKind;
  aggregatable: boolean;              // true sólo en N0/N1
  instrumentIds: string[];
  familyKey: string | null;           // `${type}|${subjectId}|${gradeId}|${applicationPeriod}`
  reason: string | null;              // texto en español para la UI cuando aggregatable=false
};
```

**`apps/api/src/dashboards/comparability.service.ts`** (nuevo):
`resolveComparability(tx, orgId, query) → ComparabilityMeta` y
`resolveBaseline(tx, unit, kind) → BaselineRef | null`.

Es el **punto único** donde vive la definición. Regla dura: ningún otro archivo re-deriva
"¿esto es comparable?".

**Mecanismo de entrega:** `meta.comparability` en el payload, **no** un guard que cierre la ruta.
Es exactamente el precedente ya establecido por `analytics-capabilities.ts` (mecanismo 2: rutas
mixtas se cortan en el payload, no en la ruta) — y `/dashboards/overview` es una ruta mixta: sirve
métricas que sí se pueden emitir (conteos, lista de evaluaciones) junto a otras que no.

### 4.2 Ola 1 — #1C: retirar y reemplazar los agregados no comparables

| Métrica actual | Qué se hace |
|---|---|
| `globalAchievement` (D1) | **Se retira del contrato.** Se reemplaza por `units[]`: un % de logro **por unidad comparable**, cada uno legítimo |
| `performanceDistribution` (D2) | Se emite **sólo** si `aggregatable`; y siempre con las bandas del instrumento. Si es mixto → `null` + `reason` |
| `getPerformance` / Clasificación (D3, D4) | Si el scope no resuelve a N0/N1, **no clasifica**: devuelve `students` sin `performanceLevel`/`performanceBand` + `comparability.reason`, y la UI pide elegir una unidad. Se elimina el fallback silencioso a 40/70/85 |
| `teacher-kpis` (D5) | Una fila por **(curso × unidad comparable)**, no por curso |
| `generational` (D7) | El query pasa a exigir la clave N2 completa (se agrega `applicationPeriod`, y `instrumentId` opcional para fijar N1) |
| `progression` (D6) | Sólo se anota la deuda y se deja el resolver listo. **El fix vive en #2B** |

### 4.3 Ola 2 — #2: el Panorama nuevo

**Endpoint nuevo: `GET /api/dashboards/comparable-overview`** — el reemplazo del promedio global y
la respuesta al corte "% logro × nivel × asignatura × evaluación/instrumento":

```ts
type ComparableUnitSummary = {
  key: string;                       // instrumentId
  instrumentId: string;
  instrumentName: string;
  instrumentType: string;
  subjectId: string | null;   subjectName: string | null;
  gradeId: string | null;     gradeName: string | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  year: number | null;
  assessmentIds: string[];
  studentsAssessed: number;
  averageAchievement: number | null;              // legítimo: dentro de la UC
  bands: PerformanceBandView[] | null;
  bandDistribution: PerformanceBandDistributionBucket[] | null;
  byClassGroup: { classGroupId, classGroupName, achievement, band, studentsAssessed }[];
  baseline: { kind: BaselineKind; label: string; achievement: number | null; deltaPp: number | null } | null;
  severity: 'high' | 'medium' | 'low' | null;     // para ordenar la vista
};

type ComparableOverviewResponse = {
  scope: 'org' | 'teacher';
  units: ComparableUnitSummary[];                 // ordenadas por severidad, luego fecha
  totals: { assessments: number; studentsEvaluated: number };  // conteos: siempre legítimos
  comparability: ComparabilityMeta;
};
```

Agregación en **una sola pasada con `Map`** (`04-collection-complexity.md`); nada de `.find()` por
celda como advierte la regla sobre `HeatmapService.assembleResponse()`.

**UI del panorama** (`resultados/page.tsx` reescrito):

1. **Cabecera de 3 conteos** — alumnos evaluados, evaluaciones, alertas críticas. Nada que promedie
   (decisión C, arregla F1).
2. **Banda de alertas** — banners priorizados por severidad, cada uno con su unidad comparable, su
   delta contra baseline y un **CTA que navega al drill** usando `contextId` (arregla F2). Máximo N
   visibles + "ver todas".
3. **Matriz de unidades comparables — la vista por defecto** (decisión A, arregla F3). Filas
   ordenadas por severidad, con el corte % logro × nivel × asignatura × evaluación. Cada celda:
   % logro + banda + N + delta vs baseline, y es **navegable** (arregla F5).
4. **Selector de unidad** que *acota* la matriz (no es peaje de entrada). Al elegir una, la vista
   baja al desglose por curso de esa unidad, con `MetricComparison` y sus chips de delta (arregla
   F4).
5. **Cartel explícito cuando el scope es mixto** con el `reason` del backend (arregla F7). Se acabó
   el número mudo.
6. **Desglose por curso siempre visible**, para director y profesor (arregla F8).

### 4.4 Ola 3 — Alertas comparables

Reescribir `deriveAlerts` sobre tres cambios:

- **Umbral por banda del instrumento**, no 60/50 hardcodeados. Una alerta se dispara cuando el
  curso/habilidad cae en la banda inferior **de su propio instrumento**.
- **Alerta por delta**: caída ≥ X pp contra el baseline comparable (`previous_year` /
  `previous_period`). Esta es la alerta que hoy no existe y es la más valiosa.
- **Prioridad + dedup**: clave de dedup `(type, contextId, unitKey)`, orden por severidad × N de
  alumnos afectados, tope de emisión con "ver todas".

Cada alerta emite `unitKey`, `baselineRef` y `href` de drill — que es **exactamente la forma de fila
que la bandeja persistente de #3B va a necesitar**. Se diseña compatible aunque aquí siga siendo
efímera.

### 4.5 Ola 4 — Reactividad ("tiempo real")

- Mantener RSC-first + Suspense (ya cumple el contrato de navegación).
- **Refresco en vivo sólo de la banda de alertas y los contadores** vía TanStack Query sobre el
  proxy genérico ya existente (`lib/api-client.ts` + `app/api/proxy/[...path]/route.ts`), con
  `refetchInterval` — el patrón ya probado en `use-remedial-status.ts`. No convertir la página a
  cliente.
- Invalidación al terminar un `import_job` (engancha con #3B capa 1 sin construirla).
- Responsive mobile-first en la matriz: scroll horizontal contenido, nunca scroll del body.

---

## 5. Plan de ejecución

| Ola | Alcance | Depende de |
|---|---|---|
| **0** | `packages/types/src/comparability.ts` + `comparability.service.ts` + `meta.comparability` en las 3 rutas de dashboards. Sin cambios de UI | — |
| **1** | #1C: retirar `globalAchievement`, condicionar distribución/clasificación, `teacher-kpis` por unidad, endurecer `generational`. Actualizar specs y tools del asistente | 0 |
| **2** | #2: `GET /dashboards/comparable-overview` + reescritura de `resultados/page.tsx` (select-first, matriz, tarjetas CTA, cartel de mezcla) | 0, 1 |
| **3** | Alertas comparables (bandas + delta + prioridad + dedup + CTA) | 0, 2 |
| **4** | Refresco en vivo + responsive + pulido | 2, 3 |

Olas 0 y 1 son backend puro y se pueden validar con los specs existentes de
`dashboards.service.spec.ts` (1027 líneas ya cubren el camino cohorte/per-alumno — hay que
reescribir las 7 aserciones de `globalAchievement`, no borrarlas).

---

## 6. Decisiones abiertas

| # | Decisión | Resolución | Estado |
|---|---|---|---|
| **A** | Qué muestra el panorama **sin** unidad comparable elegida | **Matriz de todas las unidades ordenada por severidad.** El usuario ve dónde está el problema sin elegir nada y entra con un clic; nunca se le muestra un número mezclado. La elección de unidad acota, no es un peaje de entrada | ✅ 2026-08-04 |
| **B** | Clasificación de alumnos en scope mixto | **No se clasifica.** Se muestra el motivo (`comparability.reason`) + selector de unidad. Se elimina el fallback silencioso a 40/70/85 | ✅ 2026-08-04 |
| **C** | ¿Se conserva algún KPI de cabecera? | **Sólo conteos + alertas críticas** (alumnos evaluados, evaluaciones, alertas). Son legítimos porque no promedian nada. Se elimina el "% Logro global" | ✅ 2026-08-04 |
| **D** | Umbral de alerta por delta | ¿Cuántos pp de caída contra el baseline disparan alerta? ¿Configurable por org? | 🔲 |
| **E** | ¿`instrument.version` entra en la clave de familia N2? | Si una versión nueva cambia los ítems, ¿siguen siendo comparables año a año? | 🔲 |
| **F** | Retrocompatibilidad del contrato | ¿`globalAchievement` se borra del tipo o se deja deprecated un ciclo? (el único consumidor de UI es la propia página) | 🔲 |

**Consecuencias de A + B + C sobre el diseño:**

- La **matriz de unidades es la vista por defecto** de `/resultados`, no un modo alternativo. El
  endpoint `comparable-overview` debe devolver `units[]` **siempre** poblado y ordenado por
  severidad, no sólo cuando el scope es mixto.
- `severity` en `ComparableUnitSummary` deja de ser opcional para la UI: es la clave de orden de la
  vista principal. Se deriva de la banda del instrumento + el delta contra baseline (Ola 3), con un
  fallback determinístico mientras la Ola 3 no exista.
- `getPerformance` emite `students[]` **sin** `performanceLevel` ni `performanceBand` cuando
  `aggregatable === false`, más `comparability.reason`. El frontend de Clasificación renderiza el
  cartel + selector en vez de la tabla.
- La cabecera del panorama pasa de 4 `StatCard` a 3 conteos. `MetricComparison` (con chips de
  delta) se usa **dentro** de la unidad seleccionada, no en la cabecera global.

---

## 7. Riesgos

- **El panorama va a mostrar "menos" al principio.** Cambiar un número grande por un desglose se
  puede leer como pérdida de funcionalidad. Mitigación: el cartel de mezcla explica *por qué*, y la
  matriz entrega más información útil que el promedio que reemplaza.
- **Los tests del asistente** (`dashboard-tools.spec.ts`) asumen el contrato actual. Entran en el
  alcance de la Ola 1, no se dejan para después.
- **Informes agregados (`aggregate_only`)**: el camino de cohorte debe seguir alimentando las mismas
  vistas. Cada ola valida contra un instrumento con informe oficial cargado, no sólo contra uno
  calculado desde `responses`.
- **Volumen de la matriz**: un colegio con muchos instrumentos genera muchas filas. Ordenar por
  severidad y paginar/colapsar — y si se recorta, **decirlo** (nunca truncar en silencio: la lección
  ya aprendida en `loadRecentAssessments`, `dashboards.service.ts:1595-1603`).

---

## 8. Bitácora

| Fecha | Cambio |
|---|---|
| 2026-08-04 | Documento creado. Diagnóstico cerrado (D1–D7, F1–F9), definición de comparabilidad N0–N3 y diseño de las 5 olas propuesto. Pendientes las decisiones A–F. |
| 2026-08-04 | Decisiones **A** (matriz por severidad como vista por defecto), **B** (no clasificar en scope mixto) y **C** (cabecera sólo con conteos, se elimina el "% Logro global") resueltas. §4.3 actualizado con sus consecuencias. Pendientes D, E, F. |
