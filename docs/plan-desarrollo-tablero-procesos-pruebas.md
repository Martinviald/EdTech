# Plan de desarrollo — Tablero maestro por procesos y pruebas

**Diseño de referencia:** `docs/diseno-tablero-procesos-pruebas.md` (copia del documento de diseño, que incluye las decisiones cerradas y la auditoría del 2026-10-05).
**Rama:** `feat/tablero-procesos-pruebas`, creada desde `origin/main`. Worktree: `EdTech/wt-tablero-procesos`.
**Entregable:** una PR contra `main` que se pueda mergear, con el CI verde y una auditoría final sin hallazgos críticos ni altos.

El trabajo avanza fase a fase, sin intervención humana, hasta que la PR queda mergeable. Un orquestador coordina a los subagentes: reparte las fases, revisa cada gate y decide si se avanza. **Todo lo que escribe en la BDD demo (que es la de producción) queda fuera de la ejecución autónoma**, y corre después del merge con aprobación explícita (§4).

---

## 1. Reglas de ejecución

Estas reglas se copian en el brief de cada subagente.

### 1.1 Rama, commits y PR

- **Una sola rama y una sola PR.** Cada fase cierra con uno o más commits atómicos sobre la misma rama. La rama no tiene upstream configurado, así que el push es siempre explícito: `git push origin feat/tablero-procesos-pruebas`.
- **Antes de cada push**, en un paso aparte y nunca encadenado con el push, se consulta el estado de la PR: `gh pr list --head feat/tablero-procesos-pruebas --state all`. Si la PR está `MERGED` o `CLOSED`, no se pushea.
- Commits en español, imperativos, con el trailer de coautoría.
- **Los subagentes siempre commitean** antes de terminar. El trabajo que no se commitea se pierde.

### 1.2 Recursos de la máquina (8 GB de RAM)

- **Un proceso pesado a la vez.** Los subagentes trabajan en serie sobre el worktree, nunca dos en paralelo editando o compilando. Antes de lanzar algo pesado se verifica que no haya otro corriendo: `pgrep -fl "vue-tsc|tsc --build|vitest|jest|webpack|vite build|next build"`.
- Typecheck **por paquete** (`pnpm --filter @soe/<pkg> typecheck`) y tests **de un archivo** (`pnpm --filter @soe/<pkg> exec vitest run <archivo>`). La suite completa corre solo en el CI.
- Prohibido usar `--force` en builds y correr `pnpm format` global. Prettier se aplica solo sobre los archivos tocados: `npx prettier --write <archivos>`.

### 1.3 Convenciones del repo

- `.claude/CLAUDE.md`, `.claude/rules/backend/*` y `.claude/rules/frontend/*`, que están en `main`. En particular:
  - Cero comentarios en `apps/api`.
  - `reportServerError` en cada `catch`.
  - Un helper de un solo uso va como método privado.
  - Guards RBAC con las constantes de `access-policies.ts`.
- Zod en `packages/types`; los filtros nuevos se declaran en el DTO **y** se aplican en la query. `.strict()` en los DTOs que se tocan.
- Toda query a tablas con RLS va dentro de `withOrgContext`, y toda tabla sensible nueva lleva su política en `packages/db/sql/rls-policies.sql`.
- Migraciones con `pnpm db:generate` sobre la cadena de `main` (hoy termina en `0033`). Nunca se copia un `.sql` desde `dev`.
- Todo texto de UI, documentación y commits va en español neutro, con tuteo y sin voseo.

### 1.4 BDD demo

- **Durante el desarrollo, solo lectura:** `SELECT` y scripts con `--dry-run`. El túnel `sst tunnel` es compartido: si está arriba se reusa, y no se mata. Se conecta por la IP privada con `soe_admin` (ver la skill `demo-db-access`).
- Demo tiene el schema de `main`. Los scripts que necesiten tablas nuevas trabajan con fixtures exportados de demo, no contra demo.

### 1.5 Gates y criterio de parada

- Cada fase termina con un **gate verificable** (§3). El orquestador lo corre o lo revisa antes de avanzar.
- Si un gate falla, el orquestador le devuelve el problema al mismo subagente, una vez. Si vuelve a fallar, aplica la **degradación** prevista para esa fase y sigue. Si la fase no tiene degradación, se detiene y reporta.
- Las degradaciones se registran en la descripción de la PR.

---

## 2. Subagentes

Son pocos y cada uno con una responsabilidad clara. Ninguno corre en paralelo con otro que edite o compile.

| #   | Subagente              | Fases              | Por qué es uno aparte                                                                       |
| --- | ---------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| 1   | Portador de procesos   | F1                 | Requiere leer el diff completo de `dev` y separar lo de procesos de lo demás                |
| 2   | Esquema y tipos        | F2 + F5            | Migración, catálogo, importador, claves de comparabilidad y cargadores: todo en `packages/` |
| 3   | Extractor PAES         | F3a                | Trabajo con los PDF y las skills `extraer-*`, con un contexto muy distinto al del código    |
| 4   | Migración de Ciencias  | F3b–c              | Scripts de datos con verificación contra demo, en dry-run                                   |
| 5   | API del tablero        | F4a                | El backend de `master-board`                                                                |
| 6   | Web del tablero        | F4b                | El frontend de `tablero-maestro`                                                            |
| 7   | Reparador de CI        | F6 (si hace falta) | Solo se lanza si el CI falla                                                                |
| 8   | Auditor final          | F7                 | Revisión con ojos frescos de toda la PR                                                     |
| 9   | Reparador de auditoría | F7 (si hace falta) | Aplica los hallazgos que el auditor confirme                                                |

**Presupuesto:** 6 subagentes obligatorios (1–6 y 8) más hasta 3 condicionales. El orquestador no delega lo que es más barato hacer directamente: la preparación, los gates, el push, la PR y el seguimiento del CI.

---

## 3. Fases

### F0 — Preparación (orquestador)

1. Copiar el documento de diseño a `docs/diseno-tablero-procesos-pruebas.md`.
2. **Golden de regresión del DIA.** Un script de solo lectura (`packages/db/src/scripts/golden-master-board.ts`) reproduce la query actual de `loadMatrixRows` y `getTakes` y la guarda en `docs/golden/master-board-cscj.json`. Cubre, para cada toma DIA de CSCJ, la suma de `score_sum` y `max_sum` y el máximo de `student_count` por (curso, asignatura), más el listado de tomas.
3. **Fixtures.** Exportar de demo las filas `assessments ⨝ instruments ⨝ class_groups` de CSCJ que necesita el agrupador de procesos (`packages/db/src/scripts/__fixtures__/process-candidates-cscj.json`). Solo campos no sensibles: ids, tipo, período, grado, asignatura, fechas y `config.ensayo`.
4. Commit: `docs: diseño y plan del tablero por procesos y pruebas`.

**Gate:** el golden tiene las 5 tomas DIA de CSCJ y el fixture incluye las 68 evaluaciones PAES.

### F1 — Procesos de medición a `main` (subagente 1)

**Alcance:** traer desde `dev` todo lo de procesos y nada más. Son PR #230 y sus seguimientos: #243 (filtro del panorama), #262/#263 (preselección y previsualización), `7e0552e` (fix del filtro de `/evaluaciones`) y `f90b72f`. El subagente arma la lista exacta con `git log origin/main..origin/dev` y la deja en el commit.

1. Schema `measurement_processes`, `assessments.process_id`, enums y relaciones. **Migración regenerada en `main` como `0034`.**
2. Política RLS en `rls-policies.sql`, en el mismo commit que la tabla.
3. Módulo de API `measurement-processes`, usos de `processId` en dashboards, mapa de calor, análisis de ítems y `/evaluaciones`, y UI `/procesos`.
4. **Cambios nuevos, que no están en `dev`:**
   - **Invariante en el backfill:** se extrae el agrupador a una función pura, por ejemplo `groupProcessCandidates`. Un grupo con dos instrumentos distintos para el mismo (`class_groups.grade_id`, prueba) no se asigna y se reporta como ambiguo. La prueba es la asignatura hasta F2; F2 la amplía a la línea.
   - **`linkAssessments`** valida que la evaluación pertenezca a la org, que el año coincida con el del proceso y que se cumpla la invariante. Se permite vincular de forma parcial.
   - El slug único ignora los procesos borrados (índice parcial `WHERE deleted_at IS NULL`).

**Gate:**

- Typecheck en serie de `@soe/db`, `@soe/types`, `@soe/api` y `@soe/web`.
- Tests unitarios del agrupador contra el fixture de F0: el **Monitoreo Intermedio 2026 da 64** y las **68 evaluaciones PAES 2026 salen ambiguas**.
- Spec de `linkAssessments`: rechaza otro año, otra org y una violación de la invariante, y acepta una vinculación parcial.
- La migración `0034` es aditiva: solo `CREATE` y `ADD COLUMN` nullable.

**Degradación:** ninguna. F1 es requisito de todo lo demás.

### F2 — Líneas de prueba (subagente 2)

1. **Migración `0035`:**
   - Tabla `test_tracks`: `id`, `org_id` nullable, `subject_id` NOT NULL, `code`, `name`, `short_name`, `order` y timestamps.
   - `UNIQUE(org_id, subject_id, code) NULLS NOT DISTINCT` y `UNIQUE(id, subject_id)`. Si RDS no es PG ≥ 15, se usa un índice parcial.
   - `instruments.track_id` con la FK compuesta `(track_id, subject_id)`.
   - `instrument_sections.track_id` con los CHECK `role = 'elective' ⇒ track_id NOT NULL` y `track_id IS NULL OR role = 'elective'`.
2. **RLS** de `test_tracks` igual que la de `performance_bands` (`org_id IS NULL OR org_id = current`).
3. **Catálogo:** seed JSON con las líneas oficiales (`M1`, `M2`, `CIE-COMUN`, `BIO`, `FIS`, `QUI`, `SPEAKING`) y un script idempotente `db:seed:test-tracks`.
4. **Importador:** `track` opcional en el contrato del instrumento y de la sección. Lo resuelve contra el catálogo y falla en seco si el código no existe. Valida que la asignatura del track sea la del instrumento y que un instrumento oficial solo apunte a tracks oficiales.
5. **JSON versionados:** `track` en los JSON de M1 y M2 de `packages/db/data/instruments-paes*`, en los de DIA Speaking 5° y 6°, y en los demás instrumentos hermanos que el subagente encuentre (los reporta).
6. **Backfill de tracks** para los instrumentos ya cargados: script `db:backfill:tracks` que lee los JSON, con dry-run por defecto.
7. **Comparabilidad:** `trackId` en `ComparabilityInstrumentRef` y en `buildInstrumentFamilyKey`, `buildPeriodSeriesKey` y `buildInstrumentHistoryKey`. Se actualizan sus llamadores (`comparable-unit.assembler.ts`, `load-student-assessments.ts` y los demás que aparezcan con `git grep`).
8. El agrupador de F1 pasa a usar la prueba completa (línea o asignatura).

**Gate:**

- Typecheck en serie.
- Test de claves: M1 y M2 del mismo grado y tanda dan claves distintas, y un instrumento sin línea da la **misma clave que antes**.
- Test del importador: un código inexistente falla, y un track de otra asignatura falla.
- Los specs existentes del Panorama y de la Vista 360 pasan.
- El dry-run de `db:backfill:tracks` contra demo lista los instrumentos M1, M2 y Speaking esperados. En demo solo se lee: la columna todavía no existe ahí, así que la comparación se hace contra el JSON.

**Degradación:** si el punto 7 rompe más specs de los que se pueden arreglar en un ciclo, se separa a otro commit y se reporta. No se omite, porque la auditoría lo marcó como hallazgo alto.

### F3 — Ciencias a secciones electivas (subagentes 3 y 4)

Se sigue `docs/runbook-migracion-ciencias-electivas.md`, con una diferencia: hoy **los 9 instrumentos tienen respuestas cargadas** (`loadKey=paes-2026-cie`), así que no se pueden borrar sin antes re-mapearlas.

**F3a — Ítems faltantes de E1 y E4 (subagente 3).** Con las skills `extraer-pruebas-pdf` y `extraer-fichas-tecnicas-dia`, se completan los ítems que la extracción no sacó: Biología de E1 tiene 78 de 80 y Química de E4 tiene 76 de 80. Los PDF están en `EdTech/ensayos-paes/`.

- **Gate:** la fusión cierra con **132 ítems** (54 + 3 × 26) en E1, E3 y E4. Cada ítem nuevo tiene clave y está cruzado contra las respuestas ya cargadas (`correct_count` plausible).

**F3b — Figuras (subagente 4).** Se desacopla la storage key de la posición: el ítem guarda su `storageKey` explícita, como la decisión de la sección Figuras del runbook. Así las 330 figuras existentes se reusan sin volver a subirlas.

- **Gate:** el dry-run resuelve **330/330** keys contra S3 (solo `HEAD`, sin escribir).

**F3c — Fusión y re-mapeo (subagente 4).** Script `db:migrate:cie-electivas`, idempotente, con dry-run por defecto y `--commit`.

1. Crea 3 instrumentos (uno por ensayo) con una sección `core` (track `CIE-COMUN`) y tres `elective` (`BIO`, `FIS`, `QUI`), cada una con `elective_group` y `elective_key`.
2. Crea `assessment_forms` y `assessment_form_students` con la mención de cada alumno. La mención es la del instrumento legacy en que tiene respuestas, que a su vez salió de `stats.version` de GradeCam.
3. Re-mapea cada `response` al ítem fusionado por `printedNumber` (el común del E1 se remapea por enunciado, como hace el conversor).
4. Recalcula `assessment_item_stats`, `assessment_results` y `skill_results`.
5. Hace soft delete de los 9 legacy (`deleted_at`). Las respuestas se re-apuntan, nunca se borran.
6. Reaplica los tags por `printedNumber`.

**Gate:** el dry-run contra demo (solo lectura, con todo calculado en memoria) reporta:

- el mismo % de logro por alumno que en el instrumento legacy, para el **100%** de los alumnos;
- `n` de la sección común = toda la cohorte del ensayo (76, 67 y 72 alumnos);
- 0 respuestas huérfanas y 0 alumnos sin forma.

**Degradación:** si F3a o F3b no cierran, F3c igual se entrega como script sin ejecutar y la PR declara a Ciencias como "mixta" hasta completarla. F4 no depende de F3: la columna Común aparece sola cuando se ejecute la migración.

### F4 — Tablero por proceso y prueba (subagentes 5 y 6)

**F4a — API (subagente 5).**

1. **DTOs:**
   - `processId` en el query de la matriz, con `.strict()`. Si `processId` llega junto con otros parámetros de toma, la respuesta es 400.
   - `MasterBoardTake` con `key` = `process:<id>` o `legacy:…`, más `processId`, `processKind`, ventana de fechas, `partial`, `hasResults` e `instrumentType` nullable.
   - `MasterBoardTest` y `testKey` en las celdas.
   - `MetricValue.level` pasa a una banda genérica (`key`, `label`, `order`, `color`).
2. **`getTakes`:**
   - Tomas de proceso, incluidas las que no tienen resultados (`hasResults: false`).
   - Tomas legacy **solo con las evaluaciones sin proceso**, con la etiqueta "sin proceso".
   - `partial` cuando quedan evaluaciones hermanas sin vincular.
   - Orden por `coalesce(max(administered_at), starts_on, created_at)`, la más reciente primero.
3. **Resolución de la toma:** `processId` primero. Si llega una URL legacy que calza con un proceso que contiene todas sus evaluaciones, la respuesta incluye `redirectProcessId`.
4. **`loadMatrixRows`:** se extrae a `queries/` con `JOIN items` y `LEFT JOIN instrument_sections`. La columna es `coalesce(section.track_id, instrument.track_id)` con la asignatura como respaldo, y el `GROUP BY` es `(subject, column_key)`.
5. **Por celda (grado × prueba):** bandas con `resolveEffectiveBandsForInstruments`, comparabilidad con `buildComparabilityMeta`, marca "mixta" si hay más de un instrumento sin línea, `hasLevels: false` en las celdas-sección y `assessmentIds.length` en los cursos con más de una evaluación.

**F4b — Web (subagente 6).**

- **Selector:** agrupado por año, con nombre, ventana de fechas, insignias "parcial" y "sin resultados", y URL `?processId=`.
- **Redirección:** `page.tsx` redirige con `redirectProcessId` y la toma por defecto es la primera que devuelve la API.
- **Matriz:** encabezado de dos niveles (si ninguna asignatura tiene más de una prueba, se dibuja una sola fila, como hoy), colores por banda genérica, escala neutra en las celdas sin nivel, marca "mixta" y aviso de comparabilidad en el encabezado de cada prueba.
- **Responsive:** la tabla hace scroll horizontal dentro de su contenedor, con la columna de nivel fija.

**Gate:**

- Typecheck en serie de api y web.
- Specs del service: la toma por proceso, la legacy residual, la URL legacy con redirect, 400 por la combinación de parámetros, M1 y M2 en columnas separadas, celda mixta y celda-sección sin nivel.
- Tests de React Testing Library del encabezado y del selector.
- **Golden:** con todos los tracks en `null`, la nueva query reproduce `docs/golden/master-board-cscj.json` **bit a bit** en `score_sum`, `max_sum` y `studentsAssessed` por (curso, asignatura).

**Degradación:** ninguna. F4 es el núcleo de la PR.

### F5 — Cargadores escriben proceso y línea (subagente 2, retomado)

1. `import-paes-2026-responses.ts` e `import-dia-2026-responses.ts` crean o reusan el proceso (por slug, en la misma transacción) y escriben `process_id`. La tanda sale de `config.ensayo`, y para el DIA del período.
2. Script de datos `db:backfill:processes:cscj-2026`: crea "Ensayo PAES 1…5 2026" desde `assessments.config.ensayo` y vincula las 68 evaluaciones, con dry-run por defecto.

**Gate:** el dry-run contra el fixture de F0 produce 5 procesos que suman 68 evaluaciones sin repetir ninguna, y la invariante se cumple en cada uno.

### F6 — Integración y CI (orquestador; subagente 7 si hace falta)

1. `git fetch` y rebase sobre `origin/main`. Si `main` sumó migraciones, se borran las propias y se **regeneran**.
2. Verificar el estado de la PR (paso aparte), pushear y abrir la PR contra `main` con `gh pr create`. La descripción lleva el resumen por fase, las degradaciones aplicadas y el procedimiento post-merge de §4.
3. Esperar el CI. Para dar la PR por verde se exige **número de checks > 0** y `mergeStateStatus = CLEAN`. "No checks" significa conflicto, no "esperando".
4. Si el CI falla, el subagente 7 recibe el log del job y lo corrige. Máximo 3 ciclos.

### F7 — Auditoría final (subagente 8; subagente 9 si hace falta)

**Auditor con contexto fresco.** Recibe el diseño, el plan y el diff completo contra `main`, y revisa:

- correctitud y regresiones (en especial el DIA y las vistas que usan las claves de comparabilidad);
- multi-tenant: RLS de `test_tracks` y de `measurement_processes`, y `processId` validado contra la org;
- migraciones aditivas, inertes con `null` y numeradas sobre `main`;
- rendimiento de `getTakes` y `getMatrix`;
- reglas de `.claude/rules`;
- cobertura de los tests y conformidad con el diseño, incluidas las decisiones cerradas.

Entrega hallazgos clasificados y verificados, con archivo y línea.

**Ciclo de cierre:**

- Los hallazgos críticos y altos los corrige el subagente 9.
- Los medios se corrigen si cuestan poco; si no, se documentan en la PR.
- Después de las correcciones, el CI vuelve a correr. Si hubo críticos, el auditor hace una **re-auditoría acotada** al delta. Máximo 2 ciclos.

**Gate final:** CI verde con más de 0 checks, `mergeStateStatus = CLEAN`, sin hallazgos críticos ni altos abiertos y la descripción de la PR actualizada. Ahí se entrega la PR.

---

## 4. Post-merge (requiere aprobación explícita, no es autónomo)

El push a `main` corre la migración, el RLS y el backfill sobre el RDS demo. Las operaciones de datos van después, en este orden, cada una con dry-run antes de `--commit`:

1. `db:seed:test-tracks` (catálogo).
2. `db:backfill:tracks` (M1, M2, Speaking…).
3. `db:backfill:processes` (genérico, con la invariante) y `db:backfill:processes:cscj-2026` (las 5 tandas PAES).
4. `db:migrate:cie-electivas --commit`, si F3 cerró sin degradación.
5. Recalcular el read-model de M1 E5, que hoy tiene 0 filas en `assessment_item_stats`.
6. **Sincronizar `dev`:** regenerar sus migraciones `0034+` sobre la nueva cadena de `main`, en una PR aparte contra `dev`.

---

## 5. Riesgos del plan

| Riesgo                                                                | Mitigación                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| El portado de procesos arrastra cosas de `dev` que no son de procesos | El subagente 1 deja la lista de commits portados. El auditor la revisa contra `git log`    |
| F3a no logra completar los ítems faltantes desde los PDF              | Degradación: Ciencias queda "mixta" y el script se entrega sin ejecutar                    |
| `main` se mueve durante el desarrollo                                 | Rebase en F6 y migraciones regeneradas, nunca arrastradas                                  |
| La máquina se satura                                                  | Un proceso pesado a la vez, subagentes en serie y tests de la suite completa solo en el CI |
| El golden del DIA no reproduce bit a bit                              | Bloquea F4: es la garantía de que el DIA no cambia                                         |
