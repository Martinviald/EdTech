# Plan de Desarrollo — Épica de Optimización del Panorama (`/resultados`)

> **Origen:** comentario in-app de `ebravo@cscj.cl` (tabla `feedback`, `b98b7561-…`, 2026-09-08, vista `/resultados?instrumentType=paes`, rol `academic_director`): _"la plataforma es muy pesada para la calidad de internet de este colegio, se me cayó varias veces, se demoraba en cargar la información"_.
>
> **Cómo leer este doc:** la épica está partida en **fases de un solo cambio cada una**. Ninguna fase avanza hasta que su gate de no-regresión pasa y el commit está hecho. El orden no es negociable: cada fase asume el estado de la anterior, y dos de ellas (F4, F6) tocan el mismo método.
>
> **Regla central de la épica:** _el panorama debe seguir mostrando exactamente los mismos números._ Se optimiza **cómo** se obtienen y se transmiten, no **qué** se calcula. La única fase que cambia números a propósito es **F4**, y es porque hoy están mal.

---

## 1. Diagnóstico (medido, no estimado)

Alcance de la queja: org CSCJ, `instrumentType=paes` → **13 instrumentos · 39 evaluaciones · 1.082 resultados · 125 alumnos**. El volumen de datos es chico: el costo está en las **idas y vueltas** y en los **bytes que sobran**.

| #   | Hallazgo                                                                  | Evidencia                                                                                                                                                                                                                                      | Fase   |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | El panorama completo se pide **dos veces por carga** y otra vez cada 60 s | `use-comparable-alerts.ts:31` — `useQuery` sin `initialData` ni `staleTime` sobre `/dashboards/comparable-overview`, el endpoint más pesado, sólo para leer `alerts`                                                                           | F1, F3 |
| 2   | Se mandan **~500 alertas para mostrar 4**                                 | `comparable-alerts.service.ts` no tiene tope; medido: **487** ítems bajo umbral en PAES, **1.560** sin filtro de tipo. `alerts-banner.tsx:24` → `VISIBLE_LIMIT = 4`                                                                            | F2     |
| 3   | **N+1 serial**: ~110 queries encadenadas en una sola transacción          | `comparable-overview.service.ts:80` (`for` con `await`), `comparable-unit.assembler.ts` `loadUnitLevelCounts` (una query **por evaluación**), `attachBaselines` (2 queries por unidad)                                                         | F5     |
| 4   | El join de cursos **duplica cada resultado**                              | `comparable-unit.assembler.ts:213` une `student_enrollments` sin filtrar año; `unique(student_id, academic_year_id)` → un alumno de 2025+2026 aporta 2 filas. Medido: **2.164 filas para 1.082 resultados (×2 exacto)**; global 17.529 / 8.861 | F4     |
| 5   | Fila por resultado traída a Node para agregar en memoria                  | `loadByClassGroup` y el fallback de `resolveBandDistribution`                                                                                                                                                                                  | F6     |
| 6   | La API no comprime; el proxy bufferiza la respuesta entera                | `apps/api/src/main.ts` (sin `compression`), `apps/web/src/app/api/proxy/[...path]/route.ts`                                                                                                                                                    | F7     |

**Deuda de cobertura que condiciona el plan:** `comparable-overview.service.ts` y `comparable/comparable-unit.assembler.ts` **no tienen ningún spec**. Son justamente los archivos de F4, F5 y F6. Por eso F0 construye una red de seguridad externa antes de tocar nada.

---

## 2. Método de trabajo

### 2.1 Rama y aislamiento

La épica vive en su propio worktree sobre una rama nueva desde `dev`, no sobre la rama de trabajo actual:

```bash
git fetch origin
git worktree add ../wt-optimizacion-panorama -b perf/panorama-optimizacion origin/dev
```

**Una sola PR para toda la épica**, abierta al terminar F0. Cada fase es **un commit que se pushea a esa misma PR** — no se abre una PR por fase. Nada de agrupar dos fases en un commit: el valor del plan está en poder bisectar qué fase rompió algo.

### 2.2 El gate de no-regresión (idéntico en todas las fases)

Ninguna fase se da por terminada sin estos cinco pasos, **en este orden**:

1. `pnpm --filter @soe/api typecheck` y `pnpm --filter @soe/web typecheck` — sin errores.
2. `pnpm --filter @soe/api lint` — sin warnings.
3. **Diff del golden snapshot** (§3): el resultado del endpoint tiene que ser **byte-idéntico** al baseline, salvo en las fases que declaran un diff esperado (F2, F4).
4. **Verificación visual** en la vista real, con el alcance de la queja (`/resultados?instrumentType=paes`) y con el alcance por defecto (sin filtro).
5. Commit + push a la PR de la épica, y **mirar los checks del CI antes de empezar la fase siguiente**. Los tests unitarios (los existentes y los que agregan F4/F5/F6) se verifican **ahí**, no en local.

Si el paso 3 muestra un diff no declarado, **el trabajo de la fase está mal**: se corrige o se revierte, no se re-baseliza el golden. Si el CI falla, se arregla en la misma fase antes de seguir.

> ⚠️ **Recursos de la máquina:** la suite de la API son ~27 min y un worker de jest por core — deja sin memoria una máquina de 8 GB. **Las suites van al CI, no a local.** En local sólo se corre un archivo puntual (`pnpm --filter @soe/api exec jest src/dashboards/comparable-alerts.service.spec.ts --runInBand`) y sólo para distinguir un fallo propio de uno del entorno. `next build` y `tsc` tampoco se lanzan en paralelo, ni entre sí ni con el túnel SST haciendo un import.

### 2.3 Formato del commit

```
perf(panorama): <qué cambió> — F<n>

<qué se midió antes y después>
Golden: sin diff / diff esperado en <campo>
```

---

## 3. Fase 0 — Red de no-regresión (sin cambio de producto)

**Objetivo:** poder afirmar "el resultado es exactamente el mismo" con un comando, en vez de con una impresión.

**Qué se construye:** `apps/api/scripts/snapshot-panorama.ts` — corre `ComparableOverviewService.getComparableOverview` contra la BDD demo para una **matriz fija de alcances** y guarda cada respuesta normalizada en `tmp/golden/<alcance>.json`.

No pasa por HTTP ni por el contenedor de Nest: instancia los cuatro services a mano y arma el `JwtPayload` como objeto. Se probó primero por `NestFactory` y **no sirve**: `tsx` no emite la metadata de decoradores que la inyección de Nest necesita, así que los services llegan con sus dependencias en `undefined`. El cableado manual además evita forjar un JWT y levantar el servidor.

Alcances de la matriz (los que ejercitan todos los caminos del código):

| Alcance                                               | Qué ejercita                                       |
| ----------------------------------------------------- | -------------------------------------------------- |
| CSCJ, sin filtros                                     | el caso más pesado; el que ve el usuario al entrar |
| CSCJ, `instrumentType=paes`                           | el de la queja                                     |
| CSCJ, `instrumentType=dia`                            | unidades con bandas y con read-model de cohorte    |
| CSCJ, `instrumentType=dia` + `academicYearId` de 2026 | el filtro de año                                   |
| CSCJ, un `classGroupId`                               | la rama con `classGroupIds` acotado                |
| Colegio Demo (`dec00000-…`)                           | org sintética con baselines entre años             |
| Un usuario `teacher` de CSCJ                          | la rama `isTeacherScope` (KPIs de "Mis cursos")    |

**Normalización antes de guardar.** Se ordenan **las claves de cada objeto** (el orden de claves no es contrato) y **los `assessmentIds`** (salen de un `select` sin `order by`: su orden es genuinamente no determinista). El orden de `units`, `byClassGroup` y `alerts` se deja **intacto a propósito** — es contrato (severidad, logro ascendente, ranking) y un refactor que lo altere tiene que aparecer en el diff. Ordenarlos, como decía la primera versión de este plan, habría escondido justo la regresión que F5 puede introducir. **No** se redondean los números: si un refactor cambia el orden de una suma en punto flotante, se quiere ver.

**Uso:**

```bash
pnpm --filter @soe/api exec tsx scripts/snapshot-panorama.ts --out tmp/golden      # baseline
# … cambio de la fase …
pnpm --filter @soe/api exec tsx scripts/snapshot-panorama.ts --out tmp/actual
pnpm --filter @soe/api exec tsx scripts/snapshot-panorama.ts --diff tmp/golden tmp/actual
```

**Tolerancia de punto flotante (`--float-tolerance`).** El diff es estructural: reporta la ruta exacta de cada diferencia (`units[0].byClassGroup[1].averageAchievement`). Para los números acepta una tolerancia relativa, porque un refactor que agrupa sumas de otra manera cambia el último dígito representable de un `double` sin cambiar el resultado: F5 movió 213 valores, todos con diferencia relativa ≤ 6.4e-16 (un ULP). Se corre **sin** tolerancia por defecto; cuando una fase declara reordenar sumas, se corre con `--float-tolerance 1e-12` y se deja constancia de la magnitud observada. Cualquier diferencia que no sea numérica se reporta siempre, tolerancia o no.

El script también imprime, por alcance: **cantidad de queries** (contador en el cliente `postgres`), **tiempo total del endpoint** y **tamaño del JSON en bytes**. Esas tres cifras son la métrica de la épica.

**Contra qué BDD:** la demo por el túnel SST (ver skill `demo-db-access`). El baseline se toma **una sola vez, al inicio de la épica**, y se versiona en `tmp/` fuera de git — pero las **tres métricas** de cada corrida sí se anotan en la tabla de §5 de este doc.

⚠️ La demo se escribe desde otras sesiones. Si entre dos corridas alguien carga un instrumento, el diff aparece y no es tuyo: **re-tomar el baseline** y anotarlo, no perseguir un fantasma.

**Lo segundo que construye F0: el job de API en el CI.** `.github/workflows/ci.yml` tenía jobs para `web` y `db`, pero **ninguno para `apps/api`** — la API no pasaba por typecheck, ni lint, ni tests en ninguna PR. Como toda la épica es backend y sus tests se verifican en el CI, F0 agrega el job `api` (typecheck · lint · `jest`). Sin eso, las fases F4–F6 se subirían sin ninguna verificación automática.

Dos cosas que ese job destapó y F0 arregla:

- **El script del snapshot no lo cubría ningún typecheck**: `apps/api/tsconfig.json` incluye sólo `src/**/*`. Se agrega `apps/api/tsconfig.typecheck.json` (src + scripts) y el script `typecheck` del paquete apunta ahí. Importa para las fases siguientes: F5 cambia constructores que el snapshot instancia a mano, y sin esto ese desajuste no lo detectaría nadie.
- **`pnpm --filter @soe/api lint` fallaba en `dev`**: dos imports sin usar (`userHasAnyRole`, `ADMIN_LIKE_ROLES`) en `dashboards.service.ts`, del último merge. Se eliminan — sin eso el job nace en rojo.

**Gate de F0:** (a) el script corre dos veces seguidas sin cambiar nada y el diff sale vacío — si no sale vacío, la normalización está incompleta y el resto del plan no tiene piso; (b) la PR de la épica queda abierta y el job `api` del CI aparece en verde.

**Commit:** `chore(panorama): snapshot de no-regresión + job de API en CI — F0`

---

## 4. Fases de optimización

### F1 — Matar el fetch duplicado de cada carga

**Cambio:** en `apps/web/src/app/(dashboard)/resultados/hooks/use-comparable-alerts.ts`, pasar las alertas del servidor como `initialData` y darle `staleTime` igual al intervalo de refresco.

```ts
initialData: { alerts: initialAlerts } as ComparableOverviewResponse,
initialDataUpdatedAt: Date.now(),
staleTime: REFRESH_INTERVAL_MS,
```

Hoy `initialData: undefined` hace que TanStack dispare el fetch **apenas monta**, aunque el RSC acaba de traer esa misma respuesta. Con `initialData` + `staleTime`, el primer fetch ocurre recién a los 60 s.

**Por qué primero:** es el cambio de menor riesgo y elimina de una la mitad del tráfico de la vista. Es sólo frontend: la respuesta del API no se toca.

**Validación específica:** con DevTools abierto en Red, cargar `/resultados?instrumentType=paes` y contar las llamadas a `/api/proxy/dashboards/comparable-overview`: **antes 1, después 0** en los primeros 60 s. Las 4 alertas visibles y el contador del encabezado deben ser los mismos.

**Golden:** sin diff (no cambia el backend).

---

### F2 — Topar las alertas en el backend

**Cambio:** en `comparable-alerts.service.ts`, `dedupeAndRank` corta a **20 alertas** después de ordenar, y la respuesta pasa a llevar el total real.

- `ComparableOverviewResponse.alerts` → las 20 mejor rankeadas.
- Campo nuevo `alertsTotal: number` en `packages/types` (el schema Zod compartido, no una interfaz nueva en la API).
- `alerts-banner.tsx` muestra "(N)" usando `alertsTotal`, no `alerts.length`.

**Por qué 20 y no 4:** la UI pliega en 4 pero deja desplegar el resto; 20 cubre el desplegado sin mandar 500. El corte va **después** del `sort` por severidad y alumnos afectados, así que las que se pierden son siempre las menos graves.

**Diff esperado en el golden:** `alerts` queda truncado. **Lo que se valida es que las primeras 20 alertas sean exactamente las mismas, en el mismo orden, que las primeras 20 del baseline**, y que `alertsTotal` sea igual al `alerts.length` del baseline. El script de F0 necesita un modo `--expect-truncated-alerts` para esta comparación; se agrega acá.

**Riesgo a vigilar:** `dedupeAndRank` ordena por severidad y luego por `studentsAffected`; si dos alertas empatan en ambos, el orden lo decide el orden de inserción y es estable sólo mientras el orden de los generadores no cambie. **F5 no debe alterar ese orden** — queda anotado como invariante.

---

### F3 — Endpoint liviano de alertas

**Cambio:** `GET /dashboards/comparable-overview/alerts` en `dashboards.controller.ts`, que devuelve `{ alerts, alertsTotal }` y nada más; el hook del panorama pasa a pegarle a ese.

**Ojo con la implementación:** las alertas hoy se derivan **de los `units` ya armados** (`deriveAlerts(tx, orgId, units, classGroupIds)`), así que el endpoint liviano no puede saltarse el armado de unidades sin cambiar los números. En esta fase el endpoint **reusa `getComparableOverview` y descarta lo que no manda**: la ganancia es de red (el payload del polling baja a ~5% ), no de CPU. La ganancia de CPU la da F5, que es la fase siguiente y beneficia a ambos endpoints.

**Validación específica:** el `alerts` del endpoint nuevo debe ser **byte-idéntico** al `alerts` del endpoint completo para los 7 alcances de la matriz. Ese es el gate.

**Golden:** sin diff en `/comparable-overview`; el golden crece con los snapshots del endpoint nuevo.

---

### F4 — Corregir el fan-out de matrícula ⚠️ _cambia números_

**Cambio:** filtrar la matrícula en los tres joins que hoy no lo hacen:

- `comparable-unit.assembler.ts:213` (`loadByClassGroup`)
- `comparable-alerts.service.ts` → `bandRegressionAlerts`
- `comparable-alerts.service.ts` → `coverageAlerts` (`withResults`)

El criterio correcto es **la matrícula del año académico de la evaluación**, no `status = 'active'` a secas: un alumno retirado a mitad de año igual rindió, y su resultado tiene que seguir contando en el curso donde lo rindió. La forma es unir `student_enrollments.academic_year_id` con el año de la evaluación (vía `class_groups`/`assessments`), y sólo como desempate quedarse con la matrícula más reciente.

**Esta es la única fase que cambia lo que ve el usuario, y es a propósito:** hoy un alumno matriculado en 2025 y 2026 aparece en dos cursos a la vez y su porcentaje se promedia dos veces. Medido: 2.164 filas donde hay 1.082 resultados.

**Validación — la más exigente de la épica:**

1. **Fuente independiente**, no el golden: para 3 evaluaciones PAES y 3 DIA, contrastar `studentsAssessed` y `averageAchievement` por curso contra una consulta SQL escrita a mano que cuente `distinct student_id` sin pasar por `student_enrollments`. Los números nuevos tienen que coincidir con esa cuenta; los viejos no van a coincidir.
2. **Regresión dirigida:** un alumno que sólo tiene matrícula en un año no puede cambiar de valor. Aislar uno y verificar que su curso reporta exactamente lo mismo antes y después.
3. Spec nuevo del assembler (el primero de ese archivo) con un caso de doble matrícula.

**Hallazgo que F4 destapa y NO corrige** (queda para un ticket aparte): validando el resultado apareció que `studentsAssessed` de una unidad **suma los alumnos de cada aplicación**, así que un instrumento con dos aplicaciones a los mismos 81 alumnos reporta 162. Es la cifra que alimenta la tarjeta "Alumnos evaluados". Corregirlo cambia un número visible de la portada y merece su propia decisión de producto — no se cuela dentro de una fase de performance.

**Diff esperado en el golden:** cambian `byClassGroup`, `studentsAssessed` de las unidades y las alertas derivadas de cursos. **Se re-baseliza el golden después de F4**, y se deja registro en §5 de qué cambió y por qué. Ninguna fase posterior puede volver a mover estos números.

---

### F5 — Colapsar el N+1 y paralelizar

**Cambio, en tres pasos dentro de la misma fase (pero verificando entre paso y paso):**

1. `loadUnitLevelCounts`: reemplazar el `for` de una query por evaluación por **una sola query** con `inArray(assessmentIds)` agrupando por banda. (Requiere que `loadCohortLevelCounts` acepte varios `assessmentId`; se agrega la variante en `cohort-level-stats.helper.ts` sin romper la firma actual, que otros llaman.)
2. `attachBaselines`: hoy hace `baselineAchievement` por unidad → **una** query para todos los `assessmentIds` de todos los baselines, y repartir en memoria.
3. El `for` de `comparable-overview.service.ts:80`: `Promise.all` sobre las unidades. Con las bandas ya precargadas en una sola query por todos los instrumentos (`loadInstrumentBands` → variante por lote).

**Meta:** de ~110 queries a **≤ 12** por request.

**Invariantes que no se pueden romper:**

- El **orden final de `units`** lo fija el `sort` por severidad y recencia posterior al loop — `Promise.all` no lo afecta, pero hay que confirmarlo en el diff.
- El **orden de `alerts`** (ver la nota de F2): los generadores se siguen llamando en el mismo orden.
- Los promedios se calculan con las mismas sumas y en el mismo orden (`foldAchievement` itera `assessmentIds`, no el resultado de la query): si un valor cambia en el último decimal, es que se cambió el orden de la suma.

**Golden:** **byte-idéntico**. Esta es la fase donde el golden justifica todo el plan: es un refactor grande sobre dos archivos sin tests.

**Métrica a anotar:** queries por request y tiempo del endpoint, antes y después, para los 7 alcances.

---

### F6 — Agregar en SQL en vez de en Node

**Cambio:** `loadByClassGroup` deja de traer una fila por resultado y pasa a `group by class_group_id` en SQL (promedio, `count(distinct student_id)`, y el conteo de banda inferior con un `filter (where …)`). Mismo tratamiento para el fallback de `resolveBandDistribution`.

**Sutileza que hay que preservar:** hoy la banda de un alumno sale de `performance_band_id` **o**, si es null, de clasificar su `percentage` con las bandas del instrumento (`classifyPercentage`). Esa clasificación vive en `@soe/types` (`classifyByBands`) y **no se replica en SQL**: se resuelve trayendo sólo las filas con `performance_band_id IS NULL` (que son pocas) y agregando el resto en SQL. Reimplementar la clasificación en SQL duplicaría la regla en dos lenguajes — exactamente lo que prohíbe el DRY del proyecto.

**Golden:** byte-idéntico. Incluido el orden de `byClassGroup` (hoy ordena por logro ascendente, con `?? 101` para los nulos: ese criterio se conserva tal cual).

---

### F7 — Transporte

**Se hizo la mitad que la medición sostuvo, y se descartó la otra.**

1. **`compression` en `apps/api/src/main.ts`** — hecho. Verificado contra la API compilada y corriendo: el panorama PAES pasa de **39.674 a 5.687 bytes** (−86%) y el refresco de alertas queda en **1.412 bytes**.
2. **`prefetch={false}` en `PageTabs`** — **descartado, no aplica.** Las 6 tabs de `/resultados` tienen su `loading.tsx`, así que el prefetch por defecto de Next 15 se detiene en ese shell estático y no dispara la carga de datos. Tocarlo sólo habría empeorado la navegación entre tabs.

**Por qué la compresión sigue valiendo aunque no sea lo que ve el colegio:** la distribución de CloudFront ya comprime hacia el navegador (`DefaultCacheBehavior.Compress: true`, verificado en la cuenta). Lo que no estaba comprimido es el hop **Lambda (OpenNext) → App Runner**, por donde pasa todo lo que el front pide server-side, y la API directa que consume el servidor MCP por internet.

---

## 5. Registro de métricas (se llena a medida que se avanza)

Tres cifras por fase y por alcance: queries por request · ms del endpoint · KB del JSON.

| Fase          | CSCJ sin filtro | CSCJ PAES | CSCJ DIA | Golden              |
| ------------- | --------------- | --------- | -------- | ------------------- |
| F0 (baseline) |                 |           |          | —                   |
| F1            |                 |           |          | sin diff            |
| F2            |                 |           |          | truncado (esperado) |
| F3            |                 |           |          | sin diff            |
| F4            |                 |           |          | **re-baseline**     |
| F5            |                 |           |          | sin diff            |
| F6            |                 |           |          | sin diff            |
| F7            |                 |           |          | sin diff            |

---

## 5 bis. Comparación medida contra la versión anterior (F8)

Las métricas de arriba comparan cada fase con la anterior. Esta sección compara **la épica completa contra el código previo**, con los dos corriendo contra la misma BDD y desde la misma máquina, y extiende la verificación a los **otros dos consumidores** del assembler, que el snapshot del panorama no cubría: la trayectoria comparable y la comparación de un alumno.

La herramienta es `apps/api/scripts/bench-panorama.ts` (11 casos, mide queries, ms y bytes); se corre desde un worktree en el commit base y desde el de la épica.

| Caso                            | Queries antes → después | Bytes antes → después |
| ------------------------------- | ----------------------- | --------------------- |
| Panorama, alcance completo      | **610 → 24**            | 1.008 KB → 297 KB     |
| Panorama, PAES                  | 61 → 21                 | 288 KB → 51 KB        |
| Panorama, DIA                   | 566 → 24                | 720 KB → 259 KB       |
| Panorama, profesor              | 42 → 24                 | 174 KB → 31 KB        |
| Trayectoria (2 casos)           | 42 → 43 · 40 → 41       | igual                 |
| Comparación de alumno (2 casos) | 29 → 33                 | igual                 |

**Los dos últimos empeoran y hay que decirlo:** el desglose por curso pasó de 1 query a 2 (totales + clasificación), y la comparación de alumno lo llama cuatro veces. Son +1 query por llamada; en producción, ~1-2 ms cada una. Se descartó mantener el camino viejo para esos consumidores: sería la misma lógica escrita dos veces.

**Los tiempos absolutos de esas corridas no sirven como referencia de producción:** por el túnel SST cada query cuesta ~150 ms de ida y vuelta (medido: mediana 150 ms, p90 165 ms), así que el reloj mide sobre todo el túnel. Sirven para comparar entre sí, no para prometer una cifra.

**El "antes" de producción, ese sí medido** contra la API desplegada en el demo (App Runner, código previo a la épica):

| Alcance     | Primer byte   | Bytes   |
| ----------- | ------------- | ------- |
| PAES        | 1,85 – 1,91 s | 240.646 |
| Sin filtros | 5,73 – 7,86 s | 810.789 |

Sin `content-encoding` en la respuesta: la API desplegada **no comprime** (lo que arregla F7). El "después" de producción sólo se puede medir tras el deploy, contra esta misma línea base.

### Lo que cambió en los otros dos consumidores

El fan-out de F4 los afectaba a ellos también, así que su salida cambió — a mejor:

- **Trayectoria:** el desglose por curso deja de repetir cada curso una vez por año cursado.
- **Comparación de un alumno:** la cohorte de nivel contra la que se compara al alumno pasa de 149 a 76 alumnos en Matemáticas, y su etiqueta de **"6° Básico" a "7° Básico"** — que es el nivel del instrumento ancla (`DIA Matemática 7° Básico 2026 — Intermedio`). Antes comparaba al alumno contra una cohorte mal rotulada y con el doble de gente.

Fuera de eso, la comparación campo a campo de los 11 casos no muestra ninguna otra diferencia estructural: sólo el truncado de alertas (F2), `alertsTotal` (F2) y ruido de punto flotante.

---

## 6. Fuera del alcance de esta épica

- **La caída de sesión** que menciona el mismo comentario ("se me cayó varias veces"). Puede ser el timeout de App Runner o la conexión del colegio; se investiga con los logs de la API de la ventana 2026-09-08 ~15:29 hora Chile. Es un ticket aparte, no una fase.
- **Cachear el panorama** (Redis, `revalidate`). Es una respuesta distinta al mismo problema, y sólo tiene sentido evaluarla cuando el costo base esté corregido: cachear un cálculo que hace 110 queries innecesarias es esconder el problema.
- **Repaginar o virtualizar tablas** del hub. Otras vistas del hub (`tablero-maestro`, `mapa-calor`) pueden tener los mismos patrones; se revisan después, con el mismo método, no en esta épica.
