# Plan de desarrollo — Tablero maestro por procesos y pruebas

**Diseño de referencia:** `docs/diseno-tablero-procesos-pruebas.md` (copia del documento de diseño, con las decisiones cerradas y la auditoría del 2026-10-05).
**Rama:** `feat/tablero-procesos-pruebas`, creada desde `origin/main`. Worktree: `EdTech/wt-tablero-procesos`.
**Entregable:** una PR contra `main` lista para mergear: CI verde, `mergeStateStatus = CLEAN` y una auditoría final sin hallazgos críticos ni altos abiertos.

## Alcance: todo local, nada de AWS

El desarrollo y todas las verificaciones corren **en esta máquina**, contra una BDD local de pruebas. Lo único que sale de la máquina es el push de la rama y la PR a GitHub. El CI de las PRs (`ci.yml`, `pull_request`) no toca AWS: los workflows de deploy solo corren con push a `main`, es decir, al mergear.

**Prohibido durante toda la ejecución:**

- Cualquier comando `aws`, `sst` (incluido `sst tunnel`) o lectura de secrets.
- Cualquier conexión a la BDD demo/RDS o a S3.
- Mergear la PR o pushear a `main`.

**Fuera de este plan (se ve con el usuario):** el despliegue, la migración en demo y las operaciones de datos sobre producción. El plan entrega esas operaciones como scripts probados en local, más un runbook (`docs/runbook-tablero-procesos-pruebas.md`) para ejecutarlas juntos.

El trabajo avanza fase a fase sin intervención humana. Un orquestador coordina a los subagentes: reparte las fases, revisa cada gate y decide si se avanza.

---

## 1. Reglas de ejecución

Estas reglas se copian en el brief de cada subagente.

### 1.1 Rama, commits y PR

- **Una sola rama y una sola PR.** Cada fase cierra con uno o más commits atómicos sobre la misma rama.
- La rama no tiene upstream configurado. El push es siempre explícito: `git push origin feat/tablero-procesos-pruebas`.
- **Antes de cada push**, en un paso aparte y nunca encadenado, se consulta el estado de la PR con `gh pr list --head feat/tablero-procesos-pruebas --state all`. Si está `MERGED` o `CLOSED`, no se pushea.
- Commits en español, en imperativo, con el trailer de coautoría.
- **Los subagentes siempre commitean** antes de terminar.

### 1.2 Recursos de la máquina (8 GB de RAM)

- **Un proceso pesado a la vez.** Los subagentes trabajan en serie sobre el worktree, nunca dos en paralelo. Antes de lanzar algo pesado se verifica que no haya otro corriendo: `pgrep -fl "vue-tsc|tsc --build|vitest|jest|webpack|vite build|next build"`.
- Typecheck **por paquete** (`pnpm --filter @soe/<pkg> typecheck`).
- Tests **de un archivo**: `pnpm --filter @soe/api test -- <ruta>` en la API (Jest) o `pnpm --filter @soe/<pkg> exec vitest run <archivo>` en los paquetes. La suite completa solo corre en el CI.
- Prohibido usar `--force` en builds y correr `pnpm format` global. Prettier solo sobre los archivos tocados: `npx prettier --write <archivos>`.

### 1.3 Convenciones del repo

- `CLAUDE.md`, `.claude/rules/backend/*` y `.claude/rules/frontend/*`. En particular:
  - Cero comentarios en `apps/api`.
  - `reportServerError` solo para errores no controlados.
  - Un helper de un solo uso va como método privado.
  - Sin O(N²) accidental.
  - Constantes de `access-policies`.
  - `useTransition` + `TopProgressBar` en los filtros.
- Zod en `packages/types`; todo filtro nuevo se declara en el DTO **y** se aplica en la query. `.strict()` en los DTOs que se tocan.
- Toda query a una tabla con RLS va dentro de `withOrgContext`, y toda tabla nueva con datos por org lleva su política en `packages/db/sql/rls-policies.sql`.
- **Migraciones** con `pnpm db:generate` sobre la cadena de `main`, que hoy termina en `0033`. Nunca se copia un `.sql` desde `dev`.
- **Compatibles con PostgreSQL 14:** la BDD local es 14.13 y no se puede verificar la versión de demo. No se usa `NULLS NOT DISTINCT`; la unicidad con `org_id` nullable se resuelve con dos índices únicos parciales.
- Todo texto de UI, documentación y commits va en español neutro, con tuteo y sin voseo.

### 1.4 BDD local de pruebas (`soe_tablero`)

- Se crea en F0 una BDD **nueva**, `soe_tablero`, en el Postgres local (`localhost:5432`). **No se toca `soe_dev`**: es la BDD de desarrollo del usuario y tiene un schema más avanzado que `main`.
- Migra con las migraciones de la rama y se puebla con datos que ya están en el disco (§F0). Es la base de todos los gates y se puede recrear desde cero con un script (`scripts/tablero/crear-bd-pruebas.sh`).
- **RLS:** el rol local `macbook` es superusuario y saltea RLS. Todo test de aislamiento corre como `soe_app` (existe localmente, sin `BYPASSRLS`).
- Los datos personales de alumnos se quedan en esa BDD local. No se commitean: los fixtures que entran al repo se anonimizan (ids, tipo, período, grado, asignatura, fechas, `config.ensayo`; sin nombres ni RUT).

### 1.5 Gates y criterio de parada

- Cada fase termina con un **gate verificable** (§3) que corre contra `soe_tablero` o contra tests.
- Si un gate falla, el orquestador le devuelve el problema al mismo subagente, una vez. Si vuelve a fallar, aplica la **degradación** prevista para la fase. Si la fase no tiene degradación, se detiene y reporta.
- Las degradaciones se registran en la descripción de la PR.

---

## 2. Subagentes

| #   | Subagente             | Fases                   | Por qué es uno aparte                                                                    |
| --- | --------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Banco de pruebas      | F0                      | Armar `soe_tablero` con los loaders existentes requiere recorrer scripts y fuentes       |
| 2   | Portador de procesos  | F1                      | Leer el diff de `dev` y separar lo de procesos del resto                                 |
| 3   | Esquema y tipos       | F2 + F5                 | Migración, catálogo, importador, claves de comparabilidad y cargadores: todo `packages/` |
| 4   | Extractor PAES        | F3a                     | Trabajo con los PDF y las skills `extraer-*`                                             |
| 5   | Migración de Ciencias | F3b–c                   | Scripts de datos con verificación en `soe_tablero`                                       |
| 6   | API del tablero       | F4a                     | El backend de `master-board`                                                             |
| 7   | Web del tablero       | F4b                     | El frontend de `tablero-maestro`                                                         |
| 8   | Auditor final         | F7                      | Revisión con ojos frescos de toda la PR                                                  |
| 9   | Reparador             | F6 / F7 (si hace falta) | Arregla el CI o los hallazgos de la auditoría                                            |

**Presupuesto:** 8 subagentes obligatorios (1–8) más el reparador, que solo se lanza si hace falta. El orquestador hace directamente lo que es más barato que delegar: copiar el diseño, correr los gates, pushear, abrir la PR y seguir el CI.

---

## 3. Fases

### F0 — Preparación y banco de pruebas (orquestador + subagente 1)

1. **Orquestador:** copia el documento de diseño a `docs/diseno-tablero-procesos-pruebas.md`.
2. **Subagente 1:** crea `soe_tablero` y la puebla con el código de `main`, todavía sin cambios. Usa solo fuentes locales:
   - Migraciones de la rama (`0000`–`0033`) y RLS (`db:migrate`).
   - Seeds base: organizaciones, grados, asignaturas, taxonomías y escalas.
   - Nómina CSCJ: `scripts/cscj/01-extract-roster.cjs` → `scripts/cscj/out/roster-active.json`. Si no está la nómina 2026, se usa la 2025 con la promoción de curso que ya hace el pipeline.
   - Instrumentos: los JSON del repo (`packages/db/data/instruments-paes/**`, con los 9 de CIE, y los DIA 2026 de `packages/db/data/instruments-2026*`).
   - Respuestas PAES y CIE: los escaneos de GradeCam en `EdTech/plataforma-dia-toolkit/data/gc_paes_2026/` y los artefactos (`artefacto_*.json`), con los loaders `import-paes-2026-responses.ts` y el conversor de CIE del runbook. Todo en local.
   - Respuestas DIA 2026: `import-dia-2026-responses.ts`, con los artefactos locales que existan.
   - Read-model: `assessment_item_stats` (backfill de cohort stats) y `performance_bands`, calculados localmente.
   - Todo queda en `scripts/tablero/crear-bd-pruebas.sh`, que recrea la BDD de cero y es idempotente.
3. **Golden de regresión.** Con el código de `main` y sobre `soe_tablero`, un script de solo lectura (`packages/db/src/scripts/golden-master-board.ts`) reproduce `getTakes` y `loadMatrixRows`. Por cada toma guarda la suma de `score_sum` y `max_sum` y el máximo de `student_count` por (curso, asignatura). Lo deja en `docs/golden/master-board-local.json`, sin datos personales.
4. **Fixture anonimizado** del agrupador de procesos: `packages/db/src/scripts/__fixtures__/process-candidates.json`.
5. Commit: `docs: diseño y plan del tablero por procesos y pruebas` + `chore: banco de pruebas local del tablero`.

**Gate:**

- `soe_tablero` tiene evaluaciones PAES de las **5 tandas** (con M1 y M2 en la misma tanda en al menos una) y las **3 menciones de CIE** en E1, E3 y E4.
- Tiene al menos **un período DIA con varias asignaturas**.
- El golden se genera sin errores.
- El orquestador anota en la PR los conteos reales del banco: son la referencia de los gates siguientes.

**Degradación:** si alguna fuente local falta, por ejemplo las respuestas DIA de un período, se completa con un **fixture sintético determinístico** de la misma forma (mismas tablas y relaciones, alumnos ficticios), generado por un script commiteado. Se documenta qué es real y qué es sintético.

### F1 — Procesos de medición a `main` (subagente 2)

**Alcance:** traer desde `dev` todo lo de procesos y nada más: PR #230 y sus seguimientos #243, #262, #263, `7e0552e` y `f90b72f`. El subagente arma la lista exacta con `git log origin/main..origin/dev` y la deja en el mensaje del commit.

1. Schema `measurement_processes`, `assessments.process_id`, enums y relaciones. **Migración regenerada en `main` como `0034`.**
2. Política RLS en `rls-policies.sql`, en el mismo commit que la tabla.
3. Módulo de API `measurement-processes`, el filtro `processId` en dashboards, mapa de calor, análisis de ítems y `/evaluaciones`, y la UI `/procesos`.
4. **Cambios nuevos, que no están en `dev`:**
   - **Invariante en el backfill.** El agrupador pasa a una función pura (`groupProcessCandidates`). Un grupo con dos instrumentos distintos para el mismo (`class_groups.grade_id`, prueba) no se asigna y se reporta como ambiguo. "Prueba" es la asignatura hasta F2.
   - **`linkAssessments`** valida org, año e invariante, y permite la vinculación parcial.
   - El slug único ignora los procesos borrados (índice parcial `WHERE deleted_at IS NULL`).

**Gate:**

- Typecheck en serie de `@soe/db`, `@soe/types`, `@soe/api` y `@soe/web`.
- `db:migrate` aplica `0034` sobre `soe_tablero` sin errores, y la migración es aditiva.
- Tests del agrupador con el fixture de F0:
  - cada período DIA del banco da **un proceso por (año, período)** con el conteo esperado;
  - las evaluaciones PAES salen **ambiguas** (varias tandas en un mismo (grado, asignatura)).
- Spec de `linkAssessments`: rechaza otro año, otra org y una violación de la invariante, y acepta una vinculación parcial.
- **RLS:** como `soe_app`, sin contexto, `measurement_processes` devuelve 0 filas; con contexto de otra org, también 0.
- El backfill corre con `--commit` sobre `soe_tablero` y es idempotente: la segunda corrida no cambia nada.

**Degradación:** ninguna. F1 es requisito de todo lo demás.

### F2 — Líneas de prueba (subagente 3)

1. **Migración `0035`:**
   - Tabla `test_tracks`: `id`, `org_id` nullable, `subject_id` NOT NULL, `code`, `name`, `short_name`, `order` y timestamps.
   - Unicidad con dos índices parciales: `(subject_id, code) WHERE org_id IS NULL` y `(org_id, subject_id, code) WHERE org_id IS NOT NULL`.
   - `UNIQUE(id, subject_id)`.
   - `instruments.track_id` con la FK compuesta `(track_id, subject_id)`.
   - `instrument_sections.track_id` con los CHECK `role = 'elective' ⇒ track_id NOT NULL` y `track_id IS NULL OR role = 'elective'`.
2. **RLS** de `test_tracks` igual que la de `performance_bands`: se ven las oficiales (`org_id IS NULL`) y las de la propia org.
3. **Catálogo:** seed JSON con las líneas oficiales (`M1`, `M2`, `CIE-COMUN`, `BIO`, `FIS`, `QUI`, `SPEAKING`) y el script idempotente `db:seed:test-tracks`.
4. **Importador:**
   - `track` opcional en el contrato del instrumento y de la sección, resuelto contra el catálogo. Falla en seco si el código no existe.
   - Valida que la asignatura del track sea la del instrumento.
   - Valida que un instrumento oficial solo apunte a tracks oficiales.
5. **JSON versionados:** se agrega `track` a los JSON de M1 y M2 (`packages/db/data/instruments-paes/`), a los de DIA Speaking 5° y 6°, y a cualquier otro instrumento hermano que aparezca (se reportan).
6. **Backfill de tracks** para instrumentos ya cargados: `db:backfill:tracks`, que lee los JSON, con dry-run por defecto.
7. **Comparabilidad:**
   - `trackId` en `ComparabilityInstrumentRef` y en `buildInstrumentFamilyKey`, `buildPeriodSeriesKey` y `buildInstrumentHistoryKey`.
   - Se actualizan los llamadores (`comparable-unit.assembler.ts`, `load-student-assessments.ts` y los demás que aparezcan con `git grep`).
8. El agrupador de F1 pasa a usar la prueba completa: línea, o asignatura si no hay línea.

**Gate:**

- Typecheck en serie.
- `0035` se aplica sobre `soe_tablero`, y `db:seed:test-tracks` + `db:backfill:tracks --commit` asignan M1, M2 y Speaking. Una segunda corrida no cambia nada.
- **Las restricciones funcionan:** en SQL de prueba, la BDD rechaza un track de otra asignatura, un track en una sección core y un código oficial duplicado.
- **RLS:** como `soe_app`, una org no ve los tracks privados de otra.
- **Tests de claves:**
  - M1 y M2 del mismo grado y tanda dan claves distintas.
  - Un instrumento sin línea da la **misma clave que antes**.
- Test del importador: un código inexistente falla, y un track de otra asignatura falla.
- Los specs existentes de Panorama y Vista 360 pasan.

**Degradación:** si el punto 7 rompe más specs de los que se arreglan en un ciclo, se separa a otro commit y se reporta. No se omite.

### F3 — Ciencias a secciones electivas (subagentes 4 y 5)

Se sigue `docs/runbook-migracion-ciencias-electivas.md`, con una diferencia: en producción **los 9 instrumentos de Ciencias ya tienen respuestas cargadas**, así que la fusión tiene que re-mapear esas respuestas antes de desactivar los instrumentos viejos. En `soe_tablero` se reproduce ese mismo estado en F0.

**F3a — Ítems faltantes de E1 y E4 (subagente 4).** Con las skills `extraer-pruebas-pdf` y `extraer-fichas-tecnicas-dia`, completa los ítems que la extracción no sacó. Los PDF están en `EdTech/ensayos-paes/`.

- **Gate:** la fusión cierra con **132 ítems** (54 + 3 × 26) en E1, E3 y E4. Cada ítem nuevo tiene clave cruzada contra las respuestas de GradeCam (`cors`).

**F3b — Figuras (subagente 5).** Se desacopla la storage key de la posición: el ítem guarda su `storageKey` explícita, según la sección Figuras del runbook. Así las 330 figuras se reusan sin volver a subirlas.

- **Gate (sin S3):** las 330 keys que quedan en los JSON fusionados son **idénticas, 1 a 1**, a las keys originales que se derivan de los 9 JSON actuales. Ninguna key se pierde ni se inventa.

**F3c — Fusión y re-mapeo (subagente 5).** Script `db:migrate:cie-electivas`, idempotente, con dry-run por defecto y `--commit`:

1. Crea 3 instrumentos (uno por ensayo) con una sección `core` (track `CIE-COMUN`) y tres `elective` (`BIO`, `FIS`, `QUI`), cada una con `elective_group` y `elective_key`.
2. Crea `assessment_forms` y `assessment_form_students` con la mención de cada alumno. La mención es la del instrumento legacy donde tiene respuestas, que a su vez salió de `stats.version` de GradeCam.
3. Re-mapea cada `response` al ítem fusionado por `printedNumber`. El común del E1 se remapea por enunciado, como en el conversor.
4. Recalcula `assessment_item_stats`, `assessment_results` y `skill_results`.
5. Soft delete de los 9 legacy (`deleted_at`). Las respuestas se re-apuntan, nunca se borran.
6. Reaplica los tags por `printedNumber`.

**Gate (con `--commit` sobre `soe_tablero`):**

- El % de logro por alumno es igual al del instrumento legacy para el **100%** de los alumnos.
- El `n` de la sección común es igual a toda la cohorte del ensayo cargada en el banco.
- 0 respuestas huérfanas, 0 alumnos sin forma, y una segunda corrida no cambia nada.
- Se prueba la vuelta atrás que describe el runbook.

**Degradación:** si F3a o F3b no cierran, F3c igual se entrega como script con sus tests y la PR declara a Ciencias como "mixta" hasta completarla. F4 no depende de F3.

### F4 — Tablero por proceso y prueba (subagentes 6 y 7)

**F4a — API (subagente 6).**

1. **DTOs:**
   - `processId` en el query de la matriz, con `.strict()`. Si llega junto a otros parámetros de toma, responde 400.
   - `MasterBoardTake` con `key` = `process:<id>` o `legacy:…`, más `processId`, `processKind`, ventana de fechas, `partial`, `hasResults` e `instrumentType` nullable.
   - `MasterBoardTest` y `testKey` en las celdas.
   - `MetricValue.level` pasa a una banda genérica (`key`, `label`, `order`, `color`).
2. **`getTakes`:**
   - Tomas de proceso, incluidas las que no tienen resultados (`hasResults: false`).
   - Tomas legacy **solo con las evaluaciones sin proceso**, con la etiqueta "sin proceso".
   - `partial` cuando quedan evaluaciones hermanas sin vincular.
   - Orden por `coalesce(max(administered_at), starts_on, created_at)`, la más reciente primero.
3. **Resolución de la toma:** gana `processId`. Si una URL legacy calza con un proceso que contiene todas sus evaluaciones, la respuesta trae `redirectProcessId`.
4. **`loadMatrixRows`** se extrae a `queries/`, con `JOIN items` y `LEFT JOIN instrument_sections`. La columna es `coalesce(section.track_id, instrument.track_id)`, con la asignatura como respaldo. El `GROUP BY` es `(subject, column_key)`.
5. **Por celda (grado × prueba):**
   - Bandas con `resolveEffectiveBandsForInstruments` y comparabilidad con `buildComparabilityMeta`.
   - Marca "mixta" si hay más de un instrumento sin línea.
   - `hasLevels: false` en las celdas-sección.
   - `assessmentIds.length` en los cursos con más de una evaluación.

**F4b — Web (subagente 7).**

- **Selector:** agrupado por año, con nombre, ventana de fechas, insignias "parcial" y "sin resultados", y URL `?processId=`.
- **Redirección:** `page.tsx` redirige con `redirectProcessId`, y la toma por defecto es la primera que devuelve la API.
- **Matriz:**
  - Encabezado de dos niveles. Si ninguna asignatura tiene más de una prueba, una sola fila, como hoy.
  - Colores por banda genérica, con los tokens `--level-*` existentes.
  - Escala neutra en las celdas sin nivel, marca "mixta" y aviso de comparabilidad en el encabezado de cada prueba.
- **Responsive:** la tabla hace scroll horizontal dentro de su contenedor, con la columna de nivel fija.

**Gate:**

- Typecheck en serie de `@soe/api` y `@soe/web`.
- Specs del service: toma por proceso, legacy residual, URL legacy con redirect, 400 por combinación de parámetros, M1 y M2 en columnas separadas, celda mixta y celda-sección sin nivel.
- Tests con React Testing Library del encabezado y del selector.
- **Golden:** con todos los tracks en `null` y sin procesos, la nueva query sobre `soe_tablero` reproduce `docs/golden/master-board-local.json` **bit a bit** en `score_sum`, `max_sum` y `studentsAssessed` por (curso, asignatura).
- **Prueba de punta a punta local:** API y web levantadas contra `soe_tablero`, con la sesión forjada que ya se usa para el E2E local (claim `userId`, `NODE_ENV=development`). El orquestador revisa que el tablero muestre las 5 tandas PAES separadas, M1 y M2 en columnas propias, y Común, Bio, Fís y Quí si F3 cerró. La API y la web se levantan **una vez cada una**, sin builds paralelos.

**Degradación:** ninguna. F4 es el núcleo de la PR.

### F5 — Cargadores escriben proceso y línea (subagente 3, retomado)

1. `import-paes-2026-responses.ts` e `import-dia-2026-responses.ts` crean o reusan el proceso (por slug, en la misma transacción) y escriben `process_id`. En PAES la tanda sale de `config.ensayo`; en DIA, del período.
2. Script de datos `db:backfill:processes:paes` (genérico por org y año): crea "Ensayo PAES N <año>" desde `assessments.config.ensayo` y vincula. Dry-run por defecto.

**Gate (sobre `soe_tablero`):**

- El script crea **5 procesos** que suman todas las evaluaciones PAES del banco, sin repetir ninguna, y la invariante se cumple en cada uno.
- Una carga nueva con el loader cae en su proceso.

### F6 — Integración, PR y CI (orquestador; reparador si hace falta)

1. `git fetch` y rebase sobre `origin/main`. Si `main` sumó migraciones, se borran las propias y se **regeneran**.
2. Se redacta `docs/runbook-tablero-procesos-pruebas.md`: el orden de las operaciones en demo para hacer **con el usuario** (§4), con los comandos de dry-run y lo que debe verse en cada uno.
3. Verificar el estado de la PR (paso aparte), pushear la rama y abrir la PR contra `main` con `gh pr create`. La descripción lleva el resumen por fase, los conteos del banco, las degradaciones y el enlace al runbook.
4. Esperar el CI. Para darla por verde se exigen **más de 0 checks** y `mergeStateStatus = CLEAN`. "No checks" significa conflicto, no "esperando".
5. Si el CI falla, el reparador recibe el log del job y lo corrige. Máximo 3 ciclos.

### F7 — Auditoría final (subagente 8; reparador si hace falta)

**Auditor con contexto fresco.** Recibe el diseño, el plan y el diff completo contra `main`, y tiene acceso a `soe_tablero`. Revisa:

- correctitud y regresiones (en especial el DIA y las vistas que usan las claves de comparabilidad);
- multi-tenant: RLS de `test_tracks` y `measurement_processes`, y `processId` validado contra la org;
- migraciones aditivas, inertes con `null`, numeradas sobre `main` y compatibles con PG 14;
- rendimiento de `getTakes` y `getMatrix`;
- reglas de `.claude/rules`;
- cobertura de tests;
- conformidad con el diseño y sus decisiones cerradas;
- que **ningún archivo del diff toque AWS** ni agregue pasos de deploy.

Entrega hallazgos clasificados y verificados, con archivo y línea.

**Ciclo de cierre:**

- El reparador corrige los críticos y los altos.
- Los medios se corrigen si cuestan poco; si no, se documentan en la PR.
- El CI vuelve a correr. Si hubo críticos, el auditor hace una **re-auditoría acotada** al delta. Máximo 2 ciclos.

**Gate final:** CI verde con más de 0 checks, `mergeStateStatus = CLEAN`, sin hallazgos críticos ni altos abiertos y la descripción de la PR al día. Ahí se entrega la PR.

---

## 4. Fuera del plan: lo que se hace con el usuario

Nada de esto se ejecuta de forma autónoma. Queda documentado en `docs/runbook-tablero-procesos-pruebas.md`:

1. **Merge y deploy.** El push a `main` corre migración, RLS y backfill sobre el RDS demo.
2. **Operaciones de datos en demo**, cada una con dry-run antes de `--commit`:
   1. `db:seed:test-tracks`.
   2. `db:backfill:tracks`.
   3. `db:backfill:processes` y `db:backfill:processes:paes`.
   4. `db:migrate:cie-electivas`, si F3 cerró sin degradación.
   5. Recalcular el read-model de M1 E5.
3. **Sincronizar `dev`:** regenerar sus migraciones `0034+` sobre la nueva cadena de `main`, en una PR aparte.

---

## 5. Riesgos del plan

| Riesgo                                                                | Mitigación                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| El banco local no reproduce todo lo de demo (falta alguna fuente)     | Fixture sintético determinístico de la misma forma, documentado en la PR. Los conteos de referencia son los del banco, no los de demo |
| Demo corre una versión de Postgres distinta a la local (14)           | SQL compatible con PG 14 (sin `NULLS NOT DISTINCT`). El runbook pide verificar la versión antes de migrar                             |
| El portado de procesos arrastra cosas de `dev` que no son de procesos | El subagente 2 lista los commits portados y el auditor la revisa contra `git log`                                                     |
| F3a no logra completar los ítems desde los PDF                        | Degradación: Ciencias queda "mixta" y el script se entrega probado pero sin el gate de 132 ítems                                      |
| `main` se mueve durante el desarrollo                                 | Rebase en F6 y migraciones regeneradas, nunca arrastradas                                                                             |
| La máquina se satura                                                  | Un proceso pesado a la vez, subagentes en serie, suite completa solo en el CI                                                         |
| El golden del DIA no reproduce bit a bit                              | Bloquea F4: es la garantía de que el DIA no cambia                                                                                    |
