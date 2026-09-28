# Diseño — El proceso de medición como puerta de entrada

## Resumen

Hoy `/evaluaciones` y `/resultados` abren mostrando todo el año académico vigente, sin jerarquía:
una lista ordenada por fecha y un panorama que no dice por dónde empezar a mirar. Este documento
define tres cambios para que ambas vistas **abran ya respondiendo algo**:

1. El **proceso de medición más reciente con resultados** queda preseleccionado al entrar.
2. `/evaluaciones` ordena por **gravedad** en vez de por fecha.
3. `/resultados` abre con una **banda de previsualización** del proceso: cobertura, alumnos
   evaluados, alertas y las unidades más graves.

Ninguno de los tres inventa una métrica nueva. Los tres se apoyan en la maquinaria de unidades
comparables y alertas que ya existe.

---

## 1. El problema

Un directivo entra a la plataforma el lunes después de cerrar un momento DIA. Lo que quiere saber es
"cómo nos fue en esto que acabamos de rendir". Lo que encuentra:

- En `/evaluaciones`, una lista de todas las evaluaciones del año ordenada por fecha de aplicación.
  La del proceso recién cerrado está arriba sólo por coincidencia cronológica, mezclada con las de
  otros procesos del mismo período.
- En `/resultados`, el panorama completo del año. Correcto, pero sin foco: hay que aplicar tres o
  cuatro filtros para llegar a la pregunta que se traía.

El trabajo de procesos de medición (`docs/diseno-procesos-de-medicion.md`) ya creó la entidad que
agrupa "esto que acabamos de rendir". Falta que las vistas la usen como punto de partida.

---

## 2. ⚠️ Lo que hay que arreglar antes: el filtro de proceso es decorativo en `/evaluaciones`

Esto no es parte de la feature nueva: es un bug vivo, encontrado al diseñarla.

`/evaluaciones` reutiliza la barra de filtros del panorama —importa `DashboardFilterBar`,
`parseDashboardFilters`, `withDefaultAcademicYear` y `buildDashboardQuery` desde
`../resultados/components/` (`apps/web/src/app/(dashboard)/evaluaciones/page.tsx:11-17`). Como
`processId` está en `FILTER_KEYS`
(`apps/web/src/app/(dashboard)/resultados/components/dashboard-filters.ts`), pasa lo siguiente:

1. El selector **"Proceso de medición" se dibuja** en `/evaluaciones`.
2. Al elegir uno, `buildDashboardQuery` lo pone en la querystring.
3. `getEvaluacionesAssessments(query)` lo manda al backend.
4. `assessmentListQuerySchema` (`packages/types/src/schemas/item-analysis.schema.ts:46-56`) **no lo
   declara**, así que el `z.object` lo descarta sin error.
5. `listAssessments` nunca lo aplica.

Resultado: eliges un proceso, la lista no cambia, y nada avisa. Es exactamente la clase de defecto
que el propio schema documenta desde el arreglo de `instrumentId`, en el comentario que encabeza ese
`z.object`:

> Cada filtro nuevo de la barra tiene que declararse acá **Y** aplicarse en `listAssessments`; falta
> una de las dos y el filtro es decorativo.

`processId` es el cuarto caso, después de `applicationPeriod`, `instrumentId` y el que ya se arregló
en `heatmapQuerySchema`. **Se arregla en la Ola 1**, antes de construir nada encima: un default que
apunta a un filtro que no filtra es peor que no tener default.

---

## 3. La tensión de fondo: qué NO puede significar "alarmante"

El pedido original dice que `/evaluaciones` muestre "las evaluaciones con resultados más
alarmantes". La lectura intuitiva —ordenar por peor porcentaje de logro— es precisamente el
antipatrón que este producto ya descartó.

`docs/diseno-panorama-comparable.md` (#1C) eliminó el "% de logro global" porque promediar
instrumentos de distinta dificultad y distinta escala no produce un número interpretable. Un DIA
cuyo Nivel I corta en ~33% y un curso en 55% está bien; con un umbral absoluto de 60 salía alertado
igual. Ese fue el defecto de las alertas `low_achievement` y `critical_skill` originales.

Ordenar una lista de evaluaciones por logro crudo reintroduciría el mismo error, esta vez como
criterio de ordenamiento en lugar de como umbral.

### La definición legítima ya está construida

`packages/types/src/comparability.ts:288-301` fija los umbrales, todos **relativos al instrumento o
a su propio comparable**, nunca absolutos:

| Señal                                             | high  | medium |
| ------------------------------------------------- | ----- | ------ |
| % de alumnos en la banda inferior del instrumento | 40    | 25     |
| Caída en pp contra el baseline comparable         | 10    | 5      |
| Curso bajo el promedio de su propia unidad        | 15 pp | 8 pp   |
| Eje bajo el promedio de su unidad                 | 20 pp | 12 pp  |
| % de acierto de un ítem                           | 20    | 35     |
| Días aplicada sin resultados                      | 14    | —      |

Y `ComparableUnitSummary` (`packages/types/src/schemas/comparable-overview.schema.ts:44-66`) ya trae
por unidad: `severity`, `lowestBandShare`, `averageAchievement` —legítimo, porque no mezcla
instrumentos— y, crucialmente, **`assessmentIds: string[]`**.

Ese es el puente. Cada evaluación hereda la severidad de su unidad comparable, que se calculó con el
corte de su propio instrumento. No hace falta inventar una métrica.

---

## 4. Decisiones de diseño

### D1 — "El último proceso" es el más reciente **con resultados**

No el más reciente a secas.

Un proceso en estado `planned` o `loading` puede ser el más nuevo y no tener una sola fila de
resultados. Preseleccionarlo abriría ambas vistas en blanco — que es exactamente el bug que se
arregló hace poco en `withDefaultAcademicYear`, donde el año vigente inyectado por defecto vaciaba
el panorama de cualquier proceso de un año anterior.

**Criterio:** el proceso de `studentsAssessed > 0` con la ventana más reciente
(`startsOn desc nulls last`), dentro del alcance del usuario. `MeasurementProcessModel` ya expone
`studentsAssessed` (`packages/types/src/schemas/measurement-process.schema.ts:151`).

Si no hay ninguno, **no se preselecciona nada** y las vistas se comportan como hoy. El default nunca
puede ser la causa de una vista vacía.

**Alternativa descartada:** "el proceso del año vigente más reciente". Un colegio que cierra el año
en diciembre y entra en enero vería preseleccionado un proceso del año nuevo, todavía sin datos.

### D2 — El default lo resuelve el backend, junto al catálogo

`/dashboards/filters` ya devuelve `processes: ProcessFilterOption[]` y `defaultAcademicYearId`
(`packages/types/src/schemas/dashboard.schema.ts`). El patrón "el servidor resuelve cuál es el
default y el cliente lo aplica" ya existe y está probado.

Se agrega `defaultProcessId: string | null` a `DashboardFilterOptionsResponse`, resuelto en
`getFilterOptions` con el mismo criterio de alcance que ya acota `processes` (sólo procesos con
evaluaciones en los cursos visibles del usuario).

**Por qué en el backend y no en el cliente:** el cliente tendría que pedir la lista de procesos,
mirar `studentsAssessed` y elegir. Eso es lógica de negocio en el frontend, y además el catálogo de
`processes` que viaja hoy no incluye `studentsAssessed`. Resolverlo en el servidor evita ambas
cosas.

### D3 — El proceso gana sobre el año académico

Ya está implementado: `withDefaultAcademicYear` tiene la guarda `if (value.processId) return value;`
porque un proceso declara su propia ventana y cruzarlo con el año vigente vaciaba la vista.

La regla completa de precedencia al entrar sin filtros en la URL:

```
¿hay defaultProcessId?
├─ sí → se aplica processId; NO se inyecta año (el proceso ya lo acota)
└─ no → se inyecta defaultAcademicYearId, como hoy
```

### D4 — Visible, escapable, y se vuelve a aplicar en cada entrada nueva

Tres propiedades no negociables, heredadas de cómo se comporta hoy el año por defecto:

- **Visible:** el selector muestra el proceso seleccionado. Nunca es un filtro escondido.
- **Escapable:** un clic lo quita y la vista pasa a mostrar todo.
- **Se re-aplica:** si lo quitas, esa navegación queda sin filtro; al volver a entrar desde el menú,
  vuelve a preseleccionarse.

La tercera es la discutible. Se elige por coherencia: es exactamente cómo se comporta
`defaultAcademicYearId` hoy, y tener dos defaults de la misma barra con memorias distintas sería
más confuso que cualquiera de las dos reglas por separado. Queda como **P1** en §9.

### D5 — La gravedad de una evaluación es la severidad de su unidad comparable

`ComparableUnitSummary.assessmentIds` da el mapeo directo. Para cada evaluación de la lista:

```
gravedad(evaluación) = severidad de la unidad comparable que la contiene
orden = severidad desc → alumnos afectados desc → fecha de aplicación desc
```

`compareSeverity` (`packages/types/src/comparability.ts:268`) ya implementa el orden de severidad y
manda las unidades sin severidad al final. Se reutiliza tal cual.

`AssessmentOption` (`item-analysis.schema.ts:62-71`) suma tres campos:

```ts
severity: 'high' | 'medium' | 'low' | null;
lowestBandShare: number | null;
alertCount: number;
```

`null` en severidad significa "no clasificable" —instrumento sin bandas ni baseline—, no "está
bien", y la UI debe decirlo así: sin badge, no con un badge verde.

### D6 — ⚠️ Las evaluaciones sin resultados no entran en este orden, porque no están en la lista

Al diseñar se propuso que "una evaluación aplicada hace más de 14 días sin resultados cargados
ordene como alarmante". **No se puede, sin un cambio mayor de alcance.**

`listAssessments` filtra explícitamente a las evaluaciones que tienen resultados
(`apps/api/src/item-analysis/item-analysis.service.ts:123-128`): un `exists` sobre
`assessment_results` **o** sobre `assessment_item_stats`. El comentario dice por qué: "para que la
matriz nunca salga vacía", y la segunda rama existe para que una evaluación cargada desde un informe
oficial —sin niveles por alumno— no desaparezca de toda la app.

Es decir: las evaluaciones estancadas, que son las más accionables, **hoy son invisibles en
`/evaluaciones`**. Levantar ese filtro cambia el contrato de la vista y de su matriz, y arrastra al
hub de cada evaluación.

**Decisión: fuera de alcance en esta iteración.** El hueco de cobertura ya se cubre por otra vía: la
alerta `stale_assessment` existe, se emite con `contextKind: 'assessment'`
(`apps/api/src/dashboards/comparable-alerts.service.ts:486-489`) y aparece en la banda de alertas de
`/resultados`. La previsualización de §D8 la va a mostrar.

Queda anotado como **P2** en §9.

### D7 — El orden por gravedad es el default, no el único

Se agrega un selector de orden con dos opciones: **Gravedad** (default) y **Fecha de aplicación**.

Sin esto, quien entra buscando "la que aplicamos ayer" pierde el orden cronológico que tiene hoy, y
la vista se vuelve peor para la mitad de los usos. El parámetro viaja en la URL como el resto de los
filtros (`sort=severity|recent`), así que una vista ordenada por fecha es compartible.

### D8 — La banda de previsualización de `/resultados`

Se renderiza sobre la barra de filtros cuando hay un proceso activo — sea por default o elegido a
mano. Reemplaza al aviso actual `ProcessFilterNotice`, que hoy sólo dice "Acotado a: …" y vive
únicamente en la pestaña Resumen.

Contenido, y de dónde sale cada dato:

| Bloque                                   | Origen                                                       |
| ---------------------------------------- | ------------------------------------------------------------ |
| Nombre, tipo, momento, año, estado       | `GET /measurement-processes/:id`                             |
| Ventana de aplicación                    | `startsOn` / `endsOn`                                        |
| Cobertura (celdas completas / esperadas) | `coverage` del mismo modelo                                  |
| Alumnos evaluados · evaluaciones         | `totals` de `comparable-overview`                            |
| Alertas por severidad                    | `alerts` + `alertsTotal` de `comparable-overview`            |
| Las 2-3 unidades más graves              | `units` de `comparable-overview`, ya ordenadas por severidad |
| Enlaces                                  | "Ver el proceso" · "Quitar el filtro"                        |

Las alertas, las unidades y los totales ya viajan en una respuesta que la página pide de todos
modos: `getComparableOverview` está cacheado por-request y el `scopedQuery` es idéntico, así que
esa llamada se deduplica. ⟨corregido al implementar⟩ **La banda sí agrega una query**: el
`GET /measurement-processes/:id` de la cabecera, 11-23 ms medidos. Antes lo pagaba sólo quien
llegaba con `processId` en la URL; ahora, con la preselección, lo paga toda entrada a
`/resultados`.

⚠️ Con un proceso de alcance derivado (`scopeDerived: true`), la cobertura da 100% por construcción
—describe lo ya cargado, no lo que se esperaba rendir—. La banda debe rotularlo, no presentar ese
100% como logro. La tarjeta de proceso ya tiene la frase para reutilizar.

---

## 5. Contrato

### `packages/types`

**`schemas/dashboard.schema.ts`**

```ts
export type DashboardFilterOptionsResponse = {
  // …
  processes: ProcessFilterOption[];
  /** Proceso preseleccionado al entrar sin filtros: el más reciente CON resultados. */
  defaultProcessId: string | null;
  defaultAcademicYearId: string | null;
};
```

**`schemas/item-analysis.schema.ts`**

```ts
export const ASSESSMENT_SORTS = ['severity', 'recent'] as const;

export const assessmentListQuerySchema = z.object({
  // …
  processId: z.string().uuid().optional(),
  sort: z.enum(ASSESSMENT_SORTS).default('severity'),
});

export type AssessmentOption = {
  // …
  severity: 'high' | 'medium' | 'low' | null;
  lowestBandShare: number | null;
  alertCount: number;
};
```

### `apps/api`

- `dashboards.service.ts` → `getFilterOptions` resuelve `defaultProcessId`.
- `item-analysis.service.ts` → `listAssessments` aplica `processId` y resuelve la gravedad.
- Ninguna migración. `assessments.process_id` ya existe desde `0034_public_nitro.sql`.

### `apps/web`

- `dashboard-filters.ts` → `withDefaultProcess(value, defaultProcessId)`, hermana de
  `withDefaultAcademicYear`, aplicada **antes** que ella.
- `dashboard-filter-bar.tsx` → el selector de orden en `/evaluaciones`.
- `resultados/components/process-preview-banner.tsx` _(nuevo)_ → reemplaza a
  `process-filter-notice.tsx`.
- `evaluaciones/components/assessment-list.tsx` → badge de severidad por fila.

---

## 6. Plan de implementación

**Modo de ejecución: autónomo.** Las cuatro olas se construyen seguidas, sin pausa de aprobación
entre una y otra. Cada ola termina con su verificación propia corrida y su exit code leído; si una
falla, se arregla antes de seguir, no se acumula deuda para el final. El corte para consultar al
usuario es únicamente un hallazgo que invalide una decisión del §4 — no el avance de fase.

**Orden fijo.** La Ola 1 es prerrequisito real (un default sobre un filtro que no filtra es peor que
ningún default) y la Ola 4 depende de una medición que no existe todavía (R1). Las Olas 2 y 3 son
independientes entre sí.

### Disciplina de recursos — la restricción que manda

La máquina de desarrollo tiene 8 GB. **Un proceso pesado a la vez**, siempre: nunca dos builds,
typechecks o suites en paralelo, ni míos ni de un subagente. Autonomía no es permiso para saturar la
máquina.

Esto condiciona el uso de subagentes: **no se paraleliza la implementación**. Las cuatro olas se
escriben en un solo worktree, en secuencia, para que los builds queden serializados por
construcción.

### Dónde entran los subagentes, y por qué sólo ahí

Dos, con un trabajo que no compite por CPU con los builds y que mejora el resultado de verdad:

1. **Medición de R1, antes de la Ola 4.** El documento dice que el costo del orden por gravedad hay
   que medirlo con volumen realista antes de construirlo. Es trabajo independiente, de sólo lectura
   sobre la base, y su respuesta decide la implementación (rearmar unidades al vuelo vs. apoyarse en
   `assessment_item_stats`). Corre mientras se escriben las Olas 1-3.
2. **Revisión adversarial del conjunto, antes de abrir la PR.** Un par de ojos que no escribió el
   código, con el encargo explícito de buscar el filtro decorativo número cinco, el default que
   vacía una vista y la consulta O(N²) en el ensamblado.

**No se usan subagentes para** escribir las olas en paralelo (viola la regla de recursos y los
peores bugs aparecen entre tareas de agentes), ni para tareas que cuesta más encargar que hacer.

### Ola 1 — Cerrar el filtro decorativo _(prerrequisito)_

`processId` en `assessmentListQuerySchema` **y** aplicado en `listAssessments`.

**Verificación:** `pnpm --filter @soe/types build` y `--filter @soe/api typecheck` en verde; elegir
un proceso en `/evaluaciones` cambia la lista, y el conteo cuadra contra el `assessmentCount` del
proceso consultado por API.

### Ola 2 — El default

`defaultProcessId` en `getFilterOptions` + `withDefaultProcess` en el cliente, aplicado en las dos
vistas, antes que `withDefaultAcademicYear`.

**Verificación:** entrar a `/evaluaciones` y a `/resultados` sin querystring preselecciona el mismo
proceso, visible en la barra; quitarlo muestra todo; volver a entrar lo repone. El elegido tiene
`studentsAssessed > 0`, contrastado contra la base. Test de servicio: un proceso `planned` sin
resultados **no** puede salir como default.

### Ola 3 — La banda de previsualización

Reemplaza a `ProcessFilterNotice`. Cero queries nuevas: compone datos que la página ya pide.

**Verificación:** con un proceso activo se ve la banda con cobertura, alertas y unidades más graves;
con un proceso de alcance derivado el 100% sale rotulado como derivado, no como logro.

### Ola 4 — El orden por gravedad

Se construye **con la medición de R1 ya en mano**, no antes. Si el costo resulta prohibitivo, la ola
entrega el selector de orden y la severidad por fila apoyándose en el read-model, y se documenta el
desvío en este archivo.

**Verificación:** `/evaluaciones` abre ordenada por gravedad; el selector vuelve a fecha; el orden
viaja en la URL. Latencia de la lista medida antes y después, con el número escrito en la PR.

### Cierre

Una sola PR contra `dev` con las cuatro olas en commits separados, la revisión adversarial aplicada
y este documento actualizado con lo que la realidad haya corregido.

---

## 7. Riesgos

### R1 — El costo del orden por gravedad ⟨medido⟩

Medido contra `soe_dev`, tres corridas por caso:

| Qué                                                    | Costo        |
| ------------------------------------------------------ | ------------ |
| `listAssessments` completo (3 consultas)               | 8,7–12,6 ms  |
| Armado de unidades comparables (11 consultas)          | 20,7–27,5 ms |
| Consulta agregada propia sobre el read-model           | 6,9–9,8 ms   |
| **El endpoint `comparable-overview` de punta a punta** | **182 ms**   |

**El dato que decide:** el SQL completo son 24 ms de 182. **~87% del costo no es la
base**, así que escalar el volumen ×20 mueve los 24 ms, no los 158 restantes. Ordenar por
gravedad es viable y la falta de paginación no es el problema.

Por eso **se descarta la consulta agregada propia** que este documento proponía: ahorra 16 ms
—un 9% del total— a cambio de reimplementar `classifyByBands` en SQL, duplicando la semántica
de clasificación en un segundo lugar. Además no se puede validar: `assessment_level_stats`, el
read-model correcto para severidad, tiene **0 filas** en toda la base.

También cae la sospecha sobre `attachBaselines`: aporta ~2,5 ms de los 24. Lo que domina es
`loadClassGroupBreakdown` (4,1–7,8 ms), que **no alimenta `severity`** — verificado en
`comparable-overview.service.ts:303`, donde `severity` sale sólo de `lowestBandShare`.

⚠️ **Medido a 1/20 del volumen que la pregunta asumía.** `soe_dev` tiene 21 evaluaciones, no
258; las 258 están en el RDS de demo, sin credenciales en el worktree. La medición que decide
de verdad hay que correrla ahí. Y todas estas cifras son **sin RLS**: el rol local es
superusuario con `BYPASSRLS`.

### R1b — ⚠️ Hallazgo fuera de alcance: la política RLS de `assessments` impide todo índice

`packages/db/sql/rls-policies.sql:56` define:

```sql
USING (org_id::text = current_setting('app.current_org_id', true))
```

El cast a texto **del lado de la columna** hace que ningún índice btree sobre
`assessments(org_id)` (uuid) pueda servir la política: seq scan garantizado. Y las políticas de
`assessment_results` y `assessment_item_stats` cuelgan de un `EXISTS` sobre `assessments`, así
que heredan el problema. Es la misma familia que `assessment-academic-year.helper.ts:41-47`
documenta como un 14 s → 0,6 s.

Faltan además índices en `assessments(org_id)`, `student_enrollments(class_group_id)` e
`instruments(org_id, subject_id, type, deleted_at)`.

**No se toca en esta iteración.** Cambiar una política de aislamiento multi-tenant no es un
arreglo de paso dentro de una feature de UI: mercece su propia revisión, y el archivo se
re-aplica en cada `db:migrate`.

### R2 — El default que vacía la vista

Mitigado por D1 (sólo procesos con resultados) y por la guarda de D3. El caso de prueba obligatorio:
un proceso `planned` recién creado **no** debe ser el default.

### R3 — Cobertura derivada al 100%

Los 8 procesos de la base de desarrollo vienen del backfill y son todos `derived: true`, así que la
banda va a mostrar 100% de cobertura en todos. **No es representativo del caso real.** Para revisar
la banda en serio hay que declarar a mano el alcance de un proceso y forzar celdas faltantes.

### R4 — Dos vistas, una barra

`/evaluaciones` y `/resultados` comparten `DashboardFilterBar`. El selector de orden sólo aplica a la
primera: hay que pasarlo por prop y no dibujarlo en el panorama. Un campo que aparece donde no hace
nada es el mismo defecto del §2, en versión visual.

---

## 8. Tests

**Puros (`packages/types`)**

- `compareSeverity` con `null` mezclado: las sin severidad van al final.
- `withDefaultProcess`: no pisa un `processId` explícito; no hace nada con `defaultProcessId` nulo.
- Precedencia: con `defaultProcessId` presente, `withDefaultAcademicYear` no inyecta año.

**Servicio (`apps/api`)**

- `getFilterOptions` elige el proceso más reciente **con** resultados, no el más reciente.
- Sin procesos con resultados → `defaultProcessId: null`.
- `listAssessments` con `processId` devuelve sólo las evaluaciones enlazadas.
- El orden `severity` respeta severidad → alumnos afectados → fecha.
- El alcance docente sigue acotando: un profesor no ve procesos de cursos ajenos.

**Manual**

- La banda con un proceso derivado y con uno de alcance declarado.
- Quitar el default y volver a entrar.

---

## 9. Preguntas abiertas

**P1 — ¿El default se re-aplica o se pega?** D4 elige re-aplicar, por coherencia con el año
académico. La alternativa —que una vez que lo quitas no vuelva— requiere persistir la preferencia
por usuario y convierte dos defaults de la misma barra en dos comportamientos distintos. **Decide el
usuario**; no bloquea nada.

**P2 — ¿Se muestran las evaluaciones sin resultados?** Hoy `listAssessments` las excluye (§D6), así
que las estancadas son invisibles justo en la vista donde más servirían. Levantar ese filtro toca el
contrato de la lista, de su matriz y del hub de evaluación. **Fuera de alcance acá**, pero vale
decidirlo aparte.

**P3 — ¿La banda también en `/evaluaciones`?** §D8 la pone sólo en `/resultados`. Poner la misma
banda en ambas es coherente, pero en una lista de trabajo puede ser ruido. **Recomendación:** no en
esta iteración.

---

## 11. Lo que la realidad corrigió

Registrado al implementar, para que el documento no mienta.

1. **La consulta agregada propia se descartó** tras medirla (§R1): ahorra un 9% del costo real
   del endpoint a cambio de duplicar `classifyByBands` en SQL. La Ola 4 compone los endpoints
   que ya existen y une la lista con las unidades mediante un helper puro en `packages/types`.
   Sigue el mismo criterio que `getComparableAlerts`, que ya documenta por qué no toma atajos
   sobre el armado de unidades.

2. **`withDefaultProcess` no se pudo testear** donde el documento decía (§8).

3. **La guarda "sólo procesos con resultados" no se ejercitó de punta a punta**: en la base de
   desarrollo los 7 procesos visibles tienen resultados, y la única evaluación sin ellos es una
   fixture TEST ya enlazada a otro proceso. Reasignarla habría mutado datos compartidos con
   otras sesiones. La semántica de las dos consultas sí se verificó en SQL.

4. **`sort` no viaja a la API.** El diseño lo ponía en `assessmentListQuerySchema`; como el
   orden se resuelve componiendo endpoints, vive sólo en la URL. La lista no pagina, así que
   ordenar después de traerla es equivalente.

5. **Efecto observado del default en la demo:** `/evaluaciones` pasa de 6 evaluaciones a **1**,
   porque el proceso más reciente (DIA Monitoreo 2026) tiene una sola. Es el diseño funcionando,
   pero muestra que la utilidad del default depende del tamaño del proceso. Con un colegio real
   el proceso más reciente agrupa decenas; con datos de demo el efecto se ve exagerado.
