# Diseño — Vista 360 del Estudiante (zoom progresivo)

> **Qué es esto:** el diseño detallado del ítem **#2B** de `docs/roadmap-producto.md`. Define el
> modelo de **zoom progresivo** sobre los datos de un alumno (panorama por asignatura → historial de
> evaluaciones → ejes/habilidades/OAs → detalle de respuestas), los filtros y pre-filtros de alerta
> que lo gobiernan, y la frontera de comparabilidad que impide volver a mezclar peras con manzanas.
>
> **Fecha:** 2026-08-04 · **Rama:** `roadmap-producto-pendientes` · **Depende de:** la **Ola 0 de
> #1C/#2** (resolver de comparabilidad — diseño cerrado en `docs/diseno-panorama-comparable.md`,
> worktree `.claude/worktrees/panorama-comparable`) y de la **bandeja de #3B** para las alertas.
>
> **Principio que lo rige:** [comparar peras con peras](./roadmap-producto.md#principio-rector-comparar-peras-con-peras).

---

## 1. Diagnóstico: por qué la vista actual no sirve como base

La vista de hoy (`estudiantes/[studentId]/page.tsx` + `student-panorama.service.ts`) es un volcado
cronológico de `assessment_results` con tres agregados que promedian sobre instrumentos no
comparables. Antes de agregar capas hay que reparar la base: **dos de sus tres KPIs están
silenciosamente rotos para la mayoría de los datos de la org demo.**

### 1.1 Defectos verificables

| #      | Defecto                                                                 | Dónde                                 | Efecto                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1** | El promedio de logro ignora los informes agregados                      | `student-panorama.service.ts:273-279` | `official-report-import.service.ts:246-262` escribe filas con `percentage NULL` y sólo la banda. El promedio filtra esos nulos pero `assessmentsCount` los cuenta: "8 evaluaciones · 72% de logro" donde el 72% es de 3 de esas 8. **Es el mismo bug que `f97cb0e` arregló en dashboards** ("en la org demo eran 24 de 40 evaluaciones agregadas"); la corrección no se propagó acá. |
| **D2** | La distribución por nivel descarta justo las filas que traen nivel real | `student-panorama.service.ts:259`     | `if (!a.performanceLevel) continue;` — las filas de informe agregado tienen `performanceLevel NULL` y el nivel en `performanceBandId`. Para un alumno cuyo historial viene de informes oficiales, la barra sale en cero.                                                                                                                                                             |
| **D3** | La página muestra **dos vocabularios de nivel a la vez**                | `page.tsx:126` vs `page.tsx:155`      | La `DistributionBar` usa el enum legacy `Insuficiente/Elemental/Adecuado/Avanzado` (deprecated, `results.ts:94-97`) mientras la tabla pinta la banda real del instrumento (`Nivel I/II/III` del DIA).                                                                                                                                                                                |
| **D4** | Promedia porcentajes entre evaluaciones sin ponderar                    | `student-panorama.service.ts:214`     | `avg(skill_results.percentage)` da el mismo peso a una habilidad medida con 3 ítems y a otra con 12. El repo ya documenta por qué está mal (`results.ts:139-145`: _"⚠️ Guarda CONTEOS ENTEROS, nunca porcentajes"_).                                                                                                                                                                 |
| **D5** | Cero frontera de comparabilidad                                         | `student-panorama.service.ts:174-181` | Trae **todo el historial desde siempre**: el promedio de un alumno de 8° incluye su prueba de 4°, la barra mezcla Lenguaje con Ciencias, y el gráfico (`panorama-trajectory.tsx:18-25`) dibuja **una sola línea** que salta entre instrumentos heterogéneos ordenados por fecha. Una bajada en esa línea no distingue "aprendió menos" de "la prueba era más difícil".               |
| **D6** | La ficha es un callejón sin salida                                      | `page.tsx`                            | El **único** `<Link>` de toda la página es "Volver a estudiantes" (`page.tsx:54`). Ninguna fila de la tabla de evaluaciones enlaza a ninguna parte, aunque el detalle exista (ver §4).                                                                                                                                                                                               |
| **D7** | La cabecera miente sobre el encuadre                                    | `student-panorama.service.ts:113-127` | Muestra el curso de la matrícula **más reciente** mientras los datos de abajo abarcan todos los años.                                                                                                                                                                                                                                                                                |
| **D8** | El endpoint no acepta ningún parámetro                                  | `student-panorama.controller.ts:25`   | Sólo el `:id`. No hay filtros posibles, ni en la API ni en la UI.                                                                                                                                                                                                                                                                                                                    |

### 1.2 Consecuencia de producto

No hay **ninguna puerta de entrada por alerta**. Para descubrir que un alumno está mal hay que ya
sospechar de él, elegir su curso y buscarlo por nombre (`student-picker.tsx:54-61`); el roster no
muestra ni un solo dato de desempeño. Un director con 1.300 alumnos no puede preguntar _"¿quién
necesita atención?"_ — sólo puede verificar sospechas que ya traía.

---

## 2. La frontera de comparabilidad — se **consume**, no se redefine

> ⚠️ **Esta vista NO define qué es comparable.** La definición operativa ya está **cerrada** en el
> diseño de #1C + #2 (`docs/diseno-panorama-comparable.md`, worktree
> `.claude/worktrees/panorama-comparable`, rama `feat/panorama-comparable`). Su Ola 0 crea
> `packages/types/src/comparability.ts` + `apps/api/src/dashboards/comparability.service.ts` como
> **fuente única compartida api ↔ web**. La vista 360 es un **consumidor** de ese resolver.
> Redefinirla acá sería crear la segunda definición de "comparable" del producto.

Recordatorio del modelo que se consume (los cuatro niveles de aquel diseño, §2.1):

| Nivel                      | Clave                                                         | ¿Promediable en un número? |
| -------------------------- | ------------------------------------------------------------- | -------------------------- |
| **N0 — Aplicación**        | `assessmentId`                                                | ✅ Sí                      |
| **N1 — Instrumento**       | `instrumentId`                                                | ✅ Sí                      |
| **N2 — Familia**           | `(type, subjectId, gradeId, applicationPeriod)`, varía `year` | ❌ Punto a punto           |
| **N3 — Serie de momentos** | `(type, subjectId, gradeId, year)`, varía `applicationPeriod` | ❌ Trayectoria             |

Lo que no cae en N0–N3 es **mixto**: no se agrega ni se compara, se **desglosa**.

**Cómo lo usa la vista 360:**

- La **trayectoria intra-año** del alumno (Dg → Int → Cierre) es una serie **N3**.
- La **comparación año a año** del mismo estándar es **N2**.
- Los números únicos del alumno (logro, banda) sólo se emiten en **N0/N1** — es decir, por
  evaluación o por instrumento, nunca sobre su historial completo.
- Lo mixto se lista como "otras evaluaciones", visible y sin agregarse a nada.

**Baseline que falta pedir:** aquel diseño ya cataloga `previous_year`, `previous_period` y
`org_same_instrument` (§2.3). La vista 360 necesita **uno más — el alumno contra su curso en el
mismo `instrumentId`** (`class_same_instrument`). Hay que agregarlo a ese catálogo, no inventarlo
acá.

**Tercera señal, ya persistida y hoy desperdiciada:** `assessment_results.priorPerformanceBandId`
(`results.ts:89-93`) guarda el nivel previo del alumno que trae el informe de Cierre. Ese
`priorBand → band` **ya se renderiza** en el informe de curso (`course-report.service.ts:627-669`,
`course-report.tsx:67-70`) pero la ficha del alumno lo ignora. Es movimiento comparable certificado
por la fuente oficial, a costo cero.

---

## 3. El modelo de zoom

La idea que ordena el rediseño: **el filtro _es_ el zoom**. No hay cinco pantallas distintas — hay
**un solo modelo de filtro que se va estrechando**, y cada nivel de estrechez desbloquea una lectura
más profunda. El breadcrumb _es_ el estado del filtro, y al hacer clic hacia atrás se ensancha.

```
Z0  LISTA CON SEÑAL          ¿quién necesita atención?
    org / curso · chips de alerta                        [entrada — hoy no existe]
     │  clic en alumno
     ▼
Z1  PANORAMA POR ASIGNATURA  ¿en qué está mal este alumno?
    1 tarjeta por asignatura · banda actual · movimiento · brecha vs curso
     │  clic en asignatura                               [nuevo]
     ▼
Z2  HISTORIAL DE LA ASIGNATURA  ¿cómo se movió en el tiempo?
    serie comparable (Dg→Int→Cierre / año a año) + evaluaciones de esa asignatura
     │  clic en un eje/habilidad  ó  clic en una evaluación
     ▼                                                   [nuevo]
Z3  EJES → HABILIDADES → OAs  ¿qué específicamente no domina?
    árbol taxonómico con logro por nodo, dentro de la unidad comparable
     │  clic en un OA / en una evaluación                [restructurar: el dato ya existe]
     ▼
Z4  DETALLE DE RESPUESTAS     ¿qué preguntas falló y qué marcó?
    ítem por ítem: alternativa elegida vs correcta, OA/eje/habilidad del ítem
                                                          [YA EXISTE — sólo falta enlazarlo]
```

### 3.1 Estado del filtro

Un único objeto que viaja en la URL y se estrecha nivel a nivel:

```ts
type Zoom360 = {
  studentId: string;
  subjectId?: string; // Z1 → Z2
  instrumentType?: string; // Z2 (acota la serie)
  year?: number; // Z2 (default: año vigente)
  applicationPeriod?: string; // Z2
  nodeId?: string; // Z3 (eje → habilidad → OA, por parentId)
  assessmentId?: string; // Z4
};
```

Dos reglas de diseño no negociables:

1. **El default no es "todo el historial".** Entrar pre-selecciona el **año vigente**. El histórico
   completo es un botón, nunca el estado inicial. (Corrige D5 y D7.)
2. **Sin unidad comparable seleccionada no hay número único.** Mientras el filtro no acote a una
   serie, la vista muestra **desglose por instrumento**, jamás un promedio agregado. El promedio
   aparece recién cuando el filtro garantiza que lo promediado es comparable.

---

## 4. Qué ya existe (y por qué el plan es más barato de lo que parece)

Antes de diseñar cada nivel, el inventario — dos hallazgos cambian el alcance:

### 4.1 Z4 ya está construido, sólo está desconectado

`GET /api/reports/student` (`official-reports.controller.ts:62`, `student-report.service.ts`) ya
devuelve, por alumno × evaluación:

- `items[]` — `position`, `selectedKey` (**qué alternativa marcó**), `correctKey`, `isCorrect`,
  `score/maxScore`, y **`oaCode`, `axis`, `skill`, `textType` por ítem**
  (`official-report-student.schema.ts:58-71`).
- `skills[]` — con `correctCount` / `totalCount` (conteos, no sólo porcentaje).

Y tiene UI: `/evaluaciones/[assessmentId]/informe-alumno/[studentId]`
(`ROUTES.evaluacionInformeAlumno`, componente `official-reports/student-report.tsx`).

**El problema es puramente de navegación:** esa página cuelga de _evaluaciones_, así que sólo se
llega si ya sabías qué evaluación mirar. Desde la ficha del alumno no hay ningún enlace (D6). El
nivel más profundo del zoom es, en su mayor parte, **trabajo de cableado, no de construcción.**

### 4.2 Los resultados por OA ya están en la BDD

`aggregateSkillResults` (`grade-calculator.ts:436-478`) itera sobre **`r.taxonomyNodeIds`**, es decir
todos los nodos etiquetados en el ítem. Como `taxonomy_node_type` incluye `axis`, `skill`,
`learning_objective`, `content` y `text_type` (`enums.ts:48-60`), **`skill_results` ya tiene una fila
por (alumno, evaluación, nodo) para ejes, habilidades y OAs.**

Lo que falta no es el cálculo: es que `loadBySkill` (`student-panorama.service.ts:207-247`) los
**aplana en una sola tabla sin jerarquía**, excluyendo únicamente `descriptor`. Un usuario ve ejes,
habilidades, OAs y tipos de texto revueltos en una lista plana ordenada por porcentaje. La jerarquía
existe en el dato (`taxonomy_nodes.parentId` / `depth`, `taxonomy.ts:48-56`) y se descarta al
serializar.

**Traducción:** Z3 es **reestructurar la respuesta**, no computar nada nuevo.

### 4.3 La noción de "alumno en riesgo" ya está implementada… encerrada

`buildRiskStudents` (`assessment-report.service.ts:867-898`) ya calcula alumnos en riesgo con su
`weakestSkill`. Pero vive **dentro del informe de una evaluación**: no se acumula por alumno, no se
persiste, no aparece en la lista de alumnos ni en su ficha. Es la tercera implementación inconexa de
"está mal", junto a `deriveAlerts` (`dashboards.service.ts:1736`).

> ⚠️ **No agregar una cuarta.** Las alertas de Z0 deben salir de la **bandeja persistente de #3B capa
> 3**, y `deriveAlerts` + `buildRiskStudents` deben converger ahí. Si esta vista genera su propio
> motor de alertas, el producto queda con cuatro definiciones de "alumno en riesgo" que no coinciden.

---

## 5. Diseño por nivel

### Z0 — Lista de alumnos con señal (la puerta de entrada)

**Hoy:** `student-picker.tsx` — elegir curso, buscar por nombre/RUT, cero datos de desempeño.

**Diseño:** tabla ordenable, con búsqueda **a nivel de organización** (no sólo dentro de un curso):

| Columna                          | Fuente                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| Alumno · curso                   | `students` + matrícula del año filtrado                         |
| Última evaluación comparable     | resolver de comparabilidad (§2)                                 |
| Banda actual                     | `assessment_results.performanceBandId`                          |
| Δ vs periodo comparable anterior | serie **N3**, o `priorPerformanceBandId`                        |
| Δ vs su curso                    | baseline `class_same_instrument` sobre el read-model de cohorte |
| Chips de alerta                  | bandeja de #3B                                                  |

**Pre-filtros sugeridos** (chips de un clic — todos sobre series comparables):

| Chip                   | Regla                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| **Retrocedió**         | bajó de banda entre dos aplicaciones comparables, o `priorBand → band` descendente |
| **Bajo persistente**   | ≥2 aplicaciones comparables consecutivas en la banda más baja                      |
| **Brecha vs su curso** | ≥15 pts bajo la media de su curso **en el mismo instrumento**                      |
| **Habilidad crítica**  | ≥1 nodo bajo 50% con ≥N ítems acumulados (reusa el umbral de `deriveAlerts`)       |
| **No rindió**          | asignado vía `assessment_course_assignments` y sin fila en `assessment_results`    |
| **Estancado**          | dentro de banda pero sin movimiento entre periodos comparables                     |

`No rindió` merece énfasis: hoy "no rindió" y "la evaluación no existe" se ven **idénticos** — la
fila simplemente no aparece.

### Z1 — Panorama del alumno por asignatura

**El eje principal pasa a ser la asignatura**, no la lista plana de evaluaciones.

Una tarjeta por asignatura con: banda actual (de la última evaluación comparable), movimiento vs el
periodo comparable anterior, delta vs su curso, habilidad/eje más débil, y nº de evaluaciones que
respaldan el dato. Las asignaturas se ordenan por severidad, no alfabéticamente.

**Lo que se elimina de la cabecera actual:** el KPI "Logro promedio" global, la `DistributionBar`
sobre instrumentos mezclados y la línea única del gráfico. Los tres son el #1C en versión alumno.

**Backend:** agrupar por `instruments.subjectId` en una pasada con `Map` (§05-performance), no un
re-scan por asignatura. Resolver la banda desde `performanceBandId` con fallback al enum legacy —
**un solo vocabulario de nivel en toda la página** (corrige D2/D3).

### Z2 — Historial de evaluaciones de esa asignatura

Dos bloques dentro de la asignatura seleccionada:

1. **Trayectoria comparable** — una línea **por serie** (§2), con el eje X en `applicationPeriod`
   (no en fecha cruda) y las bandas del instrumento como franjas de fondo. Un selector alterna entre
   la serie **N3** (momentos del año) y la **N2** (mismo estándar año a año). Reemplaza a
   `panorama-trajectory.tsx` — y es el fix de la **D6 del diseño de #1C/#2**, que ese doc deja
   explícitamente asignada a esta tanda.
2. **Historial de evaluaciones** — todas las evaluaciones de la asignatura (dentro y fuera de serie),
   con banda, logro, fecha, momento y **enlace directo a Z4**. Las que no pertenecen a la serie van
   en una sección "otras evaluaciones", visibles pero sin agregarse a nada.

Cada fila declara su **granularidad** (`assessments.dataGranularity` + `analytics-capabilities.ts`):
si el dato viene de un informe agregado, la fila dice _"sólo nivel de desempeño — sin detalle por
pregunta"_ en vez de mostrar celdas vacías. El mecanismo de capacidades ya existe y esta vista no lo
usa.

### Z3 — Ejes → habilidades → OAs

Árbol navegable construido con `taxonomy_nodes.parentId` / `depth`, con el logro del alumno en cada
nodo dentro de la unidad comparable seleccionada. Al lado de cada nodo, la referencia de cohorte
(curso / nivel) desde el read-model — **un 62% no dice nada solo; "62% cuando su curso sacó 78%" lo
dice todo.** Hoy el alumno se muestra en el vacío.

**Regla de agregación (corrige D4):**

- **Por defecto no se promedia entre evaluaciones.** Dentro de una serie comparable se muestran los
  valores **por aplicación** (Dg / Int / Cierre en columnas), no un promedio.
- Cuando el usuario pide explícitamente el consolidado, se agrega **sumando `correctCount` y
  `totalCount`**, nunca promediando porcentajes.
- ⚠️ **Caveat a documentar:** el `percentage` de `skill_results` está ponderado por `maxScore`
  (`grade-calculator.ts:470-475`) mientras `correctCount/totalCount` son conteos de ítems. Para ítems
  de puntaje múltiple ambos divergen. La suma de conteos es la mejor aproximación disponible sin
  re-leer `responses`; si se necesita exactitud, hay que persistir `scoreSum`/`maxSum` en
  `skill_results` — decisión abierta (§7).
- Los nodos `descriptor` siguen ocultos (`RESULT_HIDDEN_NODE_TYPES`).

### Z4 — Detalle de respuestas de una evaluación

**Reusar `GET /api/reports/student` y la página `informe-alumno` tal como están** (§4.1). El trabajo:

- Enlazar desde Z2 (fila de evaluación) y desde Z3 (un OA → los ítems que lo miden).
- Conservar el estado del zoom en el breadcrumb para poder volver a Z2/Z3 sin perder los filtros.
- Contrastar cada respuesta contra la cohorte: qué alternativa marcó el alumno **y** qué porcentaje
  del curso marcó esa misma alternativa. Eso separa "no sabe" de "tiene una concepción errónea
  específica" — la lectura pedagógica que el #1 del roadmap quiere conservar al eliminar la lectura
  psicométrica.

---

## 6. Plan de implementación

> **Estado (2026-08-04):** O1 ✅ · O3 ✅ · O2 ✅ · O4 ✅ (señales derivadas; migran a la bandeja de #3B cuando exista).
> Implementado en la rama `feat/vista-360-estudiante`, que integra `feat/panorama-comparable`
> para consumir su resolver.

| Ola                             | Contenido                                                                                                                                              | Por qué en ese orden                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **O1 — Reparar la base**        | D1, D2, D3, D4: unificar el vocabulario de banda, contar los resultados agregados, ponderar por conteos. Sin UI nueva.                                 | Es acotado, está en un solo servicio, y `f97cb0e` ya dejó el patrón de corrección. Construir zoom sobre números incorrectos multiplica el error. |
| **O3 — Z3 + Z4**                | Jerarquía de nodos en la respuesta, referencia de cohorte, y cableado a `informe-alumno` con breadcrumb.                                               | Barato: el dato y la página ya existen (§4.1, §4.2). **No depende del resolver**, así que puede ir antes que la O2.                              |
| **O2 — Comparabilidad + Z1/Z2** | Consumir `comparability.ts` (§2), filtros en el endpoint (D8), panorama por asignatura, trayectoria por serie N2/N3. Sustituye los agregados globales. | ⚠️ **Requiere la Ola 0 de `feat/panorama-comparable` mergeada.** Adelantarla obliga a inventar una segunda definición de comparable.             |
| **O4 — Z0 + alertas**           | Lista con señal y pre-filtros, alimentada por la bandeja de #3B.                                                                                       | Depende de que exista la bandeja; si se adelanta, nace la cuarta fuente de verdad de "alumno en riesgo".                                         |

**Nota de arquitectura:** las agregaciones en memoria van con `Map` en una sola pasada
(`frontend/05-performance.md`) y la página mantiene el shell inmediato + Suspense por sección
(`frontend/07-navigation-reactivity.md`).

> ⚠️ **Corrección a una versión anterior de este documento:** decía que convenía _paralelizar_ los
> `await` de `getPanorama`. Es falso — corren dentro de un `withOrgContext`, es decir sobre **una
> sola conexión en transacción**, y `node-postgres` serializa las queries de un cliente. Un
> `Promise.all` ahí no ahorra nada y sólo agrega riesgo. Quedan secuenciales a propósito.

---

## 7. Decisiones abiertas

> **Resueltas:** la definición de "comparable" quedó cerrada en `diseno-panorama-comparable.md`
> (modelo N0–N3) y esta vista la **consume** vía `packages/types/src/comparability.ts` — no
> re-deriva nada. La secuencia O1 → O3 → O2 se ejecutó en ese orden y la rama integra
> `feat/panorama-comparable`, así que ambas deben entrar a `dev` juntas o esa primero.

1. **`class_same_instrument` como baseline nuevo:** la comparación del alumno contra **su curso** en
   el mismo `instrumentId` todavía no existe. Va al catálogo de baselines de aquel diseño (que hoy
   tiene `previous_year`, `previous_period`, `org_same_instrument`), no como cálculo paralelo acá.
   Sin él, la ficha sigue mostrando al alumno en el vacío.
2. **Dónde viven las alertas de alumno.** O se define la bandeja de #3B capa 3 antes de la O4, o esta
   vista genera una cuarta definición de "está mal" (§4.3).
3. **El enum `performanceLevel` legacy.** Mientras conviva con `performance_bands`, cualquier
   distribución seguirá partiendo los datos en dos — hoy la vista lo declara `mixed` y no clasifica,
   que es honesto pero no es la solución. Hay que elegir bandas y migrar.
4. **¿Persistir `scoreSum`/`maxSum` en `skill_results`?** Es la única forma de agregar el logro por
   nodo entre evaluaciones con exactitud (§ Z3). Hoy se suman conteos de ítems, que difieren del
   `percentage` persistido (ponderado por `maxScore`) cuando hay ítems de puntaje múltiple.
5. **Alcance del "no rindió".** Requiere que `assessment_course_assignments` esté poblado de forma
   confiable; verificar en la demo antes de prometer el chip.

---

## 8. Anexo — referencias de código

| Pieza                               | Ruta                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Página 360                          | `apps/web/src/app/(dashboard)/estudiantes/[studentId]/page.tsx`                                                           |
| Servicio panorama                   | `apps/api/src/students/student-panorama.service.ts`                                                                       |
| Contrato panorama                   | `packages/types/src/schemas/student-panorama.schema.ts`                                                                   |
| Picker de alumno                    | `apps/web/src/app/(dashboard)/estudiantes/components/student-picker.tsx`                                                  |
| Gráfico actual                      | `apps/web/src/app/(dashboard)/estudiantes/components/panorama-trajectory.tsx`                                             |
| **Z4 ya construido**                | `apps/api/src/official-reports/student-report.service.ts` · `apps/web/src/components/official-reports/student-report.tsx` |
| Contrato Z4                         | `packages/types/src/schemas/official-report-student.schema.ts`                                                            |
| Riesgo ya calculado                 | `apps/api/src/assessment-report/assessment-report.service.ts:867-898`                                                     |
| Alertas de dashboard                | `apps/api/src/dashboards/dashboards.service.ts:1736`                                                                      |
| Agregación por nodo                 | `packages/types/src/utils/grade-calculator.ts:436-478`                                                                    |
| Escritura de resultados             | `apps/api/src/assessment-results/lib/persist-results.ts:190-225`                                                          |
| Import agregado (`percentage NULL`) | `apps/api/src/official-report-import/official-report-import.service.ts:246-262`                                           |
| Clave de comparabilidad             | `packages/db/src/schema/instruments.ts:48-63`                                                                             |
| Jerarquía taxonómica                | `packages/db/src/schema/taxonomy.ts:41-65` · `enums.ts:48-60`                                                             |
| Doctrina de conteos                 | `packages/db/src/schema/results.ts:139-145`                                                                               |
| Nivel previo                        | `packages/db/src/schema/results.ts:89-93`                                                                                 |
| Capacidades por granularidad        | `packages/types/src/analytics-capabilities.ts`                                                                            |
