# Diseño — Buscador por palabras en Evaluaciones y Resultados

> Estado: **propuesta**, sin implementar.
> Ámbito: `packages/types`, `apps/api`, `apps/web`, `packages/db` (solo una sentencia SQL idempotente, sin migración de schema).
> Relacionado: `docs/diseno-procesos-de-medicion.md`, `docs/diseno-panorama-comparable.md`, `.claude/rules/frontend/07-navigation-reactivity.md`.

---

## 1. Resumen

Se agrega un campo de texto libre a la barra de filtros compartida que acota las evaluaciones
visibles a las que **contienen** el término en el nombre de la evaluación o en el nombre del
instrumento, sin distinguir mayúsculas ni tildes.

El término viaja como un filtro más (`?q=…` en la URL), se combina con los filtros existentes con
AND, y se dispara 3 segundos después de dejar de teclear, al presionar Enter o al hacer clic en el
botón de buscar.

Es un cambio pequeño y concentrado: **un** parámetro nuevo en tres schemas Zod, **tres** condiciones
SQL nuevas (una por servicio) y **un** control nuevo en la barra de filtros que ya comparten
`/evaluaciones` y las cinco pestañas de `/resultados`.

---

## 2. Alcance

### Vistas que reciben el buscador

Ambas vistas ya comparten el mismo componente de filtros, `DashboardFilterBar`
(`apps/web/src/app/(dashboard)/resultados/components/dashboard-filter-bar.tsx:30`):

| Vista | Ruta | Endpoint que acota | Schema de query |
|---|---|---|---|
| Evaluaciones | `/evaluaciones` | `GET /item-analysis/assessments` | `assessmentListQuerySchema` |
| Panorama (Resultados) | `/resultados` | `GET /dashboards/comparable-overview` | `comparableOverviewQuerySchema` (= `dashboardFiltersQuerySchema`) |
| Clasificación | `/resultados/clasificacion` | `GET /dashboards/performance` | `dashboardPerformanceQuerySchema` (extiende el anterior) |
| Dimensiones | `/resultados/dimensiones` | `GET /dashboards/skills` | `dashboardFiltersQuerySchema` |
| Mapa de calor | `/resultados/mapa-calor` | `GET /heatmap` | `heatmapQuerySchema` |

Las tres últimas entran **por arrastre**: montan la misma barra de filtros, así que el campo aparece
ahí sí o sí. No son opcionales — si el backend no las soporta, el usuario ve una caja de búsqueda
que no hace nada. Ver D2 y §8 (R3).

### Campos sobre los que se busca

- `assessments.name` (`packages/db/src/schema/assessments.ts:39`) — `text`, **nullable**.
- `instruments.name` (`packages/db/src/schema/instruments.ts:49`) — `text`, `NOT NULL`.

Estos dos, y solo estos dos, son exactamente lo que la lista pinta hoy: `AssessmentList` muestra
`a.name ?? a.instrumentName` como título y `a.instrumentName` como subtítulo
(`apps/web/src/app/(dashboard)/evaluaciones/components/assessment-list.tsx:29` y `:50`), y la matriz
del panorama muestra el nombre del instrumento como etiqueta de la unidad comparable
(`apps/api/src/dashboards/comparable-overview.service.ts:152`). El usuario busca lo que ve.

### Fuera de alcance

- Búsqueda por nombre de alumno, de curso o de asignatura. Eso ya existe en otras vistas
  (`/estudiantes`, el buscador del asistente) y mezclarlo acá haría ambiguo el resultado.
- `instruments.short_name`, `assessments.notes`, contenido de ítems. Ver §10 (P2).
- `/resultados/tablero-maestro` y `/resultados/trayectoria`, que tienen su propia barra
  (`master-board-filters.ts`, `trajectory-scope-bar.tsx`) y su propio contrato de scope.
- Ranking por relevancia. El orden de los resultados no cambia: `/evaluaciones` sigue ordenando por
  `administeredAt desc` (`item-analysis.service.ts:191`) y el panorama por severidad
  (`comparable-overview.service.ts:97`).

---

## 3. Lo que ya existe (y por qué el diseño se apoya en eso)

Antes de proponer nada conviene fijar el terreno, porque la feature casi no necesita mecanismos
nuevos.

**Los filtros ya viven en la URL y el RSC los lee.** `parseDashboardFilters` convierte los
`searchParams` de Next 15 en `DashboardFilterValues`
(`apps/web/src/app/(dashboard)/resultados/components/dashboard-filters.ts:73`) y
`buildDashboardQuery` los vuelve a serializar a querystring para pasárselos a `apiGet`
(`dashboard-filters.ts:206`). Ese módulo no lleva `'use client'` a propósito, para que las páginas
servidor puedan importarlo — está documentado en su propia cabecera (`dashboard-filters.ts:1-7`).

**El control interactivo es un cliente que hace `router.push`.** `DashboardFilterBar` es
`'use client'`, arma la nueva querystring con `URLSearchParams` y empuja dentro de `startTransition`
(`dashboard-filter-bar.tsx:49-69`). Ya borra `page` en cada cambio (`dashboard-filter-bar.tsx:62`) y
ya expone `isPending` a la barra de progreso (`dashboard-filter-bar.tsx:44` y `:253`). Eso es
exactamente lo que pide `.claude/rules/frontend/07-navigation-reactivity.md` en su sección "El trap
del searchParam".

**El backend tiene un único punto donde se acota el conjunto de evaluaciones.**
`DashboardsService.resolveScopedAssessments()`
(`apps/api/src/dashboards/dashboards.service.ts:1581`) es el embudo por el que pasan `getOverview`,
`getPerformance`, `getSkills`, `getSkillBreakdown`, `getTeacherKpis` y
`resolveScopeForComparableOverview`. El filtro `processId` se agregó ahí, en una línea
(`dashboards.service.ts:1602`). El de búsqueda va en el mismo lugar, por la misma razón.

**Ya hay convención de búsqueda por `contiene`.** Seis servicios usan `ilike(col, '%' + q + '%')`:
`item-collections.service.ts:48`, `admin.service.ts:38`, `student-signals.service.ts:160-164`,
`assistant.service.ts:271-326`, `documents.service.ts:51` y `packages/db/src/queries/platform-admins.ts:77`.
Ninguno escapa los metacaracteres de LIKE y ninguno resuelve tildes: son la base de partida, no el
modelo a copiar tal cual (ver D5 y D4).

**Ya hay convención de input de búsqueda en el front.** `SignalsTable` monta un `<form>` con un
`Input` de shadcn, ícono `Search` absoluto y `pl-9`, y empuja el término a la URL dentro de una
transición (`apps/web/src/app/(dashboard)/estudiantes/components/signals-table.tsx:87-106`). El
debounce como tal existe en `apps/web/src/components/assistant/context-picker.tsx:67-82`, con 250 ms.

**Ya hay precedente de "filtro que una pestaña ignora".** `processId` está en
`dashboardFiltersQuerySchema` pero **no** en `assessmentListQuerySchema` ni en `heatmapQuerySchema`:
hoy `/evaluaciones?processId=…` y `/resultados/mapa-calor?processId=…` ignoran ese filtro en
silencio. Es un hallazgo incidental (§10, P5) y la razón por la que este diseño agrega `q` a los
**tres** schemas desde la primera ola.

---

## 4. Decisiones de diseño

### D1 — El parámetro se llama `q`

Dos convenciones conviven en el repo: `q` (`item-collection.schema.ts:17`, `admin.schema.ts:36-40`,
el buscador de contexto del asistente) y `search` (`student-signals.schema.ts:54`). Se elige `q` por
mayoría y por ser el más corto en una URL que ya carga hasta nueve claves de filtro.

*Descartado:* `search` (minoría en la API), `term` y `nombre` (sin precedente).

### D2 — El filtro se aplica en el resolver de evaluaciones, no en cada endpoint

Se agrega **una** condición en cada uno de los tres lugares donde el backend decide qué evaluaciones
entran al alcance:

1. `DashboardsService.resolveScopedAssessments()` (`dashboards.service.ts:1581`) — cubre los ocho
   endpoints de `/dashboards`, incluido `comparable-overview`, que es el que alimenta el panorama.
2. `ItemAnalysisService.listAssessments()` (`item-analysis.service.ts:99`) — cubre `/evaluaciones`.
3. `HeatmapService.buildConditions()` (`heatmap.service.ts:256`) — cubre el mapa de calor, que no
   pasa por el resolver de dashboards.

Los tres ya hacen `innerJoin(instruments, eq(instruments.id, assessments.instrumentId))`, así que la
condición no agrega ningún join.

**`getFilterOptions()` queda intacto a propósito.** Ese método nunca llama a
`resolveScopedAssessments` (`dashboards.service.ts:268-469`): construye los catálogos de asignaturas,
niveles, cursos e instrumentos desde `class_groups` y `assessment_item_stats`. Si el término también
achicara los catálogos, los dropdowns se vaciarían al buscar y el usuario quedaría sin forma de
ajustar los filtros. Que el `q` no llegue ahí es el comportamiento correcto, y sale gratis.

*Descartado:* un endpoint `/search` dedicado. Duplicaría el scoping por rol (`resolveClassGroupScope`,
`buildAssessmentInScopeExists`) que ya está resuelto en estos tres puntos, y obligaría a la UI a
mezclar dos conjuntos de resultados. La búsqueda **es** un filtro, no una vista aparte.

### D3 — Semántica: `contiene`, sobre los dos nombres, con OR

```sql
(unaccent(assessments.name) ILIKE unaccent($1) OR unaccent(instruments.name) ILIKE unaccent($1))
```

`assessments.name` es nullable. En SQL, `NULL ILIKE …` es `NULL`, y `NULL OR TRUE` es `TRUE`: una
evaluación sin nombre propio se encuentra igual por el nombre de su instrumento, que es justo lo que
la UI muestra en ese caso (`assessment-list.tsx:29`). No hace falta `coalesce`.

`ILIKE` ya resuelve las mayúsculas.

*Descartado:* `to_tsvector` / búsqueda full-text. Es prefijo-y-lexema, no subcadena: `to_tsvector`
sobre "Monitoreo Intermedio" **no** encuentra "termedio", y el usuario pidió explícitamente
`contiene`. Además obligaría a elegir configuración de diccionario (`spanish`) y a mantener una
columna `tsvector` con su trigger.

*Descartado:* búsqueda por tokens con AND (que "dia mate" encuentre "DIA Matemática"), al estilo de
`matchesTeacherQuery` (`packages/types/src/utils/teacher-search.ts:33`). Es mejor UX, pero no es lo
que se pidió y cambia la semántica de `contiene` a algo que el usuario no puede predecir desde el
placeholder. Queda anotado en §10 (P3).

### D4 — Las tildes se resuelven con la extensión `unaccent` de PostgreSQL

Los nombres están en español: "Matemática", "Lenguaje y Comunicación", "Diagnóstico". Buscar
"matematica" **debe** encontrar "Matemática".

Hay tres formas de lograrlo y solo una es barata:

| Opción | Cómo | Costo | Veredicto |
|---|---|---|---|
| **A. `unaccent()`** | `unaccent(col) ILIKE unaccent(patrón)` | `CREATE EXTENSION IF NOT EXISTS unaccent` una vez, idempotente. Sin cambio de schema. | **Elegida** |
| B. `translate()` | `translate(lower(col), 'áéíóúü…', 'aeiouu…')` en SQL crudo | Cero DDL, `IMMUTABLE`, pero hay que mantener a mano el mapa de caracteres | Respaldo (ver abajo) |
| C. Normalizar en la app | `normalizeForSearch()` de `teacher-search.ts:10` | **No funciona**: quitarle la tilde al término no se la quita a la columna. Requeriría una columna `name_normalized` denormalizada, con backfill y trigger | Descartada |

La opción C es la trampa obvia y por eso queda escrita: el helper `normalizeForSearch` que ya existe
en `packages/types` sirve para filtrar **en memoria** (el selector de docentes carga los ~80 docentes
y filtra en el cliente); acá el filtrado ocurre en SQL sobre un conjunto que no se trae entero.

Detalles de la opción A:

- `unaccent` está disponible tanto en el Postgres local (14.13, `pg_available_extensions` la lista)
  como en RDS Postgres 17 (`sst.config.ts:105`).
- `CREATE EXTENSION` necesita un rol privilegiado. `db:migrate` ya corre con `DATABASE_ADMIN_URL`
  (`packages/db/src/migrate.ts:18`), que es el rol `soe_admin`, miembro de `rds_superuser`. La API
  (`soe_app`) solo necesita `EXECUTE`, que `PUBLIC` tiene por defecto.
- Se instala `WITH SCHEMA public` y se invoca calificada (`public.unaccent(...)`) para no depender
  del `search_path` de la conexión.
- `unaccent()` es `STABLE`, no `IMMUTABLE`: **no se puede indexar directamente**. Ver D6; a la escala
  actual no importa.

**Respaldo si la extensión no se puede crear en algún entorno:** reemplazar `public.unaccent(x)` por
un helper `sql` compartido que use `translate(x, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiounAEIOUUN')`. Cubre el
español completo, es `IMMUTABLE` y no necesita DDL. Se decide con un solo cambio en el helper de
§6.2, no repartido por tres servicios.

### D5 — El término se escapa antes de entrar al patrón

`%`, `_` y `\` son metacaracteres de `LIKE`/`ILIKE`. Hoy ningún servicio del repo los escapa: si un
usuario escribe `100%` en `/estudiantes`, el `%` actúa como comodín y el resultado es silenciosamente
incorrecto (`student-signals.service.ts:160`). Un `_` suelto hace lo mismo con cualquier carácter.

El helper nuevo escapa en este orden (la barra primero, o se re-escaparían las escapadas):

```
\  →  \\
%  →  \%
_  →  \_
```

`\` es el carácter de escape por defecto de `LIKE` en PostgreSQL con `standard_conforming_strings`
activo (el default desde 9.1), y el patrón viaja como parámetro vinculado, así que no hay
interpolación de string en ningún punto. No hace falta cláusula `ESCAPE`.

El helper vive en `packages/types/src/utils/` porque es lógica pura, testeable y compartible
(CLAUDE.md §3: "si algo puede ir en `packages/`, va en `packages/`"), y porque deja abierta la
migración de los seis `ilike` existentes al mismo helper sin tocar este diseño.

### D6 — Sin índice en la primera ola, con el umbral escrito

`ILIKE '%term%'` no usa un índice B-tree: el comodín inicial lo inhabilita. La pregunta real es si
eso importa acá.

**No, y por un margen amplio.** Datos medidos:

- La BD local de desarrollo tiene **21 evaluaciones** y **59 instrumentos**
  (`select count(*)` sobre `soe_dev`).
- La demo, según el comentario del propio código, tiene **258 evaluaciones de dos años**
  (`dashboard-filters.ts:45`) — el colegio real (CSCJ) con dos años completos de DIA, SAI y PAES
  cargados.
- `assessments` hoy tiene **un solo índice además de la PK**: `idx_assessments_process`
  (`packages/db/src/schema/assessments.ts:54`). `instruments` no tiene ninguno fuera de la PK. Es
  decir: **estas tablas ya se recorren enteras en cada consulta del dashboard**, con o sin búsqueda.

Un seq-scan con `unaccent` + `ILIKE` sobre 258 filas es de microsegundos y queda muy por debajo del
ruido de las consultas de agregación que el panorama ya ejecuta (ver `docs/` y el trabajo de
optimización que bajó ese endpoint de 610 a 24 queries). Agregar infraestructura de índice hoy sería
optimizar lo que no es el cuello de botella.

**Cuándo sí hay que volver:** cuando `assessments` en un tenant supere el orden de **10⁴–10⁵ filas**
(hoy está tres órdenes de magnitud abajo), o cuando `EXPLAIN ANALYZE` muestre que el nodo de filtro
por nombre pesa más que el resto del plan. La receta, para cuando llegue:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION public.immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

CREATE INDEX idx_assessments_name_trgm
  ON assessments USING gin (public.immutable_unaccent(name) gin_trgm_ops);
CREATE INDEX idx_instruments_name_trgm
  ON instruments USING gin (public.immutable_unaccent(name) gin_trgm_ops);
```

El envoltorio `immutable_unaccent` es obligatorio: la firma de un argumento de `unaccent()` es
`STABLE` y PostgreSQL rechaza indexar una expresión no inmutable. La consulta tendría que llamar a
`immutable_unaccent` (no a `unaccent`) para que el planner use el índice. Nada de esto se implementa
ahora; queda documentado para no tener que volver a investigarlo.

*Descartado ahora:* `citext` (resuelve mayúsculas, que `ILIKE` ya resuelve, y no resuelve tildes),
columna materializada `name_search` con trigger (complejidad de sincronización sin beneficio medible
a esta escala).

### D7 — El término es un filtro más, no un modo aparte

Concretamente:

- **Se combina con AND** con año, asignatura, nivel, curso, tipo, momento, instrumento y proceso. No
  hay ninguna decisión que tomar: la condición se `push`ea al mismo array `conditions` que el resto.
- **Viaja en la URL** como `?q=…`. La vista queda compartible por link y sobrevive al refresh y al
  botón "atrás" del navegador, igual que el resto de los filtros.
- **Entra a `FILTER_KEYS`** (`dashboard-filters.ts:29`). Eso, sin escribir una línea más, hace que:
  - `hasActiveFilters()` (`:62`) devuelva `true` cuando hay término → el botón "Limpiar filtros" se
    habilita y el `EmptyState` de `/evaluaciones` usa su copy de "ajusta los filtros";
  - `clearAll()` (`dashboard-filter-bar.tsx:112-120`) lo borre junto con los demás;
  - `buildDashboardQuery()` (`:206`) lo serialice hacia la API.
- **Vuelve a la página 1.** `applyFilters` ya hace `params.delete('page')`
  (`dashboard-filter-bar.tsx:62`), así que si el buscador reutiliza `applyFilters` el reset es gratis.
  Esto importa en `/resultados/clasificacion`, que sí pagina (`PaginationControls`); `/evaluaciones`
  no pagina hoy (`AssessmentListResponse = { data }`, `item-analysis.schema.ts:60`).
- **No entra a `toScalarFilters()`** (`:193`) ni a `dashboardFiltersToAssistantRefs()`
  (`assistant-context.ts:10`). El primero proyecta filtros de selección única para el drill-down; el
  segundo solo traduce filtros que son UUID de entidad. Un texto libre no es ninguna de las dos
  cosas, y ambas funciones lo ignoran sin cambios.

**Sin "chips" de filtros activos.** Hoy no existe ese patrón en la app: `FilterBar` muestra el estado
en los propios controles (el `MultiSelectFilter` lleva un badge con el conteo,
`MultiSelectFilter.tsx:64-68`) y el único aviso estilo banner es `ProcessFilterNotice`, que existe
porque `processId` **no tiene control visible** en la barra. La búsqueda sí tiene control visible: el
input con el término escrito **es** el indicador. Inventar un sistema de chips solo para este filtro
sería incoherente con los otros ocho.

### D8 — Disparo: 3 s de debounce, Enter y botón

Los tres caminos escriben la misma URL y pasan por el mismo `applyFilters`.

**Sobre los 3 segundos.** Lo habitual es 300-500 ms, y el repo ya tiene un debounce de 250 ms
(`context-picker.tsx:81`). Tres segundos es entre seis y doce veces eso, y el riesgo es real: un
campo que no reacciona durante tres segundos se lee como una aplicación colgada, el usuario vuelve a
teclear o recarga, y termina esperando más que si el disparo hubiera sido inmediato.

Dicho eso, **acá hay un argumento genuino a favor del valor alto**, y conviene que quede escrito
porque no es el caso general:

1. La consulta que hay detrás no es barata. En `/resultados`, cada cambio de filtro re-renderiza el
   árbol RSC completo y vuelve a pedir `comparable-overview`, que resuelve unidades comparables,
   bandas, líneas base y alertas (`comparable-overview.service.ts:88-115`). No es un autocomplete
   sobre un índice; es el panorama entero.
2. **Hay dos disparadores explícitos.** Con Enter y un botón "Buscar" disponibles, el debounce deja
   de ser el camino principal y pasa a ser una red de seguridad para quien escribe y se queda
   mirando. Una red de seguridad puede permitirse ser lenta; un disparador principal no.
3. Las conexiones de colegio son el escenario de diseño de este producto. Menos ida y vuelta es
   mejor.

**Decisión: se implementan los 3 s tal como se pidieron**, como una constante única y con nombre:

```ts
export const SEARCH_DEBOUNCE_MS = 3000;
```

en `use-debounced-search.ts`. Bajarlo es un cambio de una línea en un solo archivo.

**Recomendación para revisar después de usarlo:** 800 ms. Es suficiente para no disparar en cada
pausa de tecleo, y queda por debajo del segundo, que es el umbral donde una interfaz deja de
sentirse reactiva. **No se implementa ahora**: queda como nota para medir con uso real.

La condición de disparo por debounce, por Enter y por botón es la misma: el término normalizado debe
tener al menos `MIN_SEARCH_TERM_LENGTH` caracteres (D10) **y** ser distinto del que ya está en la URL.
Lo segundo evita un `router.push` redundante cuando el usuario escribe, borra y vuelve a escribir lo
mismo.

### D9 — Feedback: el `isPending` de la transición no alcanza

Este es el detalle que hace o rompe la experiencia con 3 s.

`useTransition().isPending` solo se enciende cuando se llama a `router.push`, es decir **después** de
que expiren los 3 segundos. Durante esos tres segundos, `isPending` es `false` y la UI no tiene nada
que mostrar. Por eso hace falta un segundo estado, propio del hook:

| Estado | Cuándo | Qué se ve |
|---|---|---|
| `isDebouncing` | desde la primera tecla hasta que expira el temporizador | texto `Se buscará en un momento — Enter para buscar ahora` bajo el input, y el ícono del botón en estado "pendiente" |
| `isPending` (transición) | desde el `router.push` hasta que el RSC devuelve | `TopProgressBar` de la barra de filtros, contenido anterior visible |

Ambos se combinan en la prop que ya existe: `pending={isPending || isDebouncing}` en `FilterBar`
(`FilterBar.tsx:52`, que renderiza `TopProgressBar` en `:82`).

El texto de ayuda se anuncia con `aria-live="polite"` y el input lleva `aria-describedby` apuntando
a él: un lector de pantalla tiene que enterarse de que hay una búsqueda encolada.

### D10 — Mínimo 2 caracteres, máximo 100, y el backend nunca responde 400

- **Mínimo 2** (`MIN_SEARCH_TERM_LENGTH = 2`), igual que `MIN_TEACHER_QUERY_LENGTH`
  (`teacher-search.ts:22`). Con 1 carácter, `%a%` matchea prácticamente todo y el "buscador" deja de
  filtrar.
- **Máximo 100**, igual que `admin.schema.ts:40`. Se **trunca**, no se rechaza.
- **Un término inválido no es un error, es "sin filtro".** El schema Zod transforma en vez de validar:
  vacío, solo espacios o de un carácter → `undefined`. La razón es concreta: si `?q=a` devolviera 400,
  un link pegado o una URL editada a mano tumbaría el dashboard completo, no solo la búsqueda. Es el
  mismo criterio permisivo que ya usa `csvArraySchema` (`common.schema.ts:55-68`), que colapsa un
  array vacío a `undefined` en vez de generar un `in ()` que no matchea.

El front, por su lado, **sí** bloquea el envío por debajo del mínimo y muestra el motivo, para que la
tolerancia del backend nunca se vea como "escribí y no pasó nada".

### D11 — RLS no cambia, pero se deja dicho

Las tres consultas afectadas ya corren dentro de `withOrgContext(db, orgId, tx => …)`:
`item-analysis.service.ts:104`, `dashboards.service.ts:1388` (vía
`resolveScopeForComparableOverview`) y `heatmap.service.ts:96`. Todas usan `tx`, no `this.db`, y
todas conservan el `eq(assessments.orgId, orgId)` explícito. El filtro de texto se suma al array de
condiciones **dentro** de esas transacciones: no abre una consulta nueva, no cambia el contexto y no
puede filtrarse fuera del tenant.

Lo único que hay que vigilar en la implementación es el anti-patrón conocido de CLAUDE.md §14: si
alguien resolviera la búsqueda con una consulta previa "para obtener los ids que matchean" usando
`this.db`, esa consulta correría sin contexto y devolvería 0 filas. **No hay ninguna consulta nueva
en este diseño**; hay condiciones nuevas en consultas existentes.

---

## 5. Contrato

### 5.1 Parámetro

| | |
|---|---|
| Nombre | `q` |
| Tipo en la URL | `string` |
| Tipo tras el parseo | `string \| undefined` (normalizado: `trim`, truncado a 100) |
| Semántica | la evaluación entra si `q` está contenido en `assessments.name` **o** en `instruments.name`, sin distinguir mayúsculas ni tildes |
| Ausente / vacío / < 2 chars | sin filtro (nunca 400) |

### 5.2 Recorrido de una búsqueda

```
Usuario escribe "matematica" en /resultados
  │
  ├─ Enter · botón · o 3 s sin teclear
  │
  ▼
DashboardFilterBar.applyFilters({ q: 'matematica' })     dashboard-filter-bar.tsx:49
  │  URLSearchParams.set('q', …) + delete('page')
  ▼
router.push('/resultados?academicYearId=…&q=matematica') dentro de startTransition
  │
  ▼
ResultadosOverviewPage (RSC)                              resultados/page.tsx:41
  │  parseDashboardFilters(searchParams) → { …, q: 'matematica' }
  │  buildDashboardQuery(filters)        → '?…&q=matematica'
  ▼
apiGet('/dashboards/comparable-overview?…&q=matematica')  resultados/data.ts:19
  │
  ▼
DashboardsController.getComparableOverview                dashboards.controller.ts:38
  │  comparableOverviewQuerySchema.parse(query)
  ▼
ComparableOverviewService → DashboardsService.resolveScopeForComparableOverview
  │  withOrgContext(db, orgId, tx => …)                   dashboards.service.ts:1388
  ▼
resolveScopedAssessments(tx, orgId, query, classGroupIds, scope)
     conditions.push(assessmentNameMatches(query.q))      dashboards.service.ts:1602 (después de processId)
```

El recorrido de `/evaluaciones` es idéntico hasta `apiGet`, y de ahí va a
`ItemAnalysisController.assessments` → `ItemAnalysisService.listAssessments`.

### 5.3 SQL resultante (fragmento)

```sql
WHERE assessments.org_id = $1
  AND instruments.deleted_at IS NULL
  AND ( public.unaccent(assessments.name) ILIKE public.unaccent($2)
     OR public.unaccent(instruments.name) ILIKE public.unaccent($2) )
  AND …                                        -- el resto de los filtros, sin cambios
```

con `$2 = '%matematica%'` (ya escapado).

---

## 6. Cambios por paquete

### 6.1 `packages/types` — el contrato

**`packages/types/src/schemas/common.schema.ts`** *(modificar)*

Agregar, junto a `csvArraySchema` (`:55`) y sus derivados (`:71`, `:74`):

```ts
export const MIN_SEARCH_TERM_LENGTH = 2;
export const MAX_SEARCH_TERM_LENGTH = 100;

export const searchTermSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = (raw ?? '').trim().slice(0, MAX_SEARCH_TERM_LENGTH);
    return trimmed.length >= MIN_SEARCH_TERM_LENGTH ? trimmed : undefined;
  });
```

Acepta también el parámetro repetido (`?q=a&q=b` → `'a'`), igual que `csvArraySchema`, porque
`URLSearchParams` lo permite y Nest lo entrega como array.

**`packages/types/src/schemas/dashboard.schema.ts`** *(modificar, `:27-42`)*

Agregar `q: searchTermSchema` a `dashboardFiltersQuerySchema`, después de `processId` (`:41`).

Se propaga solo a: `dashboardPerformanceQuerySchema` (`:46`), `dashboardSkillBreakdownQuerySchema`
(`:63`) y `comparableOverviewQuerySchema` (`comparable-overview.schema.ts:27`, que es el mismo
objeto). **Y también** a los tool schemas del asistente y del MCP que reusan este schema:
`apps/api/src/assistant/tools/get-dashboard-overview.tool.ts:74`,
`get-dashboard-skills.tool.ts:75`, `list-filter-options.tool.ts:49`,
`apps/api/src/mcp/tools/get-skill-gaps.tool.ts:21` y `get-assessment-overview.tool.ts:22`. Es un
efecto **deseable** (el asistente gana un filtro por nombre), pero hay que verificarlo: esos tools
publican su `inputSchema` hacia el modelo, así que el campo aparece en la descripción de la
herramienta.

**`packages/types/src/schemas/item-analysis.schema.ts`** *(modificar, `:38-45`)*

Agregar `q: searchTermSchema` a `assessmentListQuerySchema`.

**`packages/types/src/schemas/heatmap.schema.ts`** *(modificar, `:20-31`)*

Agregar `q: searchTermSchema` a `heatmapQuerySchema`.

**`packages/types/src/utils/search-term.ts`** *(nuevo)*

```ts
export function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function buildContainsPattern(term: string): string {
  return `%${escapeLikePattern(term)}%`;
}
```

Sin comentarios, según `.claude/rules/backend/02-no-comments.md`.

**`packages/types/src/utils/index.ts`** *(modificar)* — `export * from './search-term';`, junto a
`./teacher-search` (`:24`).

### 6.2 `apps/api` — el filtro

**`apps/api/src/common/helpers/assessment-name-search.helper.ts`** *(nuevo)*

Un solo lugar donde vive la expresión SQL, para que el respaldo de D4 (`translate()` en vez de
`unaccent()`) se cambie una vez y no tres:

```ts
import { sql, type SQL } from 'drizzle-orm';
import { assessments, instruments } from '@soe/db';
import { buildContainsPattern } from '@soe/types';

export function assessmentNameMatches(term: string): SQL {
  const pattern = buildContainsPattern(term);
  return sql`(public.unaccent(${assessments.name}) ilike public.unaccent(${pattern}) or public.unaccent(${instruments.name}) ilike public.unaccent(${pattern}))`;
}
```

`${pattern}` es un valor JS dentro de un template `sql` de Drizzle: se emite como parámetro
vinculado, no interpolado. Ubicación coherente con el resto de helpers compartidos entre módulos
(`apps/api/src/common/helpers/`, donde ya viven `cohort-level-stats.helper.ts` y los helpers de
alcance docente).

**`apps/api/src/dashboards/dashboards.service.ts`** *(modificar)*

En `resolveScopedAssessments` (`:1581`), justo después de la línea de `processId` (`:1602`):

```ts
if (query.q) conditions.push(assessmentNameMatches(query.q));
```

**`apps/api/src/item-analysis/item-analysis.service.ts`** *(modificar)*

En `listAssessments`, dentro del bloque de filtros (`:131-148`), después de `academicYearId`:

```ts
if (query.q) conditions.push(assessmentNameMatches(query.q));
```

**`apps/api/src/heatmap/heatmap.service.ts`** *(modificar)*

En `buildConditions` (`:256`), después del bloque de `applicationPeriod` (`:280-284`):

```ts
if (query.q) conditions.push(assessmentNameMatches(query.q));
```

Nada más. No hay controller que tocar: los tres ya hacen `schema.parse(query)` y pasan el DTO
completo al service.

### 6.3 `apps/web` — el control

**`apps/web/src/app/(dashboard)/resultados/components/dashboard-filters.ts`** *(modificar)*

1. `DashboardFilterValues` (`:11-26`): agregar `q?: string;`.
2. `FILTER_KEYS` (`:29-39`): agregar `'q'`.
3. `parseDashboardFilters` (`:73-101`): agregar `q: pick('q')?.trim().slice(0, 100) || undefined` al
   objeto de retorno. `pick` (`:76`) ya resuelve el caso de parámetro repetido y el de string vacío.

`buildDashboardQuery` (`:206`) no necesita cambios: itera `FILTER_KEYS` y trata los escalares con la
rama `else if (v)`.

`hasActiveFilters`, `clearAll`, el reset de `page`, la persistencia en la URL, el `ListSearchMemory`
que recuerda la querystring de cada listado (`components/shared/list-search-memory.tsx:53`) y el
enlace de vuelta desde el detalle: todo eso funciona sin tocar nada más, porque leen `FILTER_KEYS` o
la querystring completa.

**`apps/web/src/app/(dashboard)/resultados/components/use-debounced-search.ts`** *(nuevo,
`'use client'`)*

```ts
export const SEARCH_DEBOUNCE_MS = 3000;
```

Hook `useDebouncedSearch({ initialTerm, minLength, onSubmit })` que devuelve
`{ term, setTerm, submitNow, reset, isDebouncing, isTooShort }`:

- `setTerm` guarda el valor y (re)arma un `setTimeout` de `SEARCH_DEBOUNCE_MS`; al expirar llama a
  `onSubmit(term)` si `term` difiere de `initialTerm` y cumple el mínimo.
- `submitNow` cancela el temporizador y llama a `onSubmit` de inmediato. Lo usan Enter y el botón.
- `reset` limpia el término local. Lo llama `clearAll`.
- `useEffect` de limpieza con `clearTimeout` al desmontar y al cambiar el término, igual que
  `context-picker.tsx:82`.
- Un `useEffect` que sincroniza el estado local cuando `initialTerm` cambia desde afuera (el usuario
  navega hacia atrás, o pega una URL con `?q=`). `DashboardFilterBar` **no se desmonta** en un cambio
  de searchParams, así que sin esta sincronización el input mostraría el término viejo.

Archivo aparte, y no dentro de `dashboard-filters.ts`, porque ese módulo tiene que seguir siendo
importable desde Server Components (`dashboard-filters.ts:1-7`).

**`apps/web/src/app/(dashboard)/resultados/components/dashboard-filter-bar.tsx`** *(modificar)*

1. Instanciar el hook con `initialTerm: value.q ?? ''` y `onSubmit: (t) => applyFilters({ q: t || null })`.
   `applyFilters` (`:49`) ya borra `page` y ya envuelve el push en `startTransition`.
2. Agregar un `FilterField` de tipo `CustomFilterField` (`FilterBar.tsx:38`) al principio del array
   `fields` (`:159`), con `key: 'q'`, `label: 'Buscar'` y un `control` que sea:

   ```
   <form role="search" onSubmit={e => { e.preventDefault(); submitNow(); }}>
     <Search … />            ícono absoluto, mismo patrón que signals-table.tsx:95-98
     <Input value={term} onChange={…} placeholder="Nombre de evaluación o instrumento"
            className="pl-9 pr-9 bg-card" aria-label="Buscar evaluación o instrumento"
            aria-describedby={hintId} />
     <Button type="submit" size="icon" variant="ghost" disabled={isTooShort}>…</Button>
     <p id={hintId} aria-live="polite" className="text-xs text-muted-foreground">…</p>
   </form>
   ```

   Solo tokens (`text-muted-foreground`, `bg-card`, `text-destructive`), nunca escalas crudas, según
   `AGENTS.md` §4 y `.claude/rules/frontend/02-ui-conventions.md`.
3. `pending={isPending || isDebouncing}` en el `<FilterBar>` (`:253`).
4. En `clearAll` (`:112-120`): llamar también a `reset()` del hook, o el input quedaría con texto
   mientras la URL ya no tiene `q`.

Al vivir dentro de `DashboardFilterBar`, el buscador aparece **a la vez** en `/evaluaciones` y en las
cinco pestañas de `/resultados`, sin tocar ninguna de las seis páginas.

**`apps/web/src/app/(dashboard)/evaluaciones/page.tsx`** *(modificar, `:83-105`)*

El `EmptyState` actual dice "Ajusta los filtros o importa los resultados…". Cuando hay término, el
mensaje tiene que nombrarlo y ofrecer la salida:

- Título: `Ninguna evaluación coincide con «{q}»`.
- Descripción: menciona que la búsqueda también está acotada por los demás filtros.
- Acción: un `Link` a `${ROUTES.evaluaciones}${buildDashboardQuery({ ...filters, q: undefined })}`
  ("Quitar la búsqueda").
- **Segunda salida, importante:** si además `academicYearId` está puesto (lo pone
  `withDefaultAcademicYear` por defecto, `dashboard-filters.ts:53`), ofrecer
  `Buscar en todos los períodos`, que quita `academicYearId`. Sin esto, buscar "Diagnóstico 2025"
  parado en 2026 devuelve vacío y el usuario no tiene forma de saber por qué. Ver §8 (R1).

**`apps/web/src/app/(dashboard)/resultados/components/comparable-units-table.tsx`** *(modificar,
`:90-95`)*

Mismo problema: hoy el vacío dice "Aún no hay evaluaciones con resultados", que es falso cuando fue
la búsqueda la que vació la tabla. Recibir una prop opcional (`searchTerm` o el `hasActiveFilters` ya
calculado) y cambiar el copy a `Ninguna evaluación coincide con la búsqueda` con el mismo enlace de
salida.

### 6.4 `packages/db` — la extensión

**No hay cambio de schema Drizzle y no hay migración generada.** Solo se necesita que `unaccent`
exista.

**`packages/db/sql/search-extensions.sql`** *(nuevo)*

```sql
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
```

**`packages/db/src/migrate.ts`** *(modificar, `:30-32`)*

Aplicarlo igual que `rls-policies.sql`: leerlo y ejecutarlo tras `migrate()`, de forma idempotente.
Esto sigue el patrón ya establecido para el SQL que Drizzle no genera
(`migrate.ts:10-13`), y garantiza que sobreviva a cualquier `db:generate` o aplanamiento de
migraciones — exactamente el accidente que le pasó al RLS en el commit `53aa242`.

Ponerlo **antes** de las políticas RLS: es un `CREATE EXTENSION`, más básico, y no depende de nada.

**`packages/db/README.md`** *(modificar)* — una línea en la sección de SQL fuera de Drizzle, diciendo
que `search-extensions.sql` también se re-aplica en cada `db:migrate`.

### 6.5 Conteo

| Paquete | Modificados | Nuevos |
|---|---|---|
| `packages/types` | 5 (`common.schema`, `dashboard.schema`, `item-analysis.schema`, `heatmap.schema`, `utils/index`) | 2 (`utils/search-term.ts` + su `.spec.ts`) |
| `apps/api` | 3 servicios + 3 specs | 1 helper |
| `apps/web` | 4 | 1 hook |
| `packages/db` | 2 | 1 `.sql` |
| **Total** | **17** | **5** |

---

## 7. Plan de implementación en olas

### Ola 1 — Contrato y backend (`packages/types` + `apps/api` + `packages/db`)

`searchTermSchema`, `search-term.ts`, el `q` en los tres schemas, `search-extensions.sql` +
`migrate.ts`, el helper `assessmentNameMatches` y las tres condiciones.

**Verificación al cerrar la ola**, sin frontend:

```bash
psql "$DATABASE_URL" -c "select public.unaccent('Matemática');"          # → Matematica
curl -H "Authorization: Bearer …" '…/api/item-analysis/assessments?q=matematica'
curl -H "Authorization: Bearer …" '…/api/dashboards/comparable-overview?q=matematica'
curl -H "Authorization: Bearer …" '…/api/heatmap?q=matematica'
curl -H "Authorization: Bearer …" '…/api/dashboards/comparable-overview?q=a'     # → sin filtro, 200
curl -H "Authorization: Bearer …" '…/api/item-analysis/assessments?q=100%25'     # → 200, 0 o N filas, nunca todas
```

Las tres primeras deben devolver un subconjunto estricto de lo que devuelven sin `q`, y deben
encontrar "Matemática" con y sin tilde. La quinta prueba que un término corto degrada a "sin filtro"
en vez de a 400. La sexta prueba el escape de `%`.

Los tests unitarios (§9) corren **en el CI**, no en local: la suite de `apps/api` tarda ~27 min y
esta máquina tiene 8 GB.

### Ola 2 — El control (`apps/web`)

`use-debounced-search.ts`, el campo en `DashboardFilterBar`, `q` en `DashboardFilterValues` /
`FILTER_KEYS` / `parseDashboardFilters`.

**Verificación:** en `/evaluaciones` y en `/resultados`, escribir y (a) esperar 3 s, (b) presionar
Enter, (c) hacer clic en el botón: los tres producen la misma URL con `?q=`. La URL sobrevive a un
refresh y a "atrás". "Limpiar filtros" vacía el input **y** la URL. En `/resultados/clasificacion`,
buscar estando en la página 3 devuelve a la página 1. Durante los 3 s se ve el texto de pendiente;
tras el push, la `TopProgressBar`.

### Ola 3 — Los vacíos

Copy de `EmptyState` en `/evaluaciones` y en `ComparableUnitsTable`, con los enlaces de salida
("Quitar la búsqueda" y "Buscar en todos los períodos").

**Verificación:** buscar un término imposible (`zzzz`) en ambas vistas; el mensaje nombra el término
y los dos enlaces devuelven resultados.

---

## 8. Riesgos y casos borde

**R1 — El año académico por defecto se come las búsquedas históricas.** `withDefaultAcademicYear`
(`dashboard-filters.ts:53`) acota al año vigente cuando la URL no pide uno. Buscar "Diagnóstico 2025"
estando en 2026 devuelve cero y no hay nada en pantalla que lo explique. *Mitigación:* el enlace
"Buscar en todos los períodos" del `EmptyState` (§6.3). No se cambia el comportamiento por defecto:
hacerlo rompería la coherencia con el resto de los filtros y traería de vuelta las 258 evaluaciones
de dos años que ese default vino a acotar.

**R2 — `%` y `_` del usuario.** Resuelto en D5. Sin el escape, "100%" devolvería todo. Es el riesgo
más concreto y el más fácil de olvidar.

**R3 — Una pestaña que muestre el buscador y lo ignore.** Pasa hoy con `processId` en
`/evaluaciones` y en `/resultados/mapa-calor` (§10, P5), pero ahí es invisible porque `processId` no
tiene control en la barra. Con `q` sería visible y se leería como un bug. *Mitigación:* los tres
schemas se modifican en la **misma** ola 1; ninguno queda atrás.

**R4 — La extensión `unaccent` no se puede crear.** Si algún entorno corriera `db:migrate` con un rol
sin privilegio de `CREATE EXTENSION`, la migración fallaría entera. *Mitigación:* `migrate.ts` ya usa
`DATABASE_ADMIN_URL` (`:18`); si aun así fallara, el respaldo de D4 (`translate()`) se activa
cambiando **un** archivo, `assessment-name-search.helper.ts`.

**R5 — Término solo con espacios o vacío.** `searchTermSchema` lo colapsa a `undefined` y el front no
lo envía. Borrar el input y presionar Enter borra `q` de la URL (porque `applyFilters` recibe `null`)
— eso es lo correcto: es la forma natural de "quitar la búsqueda".

**R6 — Un carácter.** El botón queda deshabilitado y el texto de ayuda dice `Escribe al menos 2
caracteres`. Si llega igual por URL, el backend lo ignora.

**R7 — Término muy largo.** Se trunca a 100 en el schema y en `parseDashboardFilters`. Un `q` de 10 KB
pegado en la URL no llega a la base.

**R8 — Paginación.** `/resultados/clasificacion` pagina; `applyFilters` ya borra `page`
(`dashboard-filter-bar.tsx:62`). `/evaluaciones` **no pagina hoy**: `listAssessments` devuelve
`{ data }` sin `total/page/limit` (`item-analysis.schema.ts:60`). Eso es deuda previa y no cambia
acá, pero conviene saber que la búsqueda vuelve esa lista más útil justo porque no está paginada.

**R9 — El input pierde el texto.** `DashboardFilterBar` no se desmonta al cambiar searchParams, así
que el estado local sobrevive al push. El `useEffect` de sincronización con `initialTerm` cubre el
caso inverso (navegación "atrás", URL pegada). Sin él, el input y la URL se desincronizan.

**R10 — Doble disparo.** Si el usuario presiona Enter a los 2,9 s, el temporizador tiene que
cancelarse en `submitNow`, o se dispararían dos `router.push` con el mismo término. El guard
"distinto del término ya en la URL" es la segunda red.

**R11 — Contrato de tools del asistente y del MCP.** `dashboardFiltersQuerySchema` es el `inputSchema`
de cinco herramientas (§6.1). Agregarle `q` cambia lo que esas herramientas le ofrecen al modelo. Es
deseable, pero hay que verificar que ninguna de ellas pase el DTO a un servicio que **no** aplique el
filtro, o el modelo creería estar filtrando sin filtrar. `get-skill-gaps` y `get-assessment-overview`
van a `DashboardsService`, que sí lo aplica; conviene revisar `list-filter-options`, que va a
`getFilterOptions` — y ese, por diseño (D2), lo ignora.

---

## 9. Tests propuestos

### `packages/types` (corren en el CI en cada PR)

`packages/types/src/utils/search-term.spec.ts`:

- `escapeLikePattern` escapa `%`, `_` y `\`, y escapa la barra **antes** que el resto
  (`'50%_a\\b'` → `'50\\%\\_a\\\\b'`).
- `buildContainsPattern` envuelve en `%…%` el término ya escapado.
- Un término sin metacaracteres pasa intacto.

`packages/types/src/schemas/common.schema.spec.ts` (o dentro del spec del schema que lo use):

- `searchTermSchema`: `undefined` → `undefined`; `'  '` → `undefined`; `'a'` → `undefined`;
  `'ab'` → `'ab'`; `'  hola  '` → `'hola'`; 150 caracteres → 100; `['a','b']` → `undefined` (el
  primero no llega al mínimo); `['matematica','x']` → `'matematica'`.
- Ninguno de esos casos lanza.

### `apps/api` (fake `Database`, según `.claude/rules/backend/01-testing.md`)

`apps/api/src/dashboards/dashboards.service.spec.ts` — el patrón acá es afirmar sobre las condiciones
que el servicio construye (hay precedente en
`curriculum-retriever/structured-curriculum-retriever.spec.ts`, que mockea los predicate builders de
`drizzle-orm`):

- Con `q` presente, `resolveScopedAssessments` agrega **una** condición más que sin `q`.
- Con `q` ausente, el conjunto de condiciones es idéntico al actual (regresión: ninguna consulta
  existente cambia).
- Con `q: '  '` (que el schema ya colapsó a `undefined`), no se agrega condición.

`apps/api/src/item-analysis/item-analysis.service.spec.ts` y
`apps/api/src/heatmap/heatmap.service.spec.ts` — lo mismo en `listAssessments` y en
`buildConditions`. El spec del heatmap ya vigila el **número** de `select` por corrida
(`__selectIdx`): confirmar que el filtro no agrega viajes a la base.

### `apps/web`

`use-debounced-search.spec.ts` (React Testing Library + timers falsos), si se decide cubrirlo:

- Tres teclas seguidas producen **un** solo `onSubmit`, a los 3000 ms de la última.
- `submitNow` dispara de inmediato y **cancela** el temporizador (no hay segundo `onSubmit`).
- Un término por debajo del mínimo nunca llama a `onSubmit`.
- Un término igual al `initialTerm` nunca llama a `onSubmit`.
- Al desmontar, el temporizador se limpia.

### Verificación manual (no automatizable barato)

Contra la demo, con datos reales: `q=matematica` encuentra las evaluaciones de "Matemática";
`q=MATEMÁTICA` devuelve exactamente lo mismo; `q=100%` no devuelve el catálogo entero; `q=xyz` deja
las dos vistas en su `EmptyState` nuevo; la URL con `?q=` se puede pegar en otra pestaña y reproduce
la vista.

---

## 10. Preguntas abiertas

**P1 — ¿3 s o 800 ms?** El diseño implementa 3 s como se pidió y deja la constante aislada. La
recomendación es revisarlo después de usarlo una semana. **Decide el usuario**; no bloquea nada.

**P2 — ¿Se busca también en `instruments.short_name`?** Hoy no se muestra en ninguna de las dos
vistas, pero los nombres cortos del DIA ("DIA M1 6°") son lo que un profesor podría escribir. Agregar
una tercera rama al `OR` cuesta una línea en `assessment-name-search.helper.ts`. **Recomendación:**
no en la ola 1; decidir con uso real.

**P3 — ¿Subcadena o tokens?** `contiene` estricto significa que "dia matematica" **no** encuentra
"DIA de Matemática" (por el "de" intermedio). La alternativa por tokens ya está implementada y
testeada en `packages/types/src/utils/teacher-search.ts:33`. **Recomendación:** empezar con
`contiene`, que es lo pedido, y medir si aparece la queja.

**P4 — ¿El término también debería acotar el catálogo de instrumentos del dropdown?** Hoy no (D2). Si
se quisiera, habría que llevar `q` a `getFilterOptions`, con el riesgo de que el usuario se quede sin
controles para salir de su propia búsqueda. **Recomendación:** no.

**P5 — Hallazgo incidental: `processId` no llega a dos vistas.** `assessmentListQuerySchema`
(`item-analysis.schema.ts:38`) y `heatmapQuerySchema` (`heatmap.schema.ts:20`) no declaran
`processId`, así que `/evaluaciones` y `/resultados/mapa-calor` **ignoran en silencio** el filtro de
proceso de medición, aunque la página de evaluaciones se lo pasa en la querystring
(`evaluaciones/page.tsx:35`). No es parte de esta feature, pero se arregla en los mismos dos archivos
y con la misma forma que `q` (dos líneas de schema + dos condiciones). **¿Se aprovecha el viaje?**
