# Plan — Fusionar los resultados del proceso en el panorama pedagógico

> Enmienda a `docs/diseno-resultados-del-proceso.md` (D6, D7 y §2.1). Lo que esa decisión
> protegía sigue protegido; lo que la justificaba cambió. Acá está por qué y en qué orden.

---

## 1. Resumen

Tres cosas, en este orden:

1. **Un defecto de correctitud** en la matriz: el `%` de la celda y su `n` no comparten
   denominador. Se arregla solo, sin esperar al resto.
2. **El encoding de la celda** invita a leer el número como % de logro, que es la lectura
   inversa. Se reemplaza por una distribución.
3. **La fusión**: la síntesis por conteo y la matriz se mudan al panorama; `/procesos` se queda
   con la rendición. De las cuatro tarjetas de resultados que hoy viven en el proceso, **dos se
   borran** porque el panorama ya pinta exactamente ese dato.

Ninguna ola agrega endpoints. Todo sale del payload que ya se pide.

---

## 2. Lo que se verificó antes de planificar

| Afirmación                                             | Estado             | Evidencia                                                                                                                                     |
| ------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| El proceso y el panorama leen el mismo endpoint        | ✅                 | `procesos/data.ts:34` pide `/dashboards/comparable-overview?processId=X`                                                                      |
| `processId` ya es filtro de primera clase del panorama | ✅                 | `dashboard-filters.ts:25,60,178`; se preselecciona (`withEntryDefaults`) y se preserva al cambiar de pestaña                                  |
| El panorama ya conoce el denominador del proceso       | ✅                 | `process-preview-banner.tsx` pide `/measurement-processes/:id` y pinta `CoverageBar`                                                          |
| La matriz puede construirse sin `/coverage`            | ✅                 | `process-rollup.ts:250-292`: el segundo loop siembra los ejes desde `units`                                                                   |
| "Celdas que más retrocedieron" duplica el panorama     | ✅                 | ambos consumen `comparable.generational`; el panorama vía `GenerationalBanner`                                                                |
| "Lo más urgente" duplica el panorama                   | ✅                 | ambos consumen `comparable.alerts`; el panorama vía `LiveAlertsBanner`                                                                        |
| El gating de roles difiere entre las dos vistas        | ❌ **falso**       | `PROCESS_VIEWER_ROLES === RESULTS_VIEWER_ROLES === DASHBOARD_VIEWER_ROLES`. `PROCESS_MANAGEMENT_ROLES` solo gobierna la barra de gestión      |
| "Alumnos evaluados" tiene dos definiciones vivas       | ❌ **ya resuelto** | `e563d3c0` lo pasó a `count(distinct student_id)`. El comentario de `process-preview-banner.tsx:110-115` quedó obsoleto y afirma lo contrario |

Las dos últimas filas eran advertencias mías de la conversación anterior. No se sostienen: la
primera nunca fue cierta, la segunda se arregló ayer. Queda una tarea menor —borrar el comentario
obsoleto— y nada más.

---

## 3. El defecto de la celda, con números

`process-rollup.ts:285-292` arma cada celda así:

- `cell.classifications` **suma** `studentsAssessed` de todas las unidades de la celda;
- `cell.lowestBandShare` es el **máximo** de una sola unidad.

La UI pinta los dos juntos (`process-results.tsx:332-333`): `60,0 % · n=20`. El propio spec del
proyecto tiene el caso (`process-rollup.spec.ts:243`): unidades `[1,9,0]` y `[6,4,0]`.

|            | alumnos | en banda inferior | share    |
| ---------- | ------- | ----------------- | -------- |
| unidad `a` | 10      | 1                 | 10 %     |
| unidad `b` | 10      | 6                 | 60 %     |
| **celda**  | **20**  | **7**             | **35 %** |

La celda muestra `60,0 % · n=20`, que no es ninguna de las tres. Quien multiplique obtiene 12
alumnos; los reales son 7. Esto no es teórico: las menciones de Ciencias PAES son tres
instrumentos en una misma celda (curso × asignatura) y ya están cargadas en demo.

El `max` es intencional y está testeado — lo que no es defendible es mostrarlo al lado de un `n`
sumado, porque la yuxtaposición afirma un denominador compartido que no existe.

---

## 4. Decisiones

### A1 — El denominador no se separa de la síntesis

Lo único de la decisión previa que no se toca. D4 tiene razón: si el titular por nivel se puede
leer sin la cobertura, un proceso a medio cargar —el estado normal mientras está vivo— se lee
como completo. **Donde vaya la síntesis, va la cobertura a la vista.** La fusión se hace moviendo
las dos juntas, no separándolas.

### A2 — §2.1 ya no describe el código

§2.1 cerró así: el panorama "no puede cruzar resultados con las celdas que faltan… el denominador
vive únicamente en `measurement_processes.expected_scope`". Era cierto cuando se escribió. Hoy
`ProcessPreviewBanner` pide `/measurement-processes/:id` y pinta su `CoverageBar` dentro del
panorama. Falta solo `/coverage` (el estado por celda), que es una request más en una página que
ya hace dos. **La fusión dejó de ser imposible y pasó a ser una mudanza.**

El otro argumento de §2.1 —que el panorama no debe agregar, y con 32 instrumentos entrega 32
filas— sigue en pie y es justamente lo que la mudanza resuelve: la síntesis por conteo llega al
panorama en vez de obligar a leerla en otra vista.

### A3 — Se enmienda D7: la síntesis y la matriz viven en el panorama

| Vista                     | Pregunta                            | Contenido                                                                                                                |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/procesos/[id]`          | ¿se rindió lo que había que rendir? | KPIs, avance de rendición, alcance, vincular evaluaciones, celdas fuera de alcance, **titular compacto** + enlace        |
| `/resultados?processId=X` | ¿cómo salió?                        | banda del proceso **con su cobertura**, titular por nivel, matriz, y los 5 tabs de análisis que el proceso hoy no hereda |

El titular compacto se queda en `/procesos` porque es la cifra que un director lee en tres
segundos junto a la cobertura; la matriz no, porque es análisis y el análisis vive en el panorama.

### A4 — La matriz NO entra al Mapa de calor

Corrijo lo que propuse en la conversación: el Mapa de calor es **habilidad × asignatura sobre %
de logro**. Meter curso × asignatura sobre concentración en banda inferior ahí junta las dos
escalas que `diseno-panorama-comparable.md` §8.1 decidió no mezclar, y la matriz perdería su capa
de cobertura, que es lo que la justifica. Va en el Resumen del panorama, bajo la banda del
proceso, y **solo con `processId` activo**: sin proceso no hay huecos que mostrar y la matriz
degenera en la lista de unidades que ya existe.

### A5 — Las tarjetas 4 y 5 se borran, no se mudan

`comparable.generational` ya lo pinta `GenerationalBanner`; `comparable.alerts` ya lo pinta
`LiveAlertsBanner`. §2.1 ya había decidido "todo lo demás se deja donde está y se enlaza" — la
implementación no lo cumplió. Borrarlas es honrar la decisión, no revisarla.

### A6 — La celda se calcula por escalera, como todo lo demás

Se pliegan los conteos por banda de la celda reusando `foldBuckets` y `ladderKeyOf`, que ya
existen:

- **todas las unidades comparten escalera** → la celda reporta el conteo sumado por banda y su
  propio share (7 de 20 = 35 % en el ejemplo de §3);
- **más de una escalera** → no reporta share. Reporta "N instrumentos" y la severidad peor. Es D2
  aplicado a la celda: nunca una barra con los ordinales alineados a la fuerza.

`cell.lowestBandShare` deja de alimentar la UI. El spec de la línea 243 cambia de aserción, con la
razón escrita en el test.

### A7 — La celda muestra una distribución, no un porcentaje suelto

- **Mini barra apilada** con las bandas y los colores de la escalera: los mismos de la barra de
  "Clasificaciones por nivel" que está dos centímetros más arriba, así que el usuario ya aprendió
  a leerla.
- **Fracción de alumnos** (`18 de 52`), no un porcentaje. Una fracción no se confunde con logro.
- **Título**: "Dónde se concentra el nivel más bajo". **Eje de filas**: "Curso". La palabra
  "nivel" queda reservada para la banda de desempeño en toda la vista — hoy significa curso en el
  título y banda en el valor.
- Tooltip con el detalle por banda.

### A8 — La matriz se dibuja solo con ≥2 cursos y ≥2 asignaturas

Con una sola columna es una lista disfrazada y la tabla de unidades lo hace mejor. Hoy se dibuja
con ≥1 de cada uno (`process-results.tsx:275`).

### A9 — El orden de las filas sale de `/dashboards/filters`

`ComparableUnitSummary` no trae orden de grado, así que las filas sembradas desde `units` quedan
todas con `order: Number.MAX_SAFE_INTEGER` (`process-rollup.ts:256`) y en el panorama —sin
`/coverage`— el orden colapsa al de severidad. Las opciones de filtro ya traen los grados
ordenados y ya se piden en la página. Las columnas se ordenan por nombre (hoy `order: 0` fijo).

---

## 5. Olas

Una sola PR; cada ola se pushea sobre la misma. Rama nueva desde `origin/dev` (la de
`feat/resultados-del-proceso` está mergeada).

### Ola 0 — El denominador de la celda

Correctitud pura, sin cambio visual más allá del número. Se puede mergear sola.

- `packages/types/src/utils/process-rollup.ts`: conteos por banda y por escalera en cada celda
  (A6). Tipo `ProcessMatrixCell` gana `ladders` y pierde el uso de `lowestBandShare` en la UI.
- `packages/types/src/utils/process-rollup.spec.ts`: reescribir el caso de la línea 243; agregar
  el caso de dos escaleras en una celda.
- `apps/web/.../process-results.tsx`: la celda consume el conteo nuevo.

### Ola 1 — El encoding

- `MatrixCell`: mini barra + fracción + tooltip (A7).
- `ResultsMatrix`: guarda de ≥2×2 (A8), orden de filas y columnas (A9), encabezado "Curso".
- Título y descripción de la tarjeta (A7).

### Ola 2 — Borrar la duplicación

- `process-results.tsx`: eliminar "Celdas que más retrocedieron" y "Lo más urgente" (A5).
  Conservar el enlace al panorama. `MIN_RELEVANT_DROP_PP` y `drops` quedan sin uso: borrarlos.

### Ola 3 — La mudanza

- Extraer el titular por nivel y la matriz a componentes compartidos (sugerencia:
  `apps/web/src/components/procesos/`), consumidos por las dos páginas.
- `resultados/page.tsx`: con `processId` activo, renderizar la síntesis + la matriz bajo la banda
  del proceso. Pedir `/measurement-processes/:id/coverage` ahí (nueva `Suspense`, no bloquea el
  resto).
- `procesos/[processId]/page.tsx`: queda el titular compacto + enlace "Ver los resultados" al
  panorama ya filtrado.
- Respetar la regla de alcance docente: hoy `process-results.tsx:74-75` pasa
  `orgScoped ? coverage : null` porque el denominador de `/coverage` es el del colegio entero. En
  el panorama tiene que valer lo mismo, o un profesor vería un denominador que no le corresponde.

### Ola 4 — Cierre honesto

- `docs/diseno-resultados-del-proceso.md`: sección de enmienda a D6/D7 y §2.1 con el por qué (A2,
  A3, A4). No se edita la decisión original en silencio.
- Borrar el comentario obsoleto de `process-preview-banner.tsx:110-115` (§2, última fila).
- Fixture local con dos casos: la celda de tres instrumentos (el caso de las menciones de Ciencias
  PAES): la fracción de la celda tiene que coincidir con la suma de las tres unidades, y hoy no
  coincide. **No se verifica contra demo durante la ejecución autónoma** —leer demo está prohibido
  ahí (§8.5)—; la comprobación contra la celda real se hace con el usuario después del merge.

---

## 6. Tests

| Ola | Test                                                           | Qué atrapa                                          |
| --- | -------------------------------------------------------------- | --------------------------------------------------- |
| 0   | celda con dos unidades de la misma escalera suma por banda     | el defecto de §3                                    |
| 0   | celda con dos escaleras distintas no emite share               | D2 en la celda                                      |
| 0   | celda con una unidad da el mismo resultado que hoy             | que la ola no mueva lo que estaba bien              |
| 1   | matriz con 1 asignatura no se dibuja                           | A8                                                  |
| 1   | filas ordenadas por grado y no por severidad                   | A9                                                  |
| 3   | con alcance docente la matriz no recibe cobertura              | el denominador ajeno                                |
| 3   | el panorama sin `processId` no dibuja la matriz                | A4                                                  |
| 4   | celda con un alumno sin banda (todas sus preguntas pendientes) | que el denominador no lo cuente por accidente (§10) |

Cada test se verifica revirtiendo el arreglo y confirmando que falla.

---

## 7. Riesgos

- **La enmienda a D7 toca una decisión razonada, no un descuido.** El riesgo real no es el código,
  es perder el argumento de D4 por el camino. Mitigación: A1 es la primera decisión del plan y el
  gate es un test, no una revisión (§8.1) — sin aprobación humana entre fases, "que se vea bien"
  no es un gate.
- **Alcance docente.** Es el borde donde ya hay una regla sutil escrita en un comentario. Si se
  pierde en la extracción de componentes, un profesor ve el denominador del colegio. Cubierto por
  test en la Ola 3.
- **Procesos con alcance derivado.** `scopeDerived` da cobertura 100 % siempre y el banner ya lo
  advierte. La advertencia tiene que viajar junto a la matriz, o los huecos se leen como
  inexistentes.
- **Payload del panorama.** La Ola 3 agrega una request (`/coverage`) solo cuando hay `processId`.
  `getComparableOverview` está cacheado por request, así que la síntesis no agrega queries.

---

## 8. Ejecución autónoma

El plan completo se ejecuta paso a paso **sin aprobación humana para pasar de ola**. Eso cambia
dos cosas de fondo: todo gate tiene que ser mecánico, y todo lo que dependa de un recurso
compartido o remoto queda fuera.

### 8.1 Principio — un gate que no es un test no es un gate

Sin revisión humana entre fases, "revisar que se vea bien" no detiene nada. Cada guarda del §4 se
traduce a una aserción que falla sola:

| Guarda                                             | Gate mecánico                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A1/D4 — el denominador no se separa de la síntesis | test: el componente de síntesis no renderiza sin recibir cobertura (o sin el aviso de alcance docente) |
| A6 — no se mezclan escaleras en una celda          | test: celda con dos escaleras no emite share                                                           |
| A7 — la celda no emite un porcentaje suelto        | test de render: la celda no contiene el carácter `%`                                                   |
| A8 — matriz solo con ≥2×2                          | test: matriz de 1 columna no se dibuja                                                                 |
| A9 — filas por grado, no por severidad             | test de orden explícito                                                                                |
| Registro tuteo                                     | grep de patrones de voseo en los archivos tocados, antes de cada commit                                |

Una ola no se cierra con el gate rojo. Y cada test del §6 se verifica **revirtiendo el arreglo**:
un test que pasa con y sin el fix no mide nada.

### 8.2 Worktree aislado

- Worktree nuevo para todo el plan: `wt-fusion-panorama`, rama `feat/fusion-panorama-procesos`
  desde `origin/dev`.
- **No se reusa `wt-resultados-proceso`:** su rama está mergeada, y una PR mergeada está cerrada
  para trabajo nuevo.
- **Commit al cerrar cada ola, obligatorio.** El trabajo sin commitear en un worktree se pierde.
- Nunca `git stash` pelado: el stack es compartido entre worktrees y otras sesiones. Si hay que
  apartar algo, commit WIP.
- Si una ola justifica trabajo paralelo sobre archivos distintos, el subagente recibe **su propio
  worktree** y el resultado vuelve por cherry-pick. Dos agentes nunca escriben el mismo archivo.

### 8.3 Subagentes — solo donde ganan algo

Un subagente paga cuando el trabajo es un barrido amplio cuyo resultado es una conclusión corta,
o una segunda lectura independiente. No paga para escribir un archivo que ya está en contexto.

| Tarea                                                                                                                            | ¿Subagente?         | Por qué                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| Auditoría de la PR final (§9)                                                                                                    | **Sí, obligatorio** | lectura independiente; es el control que pide el plan                                      |
| Barrido de consumidores de `lowestBandShare`, `MIN_RELEVANT_DROP_PP` y del tipo `ProcessMatrixCell` antes de cambiarles la forma | **Sí**              | fan-out por todo el monorepo, devuelve una lista corta                                     |
| Revisión de la Ola 3 contra `.claude/rules/frontend` (archetypes, performance, permisos)                                         | **Sí**              | es la ola con más superficie y reglas propias                                              |
| Escribir las olas 0, 1 y 2                                                                                                       | **No**              | uno o dos archivos cada una, con el contexto ya acá; despachar cuesta más de lo que ahorra |
| Correr suites de tests                                                                                                           | **No**              | van al CI (§8.4)                                                                           |
| Cualquier cosa que toque demo, AWS, SST o S3                                                                                     | **No**              | prohibido (§8.5)                                                                           |

**Techo: 1 agente de auditoría + hasta 2 de barrido o revisión en todo el plan.** Si aparece la
tentación de un cuarto, es señal de que la ola está mal cortada.

Antes de despachar cualquiera: se le pasan las decisiones A1-A9 y las reglas de `.claude/rules/`
que apliquen. Los peores bugs aparecen **entre** tareas de agentes, en las semánticas que nadie
fijó. Y lo que un subagente reporta se verifica contra la fuente antes de aceptarlo —
especialmente los casos extremos.

### 8.4 Recursos — un proceso pesado a la vez

La máquina tiene 8 GB. Autonomía no es permiso para saturarla.

- Verificación por ola: `typecheck` y después `test` del paquete tocado, **en serie**.
- Nunca dos procesos pesados en paralelo, ni entre agentes.
- Las suites grandes corren en el CI, no en local.

### 8.5 Lo que la autonomía no puede hacer

- **Prohibido** AWS, SST, túnel, S3 y leer o escribir la base de datos demo.
- Por eso la verificación de la Ola 4 es una fixture local (§5). La comprobación contra la celda
  real de Ciencias PAES se hace con el usuario, después del merge.
- **No se mergea nada.** La PR se entrega mergeable y auditada; el merge a `dev` lo decide el
  usuario.

### 8.6 La PR

- Un commit por ola, conventional commit en español (tuteo). La PR se abre **al final**, con las
  cinco olas dentro.
- Antes de pushear, `gh pr list --head feat/fusion-panorama-procesos --state all` **como paso
  aparte**, nunca encadenado al push.
- Verificar que no haya `.env` ni credenciales en el diff antes de cada commit.
- "Mergeable" se afirma con el **número** de checks y el `mergeStateStatus`, no con la ausencia de
  fallas: "no checks reported" significa CONFLICTING, no "esperando". `UNKNOWN` es transitorio
  (~60 s).

---

## 9. Auditoría de la PR

Un subagente audita la PR completa antes de entregarla. Su trabajo no es revisar estilo: es buscar
regresiones y accesos perdidos.

### 9.1 Checklist, con evidencia obligatoria

Cada punto se responde con `archivo:línea` y cómo reproducirlo. "Parece correcto" no es una
respuesta.

1. **Accesos.** Ningún rol pierde una vista. `PROCESS_VIEWER_ROLES`, `DASHBOARD_VIEWER_ROLES` y
   `RESULTS_VIEWER_ROLES` siguen siendo el mismo conjunto; ninguna página nueva o movida quedó con
   un set más estrecho que la de origen; la barra de gestión sigue bajo
   `PROCESS_MANAGEMENT_ROLES`.
2. **Alcance docente.** Con `scope === 'teacher'` la matriz no recibe cobertura (el denominador de
   `/coverage` es el del colegio entero) y el scoping por `teacher_assignments` del service sigue
   aplicando. Es el borde donde la regla vivía en un comentario y puede perderse al extraer
   componentes.
3. **Nada borrado era el único camino.** La Ola 2 elimina dos tarjetas: verificar que
   `comparable.generational` y `comparable.alerts` siguen llegando al usuario por el panorama y
   que el enlace sobrevive.
4. **Símbolos huérfanos y consumidores viejos.** Que no quede nadie leyendo `lowestBandShare` de
   la celda, ni constantes muertas.
5. **Poder de detección.** Cada test nuevo del §6 falla al revertir su arreglo. Un test que pasa
   en ambos casos se reporta como hallazgo.
6. **Aislamiento.** Si alguna ola terminó tocando la API: ninguna query a tabla con RLS fuera de
   `withOrgContext`, ningún filtro sin `org_id`, ningún `orgId` tomado del body o del query.
7. **Registro y reglas.** Tuteo sin voseo en todo texto nuevo; cero comentarios en `apps/api`.
8. **El doc de diseño quedó enmendado**, no editado en silencio: la enmienda a D6/D7/§2.1 existe y
   dice por qué.

### 9.2 Cierre

- Cada hallazgo se **verifica contra la fuente** antes de aceptarlo: un subagente también se
  equivoca, y aceptar un hallazgo falso cuesta un arreglo que rompe algo que estaba bien.
- Lo que resulte real se corrige en la misma PR, con su propio commit (`fix(auditoría): …`).
- Se re-audita lo corregido, no todo de nuevo.
- La PR se entrega cuando se cumplen las tres: CI verde **con número de checks**,
  `mergeStateStatus` limpio, y cero hallazgos reales abiertos.

---

## 10. Dependencia de la sesión `benchmark-integrado`

Coordinación del 2026-10-06 (`coordinacion/acuerdos.md`, fila 5). Su plan deja **sin banda** al
alumno con todas sus preguntas pendientes: hoy ese alumno queda con 0 % y cae en la banda más baja;
después queda fuera de `bandDistribution` y de `studentsAssessed`.

Verificado en el código, no asumido:

- `grade-calculator.ts:385-388` ya calcula el % del alumno como Σpuntaje/Σmáximo **excluyendo los
  pendientes del numerador y del denominador**. Con todas pendientes, `maxScore = 0` →
  `percentage = 0` → cae en la banda más baja. Su descripción del caso es exacta.
- El camino por alumno los excluye bien: `comparable-unit.assembler.ts:222-223` cae a
  `classifyPercentage`, que devuelve `null` cuando `percentage == null` (línea 274), y la fila se
  salta.
- `foldBandDistribution` (línea 218) prefiere el read-model de cohorte sobre las filas por alumno,
  así que valía preguntar si ese camino era el que manda. **No lo es, para las evaluaciones con
  respuestas.** `loadUnitLevelCounts` lee `assessment_level_stats` (vía `loadCohortLevelCounts`), y
  esa tabla sólo tiene filas de evaluaciones `aggregate_only`: sus dos únicos escritores son
  `official-report-import.service.ts` y `apps/api/scripts/backfill-level-stats.ts`, y el script
  filtra `dataGranularity = 'aggregate_only'` (línea 163). El rebuild de cohorte de la otra sesión
  reconstruye `assessment_item_stats` y `assessment_skill_stats`, no ésta. Para todo lo que tiene
  respuestas reales manda el camino por alumno, que es el verificado arriba.
- La banda está **persistida** en `assessment_results.performance_band_id`, y nada de la otra sesión
  la reescribe: su backfill sólo rellena `score_sum`/`max_sum` de `skill_results`. **Los números de
  esta matriz no se mueven al mergear su PR ni al correr su backfill** — se mueven recién cuando se
  recalculan los resultados de una evaluación (carga nueva o re-puntuación), que es cuando
  `persist-results.ts` vuelve a escribir la banda.

**Consecuencia para este plan:** ninguna de las dos olas rompe a la otra —mis tests usan fixtures con
conteos por banda explícitos— pero el caso se cubre con una fixture propia (§6, test 4) en vez de
apoyarse en que hoy hay 0 alumnos así en demo. Eso deja de ser cierto en cuanto se cargue una
evaluación con preguntas de desarrollo sin corregir, que es un estado normal en este producto.

Orden de merge acordado: PR 0 de `achievement.ts` → **esta PR** → `edtech-3c` → las partes A y B de
`benchmark-integrado`. Con lo anterior verificado, la verificación en demo es estable igual: no
depende del orden de merge, sino de que nadie recalcule esa evaluación entre medio.
