# Diseño: Tablero maestro por procesos y pruebas

2026-10-05 · Martín

## 1. Problema

El tablero maestro de CSCJ muestra **una sola opción PAES** ("Ensayo PAES 2026 · 65 evaluaciones") aunque se aplicaron 5 tandas. Además, junta M1 con M2 en una columna y Biología, Física y Química en otra. Hay dos causas en el código de `main` (lo desplegado), y ninguna es propia del PAES:

| Síntoma                                  | Causa                                                                                                                            | Dónde                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Las 5 tandas aparecen como una sola toma | La toma se identifica con `año + tipo + período`. Los PAES tienen `application_period = null`, así que todo cae en `2026:paes:_` | `master-board.service.ts` (`getTakes`) |
| Cada celda promedia el E1 con el E4      | Mismo motivo: la matriz agrega todas las evaluaciones de la toma                                                                 | `getMatrix`                            |
| M1 y M2 en una sola columna              | La columna es `instruments.subject_id`; las dos son `MATH`                                                                       | `getMatrix`                            |
| Bio, Fís y Quí en una sola columna       | Las tres menciones son `SCI`                                                                                                     | `getMatrix`                            |

La tanda solo está escrita en el **nombre** del instrumento ("— Ensayo 3 (Tanda 3)"), y la prueba específica en `config.subject` ("Competencia Matemática 2"). Las dos son texto libre, así que el sistema no tiene un dato estructurado del cual leerlas.

El mismo problema aparecerá en cualquier evaluación con **varias aplicaciones en el año** (ensayos SIMCE, mocks de Cambridge) o con **varias pruebas dentro de una asignatura** (Lectura y Escritura, Reading y Listening).

## 2. Lo que ya existe en dev

Dev ya trae dos piezas que resuelven la mitad del problema: una dice **cuándo** se aplicó algo (procesos de medición) y la otra dice **qué parte de la prueba** rindió cada alumno (secciones electivas). El tablero maestro no usa ninguna: su código es idéntico en `main` y en `dev`.

| Pieza                                                                                                                                                                                                            | Estado                                                        | Qué aporta                                                                                                                                                     | Qué le falta para este caso                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Procesos de medición** (PR #230): `measurement_processes` + `assessments.process_id` (1:N, nullable), `kind` (`dia`, `paes_ensayo`, `simce_ensayo`…), ventana, `expected_scope`                                | Mergeada a `dev`. **No está en ****main**** ni en demo**      | La entidad "Ensayo PAES 3". Ya filtra panorama, mapa de calor y análisis de ítems por `processId`. UI `/procesos` para vincular evaluaciones                   | El tablero maestro no la lee. El backfill agrupa por `(org, año, tipo, período)` y crearía **un solo** proceso PAES |
| **Secciones electivas** (PR #208): `instrument_sections.role` (`core`/`elective`), `elective_group`, `elective_key`; forma por alumno en `assessment_forms` / `assessment_form_students`; `resolveElectiveScope` | Mergeada a `dev`. Los datos de Ciencias **no están migrados** | Ciencias como **un** instrumento: 54 ítems comunes + 26 de la mención de cada alumno. La ingesta ya solo crea respuestas para los ítems que le tocan al alumno | Nada la expone en resultados: el tablero agrega por instrumento y no distingue tronco común de ramas                |
| **Bandas por instrumento**                                                                                                                                                                                       | En `main`                                                     | Cortes de nivel propios de cada instrumento                                                                                                                    | `resolveTomaThresholds` toma **un** set de umbrales para toda la toma (`limit 1`)                                   |
| **Alcance docente**                                                                                                                                                                                              | En `main`                                                     | Pares (curso, asignatura) + jefatura                                                                                                                           | Funciona por asignatura. Cualquier columna nueva tiene que seguir colgando de una asignatura                        |

**Estado de los datos de Ciencias en demo:** hoy hay 9 instrumentos separados (3 menciones × E1, E3 y E4), cada uno con sus 80 ítems. El runbook que los fusiona en un instrumento con electivas (`docs/runbook-migracion-ciencias-electivas.md`) está pendiente por tres bloqueos: figuras, matrícula del electivo e ítems faltantes de E1 y E4. **El diseño tiene que funcionar con los dos modelos**, porque van a convivir un tiempo.

## 3. Modelo propuesto

El tablero pasa a tener dos ejes explícitos: **la toma es un proceso de medición** y **la columna es una prueba**. Una prueba es una asignatura, o una línea dentro de ella cuando hay más de una. Ningún nombre de instrumento aparece en el código: todo sale de datos.

### 3.1 Toma = proceso de medición

- La clave de la toma es `process:<process_id>`.
- Las evaluaciones sin proceso caen en la clave actual, `legacy:<año>:<tipo>:<período>`. Así nada de lo ya cargado desaparece del dropdown mientras se completa el backfill.
- La etiqueta es `measurement_processes.name` ("Ensayo PAES 3 · 2026"). El orden es por fecha de aplicación, la más reciente primero, y esa es la toma por defecto.
- El dropdown agrupa por año y, dentro del año, por `kind` (DIA, Ensayos PAES, Ensayos SIMCE…).

### 3.2 Columna = prueba, en tres niveles de respaldo

Se agrega un catálogo pequeño de **líneas de prueba** (`test_tracks`). Cada ítem cae en la columna de la primera regla que se cumpla:

1. **La sección del ítem declara línea** (`instrument_sections.track_id`) → esa línea. Cubre el tronco común y las ramas de un instrumento con electivas: Ciencias común, Biología, Física, Química.
2. **El instrumento declara línea** (`instruments.track_id`) → esa línea. Cubre M1 y M2, y también los 9 instrumentos de Ciencias por mención mientras no se migren.
3. **Ninguno declara** → la asignatura, como hoy. Es todo el DIA: sin cambios.

La línea siempre pertenece a una asignatura (`test_tracks.subject_id NOT NULL`). Por eso el encabezado tiene dos niveles (asignatura → pruebas) y **el alcance docente no cambia**: el profesor de Matemática ve M1 y M2 porque las dos cuelgan de `MATH`.

```
            | Lenguaje |   Matemática    | Historia |              Ciencias               |
            |    CL    |   M1   |   M2   |   HIS    | Común  |  Bio   |  Fís   |  Quí   |
origen:      asignatura  instr.   instr.  asignatura  sección  sección  sección  sección
```

Encabezado de la toma "Ensayo PAES 3" con Ciencias ya migrada a tronco común + menciones. Sin total de Ciencias: Común y cada mención se leen por separado.

Hoy, antes del runbook de Ciencias, Bio, Fís y Quí salen de la línea del instrumento y no hay columna Común. Esa columna aparece sola cuando se migra.

### 3.3 Catálogo `test_tracks`

| Columna                     | Tipo            | Nota                                                                   |
| --------------------------- | --------------- | ---------------------------------------------------------------------- |
| `id`                        | `uuid` PK       |                                                                        |
| `org_id`                    | `uuid` nullable | `null` = oficial y compartida (patrón de `instruments`)                |
| `subject_id`                | `uuid` NOT NULL | Ancla la línea al alcance docente                                      |
| `code`                      | `text`          | `M1`, `M2`, `CIE-COMUN`, `BIO`. Único por `(org_id, subject_id, code)` |
| `name` / `short_name`       | `text`          | "Competencia Matemática 2" / "M2"                                      |
| `order`                     | `integer`       | Orden de las columnas dentro de la asignatura                          |
| `created_at` / `updated_at` | `timestamp`     |                                                                        |

Es una tabla y no un enum ni JSONB porque se agrupa y se ordena en SQL (CLAUDE.md §5.4) y porque la misma línea tiene que reconocerse entre tandas: M1 del E1 y M1 del E5 apuntan al mismo `track_id`. Eso deja lista la trayectoria por línea sin más cambios de schema.

### 3.4 Métricas por columna

- **% de logro:** `sum(score_sum) / sum(max_sum)` sobre los ítems de la columna, igual que hoy pero con otro `GROUP BY`. En una rama electiva solo cuentan quienes la rindieron, porque la ingesta ya no crea respuestas fuera del alcance del alumno.
- **Alumnos evaluados:** `max(student_count)` sobre los ítems de la columna. Si un mismo curso tiene más de una evaluación en la columna (recuperativo, formas), se expone `assessmentIds.length` porque el `max` subcuenta.
- **Niveles y comparabilidad por celda (grado × prueba)**, no por columna. Una columna cruza grados y cada grado tiene su instrumento, así que por columna seguiría saliendo "mixta". La celda normalmente tiene un solo instrumento: usa sus `performance_bands` (I/II/III en el DIA). La fila de curso hereda las de su grado. Una celda-sección (común o mención) muestra solo el %.
- **Celda mixta:** si en una celda caen dos instrumentos distintos sin línea, no se suman en silencio: la celda se marca "mixta".
- **Sin total de asignatura** cuando la asignatura tiene más de una prueba. Promediar M1 con M2, o Biología con Física, es justo el error que este diseño corrige.

## 4. Cambios de API

El contrato del tablero cambia en tres puntos: la toma se identifica por proceso, las celdas se indexan por prueba en vez de por asignatura, y la comparabilidad y los umbrales pasan a calcularse por columna. Todo vive en `packages/types/src/schemas/master-board.schema.ts` y `apps/api/src/master-board/`.

### 4.1 DTOs (`master-board.schema.ts`)

| Tipo                                        | Cambio                                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `masterBoardMatrixQuerySchema`              | Agrega `processId: z.string().uuid().optional()`. Se mantienen `academicYearId` + `instrumentType` + `applicationPeriod` para las tomas legacy. Pasa a `.strict()`: hoy una clave mal escrita se descarta sin error y el filtro no filtra |
| `masterBoardTakesQuerySchema`               | Sin cambios de entrada                                                                                                                                                                                                                    |
| `MasterBoardTake`                           | `key` pasa a `process:<id>` o `legacy:<año>:<tipo>:<período>`. Agrega `processId: string \| null`, `processKind`, `administeredFrom` y `administeredTo` (para ordenar y mostrar la ventana)                                               |
| `MasterBoardSubject`                        | Agrega `tests: MasterBoardTest[]`. Una asignatura sin líneas trae un solo test, con la clave de la asignatura                                                                                                                             |
| `MasterBoardTest` (nuevo)                   | `testKey`, `trackId \| null`, `source: 'subject' \| 'instrument' \| 'section'`, `name`, `shortName`, `order`, `comparability`, `hasLevels`                                                                                                |
| `MasterBoardCell` / `MasterBoardCourseCell` | `subjectId` se mantiene (alcance y profesor) y se agrega `testKey`. La celda se busca por `testKey`                                                                                                                                       |

`testKey` es `track:<track_id>` o `subject:<subject_id>`. Es estable entre tandas: la columna M1 tiene la misma clave en el E1 y en el E5.

### 4.2 `getTakes`

- Mismo origen de datos: `assessment_item_stats` (una toma solo aparece si tiene resultados).
- Hace `LEFT JOIN measurement_processes` por `assessments.process_id` y agrupa por `coalesce(process_id::text, año‖tipo‖período)`.
- Respeta `measurement_processes.deleted_at IS NULL`. Un proceso borrado devuelve sus evaluaciones a la toma legacy.
- Ordena por `max(administered_at)` descendente. La primera es la toma por defecto.

### 4.3 `getMatrix`

- `resolveTomaAssessments`: con `processId`, `assessments.process_id = :processId` dentro de `withOrgContext` y del alcance docente. Sin él, el camino legacy, que **excluye las evaluaciones que ya tienen proceso** para que no se dupliquen. `processId` tiene precedencia; combinarlo con otros parámetros de toma da 400.
- `loadMatrixRows`: agrega `INNER JOIN items` y `LEFT JOIN instrument_sections` por `items.section_id`. La clave de columna es `coalesce(instrument_sections.track_id, instruments.track_id)`, con la asignatura como respaldo. El `GROUP BY` pasa de `subjects.id` a `(subjects.id, column_key)`. Los joins van por PK y los índices necesarios ya existen.
- **Umbrales**: se reemplaza `resolveTomaThresholds`, que hoy lee `grading_scales` del instrumento más antiguo de la toma, por `resolveEffectiveBandsForInstruments` **por celda**. `MetricValue.level` pasa de un enum fijo de 4 niveles a una banda genérica (`key`, `label`, `order`, `color`).
- **Comparabilidad**: `ComparabilityInstrumentRef` y las tres claves de familia (`buildInstrumentFamilyKey`, `buildPeriodSeriesKey`, `buildInstrumentHistoryKey`) incorporan `trackId`. Sin eso, en Panorama y en la Vista 360 M2 compite como línea base de M1.

### 4.4 Lo que no cambia

- `RolesGuard`, `MASTER_BOARD_VIEWER_ROLES` y `resolveClassGroupScope`: el alcance sigue siendo por (curso, asignatura).
- `assessment_item_stats` no se toca. Ya tiene granularidad de ítem, que es lo que hace falta para agrupar por sección.
- `getTeacherPerformance` y `loadCourseSubjectStats` siguen por asignatura en esta entrega (ver §8).

## 5. Cambios de UI

La pantalla mantiene su forma (selector de toma + matriz nivel × asignatura). Cambian el contenido del selector, el encabezado y el aviso de comparabilidad. Los archivos están en `apps/web/src/app/(dashboard)/resultados/tablero-maestro/`.

- **Selector de toma** (`master-board-controls.tsx`): opciones agrupadas por año con `SelectGroup`, el nombre del proceso, su ventana de fechas y el número de evaluaciones. Las tomas legacy se muestran al final del año con la etiqueta actual. La URL pasa a `?processId=<uuid>`. Las URLs viejas (`academicYearId&instrumentType&applicationPeriod`) siguen funcionando porque el camino legacy se mantiene.
- **Toma por defecto** (`page.tsx`): la primera que devuelve `getTakes`, que ahora es la más reciente. Hoy es la primera por orden alfabético, y por eso siempre abre en DIA Diagnóstico.
- **Encabezado de dos niveles** (`master-board-table.tsx`): una fila con la asignatura (`colSpan` = nº de pruebas) y otra con la prueba (`M1`, `M2`, `Común`, `Bio`…). Si ninguna asignatura de la toma tiene más de una prueba, se dibuja una sola fila, como hoy. El DIA no cambia visualmente.
- **Celdas sin nivel**: una columna con `hasLevels: false` se pinta con escala neutra y muestra solo el %. Un tooltip explica por qué ("Sección de la prueba: sin cortes de nivel propios").
- **Aviso de comparabilidad**: `ComparabilityNotice` pasa a ser por columna, con un ícono en el encabezado de la prueba afectada, en vez de un aviso general sobre toda la toma.
- **Drill-down**: el click en una celda lleva a `evaluacionDetalle(assessmentId)?classGroupId=…` como hoy. En una columna-sección agrega `&sectionId=…` para que el detalle abra filtrado. Si el detalle aún no soporta ese filtro, se ignora sin romper.
- **Responsive**: con 7 o más columnas (caso PAES completo) la tabla hace scroll horizontal dentro de su contenedor, con la columna de nivel fija. La página no hace scroll horizontal.

## 6. Datos y migración

Hay que mover dos cosas: el schema de procesos de `dev` a `main`, y una migración nueva para las líneas. Después, los datos se completan con scripts idempotentes. Ninguno lleva lógica PAES: los PAES son una fila de datos más.

### 6.1 Schema

1. **Procesos a ****main**** (va primero).** Se trae `measurement_processes`, `assessments.process_id`, su política RLS y el módulo de API **en la misma PR**. El `rls-policies.sql` de `dev` ya referencia `measurement_processes`: si llega a `main` sin la tabla, el `db:migrate` del deploy falla sobre demo. La migración se **regenera sobre la cadena de ****main** (que termina en `0033`) y después `dev` regenera sus `0035`/`0036`.
2. **Líneas (migración nueva, después de procesos).** `test_tracks` + `instruments.track_id` + `instrument_sections.track_id`, nullable. Es inerte: con todo en `null` el tablero se comporta igual que hoy. `test_tracks` lleva **RLS con ****org_id IS NULL OR org_id = :org**, igual que `performance_bands`. Sin eso, el track privado de un colegio puesto sobre un instrumento oficial cambiaría el encabezado de todas las orgs.
3. **Restricciones:**
   - FK compuesta `(track_id, subject_id) → test_tracks(id, subject_id)` + `UNIQUE(id, subject_id)`: el track del instrumento es de su misma asignatura.
   - En `instrument_sections`: `elective ⇒ track_id NOT NULL` y `track_id IS NULL OR role = 'elective'`. Una sección de pasaje del DIA nunca parte una prueba; la sección core hereda el track del instrumento. La asignatura del track de sección se valida en servicio e importador.
   - Unicidad de `code` con `NULLS NOT DISTINCT` (o índice parcial si RDS no es PG ≥ 15).
   - Un instrumento oficial solo puede apuntar a tracks oficiales.

### 6.2 Catálogo y asignación de líneas

- **Catálogo**: un seed JSON en `packages/db/src/seed/` con las líneas oficiales (CL, M1, M2, HIS, CIE-COMUN, BIO, FIS, QUI y SPEAKING para el DIA), con el mismo patrón que el catálogo de taxonomía. Agregar SIMCE o Cambridge es agregar filas.
- **Contrato del importador**: el JSON de instrumento acepta `track` (código) a nivel de instrumento y de sección. `import-instruments` lo resuelve contra el catálogo y **falla en seco** si el código no existe.
- **El track se escribe en los JSON versionados** (`packages/db/data/instruments-paes/*`), no solo en la BDD. El importador borra y recrea por `sourceJson`: un backfill hecho solo en la BDD se pierde en la próxima importación.
- **Ciencias se migra a electivas antes de asignarle líneas** (decisión de §9). Los 9 instrumentos legacy no reciben track, así que nunca conviven 80 y 26 ítems bajo la misma línea.

### 6.3 Procesos: una regla genérica para el backfill

El backfill actual agrupa por `(org, año, tipo, período)`. Eso está bien cuando el período existe y mal cuando es `null`. Se propone una **invariante** en vez de una heurística de fechas:

> Un proceso no puede contener dos instrumentos distintos para el mismo (nivel, prueba).

Si un grupo candidato la viola, es señal de que hubo varias aplicaciones. El backfill **no lo asigna** y lo reporta como ambiguo. La misma invariante valida el "vincular evaluaciones" de `/procesos`, así un humano no puede volver a mezclar dos tandas.

Para los PAES 2026 de CSCJ esto deja 68 evaluaciones sin asignar. La tanda ya está como dato en `assessments.config.ensayo`, así que un script de datos crea "Ensayo PAES 1…5" y vincula sin leer nombres. Hacia adelante, el cargador PAES escribe `process_id` al cargar. La vinculación parcial se permite (decisión de §9), pero `linkAssessments` valida año, org e invariante, y la toma muestra "parcial" si quedan evaluaciones hermanas sin vincular.

### 6.4 Read-model y demo

- **M1 Ensayo 5** tiene 3 evaluaciones y 0 filas en `assessment_item_stats`. Hay que revisar si tiene respuestas y recalcularlo. Si no, la Tanda 5 mostrará solo M2.
- Un push a `main` corre migración + RLS + backfill sobre el RDS demo. Los scripts de datos (6.2 y 6.3) corren después, desde `origin/main`, porque `dev` tiene columnas que demo no tiene.
- Verificación de cierre: el dry-run de procesos debe reproducir los 64 del Monitoreo Intermedio 2026, y los 5 procesos PAES deben sumar las 68 evaluaciones sin repetir ninguna.

## 7. Plan de entrega

Son cinco PRs en orden. Los procesos van primero por la cadena de migraciones (§6.1), y la migración de Ciencias entra antes del tablero porque la columna Común es un requisito. Cada PR cierra con su verificación contra demo antes de pasar a la siguiente.

1. **PR A — Procesos a ****main**
   - Schema, RLS, módulo de API y UI `/procesos`, con la migración regenerada sobre `main` y el SQL de RLS en la misma PR.
   - Backfill con la invariante de §6.3; `linkAssessments` valida año, org e invariante.
   - Gate: el dry-run reproduce los 64 del Monitoreo Intermedio 2026 y reporta los PAES como ambiguos.

2. **PR B — Líneas de prueba**
   - Migración `test_tracks` (con RLS y restricciones de §6.1), seed del catálogo y `track` en el contrato del importador y en los JSON de M1, M2 y Speaking.
   - `trackId` en `ComparabilityInstrumentRef` y en las tres claves de familia (afecta a Panorama y Vista 360).
   - Gate: con `track_id` en `null` el DIA se ve idéntico (snapshot de la matriz antes y después). Panorama deja de tomar M2 como línea base de M1.

3. **PR C — Ciencias a secciones electivas**
   - Ejecutar `docs/runbook-migracion-ciencias-electivas.md`: resolver las 330 figuras (desacoplar la storage key de la posición), completar los ítems faltantes de E1 y E4, fusionar los 9 instrumentos en 3 y re-mapear las respuestas. La forma de cada alumno sale de `stats.version` de GradeCam, que ya está verificada.
   - Tracks: CIE-COMUN en la sección core; BIO, FIS y QUI en las electivas.
   - Gate: el % por alumno sobre su forma coincide con el de los 9 instrumentos legacy, y la columna Común suma toda la cohorte del ensayo.

4. **PR D — Tablero por proceso y prueba**
   - `processId` en DTOs y queries, tomas `process:` + `legacy:`, URLs viejas redirigidas, orden por fecha, selector agrupado, toma "parcial" y "sin resultados".
   - `MasterBoardTest`, encabezado de dos niveles, bandas y comparabilidad por celda, celda "mixta".
   - Gate: los 5 procesos PAES aparecen como tomas separadas y suman 68 evaluaciones. M1 y M2, y Común, Bio, Fís y Quí, salen en columnas separadas.

5. **PR E — Cargador PAES escribe proceso y línea**
   - Evita que la próxima tanda (o el próximo ensayo SIMCE) vuelva a quedar sin asignar.

Los datos de CSCJ (crear y vincular las 5 tandas desde `config.ensayo` y recalcular M1 E5) corren como operación aparte después de desplegar la PR A, desde `origin/main`.

La PR C es la de mayor riesgo y la que más puede demorarse. Si se atrasa, las PR A, B y D igual entregan las tandas separadas y M1/M2; mientras tanto Ciencias se ve como una sola columna marcada "mixta".

## 8. Riesgos y preguntas abiertas

### Riesgos

| Riesgo                                                                                                   | Mitigación                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| La migración de Ciencias (PR C) se demora por las figuras o los ítems faltantes                          | No bloquea las tandas ni M1/M2; Ciencias queda "mixta" mientras tanto                                      |
| Aplicar el corte de una banda al **promedio** de un curso es otra semántica que clasificar a cada alumno | Rotularlo como "nivel del promedio" en el tooltip; la distribución por alumno sigue en el detalle          |
| Un proceso vinculado a medias genera dos tomas con datos parciales                                       | Toma marcada "parcial" + validación de año, org e invariante en `linkAssessments`                          |
| La cobertura (`expected_scope`) sigue por asignatura: con M1 cargado y M2 faltante, MATH figura cubierta | Agregar `trackId?` opcional a la celda de `expected_scope` en una entrega posterior; documentarlo mientras |
| El desempeño docente (`/equipo/[userId]`) sigue mezclando M1 y M2 en un %                                | Documentado; se abre por prueba en una entrega posterior                                                   |
| Dos cadenas de migraciones (`main` y `dev`)                                                              | PR A primero, regenerada sobre `main`; luego `dev` regenera las suyas                                      |

### Decisiones tomadas

- [x] Track de sección: **FK explícita**, solo en secciones `elective` (CHECK). No se deriva de `elective_key`.
- [x] Total de asignatura con varias pruebas: **no se muestra**.
- [x] Niveles: **por celda (grado × prueba)** con las `performance_bands` del instrumento y un nivel genérico.
- [x] Instrumentos hermanos sin línea (Speaking vs Inglés escrito): **track propio**; cualquier otro cruce sin línea se marca "mixta".
- [x] Vinculación parcial a un proceso: **se permite y se marca "parcial"**, con validación de año, org e invariante.
- [x] Ciencias: **se prioriza la migración a electivas** (PR C) antes del tablero, porque la columna Común es clave. Los datos legacy de mención son válidos: la mención de cada alumno sale de `stats.version` de GradeCam.
- [x] Desempeño docente: **sigue por asignatura** en esta entrega.
- [x] Tomas legacy: **aparecen solo si quedan evaluaciones sin proceso**, con la etiqueta "sin proceso"; cuando todo está vinculado, desaparecen solas.
- [x] Creación de procesos: **los dos**. El cargador crea o reusa el proceso al cargar, y el coordinador lo crea o corrige desde `/procesos`.

### Fuera de alcance

Trayectoria por línea entre tandas (M1 del E1 al E5), equating entre menciones, bandas por sección y drill-down filtrado por sección (ninguna página de detalle lo soporta hoy). El modelo deja las cuatro posibles sin cambios de schema.

El diseño fue auditado contra el código de `main` y `dev` el 2026-10-05; los cambios de las secciones 3.4, 4.3, 6 y 7 vienen de esa auditoría.
