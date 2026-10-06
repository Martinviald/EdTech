# Diseño — Benchmarking en contexto

> **Qué es esto:** el diseño para llevar la comparación contra otros colegios **a las vistas donde ya
> aparecen los resultados**, en vez de obligar a ir a la página `/benchmarking`. El usuario directivo ve
> "62 % de logro" y, en el mismo lugar, cómo se ubica ese número frente a la muestra de colegios que
> rindieron el mismo instrumento.
>
> **Fecha:** 2026-10-05 · **Estado:** ✅ diseño cerrado (decisiones de producto en §2, decisiones de diseño
> resueltas en §12; sin código todavía). Plan de desarrollo en
> [`plan-benchmarking-en-contexto.md`](./plan-benchmarking-en-contexto.md).
>
> **Relacionado:** [`diseno-panorama-comparable.md`](./diseno-panorama-comparable.md) y
> [`diseno-comparacion-progresion.md`](./diseno-comparacion-progresion.md) (marco de comparabilidad
> N0–N4, `packages/types/src/comparability.ts`); `apps/web/src/components/shared/MetricComparison.tsx`,
> que ya reserva un delta "vs muestra" para cuando existiera el pool multi-colegio (TKT-20). Este
> documento es ese TKT-20.

---

## 1. Problema

Hoy la comparación entre colegios vive en una sola página, `/benchmarking`. Para saber si un 62 % de
logro en Lectura 4° es bueno, un directivo tiene que salir de la vista de resultados, entrar a
benchmarking, elegir instrumento y modo, leer la comparación y volver. Son varios clics y, sobre todo,
la pregunta se separa del dato que la provocó.

La comparación es **contexto de un resultado**, no un destino. La pregunta real del usuario es "¿qué
significa este número y debería preocuparme?", y se responde mejor al lado del número.

## 2. Decisiones de producto (tomadas)

| # | Decisión | Consecuencia en el diseño |
| --- | --- | --- |
| P1 | **Sin funcionalidades de pago en esta etapa.** Todo se libera a todos los colegios. | Se quita el gating de `benchmarking` (`@RequireFeature`, `isFeatureEnabled`). No se diseña ningún estado bloqueado ni teaser de upsell. |
| P2 | **Visible sólo para roles directivos.** | Se reutiliza `BENCHMARKING_VIEWER_ROLES` (platform_admin, foundation_director, school_admin, academic_director, cycle_director, eval_coordinator). Profesores no ven el contraste. |
| P3 | **Se diseña para la escala final** (muchos colegios). No hay versión "para pocos colegios". | Métricas, gráficos y copys son los definitivos: percentil, zona típica, distribución de la muestra. Hoy se ven con n = 2 y eso es aceptable. |
| P4 | **El tamaño de la muestra siempre está a un hover de distancia.** | Todo contraste lleva un tooltip con colegios, alumnos, alcance y fecha de actualización. Así se ve honestamente que hoy son 2 colegios sin cambiar la forma del dato. |
| P5 | **La página `/benchmarking` se mantiene como vista de detalle.** | Deja de ser la puerta de entrada. Se llega desde un "Ver comparación" en cada contraste. |
| P6 | **La participación de cada colegio en la muestra se acuerda en su contrato.** | No hay flujo de consentimiento en la app. Todo colegio participa salvo opt-out (`optOutGlobalPool`), como hoy. |
| P7 | **La muestra son sólo los colegios reales.** Hoy: CSCJ y San Agustín. | Los datos sintéticos de demo se quedan, pero en instrumentos propios (`[DEMO]`, `TEST`), así nunca comparten `instrumentId` con un colegio real y no entran en ninguna muestra. Las pruebas de escaneo se hacen sobre los fixtures `TEST`, nunca sobre un instrumento DIA real (§4). |

## 3. Principios

1. **Peras con peras.** Sólo se compara el **mismo instrumento** (`instrumentId`, nivel N1 del marco de
   comparabilidad). Nunca se promedia la muestra entre instrumentos, años ni momentos. Si una vista
   mezcla instrumentos, el contraste no aparece, o aparece por instrumento.
2. **El contraste acompaña, no compite.** El número del colegio sigue siendo el protagonista. La
   muestra es una marca, un chip o una segunda línea: nunca otra tarjeta del mismo peso.
3. **La escala del instrumento.** La muestra se muestra en los niveles propios del instrumento (DIA
   Nivel I/II/III), igual que el resultado del colegio. Nunca en la escala legacy de 4 niveles.
4. **Un lenguaje, una referencia.** Una sola referencia principal en toda la app, con el mismo nombre y
   el mismo tooltip, para que el usuario aprenda a leerla una vez.
5. **Silencio antes que ruido.** Si no hay muestra válida, el contraste no se dibuja. Sin avisos en
   línea; la explicación vive en el tooltip vacío y en la página de detalle.

## 4. Qué es "la muestra"

**Definición:** los colegios de la plataforma que rindieron el mismo instrumento, con sus alumnos.

- **Referencia principal: la muestra global.** Todos los colegios con datos del instrumento, excepto
  los que hicieron opt-out del pool global (`optOutGlobalPool`). Es la referencia que responde "¿cómo
  estoy frente al resto?" y es la que escala con la plataforma.
- **Referencia secundaria: la red.** Si el colegio pertenece a una red (`networkOrgId`), el tooltip y la
  vista de detalle muestran además la red identificada. La red no reemplaza a la global porque, a
  escala, una red es un subconjunto sesgado (mismo sostenedor, mismo proyecto educativo).
- **El propio colegio está incluido en la muestra.** Es la semántica de un promedio de referencia (como
  el promedio nacional SIMCE): la muestra es "todos los que rindieron", y el percentil ubica al colegio
  dentro de ella (D1).
- **k-anonimato.** La muestra global se muestra sólo con ≥ `BENCHMARK_K_MIN_SCHOOLS` colegios y
  ≥ `BENCHMARK_N_MIN_STUDENTS` alumnos (hoy 2 y 20). La red, identificada por acuerdo del sostenedor,
  no aplica k.
- **Datos sintéticos (P7).** La muestra se arma por `instrumentId`, así que un colegio sintético sólo
  contamina si rinde un instrumento real. El 2026-10-05 se borraron de demo las 2 evaluaciones de
  prueba de Andes Centro que usaban DIA Lectura 4° 2025 (Intermedio y Cierre); ahí CSCJ habría visto
  una muestra de 2 colegios con uno ficticio. Ningún otro dato sintético comparte instrumento con los
  colegios reales. No hace falta código para excluirlos.
- **Nombre en la UI:** "Muestra" en chips y leyendas; el tooltip lo desarrolla: *"Colegios que rindieron
  este mismo instrumento en la plataforma"*.

## 5. Métricas que se contrastan

Todas se calculan por instrumento. La columna "Disponible" indica si el read-model actual ya las tiene.

| Métrica | Definición | Para qué sirve | Disponible |
| --- | --- | --- | --- |
| **% de logro de la muestra** | Promedio del % de logro **ponderado por alumnos** de todos los colegios de la muestra. | Referencia directa del número del colegio. | Parcial: hoy el promedio de la cohorte es sin ponderar (promedio de promedios). Se cambia a ponderado. |
| **Diferencia (Δ)** | `% colegio − % muestra`, en puntos porcentuales. | Lectura inmediata: "+4 pp". | Sí (se calcula). |
| **Zona típica** | Rango entre el percentil 25 y el 75 del % de logro **de los colegios**. | Responde "¿debería preocuparme?": dentro, bajo o sobre la zona típica. Es más honesto que un Δ solo, porque considera la dispersión. | Sí (`p25`, `p75`). |
| **Percentil del colegio** | Posición del colegio entre los colegios de la muestra (0–100). | Ubicación relativa: "percentil 62". | Sí. |
| **Distribución por nivel de la muestra** | % de alumnos de la muestra en cada nivel **del instrumento**. | Comparar la forma de la distribución, no sólo el promedio. | **No**: el read-model guarda la escala legacy de 4 niveles (ver §8.1). |
| **% de logro por habilidad / eje / OA** | % de logro de la muestra en cada nodo de la taxonomía. | Ver en qué habilidades el colegio se separa de la muestra. | Sí (`perSkill`), pero sólo para nodos con `skill_results`. |
| **% de respuestas correctas por ítem** | % de acierto de la muestra en cada pregunta. | Detectar preguntas donde el colegio falla mucho más que el resto. | **No**: requiere un read-model nuevo (fase 3). |

**Clasificación frente a la zona típica** (el copy que ve el usuario):

| Condición | Etiqueta | Tono |
| --- | --- | --- |
| % colegio < p25 | Bajo la zona típica | warning |
| p25 ≤ % colegio ≤ p75 | En la zona típica | neutral |
| % colegio > p75 | Sobre la zona típica | success |

No se usa rojo/verde para el Δ por sí solo: un −2 pp dentro de la zona típica no es una alarma.

## 6. Dónde aparece

Inventario de vistas de resultados en `origin/dev` y qué contraste lleva cada una. Sólo se incluyen
vistas con resultados de **un instrumento** (N0/N1). La regla general para vistas filtrables es la
misma que ya usa el marco de comparabilidad: el contraste aparece cuando
`comparability.aggregatable && comparability.instrumentIds.length === 1`.

| Vista | Elemento actual | Contraste | Fase |
| --- | --- | --- | --- |
| `/evaluaciones/[id]` (Resumen) | `StatCard` "% logro" | Chip Δ + tooltip de muestra. | 1 |
| `/evaluaciones/[id]/resultados` (`ReportBody`) | `StatCard` % logro | Chip Δ + clasificación de zona típica. | 1 |
| ″ | `DistributionBar` | Segunda barra fina "Muestra" bajo la del colegio, con los mismos colores de nivel. | 1 |
| ″ | `CourseComparison` ("Brecha vs prom.") | Columna nueva "vs muestra" por curso. El curso se compara contra la muestra del instrumento completo. | 1 |
| ″ | `SkillsBreakdown` | Marca vertical en cada barra con el valor de la muestra + Δ en el tooltip. | 2 |
| `/evaluaciones/[id]/informe-oficial` (informe de curso) | `GeneralStat` + `DonutChart` | Línea "Muestra: 58 %" bajo el resultado general; distribución de la muestra en el tooltip del donut. | 2 |
| `/resultados` (Resumen) | `ComparableUnitsTable` (una fila por instrumento) | Columna "vs muestra" con el mismo `DeltaChip`. Esta tabla ya es por instrumento: es el lugar natural para una vista panorámica. | 1 |
| `/resultados/trayectoria` | `MetricComparison` | Un `MetricDelta` más, "vs muestra" (el que reservó TKT-20). | 1 |
| `/resultados/clasificacion` | `DistributionBar` | Igual que en `ReportBody`, sólo si el alcance es un instrumento. | 2 |
| `/resultados/dimensiones` | `SkillsBreakdown` | Igual que en `ReportBody`, sólo si el alcance es un instrumento. | 2 |
| `/establecimiento/informe-oficial` | `BandDistributionTable` (grado × nivel por asignatura) | Fila "Muestra" bajo cada grado, con su distribución por nivel. **Requiere** que `EstablishmentGradeColumn` exponga su `instrumentId` (hoy no lo trae). | 2 |
| `/evaluaciones/[id]/informe-oficial` → `SpecTable` (por ítem) | % de acierto por pregunta | Columna "% muestra" por ítem. | 3 |

**Fuera de alcance:** el mapa de calor (`/resultados/mapa-calor`, cruza instrumentos), el tablero
maestro, la vista 360 del estudiante (comparar a un alumno contra una muestra de colegios es otra
pregunta) y el informe del alumno.

## 7. Patrones de UI

Tres piezas reutilizables en `apps/web/src/components/shared/`, para que todas las vistas hablen igual.

### 7.1 `SampleDeltaChip`

Chip junto al número del colegio.

```
62 %   [▲ +4 pp vs muestra]
```

- Flecha y signo según el Δ; color según la **zona típica** (§5), no según el signo.
- Δ redondeado a 1 decimal; si `|Δ| < 0,5` se muestra "≈ muestra".
- Click → `/benchmarking?instrumentId=…` (vista de detalle).

### 7.2 `SampleTooltip`

El mismo contenido en todos los contrastes (sobre `components/ui/tooltip`). Valores ilustrativos:

```
Muestra · DIA Lectura 4° Básico 2026 — Intermedio
Colegios que rindieron este mismo instrumento en la plataforma

  % de logro de la muestra   58,0 %
  Zona típica (p25–p75)      52,1 – 64,3 %
  Tu colegio                 62,0 % · percentil 62

  2 colegios · 103 alumnos · actualizado hoy 03:30
  Tu red (Fundación Tupungato): 2 colegios · 59,1 %

  Ver comparación →
```

- La línea de tamaño (colegios · alumnos) **siempre** está presente (decisión P4).
- La línea de red sólo aparece si el colegio pertenece a una red.
- "actualizado" usa el `refreshedAt` de la muestra.

### 7.3 Marca de muestra en barras

- **Distribución por nivel:** debajo de la barra del colegio, una barra de la mitad de alto con
  etiqueta "Muestra", mismos colores de nivel (`bandChartColor`). El tooltip de cada segmento muestra
  ambos porcentajes.
- **Barras de % de logro** (habilidades, cursos): una marca vertical fina en la posición del % de la
  muestra, con la zona típica opcional como sombra tenue detrás.

### 7.4 Estados

| Estado | Qué se ve |
| --- | --- |
| Muestra válida | Contraste completo. |
| Sin otros colegios con el instrumento, o no cumple k | Nada en línea. La página de detalle explica por qué. |
| Rol sin acceso | Nada; ni siquiera se pide la muestra. |
| Cargando | Nada en línea (la vista no espera a la muestra; ver §8.4). |
| Error al cargar la muestra | Nada en línea; se reporta con `reportServerError`. La vista principal no falla. |

## 8. Backend y datos

### 8.1 Distribución en los niveles del instrumento

`benchmark_aggregates.band_distribution` guarda la escala legacy de 4 niveles (`bandToLegacyLevel`).
Con 3 bandas, DIA Nivel I → `insufficient`, II → `adequate`, III → `advanced`. Las vistas muestran
Nivel I/II/III, así que la muestra no se puede poner al lado sin traducir, y la traducción es frágil.

**Cambio:** columna nueva `band_counts jsonb` con el conteo por **clave de banda** del instrumento:

```ts
type BenchmarkBandCount = { bandKey: string; label: string; order: number; count: number };
```

- La llena el refresh (`queries/benchmark-aggregates.ts`), que ya clasifica cada resultado con las
  bandas efectivas del instrumento: sólo falta contar por `band.key` en vez de proyectar.
- Todas las filas de un instrumento comparten set de bandas (las bandas son del instrumento), así que
  la suma entre colegios es directa.
- `band_distribution` (legacy) se mantiene mientras la página `/benchmarking` actual la use; se retira
  cuando la vista de detalle migre a `band_counts`.

### 8.2 Contrato nuevo en `@soe/types`

```ts
export const instrumentSampleSchema = z.object({
  instrumentId: z.string().uuid(),
  scope: z.enum(['global', 'network']),
  label: z.string(),                       // "Muestra" | nombre de la red
  schoolCount: z.number().int(),
  studentCount: z.number().int(),
  avgAchievement: z.number().nullable(),   // ponderado por alumnos
  p10: z.number().nullable(),              // umbral de severidad alta de las alertas (§9.3)
  p25: z.number().nullable(),
  median: z.number().nullable(),
  p75: z.number().nullable(),
  bandCounts: z.array(benchmarkBandCountSchema),
  perSkill: z.array(sampleSkillStatSchema),   // por nodo: achievement, studentCount, p10, p25
  refreshedAt: z.string(),
});

export const yourSamplePositionSchema = z.object({
  avgAchievement: z.number().nullable(),   // del read-model (ver §8.5)
  percentile: z.number().nullable(),
  typicalZone: z.enum(['below', 'within', 'above']).nullable(),
});

export const instrumentSampleEntrySchema = z.object({
  instrumentId: z.string().uuid(),
  global: instrumentSampleSchema.nullable(),   // null si no cumple k o no hay otros colegios
  network: instrumentSampleSchema.nullable(),  // null si no hay red
  you: yourSamplePositionSchema.nullable(),
});

export const instrumentSamplesQuerySchema = z.object({
  instrumentIds: z.array(z.string().uuid()).min(1).max(50),
});
```

### 8.3 Endpoint

`GET /api/benchmarking/samples?instrumentIds=a,b,c` → `{ data: InstrumentSampleEntry[] }`

- Un solo request por vista, con todos los instrumentos que la vista muestra (la tabla del panorama
  puede tener varias filas).
- Lee `benchmark_aggregates` cross-tenant como el servicio actual, filtrado por `instrument_id IN (…)`
  (índice `benchmark_aggregates_cohort_idx`). A escala son `n_colegios` filas por instrumento: el
  cálculo de promedio ponderado, percentiles y suma de `band_counts` en memoria es O(filas).
- Guards: `RolesGuard` con `BENCHMARKING_VIEWER_ROLES`. Sin `FeatureGuard` (P1).
- **Auditoría:** una fila de `benchmark_access_logs` por request, con `mode = 'global'` y los
  `instrumentIds` en `filters`. No una por contraste.

### 8.4 Carga en el frontend

Siguiendo `.claude/rules/frontend/07-navigation-reactivity.md`: la muestra **nunca bloquea** la vista.

- La página hace `canAccess(roles, BENCHMARKING_VIEWER_ROLES)`; si no hay acceso, no pide nada.
- Los contrastes se renderizan dentro de un `<Suspense fallback={null}>` con un hijo async que llama
  a `/benchmarking/samples`. La vista pinta sus resultados de inmediato y el contraste aparece cuando
  llega.
- Un helper `getInstrumentSamples(instrumentIds)` envuelto en `React.cache()`, para que un layout y su
  page no pidan dos veces la misma muestra en el mismo request.

### 8.5 Frescura y consistencia

- El read-model se refresca en cada deploy de backend y a diario (06:30 UTC). Se agrega un **refresh
  por org al confirmar resultados** (`refreshBenchmarkAggregates(db, { orgId })` tras
  `persist-results`), para que un colegio que acaba de cargar resultados aparezca en la muestra sin
  esperar al día siguiente. Corre fuera de la transacción de la ingesta.
- El número del colegio en cada vista sale de la vista misma (en vivo, con sus filtros), no del
  read-model. El percentil y la zona típica sí usan el % del colegio del read-model (instrumento
  completo, sin filtros), para que la posición sea consistente con la muestra. Cuando la vista está
  filtrada por curso, el chip compara el curso contra la muestra, y el percentil del tooltip se rotula
  "Tu colegio" para no confundirlo con el curso.

### 8.6 Quitar el gating

- `BenchmarkingController`: se quitan `FeatureGuard` y `@RequireFeature('benchmarking')`.
- `/benchmarking/page.tsx`: se quita el chequeo `isFeatureEnabled('benchmarking')`.
- `'benchmarking'` se queda en `FEATURE_KEYS` mientras otras partes (MCP, `allowedFeatures` en config)
  lo referencien; deja de usarse como gate. Retirar el mecanismo de tiers completo es una decisión
  aparte que aplica a las demás features (fuera de alcance).

## 9. Alertas relativas a la muestra

### 9.1 Por qué

Hoy `ComparableAlertsService` (`apps/api/src/dashboards/comparable-alerts.service.ts`) deriva alertas de
siete fuentes, y todas miran **umbrales absolutos** o **al propio colegio**:

| Alerta actual | Referencia |
| --- | --- |
| `band_concentration` | Absoluta: ≥ 25 / 40 % del curso en la banda inferior. |
| `item_gap` | Absoluta: < 35 / 20 % de acierto en un ítem. |
| `skill_gap` | Interna: el eje queda 12 / 20 pp bajo el promedio de su unidad. |
| `class_below_org` | Interna: el curso queda 8 / 15 pp bajo el promedio de su unidad. |
| `drop_vs_previous_year` / `_period` | Interna: caída contra el baseline comparable del colegio. |
| `band_regression`, `coverage_gap`, `stale_assessment` | Internas / operativas. |

Eso deja dos puntos ciegos que sólo una referencia externa resuelve:

1. **Debilidades sistémicas invisibles.** `skill_gap` compara un eje contra el promedio del mismo
   colegio. Si **todo** el colegio es débil en Inferencia, la comparación interna no lo ve: el eje
   está "en el promedio" de un colegio que está bajo en todo.
2. **Falsas alarmas de instrumentos difíciles.** `item_gap` salta con < 20 % de acierto, pero si la
   muestra también tiene 18 %, es una pregunta difícil para todos, no una brecha del colegio. Al
   revés, un 40 % en Nivel I es grave, y lo es más si la muestra tiene 15 %.

### 9.2 Dónde se muestran

- **En la misma banda de alertas** de `/resultados` (`AlertsBanner`, vía
  `GET /api/dashboards/comparable-overview/alerts`). No se crea otra superficie: una sola bandeja de
  alertas, ordenada por severidad y alumnos afectados como hoy.
- Cada alerta relativa lleva una etiqueta **"vs muestra"** y el mismo `SampleTooltip` de §7.2, para
  que el usuario vea contra qué y contra cuántos colegios se comparó.
- Su CTA lleva a la vista donde el contraste es visible (los resultados de la evaluación, filtrados
  por curso o eje según `contextKind`).
- **Visibilidad:** igual que los contrastes (P2), sólo `BENCHMARKING_VIEWER_ROLES`. Los profesores
  siguen viendo las alertas internas de sus cursos.
- Cuando exista la bandeja persistente (#3B), las alertas relativas entran por el mismo `dedupKey`.

### 9.3 Tipos nuevos

| Tipo | Contexto | Dispara cuando | Severidad |
| --- | --- | --- | --- |
| `below_sample` | Unidad (instrumento) | El % de logro del colegio está bajo la zona típica de la muestra **y** el Δ es ≤ −5 pp. | medium; high si está bajo el p10 **y** Δ ≤ −10 pp. |
| `class_below_sample` | Curso | Igual que la anterior, con el % del curso contra la muestra del instrumento. | Igual. |
| `skill_below_sample` | Eje / habilidad / OA | El % del colegio en el nodo está bajo el p25 de los colegios en ese nodo **y** Δ ≤ −12 pp. | medium; high si está bajo el p10 **y** Δ ≤ −20 pp. |
| `band_concentration_above_sample` | Unidad o curso | El % en la banda inferior supera al de la muestra en ≥ 10 pp. | medium; high con ≥ 20 pp. |
| `item_below_sample` (fase 3) | Ítem | El % de acierto queda ≥ 15 pp bajo el de la muestra. | medium; high con ≥ 25 pp. |

Ejemplo de mensaje: *"Lectura 4°: 54 % de logro, bajo la zona típica de la muestra (58–66 %)"*.

### 9.4 Regla: posición **y** magnitud

Toda alerta relativa exige dos condiciones a la vez:

- **Posición** entre los colegios (bajo el p25 o el p10). Con muchos colegios, la posición sola marca
  siempre al 25 % de ellos aunque las diferencias sean mínimas.
- **Magnitud** del Δ en pp. La magnitud sola ignora la dispersión: −5 pp es mucho en un instrumento
  donde todos los colegios están dentro de 3 pp, y poco donde van de 40 a 80 %.

Juntas escalan bien con la muestra. Hoy, con 2 colegios, el p25 interpolado deja al colegio más bajo
"bajo la zona típica" en cuanto hay cualquier diferencia, y la condición de magnitud es la que evita
alertas triviales. Los umbrales viven en `ALERT_THRESHOLDS.cohort` (`packages/types/src/comparability.ts`),
junto a los actuales.

Las alertas relativas usan sólo la **muestra global** y sólo cuando es válida (cumple k). La red no
dispara alertas: es una comparación identificada para el detalle, no una referencia de severidad.

Los percentiles por nodo salen de `perSkill`, que el read-model ya guarda por colegio.

### 9.5 Relación con las alertas absolutas

- **No se suprimen.** Un resultado bajo es bajo aunque al resto le vaya igual de mal.
- **Se enriquecen con la muestra.** `item_gap` y `band_concentration` muestran el valor de la muestra
  en su tooltip. Cuando la muestra está igual (|Δ| < 5 pp) llevan el rótulo **"Resultado similar en
  la muestra"** con el valor de la muestra, para que se entienda que el resultado fue parecido en todos
  los colegios. **La severidad no cambia** (D6).
- **Se fusionan si coinciden.** Si una misma unidad/contexto dispara la absoluta y la relativa
  (p. ej. `band_concentration` y `band_concentration_above_sample` en el mismo curso), se emite **una**
  alerta con las dos razones y la severidad mayor. Son las más confiables y quedan arriba en el ranking.

Contrato: `DashboardAlert` suma

```ts
basis: 'absolute' | 'internal' | 'cohort';
cohort: {
  sampleValue: number | null;   // % de la muestra en la misma métrica
  schoolCount: number;
  studentCount: number;
  percentile: number | null;    // posición del colegio/curso/nodo
} | null;
```

### 9.6 Implementación

- `ComparableAlertsService.deriveAlerts` suma una fuente `cohortAlerts(units, samples)`: funciones puras
  sobre las unidades (que ya traen los cursos y sus %) y las muestras.
- Las muestras salen del mismo servicio que expone `/benchmarking/samples` (§8.3), extraído como
  `BenchmarkSamplesService`, exportado por `BenchmarkingModule` e importado en `DashboardsModule`. Una
  sola lectura del read-model por request con los `instrumentId` de las unidades. Esa lectura es
  cross-tenant y corre fuera de `withOrgContext`, como hoy en el servicio de benchmarking.
- El controller pasa `includeCohort = canAccess(user.roles, BENCHMARKING_VIEWER_ROLES)`. Sin acceso, no
  se lee la muestra ni se emiten alertas relativas.
- Tests unitarios por tipo, con unidades y muestras construidas a mano, incluido el borde de 2 colegios.

## 10. Plan por fases

| Fase | Alcance | Entregable |
| --- | --- | --- |
| **0 — Base** | `band_counts` en el read-model (migración + refresh), promedio ponderado, contrato `InstrumentSample`, endpoint `/benchmarking/samples`, quitar gating, refresh por org tras la ingesta. | Backend listo; sin UI nueva. |
| **1 — Contrastes principales** | `SampleDeltaChip`, `SampleTooltip`, marca en `DistributionBar`. Vistas: Resumen y Resultados de una evaluación, columna en `CourseComparison`, columna en `ComparableUnitsTable`, delta en trayectoria. Alertas `below_sample` y `class_below_sample` (§9). | El 80 % del valor: el directivo ve el contraste en las dos vistas que más usa. |
| **2 — Habilidades e informes** | Marca en `SkillsBreakdown` (evaluación, dimensiones), informe de curso, clasificación, informe del establecimiento (requiere `instrumentId` por columna de grado). Alertas `skill_below_sample` y `band_concentration_above_sample`; enriquecimiento y fusión de las absolutas (§9.5). | Contraste en el detalle pedagógico. |
| **3 — Ítems** | Read-model por ítem (`benchmark_item_aggregates`: org × ítem → aciertos/total), columna "% muestra" en `SpecTable`, alerta `item_below_sample` y rótulo "Resultado similar en la muestra" en `item_gap`. | Detectar preguntas problemáticas frente al resto. |
| **4 — Vista de detalle** | `/benchmarking` migra a `band_counts` y al nuevo contrato; se retira `band_distribution`. | Una sola fuente para línea y detalle. |

## 11. Cómo sabremos si funciona

- Proporción de sesiones directivas que abren un `SampleTooltip` o hacen click en "Ver comparación".
- Visitas a `/benchmarking` que llegan desde un contraste (vs entrada directa por el menú).
- Cualitativo con CSCJ y San Agustín: ¿entienden sin explicación qué es la muestra y la zona típica?

## 12. Decisiones de diseño (resueltas el 2026-10-05)

| # | Pregunta | Decisión |
| --- | --- | --- |
| D1 | ¿La muestra incluye al propio colegio? | **Sí** (§4): es la semántica de un promedio de referencia y el percentil se calcula dentro de la muestra. |
| D2 | ¿Un colegio con opt-out del pool global puede ver la muestra global? | **Sí, por ahora todos los colegios ven la muestra global.** |
| D3 | ¿Umbral para "≈ muestra"? | 0,5 pp para el chip. Se calibra con datos reales. |
| D4 | ¿Los profesores ven el contraste de sus cursos? | **No, por ahora** (P2). |
| D5 | ¿Mostrar la red como referencia principal cuando existe? | **No**: la global es la principal y la red va en el tooltip y en el detalle (§4). |
| D6 | ¿Cambia la alerta absoluta cuando la muestra está igual? | **La alerta y su severidad no cambian.** Se le agrega el rótulo "Resultado similar en la muestra" con el valor de la muestra (§9.5). |
| D7 | ¿Las alertas relativas usan umbrales o percentiles puros? | **Posición y magnitud juntas** (§9.4). Calibrar con datos reales cuando la muestra tenga ~10 colegios. |
| D8 | ¿Cuándo vuelve `BENCHMARK_K_MIN_SCHOOLS` a 3? | Cuando entre un tercer colegio. Se decide en ese momento; no es parte de esta feature. |

## 13. Fuera de alcance

- Comparar alumnos individuales contra la muestra.
- Filtros de cohorte en línea (dependencia, región, comuna). Siguen disponibles en la vista de detalle.
- Muestras que mezclen instrumentos, años o momentos (prohibido por el principio 1).
- Retirar el sistema de features pagas para el resto de las funcionalidades.
